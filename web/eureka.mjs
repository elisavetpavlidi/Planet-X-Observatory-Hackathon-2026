/* EUREKA interaction layer. The scientific engine remains the original app.mjs. */
import {qualityReview,evidenceRecord,screenCandidate,NOTE_SCHEMA} from './eureka-quality.mjs';
const $=id=>document.getElementById(id);
const KEY='eureka.local.evidence.v2',MAX_NOTES=120;
let snapshot=null,records=[],storageAvailable=true,step=0;
let investigationPending=false,searchCleared=false;
try {const x=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(x)) records=x.filter(n=>n&&n.schema===NOTE_SCHEMA&&typeof n.note==='string').slice(-MAX_NOTES);}catch{storageAvailable=false;}
const nowIsoMjd=mjd=>typeof mjd==='number'&&Number.isFinite(mjd)?new Date((mjd-40587)*86400000).toISOString().slice(0,19).replace('T',' ')+' UTC':'unknown time';
function persist(){try{localStorage.setItem(KEY,JSON.stringify(records));storageAvailable=true;}catch{storageAvailable=false;notify('Your browser cannot save these notes persistently. Export JSON now.',true);}}
function notify(msg,error=false){const el=$('e-note-feedback');el.textContent=msg;el.className=error?'e-note-error':'e-note-success';}
function element(tag,cls,txt){const node=document.createElement(tag);if(cls)node.className=cls;if(txt!==undefined)node.textContent=txt;return node;}
function reviewDisplay(){const panel=$('e-checklist');panel.replaceChildren();if(!snapshot?.frames?.length){panel.append(element('li','', 'Load an observation to see the quality checks.'));return;}
 const r=qualityReview(snapshot,$('e-class').value);
 if(r.comparable){panel.append(element('li','e-check-good','Observation bands/wavelengths are consistent for preliminary comparison.'));}
 if(!r.flags.length)panel.append(element('li','e-check-good','No automatic warnings. Scientific validation is still required.'));
 for(const f of r.flags)panel.append(element('li','e-check-alert',f.text));
}
function currentUpdate(){const frames=snapshot?.frames||[];const active=frames[snapshot?.activeIndex]||frames[0];const enabled=!!active;$('e-note-fields').disabled=!enabled||investigationPending;
 $('e-current-label').textContent=enabled?`${active.id||'Observation'} · ${frames.length} frame${frames.length===1?'':'s'}`:'No observation loaded';
 const wave=typeof active?.wavelength_um==='number'?` · ${active.wavelength_um.toFixed(4)} µm`:'';
 $('e-current-science').textContent=enabled?`${active.observer?.toUpperCase()||'NASA archive'}${wave} · ${nowIsoMjd(active.mjd)} · ${snapshot.marks?.length||0} selected position(s)`: 'Choose a starter mission or load observations in the original explorer.';
 reviewDisplay();
}
window.addEventListener('eureka:observation-state',ev=>{snapshot=ev.detail;
 if(investigationPending&&!snapshot?.frames?.length)searchCleared=true;
 else if(investigationPending&&searchCleared&&snapshot?.frames?.length){investigationPending=false;searchCleared=false;}
 currentUpdate();});
