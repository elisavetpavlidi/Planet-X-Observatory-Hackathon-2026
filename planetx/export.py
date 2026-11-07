"""Portable, in-memory run records with arrays, policy, hashes and versions."""
from io import BytesIO, StringIO
from datetime import datetime, timezone
import csv
import importlib.metadata
import json
import zipfile
import numpy as np
from astropy.io import fits
from . import __version__
from .provenance import source_fingerprint


def report_json(report):
    return json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)


def export_run(a,b,comparison,regions,config):
    report=dict(comparison.report)
    report['software']={name:importlib.metadata.version(name) for name in ['numpy','scipy','astropy']}
    report['planetx_version']=__version__
    report['source_sha256']=source_fingerprint()
    report['source_fingerprint_scope']='package.json, web/*.mjs, planetx/*.py, requirements.txt'
    report['exported_utc']=datetime.now(timezone.utc).isoformat()
    report['residual_region_count']=len(regions)
    table=StringIO();cols=['id','kind','x','y','ra_deg','dec_deg','peak_local_s','area_pixels','peak_delta_MJy_sr','interpretation']
    writer=csv.DictWriter(table,fieldnames=cols);writer.writeheader();writer.writerows(regions)
    hdus=[fits.PrimaryHDU()]
    for name,array,unit in [('ALIGNED_A',comparison.aligned_a,'MJy/sr'),('ALIGNED_B',comparison.aligned_b,'MJy/sr'),
                            ('DIFFERENCE',comparison.difference,'MJy/sr'),('VARIANCE',comparison.variance,'MJy2/sr2'),
                            ('LOCAL_S',comparison.significance,''),('VALID',comparison.valid.astype('uint8'),'')]:
        h=a.wcs.to_header(relax=True);h['BUNIT']=unit;h['PXVER']=__version__
        hdus.append(fits.ImageHDU(array,header=h,name=name))
    out=BytesIO();fits.HDUList(hdus).writeto(out,checksum=True)
    bundle=BytesIO()
    with zipfile.ZipFile(bundle,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('report.json',report_json(report));z.writestr('residual_regions.csv',table.getvalue())
        z.writestr('comparison.fits',out.getvalue())
        z.writestr('READ_ME.txt','Exploratory output, not a Planet X discovery.\nInput SHA256 and configuration are in report.json.\nUploaded input FITS are intentionally not copied into this export. Retain them separately.\nLOCAL_S is not corrected for multiple trials; neighboring pixels are correlated.\n')
    return bundle.getvalue(),report
