import {findTracks,median} from './science.mjs';
export const ARCHIVES={
 neowise:{name:'NEOWISE',start:'2013-12-13',end:'2024-08-01',dataset:'neowiser',table:'p1bm_frm',observer:'wise'},
 wise:{name:'WISE All-Sky',start:'2010-01-01',end:'2010-08-06',dataset:'allsky',table:'4band_p1bm_frm',observer:'wise'},
 wise3:{name:'WISE 3-band',start:'2010-08-06',end:'2010-09-30',dataset:'cryo_3band',table:'3band_p1bm_frm',observer:'wise'},
 wise2:{name:'WISE Post-Cryo',start:'2010-09-29',end:'2011-02-02',dataset:'postcryo',table:'2band_p1bm_frm',observer:'wise'},
 spherex_qr2:{name:'SPHEREx QR2 Wide',start:'2025-03-11',end:'2100-01-01',observer:'spherex'},
 spherex_qr3:{name:'SPHEREx QR3 Wide',start:'2025-03-11',end:'2100-01-01',observer:'spherex'},
 spherex_qr2_deep:{name:'SPHEREx QR2 Deep',start:'2025-03-11',end:'2100-01-01',observer:'spherex'},
 spherex_qr3_deep:{name:'SPHEREx QR3 Deep',start:'2025-03-11',end:'2100-01-01',observer:'spherex'}
};
const day=s=>Date.parse(s)/86400000;
export const iso=d=>new Date(d*86400000).toISOString().slice(0,10);
export function validateExplore(q){
 const r={ra:Number(q.ra),dec:Number(q.dec),width:Number(q.width??8),band:Number(q.band??2),detector:Number(q.detector??4),archive:String(q.archive||'neowise'),start:String(q.start),end:String(q.end),quality:String(q.quality||'all'),limit:Math.min(12,Math.max(3,Number(q.limit)||12))};
 if(![r.ra,r.dec,r.width,r.band,r.detector].every(Number.isFinite)||r.ra<0||r.ra>=360||Math.abs(r.dec)>90||r.width<3||r.width>12||![1,2].includes(r.band)||!Number.isInteger(r.detector)||r.detector<0||r.detector>6)throw Error('Choose a valid sky position, a 3–12 arcminute field, and a valid band.');
 if(r.archive!=='wise_all'&&!ARCHIVES[r.archive])throw Error('Unknown archive.');
 for(const s of [r.start,r.end])if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(day(s))||iso(day(s))!==s||s<'1900-01-01'||s>'2100-12-31')throw Error('Enter valid dates between 1900 and 2100.');
 if(r.end<r.start)throw Error('The end date must be on or after the start date.');
 if(!['all','recommended'].includes(r.quality))throw Error('Unknown quality filter.');
 return r;
}
// The user may choose any interval; only intersecting published-mission windows
// are queried. Every returned row is retained, including near-simultaneous images.
export function surveyWindows(query){
 const q=validateExplore(query),keys=q.archive==='wise_all'?['wise','wise3','wise2','neowise']:[q.archive],out=[];
 for(const key of keys){const a=ARCHIVES[key];let begin=Math.max(day(q.start),day(a.start)),last=Math.min(day(q.end),day(a.end),day(new Date().toISOString().slice(0,10)));
  while(begin<=last){const end=Math.min(last,begin+364);out.push({...q,archive:key,start:iso(begin),end:iso(end)});begin=end+1;}
 }
 return out;
}
export function detectTracks(frames){
 if(!frames?.length)return [];
 const a=frames[0];if(frames.some(f=>(f.observer||'wise')!==(a.observer||'wise')||f.band!==a.band))return [];
 if(a.observer==='spherex'){
  if(frames.some(f=>!Number.isFinite(f.wavelength_um)||!Number.isFinite(f.bandwidth_um)))return [];
  const wavelengths=frames.map(f=>f.wavelength_um),tolerance=.25*median(frames.map(f=>f.bandwidth_um));if(Math.max(...wavelengths)-Math.min(...wavelengths)>tolerance)return [];
 }
 const indices=[];for(let i=0;i<frames.length;i++)if(!indices.length||frames[i].mjd-frames[indices.at(-1)].mjd>=5/1440)indices.push(i);
 return findTracks(indices.map(i=>frames[i]),a.scale||2.75).filter(t=>a.observer!=='spherex'||t.points.every(p=>Number.isFinite(p.wavelength_um)&&Number.isFinite(p.bandwidth_um))&&Math.max(...t.points.map(p=>p.wavelength_um))-Math.min(...t.points.map(p=>p.wavelength_um))<=.25*median(t.points.map(p=>p.bandwidth_um))).map(t=>({...t,points:t.points.map(p=>({...p,frame:indices[p.frame]}))}));
}
