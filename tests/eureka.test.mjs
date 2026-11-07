import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qualityReview,evidenceRecord,NOTE_SCHEMA} from '../web/eureka-quality.mjs';
const spherex={query:{archive:'spherex_qr2',ra:10.68,dec:41.26},activeIndex:0,frames:[
 {id:'SPX-A',observer:'spherex',archive:'spherex_qr2',band:4,mjd:60865,wavelength_um:2.301,coverage:.98,products:[{kind:'int',sha256:'abc'}]},
 {id:'SPX-B',observer:'spherex',archive:'spherex_qr2',band:4,mjd:61040,wavelength_um:2.42,coverage:.97,products:[{kind:'int',sha256:'def'}]}],marks:[],motion:null,identity:null};
test('mixed SPHEREx wavelengths are NEVER presented as motion evidence',()=>{
 const q=qualityReview(spherex,'possible_motion');assert.equal(q.comparable,false);assert.ok(q.flags.some(f=>f.code==='mixed_wavelengths'));assert.ok(q.flags.some(f=>f.code==='motion_caution'));
});
test('well-matched repeated positions permit preliminary comparison but never assert discovery',()=>{
 const s={...spherex,frames:[{...spherex.frames[0]},{...spherex.frames[0],mjd:60865.1,id:'SPX-C'}],marks:[{frame:0,mjd:60865,ra:10,dec:40},{frame:1,mjd:60865.1,ra:10.1,dec:40.1}]};
 const q=qualityReview(s,'possible_motion');assert.equal(q.comparable,true);assert.equal(q.flags.some(f=>f.code==='mixed_wavelengths'),false);
 const note=evidenceRecord(s,'possible_motion','medium','A pattern worth checking.','2026-11-07T11:00:00.000Z');
 assert.equal(note.schema,NOTE_SCHEMA);assert.equal(note.review_status,'unverified-not-submitted');assert.equal(note.frames[0].products[0].sha256,'abc');assert.equal(note.marks.length,2);
});
test('partial / low-coverage frames warn and notes retain provenance',()=>{
 const s={...spherex,frames:[{...spherex.frames[0],coverage:.44,inspection_only:true}]};
 const q=qualityReview(s);assert.ok(q.flags.some(f=>f.code==='partial_inspection'));assert.ok(q.flags.some(f=>f.code==='coverage'));
 const note=evidenceRecord(s,'uncertain','low','Partial source on the margin.','2026-11-07T11:00:00.000Z');assert.ok(note.quality_flags.length>=2);
});
test('invalid and empty annotations are rejected',()=>{
 assert.throws(()=>evidenceRecord(null,'uncertain','low','Too short'));
 assert.throws(()=>evidenceRecord(spherex,'discovery','high','This is definitely new.'));
 assert.throws(()=>evidenceRecord(spherex,'uncertain','low','short'));
});
test('new UI retains every original data-example preset and original app controls',()=>{
 const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
 for(const kind of ['nemesis-focus','neowise','sequence','spherex','atlas','pleiades','m101'])assert.ok(html.includes(`data-example="${kind}"`));
 for(const id of ['sky','timeline','play','search-form','identify','catalog-rows','selection','candidates'])assert.ok(html.includes(`id="${id}"`));
 assert.ok(html.includes('No scientific background needed. Just curiosity.'));
 assert.ok(!html.includes('may exist far beyond Neptune'));
});
