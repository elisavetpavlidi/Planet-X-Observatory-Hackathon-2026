from io import BytesIO
from pathlib import Path
import json
import zipfile
import numpy as np
import pytest
from astropy.io import fits
from scipy.ndimage import map_coordinates, convolve

from planetx.data import load_epoch, DataError
from tests.fixtures.synthetic import make_synthetic_pair
from planetx.processing import compare,compatibility,Config
from planetx.detection import detect_regions
from planetx.export import export_run
from planetx.cli import verify_data
from planetx.archive import cutout_url

ROOT=Path(__file__).resolve().parents[1]


def mutate(raw,fn):
    with fits.open(BytesIO(raw)) as hdus:
        fn(hdus);out=BytesIO();hdus.writeto(out)
    return out.getvalue()


def test_real_manifest_masks_noise_and_wavelength_translation():
    summaries=verify_data()
    assert [s['good_pixels'] for s in summaries[:2]]==[8044,9131]
    assert summaries[0]['median_sigma']==pytest.approx(.105163997,abs=1e-8)
    assert summaries[1]['median_sigma']==pytest.approx(.080119550,abs=1e-8)
    a=load_epoch(ROOT/'data/reference/m31/observation_A.fits')
    b=load_epoch(ROOT/'data/reference/m31/observation_B.fits')
    # Independent wcslib table evaluation checks cutout/native translation.
    from astropy.wcs import WCS
    with fits.open(ROOT/'data/reference/m31/observation_A.fits') as hdus:
        h=hdus['IMAGE'].header.copy()
        for key in list(h):
            if key.startswith(('A_','B_','AP_','BP_')):del h[key]
        w=WCS(h,hdus,key='W',naxis=2)
        wavelength,_=w.all_pix2world([[48.,48.]],0)[0]
    assert a.wavelength[48,48]==pytest.approx(wavelength,abs=1e-7)
    assert a.wavelength[48,48]==pytest.approx(2.442,abs=.003)
    report,_=compatibility(a,b)
    assert report['sky_coverage_fraction']>.7
    assert report['blockers']
    assert report['wave_offset_in_bandwidths']>.5


def test_moving_injection_recovery_and_export_wcs():
    ra,rb,truth=make_synthetic_pair();a,b=load_epoch(ra),load_epoch(rb)
    result=compare(a,b);regions=detect_regions(result,a.wcs)
    positive=[c for c in regions if c['peak_local_s']>0];negative=[c for c in regions if c['peak_local_s']<0]
    assert any(np.hypot(c['x']-38,c['y']-35)<2 for c in positive)
    assert any(np.hypot(c['x']-29,c['y']-40)<2 for c in negative)
    assert len(regions)==2
    archive,report=export_run(a,b,result,regions,Config())
    with zipfile.ZipFile(BytesIO(archive)) as z:
        assert json.loads(z.read('report.json'))['a']['sha256']==a.checksum
        with fits.open(BytesIO(z.read('comparison.fits'))) as h:
            assert np.array_equal(h['VALID'].data.astype(bool),result.valid)
            assert np.isnan(h['DIFFERENCE'].data[~result.valid]).all()
            assert h['DIFFERENCE'].header['CTYPE1'].startswith('RA')


@pytest.mark.parametrize('seed',[17,42,101])
def test_static_sky_null_control(seed):
    ra,rb,_=make_synthetic_pair(seed,motion=False);a,b=load_epoch(ra),load_epoch(rb)
    result=compare(a,b)
    assert not detect_regions(result,a.wcs,threshold=5,min_area=3)
    s=result.significance[result.valid]
    assert abs(np.median(s))<.3
    assert .7<np.std(s)<1.3


@pytest.mark.parametrize('kwargs,reason',[({'mismatch':True},'Wavelength mismatch'),({'bad_wcs':True},'coverage')])
def test_incompatible_pair_is_blocked(kwargs,reason):
    ra,rb,_=make_synthetic_pair(**kwargs);a,b=load_epoch(ra),load_epoch(rb)
    with pytest.raises(DataError,match=reason):compare(a,b)


def test_same_epoch_and_mixed_provenance_blocked():
    ra,rb,_=make_synthetic_pair();a=load_epoch(ra)
    assert compatibility(a,a)[0]['blockers']
    b=load_epoch(rb);b.synthetic=False
    assert any('mixed' in t or 'mixed' in t.lower() or 'mix' in t for t in compatibility(a,b)[0]['blockers'])


@pytest.mark.parametrize('fn,match',[
    (lambda h:h.__delitem__('VARIANCE'),'VARIANCE'),
    (lambda h:h['IMAGE'].header.__delitem__('BUNIT'),'BUNIT'),
    (lambda h:h['VARIANCE'].data.fill(0),'No valid'),
    (lambda h:h['IMAGE'].data.fill(np.nan),'No valid'),
    (lambda h:h['IMAGE'].header.__delitem__('MJD-OBS'),'MJD-OBS'),
    (lambda h:h['IMAGE'].header.__setitem__('BUNIT','Jy'),'BUNIT')])
def test_malformed_inputs_have_actionable_errors(fn,match):
    raw,_,_=make_synthetic_pair()
    with pytest.raises(DataError,match=match):load_epoch(mutate(raw,fn))


def test_changed_flags_rebuild_mask_not_stale_npz():
    raw,_,_=make_synthetic_pair();a=load_epoch(raw)
    new=mutate(raw,lambda h:h['FLAGS'].data.__setitem__((30,30),1<<10))
    b=load_epoch(new)
    assert a.checksum!=b.checksum
    assert a.good[30,30] and not b.good[30,30]
    new=mutate(raw,lambda h:h['FLAGS'].data.__setitem__((30,30),1<<21))
    assert load_epoch(new).good[30,30]


