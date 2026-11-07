"""Validated, content-addressed FITS ingestion. No writes or network at import."""
from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import warnings

import numpy as np
from astropy import units as u
from astropy.io import fits
from astropy.wcs import WCS
from scipy.interpolate import RegularGridInterpolator


class DataError(ValueError):
    """An actionable, user-facing input error."""


MAX_BYTES = 32 * 1024 * 1024
MAX_SIDE = 256
BAD_FLAGS = {0: "TRANSIENT", 1: "OVERFLOW", 2: "SUR_ERROR", 4: "PHANTOM",
             5: "REFERENCE", 6: "NONFUNC", 7: "DICHROIC", 9: "MISSING_DATA",
             10: "HOT", 11: "COLD", 14: "PHANMISS", 15: "NONLINEAR",
             17: "PERSIST", 19: "OUTLIER"}
BAD_MASK = sum(1 << bit for bit in BAD_FLAGS)
POLICY_VERSION = "exploratory-qr2-v1"


@dataclass
class Epoch:
    image: np.ndarray
    variance: np.ndarray
    flags: np.ndarray
    good: np.ndarray
    wcs: WCS
    header: fits.Header
    checksum: str
    obs_id: str
    mjd: float
    detector: str
    wavelength: np.ndarray | None = None
    bandwidth: np.ndarray | None = None
    wave_quality: str = "missing"
    zodi: np.ndarray | None = None
    psf_sigma: float | None = None
    psf_method: str = "unavailable"
    calibration_checksum: str | None = None
    synthetic: bool = False
    warnings: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        ny, nx = self.image.shape
        ra, dec = self.wcs.pixel_to_world_values((nx-1)/2, (ny-1)/2)
        return {"obs_id": self.obs_id, "mjd": self.mjd, "detector": self.detector,
                "shape": list(self.image.shape), "unit": "MJy/sr", "sha256": self.checksum,
                "good_pixels": int(self.good.sum()), "total_pixels": int(self.good.size),
                "median_sigma": float(np.median(np.sqrt(self.variance[self.good]))),
                "center_ra_deg": float(ra), "center_dec_deg": float(dec),
                "wavelength_quality": self.wave_quality,
                "median_wavelength_um": float(np.nanmedian(self.wavelength)) if self.wavelength is not None else None,
                "psf_sigma_pixels": self.psf_sigma, "psf_method": self.psf_method,
                "calibration_sha256": self.calibration_checksum,
                "mask_policy": POLICY_VERSION, "synthetic": self.synthetic,
                "warnings": self.warnings}


def _unit_factor(header, expected):
    raw = header.get("BUNIT")
    if not raw:
        raise DataError("Missing BUNIT. Supply calibrated IMAGE and VARIANCE units; units are never guessed.")
    try:
        return (1 * u.Unit(raw)).to_value(expected)
    except Exception as exc:
        raise DataError(f"Unsupported BUNIT {raw!r}; expected units equivalent to {expected}.") from exc


def _visual_wavelength(hdul, shape):
    """WCS-WAVE is a 1-based control grid, for visualization only (IRSA)."""
    table = hdul["WCS-WAVE"].data
    xs = np.asarray(table["X"][0], float).ravel()
    ys = np.asarray(table["Y"][0], float).ravel()
    values = np.asarray(table["VALUES"][0], float)
    if values.shape != (len(ys), len(xs), 2):
        values = values.reshape(len(ys), len(xs), 2)
    yi = np.argsort(ys); xi = np.argsort(xs)
    values = values[yi][:, xi]
    yy, xx = np.indices(shape, dtype=float)
    header = hdul["IMAGE"].header
    # The lookup grid is native detector space, NOT cutout pixel space.
    # The alternate W WCS records the cutout translation into table coordinates.
    tx = (xx+1-float(header.get("CRPIX1W", 1))) * float(header.get("CDELT1W", 1)) + float(header.get("CRVAL1W", 1))
    ty = (yy+1-float(header.get("CRPIX2W", 1))) * float(header.get("CDELT2W", 1)) + float(header.get("CRVAL2W", 1))
    points = np.stack([ty.ravel(), tx.ravel()], axis=1)
    out = RegularGridInterpolator((ys[yi], xs[xi]), values,
                                 bounds_error=False, fill_value=np.nan)(points)
    return out[:, 0].reshape(shape), out[:, 1].reshape(shape)


