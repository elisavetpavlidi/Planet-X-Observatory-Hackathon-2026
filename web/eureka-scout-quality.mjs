/* Conservative candidate triage. A catalog non-match is not a discovery. */
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function trainingField(q){
 return !!q&&q.archive==='neowise'&&Math.abs(Number(q.ra)-64.085)<.0001&&Math.abs(Number(q.dec)-22.8)<.0001&&String(q.start||'')<='2019-02-03'&&String(q.end||'')>='2019-02-02';
}
export function evaluateTrack(track,frames=[],query={}){
 if(trainingField(query))return {code:'training',label:'Known-asteroid field',detail:'This reference field contains 128 Nemesis. Use it for training, not a new-object claim.',eligible:false};
 if(!track||!Array.isArray(track.points)||track.points.length<3)return {code:'epochs',label:'Insufficient independent positions',detail:'Three independent dated source positions are required.',eligible:false};
 const m=track.motion||{};
 if(m.independent_epochs<3||m.status!=='moving')return {code:'motion',label:'Motion not established',detail:m.reason||'Only a scientifically consistent moving-source assessment can enter catalog screening.',eligible:false};
 const points=track.points;
 if(points.some(p=>![p.ra,p.dec,p.mjd].every(finite)))return {code:'coordinates',label:'Astrometry incomplete',detail:'Some positions have no valid sky coordinates or observation time.',eligible:false};
 const used=points.map(p=>frames[p.frame]);
 if(used.some(f=>!f||f.inspection_only||finite(f.coverage)&&f.coverage<.7))return {code:'quality',label:'Observation quality needs review',detail:'At least one marked frame is partial, poor coverage, or unavailable.',eligible:false};
 if(used.some(f=>f.observer!==used[0].observer||f.band!==used[0].band))return {code:'band',label:'Incompatible bands',detail:'Use comparable observations from the same instrument/band.',eligible:false};
 if(used[0].observer==='spherex'){
  const wavelengths=used.map(f=>f.wavelength_um);
  const widths=used.map(f=>f.bandwidth_um).filter(w=>finite(w)&&w>0);
  const tolerance=widths.length===used.length?.25*widths.sort((a,b)=>a-b)[Math.floor(widths.length/2)]:0;
  if(wavelengths.some(w=>!finite(w))||!tolerance||Math.max(...wavelengths)-Math.min(...wavelengths)>tolerance)return {code:'wavelength',label:'Wavelength review required',detail:'SPHEREx source wavelengths must be independently checked for compatibility.',eligible:false};
 }
 return {code:'checkable',label:'Possible moving source · check identity',detail:'Measured motion is preliminary. A known-body ephemeris check is needed before expert review.',eligible:true};
}
export function classifyCatalog(result,error){
 if(error)return {code:'unavailable',label:'Catalog verification unavailable',detail:'The external service failed or timed out. This is NOT a catalog non-match.',unmatched:false};
 if(!result||!Array.isArray(result.candidates))return {code:'unavailable',label:'Catalog verification incomplete',detail:'No valid catalog result was returned.',unmatched:false};
 if(result.candidates.length)return {code:'known',label:'Potential known-body match',detail:`Possible match: ${result.candidates.slice(0,3).map(x=>x.name).join(', ')}. Check the full track against the ephemeris.`,unmatched:false};
 return {code:'unmatched',label:'No match in limited check · needs expert review',detail:'No match was returned by this bounded catalog check. This does NOT prove a new or unknown object.',unmatched:true};
}
