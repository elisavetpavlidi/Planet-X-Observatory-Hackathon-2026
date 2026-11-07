"""Signed connected residual regions; never equate a residual with Planet X."""
import numpy as np
from scipy import ndimage


def detect_regions(comparison, wcs, threshold=5., min_area=3):
    s = comparison.significance; result = []
    for sign in (1,-1):
        labels, count = ndimage.label(comparison.valid & (sign*s >= threshold), structure=np.ones((3,3)))
        for label in range(1,count+1):
            yy, xx = np.where(labels == label)
            if len(xx) < min_area:
                continue
            k = int(np.argmax(sign*s[yy,xx])); x, y = int(xx[k]), int(yy[k])
            ra, dec = wcs.pixel_to_world_values(x,y)
            result.append({"id": f"{'P' if sign>0 else 'N'}{label:03d}",
                           "kind": "positive residual" if sign>0 else "negative residual",
                           "x": x, "y": y, "ra_deg": float(ra), "dec_deg": float(dec),
                           "peak_local_s": float(s[y,x]), "area_pixels": int(len(xx)),
                           "peak_delta_MJy_sr": float(comparison.difference[y,x]),
                           "interpretation": "Requires artifact, PSF, color and additional-epoch checks"})
    return sorted(result, key=lambda d: abs(d["peak_local_s"]), reverse=True)[:100]
