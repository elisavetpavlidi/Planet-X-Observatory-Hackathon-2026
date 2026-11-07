"""WCS registration, spectral compatibility, linear PSF approximation, variance."""
from __future__ import annotations

from dataclasses import dataclass, asdict
import numpy as np
from scipy import sparse
from astropy.stats import sigma_clipped_stats
from .data import DataError, Epoch


@dataclass(frozen=True)
class Config:
    threshold: float = 5.0
    min_area: int = 3
    wave_tolerance: float = 0.25  # fraction of mean bandwidth
    subtract_zodi: bool = False
    subtract_background: bool = True
    psf_match: bool = True

    def validate(self):
        if not (3 <= self.threshold <= 15 and 1 <= self.min_area <= 30 and 0.05 <= self.wave_tolerance <= 1):
            raise DataError("Threshold, area or wavelength tolerance is outside the supported range.")


@dataclass
class Comparison:
    aligned_a: np.ndarray
    aligned_b: np.ndarray
    difference: np.ndarray
    variance: np.ndarray
    significance: np.ndarray
    valid: np.ndarray
    report: dict


def registration_operator(a: Epoch, b: Epoch):
    """Sparse bilinear weights mapping B to A; no extrapolation or NaN filling."""
    shape = a.image.shape; ny, nx = b.image.shape
    yy, xx = np.indices(shape, dtype=float)
    sky = a.wcs.pixel_to_world(xx, yy)
    xb, yb = b.wcs.world_to_pixel(sky)
    xb, yb = np.asarray(xb).ravel(), np.asarray(yb).ravel()
    finite = np.isfinite(xb) & np.isfinite(yb)
    # Suppress spurious 1e-11-pixel interpolation for exactly coincident WCS grids.
    xb = np.where(np.abs(xb-np.round(xb)) < 1e-7, np.round(xb), xb)
    yb = np.where(np.abs(yb-np.round(yb)) < 1e-7, np.round(yb), yb)
    x0 = np.floor(np.where(finite, xb, 0)).astype(int)
    y0 = np.floor(np.where(finite, yb, 0)).astype(int)
    dx, dy = xb-x0, yb-y0
    rows, cols, weights = [], [], []
    for ox, oy, w in [(0,0,(1-dx)*(1-dy)), (1,0,dx*(1-dy)),
                      (0,1,(1-dx)*dy), (1,1,dx*dy)]:
        ix, iy = x0+ox, y0+oy
        keep = finite & (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny) & (w > 1e-12)
        rows.extend(np.flatnonzero(keep)); cols.extend((iy[keep]*nx+ix[keep]).tolist()); weights.extend(w[keep])
    matrix = sparse.csr_matrix((weights, (rows, cols)), shape=(a.image.size, b.image.size))
    return matrix, xb.reshape(shape), yb.reshape(shape)


def gaussian_operator(shape, sigma):
    """Finite-support, positive kernel. Boundary mass is deliberately not renormalized."""
    size = int(np.prod(shape))
    if sigma <= 0.02:
        return sparse.eye(size, format="csr")
    if sigma > 2.5 or not np.isfinite(sigma):
        raise DataError("PSF smoothing is too broad for this memory limit; use a smaller/appropriate field.")
    radius = int(np.ceil(3.5*sigma))
    if size*(2*radius+1)**2 > 3_000_000:
        raise DataError("PSF operator exceeds the memory budget. Use a smaller cutout (about 100 pixels per side).")
    coords = np.arange(-radius, radius+1)
    kernel = np.exp(-(coords[:, None]**2+coords[None, :]**2)/(2*sigma**2)); kernel /= kernel.sum()
    ny, nx = shape; yy, xx = np.indices(shape); ids = np.arange(size).reshape(shape)
    rows, cols, weights = [], [], []
    for jy, oy in enumerate(coords):
        for jx, ox in enumerate(coords):
            valid = (xx+ox >= 0) & (xx+ox < nx) & (yy+oy >= 0) & (yy+oy < ny)
            rows.append(ids[valid]); cols.append((yy[valid]+oy)*nx+(xx[valid]+ox))
            weights.append(np.full(valid.sum(), kernel[jy, jx]))
    return sparse.csr_matrix((np.concatenate(weights), (np.concatenate(rows), np.concatenate(cols))), shape=(size, size))


