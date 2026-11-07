import test from 'node:test';
import assert from 'node:assert/strict';
import {trainingField,evaluateTrack,classifyCatalog} from '../web/eureka-scout-quality.mjs';
const frames=[0,1,2].map(i=>({id:'f'+i,observer:'wise',archive:'neowise',band:2,coverage:.99,mjd:58000+i*.1}));
const points=[0,1,2].map(i=>({frame:i,mjd:58000+i*.1,ra:20+i*.001,dec:2+i*.002}));
const track={index:0,points,motion:{status:'moving',independent_epochs:3,shift_arcsec:14.3}};
test('known 128 Nemesis demonstration cannot join the unknown-source queue',()=>{
 const q={archive:'neowise',ra:64.085,dec:22.8,start:'2019-02-02',end:'2019-02-03'};
 assert.ok(trainingField(q));assert.equal(evaluateTrack(track,frames,q).eligible,false);
});
test('measured motion permits only catalog screening, not discovery',()=>{
 const r=evaluateTrack(track,frames,{archive:'neowise',ra:20,dec:2});assert.equal(r.eligible,true);assert.match(r.label,/check identity/);
});
test('bad coverage, missing epochs and unmeasured motion remain excluded',()=>{
 assert.equal(evaluateTrack(track,frames.map((f,i)=>i===0?{...f,coverage:.5}:f)).eligible,false);
 assert.equal(evaluateTrack({...track,points:points.slice(0,2)},frames).eligible,false);
 assert.equal(evaluateTrack({...track,motion:{status:'review',independent_epochs:3}},frames).eligible,false);
});
test('not matching the bounded catalog is not a discovery or known unknown',()=>{
 const r=classifyCatalog({candidates:[]});assert.equal(r.unmatched,true);assert.match(r.detail,/does NOT prove/);
});
test('catalog failure cannot be classified as an unmatched object',()=>{
 const r=classifyCatalog(null,new Error('offline'));assert.equal(r.unmatched,false);assert.equal(r.code,'unavailable');
});
test('known-body candidates are held for ephemeris review',()=>{
 const r=classifyCatalog({candidates:[{name:'128 Nemesis'}]});assert.equal(r.unmatched,false);assert.match(r.detail,/128 Nemesis/);
});
test('v5 wires candidate scanner controls and no fake discovery records',async()=>{
 const {readFileSync}=await import('node:fs');const s=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
 for(const id of ['e-scout-new-field','e-scout-scan','e-scout-next','e-scout-export','e-scout-results'])assert.ok(s.includes(`id="${id}"`));
 assert.ok(s.includes('/eureka-scout.mjs'));assert.match(s,/not a pre-populated list of discoveries/i);
});

test('the actual nine-frame NEOWISE release contains one moving track, but is excluded as training',async()=>{
 const {readFileSync}=await import('node:fs');
 const {detectTracks}=await import('../web/model.mjs');
 const {assessSelection}=await import('../web/motion.mjs');
 const data=JSON.parse(readFileSync(new URL('../data/neowise/consecutive.json',import.meta.url),'utf8'));
 const tracks=detectTracks(data.frames);assert.equal(tracks.length,1);
 const pts=tracks[0].points.map(p=>({...p,origin:'automatic',method:'raw-pixel aperture centroid'}));
 const motion=assessSelection(pts,data.frames);assert.equal(motion.status,'moving');
 const record={points:pts,motion};assert.equal(evaluateTrack(record,data.frames,data.query).eligible,false);
});
