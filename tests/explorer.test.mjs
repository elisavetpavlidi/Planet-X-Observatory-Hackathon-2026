import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {ARCHIVES,validateExplore,surveyWindows,detectTracks} from '../web/model.mjs';
import {processSpherex,parseTSV,fitsURL,wiseURL,discover} from '../web/archive.mjs';
import {readFits,wcs,gridFor,angularSeparation} from '../web/science.mjs';
import {validateCase} from '../web/cases.mjs';import {identify} from '../web/services.mjs';import {projectSky,unprojectSky} from '../web/navigator.mjs';
const json=p=>JSON.parse(fs.readFileSync(new URL('../'+p,import.meta.url))),raw=p=>fs.readFileSync(new URL('../'+p,import.meta.url));
const q={ra:64.085,dec:22.8,width:8,band:2,detector:4,archive:'neowise',start:'2019-02-02',end:'2019-02-03',quality:'all'};
test('long intervals are partitioned without gaps; mission gaps and future dates create no invented observations',()=>{
 const windows=surveyWindows({...q,archive:'wise_all',start:'1900-01-01',end:'2100-12-31'});assert.equal(windows[0].start,'2010-01-01');assert.equal(windows.at(-1).end,'2024-08-01');for(const archive of ['wise','wise3','wise2','neowise']){const ws=windows.filter(w=>w.archive===archive);assert.equal(ws[0].start,ARCHIVES[archive].start);assert.equal(ws.at(-1).end,ARCHIVES[archive].end);ws.forEach((w,i)=>{assert.ok((Date.parse(w.end)-Date.parse(w.start))/86400000<=364);if(i)assert.equal(Date.parse(w.start)-Date.parse(ws[i-1].end),86400000);});}
 assert.deepEqual(surveyWindows({...q,start:'2012-01-01',end:'2012-12-31'}),[]);assert.deepEqual(surveyWindows({...q,start:'2099-01-01',end:'2100-01-01'}),[]);assert.throws(()=>validateExplore({...q,start:'2025-02-30'}));assert.equal(validateExplore({...q,dec:90}).dec,90);assert.equal(validateExplore({...q,dec:-90}).dec,-90);
});
test('sky navigation is invertible across RA wrap and polar centres',()=>{
 for(const [a,d]of [[359.98,0],[.01,89.9],[230,-90],[64.085,22.8]])for(const [x,y]of [[450,240],[420,200],[510,280]]){const p=unprojectSky(x,y,a,d,25,900,480),s=projectSky(p.ra,p.dec,a,d,25,900,480);assert.ok(s);assert.ok(Math.hypot(s.x-x,s.y-y)<1e-6);}
 for(const dec of [-90,90]){const g=gridFor(359.99,dec,8);assert.ok(angularSeparation(...g.pixelToWorld((g.n-1)/2,(g.n-1)/2),359.99,dec)<1e-4);}
});
test('SPHEREx PC/CDELT and SIP WCS agrees with independent Astropy at real pixels',()=>{for(const r of json('data/spherex_wcs_reference.json').samples){const image=readFits(raw(r.file)).find(h=>h.header.EXTNAME==='IMAGE'),transform=wcs(image.header);r.pixel.forEach((p,i)=>{assert.ok(angularSeparation(...transform.pixelToWorld(...p),...r.world[i])<.00001);const v=transform.worldToPixel(...r.world[i]);assert.ok(Math.hypot(v[0]-p[0],v[1]-p[1])<.0001);});}});
test('real SPHEREx planes, wavelength lookup and masks are interpreted without turning M31 into motion',()=>{
 const frames=['A','B'].map(label=>processSpherex(raw(`data/reference/m31/observation_${label}.fits`),{...q,archive:'spherex_qr2',ra:10.6847,dec:41.2688,start:'2025-07-09',end:'2025-12-31'}));assert.equal(frames[0].n,78);for(const f of frames){assert.ok(f.coverage>.85);assert.ok(f.image.some(v=>v===null));assert.ok(f.variance.every(v=>v===null||v>0));assert.equal(f.observer,'spherex');}assert.ok(Math.abs(frames[0].wavelength_um-2.44189)<.0001);assert.ok(Math.abs(frames[1].wavelength_um-2.54184)<.0001);assert.deepEqual(detectTracks(frames),[]);
 assert.throws(()=>processSpherex(raw('data/reference/m31/observation_A.fits'),{...q,archive:'spherex_qr2',ra:10.6847,dec:41.2688,start:'2025-07-09',end:'2025-07-09',detector:1}));
});
test('archive discovery keeps overlapping and low-quality exposures instead of silently sampling',async()=>{
 const original=globalThis.fetch;try{globalThis.fetch=async()=>new Response('scan_id,frame_num,band,mjd_obs,qual_frame,moon_sep\n02663r,140,2,58516.81,10,100\n02663r,141,2,58516.811,5,10\n02663r,142,2,58516.9,0,5\n');const r=await discover({...q,ra:77.0123});assert.equal(r.total,3);assert.equal(r.observations[1].quality,5);assert.ok((r.observations[1].mjd-r.observations[0].mjd)*1440<5);assert.equal(r.observations[2].quality,0);}finally{globalThis.fetch=original;}
});
test('SPHEREx metadata parser preserves JSON commas; detector IDs remain distinct',async()=>{
 assert.equal(parseTSV('access_url\tt_min\tcloud_access\nhttps://x\t60000\t{"a":1,"b":2}\n')[0].cloud_access,'{"a":1,"b":2}');assert.throws(()=>parseTSV('access_url\tt_min\nhttps://x\t60000\tbroken'));
 const original=globalThis.fetch;try{globalThis.fetch=async()=>new Response('obs_id\tenergy_bandpassname\tt_min\tt_max\taccess_url\tem_min\tem_max\nEXPOSURE\tSPHEREx-D1\t60865.62\t60865.63\thttps://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/test1.fits\t1e-6\t2e-6\nEXPOSURE\tSPHEREx-D4\t60865.62\t60865.63\thttps://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/test4.fits\t2e-6\t3e-6\n');const r=await discover({...q,ra:88.0234,archive:'spherex_qr2',detector:0,start:'2025-07-09',end:'2025-07-09'});assert.equal(r.total,2);assert.notEqual(r.observations[0].key,r.observations[1].key);}finally{globalThis.fetch=original;}
});
test('saved sessions validate astrometry and NASA source links; v3 sessions still open',()=>{
 const d=json('data/neowise/nemesis.json');assert.equal(validateCase(structuredClone(d)).frames.length,6);const e=structuredClone(d);e.frames[0].products[0].url='javascript:alert(1)';assert.throws(()=>validateCase(e));const v=structuredClone(d);v.frames[0].wcs.CRVAL1+=1;assert.throws(()=>validateCase(v));
 assert.throws(()=>fitsURL('https://example.com/test.fits'));assert.throws(()=>fitsURL('https://irsa.ipac.caltech.edu:443@evil.test/ibe/data/spherex/x.fits'));assert.match(wiseURL({scan:'01998a',frame:152,band:2,archive:'wise'},q,'int'),/\/wise\/allsky\/4band_p1bm_frm\//);
});
test('SPHEREx identity uses its own spacecraft observer rather than a WISE or Earth ephemeris',async()=>{
 const original=globalThis.fetch;let requested='';try{globalThis.fetch=async url=>{if(String(url).includes('skybot'))return new Response(JSON.stringify([{Num:128,Name:'Nemesis','RA (hms)':'00 40 00','DEC (dms)':'+40 00 00',Class:'MBA'}]));requested=String(url);return new Response(JSON.stringify({signature:{version:'1.3'},result:'$$SOE\n2460865.5, , , 10, 40,\n$$EOE'}));};const r=await identify([{ra:10,dec:40,mjd:60865}],'spherex');assert.match(decodeURIComponent(requested),/500@-163182/);assert.equal(r.candidates.length,1);assert.match(r.observer,/SPHEREx/);}finally{globalThis.fetch=original;}
});