def _psf_width(hdul, header, shape, wcs):
    """Local QR2 PSF circularized second moment; approximation, not an ePSF fit."""
    if header.get("SYNTHET", False) and "PSFSIG" in header:
        sigma=float(header["PSFSIG"])
        if not np.isfinite(sigma) or sigma<=0:
            raise DataError("Synthetic PSFSIG must be finite and positive.")
        return sigma, "known synthetic circular Gaussian"
    if "PSF" not in hdul or "CRPIX1A" not in header or "CRPIX2A" not in header:
        return None, "unavailable"
    ph = hdul["PSF"].header
    if ph.get("NAXIS") != 3 or any(ph.get(f"NAXIS{i}", 0) > 256 for i in (1,2,3)):
        raise DataError("PSF extension dimensions exceed the supported QR2 cube size.")
    cube = hdul["PSF"].data
    ny, nx = shape
    ox = 1 + (nx-1)/2 - header["CRPIX1A"]
    oy = 1 + (ny-1)/2 - header["CRPIX2A"]
    zones = [(i, ph[f"XCTR_{i}"], ph[f"YCTR_{i}"]) for i in range(1, len(cube)+1)
             if f"XCTR_{i}" in ph and f"YCTR_{i}" in ph]
    if not zones:
        return None, "PSF zone coordinates unavailable"
    index, _, _ = min(zones, key=lambda t: (t[1]-ox)**2+(t[2]-oy)**2)
    p = np.maximum(np.nan_to_num(np.asarray(cube[index-1], float)), 0)
    if not p.sum() > 0:
        return None, "PSF has no positive support"
    p /= p.sum()
    yy, xx = np.indices(p.shape)
    cx, cy = (p*xx).sum(), (p*yy).sum()
    sig = np.sqrt((p*((xx-cx)**2+(yy-cy)**2)).sum()/2)
    scale = np.sqrt(abs(np.linalg.det(wcs.pixel_scale_matrix))) * 3600
    psf_scale = abs(float(ph.get("CDELT1", 0.615)))
    # QR2 PSF XANG is arcseconds, not degrees. Do not infer from science CDELT.
    return float(sig*psf_scale/scale), f"QR2 zone {index}; circularized Gaussian approximation"


def load_epoch(source: bytes | str | Path, calibration: bytes | None = None) -> Epoch:
    """Load complete small MEF cutouts; fresh masks always derive from these bytes."""
    if isinstance(source, (str, Path)):
        path = Path(source)
        if not path.is_file():
            raise DataError(f"FITS file missing: {path.name}. Restore the reference data or supply both epochs.")
        if path.stat().st_size > MAX_BYTES:
            raise DataError("Use a FITS cutout smaller than 32 MiB.")
        raw = path.read_bytes()
    else:
        raw = source
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_BYTES:
        raise DataError("Supply a non-empty, uncompressed FITS cutout smaller than 32 MiB.")
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            with fits.open(BytesIO(raw), memmap=False, lazy_load_hdus=False) as hdul:
                hdul.verify("exception")
                for name in ("IMAGE", "FLAGS", "VARIANCE"):
                    if name not in hdul:
                        raise DataError(f"Required extension {name} missing. Upload a Level-2 MEF, not a preview image.")
                    h = hdul[name].header
                    if isinstance(hdul[name], fits.CompImageHDU):
                        raise DataError("Use uncompressed MEF cutouts; compressed image HDUs are not supported.")
                    if h.get("NAXIS") != 2 or not (2 <= h.get("NAXIS1", 0) <= MAX_SIDE and
                                                                 2 <= h.get("NAXIS2", 0) <= MAX_SIDE):
                        raise DataError(f"{name}: use a 2D cutout with at most {MAX_SIDE} pixels per side.")
                header = hdul["IMAGE"].header.copy()
                image = np.array(hdul["IMAGE"].data, dtype=float) * _unit_factor(header, u.MJy/u.sr)
                variance = np.array(hdul["VARIANCE"].data, dtype=float) * _unit_factor(hdul["VARIANCE"].header, (u.MJy/u.sr)**2)
                flags = np.array(hdul["FLAGS"].data)
                if flags.dtype.kind not in "iu":
                    raise DataError("FLAGS must be integer bitmasks.")
                flags = flags.astype(np.int64)
                if image.shape != variance.shape or image.shape != flags.shape:
                    raise DataError("IMAGE, FLAGS and VARIANCE must have the same shape.")
                wcs = WCS(header, hdul, relax=True).celestial
                if not wcs.has_celestial or wcs.pixel_n_dim != 2:
                    raise DataError("A valid celestial WCS is required for sky comparison.")
                ra, dec = wcs.pixel_to_world_values((image.shape[1]-1)/2, (image.shape[0]-1)/2)
                if not np.isfinite([ra, dec]).all():
                    raise DataError("Celestial WCS does not return finite sky coordinates.")
                mjd = float(header.get("MJD-OBS", hdul[0].header.get("MJD-OBS", np.nan)))
                if not np.isfinite(mjd):
                    raise DataError("MJD-OBS is required; file creation time is not an observing epoch.")
                good = ((flags & BAD_MASK) == 0) & np.isfinite(image) & np.isfinite(variance) & (variance > 0)
                if not good.any():
                    raise DataError("No valid pixels remain after flags and variance checks.")
                epoch = Epoch(image, variance, flags, good, wcs, header, sha256(raw).hexdigest(),
                              str(header.get("OBSID", "unknown")), mjd,
                              str(header.get("DETECTOR", header.get("BAND", "unknown"))),
                              synthetic=bool(header.get("SYNTHET", False)))
                if "WCS-WAVE" in hdul:
                    try:
                        epoch.wavelength, epoch.bandwidth = _visual_wavelength(hdul, image.shape)
                        epoch.wave_quality = "visualization lookup"
                    except Exception as exc:
                        epoch.warnings.append(f"Cannot interpret WCS-WAVE: {type(exc).__name__}.")
                if epoch.synthetic and "CWAVE" in hdul and "CBAND" in hdul:
                    epoch.wavelength = np.array(hdul["CWAVE"].data, float)
                    epoch.bandwidth = np.array(hdul["CBAND"].data, float)
                    epoch.wave_quality = "synthetic truth"
                if "ZODI" in hdul and hdul["ZODI"].data.shape == image.shape:
                    epoch.zodi = np.array(hdul["ZODI"].data, float) * _unit_factor(hdul["ZODI"].header, u.MJy/u.sr)
                epoch.psf_sigma, epoch.psf_method = _psf_width(hdul, header, image.shape, wcs)
                if epoch.psf_sigma is not None and (not np.isfinite(epoch.psf_sigma) or epoch.psf_sigma<=0):
                    epoch.psf_sigma=None;epoch.psf_method="invalid PSF model"
                if epoch.wavelength is not None:
                    spectral_ok=np.isfinite(epoch.wavelength)&np.isfinite(epoch.bandwidth)&(epoch.wavelength>0)&(epoch.bandwidth>0)
                    if not (spectral_ok&good).any():
                        epoch.wavelength=epoch.bandwidth=None;epoch.wave_quality="missing"
                        epoch.warnings.append("No finite positive spectral support on valid science pixels.")
                if not epoch.synthetic:
                    epoch.warnings.append("Real-data residuals are exploratory; PSF shape, calibration systematics and source colors need validation.")
            for warning in caught:
                message = str(warning.message)
                if "truncated" in message.lower():
                    raise DataError("FITS is truncated. Download the complete file again.")
        if calibration:
            apply_spectral_calibration(epoch, calibration)
        return epoch
    except DataError:
        raise
    except Exception as exc:
        raise DataError(f"Cannot read this FITS ({type(exc).__name__}). Check the complete MEF, WCS and extension units.") from exc


