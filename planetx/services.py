"""Bounded public-service access. No background crawling and no browser API embedding."""
from __future__ import annotations
from io import BytesIO
from functools import lru_cache
from threading import Lock
from urllib.parse import urlparse, urlencode
from datetime import date
import json
import re
import numpy as np
import requests
from astropy.table import Table
from astropy.io.votable import parse_single_table
from astropy.coordinates import SkyCoord
from astropy.time import Time
from astropy import units as u
from .data import DataError, load_epoch, MAX_BYTES
from .archive import cutout_url, search_observations

AGENT={'User-Agent':'PlanetXExplorer/0.2 (+https://github.com/elisavetpavlidi)'}
JPL_LOCK=Lock()
MAJOR_BODIES={'mercury':199,'venus':299,'mars':499,'jupiter':599,'saturn':699,'uranus':799,
              'neptune':899,'pluto':999,'moon':301,'sun':10}
PLANET_ALIASES={'ερμής':'mercury','αφροδίτη':'venus','άρης':'mars','δίας':'jupiter','κρόνος':'saturn',
                'ουρανός':'uranus','ποσειδώνας':'neptune','πλούτωνας':'pluto','σελήνη':'moon','ήλιος':'sun'}


def _get(url,params=None,limit=8*1024*1024,timeout=45):
    try:
        with requests.get(url,params=params,headers=AGENT,timeout=(10,timeout),stream=True) as r:
            if r.status_code in (429,503):
                raise DataError('Η υπηρεσία είναι προσωρινά απασχολημένη. Τα έτοιμα παραδείγματα παραμένουν διαθέσιμα· δοκίμασε αργότερα.')
            r.raise_for_status();chunks=[];size=0
            for block in r.iter_content(65536):
                size+=len(block)
                if size>limit:raise DataError('Η απάντηση υπερβαίνει το όριο. Επίλεξε μικρότερο χρονικό διάστημα ή πεδίο.')
                chunks.append(block)
            return b''.join(chunks)
    except DataError:raise
    except requests.RequestException as exc:
        raise DataError('Η online υπηρεσία δεν απάντησε. Μπορείς να συνεχίσεις με τα έτοιμα δεδομένα.') from exc


def _validate_window(start,end):
    try:
        a,b=date.fromisoformat(str(start)),date.fromisoformat(str(end))
    except ValueError as exc:raise DataError('Οι ημερομηνίες πρέπει να είναι YYYY-MM-DD.') from exc
    if not 0<(b-a).days<=31:raise DataError('Επίλεξε χρονικό διάστημα 1–31 ημερών.')
    return str(a),str(b)


def resolve_fits_url(url):
    """Follow only an official SPHEREx DataLink record, then select its #this FITS."""
    p=urlparse(str(url))
    if p.scheme!='https' or p.hostname!='irsa.ipac.caltech.edu':
        raise DataError('Το αρχείο πρέπει να προέρχεται από το επίσημο IRSA.')
    if p.path.startswith('/ibe/data/spherex/') and p.path.endswith('.fits'):return str(url)
    if not p.path.startswith('/datalink/links/spherex'):
        raise DataError('Μη υποστηριζόμενος σύνδεσμος SPHEREx.')
    table=parse_single_table(BytesIO(_get(str(url),limit=2*1024*1024))).to_table(use_names_over_ids=True)
    for row in table:
        if 'access_url' not in table.colnames:break
        candidate=str(row['access_url'])
        semantics=str(row['semantics']) if 'semantics' in table.colnames else ''
        if candidate.split('?')[0].endswith('.fits') and semantics in ('#this','http://www.ivoa.net/rdf/datalink/core#this',''):
            cp=urlparse(candidate)
            if cp.scheme=='https' and cp.hostname=='irsa.ipac.caltech.edu' and cp.path.startswith('/ibe/data/spherex/'):
                return candidate
    raise DataError('Το DataLink δεν επέστρεψε άμεσα προσβάσιμο πλήρες FITS.')


