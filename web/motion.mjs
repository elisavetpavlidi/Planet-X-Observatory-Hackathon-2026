import {angularSeparation,fitPixelMotion,stationaryReference,median} from './science.mjs';

function hasSourceAtMark(p,frame){
  if((frame.peaks||[]).some(q=>Math.hypot(p.x-q.x,p.y-q.y)<2&&q.snr>=7))return true;
  if(!Array.isArray(frame.image)||!Array.isArray(frame.variance))return false;
  const ring=[],core=[],x=Math.round(p.x),y=Math.round(p.y);
  for(let dy=-6;dy<=6;dy++)for(let dx=-6;dx<=6;dx++){
    const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=frame.n||yy>=frame.n)continue;
    const i=yy*frame.n+xx,value=frame.image[i],variance=frame.variance[i],radius=Math.hypot(dx,dy);
    if(value===null||!Number.isFinite(value))continue;
    if(radius>=4&&radius<=6)ring.push(value);
    if(radius<=2.5&&Number.isFinite(variance)&&variance>0)core.push({value,variance});
  }
  if(ring.length<8||core.length<3)return false;
  const background=median(ring),scatter=1.4826*median(ring.map(v=>Math.abs(v-background)));
  return core.some(v=>v.value-background>3*Math.max(Math.sqrt(v.variance),scatter,1e-12));
}
export function selectionMethod(points){
  if(points.length&&points.every(p=>p.origin==='automatic'))return 'automatic';
  if(points.some(p=>p.origin==='manual'||p.method==='manual'))return 'manual';
  return 'saved';
}

/** Image measurements, not a catalogue-driven or discovery-confirmation result. */
export function assessSelection(selection,frames){
  const points=[...selection].sort((a,b)=>a.mjd-b.mjd);
  const result={schema:'planetx-motion/1',algorithm:'common-grid-linear/2',status:'empty',label:'Select a source',method:selectionMethod(points),positions:points.length,independent_epochs:0,stationary_controls:0,shift_arcsec:null,displacement_arcsec:null,rate_arcsec_per_hour:null,duration_hours:null,fit_rms_arcsec:null,reason:'Mark the same source in successive observations, or select a suggested source.'};
  if(!points.length)return result;
  result.status='insufficient';result.label='One position marked';
  result.reason='Mark the same source in another observation to measure a change in position.';
  const independent=[];for(const p of points)if(!independent.length||p.mjd-independent.at(-1).mjd>=5/1440)independent.push(p);
  result.independent_epochs=independent.length;
  if(independent.length<2){if(points.length>1)result.reason='Choose observations at least five minutes apart; these marks are not independent epochs.';return result;}
  const first=independent[0],last=independent.at(-1),used=independent.map(p=>frames[p.frame]);
  if(used.some(f=>!f)){result.status='review';result.label='Check source positions';result.reason='A marked observation is missing.';return result;}
  const scale=used[0].scale||2.75,ref=stationaryReference(used),fit=fitPixelMotion(independent);
  result.stationary_controls=ref.count;result.duration_hours=(last.mjd-first.mjd)*24;
  result.displacement_arcsec=angularSeparation(first.ra,first.dec,last.ra,last.dec);
  result.shift_arcsec=Math.max(...independent.flatMap(p=>independent.map(q=>angularSeparation(p.ra,p.dec,q.ra,q.dec))));
  result.fit_rms_arcsec=fit?fit.rms*scale:null;
  const review=reason=>({...result,status:'review',label:'Measurement needs review',reason});
  if(used.some(f=>(f.observer||'wise')!==(used[0].observer||'wise')||f.band!==used[0].band||(f.scale||2.75)!==scale))return review('The marked images use different observers, bands or pixel scales. Inspect compatible observations before interpreting motion.');
  if(used[0].observer==='spherex'){
    const waves=independent.map(p=>p.wavelength_um),widths=independent.map(p=>p.bandwidth_um);
    if(waves.some(w=>!Number.isFinite(w))||widths.some(w=>!Number.isFinite(w)||w<=0))return review('Local SPHEREx wavelengths are unavailable at a mark. Select measured source peaks with known wavelengths.');
    const tolerance=.25*widths.reduce((s,w)=>s+w,0)/widths.length;
    if(Math.max(...waves)-Math.min(...waves)>tolerance)return review('The marked source has incompatible SPHEREx wavelengths. Appearance changes cannot be treated as motion.');
  }
  if(independent.some((p,i)=>{const f=used[i];if(!Array.isArray(f.image))return false;const v=f.image[Math.round(p.y)*f.n+Math.round(p.x)];return v===null||!Number.isFinite(v);} ))return review('A marked position is missing or masked. Keep only valid source measurements.');
  const weak=independent.filter((p,i)=>!hasSourceAtMark(p,used[i]));
  if(weak.length){result.review_frames=weak.map(p=>p.frame);return review('No clear source peak at observation '+weak.map(p=>p.frame+1).join(', ')+'. Recheck or remove those positions.');}
  const clickGuard=independent.some(p=>p.method!=='raw-pixel aperture centroid')?1.5:1;
  result.resolution_guard_arcsec=3*Math.max(clickGuard*scale,(ref.rms_pixels||0)*scale);
  if(result.shift_arcsec<=result.resolution_guard_arcsec){result.status='unresolved';result.label='No resolved motion';result.reason='The measured position changes are within the image and selection resolution.';return result;}
  const fixedMarks=independent.filter(p=>frames.filter((f,i)=>i!==p.frame&&(f.peaks||[]).some(q=>Math.hypot(p.x-q.x,p.y-q.y)<2)).length>=2);
  if(fixedMarks.length>=Math.max(2,Math.ceil(independent.length/2))){result.review_frames=fixedMarks.map(p=>p.frame);return review('Several marks coincide with fixed sources in other images. Check that every mark follows the same moving object.');}
  result.status='provisional';result.label='Position change measured';
  result.rate_arcsec_per_hour=fit?Math.hypot(fit.vx,fit.vy)*scale/24:null;
  if(independent.length<3){result.reason='Two independent positions. Add a third observation to assess the trajectory.';return result;}
  if(ref.count<2){result.rate_arcsec_per_hour=null;return review('Position changes are measured, but too few stationary reference sources are available to check image alignment.');}
  const tolerance=Math.max(2*scale,3*(ref.rms_pixels||0)*scale,clickGuard>1?3*scale:0);
  if(!fit||fit.rms*scale>tolerance||fit.maxResidual*scale>2*tolerance){result.rate_arcsec_per_hour=null;return review('The marked positions do not follow a consistent linear path. Check the source marks or inspect possible curved motion.');}
  result.status='moving';result.label='Motion measured';
  result.reason=`${independent.length} independent epochs · ${ref.count} stationary reference sources`;
  return result;
}

/** One list for selected sources and automatic proposals, without double counting. */
export function inspectSources(tracks,selection){
  const same=t=>selection.filter(p=>t.points.some(q=>q.frame===p.frame&&Math.hypot(p.x-q.x,p.y-q.y)<4)).length>=Math.min(2,selection.length);
  const selected=selection.length?[{key:'selected',selected:true,points:selection,method:selectionMethod(selection)}]:[];
  return [...selected,...tracks.filter(t=>!selection.length||!same(t)).map((t,i)=>({...t,key:'automatic-'+i,selected:false,method:'automatic'}))];
}
