import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evidenceRecord,screenCandidate,NOTE_SCHEMA,qualityReview} from '../web/eureka-quality.mjs';
const d={query:{archive:'neowise',ra:41,dec:10},activeIndex:0,
 frames:[0,1,2].map((i)=>({id:`f${i}`,mjd:60865+i*.1,observer:'wise',archive:'neowise',band:2,coverage:.99,products:[{kind:'int',sha256:'a'.repeat(64)}]})),
 marks:[0,1,2].map(i=>({frame:i,mjd:60865+i*.1,ra:41+i*.01,dec:10})),
 identity:{checked:true,candidate:null},motion:null};
const create=(state=d)=>{const e=evidenceRecord(state,'possible_motion','low','Maybe moving: compare independent epochs.', '2026-11-07T12:00:00.000Z');e.activity_type='survey';return e;};
test('unmatched, comparable motion record is ONLY eligible for HUMAN review, not confirmed',()=>{
 const r=screenCandidate(create());assert.equal(r.code,'manual');assert.equal(r.eligible,true);assert.match(r.detail,/DOES NOT/);
});
test('known training case is never included in unclassified-science pipeline',()=>{
 const c=create();c.activity_type='training';const r=screenCandidate(c);assert.equal(r.code,'training');assert.equal(r.eligible,false);
});
test('unmatched is NOT assumed when no JPL check was recorded',()=>{
 const c=create();c.identity=null;const r=screenCandidate(c);assert.equal(r.code,'identity');assert.equal(r.eligible,false);
});
test('possible matching known asteroid suppresses unclassified candidate status',()=>{
 const c=create();c.identity={checked:true,candidate:'128 Nemesis'};const r=screenCandidate(c);assert.equal(r.code,'catalog');assert.equal(r.eligible,false);
});
test('independent epochs must be at least three and scientifically comparable',()=>{
 const c=create();c.marks=c.marks.slice(0,2);assert.equal(screenCandidate(c).code,'epochs');
 const v=create();v.comparable_observations=false;assert.equal(screenCandidate(v).code,'incompatible');
});
test('SPHEREx mixed wavelengths cannot be elevated to a motion research candidate',()=>{
 const s={...d,frames:d.frames.map((f,i)=>({...f,observer:'spherex',archive:'spherex_qr2',wavelength_um:2+i*.04}))};const n=create(s);assert.equal(qualityReview(s,'possible_motion').comparable,false);assert.equal(screenCandidate(n).code,'incompatible');
});
test('main page has functional open-sky entry, review desk, tutorial, and separate SPHEREx gallery',()=>{
 const h=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
 for(const id of ['e-discovery-open','e-hero-discover','candidate-review','e-export-review','e-review-import-file','e-video-player','e-start-tutorial','e-advanced-toggle'])assert.ok(h.includes(`id="${id}"`),id);
 assert.match(h,/Investigate the unknown/);assert.match(h,/Training data|TRAINING|known asteroid/);
});
