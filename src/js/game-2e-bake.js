/* ===================== game part 2e: baked light for Studio ===================== */
// Studio floors and the campus can carry light baked in Blender (src/tools/bake/): bounced light, soft shadows and
// ambient occlusion in two images per world (BAKES in bake-data.js). The game still builds every world itself; this
// module only lights it:
//  - static boxes HD draws in instanced batches (walls, cores, desk tops, furniture) keep their batches; each instance
//    gets a lightmap rectangle per face through instance attributes (bkR0..bkR5), packed here by the same code the bake
//    used, so desks can still light up as route targets and the draw calls stay the same
//  - anything flat on the ground (floor finishes, the campus ground) reads a top-down lightmap by world x/z
//  - lit statics ignore the scene lights; the sun and its shadow map go, a hemisphere light measured from the bake
//    lights the things that move (cars, creatures, chairs), and chairs get soft contact blobs
// A bake is used only when a hash of the world's static geometry matches the one it was baked from. Any edit to a
// floor (the editor, an import, a code change) misses the hash, and the world falls back to realtime Studio.
const BAKE=(()=>{
const VER=1,PAD=3,CAP=4;   // packer version, px of padding around each rectangle, px of the shared constant blocks
let enabled=true,regs=[],flat=[],on=false,rec=null,worldKey='',faces=null,blobs=null,blobDirty=false,pending=Promise.resolve(),loading=null; // pending: this world's bake has been applied (or won't be); loading: its images are on the way
const texCache=new Map(),bad=new Set();
const U={bkFloor:{value:new THREE.Vector4()}};
const _M4=new THREE.Matrix4(),_P=new V3(),_Q=new THREE.Quaternion(),_S=new V3(),_B=new THREE.Box3();

/* ---------- registration (HD's batches call reg; flat ground pieces are found after the build) ---------- */
function reg(im,cyl){if(S&&S.hd&&im)regs.push({im,cyl:!!cyl})}
function enter(){
  regs=[];flat=[];faces=null;blobs=null;pending=Promise.resolve();loading=null;
  if(on){on=false;renderer.toneMappingExposure=S&&S.exposure||1;HD.restyle()}   // GTAO and the furniture blobs come back
  rec=null;worldKey='';
}

/* ---------- faces of every registered instance, with the flags that keep hidden faces out of the atlas ---------- */
// box faces in BoxGeometry's order (+x -x +y -y +z -z): the face's (u, v) extent from the box size
const BOXF=[[2,1],[2,1],[0,2],[0,2],[0,1],[0,1]],NRM=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
function collect(m,kind){
  const out=[],solid=kind==='floor'?(m.rooms||[]).filter(r=>r.solid&&r.type!=='open'&&r.w>0&&r.d>0):[];
  const sealed=(x0,x1,z0,z1)=>solid.some(r=>x0>r.x-r.w/2+.02&&x1<r.x+r.w/2-.02&&z0>r.z-r.d/2+.02&&z1<r.z+r.d/2-.02);
  for(const rg of regs){
    const im=rg.im,g=im.geometry;if(!g.boundingBox)g.computeBoundingBox();const gs=g.boundingBox.getSize(new V3());
    for(let i=0;i<im.count;i++){
      im.getMatrixAt(i,_M4);_M4.premultiply(im.matrixWorld);_M4.decompose(_P,_Q,_S);
      const sx=gs.x*_S.x,sy=gs.y*_S.y,sz=gs.z*_S.z,yaw=2*Math.atan2(_Q.y,_Q.w),c=Math.abs(Math.cos(yaw)),s=Math.abs(Math.sin(yaw));
      const hx=(sx*c+sz*s)/2,hz=(sx*s+sz*c)/2,top=_P.y+sy/2,bot=_P.y-sy/2,inCore=solid.length&&sealed(_P.x-hx,_P.x+hx,_P.z-hz,_P.z+hz);
      const inst={rg,i,x:_P.x,y:_P.y,z:_P.z,sx,sy,sz,yaw,f:[]};
      const flag=(n)=>inCore?'dark':n===2&&kind==='floor'&&top>=H-.005?'cap':n===3&&bot<.003?'dark':null;
      if(rg.cyl){inst.f[0]={w:Math.PI*sx,h:sy,fl:inCore?'dark':null};inst.f[2]={w:sx,h:sz,fl:flag(2)};inst.f[3]={w:sx,h:sz,fl:flag(3)}}
      else for(let n=0;n<6;n++){const e=[sx,sy,sz];inst.f[n]={w:e[BOXF[n][0]],h:e[BOXF[n][1]],fl:flag(n)}}
      out.push(inst);
    }
  }
  return out;
}
// the world's ground pieces: lit statics flat on the floor (finishes, borders, the campus ground)
function findFlat(){
  const out=[],skip=new Set(regs.map(r=>r.im));root.updateMatrixWorld(true);
  root.traverse(o=>{
    if(!o.isMesh||skip.has(o)||o.userData.dyn)return;const m=o.material;if(Array.isArray(m)||!m||!m.isMeshStandardMaterial||m.transparent)return;
    if(o.isInstancedMesh){o.computeBoundingBox();_B.copy(o.boundingBox).applyMatrix4(o.matrixWorld)}else{if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();_B.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)}
    if(_B.max.y<.05&&_B.min.y>-.05)out.push({o,b:_B.clone()});
  });
  return out;
}
function fnv(h,v){v=Math.round(v)|0;h^=v&0xffff;h=Math.imul(h,16777619);h^=(v>>>16)&0xffff;return Math.imul(h,16777619)>>>0}
function hashOf(key,S_,list,fl){
  let h=2166136261;for(const ch of key)h=fnv(h,ch.charCodeAt(0));h=fnv(h,VER);h=fnv(h,S_);h=fnv(h,list.length);
  for(const t of list){h=fnv(h,t.rg.cyl?7:3);for(const v of [t.x,t.y,t.z,t.sx,t.sy,t.sz])h=fnv(h,v*1000);h=fnv(h,t.yaw*1000)}
  h=fnv(h,fl.length);for(const f of fl)for(const v of [f.b.min.x,f.b.min.z,f.b.max.x,f.b.max.z])h=fnv(h,v*100);
  return h.toString(36);
}

/* ---------- the atlas: one shelf-packed rectangle per visible face (the bake runs exactly this) ---------- */
function attempt(items,S_,d){
  const n=items.length,dims=new Array(n);
  for(let i=0;i<n;i++){const it=items[i];let pw,ph;if(it.px){pw=it.px;ph=it.px}else{pw=Math.max(1,Math.ceil(it.w*d));ph=Math.max(1,Math.ceil(it.h*d))}dims[i]=ph>pw?[ph,pw,1]:[pw,ph,0]}
  const order=[...dims.keys()].sort((a,b)=>dims[b][1]-dims[a][1]||dims[b][0]-dims[a][0]||a-b);
  let x=0,y=0,sh=0;const out=new Array(n);
  for(const i of order){const [pw,ph,rot]=dims[i],w2=pw+2*PAD,h2=ph+2*PAD;if(w2>S_)return null;if(x+w2>S_){x=0;y+=sh;sh=0}if(y+h2>S_)return null;out[i]=[x+PAD,y+PAD,pw,ph,rot];x+=w2;if(h2>sh)sh=h2}
  return out;
}
function pack(list,S_,dens){
  const items=[{px:CAP},{px:CAP}],refs=[null,null];   // [0] the constant "lit from above" block for tops at ceiling height, [1] a dark one
  for(const t of list)for(const f of t.f)if(f&&!f.fl){items.push(f);refs.push(f)}
  let d=dens,res=d?attempt(items,S_,d):null;
  if(!d){let lo=1,hi=800;for(let k=0;k<26;k++){const mid=(lo+hi)/2,r=attempt(items,S_,mid);if(r){lo=mid;d=mid;res=r}else hi=mid}}
  if(!res)return null;
  const blk=b=>[(res[b][0]+CAP/2)/S_,(res[b][1]+CAP/2)/S_,0,0];
  for(let k=2;k<items.length;k++){const [x,y,pw,ph,rot]=res[k];refs[k].r=[x/S_,y/S_,(rot?-pw:pw)/S_,ph/S_]}
  for(const t of list)for(const f of t.f)if(f&&f.fl)f.r=blk(f.fl==='cap'?0:1);
  return{d,res,cap:res[0],dark:res[1],rects:res.slice(2)};
}

/* ---------- materials: lightmap on, scene lights and the environment's diffuse light off ---------- */
const MAPS=THREE.ShaderChunk.lights_fragment_maps,IBL='iblIrradiance += getIBLIrradiance( geometryNormal );',LMI='irradiance += lightMapIrradiance;';
const MAPS_BAKED=MAPS.replace(IBL,'').replace(LMI,'irradiance = lightMapIrradiance;');
const KILL_DIRECT='reflectedLight.directDiffuse = vec3( 0.0 );\nreflectedLight.directSpecular = vec3( 0.0 );\n';
const ATLAS_VS=`{ vec3 bn = normal; vec4 r = bn.y > .5 ? bkR2 : bn.y < -.5 ? bkR3 : BK_SIDE;
  vec2 t = uv; if ( r.z < 0.0 ) { t = t.yx; r.z = -r.z; }
  vLightMapUv = r.xy + t * r.zw; }`;
const FLOOR_VS=`{ vec4 bw = vec4( position, 1.0 );
  #ifdef USE_INSTANCING
    bw = instanceMatrix * bw;
  #endif
  bw = modelMatrix * bw; vLightMapUv = ( bw.xz - bkFloor.xy ) / bkFloor.zw; }`;
const SIDE_BOX='bn.x > .5 ? bkR0 : bn.x < -.5 ? bkR1 : bn.z > .5 ? bkR4 : bkR5',SIDE_CYL='bkR0';
function variant(base,kind,lm,K,vars){
  const key=kind+base.uuid;if(vars.has(key))return vars.get(key);
  const m=base.clone();m.userData={bk:kind};m.lightMap=lm;m.lightMapIntensity=K*Math.PI;
  m.onBeforeCompile=sh=>{
    if(kind==='f'){sh.uniforms.bkFloor=U.bkFloor;sh.vertexShader='uniform vec4 bkFloor;\n'+sh.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\n'+FLOOR_VS)}
    else sh.vertexShader='attribute vec4 bkR0;\nattribute vec4 bkR1;\nattribute vec4 bkR2;\nattribute vec4 bkR3;\nattribute vec4 bkR4;\nattribute vec4 bkR5;\n'
      +sh.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\n'+ATLAS_VS.replace('BK_SIDE',kind==='c'?SIDE_CYL:SIDE_BOX));
    sh.fragmentShader=sh.fragmentShader.replace('#include <lights_fragment_maps>',MAPS_BAKED).replace('#include <lights_fragment_end>',KILL_DIRECT+'#include <lights_fragment_end>');
  };
  m.customProgramCacheKey=()=>'bk-'+kind;
  vars.set(key,m);return m;
}

/* ---------- textures: each world's two images are files beside the page (BAKE_DIR), not part of it ---------- */
// The world you are in loads its own when it is entered; once a world is lit, the others download in the background, so later
// floors light up as soon as they are entered. (A build with --inline-bakes carries them in the page as data URLs instead.)
// A world whose images can't be loaded keeps realtime Studio light and tries again on its next visit; one whose images
// arrive but can't be decoded (no AVIF in this browser) stays realtime.
const BM_OPTS={imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'};
const files=new Map();
function bytes(name){ // a file's bytes, fetched once per page; a failed download is forgotten so a later visit tries again
  if(files.has(name))return files.get(name);
  const p=fetch(BAKE_DIR+name).then(r=>r.ok?r.blob():null).catch(()=>null);
  files.set(name,p);p.then(b=>{if(!b&&files.get(name)===p)files.delete(name)});return p;
}
let prefetched=false;
function prefetch(){
  if(prefetched)return;prefetched=true;
  const go=()=>{for(const k in BAKES){const r=BAKES[k];for(const n of [r.f,r.a])if(n&&!/^data:/.test(n))bytes(n)}};
  if(window.requestIdleCallback)requestIdleCallback(go,{timeout:5000});else setTimeout(go,2000);
}
async function decode(src){
  let bm=null;
  if(/^data:/.test(src))bm=await createImageBitmap(await (await fetch(src)).blob(),BM_OPTS);
  else{
    const b=await bytes(src);
    if(b){try{bm=await createImageBitmap(b,BM_OPTS)}catch(e){e.bkBad=true;throw e}}
    // where fetch isn't allowed, an <img> may be. CORS mode: a cross-origin (or file://) image then fails to load here instead of
    // decoding into a bitmap WebGL refuses, which would light the world with a black lightmap
    else{const img=new Image();img.crossOrigin='anonymous';img.src=BAKE_DIR+src;await img.decode();bm=await createImageBitmap(img,BM_OPTS)}
  }
  const t=new THREE.Texture(bm);t.flipY=false;t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.needsUpdate=true;return t;
}
function textures(key,r){
  if(texCache.has(key))return texCache.get(key);
  const p=Promise.all([decode(r.f),r.a?decode(r.a):null]).then(([f,a])=>{f.generateMipmaps=true;f.minFilter=THREE.LinearMipmapLinearFilter;if(a){a.generateMipmaps=false;a.minFilter=THREE.LinearFilter}return{f,a}});
  texCache.set(key,p);p.catch(()=>{if(texCache.get(key)===p)texCache.delete(key)});
  if(texCache.size>3){const [k0,p0]=texCache.entries().next().value;texCache.delete(k0);p0.then(t=>{for(const x of [t.f,t.a])if(x){if(x.image&&x.image.close)x.image.close();x.dispose()}}).catch(()=>{})}
  return p;
}

/* ---------- a world was built: use its bake when one matches ---------- */
function geomFor(kind,m){
  if(kind==='campus')return{x0:-m.w/2,z0:-m.d/2,w:m.w,d:m.d,S:0};
  return{x0:-(m.w+6)/2,z0:-(m.d+6)/2,w:m.w+6,d:m.d+6,S:m.w*m.d>2000?2048:1024};   // HD's ground runs 3 m past the walls; big floors get a bigger atlas
}
function prepare(key,m,kind){
  root.updateMatrixWorld(true);
  const G=geomFor(kind,m),list=collect(m,kind);flat=findFlat();
  const h=hashOf(key,G.S,list,flat);
  return{G,list,h};
}
function world(key,m,kind){
  if(!S||!S.hd||!m)return;
  worldKey=key;const r=BAKES[key];
  if(!r||bad.has(key)||!enabled)return;   // (the registered batches stay, for a capture)
  const P=prepare(key,m,kind);
  if(P.h!==r.h){console.info(`baked light for ${key} doesn't match this layout (${P.h} vs ${r.h}): realtime Studio`);return}
  faces=P.list.length?pack(P.list,P.G.S,r.d):{rects:[]};
  if(!faces)return;
  const rootNow=root,tok={};loading=tok;
  const done=()=>{if(loading===tok)loading=null};
  pending=textures(key,r).then(
    t=>{const late=tok.shown;done();if(late){prefetch();return}   // too late for this visit (see reveal): the next one uses them
      if(root===rootNow&&worldKey===key&&S.hd){try{apply(key,m,kind,r,P,t)}catch(e){bad.add(key);console.warn('baked light failed for '+key,e);HD.warm()}}},
    e=>{done();if(e&&e.bkBad)bad.add(key);console.warn('baked light failed to load for '+key+(e&&e.bkBad?'':' (tries again on the next visit)'),e);if(root===rootNow&&!tok.shown)HD.warm()}); // realtime it is: warm that up
}
// The cover is lifting and this world's images still haven't arrived: it stays realtime for this visit, so the light (and every
// shader with it) never switches in front of the player. The images stay cached and light the next visit, behind its fade.
function reveal(){if(loading){loading.shown=true;loading=null;HD.warm()}}
function apply(key,m,kind,r,P,t){
  const vars=new Map(),olds=new Set(),K=r.K*(r.g||1),G=P.G;
  U.bkFloor.value.set(G.x0,G.z0,G.w,G.d);
  // statics in the atlas: per-instance rectangles on a private copy of the batch's geometry
  const byIm=new Map();for(const it of P.list){let l=byIm.get(it.rg);if(!l)byIm.set(it.rg,l=[]);l.push(it)}
  for(const [rg,list] of byIm){
    const im=rg.im,n=im.count,arr=[0,1,2,3,4,5].map(()=>new Float32Array(n*4));
    for(const it of list)for(let f=0;f<6;f++){const fc=it.f[f],a=arr[f];if(fc&&fc.r)a.set(fc.r,it.i*4)}
    const g=im.geometry.clone();g.userData={};arr.forEach((a,f)=>g.setAttribute('bkR'+f,new THREE.InstancedBufferAttribute(a,4)));
    if(!im.geometry.userData.keep)im.geometry.dispose();im.geometry=g;
    olds.add(im.material);im.material=variant(im.material,rg.cyl?'c':'a',t.a,K,vars);
  }
  for(const {o} of flat){olds.add(o.material);o.material=variant(o.material,'f',t.f,K,vars)}
  // the replaced materials nobody draws with any more (clearRoot only finds what is still on a mesh); keep their textures,
  // the variants share them
  const used=new Set();root.traverse(o=>{if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(x=>used.add(x))});
  for(const x of olds)if(!used.has(x)&&!x.userData.keep)x.dispose();
  // light for the things that move: a hemisphere light measured from the bake; no sun, no shadow map
  const hemi=root.children.find(o=>o.isHemisphereLight);
  if(kind!=='campus'){
    if(sun)sun.visible=false;root.children.forEach(o=>{if(o.isDirectionalLight&&o!==sun)o.visible=false});
    if(hemi&&r.hemi){hemi.color.set(r.hemi[0]);hemi.groundColor.set(r.hemi[1]);hemi.intensity=r.hemi[2]}
    if(r.exp)renderer.toneMappingExposure=r.exp;
    makeBlobs();
  }
  renderer.shadowMap.enabled=false;
  scene.traverse(o=>{if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(x=>x.needsUpdate=true)});
  on=true;rec=r;HD.restyle();
  // the lights and the shadow map just changed every shader's variant: compile the hidden ones again (smoke, sparks...), after the
  // next frame has drawn the new materials (warming them before that made the GL driver report queries of deleted programs)
  requestAnimationFrame(()=>requestAnimationFrame(()=>HD.warm()));
  prefetch(); // the other worlds' images, in the background
}

/* ---------- soft contact blobs under chairs (there is no shadow map on a baked floor) ---------- */
function makeBlobs(){
  const list=typeof chairs!=='undefined'?chairs:[];if(!list.length)return;
  const g=new THREE.PlaneGeometry(1,1);g.rotateX(-Math.PI/2);
  blobs=new THREE.InstancedMesh(g,new THREE.MeshBasicMaterial({map:RADIAL,color:0x000000,transparent:true,opacity:.34,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),list.length);
  blobs.userData.dyn=true;blobs.frustumCulled=false;blobs.renderOrder=1;list.forEach(c=>chair(c));root.add(blobs);blobs.instanceMatrix.needsUpdate=true;
}
function chair(c){if(!blobs||c.i==null||c.i>=blobs.count)return;_M4.compose(_P.set(c.x,.014,c.z),_Q.identity(),_S.set(c.kind==='stool'?.6:.86,1,c.kind==='stool'?.6:.86));blobs.setMatrixAt(c.i,_M4);blobDirty=true}
function frame(){if(blobDirty&&blobs){blobs.instanceMatrix.needsUpdate=true;blobDirty=false}}

/* ---------- capture for the bake (src/tools/bake/capture.mjs, test builds only) ---------- */
const b64f=a=>{const u=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)};
function lin(c){return[c.r,c.g,c.b]}
function capture(){
  const key=WKEY,m=WM,kind=WKIND;if(!S.hd||!m)return null;
  const P=prepare(key,m,kind),G=P.G,pk=P.list.length?pack(P.list,G.S,0):{d:0,rects:[],cap:[0,0,0,0],dark:[0,0,0,0]};
  const A={p:[],u:[],c:[]},F={p:[],c:[]},O={p:[],c:[]},v=new V3(),col=new THREE.Color(),ic=new THREE.Color();
  const tri=(T,g,M,i0,i1,i2,uvs,c)=>{for(const k of [i0,i1,i2]){v.fromBufferAttribute(g.attributes.position,k).applyMatrix4(M);T.p.push(v.x,v.y,v.z);if(uvs)T.u.push(uvs[k*2],uvs[k*2+1])}T.c.push(c[0],c[1],c[2])};
  const each=(g,fn)=>{const ix=g.index,n=ix?ix.count:g.attributes.position.count;for(let k=0;k<n;k+=3)fn(ix?ix.getX(k):k,ix?ix.getX(k+1):k+1,ix?ix.getX(k+2):k+2)};
  const albedo=(mt,im,i)=>{col.copy(mt.userData.avg||mt.color||col.setRGB(.7,.7,.7));if(mt.map)col.multiplyScalar(.82);if(im&&im.instanceColor){im.getColorAt(i,ic);col.multiply(ic)}if(mt.vertexColors)col.multiplyScalar(.9);return lin(col)};
  // atlas faces with their lightmap coordinates (exactly the shader's)
  const regSet=new Set();
  for(const it of P.list){
    const im=it.rg.im,g=im.geometry;regSet.add(im);im.getMatrixAt(it.i,_M4);_M4.premultiply(im.matrixWorld);
    const nrm=g.attributes.normal,uv=g.attributes.uv,uvs=new Float32Array(g.attributes.position.count*2),c=albedo(im.material,im,it.i);
    for(let k=0;k<g.attributes.position.count;k++){const ny=nrm.getY(k),nx=nrm.getX(k),nz=nrm.getZ(k);
      const f=ny>.5?2:ny<-.5?3:it.rg.cyl?0:nx>.5?0:nx<-.5?1:nz>.5?4:5,fc=it.f[f],r=fc&&fc.r?fc.r:[0,0,0,0];let tu=uv.getX(k),tv=uv.getY(k),rz=r[2];if(rz<0){[tu,tv]=[tv,tu];rz=-rz}
      uvs[k*2]=r[0]+tu*rz;uvs[k*2+1]=r[1]+tv*r[3]}
    each(g,(a,b,cc)=>{const ny=nrm.getY(a),nx=nrm.getX(a),nz=nrm.getZ(a),f=ny>.5?2:ny<-.5?3:it.rg.cyl?0:nx>.5?0:nx<-.5?1:nz>.5?4:5,fc=it.f[f];
      if(fc&&!fc.fl)tri(A,g,_M4,a,b,cc,uvs,c);else tri(O,g,_M4,a,b,cc,null,c)});
  }
  // ground pieces (top-down lightmap) and every other static thing that blocks light; things that move are left out
  const flatSet=new Set(flat.map(f=>f.o));
  // only the faces that look up, lowest first: overlapping finishes share floor texels and the bake keeps the last one,
  // so a carpet wins over the slab under it and a border over the carpet (a border's underside would bake black)
  const FT=[],va=new V3(),vb=new V3(),vc=new V3();
  for(const f of flat){const o=f.o,g=o.geometry;const n=o.isInstancedMesh?o.count:1;for(let i=0;i<n;i++){if(o.isInstancedMesh){o.getMatrixAt(i,_M4);_M4.premultiply(o.matrixWorld)}else _M4.copy(o.matrixWorld);const c=albedo(o.material,o.isInstancedMesh?o:null,i);
    each(g,(a,b,cc)=>{const P=g.attributes.position;va.fromBufferAttribute(P,a).applyMatrix4(_M4);vb.fromBufferAttribute(P,b).applyMatrix4(_M4);vc.fromBufferAttribute(P,cc).applyMatrix4(_M4);
      const ny=(vb.z-va.z)*(vc.x-va.x)-(vb.x-va.x)*(vc.z-va.z),area=Math.abs(ny);if(area<1e-9||ny<=0)return;   // world normal's y sign (counter-clockwise from above)
      FT.push({y:(va.y+vb.y+vc.y)/3,p:[va.x,va.y,va.z,vb.x,vb.y,vb.z,vc.x,vc.y,vc.z],c})})}}
  FT.sort((a,b)=>a.y-b.y);for(const t of FT){F.p.push(...t.p);F.c.push(...t.c)}
  const dyn=new Set();
  try{for(const gk in (figG||{}))if(figG[gk]&&figG[gk].mesh)dyn.add(figG[gk].mesh)}catch(_){}
  try{for(const cg of chairG||[])if(cg&&cg.mesh)dyn.add(cg.mesh)}catch(_){}
  root.traverse(o=>{
    if(!o.isMesh||regSet.has(o)||flatSet.has(o)||dyn.has(o)||o.userData.dyn||!o.visible)return;const mt=o.material;if(Array.isArray(mt)||!mt||mt.transparent||mt.isMeshBasicMaterial||o.isSprite)return;
    const g=o.geometry;if(!g||!g.attributes.position)return;const n=o.isInstancedMesh?o.count:1;
    if(!g.boundingBox)g.computeBoundingBox();const gb=g.boundingBox.getSize(v);if(Math.max(gb.x,gb.y,gb.z)*(o.isInstancedMesh?1:o.matrixWorld.getMaxScaleOnAxis())<.2)return; // keyboards, mice: too small to matter for light
    // a model whose parts HD merged into one mesh (game-2c-hd.js mergeParts) keeps each part's own color here, as before the merge
    const parts=g.userData.parts&&g.index?g.userData.parts.filter(p=>p.s>=.2).map(p=>({p,c:lin(col.copy(p.c).multiplyScalar(p.vc?.9:1))})):null; // (the same 20 cm cut per part)
    for(let i=0;i<n;i++){if(o.isInstancedMesh){o.getMatrixAt(i,_M4);_M4.premultiply(o.matrixWorld)}else _M4.copy(o.matrixWorld);
      if(parts){const ix=g.index;for(const {p,c} of parts)for(let t=p.k0;t<p.k1;t+=3)tri(O,g,_M4,ix.getX(t),ix.getX(t+1),ix.getX(t+2),null,c);continue}
      const c=albedo(mt,o.isInstancedMesh?o:null,i);each(g,(a,b,cc)=>tri(O,g,_M4,a,b,cc,null,c))}
  });
  const pxw=kind==='campus'?2048:1024;
  return{key,kind,hash:P.h,ver:VER,w:m.w,d:m.d,H,sunDir:[sunDir.x,sunDir.y,sunDir.z],
    rooms:(m.rooms||[]).map(r=>({type:r.type,x:r.x,z:r.z,w:r.w,d:r.d,solid:!!r.solid})),
    floor:{x0:G.x0,z0:G.z0,w:G.w,d:G.d,px:[pxw,Math.round(pxw*G.d/G.w)]},
    atlas:{S:G.S,pad:PAD,d:pk.d,cap:pk.cap,dark:pk.dark,rects:pk.rects.map(r=>r.slice(0,4))},
    A:{p:b64f(new Float32Array(A.p)),u:b64f(new Float32Array(A.u)),c:b64f(new Float32Array(A.c)),n:A.c.length/3},
    F:{p:b64f(new Float32Array(F.p)),c:b64f(new Float32Array(F.c)),n:F.c.length/3},
    O:{p:b64f(new Float32Array(O.p)),c:b64f(new Float32Array(O.c)),n:O.c.length/3}};
}

return{reg,enter,world,reveal,chair,frame,capture,ready:()=>pending,get loading(){return !!loading},enable:v=>{enabled=!!v},get on(){return on},get info(){return{on,key:worldKey,K:rec&&rec.K,faces:faces&&faces.rects?faces.rects.length:0}}};
})();
