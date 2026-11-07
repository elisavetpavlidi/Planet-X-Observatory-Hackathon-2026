"""Reproducible terminal entry points; all output paths are explicit."""
import argparse
from dataclasses import asdict
from pathlib import Path
from hashlib import sha256
import json
import sys
import numpy as np
from .data import load_epoch, DataError
from .processing import Config, compatibility, compare
from .detection import detect_regions
from .export import export_run, report_json
from .visualization import png, blink_gif
from .archive import search_observations, download_cutout

ROOT=Path(__file__).resolve().parents[1]


def verify_data():
    manifest=json.loads((ROOT/'data/manifest.json').read_text())
    results=[]
    for item in manifest['files']:
        path=ROOT/item['path']
        if not path.is_file() or sha256(path.read_bytes()).hexdigest()!=item['sha256']:
            raise DataError(f'Bundled data integrity failure: {item["path"]}. Restore the original file.')
        epoch=load_epoch(path)
        if epoch.obs_id!=item['obs_id']:raise DataError('Observation ID does not match the manifest.')
        results.append(epoch.summary())
    return results


def main(argv=None):
    p=argparse.ArgumentParser(description='Planet X / SPHEREx observation analysis')
    sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('verify-data',help='Check bundled bytes, FITS and observation IDs')
    inspect=sub.add_parser('inspect');inspect.add_argument('fits')
    analyze=sub.add_parser('analyze')
    analyze.add_argument('--a');analyze.add_argument('--b');analyze.add_argument('--calibration')
    analyze.add_argument('--output',default='outputs/run');analyze.add_argument('--threshold',type=float,default=5.)
    analyze.add_argument('--min-area',type=int,default=3);analyze.add_argument('--wave-tolerance',type=float,default=.25)
    analyze.add_argument('--no-psf',action='store_true');analyze.add_argument('--no-background',action='store_true')
    search=sub.add_parser('search');search.add_argument('--ra',type=float,required=True);search.add_argument('--dec',type=float,required=True)
    search.add_argument('--radius',type=float,default=2.);search.add_argument('--collection',default='spherex_qr2')
    download=sub.add_parser('download');download.add_argument('--url',required=True);download.add_argument('--ra',required=True,type=float)
    download.add_argument('--dec',required=True,type=float);download.add_argument('--size',type=float,default=10.)
    download.add_argument('--output',required=True)
    args=p.parse_args(argv)
    try:
        if args.command=='verify-data':
            print(report_json({'verified':verify_data()}));return 0
        if args.command=='inspect':
            print(report_json(load_epoch(args.fits).summary()));return 0
        if args.command=='search':
            print(report_json(search_observations(args.ra,args.dec,args.radius,args.collection)));return 0
        if args.command=='download':
            record=download_cutout(args.url,args.output,args.ra,args.dec,args.size)
            Path(str(args.output)+'.provenance.json').write_text(report_json(record))
            print(report_json(record));return 0
        if not args.a or not args.b:raise DataError('Specify both --a and --b FITS paths.')
        ra,rb=Path(args.a).read_bytes(),Path(args.b).read_bytes()
        calibration=Path(args.calibration).read_bytes() if args.calibration else None
        a,b=load_epoch(ra,calibration),load_epoch(rb,calibration)
        config=Config(args.threshold,args.min_area,args.wave_tolerance,False,not args.no_background,not args.no_psf)
        out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
        report,_=compatibility(a,b,config)
        (out/'compatibility.json').write_text(report_json(report))
        if report['blockers']:
            print('Comparison blocked: '+' '.join(report['blockers']),file=sys.stderr);return 2
        c=compare(a,b,config);regions=detect_regions(c,a.wcs,config.threshold,config.min_area)
        archive,report=export_run(a,b,c,regions,config)
        (out/'planetx_run.zip').write_bytes(archive);(out/'report.json').write_text(report_json(report))
        (out/'difference.png').write_bytes(png(c.difference,'B − A',diverging=True,regions=regions))
        (out/'significance.png').write_bytes(png(c.significance,'Local S',unit='local S',diverging=True,regions=regions))
        labels=(a.obs_id,b.obs_id)
        (out/'blink.gif').write_bytes(blink_gif(c.aligned_a,c.aligned_b,labels=labels))
        print(f'Completed: {len(regions)} residual regions; {c.valid.sum()} valid pixels. Outputs: {out.resolve()}')
        return 0
    except (DataError,OSError,ValueError) as exc:
        print(f'Planet X: {exc}',file=sys.stderr);return 2


if __name__=='__main__':sys.exit(main())
