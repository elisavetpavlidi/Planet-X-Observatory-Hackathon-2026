import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReferenceCases} from '../scripts/build_reference.mjs';
import {validateCase} from '../web/cases.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('the complete offline rebuild produces exactly the four release sessions without service access',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Network is forbidden during reproduction')};
 try{const rebuilt=await buildReferenceCases();assert.equal(rebuilt.size,4);for(const[path,content]of rebuilt){assert.equal(content,await readFile(resolve(root,path),'utf8'));validateCase(JSON.parse(content));}}finally{globalThis.fetch=original;}
});
test('corrupted original FITS stop reconstruction before image processing or a network fallback',async t=>{
 const dir=await mkdtemp(resolve(tmpdir(),'planetx-integrity-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const spec=JSON.parse(await readFile(resolve(root,'data/neowise/reference.json'),'utf8'));
 await mkdir(resolve(dir,'data/neowise'),{recursive:true});await writeFile(resolve(dir,'data/neowise/reference.json'),JSON.stringify(spec));
 const path='data/neowise/'+spec.observations[0].products[0].file,bytes=await readFile(resolve(root,path));bytes[100]^=1;
 await mkdir(dirname(resolve(dir,path)),{recursive:true});await writeFile(resolve(dir,path),bytes);
 await assert.rejects(buildReferenceCases(dir),/Input checksum mismatch/);
});
test('older saved SPHEREx sessions map their original FITS hashes to the canonical local paths',async()=>{
 const session=JSON.parse(await readFile(resolve(root,'data/reference/m31/session.json'),'utf8'));
 session.frames[0].products[0].path='earlier-release/observation_A.fits';
 const imported=validateCase(session);assert.equal(imported.frames[0].products[0].path,'data/reference/m31/observation_A.fits');
 session.frames[0].products[0].sha256='0'.repeat(64);assert.throws(()=>validateCase(session),/Invalid image data/);
});
