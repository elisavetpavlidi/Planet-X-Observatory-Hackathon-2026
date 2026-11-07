/* EUREKA screening helpers. Quality advisories only; NEVER a discovery classifier. */
export const NOTE_SCHEMA='eureka-local-evidence/1';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function qualityReview(snapshot,classification='uncertain'){
 const frames=Array.isArray(snapshot?.frames)?snapshot.frames:[];
 const marks=Array.isArray(snapshot?.marks)?snapshot.marks:[];
 const flags=[];
 const flag=(code,text)=>flags.push({code,text});
 if(!frames.length){flag('no_frames','Load a real observation before recording evidence.');return {flags,comparable:false};}
 const bands=new Set(frames.map(f=>`${f.observer??''}:${f.band??''}`));
 const wave=frames.map(f=>f.wavelength_um).filter(finite);
 const differentWavelengths=wave.length>1&&Math.max(...wave)-Math.min(...wave)>1e-4;
 const comparable=frames.length>=2&&bands.size===1&&!differentWavelengths;
 if(frames.length<2)flag('single_frame','One frame cannot show temporal motion.');
 if(bands.size>1)flag('mixed_bands','Different detectors/bands: brightness changes are not evidence of motion.');
 if(differentWavelengths)flag('mixed_wavelengths','Different SPHEREx wavelengths: do not infer movement or variability from intensity changes.');
 if(frames.some(f=>f.inspection_only))flag('partial_inspection','At least one frame is for inspection only, not quantitative motion measurement.');
 if(frames.some(f=>finite(f.coverage)&&f.coverage<.7))flag('coverage','At least one frame has less than 70% valid coverage; inspect masks and edges.');
 if(marks.length<2)flag('few_marks','Fewer than two positions marked: motion cannot be measured from your marks.');
 if(snapshot?.identity?.candidate)flag('catalog_match',`A possible catalogue identification exists (${snapshot.identity.candidate}); this is not a new discovery.`);
 if(classification==='possible_motion'&&!comparable)flag('motion_caution','Do not treat this classification as evidence of physical motion with these observations.');
 if(classification==='possible_motion'&&marks.length<2)flag('no_motion_measurement','Additional independent source positions are needed to assess apparent motion.');
 return {flags,comparable};
}
export function evidenceRecord(snapshot,classification,confidence,note,recordedAt){
 if(!snapshot?.frames?.length)throw Error('Open a real observation first.');
 const kinds=new Set(['uncertain','possible_motion','no_motion','quality_issue']);
 if(!kinds.has(classification))throw Error('Invalid classification.');
 if(!['low','medium','high'].includes(confidence))throw Error('Invalid confidence.');
 const cleaned=String(note??'').trim();
 if(cleaned.length<8||cleaned.length>1000)throw Error('Write 8–1000 characters of observation notes.');
 const active=snapshot.frames[snapshot.activeIndex]||snapshot.frames[0];
 const review=qualityReview(snapshot,classification);
 const time=recordedAt||new Date().toISOString();
 const frameList=snapshot.frames.map(f=>({id:f.id??null,observer:f.observer??null,archive:f.archive??null,mjd:f.mjd??null,band:f.band??null,wavelength_um:f.wavelength_um??null,coverage:f.coverage??null,inspection_only:!!f.inspection_only,products:(f.products||[]).map(p=>({kind:p.kind,sha256:p.sha256||null,url:p.url||null}))}));
 return {schema:NOTE_SCHEMA,id:`note-${time.replace(/[^0-9]/g,'')}-${Math.random().toString(36).slice(2,9)}`,recorded_at:time,source:'local-browser-prototype',review_status:'unverified-not-submitted',classification,confidence,note:cleaned,active_frame_id:active.id||null,active_mjd:active.mjd??null,archive:snapshot.query?.archive||active.archive||null,query:snapshot.query||null,frames:frameList,marks:(snapshot.marks||[]).map(p=>({frame:p.frame,mjd:p.mjd,ra:p.ra,dec:p.dec,x:p.x,y:p.y,origin:p.origin,method:p.method})),motion:snapshot.motion||null,identity:snapshot.identity||null,quality_flags:review.flags,comparable_observations:review.comparable};
}

/** Local screening is NOT a discovery classifier and has no researcher authentication. */
export function screenCandidate(rec){
 if(!rec||rec.schema!==NOTE_SCHEMA)return {code:'invalid',label:'Invalid record',detail:'Record format is not recognized.',eligible:false};
 const answer=(code,label,detail,eligible=false)=>({code,label,detail,eligible});
 if(rec.activity_type!=='survey')return answer('training','Example / field study','Training data and curated field studies are not unknown-candidate submissions.');
 if(rec.classification!=='possible_motion')return answer('unclassified','Observation only','The volunteer has not selected possible motion.');
 const flags=Array.isArray(rec.quality_flags)?rec.quality_flags:[];
 if(!rec.comparable_observations||flags.some(f=>['mixed_bands','mixed_wavelengths','motion_caution','partial_inspection','coverage'].includes(f.code)))return answer('incompatible','Check image compatibility','Possible false motion from band, wavelength, masks or insufficient coverage.');
 const marks=Array.isArray(rec.marks)?rec.marks:[];
 const epochs=new Set(marks.filter(p=>typeof p.mjd==='number'&&Number.isFinite(p.mjd)).map(p=>Math.round(p.mjd*86400)));
 if(epochs.size<3)return answer('epochs','More independent epochs needed','At least three separate dated source positions are required for this preliminary screening.');
 if(rec.identity?.candidate)return answer('catalog','Possible known-body match','The original observatory returned a potential catalog/ephemeris identification; follow up before considering anything unclassified.');
 if(!rec.identity?.checked)return answer('identity','Catalog check not recorded','Run Check identity in Advanced tools, or record why external checks could not be completed.');
 return answer('manual','Unmatched in limited check · expert review needed','No candidate was returned by this limited identification check. This DOES NOT establish a new or unknown astronomical object.',true);
}
