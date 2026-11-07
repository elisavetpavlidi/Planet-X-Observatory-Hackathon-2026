import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
try {
 const manifest=JSON.parse(await readFile(new URL('PACKAGE_MANIFEST.json',root),'utf8'));
 if(manifest.format!=='planetx-package/1'||!Array.isArray(manifest.files)||manifest.files.length>2000)throw Error('Invalid package manifest');
 for(const entry of manifest.files){
  if(!entry.path||entry.path.startsWith('/')||entry.path.split('/').includes('..'))throw Error('Invalid file path');
  const bytes=await readFile(new URL(entry.path,root));
  if(bytes.length!==entry.size_bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Missing or modified package content: '+entry.path);
 }
 console.log(`SHA256 verification: ${manifest.files.length} files match the reference package.`);
} catch(e){console.error(e.message);process.exitCode=1;}
