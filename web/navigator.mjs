const R=Math.PI/180,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function projectSky(ra,dec,centerRa,centerDec,fov,width,height){
 const a=ra*R,d=dec*R,c=centerRa*R,e=centerDec*R,da=a-c;
 const z=clamp(Math.sin(d)*Math.sin(e)+Math.cos(d)*Math.cos(e)*Math.cos(da),-1,1),theta=Math.acos(z);
 if(theta>fov*R/2)return null;
 const east=Math.cos(d)*Math.sin(da),north=Math.sin(d)*Math.cos(e)-Math.cos(d)*Math.sin(e)*Math.cos(da),s=Math.hypot(east,north),r=theta/(fov*R/2)*Math.min(width,height)/2;
 return {x:width/2-(s?east/s*r:0),y:height/2-(s?north/s*r:0)};
}
export function unprojectSky(x,y,centerRa,centerDec,fov,width,height){
 const dx=-(x-width/2),dy=-(y-height/2),r=Math.hypot(dx,dy),theta=r/(Math.min(width,height)/2)*fov*R/2;
 if(theta>Math.PI)return null;if(r<1e-10)return {ra:centerRa,dec:centerDec};
 const a=centerRa*R,d=centerDec*R,X=Math.cos(theta)*Math.cos(d)*Math.cos(a)+Math.sin(theta)*(dx/r*(-Math.sin(a))+dy/r*(-Math.sin(d)*Math.cos(a))),Y=Math.cos(theta)*Math.cos(d)*Math.sin(a)+Math.sin(theta)*(dx/r*Math.cos(a)+dy/r*(-Math.sin(d)*Math.sin(a))),Z=Math.cos(theta)*Math.sin(d)+Math.sin(theta)*dy/r*Math.cos(d);
 return {ra:(Math.atan2(Y,X)/R+360)%360,dec:Math.asin(clamp(Z,-1,1))/R};
}
export async function initNavigator(onSelect){
 const dialog=document.getElementById('sky-dialog'),canvas=document.getElementById('sky-map'),ctx=canvas.getContext('2d'),catalog=await fetch('/catalog/sky.json').then(r=>r.json());
 let ra=64.085,dec=22.8,fov=100,width=900,height=480,drag=null,moved=false,pending=false;
 const project=(a,d)=>projectSky(a,d,ra,dec,fov,width,height),show=()=>{if(!pending){pending=true;requestAnimationFrame(()=>{pending=false;draw();})}};
 function draw(){
  const rect=canvas.getBoundingClientRect();if(!rect.width)return;width=rect.width;height=rect.height;const ratio=devicePixelRatio||1;canvas.width=width*ratio;canvas.height=height*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle='#08131e';ctx.fillRect(0,0,width,height);
  ctx.strokeStyle='#193343';ctx.lineWidth=.7;
  const step=fov>100?30:fov>25?10:fov>5?2:fov>1?.5:.1;
  const decSpan=Math.min(90,fov*.65),d0=Math.max(-90,dec-decSpan),d1=Math.min(90,dec+decSpan),raSpan=Math.min(180,fov*.65/Math.max(.08,Math.cos(dec*R))),a0=ra-raSpan,a1=ra+raSpan;
  function line(points){ctx.beginPath();let prev=null;for(const [A,D]of points){const p=project((A+720)%360,D);if(p){if(prev&&Math.hypot(p.x-prev.x,p.y-prev.y)<height*.3)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);}prev=p;}ctx.stroke();}
  const aStep=Math.max(step,Math.ceil((a1-a0)/36/step)*step);
  for(let A=Math.ceil(a0/aStep)*aStep;A<=a1;A+=aStep)line(Array.from({length:97},(_,i)=>[A,d0+(d1-d0)*i/96]));
  for(let D=Math.ceil(d0/step)*step;D<=d1;D+=step)line(Array.from({length:145},(_,i)=>[a0+(a1-a0)*i/144,D]));
  if(fov>4){ctx.strokeStyle='#365064';for(const line of catalog.lines){ctx.beginPath();let prev=null;for(const c of line){const p=project((c[0]+360)%360,c[1]);if(p){if(prev&&Math.hypot(p.x-prev.x,p.y-prev.y)<height*.5)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);}prev=p;}ctx.stroke();}}
  for(const s of catalog.stars){const p=project(s.ra,s.dec);if(!p)continue;ctx.globalAlpha=clamp((7-s.mag)/5,.2,1);ctx.fillStyle='#e6f2fb';ctx.beginPath();ctx.arc(p.x,p.y,clamp((6.5-s.mag)*.45,.45,3.6),0,2*Math.PI);ctx.fill();if(s.name&&s.mag<1.5&&fov<100){ctx.globalAlpha=.8;ctx.font='11px system-ui';ctx.fillText(s.name,p.x+6,p.y-5);}}ctx.globalAlpha=1;
  ctx.font='11px system-ui';if(fov>4)for(const c of catalog.constellations){const p=project(c.ra,c.dec);if(p){ctx.fillStyle='#8ba4b2';ctx.fillText(c.name,p.x+5,p.y+14);}}
  for(const o of catalog.objects){const p=project(o.ra,o.dec);if(p&&fov<90){ctx.strokeStyle='#e5bb7a';ctx.beginPath();ctx.arc(p.x,p.y,4,0,2*Math.PI);ctx.stroke();ctx.fillStyle='#e5bb7a';ctx.fillText(o.name,p.x+7,p.y+4);}}
  ctx.strokeStyle='#69d2b0';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(width/2,height/2,10,0,2*Math.PI);ctx.moveTo(width/2-19,height/2);ctx.lineTo(width/2-5,height/2);ctx.moveTo(width/2+5,height/2);ctx.lineTo(width/2+19,height/2);ctx.moveTo(width/2,height/2-19);ctx.lineTo(width/2,height/2-5);ctx.moveTo(width/2,height/2+5);ctx.lineTo(width/2,height/2+19);ctx.stroke();
  document.getElementById('sky-position').textContent=`RA ${ra.toFixed(5)}° · Dec ${dec.toFixed(5)}° · view ${fov.toFixed(fov<1?2:0)}°`;
 }
 function zoom(factor){fov=clamp(fov*factor,.15,360);show();}
 canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,ra,dec};moved=false;};
 canvas.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>4)moved=true;ra=(drag.ra+dx/width*fov/Math.max(.15,Math.cos(drag.dec*R))+3600)%360;dec=clamp(drag.dec+dy/width*fov,-90,90);show();};
 canvas.onpointerup=e=>{if(!drag)return;if(!moved){const r=canvas.getBoundingClientRect(),p=unprojectSky(e.clientX-r.left,e.clientY-r.top,ra,dec,fov,width,height);if(p){let best=null,dist=10;for(const o of [...catalog.objects,...catalog.stars.filter(s=>s.name)]){const q=project(o.ra,o.dec);if(q&&Math.hypot(q.x-(e.clientX-r.left),q.y-(e.clientY-r.top))<dist){best=o;dist=Math.hypot(q.x-(e.clientX-r.left),q.y-(e.clientY-r.top));}}ra=best?.ra??p.ra;dec=best?.dec??p.dec;}}drag=null;show();};
 canvas.onpointercancel=()=>{drag=null};canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.25:.8)},{passive:false});
 canvas.onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(e.key)){e.preventDefault();if(e.key==='+')zoom(.7);else if(e.key==='-')zoom(1.4);else{ra=(ra+(e.key==='ArrowLeft'?1:e.key==='ArrowRight'?-1:0)*fov/15+360)%360;dec=clamp(dec+(e.key==='ArrowUp'?1:e.key==='ArrowDown'?-1:0)*fov/15,-90,90);show();}}};
 document.getElementById('sky-in').onclick=()=>zoom(.5);document.getElementById('sky-out').onclick=()=>zoom(2);document.getElementById('sky-all').onclick=()=>{fov=360;show()};
 document.getElementById('sky-use').onclick=()=>{onSelect({ra,dec});dialog.close();};document.getElementById('sky-close').onclick=()=>dialog.close();new ResizeObserver(show).observe(canvas);
 return {open:(a,d)=>{ra=Number(a)||0;dec=Number(d)||0;dialog.showModal();show();},catalog};
}