$('e-class').addEventListener('change',reviewDisplay);
function showRecords(){const total=records.length;$('e-note-count').textContent=String(total);
 const fields=new Set(records.map(n=>[n.archive,n.query?.ra,n.query?.dec].join(':')));
 $('e-cases-count').textContent=`${fields.size} field${fields.size===1?'':'s'} noted locally`;
 $('e-review-count').textContent=`${total} unverified record${total===1?'':'s'} — personal review only`;
 const list=$('e-note-list');list.replaceChildren();
 if(!total){list.append(element('p','e-empty-note','Your notebook is empty. Open a mission, compare images, and save your first evidence-linked note.'));renderReviewDesk();return;}
 for(const n of records.slice(-8).reverse()){
  const card=element('article','e-entry');const header=element('div','e-entry-top');header.append(element('strong','',n.classification.replaceAll('_',' ')),element('span','',n.recorded_at.slice(0,16).replace('T',' ')));card.append(header);
  card.append(element('p','e-entry-sub',`${n.archive||'NASA archive'} · ${n.active_frame_id||'field'} · ${n.marks?.length||0} position(s) marked`));
  card.append(element('p','',n.note));
  if(n.quality_flags?.length)card.append(element('small','e-entry-warning',`${n.quality_flags.length} science caution${n.quality_flags.length===1?'':'s'} in export`));
  list.append(card);
 }
 renderReviewDesk();
}
$('e-note-form').addEventListener('submit',e=>{e.preventDefault();if(!$('e-note-ack').checked)return;
 try{const rec=evidenceRecord(snapshot,$('e-class').value,$('e-confidence').value,$('e-note-text').value);rec.activity_type=selectedKind.startsWith('nemesis')||selectedKind==='neowise'||selectedKind==='sequence'?'training':fieldKinds.has(selectedKind)?'field_study':'survey';records.push(rec);records=records.slice(-MAX_NOTES);persist();showRecords();$('e-note-text').value='';$('e-note-ack').checked=false;notify(storageAvailable?'Saved on this device. Export JSON to retain a portable copy.':'Stored for this session only. Export now.');}
 catch(err){notify(err.message,true);}
});
function download(name,body,type){const blob=new Blob([body],{type}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),5000);}
function csvCell(v){let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
$('e-download-json').addEventListener('click',()=>{if(!records.length){notify('There are no local records to export.',true);return;}
 download('EUREKA_evidence_local.json',JSON.stringify({schema:'eureka-local-evidence-export/1',exported_at:new Date().toISOString(),records},null,2),'application/json');notify('JSON downloaded. These records have NOT been submitted to NASA.');});
$('e-download-csv').addEventListener('click',()=>{if(!records.length){notify('There are no local records to export.',true);return;}
 const fields=['recorded_at','archive','active_frame_id','active_mjd','activity_type','classification','confidence','review_status','comparable_observations','marked_positions','quality_flags','note'];
 const value=(n,key)=>key==='marked_positions'?n.marks?.length||0:key==='quality_flags'?n.quality_flags?.map(f=>f.code).join(';')||'':n[key];
 const csv=[fields.map(csvCell).join(','),...records.map(n=>fields.map(k=>csvCell(value(n,k))).join(','))].join('\r\n');
 download('EUREKA_evidence_local.csv','\ufeff'+csv,'text/csv;charset=utf-8');notify('CSV downloaded. Use JSON for full frame/provenance details.');});
$('e-clear-notes').addEventListener('click',()=>{if(!records.length)return;if(!confirm('Delete your local EUREKA notes from this browser? Export them first if needed.'))return;records=[];persist();showRecords();notify('Local notes cleared.');});
for(const b of document.querySelectorAll('[data-e-mission]'))b.addEventListener('click',()=>{const v=b.dataset.eMission;
 const original=document.querySelector(`[data-example="${v}"]`);
 if(!original){notify('This mission is not available in the original observatory.',true);return;}
 original.click();$('observatory').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
});
const tutorial=[
 {title:'1. Search the real sky',body:'Choose a sky coordinate or target and an available date range. Start with a known asteroid to learn, then try a different field to investigate an unclassified candidate.'},
 {title:'2. Look for independent evidence',body:'Find comparable images from different times, mark the same source, examine masks and timestamps, and check JPL for known objects. Different infrared wavelengths do not prove motion.'},
 {title:'3. Prepare a candidate for review',body:'Document positions and alternative explanations. Our private screening workbench checks basic completeness and can export a candidate package. Real community consensus and astronomer verification are not yet connected.'}
];
function showStep(){const t=tutorial[step];$('e-tutorial-content').replaceChildren(element('h3','',t.title),element('p','',t.body));$('e-tutorial-position').textContent=`${step+1} / 3`;$('e-tutorial-prev').disabled=step===0;$('e-tutorial-next').textContent=step===2?'Start a mission ↗':'Next →';}
$('e-start-tutorial').addEventListener('click',()=>{step=0;showStep();$('e-tutorial').showModal();});
$('e-tutorial-prev').addEventListener('click',()=>{step=Math.max(0,step-1);showStep();});
$('e-tutorial-next').addEventListener('click',()=>{if(step<2){step++;showStep();}else{$('e-tutorial').close();$('missions').scrollIntoView({behavior:'smooth'});}});
$('e-tutorial-close').addEventListener('click',()=>$('e-tutorial').close());
$('e-tutorial').addEventListener('click',e=>{if(e.target===$('e-tutorial'))$('e-tutorial').close();});
showRecords();currentUpdate();

// Beginner-first explorer: all original controls remain available in Advanced mode.
const advancedKey='eureka.advanced.v3';
let advanced=false;
try{advanced=localStorage.getItem(advancedKey)==='true';}catch{}
function setAdvanced(value){
 advanced=!!value;
 $('e-workspace').classList.toggle('e-simple-workspace',!advanced);
 $('e-workspace').classList.toggle('e-advanced-workspace',advanced);
 $('e-advanced-toggle').textContent=advanced?'Simple view · Hide advanced tools':'Show advanced tools';
 $('e-advanced-toggle').setAttribute('aria-expanded',String(advanced));
 try{localStorage.setItem(advancedKey,String(advanced));}catch{}
 window.dispatchEvent(new Event('resize'));
}
$('e-advanced-toggle').addEventListener('click',()=>setAdvanced(!advanced));
setAdvanced(advanced);

const fieldKinds=new Set(['spherex','pleiades','m101','atlas']);
let selectedKind='';let investigationMode=false;
function updateActivityLabel(){
 const q=snapshot?.query||{};
 const isSpherex=String(q.archive||'').startsWith('spherex');
 const fieldExample=fieldKinds.has(selectedKind);
 const noFrames=!snapshot?.frames?.length;
 // SPHEREx is an instrument, not a blanket ban on motion studies: only curated gallery cases are inspection-only.
 const staticField=fieldExample;
 const mode=$('e-observation-mode'),title=$('e-observation-title'),description=$('e-observation-description');
 mode.className='e-category-pill '+(staticField?'e-category-field':'e-category-motion');
 if(noFrames||investigationPending){mode.textContent=investigationMode?'OPEN-SKY SEARCH':'GETTING STARTED';title.textContent=investigationMode?'Search real archive observations.':'Choose an example above.';description.textContent=investigationMode?'Enter a sky position, archive and dates in the research search panel. Data availability and compatibility determine what can be inspected.':'Start with the known asteroid to practice frame-by-frame comparison. The advanced research controls are optional.';}
 else if(staticField){
  mode.textContent='FIELD INSPECTION · NOT A MOTION CANDIDATE';
  title.textContent='SPHEREx field study';
  description.textContent='This example is for visual, wavelength and quality inspection. Galaxies and star clusters here are not candidate moving objects. Do not interpret different infrared brightnesses as motion.';
 }else if(selectedKind){
  mode.textContent='KNOWN ASTEROID · MOTION EXERCISE';
  title.textContent='Known asteroid 128 Nemesis · learning example';
  description.textContent='Compare NEOWISE frames, follow a possible track, and check the evidence. The object is known; this does not represent a new discovery.';
 }else{
  mode.textContent='OPEN-SKY INVESTIGATION · UNVERIFIED';
  title.textContent='Investigate this real sky field';
  description.textContent='Select the same source in independent compatible images. Use Check identity. A track or absent catalog match does not mean a new discovery.';
 }
 const opt=$('e-motion-option');opt.disabled=staticField;
 if(staticField&&$('e-class').value==='possible_motion')$('e-class').value='uncertain';
 $('e-candidate-heading').firstChild.textContent=staticField?'Field features ':'Possible tracks ';
 reviewDisplay();
}
window.addEventListener('eureka:observation-state',updateActivityLabel);
for(const btn of document.querySelectorAll('[data-example]')){
 btn.addEventListener('click',()=>{selectedKind=btn.dataset.example;investigationPending=false;searchCleared=false;});
}
for(const btn of document.querySelectorAll('[data-e-mission]')){
 btn.addEventListener('click',()=>{selectedKind=btn.dataset.eMission;investigationPending=false;searchCleared=false;});
}
// A fresh manual search has its own scientific classification; it is not a curated motion claim.
$('search-form').addEventListener('submit',()=>{selectedKind='';investigationMode=true;investigationPending=true;searchCleared=false;},{capture:true});
$('import').addEventListener('click',()=>{selectedKind='';investigationMode=true;});
updateActivityLabel();

// Video replay uses the native browser controls; interactive steps remain available separately.
$('e-video-replay').addEventListener('click',async()=>{
 const video=$('e-video-player');video.currentTime=0;
 video.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
 try{await video.play();}catch{video.focus();}
});
$('e-start-tutorial-video').addEventListener('click',()=>$('e-start-tutorial').click());


// Investigation-first affordances. Existing authenticated remote search is NOT invented.
function beginInvestigation(){
 selectedKind='';investigationMode=true;investigationPending=true;searchCleared=false;setAdvanced(true);currentUpdate();updateActivityLabel();
 $('archive').value='neowise';$('archive').dispatchEvent(new Event('change',{bubbles:true}));
 $('observatory').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 $('target').focus({preventScroll:true});
 $('target').placeholder='Type a target name, or use Choose on sky / RA and Dec';
}
// Keep the first search usable when switching mission time ranges.
$('archive').addEventListener('change',()=>{
 const sph=$('archive').value.startsWith('spherex');
 if(sph&&$('start').value<'2025-01-01'){$('start').value='2025-12-15';$('end').value='2025-12-17';}
 if(!sph&&$('start').value>'2024-12-31'){$('start').value='2024-01-01';$('end').value='2024-01-03';}
});
$('e-hero-discover').addEventListener('click',beginInvestigation);
$('e-discovery-open').addEventListener('click',beginInvestigation);

// Portable but explicitly LOCAL/UNVERIFIED candidate screening and reviewer notes.
function renderReviewDesk(){
 const host=$('e-review-list');host.replaceChildren();
 const candidates=records.filter(n=>n.activity_type==='survey'&&n.classification==='possible_motion');
 const ready=candidates.filter(n=>screenCandidate(n).eligible);
 $('e-candidate-review-summary').textContent=`${candidates.length} possible-motion note${candidates.length===1?'':'s'} · ${ready.length} pass preliminary checks`;
 if(!candidates.length){host.append(element('p','e-review-empty','No independent candidate records yet. The known asteroid exercise never enters this queue.'));return;}
 for(const n of candidates.slice(-30).reverse()){
  const screening=screenCandidate(n),item=element('article','e-review-item'),head=element('div','e-review-item-head');
  head.append(element('strong','',`${n.archive||'NASA archive'} · ${n.active_frame_id||'field'}`),element('span','e-screen-status '+(screening.eligible?'e-screen-ready':screening.code==='catalog'?'e-screen-caution':''),screening.label));
  item.append(head,element('small','',`${n.recorded_at?.slice(0,16)||'Date not recorded'} · ${n.marks?.length||0} positions · ${n.frames?.length||0} frames`),element('p','',n.note),element('p','',screening.detail));
  const row=element('div','e-review-controls'),label=element('label','', 'My local review: '),select=element('select');
  select.setAttribute('aria-label',`Local triage for ${n.id}`);
  for(const [value,caption] of [['not_reviewed','Not reviewed'],['needs_followup','Needs more evidence'],['artifact_or_known','Likely known / artifact — check'],['export_for_expert','Prepare for external expert review']]){
   const opt=element('option','',caption);opt.value=value;select.append(opt);
  }
  select.value=n.local_triage?.decision||'not_reviewed';
  select.addEventListener('change',()=>{n.local_triage={decision:select.value,at:new Date().toISOString(),method:'self-annotation-no-independent-review'};persist();$('e-review-feedback').textContent='Saved local review label. No astronomer was notified.';});
  row.append(label,select);item.append(row);host.append(item);
 }
}
$('e-export-review').addEventListener('click',()=>{
 const candidates=records.filter(n=>n.activity_type==='survey'&&n.classification==='possible_motion');
 if(!candidates.length){$('e-review-feedback').textContent='No candidate records yet. Investigate a field and mark possible motion first.';return;}
 const exportData={schema:'eureka-provisional-review-package/1',not_a_discovery:true,independent_expert_review:false,submitted_to_nasa:false,exported_at:new Date().toISOString(),records:candidates.map(n=>({...n,screening:screenCandidate(n)}))};
 download('EUREKA_provisional_candidates.json',JSON.stringify(exportData,null,2),'application/json');
 $('e-review-feedback').textContent=`Downloaded ${candidates.length} provisional case(s). Send this file yourself to a qualified reviewer; no online submission occurred.`;
});
$('e-import-review').addEventListener('click',()=>$('e-review-import-file').click());
$('e-review-import-file').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  if(file.size>2_000_000)throw Error('File must be under 2 MB.');
  const data=JSON.parse(await file.text());
  if(!['eureka-provisional-review-package/1','eureka-local-evidence-export/1'].includes(data?.schema)||!Array.isArray(data.records))throw Error('This is not an EUREKA evidence export.');
  let count=0;const ids=new Set(records.map(n=>n.id));
  for(const n of data.records.slice(0,MAX_NOTES)){
   if(n?.schema!==NOTE_SCHEMA||typeof n.note!=='string'||n.note.length>1000||typeof n.id!=='string'||n.id.length>90||ids.has(n.id)||!Array.isArray(n.frames)||n.frames.length>30||!Array.isArray(n.marks)||n.marks.length>60)continue;
   // Imported files can carry untrusted screening/review claims; ignore those and rescreen locally.
   const copy={...n,screening:undefined,local_triage:undefined};records.push(copy);ids.add(copy.id);count++;
  }
  records=records.slice(-MAX_NOTES);persist();showRecords();
  $('e-review-feedback').textContent=`Imported ${count} unverified record(s). No external review claim was accepted.`;
 }catch(err){$('e-review-feedback').textContent=`Import failed: ${err.message}`;}
 finally{e.target.value='';}
});
renderReviewDesk();