@lru_cache(maxsize=12)
def fetch_cutout_bytes(url,ra,dec,size_arcmin=10.):
    resolved=resolve_fits_url(url)
    final=cutout_url(resolved,float(ra),float(dec),float(size_arcmin))
    raw=_get(final,limit=MAX_BYTES,timeout=60)
    epoch=load_epoch(raw)
    return raw,{'access_url':final,'sha256':epoch.checksum,'obs_id':epoch.obs_id}


@lru_cache(maxsize=16)
def moving_observations(name,start,end):
    """IRSA MOST computes the trajectory and locates actual intersecting SPHEREx exposures."""
    start,end=_validate_window(start,end)
    name=str(name).strip()
    if not name or len(name)>100 or any(c in name for c in '\r\n'):
        raise DataError('Δώσε όνομα ή αριθμό αντικειμένου, π.χ. 3I/ATLAS ή 4.')
    canonical=PLANET_ALIASES.get(name.lower(),name.lower())
    params={'catalog':'spherex','input_type':'name_input','obj_name':name,
            'obs_begin':start,'obs_end':end,'output_mode':'Brief'}
    if name.lower() in ('vesta','4 vesta','4','εστία'):
        params['obj_name']='20000004'  # Unambiguous Vesta identifier in IRSA's official tutorial.
    if canonical in MAJOR_BODIES:
        params.pop('obj_name');params.update(input_type='naifid_input',obj_naifid=MAJOR_BODIES[canonical])
    raw=_get('https://irsa.ipac.caltech.edu/cgi-bin/MOST/nph-most',params,limit=16*1024*1024,timeout=60)
    text=raw.decode('utf8',errors='replace')
    try:table=Table.read(text,format='ascii.ipac')
    except Exception as exc:raise DataError('Το MOST δεν αναγνώρισε μοναδικό αντικείμενο ή δεν επέστρεψε πίνακα. Δοκίμασε ακριβή ονομασία/αριθμό.') from exc
    rows=[]
    for row in table:
        if not all(k in table.colnames for k in ('uri','ra_obj','dec_obj','mjd_start')):
            raise DataError('Η μορφή του MOST άλλαξε· χρειάζεται έλεγχος του πίνακα.')
        url=str(row['uri'])
        # MOST returns a direct public URI for its SPHEREx rows.
        if url.startswith('ivo://'):
            url='https://irsa.ipac.caltech.edu/datalink/links/spherex?'+urlencode({'ID':url})
        elif url.startswith(('ibe/data/spherex/','/ibe/data/spherex/')):
            url='https://irsa.ipac.caltech.edu/'+url.lstrip('/')
        match=re.search(r'D([1-6])_',url)
        detector='D'+match.group(1) if match else str(row['instrument'])
        rows.append({'obs_id':str(row['observationid']),'access_url':url,
                     'ra_deg':float(row['ra_obj']),'dec_deg':float(row['dec_obj']),
                     'mjd':float(row['mjd_start']),'detector':detector,
                     'target_name':name,'position_source':'NASA/IPAC IRSA MOST prediction'})
    return rows


def sample_observations(rows,limit=4):
    """One detector, distinct exposures, a bounded evenly spaced time sample."""
    if not rows:raise DataError('Δεν βρέθηκαν διαθέσιμες SPHEREx παρατηρήσεις σε αυτό το χρονικό διάστημα.')
    detectors=sorted(set(r.get('detector','unknown') for r in rows))
    best=max(detectors,key=lambda d:(len({r['obs_id'] for r in rows if r.get('detector','unknown')==d}),d.endswith('6')))
    chosen=[];seen=set()
    for row in sorted(rows,key=lambda r:r['mjd']):
        if row.get('detector','unknown')!=best or row['obs_id'] in seen:continue
        seen.add(row['obs_id']);chosen.append(row)
    indices=np.unique(np.linspace(0,len(chosen)-1,min(limit,len(chosen))).round().astype(int))
    return [chosen[i] for i in indices]


