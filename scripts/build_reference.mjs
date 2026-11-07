/** Offline regeneration from original, hash-verified NASA/IPAC FITS. Never queries a service. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {processFrame} from '../web/services.mjs';
import {processSpherex} from '../web/archive.mjs';
import {findTracks} from '../web/science.mjs';
import {VERSION} from '../web/release.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function buildReferenceCases(root=ROOT){
 const json=async path=>JSON.parse(await readFile(resolve(root,path),'utf8'));
 const verified=async(path,expected)=>{
  if(path.startsWith('/')||path.split('/').includes('..')||!expected?.match(/^[a-f0-9]{64}$/))throw Error('Invalid reference input: '+path);
  const bytes=await readFile(resolve(root,path));
  if(sha256(bytes)!==expected)throw Error('Input checksum mismatch: '+path);
  return bytes;
 };
 const buildWise=async(spec,title)=>{
  if(spec.format!=='planetx-reference/1')throw Error('Unknown reference format.');
  const frames=[];
  for(const row of spec.observations){
   const products=[];
   for(const product of row.products)products.push({...product,bytes:await verified('data/neowise/'+product.file,product.sha256)});
   const frame=processFrame(row,spec.query,products);frame.observer='wise';frame.archive='neowise';frame.key=spec.catalog?.observations.find(r=>r.scan===row.scan&&r.frame===row.frame&&r.band===row.band)?.key||frame.id;frames.push(frame);
  }
  frames.sort((a,b)=>a.mjd-b.mjd);
  return {schema:'planetx-observation-case/1',version:VERSION,title,query:spec.query,search_url:spec.search_url,total:spec.catalog?.observations.length||frames.length,frames,tracks:findTracks(frames),selection:[],identity:null,
   provenance:{archive:'NASA/IPAC IRSA NEOWISE L1b single exposures',retrieved_on:spec.retrieved_on,selection:spec.selection,field_selection:'IRSA MOST, 128 Nemesis; target positions are withheld from the detection code',processing:'WCS SIN/TAN + SIP; common 2.75 arcsec grid; MAGZP=20; per-frame median background; official mask and uncertainty products; raw-pixel source apertures'},
   catalog:spec.catalog||{bundled:true,complete:false,observations:spec.observations.map(r=>({key:`${r.scan}${String(r.frame).padStart(3,'0')}-w${r.band}`,archive:'neowise',observer:'wise',scan:r.scan,frame:r.frame,band:r.band,mjd:r.mjd,loaded:true})),scope:spec.selection}};
 };
 const neowise=await buildWise(await json('data/neowise/reference.json'),'NEOWISE · 128 Nemesis'),frames=neowise.frames;
 const sequence=await buildWise(await json('data/neowise/sequence_reference.json'),'NEOWISE · consecutive field observations');
 const recorded=await json('data/neowise/catalog_2018_2019.json');
 const extended={...neowise,title:'NEOWISE · recorded 2018–2019 field',query:recorded.query,catalog:recorded.catalog,batchStart:recorded.catalog.observations.findIndex(r=>Math.abs(r.mjd-frames[0].mjd)<1e-7)};
 const manifest=await json('data/manifest.json'),spherexFrames=[];
 const query={ra:10.6847,dec:41.2688,width:8,band:2,detector:4,archive:'spherex_qr2',quality:'all',start:'2025-07-09',end:'2025-12-31',limit:12};
 for(const label of ['A','B']){
  const path=`data/reference/m31/observation_${label}.fits`,item=manifest.files.find(f=>f.path===path);
  const frame=processSpherex(await verified(path,item?.sha256),query);frame.key='bundled-spherex-'+label;frame.products[0].path=path;spherexFrames.push(frame);
 }
 const spherex={schema:'planetx-observation-case/1',version:VERSION,title:'SPHEREx · M31',query,frames:spherexFrames,selection:[],identity:null,
  provenance:{source:'User-supplied original SPHEREx FITS; original download URLs were not supplied.',interpretation:'Stationary M31 reference field. Incompatible local wavelengths; no temporal variability or motion claim.'},
  catalog:{bundled:true,complete:false,observations:spherexFrames.map((f,i)=>({key:f.key,archive:query.archive,observer:'spherex',id:f.id,band:f.band,detector:f.band,mjd:f.mjd,bundled:['A','B'][i],loaded:true})),scope:'Two original SPHEREx FITS; a recorded reference selection, not a complete archive query.'}};
 return new Map([['data/neowise/nemesis.json',JSON.stringify(neowise)],['data/neowise/consecutive.json',JSON.stringify(sequence)],['data/neowise/observations_2018_2019.json',JSON.stringify(extended)],['data/reference/m31/session.json',JSON.stringify(spherex)]]);
}
async function main(){
 const args=process.argv.slice(2),check=args.includes('--check'),flag=args.indexOf('--output');
 if(args.some((a,i)=>a!=='--check'&&a!=='--output'&&!(flag>=0&&i===flag+1))||flag>=0&&(!args[flag+1]||args[flag+1].startsWith('--')))throw Error('Usage: node scripts/build_reference.mjs [--check] [--output DIRECTORY]');
 const output=resolve(flag<0?resolve(ROOT,'outputs/reproduced'):args[flag+1]||'');
 // Always write outside source data. Regeneration must not invalidate the package manifest.
 if(output===ROOT.slice(0,-1)||output.startsWith(resolve(ROOT,'data')+'/')||output===resolve(ROOT,'data'))throw Error('Choose an output directory outside source data.');
 const results=await buildReferenceCases(),hashes=[];
 for(const [path,content]of results){
  const dest=resolve(output,path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,content);
  const expected=await readFile(resolve(ROOT,path));
  if(!expected.equals(Buffer.from(content)))throw Error('Regenerated output differs from release: '+path);
  hashes.push({path,sha256:sha256(content),bytes:Buffer.byteLength(content)});
 }
 const report={format:'planetx-reproduction/1',version:VERSION,original_inputs_verified:true,reference_outputs_match:true,network_required:false,outputs:hashes};
 await writeFile(resolve(output,'verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(`Planet X ${VERSION}: ${results.size} saved sessions rebuilt from original FITS; release hashes match.`);
 if(check)console.log('Deterministic regeneration verified. Source files were not modified.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
