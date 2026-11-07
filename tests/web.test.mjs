import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {readFits,wcs,gridFor,findTracks,angularSeparation,alignWise,sourcePeaks,REJECT_MASK} from '../web/science.mjs';
import {validateExplore} from '../web/model.mjs';
import {validateCase} from '../web/cases.mjs';
import {remote,decode,processFrame,productURL,parseCSV,sexagesimal,validatePoints} from '../web/services.mjs';
const root=new URL('../',import.meta.url),json=path=>JSON.parse(fs.readFileSync(new URL(path,root)));
const example=json('data/neowise/nemesis.json'),truth=json('data/neowise/validation_truth.json');

test('real SIN-SIP astrometry agrees with independent Astropy/WCSLIB coordinates',()=>{
 for(const q of json('data/neowise/wcs_reference.json')){
  const image=readFits(fs.readFileSync(new URL('data/neowise/'+q.file,root)))[0],transform=wcs(image.header);
  q.pixel.forEach((p,i)=>{assert.ok(angularSeparation(...transform.pixelToWorld(...p),...q.world[i])<.00001);const actual=transform.worldToPixel(...q.world[i]);assert.ok(Math.hypot(actual[0]-p[0],actual[1]-p[1])<.0001);});
 }
});
test('all offline real image triplets match provenance hashes and rebuild deterministically',()=>{
 for(const f of example.frames){
  const stem=f.id,products=f.products.map(p=>({kind:p.kind,url:p.url,bytes:fs.readFileSync(new URL(`data/neowise/frames/${stem}-${p.kind}.fits.gz`,root))}));
  for(let i=0;i<products.length;i++)assert.equal(createHash('sha256').update(products[i].bytes).digest('hex'),f.products[i].sha256);
  const rebuilt=processFrame({scan:stem.slice(0,6),frame:Number(stem.slice(6,9)),band:f.band},example.query,products);
  assert.deepEqual(rebuilt.image,f.image);assert.deepEqual(rebuilt.variance,f.variance);assert.deepEqual(rebuilt.peaks,f.peaks);
 }
});
test('blind search recovers the real moving source, then agrees with withheld IRSA/MOST positions',()=>{
 const tracks=findTracks(example.frames);assert.equal(tracks.length,1);assert.equal(tracks[0].points.length,3);
 assert.ok(tracks[0].displacement>280&&tracks[0].displacement<290);assert.ok(tracks[0].rate>16&&tracks[0].rate<17);assert.ok(tracks[0].controls>=2);
 for(const p of tracks[0].points){const q=truth.positions.find(q=>q.id===example.frames[p.frame].id);assert.ok(angularSeparation(p.ra,p.dec,q.ra,q.dec)<1);}
});
test('static sky, single detections, and large time gaps do not produce motion tracks',()=>{
 const staticFrames=example.frames.map((f,i)=>({...example.frames[0],mjd:f.mjd}));assert.deepEqual(findTracks(staticFrames),[]);
 const isolated=example.frames.map((f,i)=>({...f,peaks:i===0?f.peaks:[]}));assert.deepEqual(findTracks(isolated),[]);
 assert.deepEqual(findTracks([example.frames[0],example.frames[1]]),[]);
 assert.deepEqual(findTracks(example.frames.map((f,i)=>({...f,mjd:f.mjd+i*3}))),[]);
});
test('catalogue evidence is an actual spacecraft-relative JPL check in all measured epochs',()=>{
 const proof=json('data/neowise/identification.json'),track=findTracks(example.frames)[0];
 assert.equal(proof.result.candidates[0].name,'128 Nemesis');assert.match(proof.result.candidates[0].horizons_url,/500%40-163/);
 const check=proof.result.checks.find(c=>c.predicted);
 assert.equal(check.predicted.length,3);track.points.forEach(p=>{const predicted=check.predicted.find(r=>Math.abs(r.jd-(p.mjd+2400000.5))<1e-7);assert.ok(predicted);assert.ok(angularSeparation(p.ra,p.dec,predicted.ra,predicted.dec)<1);});
});
test('rejecting a source core prevents accepting its centroid',()=>{
 const f=example.frames[0],stem=f.id,planes=['int','unc','msk'].map(k=>decode(fs.readFileSync(new URL(`data/neowise/frames/${stem}-${k}.fits.gz`,root)))),p=truth.positions.find(p=>p.id===f.id),[x,y]=wcs(planes[0].header).worldToPixel(p.ra,p.dec);
 for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++)planes[2].pixels[(Math.round(y)+dy)*planes[2].width+Math.round(x)+dx]=REJECT_MASK;
 const peaks=sourcePeaks(...planes,gridFor(example.query.ra,example.query.dec,example.query.width));assert.ok(!peaks.some(q=>angularSeparation(p.ra,p.dec,q.ra,q.dec)<10));
});
test('invalid coordinates, impossible dates and unsafe archive identifiers fail closed',()=>{
 const q=example.query;assert.throws(()=>validateExplore({...q,ra:360}));assert.throws(()=>validateExplore({...q,dec:91}));assert.throws(()=>validateExplore({...q,start:'2019-02-30'}));assert.throws(()=>validateExplore({...q,end:'2018-01-01'}));assert.throws(()=>validateExplore({...q,archive:'unsupported'}));assert.throws(()=>productURL({scan:'../../x',frame:3,band:2},q,'int'));assert.throws(()=>readFits(Buffer.alloc(80)));
 assert.equal(new URL(productURL({scan:'02663r',frame:141,band:2},q,'unc')).hostname,'irsa.ipac.caltech.edu');
});
test('CSV quoting, signed declinations and the zero-based output WCS are preserved',()=>{
 assert.deepEqual(parseCSV('a,b\n"x,y","a""b"\n'),[{a:'x,y',b:'a"b'}]);assert.equal(sexagesimal('-00 30 00'),-.5);assert.equal(sexagesimal(22.5,true,true),'01-30-00.000');assert.ok(Math.abs(sexagesimal('04 16 14.5507',true)-64.0606279167)<1e-8);
 const grid=gridFor(359.99,-35,8);const c=grid.pixelToWorld((grid.n-1)/2,(grid.n-1)/2);assert.ok(angularSeparation(...c,359.99,-35)<.00001);
});