def test_variance_against_independent_monte_carlo():
    # MC reference uses scipy interpolation+convolution, not pipeline operators.
    ra,rb,_=make_synthetic_pair(shape=(32,32),shift=(.5,.25),motion=False)
    a,b=load_epoch(ra),load_epoch(rb)
    result=compare(a,b,Config(subtract_background=False))
    rng=np.random.default_rng(213);n=500
    coords=np.arange(-6,7);yy,xx=np.meshgrid(coords,coords,indexing='ij')
    def kernel(sig):
        k=np.exp(-(xx**2+yy**2)/(2*sig**2));return k/k.sum()
    ya,xa=np.indices(a.image.shape,dtype=float)
    simulated=[]
    for _ in range(n):
        na=rng.normal(0,.055,a.image.shape);nb=rng.normal(0,.07,b.image.shape)
        aligned=map_coordinates(nb,[ya+.25,xa+.5],order=1,mode='constant',cval=0)
        simulated.append(convolve(aligned,kernel(1.15),mode='constant')[16,16]-convolve(na,kernel(1.45),mode='constant')[16,16])
    assert np.var(simulated,ddof=1)==pytest.approx(result.variance[16,16],rel=.15)


@pytest.mark.parametrize('url',['http://irsa.ipac.caltech.edu/ibe/data/spherex/x.fits','https://localhost/x.fits','https://irsa.ipac.caltech.edu.evil.example/x.fits','https://irsa.ipac.caltech.edu/secret.fits'])
def test_non_irsa_downloads_rejected(url):
    with pytest.raises(DataError):cutout_url(url,10.,40.)


def test_good_cutout_url_and_deterministic_scenario():
    url=cutout_url('https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/example.fits',10.,40.,10.)
    assert 'center=10.' in url and 'size=0.16666667' in url
    ra,rb,_=make_synthetic_pair();a,b=load_epoch(ra),load_epoch(rb)
    ra2,rb2,_=make_synthetic_pair();a2,b2=load_epoch(ra2),load_epoch(rb2)
    assert np.array_equal(a.image,a2.image) and np.array_equal(b.image,b2.image)
    assert ra==ra2 and rb==rb2


def test_spectral_calibration_detector_crop_and_provenance():
    raw,_,_=make_synthetic_pair(shape=(24,24))
    def native_header(h):
        h['IMAGE'].header['SYNTHET']=False
        h['IMAGE'].header['CRPIX1A']=-3
        h['IMAGE'].header['CRPIX2A']=-4
    raw=mutate(raw,native_header)
    wave=np.arange(40*40,dtype=float).reshape(40,40)/1000+2
    primary=fits.PrimaryHDU();primary.header['DETECTOR']=4
    cw=fits.ImageHDU(wave,name='CWAVE');cw.header['BUNIT']='um'
    cb=fits.ImageHDU(np.full((40,40),.1),name='CBAND');cb.header['BUNIT']='um'
    out=BytesIO();fits.HDUList([primary,cw,cb]).writeto(out)
    e=load_epoch(raw,out.getvalue())
    assert np.array_equal(e.wavelength,wave[5:29,4:28])
    assert e.calibration_checksum and e.wave_quality=='CWAVE/CBAND calibration supplied'
    primary.header['DETECTOR']=5;out=BytesIO();fits.HDUList([primary,cw,cb]).writeto(out)
    with pytest.raises(DataError,match='DETECTOR'):load_epoch(raw,out.getvalue())


def test_sia_uses_field_names_not_generic_ids(monkeypatch):
    from planetx.archive import search_observations
    xml=b'''<?xml version="1.0"?><VOTABLE version="1.3" xmlns="http://www.ivoa.net/xml/VOTable/v1.3"><RESOURCE type="results"><TABLE>
    <FIELD ID="col_0" name="obs_id" datatype="char" arraysize="*"/>
    <FIELD ID="col_1" name="access_url" datatype="char" arraysize="*"/>
    <DATA><TABLEDATA><TR><TD>example</TD><TD>https://irsa.ipac.caltech.edu/ibe/data/spherex/example.fits</TD></TR></TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>'''
    class Response:
        def raise_for_status(self):pass
        def iter_content(self,*args):yield xml
    monkeypatch.setattr('requests.get',lambda *args,**kwargs:Response())
    rows=search_observations(10.,40.)
    assert rows[0]['obs_id']=='example' and rows[0]['access_url'].startswith('https://irsa.')


@pytest.mark.parametrize('field',['pleiades','m101'])
def test_independent_real_fields_load_and_reject_spectral_mismatch(field):
    a=load_epoch(ROOT/f'data/validation/{field}_A.fits')
    b=load_epoch(ROOT/f'data/validation/{field}_B.fits')
    report,_=compatibility(a,b)
    assert a.good.sum()>5000 and b.good.sum()>5000
    assert report['sky_coverage_fraction']>.9
    assert report['spectral_pass_fraction']==0
    assert any('Wavelength mismatch' in msg for msg in report['blockers'])


def test_invalid_wavelength_does_not_create_non_json_report():
    ra,rb,_=make_synthetic_pair()
    rb=mutate(rb,lambda h:h['CWAVE'].data.fill(np.nan))
    a,b=load_epoch(ra),load_epoch(rb)
    report,_=compatibility(a,b)
    assert b.wavelength is None and report['blockers']
    json.dumps(report,allow_nan=False)
