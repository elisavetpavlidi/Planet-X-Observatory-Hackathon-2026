// Small, dependency-free FITS/WCS reader for NEOWISE L1b images.
// Unsupported projections/planes fail closed. Pixel positions are zero-based.
export function readFits(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const text = new TextDecoder('ascii');
  let offset=0; const hdus=[];hdus.tables=[];
  while (offset+2880<=data.length) {
    const h={}; let end=false, cursor=offset;
    for (;cursor+80<=data.length;cursor+=80) {
      const card=text.decode(data.subarray(cursor,cursor+80)); const key=card.slice(0,8).trim();
      if (key==='END') { cursor+=80;end=true;break; }
      if (card[8]!=='=') continue;
      let value=card.slice(10).trim();
      if(value.startsWith("'")) {
        let out=''; for(let j=1;j<value.length;j++){ if(value[j]==="'"){if(value[j+1]==="'"){out+="'";j++;}else break;}else out+=value[j]; }
        h[key]=out.trimEnd();
      } else {value=value.split('/')[0].trim();h[key]=value==='T'?true:value==='F'?false:Number(value.replace(/[dD]/g,'E'));}
    }
    if(!end) throw Error('The FITS header is invalid.');
    const start=offset+Math.ceil((cursor-offset)/2880)*2880;
    if(offset===0)hdus.primaryHeader=h;
    let count=h.NAXIS?1:0; for(let i=1;i<=(h.NAXIS||0);i++)count*=h['NAXIS'+i];
    const size=(count+(h.PCOUNT||0))*(h.GCOUNT||1)*Math.abs(h.BITPIX||8)/8;
    if(!Number.isSafeInteger(size)||size<0||size>32*1024*1024||start+size>data.length)throw Error('The FITS file is invalid or too large.');
    if(h.XTENSION==='BINTABLE'&&h.EXTNAME==='WCS-WAVE'){
      let at=start;const columns={};
      for(let k=1;k<=h.TFIELDS;k++){
        const m=String(h['TFORM'+k]).match(/^(\d*)([JED])$/);if(!m)throw Error('Unsupported wavelength lookup table.');
        const n=Number(m[1]||1),type=m[2],step=type==='D'?8:4;if(n>100000||at+n*step>start+size)throw Error('Invalid wavelength lookup table.');
        columns[h['TTYPE'+k]]=Array.from({length:n},(_,i)=>type==='J'?view.getInt32(at+i*step):type==='E'?view.getFloat32(at+i*step):view.getFloat64(at+i*step));at+=n*step;
      }
      hdus.tables.push({header:h,columns});
    }
    if(h.NAXIS===2 && h.XTENSION!=='BINTABLE') {
      if(![-64,-32,8,16,32].includes(h.BITPIX))throw Error('Unsupported FITS data type.');
      const pixels=new Float64Array(count);const step=Math.abs(h.BITPIX)/8;
      for(let i=0;i<count;i++){
        const at=start+i*step;const x=h.BITPIX===-32?view.getFloat32(at):h.BITPIX===-64?view.getFloat64(at):h.BITPIX===32?view.getInt32(at):h.BITPIX===16?view.getInt16(at):view.getUint8(at);
        pixels[i]=(h.BITPIX>0&&x===h.BLANK)?NaN:x*(h.BSCALE??1)+(h.BZERO??0);
      }
      hdus.push({header:h,width:h.NAXIS1,height:h.NAXIS2,pixels});
    }
    offset=start+Math.ceil(size/2880)*2880;
  }
  if(!hdus.length)throw Error('The FITS file contains no image.');
  return hdus;
}