def apply_spectral_calibration(epoch: Epoch, raw: bytes):
    """Map a user-supplied detector CWAVE/CBAND product onto an integer cutout."""
    if len(raw) > 48*1024*1024:
        raise DataError("Spectral calibration must be smaller than 48 MiB.")
    if "CRPIX1A" not in epoch.header or "CRPIX2A" not in epoch.header:
        raise DataError("Calibration mapping needs CRPIX1A/CRPIX2A from the original cutout.")
    with fits.open(BytesIO(raw), memmap=False) as hdul:
        hdul.verify("exception")
        if "CWAVE" not in hdul or "CBAND" not in hdul:
            raise DataError("Calibration must contain CWAVE and CBAND.")
        # Establish detector identity explicitly; never silently attach a different detector.
        detector = str(hdul[0].header.get("DETECTOR", hdul["CWAVE"].header.get("DETECTOR", "unknown")))
        if detector == "unknown" or epoch.detector == "unknown" or detector != epoch.detector:
            raise DataError("Calibration and IMAGE DETECTOR metadata must both exist and match.")
        x0, y0 = 1-float(epoch.header["CRPIX1A"]), 1-float(epoch.header["CRPIX2A"])
        if abs(x0-round(x0)) > 1e-6 or abs(y0-round(y0)) > 1e-6:
            raise DataError("Only unresampled integer cutouts support native detector calibration mapping.")
        x0, y0 = round(x0), round(y0); ny, nx = epoch.image.shape
        arrays = []
        for name in ("CWAVE", "CBAND"):
            array = hdul[name].data
            if array.ndim != 2 or x0 < 0 or y0 < 0 or y0+ny > array.shape[0] or x0+nx > array.shape[1]:
                raise DataError("Calibration does not cover this cutout in native detector coordinates.")
            unit = hdul[name].header.get("BUNIT", "um")
            factor = (1*u.Unit(unit)).to_value(u.um)
            arrays.append(np.array(array[y0:y0+ny, x0:x0+nx], float)*factor)
        epoch.wavelength, epoch.bandwidth = arrays
        spectral_ok=np.isfinite(arrays[0])&np.isfinite(arrays[1])&(arrays[0]>0)&(arrays[1]>0)
        if not (spectral_ok&epoch.good).any():
            raise DataError("Spectral calibration has no finite positive support on valid science pixels.")
        epoch.wave_quality = "CWAVE/CBAND calibration supplied"
        epoch.calibration_checksum = sha256(raw).hexdigest()
