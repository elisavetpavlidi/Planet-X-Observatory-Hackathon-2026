"""Write a quality report from the original SPHEREx reference FITS; no network."""
from pathlib import Path
import argparse
import sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from planetx.data import load_epoch
from planetx.processing import compatibility
from planetx.export import report_json
from planetx.visualization import png
from planetx import __version__

def main():
    root=Path(__file__).resolve().parents[1]
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--a',default=str(root/'data/reference/m31/observation_A.fits'))
    parser.add_argument('--b',default=str(root/'data/reference/m31/observation_B.fits'))
    parser.add_argument('--output',default=str(root/'outputs/science-report'))
    args=parser.parse_args()
    epochs=[load_epoch(args.a),load_epoch(args.b)]
    report,_=compatibility(*epochs)
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    (out/'quality.json').write_text(report_json({'version':__version__,'epochs':[e.summary() for e in epochs],'compatibility':report}),encoding='utf-8')
    for label,epoch in zip(['A','B'],epochs):
        (out/f'quality_{label}.png').write_bytes(png(np.where(epoch.good,epoch.image,np.nan),f'SPHEREx {label} · quality mask',wcs=epoch.wcs))
        (out/f'noise_{label}.png').write_bytes(png(np.where(epoch.good,np.sqrt(epoch.variance),np.nan),f'SPHEREx {label} · 1-sigma noise',wcs=epoch.wcs))
    print(f'Quality report written to {out.resolve()}.')
    print('Temporal comparison: '+('blocked — '+' '.join(report['blockers']) if report['blockers'] else 'compatible under the stated policy'))
if __name__=='__main__':main()