@lru_cache(maxsize=64)
def simbad_cone(ra,dec,mjd,radius_arcsec=18.):
    """Possible catalog associations, including a propagated proper-motion estimate."""
    if not (np.isfinite([ra,dec,mjd]).all() and 0<=ra<360 and -90<=dec<=90 and 1<=radius_arcsec<=120):
        raise DataError('Μη έγκυρες συντεταγμένες καταλόγου.')
    # Wider initial search, then rank at observation time. Not a complete high-PM catalog search.
    radius=max(radius_arcsec,60.)/3600
    query=(f"SELECT TOP 60 main_id,ra,dec,otype,pmra,pmdec FROM basic WHERE "
           f"1=CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',{ra:.10f},{dec:.10f},{radius:.10f}))")
    payload=json.loads(_get('https://simbad.cds.unistra.fr/simbad/sim-tap/sync',
                           {'REQUEST':'doQuery','LANG':'ADQL','FORMAT':'json','QUERY':query},timeout=15))
    names=[m['name'] for m in payload.get('metadata',[])]
    center=SkyCoord(ra*u.deg,dec*u.deg);out=[]
    for values in payload.get('data',[]):
        r=dict(zip(names,values));x=float(r['ra']);y=float(r['dec'])
        pmra=r.get('pmra');pmdec=r.get('pmdec');propagated=False
        if pmra is not None and pmdec is not None and abs(np.cos(np.deg2rad(y)))>.001:
            dt=(float(mjd)-51544.5)/365.25
            x=(x+float(pmra)*dt/(3.6e6*np.cos(np.deg2rad(y))))%360
            y=y+float(pmdec)*dt/3.6e6;propagated=True
        distance=float(center.separation(SkyCoord(x*u.deg,y*u.deg)).arcsec)
        if distance<=radius_arcsec:
            out.append({'name':str(r['main_id']),'type':str(r.get('otype','unknown')),'ra_deg':x,'dec_deg':y,
                        'separation_arcsec':distance,'source':'SIMBAD / CDS','association':'positional candidate',
                        'proper_motion_propagated':propagated})
    return sorted(out,key=lambda r:r['separation_arcsec'])[:8]


@lru_cache(maxsize=48)
def major_body_candidates(ra,dec,mjd,position_km):
    """Cheap local prefilter, followed by NASA/JPL astrometric vector checks."""
    from astropy.coordinates import get_body_barycentric
    from astropy.constants import c as speed_of_light
    t=Time(mjd,format='mjd',scale='utc')
    observer=get_body_barycentric('earth',t).xyz.to_value(u.km)+np.asarray(position_km,float)
    center=SkyCoord(ra*u.deg,dec*u.deg);out=[]
    for name,code in MAJOR_BODIES.items():
        if name=='pluto':continue  # ERFA builtin has no Pluto; named MOST search still supports it.
        emitted=t
        for _ in range(3):
            vector=get_body_barycentric(name,emitted).xyz.to_value(u.km)-observer
            emitted=t-(np.linalg.norm(vector)/speed_of_light.to_value(u.km/u.s))*u.s
        predicted=SkyCoord(x=vector[0]*u.km,y=vector[1]*u.km,z=vector[2]*u.km,representation_type='cartesian',frame='icrs').spherical
        if center.separation(SkyCoord(predicted.lon,predicted.lat)).arcsec>180:continue
        params={'format':'json','COMMAND':f"'{code}'",'CENTER':"'500@399'",'EPHEM_TYPE':"'VECTORS'",
                'TLIST':f"'{float(mjd):.9f}'",'TLIST_TYPE':"'MJD'",'TIME_TYPE':"'UT'",'REF_PLANE':"'FRAME'",
                'VEC_CORR':"'LT'",'OUT_UNITS':"'KM-S'",'VEC_TABLE':"'1'",'CSV_FORMAT':"'YES'",'OBJ_DATA':"'NO'"}
        with JPL_LOCK:payload=json.loads(_get('https://ssd.jpl.nasa.gov/api/horizons.api',params))
        # Current public endpoint returned 1.2 during live validation; the
        # documentation also specifies 1.3. Both use this tested CSV vector schema.
        if payload.get('signature',{}).get('version') not in ('1.2','1.3'):
            raise DataError('Άλλαξε η μορφή του Horizons· χρειάζεται έλεγχος.')
        result=payload.get('result','')
        if '$$SOE' not in result:continue
        line=next((v.strip() for v in result.split('$$SOE')[1].split('$$EOE')[0].splitlines() if v.strip()),'')
        parts=[p.strip() for p in line.split(',')]
        if len(parts)<5:continue
        vector=np.array([float(p) for p in parts[2:5]])-np.asarray(position_km,float)
        sphere=SkyCoord(x=vector[0]*u.km,y=vector[1]*u.km,z=vector[2]*u.km,representation_type='cartesian',frame='icrs').spherical
        coord=SkyCoord(sphere.lon,sphere.lat);separation=float(center.separation(coord).arcsec)
        if separation<20:
            out.append({'name':name.title(),'type':'planet' if name not in ('sun','moon') else ('star' if name=='sun' else 'natural satellite'),
                        'ra_deg':float(coord.ra.deg),'dec_deg':float(coord.dec.deg),'separation_arcsec':separation,
                        'source':'NASA/JPL Horizons','association':'predicted positional candidate; spacecraft position adjusted'})
    return out