def compatibility(a: Epoch, b: Epoch, config=Config(), operator=None):
    config.validate()
    r, _, _ = registration_operator(a,b) if operator is None else operator
    coverage = np.asarray(r @ np.ones(b.image.size)).ravel() > 1-1e-6
    quality = coverage & a.good.ravel() & (np.asarray(r @ b.good.ravel().astype(float)).ravel() > 1-1e-6)
    report = {"epoch_separation_days": abs(b.mjd-a.mjd), "same_input": a.checksum == b.checksum,
              "sky_coverage_fraction": float(coverage.mean()), "quality_overlap_pixels": int(quality.sum()),
              "spectral_pass_fraction": 0.0, "wave_difference_median_um": None,
              "wave_offset_in_bandwidths": None, "wave_quality_a": a.wave_quality,
              "wave_quality_b": b.wave_quality, "blockers": []}
    if report["same_input"] or report["epoch_separation_days"] <= 1e-8:
        report["blockers"].append("Two distinct observing epochs are required.")
    if report["sky_coverage_fraction"] < 0.2 or quality.sum() < 30:
        report["blockers"].append("Insufficient common sky coverage with valid quality pixels.")
    spectral = np.zeros(a.image.size, bool)
    if a.wavelength is None or b.wavelength is None or a.bandwidth is None or b.bandwidth is None:
        report["blockers"].append("Wavelength and bandwidth maps are required before difference imaging.")
    else:
        wb = np.asarray(r @ np.nan_to_num(b.wavelength).ravel()).ravel()
        bb = np.asarray(r @ np.nan_to_num(b.bandwidth).ravel()).ravel()
        wa, ba = a.wavelength.ravel(), a.bandwidth.ravel()
        denom = (ba+bb)/2
        spectral = np.isfinite(wa) & np.isfinite(denom) & (denom>0) & (np.abs(wa-wb) <= config.wave_tolerance*denom)
        # Reject mappings that touched non-finite wavelength calibration values.
        finite_b = np.isfinite(b.wavelength) & np.isfinite(b.bandwidth) & (b.bandwidth>0)
        spectral &= (np.asarray(r @ finite_b.ravel().astype(float)).ravel() > 1-1e-6)
        report["spectral_pass_fraction"] = float((spectral & quality).sum()/max(quality.sum(),1))
        stats=quality & np.isfinite(wa) & np.isfinite(wb) & np.isfinite(denom) & (denom>0)
        if stats.any():
            report["wave_difference_median_um"] = float(np.median(np.abs(wa[stats]-wb[stats])))
            report["wave_offset_in_bandwidths"] = float(np.median(np.abs(wa[stats]-wb[stats])/denom[stats]))
        if (spectral & quality).sum() < 30:
            report["blockers"].append("Wavelength mismatch: too few common pixels satisfy the selected bandwidth tolerance.")
    if a.synthetic != b.synthetic:
        report["blockers"].append("Synthetic and real observations cannot be mixed in one comparison.")
    report["calibrated_wavelength"] = (a.wave_quality in ("synthetic truth", "CWAVE/CBAND calibration supplied")
                                         and b.wave_quality in ("synthetic truth", "CWAVE/CBAND calibration supplied"))
    report["status"] = "blocked" if report["blockers"] else ("synthetic validation" if a.synthetic else "exploratory real-data comparison")
    return report, (quality & spectral).reshape(a.image.shape)


def _background(image, good):
    _, median, _ = sigma_clipped_stats(image[good], sigma=3.0, maxiters=5)
    return float(median)


