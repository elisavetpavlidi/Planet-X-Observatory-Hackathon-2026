import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assessSelection,inspectSources} from '../web/motion.mjs';
import {findTracks,gridFor} from '../web/science.mjs';
import {orderedCase} from '../web/cases.mjs';
const recorded=JSON.parse(fs.readFileSync(new URL('../data/neowise/nemesis.json',import.meta.url)));
const measured=()=>findTracks(recorded.frames)[0].points.map(p=>({...p,origin:'manual',method:'raw-pixel aperture centroid'}));

// Controlled point lists exercise missed detections; these are test fixtures, not NASA images.
function scene(count=8){
 const grid=gridFor(64.085,22.8,4),n=grid.n,points=[];
 const peak=(x,y)=>{const[ra,dec]=grid.pixelToWorld(x,y);return{x,y,ra,dec,snr:20}};
 const frames=Array.from({length:count},(_,i)=>{
  const x=-25+i*20,y=45+i,mjd=58517+i*.1,p={...peak(x,y),frame:i,mjd,origin:'manual',method:'manual'};points.push(p);
  const image=Array(n*n).fill(0),stars=[peak(12,15),peak(65,20),peak(40,70),peak(15,20),peak(35,20),peak(55,20),p];
  for(const star of stars)for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const xx=Math.round(star.x)+dx,yy=Math.round(star.y)+dy;if(xx>=0&&yy>=0&&xx<n&&yy<n)image[yy*n+xx]+=30*Math.exp(-(dx*dx+dy*dy)/3);}
  return {n,scale:2.75,mjd,band:2,observer:'wise',image,variance:Array(n*n).fill(1),peaks:[peak(12,15),peak(65,20),peak(40,70),peak(15,20),peak(35,20),peak(55,20),...(i>=2&&i<=5&&x<n-5?[peak(x,y)]:[])]};
 });
 return{frames,points};
}