const R=Math.PI/180;
function poly(h,p,u,v){let sum=0;for(let i=0;i<=(h[p+'_ORDER']||0);i++)for(let j=0;j<=(h[p+'_ORDER']||0)-i;j++)sum+=(h[`${p}_${i}_${j}`]||0)*u**i*v**j;return sum;}
export function wcs(header) {
  const h=header; const projection=String(h.CTYPE1).includes('SIN')?'SIN':String(h.CTYPE1).includes('TAN')?'TAN':null;
  if(!projection||!String(h.CTYPE2).startsWith('DEC'))throw Error('Unsupported WCS projection.');
  const a=h.CD1_1??(h.CDELT1??1)*(h.PC1_1??1),b=h.CD1_2??(h.CDELT1??1)*(h.PC1_2??0),c=h.CD2_1??(h.CDELT2??1)*(h.PC2_1??0),d=h.CD2_2??(h.CDELT2??1)*(h.PC2_2??1);
  const det=a*d-b*c;
  if(![a,b,c,d,det,h.CRPIX1,h.CRPIX2,h.CRVAL1,h.CRVAL2].every(Number.isFinite)||Math.abs(det)<1e-16)throw Error('Incomplete WCS metadata.');
  const ra0=h.CRVAL1*R,dec0=h.CRVAL2*R;
  function worldToPixel(ra,dec){
    const dl=(ra*R-ra0),de=dec*R;
    const z=Math.sin(de)*Math.sin(dec0)+Math.cos(de)*Math.cos(dec0)*Math.cos(dl);
    if(z<=0)return [NaN,NaN];
    const scale=projection==='TAN'?1/z:1;
    const xi=Math.cos(de)*Math.sin(dl)*scale/R,eta=(Math.sin(de)*Math.cos(dec0)-Math.cos(de)*Math.sin(dec0)*Math.cos(dl))*scale/R;
    const U=(d*xi-b*eta)/det,V=(-c*xi+a*eta)/det;
    let u=U,v=V;
    for(let it=0;it<12;it++){
      const A=poly(h,'A',u,v),B=poly(h,'B',u,v),f=u+A-U,g=v+B-V;
      if(Math.hypot(f,g)<1e-7)break;
      const ep=.01,duA=(poly(h,'A',u+ep,v)-A)/ep,dvA=(poly(h,'A',u,v+ep)-A)/ep;
      const duB=(poly(h,'B',u+ep,v)-B)/ep,dvB=(poly(h,'B',u,v+ep)-B)/ep;
      const J=(1+duA)*(1+dvB)-dvA*duB;
      if(!Number.isFinite(J)||Math.abs(J)<.1)return [NaN,NaN];
      u-=((1+dvB)*f-dvA*g)/J;v-=(-duB*f+(1+duA)*g)/J;
    }
    if(Math.hypot(u+poly(h,'A',u,v)-U,v+poly(h,'B',u,v)-V)>.001)return [NaN,NaN];
    return [u+h.CRPIX1-1,v+h.CRPIX2-1];
  }
  function pixelToWorld(x,y){
    const u=x+1-h.CRPIX1,v=y+1-h.CRPIX2,U=u+poly(h,'A',u,v),V=v+poly(h,'B',u,v);
    const xi=(a*U+b*V)*R,eta=(c*U+d*V)*R,rho=Math.hypot(xi,eta);
    if(!rho)return [h.CRVAL1,h.CRVAL2];
    const q=projection==='TAN'?Math.atan(rho):Math.asin(Math.min(1,rho));
    const dec=Math.asin(Math.cos(q)*Math.sin(dec0)+eta*Math.sin(q)*Math.cos(dec0)/rho);
    const ra=ra0+Math.atan2(xi*Math.sin(q),rho*Math.cos(dec0)*Math.cos(q)-eta*Math.sin(dec0)*Math.sin(q));
    return [(ra/R+360)%360,dec/R];
  }
  return {worldToPixel,pixelToWorld};
}

export function median(values){const a=Array.from(values).filter(Number.isFinite).sort((a,b)=>a-b);if(!a.length)return NaN;return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;}
export function gridFor(ra,dec,arcmin,scale=2.75){const n=Math.max(16,Math.round(arcmin*60/scale));const header={CTYPE1:'RA---TAN',CTYPE2:'DEC--TAN',CRVAL1:ra,CRVAL2:dec,CRPIX1:(n+1)/2,CRPIX2:(n+1)/2,CD1_1:-scale/3600,CD1_2:0,CD2_1:0,CD2_2:scale/3600};return {n,scale,header,...wcs(header)};}
// NEOWISE profile-fit exclusion bit mask (explanatory supplement IV.2.a.iii),
// additionally excluding unreliable non-linearity bit 26.
export const REJECT_MASK=1504706175|2**26;
export function alignWise(image,unc,mask,grid){
  if([unc,mask].some(x=>x.width!==image.width||x.height!==image.height))throw Error('Image, uncertainty, and mask dimensions do not match.');
  const hw=wcs(image.header),n=grid.n,out=new Float32Array(n*n).fill(NaN),variance=new Float32Array(n*n).fill(NaN);
  const calibration=10**(.4*(20-Number(image.header.MAGZP)));
  if(!Number.isFinite(calibration))throw Error('MAGZP photometric calibration is missing.');
  let accepted=0;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const [px,py]=hw.worldToPixel(...grid.pixelToWorld(x,y));if(!Number.isFinite(px+py))continue;
    const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;
    if(ix<0||iy<0||ix+1>=image.width||iy+1>=image.height)continue;
    const ws=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy],ids=[iy*image.width+ix,iy*image.width+ix+1,(iy+1)*image.width+ix,(iy+1)*image.width+ix+1];
    let val=0,v=0,weight=0;
    for(let j=0;j<4;j++){
      if(ws[j]<1e-8)continue;
      const id=ids[j];if(!Number.isFinite(image.pixels[id])||!Number.isFinite(unc.pixels[id])||unc.pixels[id]<=0||(mask.pixels[id]&REJECT_MASK)!==0)continue;
      val+=ws[j]*image.pixels[id];v+=ws[j]**2*unc.pixels[id]**2;weight+=ws[j];
    }
    // Renormalized valid weights for viewing only. No rejected pixel is filled
    // or used in the source measurements, which remain on original pixels.
    if(weight>=.75){out[y*n+x]=val/weight*calibration;variance[y*n+x]=v/weight**2*calibration**2;accepted++;}
  }
  const bg=median(out);for(let i=0;i<out.length;i++)out[i]-=bg;
  return {image:Array.from(out,x=>Number.isFinite(x)?+x.toPrecision(7):null),variance:Array.from(variance,x=>Number.isFinite(x)?+x.toPrecision(7):null),coverage:accepted/(n*n),background:bg};
}

