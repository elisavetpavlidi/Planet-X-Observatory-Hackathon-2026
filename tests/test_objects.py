from io import BytesIO,StringIO
import json
from pathlib import Path
import numpy as np
import pytest
from astropy.table import Table
from planetx.data import load_epoch,DataError
from tests.fixtures.synthetic import make_synthetic_pair
from planetx.tracking import track_selection,registered_view
from planetx import services


def test_object_track_distinguishes_motion_from_static_source():
    ra,rb,_=make_synthetic_pair();epochs=[load_epoch(ra),load_epoch(rb)]
    moving=track_selection(epochs,{'frame':0,'x':29,'y':40})
    static=track_selection(epochs,{'frame':0,'x':17,'y':19})
    assert moving['status']=='possible_motion' and moving['displacement_arcsec']>50
    assert static['status']=='no_resolved_motion'


def test_invalid_selected_source_is_not_reported_as_motion():
    ra,rb,_=make_synthetic_pair();epochs=[load_epoch(ra),load_epoch(rb)]
    result=track_selection(epochs,{'frame':0,'x':0,'y':0})
    assert result['status']=='insufficient' and not result['measurements']


def test_wavelength_mismatch_downgrades_motion():
    ra,rb,_=make_synthetic_pair(mismatch=True);epochs=[load_epoch(ra),load_epoch(rb)]
    result=track_selection(epochs,{'frame':0,'x':29,'y':40})
    assert result['status']=='uncertain' and not result['spectral_compatible']


def test_display_registration_masks_invalid_support():
    ra,rb,_=make_synthetic_pair();a,b=load_epoch(ra),load_epoch(rb)
    image,coverage=registered_view(a,b)
    assert image.shape==a.image.shape and .8<coverage<1
    assert np.isnan(image).any()


def test_most_parser_and_automatic_sampling(monkeypatch):
    table=Table({'uri':['https://irsa.ipac.caltech.edu/ibe/data/spherex/test.fits']*6,
                 'ra_obj':np.arange(6)+10.,'dec_obj':[20.]*6,'mjd_start':np.arange(6)+60000.,
                 'observationid':[f'obs{i}' for i in range(6)],'instrument':['D6']*6})
    out=StringIO();table.write(out,format='ascii.ipac')
    calls=[]
    def get(url,params=None,**kwargs):calls.append(params);return out.getvalue().encode()
    monkeypatch.setattr(services,'_get',get);services.moving_observations.cache_clear()
    rows=services.moving_observations('4','2025-08-01','2025-08-08')
    selected=services.sample_observations(rows,4)
    assert len(selected)==4 and selected[0]['mjd']==60000 and selected[-1]['mjd']==60005
    assert calls[0]['catalog']=='spherex' and calls[0]['obj_name']=='20000004'


def test_named_planet_uses_documented_most_naif_mode(monkeypatch):
    out=StringIO();Table({'uri':[],'ra_obj':[],'dec_obj':[],'mjd_start':[]}).write(out,format='ascii.ipac')
    calls=[]
    monkeypatch.setattr(services,'_get',lambda url,params=None,**kwargs:(calls.append(params) or out.getvalue().encode()))
    services.moving_observations.cache_clear()
    assert services.moving_observations('Neptune','2025-08-01','2025-08-02')==[]
    assert calls[0]['input_type']=='naifid_input' and calls[0]['obj_naifid']==899


def test_live_most_relative_uri_and_generic_instrument_are_normalized(monkeypatch):
    table=Table({'uri':['ibe/data/spherex/qr2/level2/testD6_example.fits'],'ra_obj':[10.],
                 'dec_obj':[20.],'mjd_start':[60000.],'observationid':['test'],'instrument':['SPHEREx']})
    out=StringIO();table.write(out,format='ascii.ipac')
    monkeypatch.setattr(services,'_get',lambda *args,**kwargs:out.getvalue().encode())
    services.moving_observations.cache_clear()
    rows=services.moving_observations('4','2025-08-01','2025-08-31')
    assert rows[0]['access_url'].startswith('https://irsa.ipac.caltech.edu/ibe/')
    assert rows[0]['detector']=='D6'


def test_simbad_candidates_rank_at_epoch_and_not_as_confirmed(monkeypatch):
    payload={'metadata':[{'name':n} for n in ['main_id','ra','dec','otype','pmra','pmdec']],
             'data':[['Test galaxy',10.,20.,'G',None,None],['Far away',11.,20.,'G',None,None]]}
    monkeypatch.setattr(services,'_get',lambda *args,**kwargs:json.dumps(payload).encode())
    services.simbad_cone.cache_clear();rows=services.simbad_cone(10.,20.,60000.)
    assert len(rows)==1 and rows[0]['association']=='positional candidate'


