import {gunzipSync} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {readFits,gridFor,alignWise,sourcePeaks,angularSeparation} from './science.mjs';

const IRSA='https://irsa.ipac.caltech.edu';
const AGENT='PlanetXObservatory/1.1.0 (+https://github.com/elisavetpavlidi)';
const cache=new Map();
function memo(key,fn){if(cache.has(key))return cache.get(key);const pending=fn().catch(e=>{cache.delete(key);throw e;});cache.set(key,pending);while(cache.size>32)cache.delete(cache.keys().next().value);return pending;}
export async function remote(url,limit=3e6,timeout=45000){
  const unavailable=message=>Object.assign(Error(message),{code:'UPSTREAM_UNAVAILABLE'});
  for(let attempt=0;attempt<2;attempt++){
    let response;
    try{response=await fetch(url,{headers:{'User-Agent':AGENT},signal:AbortSignal.timeout(timeout),redirect:'error'});}
    catch{if(!attempt){await delay(400);continue;}throw unavailable('Could not connect to the data service. Please try again.');}
    if(response.status===429||response.status>=500){
      const retryAfter=response.headers.get('retry-after'),wait=retryAfter===null?400:Number(retryAfter)*1000;
      await response.body?.cancel();
      if(!attempt&&Number.isFinite(wait)&&wait>=0&&wait<=1000){await delay(wait);continue;}
      throw unavailable('The data service is temporarily busy. Please try again later.');
    }
    if(!response.ok)throw Error(`The data service returned error ${response.status}.`);
    const reader=response.body.getReader();let total=0,parts=[];
    try{
      while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();const error=Error('The response is too large. Choose a smaller field or time range.');error.code='RESPONSE_LIMIT';throw error;}parts.push(value);}
      return Buffer.concat(parts);
    }catch(error){
      if(error.code==='RESPONSE_LIMIT')throw error;
      if(!attempt){await delay(400);continue;}
      throw unavailable('The data download was interrupted. Please try again.');
    }
  }
}
export function parseCSV(text){
  const rows=[];let row=[],word='',quoted=false;
  for(let i=0;i<text.length;i++){let c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){word+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(word);word='';}else if(c==='\n'&&!quoted){row.push(word.replace(/\r$/,''));rows.push(row);row=[];word='';}else word+=c;}
  if(word||row.length){row.push(word);rows.push(row);}const names=rows.shift()||[];
  return rows.filter(r=>r.length===names.length).map(r=>Object.fromEntries(names.map((n,i)=>[n.trim(),r[i].trim()])));
}
export function productURL(row,q,kind){
  if(!/^[0-9]{5}[a-z]$/.test(row.scan)||!Number.isInteger(row.frame)||row.frame<0||row.frame>999||![1,2].includes(row.band)||!['int','unc','msk'].includes(kind))throw Error('Invalid observation identifier.');
  const f=String(row.frame).padStart(3,'0');const path=`${row.scan.slice(-2)}/${row.scan}/${f}/${row.scan}${f}-w${row.band}-${kind}-1b.fits${kind==='int'?'':'.gz'}`;
  const u=new URL(IRSA+'/ibe/data/wise/neowiser/p1bm_frm/'+path);u.search=new URLSearchParams({center:`${q.ra},${q.dec}`,size:`${Math.ceil(q.width*60/2.75*1.65)}pix`});return u.href;
}
export function decode(raw){const bytes=raw[0]===31&&raw[1]===139?gunzipSync(raw,{maxOutputLength:8e6}):raw;return readFits(bytes)[0];}
export function processFrame(row,q,products,{minimumCoverage=.75}={}){
  const [image,unc,mask]=products.map(p=>decode(p.bytes));
  const mjd=Number(image.header.MJD_OBS);if(!Number.isFinite(mjd)||image.header.BAND!==undefined&&Number(image.header.BAND)!==row.band)throw Error('Unexpected observation time or band in the FITS file.');
  if(row.band!==q.band||mjd<Date.parse(q.start)/86400000+40587||mjd>=Date.parse(q.end)/86400000+40588)throw Error('The observation is outside the selected period or band.');
  const grid=gridFor(q.ra,q.dec,q.width),aligned=alignWise(image,unc,mask,grid);
  if(aligned.coverage<minimumCoverage)throw Error('The observation has insufficient valid coverage of this field.');
  const saturationOK=!String(image.header[`B${row.band}SATDET`]||'').toLowerCase().includes('disable')&&!(mjd>=60504&&mjd<=60516);
  return {id:`${row.scan}${String(row.frame).padStart(3,'0')}-w${row.band}`,mjd,date:new Date((mjd-40587)*86400000).toISOString(),band:row.band,n:grid.n,scale:grid.scale,wcs:grid.header,
    ...aligned,unit:'DN scaled to MAGZP=20; median background subtracted',uncertainty_note:'Diagonal interpolation variance only; adjacent display pixels are correlated. Source apertures use original pixels.',peaks:saturationOK?sourcePeaks(image,unc,mask,grid):[],quality:saturationOK?'masked':'saturation encoding unreliable; visual inspection only',
    products:products.map(p=>({kind:p.kind,url:p.url,sha256:createHash('sha256').update(p.bytes).digest('hex')}))};
}
let jplQueue=Promise.resolve();
function jpl(url,timeout=65000){const task=jplQueue.then(()=>memo(String(url),async()=>JSON.parse((await remote(url,2e6,timeout)).toString())));jplQueue=task.catch(()=>{});return task;}
async function horizons(params){
  const url='https://ssd.jpl.nasa.gov/api/horizons.api?'+new URLSearchParams({format:'json',...params});const p=await jpl(url);
  if(!['1.2','1.3'].includes(p.signature?.version))throw Error('The JPL response format has changed.');
  if(p.error||!p.result?.includes('$$SOE'))throw Error('No JPL ephemeris is available for this observation.');
  return {url,p,rows:p.result.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n').filter(Boolean).map(x=>x.split(',').map(v=>v.trim()))};
}
export function sexagesimal(value,hours=false,output=false){
  if(output){const neg=value<0;let n=Math.abs(value)/(hours?15:1);const a=Math.floor(n),b=Math.floor((n-a)*60),c=((n-a)*60-b)*60;return `${neg?'M':''}${String(a).padStart(2,'0')}-${String(b).padStart(2,'0')}-${c.toFixed(3).padStart(6,'0')}`;}
  const parts=String(value).replace(/[hmsd°:'"’]/g,' ').trim().split(/\s+/).map(Number);
  if(parts.length<3||parts.some(x=>!Number.isFinite(x)))return NaN;
  const sign=String(value).trim().startsWith('-')?-1:1;return sign*(Math.abs(parts[0])+parts[1]/60+parts[2]/3600)*(hours?15:1);
}
export async function identifyJPL(points){
  if(!Array.isArray(points)||points.length<1||points.length>12||points.some(p=>![p.ra,p.dec,p.mjd].every(Number.isFinite)||p.ra<0||p.ra>=360||Math.abs(p.dec)>90||p.mjd<56639||p.mjd>60524))throw Error('Valid sky coordinates and observation times are required.');
  points=[...points].sort((a,b)=>a.mjd-b.mjd);const p=points[0];
  const state=await horizons({COMMAND:"'-163'",CENTER:"'500@399'",EPHEM_TYPE:"'VECTORS'",TLIST:`'${p.mjd.toFixed(9)}'`,TLIST_TYPE:"'MJD'",TIME_TYPE:"'UT'",REF_PLANE:"'FRAME'",VEC_CORR:"'NONE'",OUT_UNITS:"'KM-S'",VEC_TABLE:"'2'",CSV_FORMAT:"'YES'",OBJ_DATA:"'NO'"});
  const xyz=state.rows[0].slice(2,8).map(Number);if(xyz.length!==6||!xyz.every(Number.isFinite))throw Error('The WISE spacecraft position could not be read.');
  const time=new Date((p.mjd-40587)*86400000).toISOString().slice(0,19).replace('T','_');
  const url='https://ssd-api.jpl.nasa.gov/sb_ident.api?'+new URLSearchParams({'xobs':xyz.join(','),'obs-time':time,'fov-ra-center':sexagesimal(p.ra,true,true),'fov-dec-center':sexagesimal(p.dec,false,true),'fov-ra-hwidth':'.02','fov-dec-hwidth':'.02','two-pass':'true','suppress-first-pass':'true','mag-required':'false','req-elem':'false'});
  const result=await jpl(url,90000);
  if(result.signature?.version!=='1.1')throw Error('The JPL catalogue format has changed.');
  if(result.error||result.message&&result.code)throw Error('The JPL catalogue search did not complete.');
  const names=result.fields_second||[];
  const candidates=(result.data_second_pass||[]).map(row=>{
    const r=Object.fromEntries(names.map((k,i)=>[k,row[i]])),name=r['Object name'];
    const ra=sexagesimal(r['Astrometric RA (hh:mm:ss)'],true),dec=sexagesimal(r['Astrometric Dec (dd mm\'ss")']);
    return {name,ra,dec,separation:angularSeparation(p.ra,p.dec,ra,dec),source:'NASA/JPL Small-Body Identification',status:'positional candidate'};
  }).filter(r=>r.name&&Number.isFinite(r.separation)&&r.separation<=12).sort((a,b)=>a.separation-b.separation).slice(0,3);
  const checked=[];
  for(const candidate of candidates){
    const number=candidate.name.match(/^(\d+)\s/);if(points.length>=3&&number){
      try{
        const check=await horizons({COMMAND:`'${number[1]};'`,CENTER:"'500@-163'",EPHEM_TYPE:"'OBSERVER'",TLIST:`'${points.map(p=>p.mjd.toFixed(9)).join(' ')}'`,TLIST_TYPE:"'MJD'",TIME_TYPE:"'UT'",QUANTITIES:"'1'",ANG_FORMAT:"'DEG'",EXTRA_PREC:"'YES'",CAL_FORMAT:"'JD'",CSV_FORMAT:"'YES'",OBJ_DATA:"'NO'"});
        const predicted=check.rows.map(r=>({jd:Number(r[0]),ra:Number(r[3]),dec:Number(r[4])}));
        const separations=points.map(p=>{const r=predicted.find(r=>Math.abs(r.jd-(p.mjd+2400000.5))<.00001);return r&&Number.isFinite(r.ra+r.dec)?angularSeparation(p.ra,p.dec,r.ra,r.dec):NaN;});
        if(separations.every(x=>Number.isFinite(x)&&x<=12)){candidate.status='track-consistent candidate';candidate.checked_epochs=separations.length;candidate.max_separation=Math.max(...separations);}
        else candidate.verification='The track is inconsistent across observations, or the ephemeris could not be read.';
        candidate.horizons_url=check.url;
      }catch(e){candidate.verification=e.message;}
    }
    checked.push(candidate);
  }
  return {candidates:checked,query_url:url,observer_url:state.url,observer:'WISE spacecraft (-163), JPL Horizons ICRF state at exposure time',queried_at:new Date().toISOString(),note:'A positional or track match is evidence, not confirmation of a discovery.'};
}

export function validatePoints(points,observer='wise'){
  if(!['wise','spherex'].includes(observer))throw Error('Unsupported telescope observer.');
  const min=observer==='wise'?55179:60745,max=observer==='wise'?60524:90000;
  if(!Array.isArray(points)||!points.length||points.length>12||points.some(p=>![p.ra,p.dec,p.mjd].every(Number.isFinite)||p.ra<0||p.ra>=360||Math.abs(p.dec)>90||p.mjd<min||p.mjd>max))throw Error('Valid sky coordinates and observation times are required.');
  points=[...points].sort((a,b)=>a.mjd-b.mjd);
  if(points.some((p,i)=>i&&p.mjd-points[i-1].mjd<1/86400))throw Error('Choose different observation times, at least one second apart.');
  return points;
}
export async function identify(points,observer='wise'){
  points=validatePoints(points,observer);const first=points[0],observerId=observer==='spherex'?'-163182':'-163',observerName=observer==='spherex'?'SPHEREx':'WISE';
  // IMCCE is a bounded candidate index, not the final astrometric observer.
  // A geocentric cone can miss very close objects due to spacecraft parallax.
  // Only Horizons positions as seen FROM the selected spacecraft can become displayed matches.
  const query_url='https://ssp.imcce.fr/webservices/skybot/api/conesearch.php?'+new URLSearchParams({'-ra':String(first.ra),'-dec':String(first.dec),'-rd':'.1','-ep':String(first.mjd+2400000.5),'-loc':'500','-filter':'120','-objFilter':'111','-refsys':'EQJ2000','-output':'all','-mime':'json'});
  let rows;try{rows=JSON.parse((await memo(query_url,()=>remote(query_url,1e6,35000))).toString());}catch(e){throw Error('The candidate catalogue did not respond. Please try again.');}
  if(!Array.isArray(rows))throw Error('The catalogue did not return the expected table.');
  const planets={mercury:199,venus:299,mars:499,jupiter:599,saturn:699,uranus:799,neptune:899,pluto:999,moon:301,sun:10};
  const ranked=rows.map(r=>({...r,distance:angularSeparation(first.ra,first.dec,sexagesimal(r['RA (hms)'],true),sexagesimal(r['DEC (dms)']))})).filter(r=>Number.isFinite(r.distance)).sort((a,b)=>a.distance-b.distance).slice(0,3);
  const candidates=[],checks=[];
  for(const row of ranked){
    const number=Number(row.Num),planet=planets[String(row.Name).toLowerCase()];
    const command=planet?String(planet):Number.isInteger(number)&&number>0?`${number};`:`DES=${String(row.Name).replace(/'/g,'')};`;
    const check=await horizons({COMMAND:`'${command}'`,CENTER:`'500@${observerId}'`,EPHEM_TYPE:"'OBSERVER'",TLIST:`'${points.map(p=>p.mjd.toFixed(9)).join(' ')}'`,TLIST_TYPE:"'MJD'",TIME_TYPE:"'UT'",QUANTITIES:"'1'",ANG_FORMAT:"'DEG'",EXTRA_PREC:"'YES'",CAL_FORMAT:"'JD'",CSV_FORMAT:"'YES'",OBJ_DATA:"'NO'"});
    const predicted=check.rows.map(r=>({jd:Number(r[0]),ra:Number(r[3]),dec:Number(r[4])}));
    if(predicted.some(p=>!Number.isFinite(p.jd+p.ra+p.dec)))throw Error('The JPL coordinates could not be read.');
    const distances=points.map(p=>{const r=predicted.find(r=>Math.abs(r.jd-(p.mjd+2400000.5))<.00001);return r?angularSeparation(p.ra,p.dec,r.ra,r.dec):NaN;});
    if(distances.some(x=>!Number.isFinite(x)))throw Error('An observation time is missing from the JPL ephemeris.');
    checks.push({name:row.Name,url:check.url,predicted,distances_arcsec:distances});
    // Multiple measured positions must all agree. One matching endpoint is insufficient.
    if(distances.every(d=>d<=12))candidates.push({name:planet?String(row.Name):number>0?`${number} ${row.Name}`:String(row.Name),type:String(row.Class),separation:distances[0],max_separation:Math.max(...distances),checked_epochs:points.length,status:points.length>=3?'track-consistent candidate':'positional candidate',source:`NASA/JPL Horizons, observed from ${observerName} (${observerId})`,horizons_url:check.url});
  }
  return {candidates,query_url,checks,observer:`${observerName} spacecraft (${observerId}), JPL Horizons astrometric RA/Dec`,queried_at:new Date().toISOString(),note:'IMCCE SkyBoT geocentric preselection within 0.1 degree, nearest three candidates; every displayed match checked by JPL from the telescope. This is not an exhaustive search, particularly for close objects. A match is not a discovery confirmation.'};
}
