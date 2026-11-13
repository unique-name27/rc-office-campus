/* ===================== game part 1b: avatars (RC car, dog, cat) ===================== */
// Modeled in Blender from code (src/blender/avatars.py) and inlined as AVMESH. Each avatar is a few parts on pivots the
// game animates: wheels (spin, front pair steers) and the antenna; the head, four legs and the tail. Every Blender
// material maps onto one of the style roles, so all five styles recolor them. The line-art styles draw each piece's
// silhouette (an inverted hull) and its creases; Comic inks the same hull black. Studio adds the baked AO.
// makeAvatar returns {g, tilt, cup, under, ...}: wheels/ap/flame/beam for the car, head/legs/tail for the animals.
const AVATARS=[["car","RC car"],["dog","Dog"],["cat","Cat"]];
// coat colors for the animals (the car keeps its paint swatches)
const COATS={
  dog:[["#C8924E","Golden"],["#6B4226","Chocolate"],["#2B2622","Black"],["#EFE8DC","Cream"],["#8C8F94","Gray"],["#B5541E","Red"],["#D9C29A","Biscuit"]],
  cat:[["#E08A3C","Orange tabby"],["#2A2724","Black"],["#F2EEE6","White"],["#9AA0A6","Gray"],["#C9B79A","Siamese"],["#7A5A3A","Brown"],["#5E6670","Blue"]]
};
const AV_KINDS=new Set(["car","dog","cat"]);
const TABBY=new Set(["#E08A3C","#9AA0A6","#7A5A3A"]),SIAMESE="#C9B79A"; // coats that show stripes / dark points
const LEGI={legFL:0,legFR:1,legBL:2,legBR:3};                           // the order animateAnimal expects