def test_jpl_identification_sends_observation_and_spacecraft_state(monkeypatch):
    captured=[]
    payload={'signature':{'version':'1.1'},'fields_second':['Object name','Astrometric RA (hh:mm:ss)','Astrometric Dec (dd mm\'ss")'],
             'data_second_pass':[['4 Vesta','00:40:00','+20 00\'00.0"']]}
    def get(url,params=None,**kwargs):captured.append(params);return json.dumps(payload).encode()
    monkeypatch.setattr(services,'_get',get);services.identify_small_bodies.cache_clear()
    rows=services.identify_small_bodies(10.,20.,60000.,(7000.,0.,0.))
    assert rows and rows[0]['name']=='4 Vesta'
    assert captured[0]['xobs'].startswith('7000.') and captured[0]['two-pass']=='true'
    assert captured[0]['obs-time'].startswith('2460000.5')


def test_jpl_schema_changes_stop_identification(monkeypatch):
    monkeypatch.setattr(services,'_get',lambda *args,**kwargs:b'{"signature":{"version":"999"}}')
    services.identify_small_bodies.cache_clear()
    with pytest.raises(DataError,match='μορφή'):services.identify_small_bodies(10.,20.,60000.,(7000.,0.,0.))


@pytest.mark.parametrize('version',['1.2','1.3'])
def test_horizons_observed_and_documented_vector_schemas(monkeypatch,version):
    from astropy.coordinates import SkyCoord
    from astropy import units as u
    vector=np.array([-1.061168802247255E8,9.947669370047641E7,4.312160817452788E7])-np.array([7000.,0,0])
    p=SkyCoord(x=vector[0]*u.km,y=vector[1]*u.km,z=vector[2]*u.km,representation_type='cartesian',frame='icrs').spherical
    payload={'signature':{'version':version},'result':'$$SOE\n2460894.470500000, A.D. 2025-Aug-06 23:17:31.2000, -1.061168802247255E+08, 9.947669370047641E+07, 4.312160817452788E+07,\n$$EOE'}
    monkeypatch.setattr(services,'_get',lambda *args,**kwargs:json.dumps(payload).encode())
    services.major_body_candidates.cache_clear()
    result=services.major_body_candidates(float(p.lon.deg),float(p.lat.deg),60893.9705,(7000.,0.,0.))
    assert any(r['name']=='Sun' and r['source']=='NASA/JPL Horizons' for r in result)


def test_datalink_only_uses_official_this_fits(monkeypatch):
    table=Table({'access_url':['https://evil.example/x.fits','https://irsa.ipac.caltech.edu/ibe/data/spherex/example.fits'],
                 'semantics':['#this','#this']})
    out=BytesIO();table.write(out,format='votable')
    monkeypatch.setattr(services,'_get',lambda *args,**kwargs:out.getvalue())
    resolved=services.resolve_fits_url('https://irsa.ipac.caltech.edu/datalink/links/spherex?ID=test')
    assert resolved=='https://irsa.ipac.caltech.edu/ibe/data/spherex/example.fits'
    with pytest.raises(DataError):services.resolve_fits_url('https://evil.example/data.fits')


def test_ned_parser_uses_semantic_field_names(monkeypatch):
    raw=b'''<VOTABLE version="1.3" xmlns="http://www.ivoa.net/xml/VOTable/v1.3"><RESOURCE><TABLE>
    <FIELD ID="obj" name="Object Name" datatype="char" arraysize="*"/>
    <FIELD ID="x" name="RA" datatype="double"/><FIELD ID="y" name="DEC" datatype="double"/>
    <FIELD ID="t" name="Type" datatype="char" arraysize="*"/>
    <DATA><TABLEDATA><TR><TD>M31</TD><TD>10.6847</TD><TD>41.2688</TD><TD>G</TD></TR></TABLEDATA></DATA>
    </TABLE></RESOURCE></VOTABLE>'''
    monkeypatch.setattr(services,'_get',lambda *args,**kwargs:raw)
    services.ned_cone.cache_clear();rows=services.ned_cone(10.6847,41.2688)
    assert rows[0]['name']=='M31' and rows[0]['source']=='NASA/IPAC NED'


def test_window_limits_stop_unbounded_requests():
    with pytest.raises(DataError):services._validate_window('2025-01-01','2026-01-01')
    with pytest.raises(DataError):services._validate_window('2025-01-02','2025-01-01')


def test_real_comet_fixture_has_predicted_not_confirmed_positions():
    root=Path(__file__).resolve().parents[1]
    record=json.loads((root/'data/comet_3i/pair.json').read_text())
    for frame in record['frames']:
        epoch=load_epoch(root/frame['path'])
        assert epoch.checksum==frame['sha256'] and not epoch.synthetic
        assert 'prediction' in frame['position_source']
