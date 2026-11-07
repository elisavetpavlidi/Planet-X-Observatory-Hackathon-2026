"""Explicit online actions only. IRSA URLs are validated before any download."""
from io import BytesIO
from pathlib import Path
import math
import os
import tempfile
from urllib.parse import urlparse, urlencode, urlunparse, parse_qsl
import requests
from astropy.io.votable import parse_single_table
from .data import DataError, load_epoch, MAX_BYTES

IRSA='irsa.ipac.caltech.edu'


def search_observations(ra,dec,radius_arcmin=2.,collection='spherex_qr2'):
    if not all(math.isfinite(v) for v in (ra,dec,radius_arcmin)) or not (0<=ra<360 and -90<=dec<=90 and .1<=radius_arcmin<=10):
        raise DataError('Use RA [0,360), Dec [-90,90], and radius 0.1–10 arcmin.')
    if collection not in ['spherex_qr2','spherex_qr3','spherex_qr2_deep','spherex_qr3_deep']:
        raise DataError('Unsupported SPHEREx collection.')
    try:
        r=requests.get(f'https://{IRSA}/SIA',params={'COLLECTION':collection,'POS':f'circle {ra} {dec} {radius_arcmin/60}',
                                                    'MAXREC':100},timeout=(10,45),stream=True)
        r.raise_for_status();chunks=[];size=0
        for chunk in r.iter_content(65536):
            size+=len(chunk)
            if size>8*1024*1024:raise DataError('Archive result too large; use a smaller search region.')
            chunks.append(chunk)
        # IRSA supplies FIELD IDs col_0,... separately from semantic names.
        table=parse_single_table(BytesIO(b''.join(chunks))).to_table(use_names_over_ids=True)
        keys=[key for key in ['obs_id','obs_title','t_min','t_max','em_min','em_max','access_url'] if key in table.colnames]
        if 'access_url' not in keys:raise DataError('IRSA response has no access_url. Inspect the current service response.')
        return [{key:(None if getattr(row[key],'mask',False) else str(row[key])) for key in keys} for row in table[:100]]
    except DataError:raise
    except Exception as exc:raise DataError('IRSA search unavailable. Use the bundled offline data or the IRSA browser search.') from exc


def cutout_url(url,ra,dec,size_arcmin=10.):
    p=urlparse(url)
    if p.scheme!='https' or p.hostname!=IRSA or p.port not in (None,443) or p.username or p.password or not p.path.startswith('/ibe/data/spherex/') or not p.path.endswith('.fits'):
        raise DataError('Choose an HTTPS FITS access_url from the official IRSA /ibe/data/spherex/ service.')
    if not (math.isfinite(ra) and math.isfinite(dec) and 0<=ra<360 and -90<=dec<=90 and .5<=size_arcmin<=15):
        raise DataError('Invalid cutout center/size.')
    query=dict(parse_qsl(p.query));query.update(center=f'{ra:.8f},{dec:.8f}',size=f'{size_arcmin/60:.8f}')
    return urlunparse(p._replace(query=urlencode(query)))


def download_cutout(url,destination,ra,dec,size_arcmin=10.):
    target=Path(destination)
    if target.exists():raise DataError('Destination already exists; choose a new filename to protect existing observations.')
    target.parent.mkdir(parents=True,exist_ok=True)
    url=cutout_url(url,ra,dec,size_arcmin)
    temporary=None
    try:
        # No cross-host redirects and no resumable partial files.
        with requests.get(url,stream=True,timeout=(10,90),allow_redirects=False) as r:
            if r.status_code!=200:raise DataError(f'IRSA returned HTTP {r.status_code}; use the direct browser cutout link.')
            with tempfile.NamedTemporaryFile(dir=target.parent,suffix='.part',delete=False) as f:
                temporary=Path(f.name);size=0
                for chunk in r.iter_content(65536):
                    size+=len(chunk)
                    if size>MAX_BYTES:raise DataError('Downloaded cutout exceeds 32 MiB.')
                    f.write(chunk)
        epoch=load_epoch(temporary)
        # Exclusive destination creation prevents accidental overwrites even on races.
        with target.open('xb') as f:f.write(temporary.read_bytes())
        return {'access_url':url,**epoch.summary()}
    except DataError:raise
    except Exception as exc:raise DataError('Download failed; keep the existing observations and retry through IRSA.') from exc
    finally:
        if temporary:temporary.unlink(missing_ok=True)