// decoded once per kind; the geometry is shared by every avatar of that kind (marked keep: never disposed)
const AVD={};
function avData(kind){
  if(AVD[kind])return AVD[kind];
  const src=AVMESH[kind],q=AVMESH.q,u8=s=>{const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u};
  const parts=src.parts.map(P=>{
    const m=P.m.map(M=>{
      const Pq=new Int16Array(u8(M.p).buffer),Nq=new Int8Array(u8(M.n).buffer),A=u8(M.a),I=new Uint16Array(u8(M.i).buffer);
      const pos=new Float32Array(Pq.length),nor=new Float32Array(Nq.length),col=new Float32Array(A.length*3);
      for(let i=0;i<Pq.length;i++)pos[i]=Pq[i]/q;
      for(let i=0;i<Nq.length;i+=3){const l=Math.hypot(Nq[i],Nq[i+1],Nq[i+2]);if(l>0){nor[i]=Nq[i]/l;nor[i+1]=Nq[i+1]/l;nor[i+2]=Nq[i+2]/l}else nor[i+1]=1} // never a zero normal (NaN shading)
      for(let i=0;i<A.length;i++)col[i*3]=col[i*3+1]=col[i*3+2]=A[i]/255;
      const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(pos,3));g.setAttribute("normal",new THREE.BufferAttribute(nor,3));
      g.setAttribute("color",new THREE.BufferAttribute(col,3));g.setIndex(new THREE.BufferAttribute(I,1));g.computeBoundingSphere();g.userData.keep=true;
      return{k:M.k,geo:g};
    });
    let lines=null;
    if(P.l){const L=new Int16Array(u8(P.l).buffer);if(L.length){const lp=new Float32Array(L.length);for(let i=0;i<L.length;i++)lp[i]=L[i]/q;lines=new THREE.BufferGeometry();lines.setAttribute("position",new THREE.BufferAttribute(lp,3));lines.userData.keep=true}}
    return{n:P.n,o:new V3(P.o[0],P.o[1],P.o[2]),m,lines,hull:{}};
  });
  return AVD[kind]={parts,at:src.at||{}};
}
// an outline shell for a part: its pieces (not the cat's stripes) pushed out along their smoothed normals by t meters (drawn back faces only)
function avHull(P,t){
  const key=t.toFixed(4);if(P.hull[key])return P.hull[key];
  const sum=new Map(),K=(a,i)=>Math.round(a[i]*4000)+","+Math.round(a[i+1]*4000)+","+Math.round(a[i+2]*4000);
  const ms=P.m.filter(M=>M.k!=="furStripe");
  for(const M of ms){const p=M.geo.attributes.position.array,n=M.geo.attributes.normal.array;for(let i=0;i<p.length;i+=3){const k=K(p,i);let s=sum.get(k);if(!s)sum.set(k,s=[0,0,0]);s[0]+=n[i];s[1]+=n[i+1];s[2]+=n[i+2]}}
  let nv=0,ni=0;for(const M of ms){nv+=M.geo.attributes.position.count;ni+=M.geo.index.count}
  const pos=new Float32Array(nv*3),idx=new Uint32Array(ni);let vo=0,io=0;
  for(const M of ms){
    const p=M.geo.attributes.position.array,ix=M.geo.index.array,base=vo/3;
    for(let i=0;i<p.length;i+=3){const s=sum.get(K(p,i)),l=Math.hypot(s[0],s[1],s[2])||1;pos[vo++]=p[i]+s[0]/l*t;pos[vo++]=p[i+1]+s[1]/l*t;pos[vo++]=p[i+2]+s[2]/l*t}
    for(let i=0;i<ix.length;i++)idx[io++]=ix[i]+base;
  }
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(pos,3));g.setIndex(new THREE.BufferAttribute(idx,1));g.computeBoundingSphere();g.userData.keep=true;
  return P.hull[key]=g;
}
// Blender material name -> [style role, color]. Coat shades follow the coat; Neon draws faces dark, Blueprint in the ground color.
function avRoles(kind,paint){
  const face=S.carFace?pal("car"):paint,flat=S.carFace||S.faceIsBg,shade=(t,to)=>flat?face:mix(paint,to,t).getStyle();
  if(kind==="car")return{paint:["car",face],trim:["tire"],glass:["glass"],tire:["tire"],rim:["rim"],light:["light"],tail:["tail"],white:["cup"]};
  const tab=TABBY.has(paint)&&kind==="cat",sia=paint===SIAMESE&&kind==="cat";
  return{fur:["fur",face],furLight:["fur",shade(.5,"#FFFFFF")],furDark:["fur",shade(.45,"#1A1410")],furStripe:["fur",tab?shade(.4,"#2A1608"):face],furPoint:["fur",sia&&!flat?"#4A3426":face],
    eye:["tire"],iris:["screen",S.carFace?null:"#9BD84A"],shine:["light"],nose:["tire"],pink:["fur",flat?face:"#E58C9A"],collar:["ramp",S.faceIsBg?null:S.acc],tag:["rim",flat?null:"#E8C25A"],whisker:["cup"]};
}
function makeCar(paint){return makeAvatar("car",paint)}
function makeAvatar(kind,paint){
  if(!AV_KINDS.has(kind))kind="car";
  const D=avData(kind),car=kind==="car",g=new THREE.Group(),tilt=new THREE.Group();g.add(tilt);root.add(g);
  const v={g,tilt,kind,wheels:[],legs:car?null:[],head:null,tail:null,ap:null,cup:null,under:null,flame:null,beam:null};
  const R=avRoles(kind,paint),ec=S.edges?edgeColor("car",{car:true,paint}):null,art=!!ec;
  const hullT=S.outline?.0065:art?.0032:0,hullM=S.outline?HULL:art?new THREE.MeshBasicMaterial({color:ec,side:THREE.BackSide,transparent:S.edges.o<1,opacity:S.edges.o}):null;
  if(hullM&&hullM!==HULL&&hullM.transparent)lineMats.push(hullM);
  for(const P of D.parts){
    const pv=new THREE.Group();pv.position.copy(P.o);tilt.add(pv);let host=pv;
    if(P.n.startsWith("wheel")){const sp=new THREE.Group();pv.add(sp);host=sp;v.wheels.push({pv,sp,f:P.n[5]==="F"})}
    else if(P.n in LEGI)v.legs[LEGI[P.n]]=pv;else if(P.n==="head")v.head=pv;else if(P.n==="tail")v.tail=pv;else if(P.n==="antenna")v.ap=pv;
    for(const M of P.m){
      if(M.k==="furStripe"&&!TABBY.has(paint))continue; // the raised tabby bands: only tabby coats show them
      const r=R[M.k]||["car",paint],m=part(M.geo,r[0],0,0,0,host,{car:true,paint,color:r[1]||undefined,noEdge:true,noOutline:true});
      if(P.n==="tail")m.userData.wag=1; // HD's shadow gate: the idle wag alone doesn't redraw the sun's shadow map
      if(S.hd&&m.material.isMeshStandardMaterial){m.material.vertexColors=true;m.material.needsUpdate=true} // the AO baked in Blender
    }
    if(hullM)host.add(new THREE.Mesh(avHull(P,hullT),hullM));
    if(art&&P.lines){const lm=new THREE.LineBasicMaterial({color:ec,transparent:S.edges.o<1,opacity:S.edges.o});lineMats.push(lm);host.add(new THREE.LineSegments(P.lines,lm))}
  }
  // a coffee cup that rides on the roof (or the back) during a coffee run
  const cp=D.at.cup||[0,.2,0],cup=new THREE.Group();cup.position.set(cp[0],cp[1],cp[2]);tilt.add(cup);cup.visible=false;v.cup=cup;
  part(cyl(.03,.026,.075,12),"cup",0,.0375,0,cup,{car:true,paint});part(cyl(.032,.032,.012,12),"lid",0,.08,0,cup,{car:true,paint});
  if(car){
    // boost flames out of the exhausts
    const flame=new THREE.Group();tilt.add(flame);flame.visible=false;v.flame=flame;
    const fmO=new THREE.MeshBasicMaterial({color:S.glow||S.depthOnly?bright(paint):"#FF9A3C",transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}),fmI=new THREE.MeshBasicMaterial({color:"#FFF4C2",transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
    for(const [x,y,z] of D.at.flame||[[-.05,.05,.28],[.05,.05,.28]]){const o=new THREE.ConeGeometry(.022,.13,10);o.rotateX(Math.PI/2);const mo=new THREE.Mesh(o,fmO);mo.position.set(x,y,z+.065);flame.add(mo);const i=new THREE.ConeGeometry(.011,.07,8);i.rotateX(Math.PI/2);const mi=new THREE.Mesh(i,fmI);mi.position.set(x,y,z+.035);flame.add(mi)}
  }
  // underglow (Neon) or a soft contact shadow
  const big=car?[.38,.62]:kind==="dog"?[.36,.56]:[.28,.44];
  if(S.glow){
    const pg=new THREE.PlaneGeometry(big[0],big[1]);pg.rotateX(-Math.PI/2);const gm=new THREE.MeshBasicMaterial({map:RADIAL,color:bright(paint),transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false});glowMats.push(gm);v.under=new THREE.Mesh(pg,gm);v.under.position.y=.03;g.add(v.under);
    if(car){const bg=new THREE.ConeGeometry(.45,2.4,20,1,true);bg.rotateX(Math.PI/2);bg.translate(0,.07,-.25-1.2);v.beam=new THREE.Mesh(bg,new THREE.MeshBasicMaterial({color:"#E8FFFF",transparent:true,opacity:.07,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));tilt.add(v.beam)}
  }else if(S.blob||S.ao){const pg=new THREE.PlaneGeometry(big[0],big[1]);pg.rotateX(-Math.PI/2);v.under=new THREE.Mesh(pg,new THREE.MeshBasicMaterial({map:RADIAL,color:0x000000,transparent:true,opacity:S.hd?.3:.35,depthWrite:false,toneMapped:false}));v.under.position.y=.028;g.add(v.under)}
  return v;
}
// trot cycle, tail wag, head bob; legs tuck while airborne
function animateAnimal(c,v,dt){
  const sp=Math.hypot(c.vx,c.vz),dog=v.kind==="dog";
  c.phase=(c.phase||0)+dt*(3+sp*(dog?3.4:4));
  const amp=Math.min(.8,sp*.16);
  v.legs.forEach((L,i)=>{const ph=(i===0||i===3)?0:Math.PI;L.rotation.x=c.air?(i<2?-.75:.65):Math.sin(c.phase+ph)*amp});
  v.tail.rotation.y=Math.sin(T*(dog?13:3.5)+(dog?0:c.x))*(dog?.55:.3);
  if(!dog)v.tail.rotation.z=Math.sin(T*2.1)*.12;
  v.head.rotation.x=c.air?-.2:Math.sin(c.phase*2)*.04*Math.min(1,sp/2);
  v.tilt.position.y=-c.squash*.03+(c.air?0:Math.abs(Math.sin(c.phase))*.014*Math.min(1,sp/3));
}
