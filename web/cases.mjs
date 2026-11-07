import {validateExplore,ARCHIVES} from './model.mjs';
import {gridFor,angularSeparation} from './science.mjs';
export function validDataURL(value){
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='irsa.ipac.caltech.edu'&&!u.username&&!u.password&&!u.port&&/^\/ibe\/data\/(wise|spherex)\//.test(u.pathname);}catch{return false;}
}
const LOCAL_PRODUCTS={
 'observation_A.fits':{path:'data/reference/m31/observation_A.fits',sha256:'b6c9a2e37cdaaff18e52f1531d8a018c07d1f0c3d6fdff70b2fb1db1947774f6'},
 'observation_B.fits':{path:'data/reference/m31/observation_B.fits',sha256:'baedce214579321354374e84ede9ffd26149b4b239b84fb73282b2d893467cf8'}
};
export function validProduct(p){
 const local=LOCAL_PRODUCTS[String(p.path||'').split('/').at(-1)];
 return validDataURL(p.url)||p.url===null&&local?.path===p.path&&local.sha256===p.sha256;
}
export function validateCase(d){
 if(!d||d.schema!=='planetx-observation-case/1'||!Array.isArray(d.frames)||!d.frames.length||d.frames.length>12)throw Error('Choose a saved Planet X session with 1–12 loaded images.');
 d.query=validateExplore(d.query||{});
 for(const f of d.frames){
  // Earlier saved sessions retain the same original FITS hashes after folder moves.
  for(const p of Array.isArray(f.products)?f.products:[]){const local=LOCAL_PRODUCTS[String(p.path||'').split('/').at(-1)];if(p.url===null&&local?.sha256===p.sha256)p.path=local.path;}

  const scale=f.scale??2.75,grid=gridFor(d.query.ra,d.query.dec,d.query.width,scale);
  if(![2.75,6.15].includes(scale)||!Number.isInteger(f.n)||f.n!==grid.n||f.n>300||!Number.isFinite(f.mjd)||f.mjd<0||f.mjd>90000||!Number.isFinite(f.coverage)||f.coverage<0||f.coverage>1||!Array.isArray(f.image)||f.image.length!==f.n*f.n||f.image.some(v=>v!==null&&!Number.isFinite(v))||!Array.isArray(f.variance)||f.variance.length!==f.n*f.n||f.variance.some(v=>v!==null&&(!Number.isFinite(v)||v<0))||!Array.isArray(f.peaks)||f.peaks.length>80||f.peaks.some(p=>![p.x,p.y,p.ra,p.dec,p.snr].every(Number.isFinite))||!Array.isArray(f.products)||!f.products.length||f.products.some(p=>!validProduct(p)))throw Error('Invalid image data or source links in this session.');
  if(f.wcs&&Object.keys(grid.header).some(k=>typeof grid.header[k]==='number'?(!Number.isFinite(f.wcs[k])||Math.abs(f.wcs[k]-grid.header[k])>1e-9):f.wcs[k]!==grid.header[k]))throw Error('The saved image coordinates are inconsistent.');
  if(f.observer&&!['wise','spherex'].includes(f.observer))throw Error('Unknown telescope observer.');
 }
 if(!Array.isArray(d.selection)||d.selection.length>12||d.selection.some(p=>![p.x,p.y,p.ra,p.dec,p.mjd,p.frame].every(Number.isFinite)||!Number.isInteger(p.frame)||!d.frames[p.frame]||Math.abs(p.mjd-d.frames[p.frame].mjd)>1e-7||p.x<-.5||p.y<-.5||p.x>d.frames[p.frame].n-.5||p.y>d.frames[p.frame].n-.5||angularSeparation(...gridFor(d.query.ra,d.query.dec,d.query.width,d.frames[p.frame].scale||2.75).pixelToWorld(p.x,p.y),p.ra,p.dec)>.1))throw Error('Invalid saved source positions.');
 if(d.identity){if(!Array.isArray(d.identity.candidates)||d.identity.candidates.length>3||d.identity.candidates.some(c=>typeof c.name!=='string'||c.name.length>200||![c.separation,c.max_separation,c.checked_epochs].every(Number.isFinite)))throw Error('Invalid saved identity data.');d.identity.cached=true;d.identity.imported=true;}
 if(d.catalog){if(!Array.isArray(d.catalog.observations)||d.catalog.observations.length>150000||d.catalog.observations.some(r=>typeof r.key!=='string'||r.key.length>250||!ARCHIVES[r.archive]||!Number.isFinite(r.mjd)||r.access_url&&!validDataURL(r.access_url)&&!String(r.access_url).startsWith('https://irsa.ipac.caltech.edu/datalink/links/spherex')))throw Error('Invalid saved observation list.');}
 return d;
}

// Saved frame indexes are remapped when an older session lists epochs out of order.
export function orderedCase(data){
 const order=data.frames.map((frame,index)=>({frame,index})).sort((a,b)=>a.frame.mjd-b.frame.mjd),indices=new Map(order.map((item,index)=>[item.index,index]));
 return {...data,frames:order.map(item=>item.frame),selection:(data.selection||[]).map(p=>({...p,frame:indices.get(p.frame)})).sort((a,b)=>a.mjd-b.mjd)};
}
