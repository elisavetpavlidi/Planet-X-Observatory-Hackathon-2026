# Science contract and limitations

This document describes the optional Python SPHEREx analysis tools. The main website uses the separately documented aperture/track pipeline in [DATA.md](DATA.md).

## Input → evidence

Each observation is loaded from the **IMAGE**, **FLAGS**, and **VARIANCE** extensions by name. Surface brightness and variance are converted to MJy/sr and (MJy/sr)² with Astropy units. Missing units, non-integer FLAGS, missing epoch/WCS, unequal shapes and all-invalid data stop processing. MJD-OBS is observing time; a download or file creation timestamp is not.

The original exploratory policy rejects bits 0,1,2,4,5,6,7,9,10,11,14,15,17,19. SOURCE bit 21 alone is retained. This is the retained exploratory mask policy; it is **not certified as a universal QR2/QR3 science mask**. Check the release-specific Explanatory Supplement before selecting an observing sample. Invalid data are NaN, displayed purple, never replaced by zero as usable science.

## Native detector coordinates matter

The uploaded cutouts have translated WCS reference pixels. For the alternate native detector WCS, zero-based original coordinates are:

```python
x_original = 1 + x_cutout - CRPIX1A
y_original = 1 + y_cutout - CRPIX2A
```

The WCS-WAVE table is evaluated using its **alternate W WCS translation**. Interpolating its native X/Y grid directly at cutout `(x,y)` gives the wrong wavelengths. The test suite compares this implementation against wcslib's independent WCS-TAB evaluation.

The local QR2 PSF zone is the nearest `(XCTR_i,YCTR_i)` to the cutout center in native detector coordinates. The cube plane index is `i-1`. The second moment of this PSF is circularized and converted from its oversampled arcsecond grid to science pixels. This is an approximation; spatial PSF variation, asymmetry and ePSF corrections are not modeled. Missing PSF metadata stops matching unless the user explicitly switches PSF matching off, which is flagged exploratory.

## Compatibility and registration

B is sampled onto A's celestial WCS grid using sparse bilinear weights. Equal array sizes are not assumed to imply equal sky grids. Each output pixel requires full valid interpolation support; quality or spectral masks are not interpolated into fractional “good enough” values.

Spectral acceptance is:

`abs(lambda_A - lambda_B_on_A) <= tolerance * (bandwidth_A + bandwidth_B_on_A)/2`

Default tolerance: 0.25 bandwidths. This is a documented exploratory selection parameter, not a universal scientific matching criterion. It does not correct source color terms or differing passband shapes. Same input, same epoch, too little sky/quality overlap, missing wavelength or too few spectral matches block difference imaging. Real visualization wavelengths are explicitly flagged as uncalibrated for scientific variability inference.

## Processing and exact diagonal propagation for the chosen linear model

Optional ZODI subtraction uses the provided model; IMAGE has not had this model subtracted by IRSA. Model errors are not provided or propagated. A sigma-clipped per-frame median can be subtracted to remove a constant background offset. This is unsuitable for some extended fields; turn it off and assess the background model. No automatic multiplicative photometric scaling is fitted.

For circular Gaussian PSF approximations, cross-smoothing gives A convolved with B's modeled PSF, and registered B convolved with A's modeled PSF. Sparse operators combine registration and smoothing:

```text
L_A = K_B
L_B = K_A R_B→A
D   = L_B (I_B - b_B) - L_A (I_A - b_A)
V_D = (L_A ∘ L_A) V_A + (L_B ∘ L_B) V_B
S   = D / sqrt(V_D)
```

`∘` is elementwise multiplication. Combining the linear weights **before squaring** avoids treating neighboring reprojected pixels as independent during later smoothing. The diagonal variance is exact for these selected linear operators under **independent native-pixel and independent-epoch noise**. A separate Monte Carlo check uses SciPy interpolation and convolution to check this calculation.

Output pixels are still correlated. No full output covariance is exported; median-background fitting uncertainty, wavelength/color calibration, actual PSF-model error, native correlated detector noise, interpolation modeling error and photometric calibration systematics are omitted. This is not a complete physical likelihood.

## Residual regions

Threshold positive and negative local S separately; group 8-connected pixels; require a minimum area. Export peak `(x,y)`, celestial `(RA,Dec)`, signed local S and region area. A 5-S pixel is **not** a global false-alarm probability; many correlated pixels and parameter choices were inspected. Region S values must not be summed as independent significance. A two-epoch dipole is not an orbit or a Planet X identification.

Next scientific requirements: calibrated compatible wavelengths and passbands; independent fields; current release masks; accurate spatial ePSF modeling; static-source registration/photometry residual checks; injection completeness and false positives across flux/motion/field conditions; additional epochs and possible solar-system crossmatches. These are recorded as pending, not silently marked complete.

## Optional terminal tools in release 1.1.0

The main website is the Node application in `web/`. The methods above describe the separate Python SPHEREx tools; the web motion detector uses the aperture/track method described in [DATA.md](DATA.md).

For the same interpreter on macOS and Linux, install [uv 0.13.4](https://docs.astral.sh/uv/getting-started/installation/) from Astral, then run from the repository root. The script installs the pinned Python 3.12.14 and dependencies. An existing exact Python 3.12.14 also works without uv:

```bash
bash scripts/setup_science.sh
bash scripts/verify_science.sh
```

`verify_science.sh` verifies original FITS, runs the Python tests and writes quality/noise images and a compatibility report in `outputs/science-report/`. M31's incompatible wavelengths correctly block a temporal comparison. It is not a failed installation.

To inspect your own original SPHEREx file or analyze a scientifically compatible pair:

```bash
.venv/bin/python -m planetx.cli inspect path/to/observation.fits
.venv/bin/python -m planetx.cli analyze --a path/to/A.fits --b path/to/B.fits --output outputs/my-pair
```

A blocked pair exits with code 2 and writes `compatibility.json`; it does not produce a false significance map. Output products remain exploratory under the limitations above. Synthetic injection controls exist only inside `tests/fixtures/`; the application and analysis CLI have no simulated-observation mode.
