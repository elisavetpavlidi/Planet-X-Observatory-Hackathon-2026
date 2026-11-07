import {remote,parseCSV,productURL,decode,processFrame} from './services.mjs';
import {readFits,gridFor,alignWise,sourcePeaks,REJECT_MASK,findTracks,median,angularSeparation,wcs} from './science.mjs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

import {ARCHIVES,validateExplore} from './model.mjs';
export {ARCHIVES,validateExplore,surveyWindows,detectTracks} from './model.mjs';
const IRSA='https://irsa.ipac.caltech.edu';
const day=s=>Date.parse(s)/86400000;
const cache=new Map();
function memo(k,fn){if(cache.has(k))return cache.get(k);const p=fn().catch(e=>{cache.delete(k);throw e;});cache.set(k,p);while(cache.size>30)cache.delete(cache.keys().next().value);return p;}
export function parseTSV(text){
 const lines=text.trim().split(/\r?\n/),names=lines.shift().split('\t').map(s=>s.trim());
 if(!names.includes('access_url')||!names.includes('t_min'))throw Error('The SPHEREx table format has changed.');
 return lines.filter(s=>s.trim()).map(line=>{const cells=line.split('\t');if(cells.length!==names.length)throw Error('An archive metadata row could not be read; results were not treated as empty.');return Object.fromEntries(names.map((n,i)=>[n,cells[i].trim()]));});
}
function unique(rows){return [...new Map(rows.map(r=>[r.key,r])).values()].sort((a,b)=>a.mjd-b.mjd||a.key.localeCompare(b.key));}
export async function discover(query){
 const q=validateExplore(query);if(day(q.end)-day(q.start)>365)throw Error('Query long periods in the year-sized windows supplied by the app.');
 const a=ARCHIVES[q.archive];if(!a)throw Error('Select one archive window.');
 const start=day(q.start)+40587,end=day(q.end)+40588;let url,rows;
 if(a.dataset){
  url=IRSA+`/ibe/search/wise/${a.dataset}/${a.table}?`+new URLSearchParams({POS:`${q.ra},${q.dec}`,SIZE:String(q.width/60),INTERSECT:'CENTER',where:`band=${q.band} AND mjd_obs>=${start} AND mjd_obs<${end}`+(q.quality==='recommended'?' AND qual_frame=10 AND moon_sep>20':''),columns:'scan_id,frame_num,band,mjd_obs,qual_frame,moon_sep',ct:'csv'});
  const raw=await memo(url,()=>remote(url,6e6,45000)),text=raw.toString();if(!text.split('\n')[0].includes('scan_id'))throw Error('The archive returned an unexpected metadata table.');
  rows=parseCSV(text).map(r=>({key:`${q.archive}:${r.scan_id}:${r.frame_num}:w${r.band}`,archive:q.archive,observer:'wise',scan:r.scan_id,frame:Number(r.frame_num),band:Number(r.band),mjd:Number(r.mjd_obs),quality:Number(r.qual_frame),moon_sep:Number(r.moon_sep)})).filter(r=>/^[0-9]{5}[a-z]$/.test(r.scan)&&Number.isFinite(r.mjd));
 }else{
  url=IRSA+'/SIA?'+new URLSearchParams({COLLECTION:q.archive,POS:`CIRCLE ${q.ra} ${q.dec} ${q.width/120}`,TIME:`${start} ${end}`,MAXREC:'5000',RESPONSEFORMAT:'TSV'});
  const raw=await memo(url,()=>remote(url,8e6,60000)),text=raw.toString();if(!text.split('\n')[0].includes('access_url'))throw Error('The SPHEREx metadata service did not return the expected table.');
  const all=parseTSV(text);if(all.length>=5000){const e=Error('This archive window reached its row limit. Search a shorter date range.');e.code='WINDOW_LIMIT';throw e;}
  rows=all.map(r=>{const id=r.obs_id||r.obs_title||r.observation_id||r.access_url,match=String(r.energy_bandpassname+' '+r.access_url).match(/(?:D|detector[_ =]?)([1-6])/i),detector=match?Number(match[1]):Number(r.spherex_detector||r.detector)||0;return {key:q.archive+':'+id+':D'+detector,archive:q.archive,observer:'spherex',id,band:detector,detector,mjd:(Number(r.t_min)+Number(r.t_max||r.t_min))/2,access_url:r.access_url,em_min:Number(r.em_min),em_max:Number(r.em_max)};}).filter(r=>Number.isFinite(r.mjd)&&(!q.detector||!r.detector||r.detector===q.detector));
 }
 rows=unique(rows);
 return {query:q,observations:rows,total:rows.length,complete:true,search_url:url,sampling:'All returned archive rows retained; no time sampling or quality exclusion unless explicitly selected.'};
}
export function wiseURL(row,q,kind){const a=ARCHIVES[row.archive||'neowise'];if(!a?.dataset)throw Error('Unknown WISE dataset.');const base=productURL(row,{...q,ra:Number(q.ra),dec:Number(q.dec)},kind);return base.replace('/wise/neowiser/p1bm_frm/',`/wise/${a.dataset}/${a.table}/`);}
export function fitsURL(url){const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='irsa.ipac.caltech.edu'||u.port||u.username||u.password||!u.pathname.startsWith('/ibe/data/spherex/')||!u.pathname.endsWith('.fits'))throw Error('Unsupported SPHEREx data URL.');return u;}
const unescapeXML=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
export async function resolveSpherexURL(input){
 try{return fitsURL(input).href;}catch{}
 const u=new URL(input);if(u.protocol!=='https:'||u.hostname!=='irsa.ipac.caltech.edu'||u.port||u.username||u.password||!u.pathname.startsWith('/datalink/links/spherex'))throw Error('Unsupported SPHEREx DataLink.');
 const xml=(await memo(u.href,()=>remote(u.href,2e6,30000))).toString();const fields=[...xml.matchAll(/<FIELD\b[^>]*\bname="([^"]+)"[^>]*>/g)].map(m=>m[1]);
 for(const tr of xml.matchAll(/<TR\b[^>]*>([\s\S]*?)<\/TR>/gi)){const vals=[...tr[1].matchAll(/<TD\b[^>]*>([\s\S]*?)<\/TD>/gi)].map(m=>unescapeXML(m[1].replace(/<[^>]*>/g,'')));const row=Object.fromEntries(fields.map((k,i)=>[k,vals[i]]));if(row.access_url&&String(row.semantics).endsWith('#this')){try{return fitsURL(row.access_url).href}catch{}}}
 throw Error('No direct FITS product was returned by DataLink.');
}
const SPH_BAD=[0,1,2,4,5,6,7,9,10,11,14,15,17,19].reduce((s,k)=>s+2**k,0);
export function wavelengthAt(hdus,image,x,y){
 const c=hdus.tables?.find(t=>t.header.EXTNAME==='WCS-WAVE')?.columns;if(!c?.X||!c?.Y||!c?.VALUES)return null;
 const h=image.header,tx=(x+1-(h.CRPIX1W??1))*(h.CDELT1W??1)+(h.CRVAL1W??1),ty=(y+1-(h.CRPIX2W??1))*(h.CDELT2W??1)+(h.CRVAL2W??1);
 const lower=(a,v)=>{for(let i=0;i<a.length-1;i++)if(v>=a[i]&&v<=a[i+1])return i;return -1;},ix=lower(c.X,tx),iy=lower(c.Y,ty);if(ix<0||iy<0)return null;
 const fx=(tx-c.X[ix])/(c.X[ix+1]-c.X[ix]),fy=(ty-c.Y[iy])/(c.Y[iy+1]-c.Y[iy]),weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy],ids=[iy*c.X.length+ix,iy*c.X.length+ix+1,(iy+1)*c.X.length+ix,(iy+1)*c.X.length+ix+1];
 return [0,1].map(k=>ids.reduce((s,j,i)=>s+weights[i]*c.VALUES[j*2+k],0));
}
export function processSpherex(bytes,q,row={},url=null){
 const raw=bytes[0]===31&&bytes[1]===139?gunzipSync(bytes,{maxOutputLength:32e6}):bytes,hdus=readFits(raw),image=hdus.find(x=>x.header.EXTNAME==='IMAGE'),variance=hdus.find(x=>x.header.EXTNAME==='VARIANCE'),flags=hdus.find(x=>x.header.EXTNAME==='FLAGS');
 if(!image||!variance||!flags||variance.width!==image.width||flags.width!==image.width||variance.height!==image.height||flags.height!==image.height)throw Error('SPHEREx requires matching IMAGE, VARIANCE and FLAGS planes.');
 if(!/^MJy2\s*\/\s*sr2$/i.test(variance.header.BUNIT||''))throw Error('Unsupported SPHEREx variance units.');
 if(!/^MJy\s*\/\s*sr$/i.test(image.header.BUNIT||''))throw Error('Unsupported SPHEREx intensity units.');
 const unc={...variance,pixels:Float64Array.from(variance.pixels,v=>v>0?Math.sqrt(v):NaN)},mask={...flags,pixels:Float64Array.from(flags.pixels,v=>(v&SPH_BAD)?REJECT_MASK:0)},calibrated={...image,header:{...image.header,MAGZP:20}},grid=gridFor(q.ra,q.dec,q.width,6.15),aligned=alignWise(calibrated,unc,mask,grid),band=Number(image.header.DETECTOR),mjd=Number(image.header['MJD-AVG']??image.header['MJD-OBS']);
 if(!Number.isFinite(mjd)||mjd<day(q.start)+40587||mjd>=day(q.end)+40588||q.detector&&band!==q.detector)throw Error('The SPHEREx observation is outside the selected dates or detector.');
 if(aligned.coverage<.05)throw Error('The SPHEREx cutout has insufficient valid coverage.');
 const hw=wcs(image.header),[cx,cy]=hw.worldToPixel(q.ra,q.dec),wave=wavelengthAt(hdus,image,cx,cy);
 const peaks=sourcePeaks(calibrated,unc,mask,grid).map(p=>{const w=wavelengthAt(hdus,image,...hw.worldToPixel(p.ra,p.dec));return {...p,wavelength_um:w?.[0]??null,bandwidth_um:w?.[1]??null};});
 return {id:String(image.header.OBSID||row.id||'SPHEREx')+'-D'+band,observer:'spherex',archive:row.archive||q.archive,mjd,date:new Date((mjd-40587)*86400000).toISOString(),band,n:grid.n,scale:grid.scale,wcs:grid.header,...aligned,unit:'MJy/sr; median background subtracted',wavelength_um:wave?.[0]??null,bandwidth_um:wave?.[1]??null,peaks,quality:'SPHEREx FLAGS applied; spectral compatibility required for automatic tracks',products:[{kind:'int',url,sha256:createHash('sha256').update(bytes).digest('hex')}],uncertainty_note:'Diagonal display variance; source centroids measured on original pixels.'};
}
export async function loadObservation(row,query){
 const q=validateExplore(query),a=ARCHIVES[row.archive||q.archive];if(!a)throw Error('Unknown observation archive.');
 if(a.observer==='spherex'){
  if(row.archive!==q.archive)throw Error('The observation belongs to a different archive.');
  const base=await resolveSpherexURL(row.access_url),u=fitsURL(base);u.search=new URLSearchParams({center:`${q.ra},${q.dec}`,size:String(q.width/60)});
  return memo(u.href,async()=>processSpherex(await remote(u.href,24e6,60000),q,row,u.href));
 }
 if(row.archive&&row.archive!==q.archive&&q.archive!=='wise_all')throw Error('The observation belongs to another archive.');
 if(row.band!==q.band)throw Error('The observation belongs to another band.');
 const key=JSON.stringify([row.archive,row.scan,row.frame,row.band,q.ra,q.dec,q.width]);
 return memo(key,async()=>{const products=[];for(const kind of ['int','unc','msk']){const url=wiseURL(row,q,kind);products.push({kind,url,bytes:await remote(url,4e6,50000)});}const f=processFrame(row,q,products);f.archive=row.archive||'neowise';f.observer='wise';f.key=row.key;f.frame_quality=row.quality;if(row.quality===0){f.peaks=[];f.quality='Low frame quality; visual inspection only';}return f;});
}
