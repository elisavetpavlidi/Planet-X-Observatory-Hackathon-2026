/** EUREKA field scout. Uses only the original real-data engine and catalog API. */
import {evaluateTrack,classifyCatalog,trainingField} from './eureka-scout-quality.mjs';
const $=id=>document.getElementById(id);
let view=null,rows=[],busy=false,controller=null,scanId=0;
const setStatus=s=>{$('e-scout-status').textContent=s;};
const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
function reset(){rows=[];$('e-scout-results').replaceChildren();$('e-scout-export').disabled=true;}
function isTraining(){return !!view?.catalog?.bundled||trainingField(view?.query);}
function updateControls(){const v=!!view?.frames?.length;$('e-scout-scan').disabled=!v||busy;
 $('e-scout-next').disabled=busy||!view?.catalog||view.catalog.bundled||view.catalog.batchStart+12>=view.catalog.total;
 $('e-scout-export').disabled=!rows.some(r=>r.catalog?.unmatched);
 $('e-scout-count').textContent=v?`${view.frames.length} loaded images · ${view.catalog?.total??view.frames.length} archived observations`:'No sky observations loaded yet';
 if(!busy&&!v)setStatus('Search a real sky field or open a training example first. Nothing has been identified as unknown.');}
window.addEventListener('eureka:observation-state',ev=>{
 const old=view?.frames?.map(f=>f.key||f.id).join('|')||'',next=ev.detail?.frames?.map(f=>f.key||f.id).join('|')||'';
 view=ev.detail;if(old!==next){scanId++;controller?.abort();busy=false;reset();setStatus(view.frames?.length?'Real images loaded. Run the candidate scan to examine possible tracks in this group.':'No images loaded. Choose a sky field and find observations.');}
 updateControls();
});
function card(row){const el=node('article','e-scout-item');const head=node('div','e-scout-item-head');const type=node('strong','',`Possible track ${row.index+1}`),flag=node('span','e-scout-tag e-scout-tag-'+row.catalog.code,row.catalog.label);head.append(type,flag);el.append(head);
 const p=node('p','',`${row.track.points.length} marked positions · shift ${Number(row.track.motion?.shift_arcsec||0).toFixed(1)} arcsec · ${row.track.motion?.status||'unverified'}`);el.append(p,node('p','',row.catalog.detail));
 const buttons=node('div','e-scout-actions');const inspect=node('button','e-btn e-btn-light','Inspect this track →');inspect.type='button';inspect.onclick=()=>{window.dispatchEvent(new CustomEvent('eureka:select-track',{detail:{index:row.index}}));$('observatory').scrollIntoView({behavior:'smooth'});};buttons.append(inspect);el.append(buttons);return el;}
function showRows(){const results=$('e-scout-results');results.replaceChildren();for(const row of rows)results.append(card(row));
 if(!rows.length)results.append(node('p','e-scout-empty','No automatically measurable tracks in these images. Try another observation group, inspect manually, or search another field. A non-detection is not a discovery.'));
 $('e-scout-export').disabled=!rows.some(x=>x.catalog.unmatched);
}
async function scan(){if(!view?.frames?.length||busy)return;const v=view,myScan=++scanId;controller=new AbortController();busy=true;reset();updateControls();
 try{
  const tracks=(v.tracks||[]).slice(0,6);
  if(!tracks.length){setStatus('No automatic moving-source tracks found in this loaded batch. This does not exclude faint or slow objects.');showRows();return;}
  if(isTraining()){for(const track of tracks)rows.push({index:track.index,track,catalog:{code:'training',label:'Curated example',detail:'This saved teaching or field-study dataset cannot enter the unknown-source queue.',unmatched:false}});setStatus(trainingField(v.query)?'Known training field: 128 Nemesis cannot enter the unknown-source queue. Search another sky field.':'Curated field-study example: this is not an unknown-source search. Choose a new field.');showRows();return;}
  for(let i=0;i<tracks.length;i++){
   if(myScan!==scanId)return;
   const track=tracks[i],test=evaluateTrack(track,v.frames,v.query);
   let catalog={code:test.code,label:test.label,detail:test.detail,unmatched:false};
   if(test.eligible){setStatus(`Checking possible moving track ${i+1} / ${tracks.length} against catalog services…`);
    try{const response=await fetch('/api/identify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({observer:v.frames[0].observer||'wise',points:track.points.map(p=>({ra:p.ra,dec:p.dec,mjd:p.mjd}))}),signal:controller.signal});
     if(!response.ok)throw Error((await response.json().catch(()=>({}))).error||'Catalog request failed');
     catalog=classifyCatalog(await response.json());
    }catch(e){if(e.name==='AbortError')return;catalog=classifyCatalog(null,e);}
   }
   rows.push({index:track.index,track,catalog,images:v.frames.map(f=>({id:f.id,mjd:f.mjd,archive:f.archive,observer:f.observer,band:f.band,wavelength_um:f.wavelength_um,coverage:f.coverage,products:f.products}))});showRows();
  }
  setStatus(`${tracks.length} automatic track(s) reviewed · ${rows.filter(r=>r.catalog.unmatched).length} without a match in the limited check. None is a confirmed discovery.`);
 }finally{if(myScan===scanId){busy=false;updateControls();}}
}
$('e-scout-scan').addEventListener('click',scan);
$('e-scout-next').addEventListener('click',()=>{if(busy)return;window.dispatchEvent(new Event('eureka:next-batch'));setStatus('Loading the next group of real archive images…');});
$('e-scout-export').addEventListener('click',()=>{
 const unmatched=rows.filter(r=>r.catalog.unmatched);if(!unmatched.length)return;
 const payload={schema:'eureka-scout-provisional/1',source:'NASA/IPAC original image explorer',verified_discovery:false,independent_expert_review:false,submitted_to_nasa:false,catalog_check:'bounded, non-exhaustive',created_at:new Date().toISOString(),query:view.query,tracks:unmatched.map(r=>({index:r.index,points:r.track.points,motion:r.track.motion,images:r.images,catalog:r.catalog}))};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='EUREKA_scout_unverified_candidates.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
 setStatus('Evidence package downloaded locally. No researchers were notified and no discovery was claimed.');
});
$('e-scout-new-field').addEventListener('click',()=>{
 const ra=(Math.random()*360),dec=Math.asin(Math.random()*2-1)*180/Math.PI;
 $('ra').value=ra.toFixed(5);$('dec').value=dec.toFixed(5);$('target').value='';
 $('archive').value='neowise';$('archive').dispatchEvent(new Event('change',{bubbles:true}));
 $('start').value='2019-01-01';$('end').value='2019-07-01';$('band').value='2';
 for(const id of ['ra','dec'])$(id).dispatchEvent(new Event('input',{bubbles:true}));
 const showAdvanced=$('e-advanced-toggle');if(showAdvanced?.getAttribute('aria-expanded')==='false')showAdvanced.click();
 $('observatory').scrollIntoView({behavior:'smooth'});
 setStatus(`A random sky position was selected (RA ${ra.toFixed(2)}°, Dec ${dec.toFixed(2)}°). Click “Find observations”. Availability and motion are not guaranteed.`);
});
updateControls();