test('identity validation requires real, independent observing epochs',()=>{
 const p={ra:64.06,dec:22.79,mjd:58516.81};
 assert.equal(validatePoints([p]).length,1);
 assert.throws(()=>validatePoints([p,p,p]));
 assert.throws(()=>validatePoints([{...p,ra:424.06}]));
 assert.throws(()=>validatePoints([{...p,dec:91}]));
 assert.throws(()=>validatePoints([{...p,mjd:NaN}]));
});

test('HTTP app restores its real case and identifies it with all external network disabled',async t=>{
 const {spawn}=await import('node:child_process');
 const entry=new URL('../web/server.mjs',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`globalThis.fetch=async()=>{throw Error('External network forbidden during offline test')}; await import(${JSON.stringify(entry)});`],{env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill('SIGTERM'));
 let errors='';child.stderr.on('data',v=>errors+=v);
 const address=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Server did not start: '+errors)),5000);
  child.stdout.on('data',v=>{const match=String(v).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  child.once('error',e=>{clearTimeout(timer);reject(e)});
 });
 const call=async(path,body)=>{const r=await fetch(address+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});return {status:r.status,data:await r.json()};};
 const sample=await call('/api/cases/neowise');assert.equal(sample.status,200);assert.equal(sample.data.frames.length,6);assert.equal(sample.data.selection.length,3);assert.equal(sample.data.identity.candidates[0].name,'128 Nemesis');
 const points=findTracks(sample.data.frames)[0].points.map(p=>({ra:p.ra,dec:p.dec,mjd:p.mjd}));
 const identity=await call('/api/identify',{points});assert.equal(identity.status,200);assert.equal(identity.data.cached,true);assert.equal(identity.data.candidates[0].name,'128 Nemesis');assert.equal(identity.data.candidates[0].checked_epochs,3);
 const bad=await call('/api/identify',{points:[points[0],points[0],points[0]]});assert.equal(bad.status,400);
 const frame=await call('/api/frame',{query:example.query,observation:{scan:'02663r',frame:141,band:2}});assert.equal(frame.status,200);assert.deepEqual(frame.data.image,example.frames[0].image);
 const invalid=await call('/api/discover',{...example.query,ra:361});assert.equal(invalid.status,400);
 const sequence=await call('/api/cases/sequence');assert.equal(sequence.status,200);assert.equal(sequence.data.frames.length,9);assert.equal(sequence.data.selection.length,4);assert.equal(sequence.data.identity.cached,true);
 const focusExample=await call('/api/cases/nemesis-focus');
 assert.equal(focusExample.status,200);
 const focused=validateCase(focusExample.data);
 assert.equal(focused.frames.length,10);
 assert.equal(focused.selection.length,4);
 assert.equal(focused.identity.candidates[0].name,'128 Nemesis');
 const partial=focused.frames.find(frame=>frame.inspection_only);
 assert.ok(partial.coverage>.4&&partial.coverage<.75);
 assert.equal(partial.peaks.length,0);
 const fullTrack=findTracks(sequence.data.frames)[0],seqIdentity=await call('/api/identify',{points:fullTrack.points.map(p=>({ra:p.ra,dec:p.dec,mjd:p.mjd}))});assert.equal(seqIdentity.data.candidates[0].checked_epochs,4);assert.equal(seqIdentity.data.cached,true);
 const sph=await call('/api/cases/spherex');assert.equal(sph.status,200);assert.equal(sph.data.frames.length,2);assert.equal(sph.data.selection.length,0);assert.equal(validateCase(sph.data).frames[0].observer,'spherex');
 for(const [kind,count] of [['atlas',2],['pleiades',3],['m101',2]]){
  const example=await call('/api/cases/'+kind);
  assert.equal(example.status,200);
  const session=validateCase(example.data);
  assert.equal(session.frames.length,count);
  assert.ok(session.frames.every(f=>f.observer==='spherex'&&f.band===6&&f.coverage>.75));
  assert.equal(session.selection.length,0);
  assert.equal(session.catalog.observations.length,count);
 }
 const sphFrame=await call('/api/frame',{query:sph.data.query,observation:sph.data.catalog.observations[0]});assert.equal(sphFrame.status,200);assert.deepEqual(sphFrame.data.image,sph.data.frames[0].image);
 const target=await call('/api/resolve',{name:'M31'});assert.equal(target.status,200);assert.equal(target.data.ra,10.6847);
 const guide=await fetch(address+'/guide');assert.equal(guide.status,200);assert.match(await guide.text(),/Πρακτικός οδηγός/);
 const pdf=await fetch(address+'/guide.pdf');assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
 const blocked=await fetch(address+'/api/discover',{method:'POST',headers:{Origin:'https://unrelated.test','Content-Type':'application/json'},body:JSON.stringify(example.query)});assert.equal(blocked.status,403);
 const failed=await call('/api/discover',{...example.query,archive:'spherex_qr2',start:'2025-07-09',end:'2025-07-09'});assert.equal(failed.status,502);assert.equal(failed.data.code,'UPSTREAM_UNAVAILABLE');
});


test('data downloads retry a transient failure once, but never retry oversized responses',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;return calls===1?new Response('busy',{status:503,headers:{'retry-after':'0'}}):new Response('real data');};
  assert.equal((await remote('https://irsa.ipac.caltech.edu/test',100,1000)).toString(),'real data');assert.equal(calls,2);
  calls=0;globalThis.fetch=async()=>{calls++;return new Response('exceeds limit')};
  await assert.rejects(remote('https://irsa.ipac.caltech.edu/test',3,1000),/response is too large/);assert.equal(calls,1);
  calls=0;globalThis.fetch=async()=>{calls++;return new Response('busy',{status:429,headers:{'retry-after':'60'}})};
  await assert.rejects(remote('https://irsa.ipac.caltech.edu/test',100,1000),{code:'UPSTREAM_UNAVAILABLE'});assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