// Aperture measurements use unresampled pixels: avoids treating interpolated
// neighboring pixels as independent. SNR is heuristic (background uncertainty
// and PSF systematics are not a complete source-detection likelihood).
export function sourcePeaks(image,unc,mask,grid){
  const h=image.header,nx=image.width,ny=image.height,hw=wcs(h);const out=[];
  const bg=median(image.pixels);
  for(let y=5;y<ny-5;y++)for(let x=5;x<nx-5;x++){
    const id=y*nx+x,v=image.pixels[id];if(!Number.isFinite(v)||v<bg+3*unc.pixels[id]||(mask.pixels[id]&REJECT_MASK))continue;
    let peak=true;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if((dx||dy)&&image.pixels[id+dy*nx+dx]>=v)peak=false;
    if(!peak)continue;
    const ring=[];let signal=0,varSum=0,sx=0,sy=0,count=0,good=true,valid=0,total=0;
    for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){
      const r=Math.hypot(dx,dy),j=id+dy*nx+dx;
      if(r>=4&&r<=5&&Number.isFinite(image.pixels[j])&&!(mask.pixels[j]&REJECT_MASK))ring.push(image.pixels[j]);
    }
    if(ring.length<12)continue;const local=median(ring);
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)if(Math.hypot(dx,dy)<=3){
      total++;const j=id+dy*nx+dx;if(!Number.isFinite(image.pixels[j])||!Number.isFinite(unc.pixels[j])||unc.pixels[j]<=0||(mask.pixels[j]&REJECT_MASK)){if(Math.hypot(dx,dy)<=1.5)good=false;continue;}
      valid++;const flux=image.pixels[j]-local,w=Math.max(0,flux);signal+=flux;varSum+=unc.pixels[j]**2;sx+=(x+dx)*w;sy+=(y+dy)*w;count+=w;
    }
    const snr=signal/Math.sqrt(varSum);
    if(!good||valid/total<.85||!(snr>=7)||!count)continue;
    const raDec=hw.pixelToWorld(sx/count,sy/count),g=grid.worldToPixel(...raDec);
    if(g[0]<4||g[1]<4||g[0]>grid.n-5||g[1]>grid.n-5)continue;
    out.push({x:g[0],y:g[1],ra:raDec[0],dec:raDec[1],snr:Math.min(9999,snr)});
  }
  return out.sort((a,b)=>b.snr-a.snr).slice(0,80);
}