def compare(a: Epoch, b: Epoch, config=Config()) -> Comparison:
    config.validate()
    transform = registration_operator(a,b); r = transform[0]
    report, pair_good = compatibility(a,b,config,transform)
    if report["blockers"]:
        raise DataError(" ".join(report["blockers"]))
    if config.psf_match and (a.psf_sigma is None or b.psf_sigma is None):
        raise DataError("PSF information is missing. Inspect PSF metadata; unmatched comparison is explicitly exploratory.")
    # Cross-smooth circular Gaussian approximations: A*PSF_B and B*PSF_A.
    scale_a = np.sqrt(abs(np.linalg.det(a.wcs.pixel_scale_matrix)))
    scale_b = np.sqrt(abs(np.linalg.det(b.wcs.pixel_scale_matrix)))
    ka = gaussian_operator(a.image.shape, b.psf_sigma*scale_b/scale_a if config.psf_match else 0)
    kb = gaussian_operator(a.image.shape, a.psf_sigma if config.psf_match else 0)
    # Combine registration AND smoothing before squaring weights. This retains
    # within-pixel covariance introduced by interpolation in diagonal variance.
    la, lb = ka, (kb @ r).tocsr()
    if lb.nnz > 15_000_000:
        raise DataError("Comparison operator too large; request a smaller cutout.")
    valid_a = np.asarray(la @ a.good.ravel().astype(float)).ravel() > 1-1e-6
    valid_b = np.asarray(lb @ b.good.ravel().astype(float)).ravel() > 1-1e-6
    spectral_support=pair_good.ravel().astype(float)
    valid_wave = ((np.asarray(kb @ spectral_support).ravel() > 1-1e-6) &
                  (np.asarray(ka @ spectral_support).ravel() > 1-1e-6))
    valid = (valid_a & valid_b & valid_wave).reshape(a.image.shape)
    if valid.sum() < 30:
        raise DataError("Too few pixels remain after PSF support and joint quality/spectral masking.")
    ia, ib = a.image.copy(), b.image.copy()
    if config.subtract_zodi:
        if a.zodi is None or b.zodi is None:
            raise DataError("ZODI subtraction requested, but one epoch has no valid ZODI model.")
        if not np.isfinite(a.zodi[a.good]).all() or not np.isfinite(b.zodi[b.good]).all():
            raise DataError("ZODI contains non-finite values on accepted pixels; model subtraction is paused.")
        ia -= a.zodi; ib -= b.zodi
    bg_a = _background(ia, a.good) if config.subtract_background else 0.0
    bg_b = _background(ib, b.good) if config.subtract_background else 0.0
    aa = np.asarray(la @ np.nan_to_num(ia-bg_a).ravel()).reshape(a.image.shape)
    bb = np.asarray(lb @ np.nan_to_num(ib-bg_b).ravel()).reshape(a.image.shape)
    va = np.asarray(la.multiply(la) @ np.nan_to_num(a.variance, nan=0., posinf=0., neginf=0.).ravel()).reshape(a.image.shape)
    vb = np.asarray(lb.multiply(lb) @ np.nan_to_num(b.variance, nan=0., posinf=0., neginf=0.).ravel()).reshape(a.image.shape)
    variance = va+vb; valid &= np.isfinite(variance) & (variance>0)
    diff = np.where(valid, bb-aa, np.nan)
    significance = np.full_like(diff, np.nan); significance[valid] = diff[valid]/np.sqrt(variance[valid])
    report.update({"valid_comparison_pixels": int(valid.sum()), "background_a": bg_a, "background_b": bg_b,
                   "config": asdict(config), "a": a.summary(), "b": b.summary(),
                   "noise_model": "Independent native-pixel and epoch noise; exact combined linear weights for per-pixel propagated variance. Output pixels remain correlated.",
                   "limitations": ["No covariance supplied for native pixels; calibration/PSF/background-fit systematics omitted.",
                                   "Threshold is local per-pixel S, not a trials-corrected probability or a discovery claim.",
                                   "Real PSFs are circularized Gaussian approximations; inspect extended-source and color residuals."]})
    return Comparison(np.where(valid, aa, np.nan), np.where(valid, bb, np.nan), diff,
                      np.where(valid, variance, np.nan), significance, valid, report)