@lru_cache(maxsize=32)
def resolve_fixed_name(name):
    name=str(name).strip()
    if not name or len(name)>100:raise DataError('Δώσε μια σύντομη ακριβή ονομασία.')
    escaped=name.replace("'","''")
    query=f"SELECT TOP 5 b.main_id,b.ra,b.dec,b.otype FROM basic AS b JOIN ident AS i ON b.oid=i.oidref WHERE i.id='{escaped}'"
    try:
        payload=json.loads(_get('https://simbad.cds.unistra.fr/simbad/sim-tap/sync',
                                {'REQUEST':'doQuery','LANG':'ADQL','FORMAT':'json','QUERY':query},timeout=15))
    except DataError:
        return resolve_ned_name(name)
    names=[m['name'] for m in payload.get('metadata',[])]
    rows=[dict(zip(names,row)) for row in payload.get('data',[])]
    if not rows:raise DataError('Δεν βρέθηκε αυτή η ονομασία στον SIMBAD. Δοκίμασε συντεταγμένες ή αναζήτηση Ηλιακού Συστήματος.')
    return {'name':rows[0]['main_id'],'ra_deg':float(rows[0]['ra']),'dec_deg':float(rows[0]['dec']),'type':rows[0]['otype']}


def _ned_table(params):
    raw=_get('https://ned.ipac.caltech.edu/cgi-bin/objsearch',params,timeout=15)
    try:return parse_single_table(BytesIO(raw)).to_table(use_names_over_ids=True)
    except Exception as exc:raise DataError('Το NED δεν επέστρεψε αναγνώσιμο αποτέλεσμα.') from exc


@lru_cache(maxsize=48)
def ned_cone(ra,dec,radius_arcsec=18.):
    from astroquery.ipac.ned import Ned
    center=SkyCoord(float(ra)*u.deg,float(dec)*u.deg)
    params=Ned.query_region_async(center,radius=radius_arcsec*u.arcsec,get_query_payload=True)
    table=_ned_table(params);result=[]
    for row in table:
        x,y=float(row['RA']),float(row['DEC'])
        distance=float(center.separation(SkyCoord(x*u.deg,y*u.deg)).arcsec)
        if distance<=radius_arcsec:
            result.append({'name':str(row['Object Name']),'type':str(row['Type']),
                           'ra_deg':x,'dec_deg':y,'separation_arcsec':distance,'source':'NASA/IPAC NED',
                           'association':'positional candidate'})
    return sorted(result,key=lambda r:r['separation_arcsec'])[:8]


@lru_cache(maxsize=32)
def resolve_ned_name(name):
    from astroquery.ipac.ned import Ned
    table=_ned_table(Ned.query_object_async(name,get_query_payload=True))
    if not len(table):raise DataError('Δεν βρέθηκε όνομα στο NED. Δοκίμασε συντεταγμένες.')
    row=table[0]
    return {'name':str(row['Object Name']),'ra_deg':float(row['RA']),'dec_deg':float(row['DEC']),'type':str(row['Type'])}