// Linear motion and stationary controls share the same common celestial pixel grid.
export function fitPixelMotion(points){
  if(points.length<2)return null;
  const epoch=points[0].mjd,times=points.map(p=>p.mjd-epoch),mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  const mt=mean(times),mx=mean(points.map(p=>p.x)),my=mean(points.map(p=>p.y));
  const denominator=times.reduce((s,t)=>s+(t-mt)**2,0);
  if(!(denominator>0))return null;
  const vx=points.reduce((s,p,i)=>s+(times[i]-mt)*(p.x-mx),0)/denominator;
  const vy=points.reduce((s,p,i)=>s+(times[i]-mt)*(p.y-my),0)/denominator;
  const predict=mjd=>({x:mx+vx*(mjd-epoch-mt),y:my+vy*(mjd-epoch-mt)});
  const residuals=points.map(p=>{const q=predict(p.mjd);return Math.hypot(p.x-q.x,p.y-q.y);});
  return {predict,vx,vy,rms:Math.sqrt(mean(residuals.map(x=>x*x))),maxResidual:Math.max(...residuals)};
}
export function stationaryReference(frames){
  const clusters=[];
  frames.forEach((f,frame)=>{for(const p of f.peaks||[]){
    let best=null,distance=2;
    for(const c of clusters){const d=Math.hypot(c.x-p.x,c.y-p.y);if(d<distance&&!c.frames.has(frame)){best=c;distance=d;}}
    if(best){best.points.push(p);best.frames.add(frame);}else clusters.push({x:p.x,y:p.y,points:[p],frames:new Set([frame])});
  }});
  const controls=clusters.filter(c=>c.frames.size>=Math.max(2,Math.ceil(frames.length/2)));
  let squared=0,count=0;
  for(const c of controls){const mx=c.points.reduce((s,p)=>s+p.x,0)/c.points.length,my=c.points.reduce((s,p)=>s+p.y,0)/c.points.length;for(const p of c.points){squared+=(p.x-mx)**2+(p.y-my)**2;count++;}}
  return {count:controls.length,rms_pixels:count?Math.sqrt(squared/count):null};
}
export function findTracks(frames,scale=2.75){
  if(frames.length<3||frames.at(-1).mjd-frames[0].mjd>2)return [];
  const reference=stationaryReference(frames);if(reference.count<2)return [];
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const candidates=frames.map((f,k)=>(f.peaks||[]).filter(p=>frames.filter((other,j)=>j!==k&&(other.peaks||[]).some(q=>distance(p,q)<2)).length<2));
  // Numeric spatial bins keep the any-epoch search bounded for up to 12 x 80 peaks.
  const bins=frames.map(f=>f.peaks||[]).map(peaks=>{const m=new Map();for(const p of peaks){const key=Math.floor(p.x/2)+1024*Math.floor(p.y/2);if(!m.has(key))m.set(key,[]);m.get(key).push(p);}return m;});
  const nearest=(k,p)=>{if(Number.isFinite(frames[k].n)&&(p.x<0||p.y<0||p.x>=frames[k].n||p.y>=frames[k].n))return null;let best=null,d=1.7;const x=Math.floor(p.x/2),y=Math.floor(p.y/2);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const q of bins[k].get(x+dx+1024*(y+dy))||[]){const v=distance(p,q);if(v<=d){d=v;best=q;}}return best;};
  const collect=predict=>frames.flatMap((f,frame)=>{const q=nearest(frame,predict(f.mjd));return q?[{...q,frame,mjd:f.mjd}]:[];});
  const usable=(f,p)=>{
    if(!Number.isFinite(f.n)||!Array.isArray(f.image))return true;
    if(p.x<4||p.y<4||p.x>f.n-5||p.y>f.n-5)return false;
    let good=0,total=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){total++;const v=f.image[(Math.round(p.y)+dy)*f.n+Math.round(p.x)+dx];if(v!==null&&Number.isFinite(v))good++;}return good/total>=.85;
  };
  const tracks=[],seen=new Set();
  for(let i=0;i<frames.length-2;i++)for(let j=i+2;j<frames.length;j++){
    const dt=frames[j].mjd-frames[i].mjd;if(dt<10/1440)continue;
    for(const a of candidates[i])for(const b of candidates[j]){
      if(distance(a,b)<4)continue;
      let points=collect(mjd=>{const t=(mjd-frames[i].mjd)/dt;return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};});
      if(points.length<3)continue;
      let fit=fitPixelMotion(points);if(!fit)continue;points=collect(fit.predict);if(points.length<3)continue;
      fit=fitPixelMotion(points);if(!fit||fit.maxResidual>1.7)continue;
      const matched=new Set(points.map(p=>p.frame)),eligible=frames.filter((f,k)=>matched.has(k)||usable(f,fit.predict(f.mjd))).length;
      if(points.length<Math.max(3,Math.ceil(eligible*.5)))continue;
      const first=points[0],last=points.at(-1),span=last.mjd-first.mjd,displacement=distance(first,last);
      if(!(span>0)||displacement<4)continue;
      const key=points.map(p=>`${p.frame}:${p.x.toFixed(3)}:${p.y.toFixed(3)}`).join('|');if(seen.has(key))continue;seen.add(key);
      tracks.push({points,displacement:displacement*scale,rate:displacement*scale/(span*24),rms:fit.rms*scale,controls:reference.count,status:'candidate',label:'Candidate motion'});
    }
  }
  // Deduplicate by shared measured positions; tracks may start/end in any image.
  return tracks.sort((a,b)=>b.points.length-a.points.length||a.rms-b.rms).filter((t,i,arr)=>!arr.slice(0,i).some(u=>t.points.filter(p=>u.points.some(q=>q.frame===p.frame&&distance(p,q)<2)).length>=2)).slice(0,8);
}

export function angularSeparation(ra,dec,x,y){const d=Math.sin((dec-y)*R/2)**2+Math.cos(dec*R)*Math.cos(y*R)*Math.sin((ra-x)*R/2)**2;return 2*Math.asin(Math.sqrt(Math.min(1,d)))/R*3600;}
