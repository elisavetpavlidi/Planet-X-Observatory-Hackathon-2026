import http from 'node:http';
import {VERSION} from './release.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {identify,validatePoints,remote,processFrame} from './services.mjs';
import {discover,loadObservation,processSpherex} from './archive.mjs';
import {detectTracks,validateExplore} from './model.mjs';
import {angularSeparation} from './science.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2),getArg=(key,fallback)=>{const i=args.lastIndexOf(key);return i>=0?args[i+1]:fallback;};
const port=Number(getArg('--port',process.env.PORT||8501)),host=getArg('--host','127.0.0.1');
const files={'/':['web/index.html','text/html; charset=utf-8'],'/guide':['docs/USER_GUIDE_EL.html','text/html; charset=utf-8'],'/guide.pdf':['docs/Planet_X_User_Guide_EL.pdf','application/pdf'],'/catalog/sky.json':['web/catalog/sky.json','application/json; charset=utf-8'],'/catalog/LICENSE':['web/catalog/LICENSE','text/plain; charset=utf-8'],'/bundled/observation_A.fits':['data/reference/m31/observation_A.fits','application/fits'],'/bundled/observation_B.fits':['data/reference/m31/observation_B.fits','application/fits']};
for(const name of ['app','science','model','cases','motion','navigator','release'])files['/'+name+'.mjs']=['web/'+name+'.mjs','text/javascript; charset=utf-8'];files['/style.css']=['web/style.css','text/css; charset=utf-8'];files['/guide.css']=['web/guide.css','text/css; charset=utf-8'];
files['/eureka.css']=['web/eureka.css','text/css; charset=utf-8'];
files['/eureka.mjs']=['web/eureka.mjs','text/javascript; charset=utf-8'];
files['/eureka-quality.mjs']=['web/eureka-quality.mjs','text/javascript; charset=utf-8'];
files['/eureka-eye.png']=['web/eureka-eye.png','image/png'];
files['/eureka-tutorial.vtt']=['web/eureka-tutorial.vtt','text/vtt; charset=utf-8'];
async function readSavedCase(kind='neowise'){
 const path=kind==='spherex'?'data/reference/m31/session.json':kind==='sequence'?'data/neowise/consecutive.json':'data/neowise/nemesis.json';
 return JSON.parse(await readFile(root+path,'utf8'));
}
async function cachedIdentity(points){
 for(const path of ['data/neowise/identification.json','data/neowise/sequence_identification.json']){
  try{
   const cached=JSON.parse(await readFile(root+path,'utf8')),candidate=cached.result.candidates[0],check=cached.result.checks.find(c=>c.url===candidate?.horizons_url&&c.predicted);
   if(!check)continue;
   const distances=points.map(p=>{const r=check.predicted.find(r=>Math.abs(r.jd-p.mjd-2400000.5)<1e-7);return r?angularSeparation(p.ra,p.dec,r.ra,r.dec):Infinity;});
   if(distances.some(d=>d>3))continue;
   return {...cached.result,cached:true,candidates:[{...candidate,separation:distances[0],max_separation:Math.max(...distances),checked_epochs:points.length,status:points.length>=3?'track-consistent candidate':'positional candidate'}]};
  }catch{ /* A missing saved check never substitutes for a live identity result. */ }
 }
 return null;
}
async function recommendedCase(kind){
 const data=await readSavedCase(kind);
 if(kind==='spherex')return data;
 const track=detectTracks(data.frames)[0];
 if(!track)return data;
 const identity=await cachedIdentity(track.points);
 if(!identity)return data;
 const selection=track.points.map(point=>({...point,origin:'automatic',method:'raw-pixel aperture centroid'}));
 return {...data,selection,identity};
}
async function nemesisFocusExample(){
 const data=await recommendedCase('sequence');
 const row=JSON.parse(await readFile(root+'data/neowise/row_0.json','utf8'));
 const products=await Promise.all(['int','unc','msk'].map(async kind=>{
  const {file,url}=row.files[kind];
  return {kind,url,bytes:await readFile(root+'data/neowise/'+file)};
 }));
 const entry=data.catalog.observations.find(item=>item.scan===row.scan_id&&item.frame===Number(row.frame_num));
 const frame=processFrame(entry,data.query,products,{minimumCoverage:.4});
 data.frames.push({...frame,key:entry.key,archive:entry.archive,observer:entry.observer,
  peaks:[],inspection_only:true,quality:'Partial sky coverage; visual inspection only'});
 delete entry.load_error;
 entry.loaded=true;
 entry.inspection_only=true;
 return data;
}
async function spherexExample(kind){
 let center,records;
 if(kind==='atlas'){
  const pair=JSON.parse(await readFile(root+'data/comet_3i/pair.json','utf8'));
  center=[248.7432368,-17.04556275];
  records=pair.frames;
 }else{
  const fields=JSON.parse(await readFile(root+'data/validation/records.json','utf8'));
  const field=fields.find(item=>item.field===kind);
  center=field.center_deg;
  records=field.provenance;
  if(kind==='pleiades')records=[...records,fields.find(item=>item.field==='pleiades_quick_revisit').provenance[1]];
 }
 records.sort((a,b)=>a.mjd-b.mjd);
 const day=mjd=>new Date((mjd-40587)*86400000).toISOString().slice(0,10);
 const query=validateExplore({ra:center[0],dec:center[1],width:kind==='atlas'?12:8,archive:'spherex_qr2',detector:6,start:day(records[0].mjd),end:day(records.at(-1).mjd)});
 const frames=[],observations=[];
 for(const record of records){
  const frame=processSpherex(await readFile(root+record.path),query,{},record.access_url);
  if(frame.products[0].sha256!==record.sha256)throw Error('The bundled SPHEREx FITS failed its checksum.');
  frame.key=frame.id;
  frames.push(frame);
  observations.push({key:frame.key,archive:frame.archive,observer:frame.observer,detector:frame.band,mjd:frame.mjd,access_url:record.access_url,loaded:true});
 }
 return {schema:'planetx-observation-case/1',version:VERSION,query,frames,selection:[],identity:null,catalog:{bundled:true,observations}};
}
let reference;
async function resolveName(value){
 const name=String(value||'').trim();if(!name||name.length>100)throw Error('Enter a short object name, or use the sky map.');
 const normalize=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
 reference??=JSON.parse(await readFile(root+'web/catalog/sky.json','utf8'));const known=[{name:'Pleiades',alias:'M45',ra:56.75,dec:24.1167},{name:'Andromeda Galaxy',alias:'M31',ra:10.6847,dec:41.2688},...reference.objects,...reference.stars.filter(s=>s.name)],r=known.find(r=>[r.name,r.alias].some(s=>s&&normalize(s)===normalize(name)));
 if(r)return {name:r.name,ra:r.ra,dec:r.dec,source:'Bundled J2000 reference catalogue'};
 const url='https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?'+encodeURIComponent(name);const xml=(await remote(url,300000,25000)).toString(),ra=Number(xml.match(/<jradeg>([^<]+)</)?.[1]),dec=Number(xml.match(/<jdedeg>([^<]+)</)?.[1]);
 if(!Number.isFinite(ra)||!Number.isFinite(dec)||ra<0||ra>=360||Math.abs(dec)>90)throw Error('The name was not resolved. Choose a position on the sky map or enter RA / Dec.');return {name,ra,dec,source:'CDS Sesame position resolver; fixed J2000 position, not a moving-body ephemeris'};
}
async function body(req){let size=0,parts=[];for await(const data of req){size+=data.length;if(size>16000)throw Error('The request is too large.');parts.push(data);}return JSON.parse(Buffer.concat(parts).toString());}
function send(res,status,value,type='application/json; charset=utf-8'){
 res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"});res.end(type.startsWith('application/json')&&!Buffer.isBuffer(value)?JSON.stringify(value):value);
}
const server=http.createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/eureka-tutorial.mp4'){
   const video=await readFile(root+'web/eureka-tutorial.mp4');
   const range=req.headers.range;
   const headers={'Content-Type':'video/mp4','Accept-Ranges':'bytes','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
   if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match){res.writeHead(416,{...headers,'Content-Range':`bytes */${video.length}`});return res.end();}
    let start=match[1]?Number(match[1]):0;
    let end=match[2]?Number(match[2]):video.length-1;
    if(!match[1]&&match[2]){start=Math.max(0,video.length-end);end=video.length-1;}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=video.length||end<start){res.writeHead(416,{...headers,'Content-Range':`bytes */${video.length}`});return res.end();}
    end=Math.min(end,video.length-1);
    res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${video.length}`});return res.end(video.subarray(start,end+1));
   }
   res.writeHead(200,{...headers,'Content-Length':video.length});return res.end(video);
  }
  if(req.method==='GET'&&files[url.pathname]){const [file,type]=files[url.pathname];return send(res,200,await readFile(root+file),type);}
  if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,version:VERSION,archives:['wise','wise3','wise2','neowise','spherex_qr2','spherex_qr3','spherex_qr2_deep','spherex_qr3_deep']});
  if(req.method==='GET'&&url.pathname==='/api/cases/neowise')return send(res,200,await recommendedCase('neowise'));
  if(req.method==='GET'&&url.pathname==='/api/cases/nemesis-focus')return send(res,200,await nemesisFocusExample());
  if(req.method==='GET'&&url.pathname==='/api/cases/sequence')return send(res,200,await recommendedCase('sequence'));
  if(req.method==='GET'&&url.pathname==='/api/cases/spherex')return send(res,200,await readSavedCase('spherex'));
  const example=url.pathname.match(/^\/api\/cases\/(atlas|pleiades|m101)$/);
  if(req.method==='GET'&&example)return send(res,200,await spherexExample(example[1]));
  if(req.method==='POST'&&url.pathname.startsWith('/api/')){
   if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'Request origin is not allowed.'});
   const data=await body(req);
   if(url.pathname==='/api/resolve')return send(res,200,await resolveName(data.name));
   if(url.pathname==='/api/discover')return send(res,200,await discover(data));
   if(url.pathname==='/api/frame'){
    const q=validateExplore(data.query),row=data.observation;if(!row||typeof row!=='object')throw Error('Choose an observation from the list.');
    if(q.archive.startsWith('spherex')&&['A','B'].includes(row.bundled)&&q.ra===10.6847&&q.dec===41.2688&&q.width===8){const d=await readSavedCase('spherex'),f=d.frames.find(f=>f.key==='bundled-spherex-'+row.bundled);if(f.mjd>=Date.parse(q.start)/86400000+40587&&f.mjd<Date.parse(q.end)/86400000+40588&&(!q.detector||q.detector===f.band))return send(res,200,f);}
    if(q.archive==='neowise'&&q.ra===64.085&&q.dec===22.8&&q.width===8&&q.band===2&&row.band===2){const d=await readSavedCase('sequence'),id=`${row.scan}${String(row.frame).padStart(3,'0')}-w2`,f=d.frames.find(f=>f.id===id);if(f&&f.mjd>=Date.parse(q.start)/86400000+40587&&f.mjd<Date.parse(q.end)/86400000+40588)return send(res,200,{...f,key:row.key||f.id,cache:'bundled NASA cutout'});}
    return send(res,200,await loadObservation(row,q));
   }
   if(url.pathname==='/api/identify'){const observer=data.observer||'wise',points=validatePoints(data.points,observer);return send(res,200,observer==='wise'&&await cachedIdentity(points)||await identify(points,observer));}
  }
  send(res,404,{error:'Not found.'});
 }catch(e){send(res,e.code==='UPSTREAM_UNAVAILABLE'?502:400,{error:e.message||'The request could not be completed.',code:e.code||'INVALID_REQUEST'});}
});
server.requestTimeout=300000;server.listen(port,host,()=>console.log(`Planet X ${VERSION} — http://${host}:${server.address().port}`));server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'The port is already in use. Stop the previous app with Ctrl+C.':'The app could not start: '+e.message);process.exit(1);});process.on('SIGTERM',()=>server.close());