def fixed_observations(ra,dec,start,end):
    start,end=_validate_window(start,end)
    if not np.isfinite([ra,dec]).all() or not (0<=ra<360 and -90<=dec<=90):
        raise DataError('RA: 0–360°, Dec: −90–90°.')
    # SIA TIME is a server-side interval, so this is not filtering a truncated all-time subset.
    params={'COLLECTION':'spherex_qr2','POS':f'circle {float(ra)} {float(dec)} {0.1/60}',
            'TIME':f'{Time(start).mjd} {Time(end).mjd}','MAXREC':200}
    table=parse_single_table(BytesIO(_get('https://irsa.ipac.caltech.edu/SIA',params))).to_table(use_names_over_ids=True)
    rows=[]
    for row in table:
        if 'access_url' not in table.colnames:raise DataError('Δεν βρέθηκε σύνδεσμος αρχείου στο αποτέλεσμα IRSA.')
        url=str(row['access_url']);detector=str(row['spherex_detector']) if 'spherex_detector' in table.colnames else ''
        if not detector:
            m=re.search(r'D([1-6])',url);detector=m.group(1) if m else 'unknown'
        rows.append({'obs_id':str(row['obs_id']),'access_url':url,'mjd':float(row['t_min']),
                     'ra_deg':float(ra),'dec_deg':float(dec),'detector':detector,'position_source':'fixed sky field'})
    return rows


@lru_cache(maxsize=64)
def identify_small_bodies(ra,dec,mjd,position_km):
    """JPL identification at the actual observation time and supplied spacecraft position."""
    if len(position_km)!=3 or not np.isfinite(position_km).all():raise DataError('Λείπει η θέση του τηλεσκοπίου για τη συγκεκριμένη ημερομηνία.')
    coord=SkyCoord(ra*u.deg,dec*u.deg)
    ra_str=coord.ra.to_string(unit=u.hourangle,sep='-',precision=3,pad=True)
    dec_str=coord.dec.to_string(unit=u.deg,sep='-',precision=2,pad=True,alwayssign=True)
    dec_str=dec_str.replace('-','M',1) if dec_str.startswith('-') else dec_str.lstrip('+')
    params={'xobs':','.join(f'{float(x):.9f}' for x in position_km),'obs-time':f'{float(mjd)+2400000.5:.9f}',
            'fov-ra-center':ra_str,'fov-dec-center':dec_str,'fov-ra-hwidth':.015,'fov-dec-hwidth':.015,
            'two-pass':'true','suppress-first-pass':'true','mag-required':'false','req-elem':'false'}
    # One JPL call at a time, also across concurrent analysis sessions in this process.
    with JPL_LOCK:
        payload=json.loads(_get('https://ssd-api.jpl.nasa.gov/sb_ident.api',params,timeout=45))
    if payload.get('signature',{}).get('version')!='1.1':raise DataError('Η μορφή του JPL API άλλαξε· η ταυτοποίηση χρειάζεται έλεγχο.')
    fields=payload.get('fields_second',[]);out=[]
    for values in payload.get('data_second_pass',[]):
        row=dict(zip(fields,values))
        name=str(row.get('Object name','Unknown small body'))
        rah=next((row[k] for k in fields if k.startswith('Astrometric RA')),None)
        dech=next((row[k] for k in fields if k.startswith('Astrometric Dec')),None)
        if rah is None or dech is None:continue
        cleaned=str(dech).replace("'",' ').replace('"',' ').replace('d',' ').replace('m',' ').replace('s',' ')
        c=SkyCoord(str(rah),cleaned,unit=(u.hourangle,u.deg))
        distance=float(c.separation(coord).arcsec)
        if distance<=20:
            out.append({'name':name,'type':'comet / small body' if '/' in name else 'asteroid / small body',
                        'ra_deg':float(c.ra.deg),'dec_deg':float(c.dec.deg),'separation_arcsec':distance,
                        'source':'NASA/JPL SB Identification','association':'predicted positional candidate'})
    return sorted(out,key=lambda r:r['separation_arcsec'])[:8]
