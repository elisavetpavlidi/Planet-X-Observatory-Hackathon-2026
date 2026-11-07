// Verify that every original non-UI file remains byte-for-byte identical to the pinned baseline.
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('PACKAGE_MANIFEST.json',root)));
const PATCHED=new Set(['web/index.html','web/app.mjs','web/server.mjs']);
let verified=0;
for(const {path,sha256,size_bytes} of manifest.files){
 const url=new URL(path,root);if(!existsSync(url))throw Error(`Baseline file missing: ${path}`);
 if(PATCHED.has(path))continue;
 const bytes=readFileSync(url);
 if(bytes.length!==size_bytes||createHash('sha256').update(bytes).digest('hex')!==sha256)throw Error(`Pinned baseline modified: ${path}`);
 verified++;
}
for(const file of ['web/eureka.mjs','web/eureka-quality.mjs','web/eureka.css','web/eureka-eye.png','web/eureka-tutorial.mp4','web/eureka-tutorial.vtt'])if(!existsSync(new URL(file,root)))throw Error(`EUREKA asset missing: ${file}`);
console.log(`EUREKA preservation check: ${verified} original manifest files match byte-for-byte; ${PATCHED.size} UI/server files intentionally extended.`);
console.log('Important: PACKAGE_MANIFEST.json is an unmodified *original* release reference, not a manifest of the branded EUREKA variant.');
