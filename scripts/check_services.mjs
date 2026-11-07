// Optional live service check: real public queries, never part of offline startup.
import {discover,loadObservation} from '../web/archive.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
const base={ra:64.085,dec:22.8,width:8,band:2,detector:4,quality:'all'},cases=[
 {...base,archive:'neowise',start:'2019-02-02',end:'2019-02-03'},
 {...base,archive:'wise',start:'2010-02-01',end:'2010-02-28'},
 {...base,archive:'wise3',ra:56.75,dec:24.1167,start:'2010-08-06',end:'2010-09-30'},
 {...base,archive:'wise2',start:'2010-10-01',end:'2011-02-01'},
 {...base,archive:'spherex_qr2',ra:10.6847,dec:41.2688,start:'2025-07-09',end:'2025-07-09'},
 {...base,archive:'spherex_qr3',ra:10.6847,dec:41.2688,start:'2026-09-01',end:'2026-09-30'}];
const report={checked_at:new Date().toISOString(),node:process.version,scope:'Live metadata and one cutout per nonempty selected release. An empty result is not an image-validation pass.',results:[]};
for(const q of cases){console.log('Checking',q.archive,q.start,q.end);const result={query:q};try{const r=await discover(q);result.total=r.total;result.search_url=r.search_url;result.metadata='passed';const failures=[];for(const row of r.observations.slice(0,3)){try{const f=await loadObservation(row,q);result.image={id:f.id,n:f.n,coverage:f.coverage,mjd:f.mjd,wavelength_um:f.wavelength_um,products:f.products};break;}catch(e){failures.push({key:row.key,error:e.message});}}result.image_failures=failures;}catch(e){result.error=e.message;result.code=e.code;}report.results.push(result);console.log(JSON.stringify(result));}
const target=process.argv[2]||'outputs/service-checks.json';await mkdir(new URL('../outputs/',import.meta.url),{recursive:true});await writeFile(target,JSON.stringify(report,null,2)+'\n');console.log('Saved',target);if(report.results.some(r=>r.error||r.total>0&&!r.image))process.exitCode=1;