test('a manual real-source selection reports measured motion without any automatic proposal',()=>{
 const points=measured(),withoutAutomatic=recorded.frames.map((f,i)=>({...f,peaks:f.peaks.filter(q=>!points.some(p=>p.frame===i&&Math.hypot(p.x-q.x,p.y-q.y)<1))}));
 assert.equal(findTracks(withoutAutomatic).length,0);
 const result=assessSelection(points,withoutAutomatic);
 assert.equal(result.status,'moving');assert.equal(result.method,'manual');assert.equal(result.independent_epochs,3);
 assert.ok(result.shift_arcsec>280&&result.shift_arcsec<290);assert.ok(result.rate_arcsec_per_hour>16&&result.rate_arcsec_per_hour<17);
 assert.equal(inspectSources([],points).length,1);
});
test('manual and automatic measurements share an assessment and are not double counted',()=>{
 const manual=measured(),automatic=manual.map(p=>({...p,origin:'automatic'}));
 assert.equal(assessSelection(automatic,recorded.frames).status,'moving');
 assert.equal(assessSelection(manual,recorded.frames).shift_arcsec,assessSelection(automatic,recorded.frames).shift_arcsec);
 const sources=inspectSources(findTracks(recorded.frames),manual);assert.equal(sources.length,1);assert.equal(sources[0].selected,true);
});
test('a track is recovered when the source is absent from the first and last images',()=>{
 const{frames}=scene(),tracks=findTracks(frames);assert.equal(tracks.length,1);
 assert.ok(tracks[0].points.length>=3);assert.ok(tracks[0].points.every(p=>p.frame!==0&&p.frame!==7));
 assert.equal(assessSelection(tracks[0].points.map(p=>({...p,origin:'automatic',method:'raw-pixel aperture centroid'})),frames).status,'moving');
});
test('a stationary manual selection does not become motion merely because it has many marks',()=>{
 const{frames}=scene(),grid=gridFor(64.085,22.8,4),[ra,dec]=grid.pixelToWorld(12,15);
 const selected=frames.map((f,frame)=>({x:12,y:15,ra,dec,mjd:f.mjd,frame,origin:'manual',method:'manual'}));
 const result=assessSelection(selected,frames);assert.equal(result.status,'unresolved');assert.equal(result.shift_arcsec,0);
 assert.equal(inspectSources([],selected).length,1);
});
test('one epoch and two epochs remain explicitly incomplete, rather than a positive detection',()=>{
 const points=measured();assert.equal(assessSelection(points.slice(0,1),recorded.frames).status,'insufficient');
 const two=assessSelection(points.slice(0,2),recorded.frames);assert.equal(two.status,'provisional');assert.ok(two.shift_arcsec>0);
 const repeated=[points[0],{...points[0],mjd:points[0].mjd+.0001}];assert.equal(assessSelection(repeated,recorded.frames).status,'insufficient');
});
test('missing controls, a bad mark and incompatible bands cannot silently produce measured motion',()=>{
 const{frames,points}=scene(),chosen=points.slice(2,5);
 assert.equal(assessSelection(chosen,frames.map(f=>({...f,peaks:[]}))).status,'review');
 const grid=gridFor(64.085,22.8,4),background=chosen.map(p=>{const[ra,dec]=grid.pixelToWorld(p.x,10);return{...p,y:10,ra,dec}});assert.equal(assessSelection(background,frames).status,'review');
 const starHopping=chosen.map(p=>{const[ra,dec]=grid.pixelToWorld(p.x,20);return{...p,y:20,ra,dec}});assert.equal(assessSelection(starHopping,frames).status,'review');
 const bad=chosen.map((p,i)=>i===1?{...p,y:p.y+20}:p);assert.equal(assessSelection(bad,frames).status,'review');
 const mixed=frames.map((f,i)=>({...f,band:i===3?1:2}));assert.equal(assessSelection(chosen,mixed).status,'review');
 const masked=structuredClone(frames);masked[3].image[Math.round(chosen[1].y)*masked[3].n+Math.round(chosen[1].x)]=null;
 assert.equal(assessSelection(chosen,masked).status,'review');
});
test('SPHEREx manual marks require compatible source-local wavelengths',()=>{
 const{frames,points}=scene(),chosen=points.slice(2,5).map(p=>({...p,wavelength_um:2.4,bandwidth_um:.05}));
 const spherex=frames.map(f=>({...f,observer:'spherex'}));
 assert.equal(assessSelection(chosen,spherex).status,'moving');
 chosen[1].wavelength_um=2.6;assert.equal(assessSelection(chosen,spherex).status,'review');
 delete chosen[1].wavelength_um;assert.equal(assessSelection(chosen,spherex).status,'review');
});
test('an old session with unsorted frames retains the correct marked epoch after opening',()=>{
 const data={frames:[recorded.frames[2],recorded.frames[0],recorded.frames[1]],selection:[{...measured()[1],frame:0}]};
 const sorted=orderedCase(data);assert.equal(sorted.selection[0].frame,2);assert.equal(sorted.frames[2].mjd,sorted.selection[0].mjd);
 assert.equal(assessSelection(measured().map(({origin,...p})=>p),recorded.frames).method,'saved');
});


test('the real consecutive sequence finds the asteroid before it reaches the image boundary',()=>{
 const d=JSON.parse(fs.readFileSync(new URL('../data/neowise/consecutive.json',import.meta.url))),tracks=findTracks(d.frames);
 assert.equal(d.frames.length,9);assert.equal(d.catalog.observations.length,12);assert.equal(tracks.length,1);assert.equal(tracks[0].points.length,4);
 assert.ok(!tracks[0].points.some(p=>p.frame===d.frames.length-1));
 assert.equal(assessSelection(tracks[0].points.map(p=>({...p,origin:'automatic',method:'raw-pixel aperture centroid'})),d.frames).status,'moving');
 const evidence=JSON.parse(fs.readFileSync(new URL('../data/neowise/sequence_identification.json',import.meta.url))),candidate=evidence.result.candidates[0];
 assert.equal(candidate.name,'128 Nemesis');assert.equal(candidate.checked_epochs,4);assert.ok(candidate.max_separation<1);
});
