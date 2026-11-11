/* ===================== game part 2: campus data, collisions, chairs, building the 3D world ===================== */
const H=3;               // interior wall height
const FLOOR_H=4.2;       // storey height of the buildings on the campus
let DEMO=null;           // CAMPUS.demo(LAYOUT): the sample campus
let DATA=null;           // { campus, floors:{key:spec}, rosters:{key:[...]}, demo:bool, src:{floors:{key:'db'|'demo'|'auto'}} }
const MODELS=new Map();let EXT=null;
let WKEY="",WM=null,WKIND="floor",PW=70,PD=44,RAMPS=[];

function teamsMap(){return(DATA&&DATA.campus&&DATA.campus.teams)||{}}
function bldg(id){return DATA.campus.buildings.find(b=>b.id===id)||null}
function bldgOfKey(key){const p=CAMPUS.parseKey(key);return p?bldg(p.b):null}
function floorName(key){if(key==="campus")return DATA.campus.name||"Campus";const p=CAMPUS.parseKey(key),b=p&&bldg(p.b);return b?`${b.name} · Floor ${p.f}`:key}
function floorShort(key){if(key==="campus")return"Outside";const p=CAMPUS.parseKey(key),b=p&&bldg(p.b);return b?`${b.short||b.id} · ${p.f}F`:key}
function floorKeys(){const ks=[];for(const b of DATA.campus.buildings)for(let f=1;f<=b.floors;f++)ks.push(CAMPUS.key(b.id,f));return ks}
function teamColorOf(team){const t=teamsMap()[team];return t&&HEX.test(t.color)?t.color:CAMPUS.teamColor(team||"",0)}
function teamArrOf(team){const t=teamsMap()[team];return t&&LAYOUT.ARR.includes(t.arr)?t.arr:CAMPUS.defaultArr(team||"")}
// a floor with no saved layout: copy the building's core (elevators, stairs, restrooms) from another floor so routes still work
function blankSpec(b,f){
  const key=CAMPUS.key(b.id,f),sib=Object.values(DATA.floors).find(s=>s&&s.b===b.id&&s.f!==f);
  const core=sib?(sib.rooms||[]).filter(r=>r.type==="elevator"||r.type==="stairs"||r.type==="restroom").map(r=>Object.assign({},r)):[];
  if(!core.some(r=>r.type==="elevator"))core.push({id:"e1",type:"elevator",name:"Elevator",x:0,z:-b.d/2+3,w:2.6,d:2.4,door:"s"});
  return{v:1,key,b:b.id,f,w:b.w,d:b.d,door:f===1?{side:"s",at:0,w:3}:null,plan:null,walls:[],glass:[],rooms:core,zones:[],desks:[],ramps:null,updatedAt:0};
}
function modelFor(key){
  if(key==="campus")return extModel();
  let m=MODELS.get(key);if(m)return m;
  const spec=DATA.floors[key];if(!spec)return null;
  try{m=LAYOUT.build(spec,DATA.rosters[key]||[],teamsMap())}catch(e){console.error("layout failed for "+key,e);m=null}
  if(m)MODELS.set(key,m);return m;
}
function extModel(){if(!EXT){try{EXT=CAMPUS.exterior(DATA.campus,DATA.floors)}catch(e){console.error("campus exterior failed",e)}}return EXT}
function invalidate(keys){if(!keys){MODELS.clear();EXT=null;navCache.clear();peopleIdx=null;return}for(const k of keys){MODELS.delete(k);navCache.delete(k)}EXT=null;navCache.delete("campus");peopleIdx=null}

/* ---------- ramps (per world) ---------- */
const KB=.28;
function humpH(r,u,v){if(Math.abs(u)>=r.len/2||Math.abs(v)>=r.w/2)return 0;const t=u/r.len+.5,e=Math.min(1,(r.w/2-Math.abs(v))/.32);return r.h*(1-Math.cos(2*Math.PI*t))/2*e*e*(3-2*e)}
function kickH(r,u,v){const L=r.len;if(Math.abs(v)>r.w/2||u<-L/2||u>L/2+KB)return 0;if(u<=L/2){const t=(u+L/2)/L;return r.h*(.35*t+.65*t*t)}return r.h*(1-(u-L/2)/KB)}
function groundY(x,z){let y=0;for(let i=0;i<RAMPS.length;i++){const r=RAMPS[i],dx=x-r.x,dz=z-r.z;if(Math.abs(dx)>2.2||Math.abs(dz)>2.2)continue;const u=(r.ax==="x"?dx:dz)*r.dir,v=r.ax==="x"?dz:dx;const h=r.k==="hump"?humpH(r,u,v):kickH(r,u,v);if(h>y)y=h}return y}

/* ---------- collision grid (masks: 1 car, 2 chair, 4 walker) ---------- */
const CS=2;let GX=0,GZ=0,NX=1,NZ=1,cells=[[]];
function resetGrid(w,d){GX=-w/2-2;GZ=-d/2-2;NX=Math.max(1,Math.ceil((w+4)/CS));NZ=Math.max(1,Math.ceil((d+4)/CS));cells=new Array(NX*NZ);for(let i=0;i<cells.length;i++)cells[i]=[]}
const cellOf=(x,z)=>{const cx=Math.floor((x-GX)/CS),cz=Math.floor((z-GZ)/CS);return cx<0||cz<0||cx>=NX||cz>=NZ?-1:cz*NX+cx};
function addCol(c){
  c.s=0;const x0=c.b?c.x0:c.x-c.r,x1=c.b?c.x1:c.x+c.r,z0=c.b?c.z0:c.z-c.r,z1=c.b?c.z1:c.z+c.r;
  if(!(x1>=x0&&z1>=z0))return;
  const ca=Math.max(0,Math.floor((x0-GX)/CS)),cb=Math.min(NX-1,Math.floor((x1-GX)/CS)),ra=Math.max(0,Math.floor((z0-GZ)/CS)),rb=Math.min(NZ-1,Math.floor((z1-GZ)/CS));
  for(let cz=ra;cz<=rb;cz++)for(let cx=ca;cx<=cb;cx++)cells[cz*NX+cx].push(c);
}
let stamp=0;const qbuf=[];
function query(x,z,r,mask){
  stamp++;qbuf.length=0;
  const c0=Math.max(0,Math.floor((x-r-GX)/CS)),c1=Math.min(NX-1,Math.floor((x+r-GX)/CS)),r0=Math.max(0,Math.floor((z-r-GZ)/CS)),r1=Math.min(NZ-1,Math.floor((z+r-GZ)/CS));
  for(let cz=r0;cz<=r1;cz++)for(let cx=c0;cx<=c1;cx++)for(const c of cells[cz*NX+cx])if(c.s!==stamp&&(c.m&mask)){c.s=stamp;qbuf.push(c)}
  return qbuf;
}
const HIT={nx:0,nz:0,pen:0};
function circleVs(c,px,pz,r){
  if(c.b){
    const cx=clamp(px,c.x0,c.x1),cz=clamp(pz,c.z0,c.z1),dx=px-cx,dz=pz-cz,d2=dx*dx+dz*dz;
    if(d2>r*r)return false;
    if(d2>1e-10){const d=Math.sqrt(d2);HIT.nx=dx/d;HIT.nz=dz/d;HIT.pen=r-d;return true}
    const l=px-c.x0,rr_=c.x1-px,t=pz-c.z0,b=c.z1-pz,mn=Math.min(l,rr_,t,b);
    if(mn===l){HIT.nx=-1;HIT.nz=0;HIT.pen=l+r}else if(mn===rr_){HIT.nx=1;HIT.nz=0;HIT.pen=rr_+r}else if(mn===t){HIT.nx=0;HIT.nz=-1;HIT.pen=t+r}else{HIT.nx=0;HIT.nz=1;HIT.pen=b+r}
    return true;
  }
  const dx=px-c.x,dz=pz-c.z,rs=r+c.r,d2=dx*dx+dz*dz;if(d2>=rs*rs)return false;
  const d=Math.sqrt(d2)||1e-6;HIT.nx=dx/d;HIT.nz=dz/d;HIT.pen=rs-d;return true;
}
function loadColliders(m){
  resetGrid(m.w,m.d);
  const fin=v=>typeof v==="number"&&isFinite(v);
  for(const b of m.blocks||[])if(fin(b.x0)&&fin(b.x1)&&fin(b.z0)&&fin(b.z1))addCol({b:1,x0:b.x0,x1:b.x1,z0:b.z0,z1:b.z1,m:b.m|0,tall:b.tall?1:0});
  for(const p of m.posts||[])if(fin(p.x)&&fin(p.z)&&fin(p.r))addCol({x:p.x,z:p.z,r:p.r,m:p.m|0,tall:p.tall?1:0});
  // jumpable surfaces (mask 8): desk tops, tables, lab benches, counters, sofas; outside: benches, planters, parked cars
  // h = top you can stand on, u = underside (open space below it; absent when the thing is solid down to the floor)
  const plats=[];const plat=o=>{addCol(o);plats.push(o)};
  for(const d of m.desks||[]){if(d.arr==="hot"||d.arr==="lab"||!fin(d.x)||!fin(d.z))continue;const sw=Math.abs(Math.sin(d.a||0))>.5,w=(d.w>0?d.w:1.56)/2,dd=(d.dd>0?d.dd:.78)/2;plat({b:1,x0:d.x-(sw?dd:w),x1:d.x+(sw?dd:w),z0:d.z-(sw?w:dd),z1:d.z+(sw?w:dd),m:8,h:.775,u:.725});
    // the monitor and its stand: only in the way for someone up on the desk (the RC car still drives underneath)
    if(d.mon&&d.person>=0){const dd2=d.dd>0?d.dd:.78,fx_=-Math.sin(d.a||0),fz_=-Math.cos(d.a||0),mx_=d.x+fx_*(dd2/2-.17),mz_=d.z+fz_*(dd2/2-.17),hw=sw?.06:.31,hd=sw?.31:.06;addCol({b:1,x0:mx_-hw,x1:mx_+hw,z0:mz_-hd,z1:mz_+hd,m:1,tall:1,minY:.7})}}
  const TOPS={rtable:[i=>i.h>0?i.h:.74,.7],table:[i=>i.h>0?i.h:.74,.7],bench:[i=>i.h>0?i.h:.9],counter:[()=>.995],sofa:[()=>.44],cabinet:[i=>i.h>0?i.h:1],bench_o:[()=>.48,.42],planter:[()=>.6],car:[()=>.98,.26],bikerack:[()=>.445,.395]};
  for(const it of m.items||[]){const t=itemType(it),f=TOPS[t];if(!f||!fin(it.x)||!fin(it.z))continue;const def=IDEF[t]||[1,1,1];let w=(it.w>0?it.w:def[0])/2,d=(it.d>0?it.d:def[1])/2;if(t==="table")w=d=w*.72;
    const sw=Math.abs(Math.sin(it.a||0))>.5,hx=sw?d:w,hz=sw?w:d,o={b:1,x0:it.x-hx,x1:it.x+hx,z0:it.z-hz,z1:it.z+hz,m:8,h:+f[0](it)};if(f[1]!=null)o.u=f[1];plat(o)}
  // a solid block that sits under a surface stops being an obstacle once you're standing on that surface
  if(plats.length)for(const cell of cells)for(const c of cell){if(!(c.m&1)||c.top!=null||c.minY!=null)continue; /* desk-top clutter (minY) must keep blocking up there */const x0=c.b?c.x0:c.x-c.r,x1=c.b?c.x1:c.x+c.r,z0=c.b?c.z0:c.z-c.r,z1=c.b?c.z1:c.z+c.r;
    for(const p of plats)if(x0>=p.x0-.1&&x1<=p.x1+.1&&z0>=p.z0-.1&&z1<=p.z1+.1){c.top=p.h;break}}
  // the plate edge is always a wall
  const w=m.w,d=m.d;[[-w/2-1,0,2,d+4],[w/2+1,0,2,d+4],[0,-d/2-1,w+4,2],[0,d/2+1,w+4,2]].forEach(([x,z,ww,dd])=>addCol({b:1,x0:x-ww/2,x1:x+ww/2,z0:z-dd/2,z1:z+dd/2,m:7,tall:1}));
  PHYS.floor(); // a world was (re)entered: its loose props start over
}

/* ---------- chairs (pushable) ---------- */
const CHR=.27;
let chairs=[],chairCells=new Map(),chairsMoved=false;const dirtyChairs=new Set();
function chairCell(c){const k=cellOf(c.x,c.z);if(k===c.cell)return;if(c.cell>=0){const s=chairCells.get(c.cell);if(s)s.delete(c)}c.cell=k;if(k>=0){let s=chairCells.get(k);if(!s)chairCells.set(k,s=new Set());s.add(c)}}
function chairsNear(x,z,r){const out=[];const c0=Math.floor((x-r-GX)/CS),c1=Math.floor((x+r-GX)/CS),r0=Math.floor((z-r-GZ)/CS),r1=Math.floor((z+r-GZ)/CS);
  for(let cz=r0;cz<=r1;cz++)for(let cx=c0;cx<=c1;cx++){if(cx<0||cz<0||cx>=NX||cz>=NZ)continue;const s=chairCells.get(cz*NX+cx);if(s)for(const c of s)out.push(c)}return out}
function initChairs(m){
  chairCells=new Map();dirtyChairs.clear();
  chairs=(m.chairs||[]).filter(c=>isFinite(c.x)&&isFinite(c.z)).map((c,i)=>({i,hx:c.x,hz:c.z,ha:c.a||0,x:c.x,z:c.z,a:c.a||0,vx:0,vz:0,va:0,awake:false,cell:-1,kind:c.kind||"task",desk:c.desk==null?-1:c.desk}));
  chairs.forEach(chairCell);
}

/* ---------- world build helpers ---------- */
let deskG=null,legG=null,monG=null,scrG=null,standG=null,chairG=[],aoBlobs=null,cupsMeshes=[],deskInst=[],instDesk=[],bldgMeshes=[],planMesh=null;
const _M=new THREE.Matrix4(),_M2=new THREE.Matrix4(),_M3=new THREE.Matrix4(),_Q=new THREE.Quaternion(),_E=new THREE.Euler(),_P=new V3(),_S=new V3(),ONE=new V3(1,1,1),ZERO_M=new THREE.Matrix4().makeScale(0,0,0),YAX=new V3(0,1,0);
const CH_LOCAL=[[0,.03,0],[0,.25,0],[0,.48,0],[0,.78,.24]].map(([x,y,z])=>new THREE.Matrix4().makeTranslation(x,y,z));
function chairMatrices(c){if(c.hs){HD.chairMatrix(c,_M,_M2);return}_M.makeRotationY(c.a);_M.setPosition(c.x,0,c.z);for(let k=0;k<4;k++){if(k===3&&c.kind==="stool"){chairG[3].set(c.i,ZERO_M);continue}_M2.multiplyMatrices(_M,CH_LOCAL[k]);chairG[k].set(c.i,_M2)}}
function jitterQ(){if(!S.jitter)return _Q.identity();_E.set(0,(jr()-.5)*S.jitter*2,(jr()-.5)*S.jitter*.6);return _Q.setFromEuler(_E)}
function clearRoot(){
  if(!root)return;
  root.traverse(o=>{
    if(o.shadow&&o.shadow.map){o.shadow.map.dispose();o.shadow.map=null}
    if(o.geometry&&!o.geometry.userData.keep)o.geometry.dispose();
    if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{if(m===INVIS||m.userData.keep)return;if(m.map&&!SHARED.has(m.map))m.map.dispose();m.dispose()})}
  });
  scene.remove(root);root=null;if(HULL){HULL.dispose();HULL=null}lineMats=[];glowMats=[];signs=[];sun=null;cupsMeshes=[];deskG=legG=monG=scrG=standG=null;chairG=[];aoBlobs=null;deskInst=[];instDesk=[];bldgMeshes=[];planMesh=null;figReset();PHYS.clear();
}
function buildRamp(r){
  const grp=new THREE.Group();grp.position.set(r.x,0,r.z);grp.rotation.y=(r.ax==="z"?-Math.PI/2:0)+(r.dir<0?Math.PI:0);root.add(grp);
  let top;
  if(r.k==="hump"){
    top=new THREE.PlaneGeometry(r.len,r.w,28,8);top.rotateX(-Math.PI/2);
    const pa=top.attributes.position;for(let k=0;k<pa.count;k++)pa.setY(k,humpH(r,pa.getX(k),pa.getZ(k))+.006);
  }else{
    top=new THREE.PlaneGeometry(r.len+KB,r.w,40,1);top.rotateX(-Math.PI/2);top.translate(KB/2,0,0);
    const pa=top.attributes.position;for(let k=0;k<pa.count;k++)pa.setY(k,kickH(r,pa.getX(k),0)+.006);
    const sh=new THREE.Shape();sh.moveTo(-r.len/2,0);for(let k=1;k<=20;k++){const u=-r.len/2+r.len*k/20;sh.lineTo(u,kickH(r,u,0)+.006)}sh.lineTo(r.len/2+KB,0);sh.closePath();
    [-1,1].forEach(sd=>{const sg=new THREE.ShapeGeometry(sh);sg.translate(0,0,sd*r.w/2);const m=part(sg,"rampSide",0,0,0,grp,{still:1});m.material.side=THREE.DoubleSide})
  }
  top.computeVertexNormals();
  const tm=part(top,"ramp",0,0,0,grp,{still:1});tm.material.side=THREE.DoubleSide;
  if(S.ramp==="hazard"&&!S.faceIsBg){tm.material.map=hazardTex(r.k==="hump"?2:2.5);tm.material.color.set("#ffffff");tm.material.needsUpdate=true}
}
function lights(){
  if(S.light==="none")return;
  // [hemisphere intensity, ground color, sun intensity, sun color, sky color]. Classic styles were tuned with three's
  // old light units: r165 lights are physically based, so those intensities are scaled by pi to look the same.
  const RIG={day:[.5,0xd6d2c8,.6,0xffffff],soft:[.55,0xe2d4c6,.5,0xfff1e0],cel:[.3,0xffffff,.7,0xffffff],hd:[.42,0x9a8e80,2.8,0xfff0dc,0xeef3fa]}[S.light],k=S.hd?1:Math.PI;
  root.add(new THREE.HemisphereLight(RIG[4]||0xffffff,RIG[1],RIG[0]*k));
  sun=new THREE.DirectionalLight(RIG[3],RIG[2]*k);root.add(sun);root.add(sun.target);
  // HD: a cool fill from the opposite side keeps shadowed faces readable (the image-based light does the rest)
  if(S.hd){const fill=new THREE.DirectionalLight(0xd6e4ff,.3);fill.position.set(-4,6,5);root.add(fill)}
  if(S.light==="cel")sunDir.set(2.5,6.5,1).normalize();else if(S.hd)sunDir.set(.62,.72,-.34).normalize();else sunDir.set(3.5,6.5,3).normalize();
  if(S.shadows){sun.castShadow=true;sun.shadow.mapSize.set(SM,SM);sun.shadow.bias=S.hd?-.0003:-.0006;sun.shadow.normalBias=S.hd?.018:.02;shadowHS=0}
}
function groundPlane(w,d,col){
  const fm=part(new THREE.PlaneGeometry(w,d),"floor",0,0,0,null,{still:1,color:col});fm.rotation.x=-Math.PI/2;
  if(S.floorTex&&!S.faceIsBg&&!col){fm.material.map=FLOORTEX[S.floorTex](w,d);fm.material.color.set("#ffffff");fm.material.needsUpdate=true}
  if(S.grid){const pts=[],st=w>120?2:1;for(let x=-w/2;x<=w/2+1e-6;x+=st)pts.push(x,.012,-d/2,x,.012,d/2);for(let z=-d/2;z<=d/2+1e-6;z+=st)pts.push(-w/2,.012,z,w/2,.012,z);
    const gg=new THREE.BufferGeometry();gg.setAttribute("position",new THREE.Float32BufferAttribute(pts,3));const gm=new THREE.LineBasicMaterial({color:S.grid.c,transparent:true,opacity:S.grid.o});root.add(new THREE.LineSegments(gg,gm))}
  return fm;
}
function flatRect(x,z,w,d,y,role,col,edge){const m=part(new THREE.PlaneGeometry(Math.max(.01,w),Math.max(.01,d)),role,x,y,z,null,{color:col,edge,still:1,noCast:1});m.rotation.x=-Math.PI/2;return m}
function padDecal(x,z,r,label){
  const g=new THREE.RingGeometry(r*.78,r,4,1,Math.PI/4);g.rotateX(-Math.PI/2);
  const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:S.acc,toneMapped:false,transparent:true,opacity:S.faceIsBg||S.depthOnly?.9:.75,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2}));
  m.position.set(x,.016,z);root.add(m);
  if(label)addSign([label],x,2.45,z,.3,S.acc);
}
// generic instanced furniture: each item type is a list of unit-shape parts placed in the item's local frame
const UNIT={b:()=>ibx(1,1,1),c:()=>cyl(.5,.5,1,16),s:()=>S.lowpoly||S.mat==="basic"?new THREE.IcosahedronGeometry(.5,0):new THREE.SphereGeometry(.5,S.mat==="pbr"?20:14,S.mat==="pbr"?14:10),cx:()=>{const g=cyl(.5,.5,1,14);g.rotateZ(Math.PI/2);return g}};
const IDEF={panel:[4.74,.03,.42],table:[1.2,1.2,.74],rtable:[1.8,.9,.74],bench:[3,.9,.9],shelf:[3,.3,.5],rack:[.6,1,2],scope:[.4,.35,.22],chamber:[1,1,1.8],probe:[1.2,1,1.4],cabinet:[1.2,.5,1],locker:[1,.5,1.8],plant:[.5,.5,1.2],counter:[3,.7,1],coffee:[.45,.4,.55],fridge:[.8,.75,1.8],screen:[1.6,.05,.9],sofa:[2,.9,.8],reception:[3,1,1.1],printer:[.9,.7,1.1],whiteboard:[2,.04,1.2],elevdoor:[1.6,.1,2.2],booth:[1.4,1.4,2.3],
  tree:[4,4,4.5],lamp:[.4,.4,5],car:[1.8,4.4,1.45],bench_o:[1.8,.5,.8],bollard:[.2,.2,.9],planter:[2,1,.6],bikerack:[3,.6,.8],flag:[1.5,.1,8],sign:[4,.6,1.2]};
const IPARTS={
  panel:[["panel","b",i=>[0,i.h/2,0,i.w,i.h,i.d],{tint:1}]],
  table:[["table","c",i=>[0,i.h-.02,0,i.w,.04,i.w]],["leg","c",i=>[0,(i.h-.04)/2,0,.12,i.h-.04,.12]],["leg","c",i=>[0,.015,0,Math.min(.6,i.w*.5),.03,Math.min(.6,i.w*.5)]]],
  rtable:[["table","b",i=>[0,i.h-.02,0,i.w,.04,i.d]],["leg","b",i=>[-(i.w/2-.35),(i.h-.04)/2,0,.08,i.h-.04,Math.max(.1,i.d*.6)]],["leg","b",i=>[(i.w/2-.35),(i.h-.04)/2,0,.08,i.h-.04,Math.max(.1,i.d*.6)]]],
  bench:[["cabinet","b",i=>[0,(i.h-.04)/2,0,i.w-.04,i.h-.04,i.d-.04]],["bench","b",i=>[0,i.h-.02,0,i.w,.04,i.d]]],
  shelf:[["shelf","b",i=>[-(i.w/2-.03),i.h/2,0,.04,i.h,.04]],["shelf","b",i=>[(i.w/2-.03),i.h/2,0,.04,i.h,.04]],["bench","b",i=>[0,i.h,0,i.w,.03,i.d]]],
  rack:[["rack","b",i=>[0,i.h/2,0,i.w,i.h,i.d]],["led","b",i=>[0,i.h*.55,-(i.d/2+.006),i.w*.7,i.h*.62,.01],{col:1}]],
  scope:[["scope","b",i=>[0,i.h/2,0,i.w,i.h,i.d]],["screen","b",i=>[-i.w*.15,i.h*.55,-(i.d/2+.004),i.w*.5,i.h*.6,.008]]],
  chamber:[["chamber","b",i=>[0,i.h/2,0,i.w,i.h,i.d]],["win","b",i=>[0,i.h*.55,-(i.d/2+.01),i.w*.45,i.h*.3,.02]],["screen","b",i=>[i.w*.32,i.h*.8,-(i.d/2+.01),i.w*.18,i.h*.08,.02]]],
  probe:[["probe","b",i=>[0,.4,0,i.w,.8,i.d]],["leg","c",i=>[0,1.05,i.d*.1,.12,.5,.12]],["mon","b",i=>[0,1.32,i.d*.1,.25,.14,.25]]],
  cabinet:[["cabinet","b",i=>[0,i.h/2,0,i.w,i.h,i.d]]],
  locker:[["locker","b",i=>[0,i.h/2,0,i.w,i.h,i.d]]],
  plant:[["pot","c",i=>[0,.19,0,.4,.38,.4]],["plant","s",i=>[0,.68,0,.72,.72,.72]],["plant","s",i=>[.18,.98,.1,.48,.48,.48]],["plant","s",i=>[-.18,.92,-.13,.4,.4,.4]]],
  counter:[["counter","b",i=>[0,.475,0,i.w,.95,i.d]],["top","b",i=>[0,.97,0,i.w+.02,.05,i.d+.04]]],
  coffee:[["machine","b",i=>[0,.275,0,.45,.55,.4]],["screen","b",i=>[0,.4,-.205,.18,.08,.01]]],
  fridge:[["fridge","b",i=>[0,i.h/2,0,i.w,i.h,i.d]],["metal","b",i=>[i.w*.35,i.h*.6,-(i.d/2+.02),.03,i.h*.35,.03]]],
  screen:[["mon","b",i=>[0,i.h/2,0,i.w,i.h,.05]],["screen","b",i=>[0,i.h/2,-.03,i.w*.94,i.h*.9,.01]]],
  sofa:[["sofa","b",i=>[0,.22,0,i.w,.44,i.d]],["sofa","b",i=>[0,.55,i.d/2-.1,i.w,.5,.2]]],
  reception:[["reception","b",i=>[0,.55,0,i.w,1.1,i.d]],["top","b",i=>[0,1.12,0,i.w+.04,.04,i.d+.04]]],
  printer:[["printer","b",i=>[0,i.h/2,0,i.w,i.h,i.d]],["mon","b",i=>[0,i.h+.02,0,i.w*.8,.04,i.d*.6]]],
  whiteboard:[["board","b",i=>[0,i.h/2,0,i.w,i.h,.04]]],
  elevdoor:[["metal","b",i=>[-(i.w/4),i.h/2,0,i.w/2-.02,i.h,.06]],["metal","b",i=>[(i.w/4),i.h/2,0,i.w/2-.02,i.h,.06]],["frame","b",i=>[0,i.h+.08,0,i.w+.24,.16,.1]]],
  booth:[["booth","b",i=>[0,i.h/2,0,i.w,i.h,i.d]],["roof","b",i=>[0,i.h,0,i.w+.04,.06,i.d+.04]]],
  // outdoor
  tree:[["trunk","c",i=>[0,i.h*.27,0,.35,i.h*.54,.35]],["plant","s",i=>[0,i.h*.7,0,i.w*.8,i.w*.8,i.w*.8]],["plant","s",i=>[i.w*.2,i.h*.58,i.w*.1,i.w*.55,i.w*.55,i.w*.55]],["plant","s",i=>[-i.w*.18,i.h*.62,-i.w*.12,i.w*.5,i.w*.5,i.w*.5]]],
  lamp:[["post","c",i=>[0,i.h/2,0,.14,i.h,.14]],["metal","b",i=>[0,i.h,-.4,.3,.12,1]],["light","b",i=>[0,i.h-.07,-.6,.22,.04,.5]]],
  car:[["carbody","b",i=>[0,.62,0,i.w,.72,i.d],{col:1}],["cabin","b",i=>[0,1.2,i.d*.04,i.w*.86,.5,i.d*.5]],["tire","cx",i=>[-i.w/2+.12,.34,-i.d*.32,.26,.68,.68]],["tire","cx",i=>[i.w/2-.12,.34,-i.d*.32,.26,.68,.68]],["tire","cx",i=>[-i.w/2+.12,.34,i.d*.32,.26,.68,.68]],["tire","cx",i=>[i.w/2-.12,.34,i.d*.32,.26,.68,.68]]],
  bench_o:[["desk","b",i=>[0,.45,0,i.w,.06,.45]],["leg","b",i=>[-(i.w/2-.15),.22,0,.06,.44,.4]],["leg","b",i=>[(i.w/2-.15),.22,0,.06,.44,.4]],["desk","b",i=>[0,.72,.2,i.w,.36,.05]]],
  bollard:[["post","c",i=>[0,.45,0,.2,.9,.2]],["light","c",i=>[0,.86,0,.21,.06,.21]]],
  planter:[["pot","b",i=>[0,.3,0,i.w,.6,i.d]],["plant","s",i=>[0,.78,0,i.w*.85,.7,i.d*.9]]],
  bikerack:[["metal","b",i=>[0,.42,0,i.w,.05,.05]],["metal","b",i=>[-(i.w/2-.1),.21,0,.05,.42,.05]],["metal","b",i=>[(i.w/2-.1),.21,0,.05,.42,.05]]],
  flag:[["post","c",i=>[0,i.h/2,0,.1,i.h,.1]],["flag","b",i=>[i.w/2+.05,i.h-.6,0,i.w,.9,.02],{col:1}]],
  sign:[["solid","b",i=>[0,i.h/2,0,i.w,i.h,i.d]]]
};
// outdoor "bench" items use their own part list (indoor "bench" is a lab bench)
function itemType(it){return WKIND==="campus"&&it.t==="bench"?"bench_o":it.t}
function buildItems(items,tintOf){
  const by=new Map();
  for(const it of items||[]){const t=itemType(it);if(!IPARTS[t]||!isFinite(it.x)||!isFinite(it.z))continue;let a=by.get(t);if(!a)by.set(t,a=[]);a.push(it)}
  for(const [t,list] of by){
    const def=IDEF[t]||[1,1,1];
    const norm=list.map(it=>({it,w:it.w>0?it.w:def[0],d:it.d>0?it.d:def[1],h:it.h>0?it.h:def[2],y:isFinite(it.y)?it.y:0,c:it.c}));
    IPARTS[t].forEach(([role,geo,fn,opt])=>{
      opt=opt||{};const colored=!!(opt.tint||opt.col);
      const g=IG(UNIT[geo](),role,norm.length,{colored,noCast:norm.length>400});
      norm.forEach((n,k)=>{
        const it=n.it,[lx,ly,lz,sx,sy,sz]=fn(n);
        _M.makeRotationY(it.a||0);_M.setPosition(it.x,n.y,it.z);
        _M2.compose(_P.set(lx,ly,lz),_Q.identity(),_S.set(Math.max(.001,sx),Math.max(.001,sy),Math.max(.001,sz)));
        _M3.multiplyMatrices(_M,_M2);g.set(k,_M3);
        if(opt.tint)g.paint(k,n.c&&HEX.test(n.c)?mix(pal(role),n.c,(S.td||0)*.6+.08):new THREE.Color(pal(role)));
        if(opt.col)g.paint(k,n.c&&HEX.test(n.c)?n.c:S.acc);
        if(opt.col&&S.teamEdges&&n.c&&HEX.test(n.c))g.edge(k,n.c);
      });
      g.commit();
    });
  }
}
// Studio: soft contact shadows under furniture (one dark radial blob per piece, all in one instanced mesh)
const AO_TYPES={rtable:1.25,table:1.3,bench:1.2,counter:1.15,sofa:1.2,reception:1.15,cabinet:1.25,rack:1.3,chamber:1.25,probe:1.25,locker:1.2,fridge:1.25,printer:1.3,plant:1.6,booth:1.15,car:1.12,tree:.5,bench_o:1.3,planter:1.2,bollard:2.4,lamp:1.6};
function buildAO(desks,items){
  if(!S.ao)return;
  const list=[];
  for(const d of desks||[]){if(!isFinite(d.x)||!isFinite(d.z)||d.arr==="hot"||d.arr==="lab")continue;const sw=Math.abs(Math.sin(d.a||0))>.5,w=d.w>0?d.w:1.56,dd=d.dd>0?d.dd:.78;list.push([d.x,d.z,(sw?dd:w)*1.3,(sw?w:dd)*1.9])}
  for(const it of items||[]){const t=itemType(it),k=AO_TYPES[t];if(!k||!isFinite(it.x)||!isFinite(it.z))continue;const def=IDEF[t]||[1,1,1],w=(it.w>0?it.w:def[0])*k,d=(it.d>0?it.d:def[1])*k,sw=Math.abs(Math.sin(it.a||0))>.5;list.push([it.x,it.z,sw?d:w,sw?w:d])}
  if(!list.length)return;
  const g=new THREE.PlaneGeometry(1,1);g.rotateX(-Math.PI/2);
  const m=new THREE.InstancedMesh(g,new THREE.MeshBasicMaterial({map:RADIAL,color:0x000000,transparent:true,opacity:.46,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),list.length);
  list.forEach(([x,z,w,d],i)=>{_M.compose(_P.set(x,.017,z),_Q.identity(),_S.set(Math.max(.2,w),1,Math.max(.2,d)));m.setMatrixAt(i,_M)});
  m.frustumCulled=false;m.renderOrder=1;root.add(m);aoBlobs=m;m.visible=!HD.quality.fx;
}
function buildWalls(walls){
  const kinds={ext:[],int:[],part:[],glass:[]};
  for(const w of walls||[]){if(![w.x1,w.z1,w.x2,w.z2].every(isFinite))continue;const L=Math.hypot(w.x2-w.x1,w.z2-w.z1);if(L<.02)continue;(kinds[w.kind]||kinds.int).push(Object.assign({L},w))}
  const ROLE={ext:"wall",int:"wall",part:"panel",glass:"glassRoom"};
  for(const k in kinds){
    const list=kinds[k];if(!list.length)continue;
    const g=IG(new THREE.BoxGeometry(1,1,1),ROLE[k],list.length,{noEdge:k==="glass"&&!S.edges,noHull:1});
    list.forEach((w,i)=>{
      const t=w.t>0?w.t:(k==="ext"?.3:k==="part"?.06:k==="glass"?.05:.15),h=w.h>0?w.h:(k==="part"?1.3:k==="glass"?2.7:H);
      const ang=Math.atan2(-(w.z2-w.z1),w.x2-w.x1);_Q.setFromAxisAngle(YAX,ang);
      _M.compose(_P.set((w.x1+w.x2)/2,h/2,(w.z1+w.z2)/2),_Q,_S.set(w.L+(k==="glass"?0:t*.98),h,t));g.set(i,_M);
    });
    g.commit();
    if(k==="ext"){ // windows on the inside face of the outer walls
      const win=IG(new THREE.BoxGeometry(1,1,1),"win",list.length,{noCast:1});
      list.forEach((w,i)=>{
        const mx=(w.x1+w.x2)/2,mz=(w.z1+w.z2)/2,dx=(w.x2-w.x1)/w.L,dz=(w.z2-w.z1)/w.L;let nx=-dz,nz=dx;if(nx*-mx+nz*-mz<0){nx=-nx;nz=-nz}
        const t=w.t>0?w.t:.3,ang=Math.atan2(-(w.z2-w.z1),w.x2-w.x1);_Q.setFromAxisAngle(YAX,ang);
        if(w.L<1.4){win.set(i,ZERO_M);return}
        _M.compose(_P.set(mx+nx*(t/2+.03),1.75,mz+nz*(t/2+.03)),_Q,_S.set(w.L-1,1.4,.05));win.set(i,_M);
      });
      win.commit();
    }
  }
}
function areaColor(a){
  const k=a.kind,tc=a.team?teamColorOf(a.team):(a.color&&HEX.test(a.color)?a.color:null);
  if(k==="esd")return mix(pal("carpet"),"#3F7FB0",S.faceIsBg?0:.55).getStyle();
  if(k==="tile")return mix(pal("floor"),"#FFFFFF",.35).getStyle();
  if(k==="lobby"||k==="wood")return mix(pal("floor"),"#B98B5E",S.tcar?.35:.12).getStyle();
  return mix(pal("carpet"),tc||pal("carpet"),tc?(S.tcar||0):0).getStyle();
}

/* ---------- floor world ---------- */
function buildFloorWorld(m){
  // Studio (HD): ground, finishes, walls, cores, furniture and desks come from HD; the rest below is shared
  const hdRest=S.hd?HD.floor(m):null;
  if(!hdRest)groundPlane(m.w,m.d);
  // floor finishes
  if(!hdRest)(m.areas||[]).forEach((a,i)=>{if(!(a.w>0&&a.d>0))return;flatRect(a.x,a.z,a.w,a.d,.006+Math.min(i,20)*.0004,"carpet",areaColor(a),S.teamEdges&&a.team?teamColorOf(a.team):null);
    if(a.kind==="esd"&&!S.faceIsBg&&!S.depthOnly){const y=.0145,tw=.07;[[a.x,a.z-a.d/2+tw/2,a.w,tw],[a.x,a.z+a.d/2-tw/2,a.w,tw],[a.x-a.w/2+tw/2,a.z,tw,a.d],[a.x+a.w/2-tw/2,a.z,tw,a.d]].forEach(([x,z,w,d])=>flatRect(x,z,w,d,y,"ramp","#F2C14E"))}});
  // plan image underlay (owner-loaded floor plan)
  const spec=DATA.floors[m.key];
  if(planOn&&spec&&spec.plan&&/^[0-9a-f]{32}$/.test(spec.plan.asset||"")&&!S.depthOnly){
    const p=spec.plan,g=new THREE.PlaneGeometry(Math.max(.1,p.w),Math.max(.1,p.d));g.rotateX(-Math.PI/2);
    const mm=new THREE.MeshBasicMaterial({transparent:true,opacity:clamp(+p.opacity||.55,.1,1),depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    planMesh=new THREE.Mesh(g,mm);planMesh.position.set(p.x+p.w/2,.02,p.z+p.d/2);root.add(planMesh);
    // plan textures are cached by asset id and survive world/style rebuilds (SHARED keeps clearRoot from disposing them)
    const key=m.key,cached=planTex.get(p.asset);
    if(cached){const cs=texCS({}).colorSpace;if(cached.colorSpace!==cs){cached.colorSpace=cs;cached.needsUpdate=true}mm.map=cached;mm.needsUpdate=true}
    else new THREE.TextureLoader().load(blobUrl(p.asset),t=>{texCS(t);planTex.set(p.asset,t);SHARED.add(t);if(planMesh&&planMesh.material===mm&&WKEY===key){mm.map=t;mm.needsUpdate=true}},undefined,()=>{});
  }
  if(hdRest){buildItems(hdRest);buildChairs(m);buildFigures();buildAO(m.desks,m.items);floorExtras(m);return}
  buildWalls(m.walls);
  // solid rooms read as blocks from above
  (m.rooms||[]).forEach(r=>{if(r.solid&&r.w>0&&r.d>0&&r.type!=="open")part(bx(r.w,H,r.d),r.type==="elevator"?"metal":"solid",r.x,H/2,r.z,null,{still:1,color:r.type==="elevator"?null:mix(pal("wall"),pal("panel"),.22).getStyle()})});
  buildItems(m.items);
  // desks (benches/cubes/offices draw a desk top; lab and hot desks are part of a bench or shared table)
  const desks=m.desks||[],drawn=[];desks.forEach((d,i)=>{if(d.arr!=="hot"&&d.arr!=="lab"&&isFinite(d.x)&&isFinite(d.z))drawn.push(i)});
  deskInst=new Array(desks.length).fill(-1);instDesk=drawn.slice();drawn.forEach((di,k)=>deskInst[di]=k);
  deskG=IG(ibx(1,.05,1),"desk",drawn.length,{colored:true});legG=IG(new THREE.BoxGeometry(.04,.73,.04),"leg",drawn.length*4);
  const withMon=desks.map((d,i)=>i).filter(i=>desks[i].mon&&desks[i].person>=0&&isFinite(desks[i].x));
  monG=IG(ibx(.58,.34,.03),"mon",withMon.length);scrG=IG(new THREE.BoxGeometry(.54,.3,.006),"screen",withMon.length);standG=IG(new THREE.BoxGeometry(.05,.22,.05),"leg",withMon.length);
  drawn.forEach((di,k)=>{
    const d=desks[di],w=d.w>0?d.w:1.56,dd=d.dd>0?d.dd:.78;
    _Q.setFromAxisAngle(YAX,d.a||0);_M.compose(_P.set(d.x,.75,d.z),_Q,_S.set(w,1,dd));
    if(S.jitter){_M2.makeRotationFromQuaternion(jitterQ());_M.multiply(_M2)}
    deskG.set(k,_M);deskG.paint(k,deskColor(di));
    let q=0;for(const lx of[-1,1])for(const lz of[-1,1]){_M.makeRotationY(d.a||0);_M.setPosition(d.x,.365,d.z);_M2.makeTranslation(lx*(w/2-.04),0,lz*(dd/2-.04));_M3.multiplyMatrices(_M,_M2);legG.set(k*4+q++,_M3)}
  });
  withMon.forEach((di,k)=>{
    const d=desks[di],dd=d.dd>0?d.dd:.78;_M.makeRotationY(d.a||0);_M.setPosition(d.x,0,d.z);
    _M2.makeTranslation(0,1.0,-(dd/2-.17));_M3.multiplyMatrices(_M,_M2);monG.set(k,_M3);
    _M2.makeTranslation(0,1.0,-(dd/2-.188));_M3.multiplyMatrices(_M,_M2);scrG.set(k,_M3);
    _M2.makeTranslation(0,.87,-(dd/2-.14));_M3.multiplyMatrices(_M,_M2);standG.set(k,_M3);
  });
  [deskG,legG,monG,scrG,standG].forEach(g=>g.commit());
  buildChairs(m);buildFigures();
  buildAO(m.desks,m.items);
  floorExtras(m);
}
// ramps, signs and the elevator/exit pads (every style)
function floorExtras(m){
  (m.ramps||[]).forEach(buildRamp);
  (m.signs||[]).forEach(s=>{if(s&&s.lines&&isFinite(s.x))addSign(s.lines,s.x,isFinite(s.y)?s.y:3,s.z,s.h>0?s.h:.6,s.stripe&&HEX.test(s.stripe)?s.stripe:null)});
  (m.elevators||[]).forEach(e=>e.pad&&padDecal(e.pad.x,e.pad.z,1,null));
  if(m.exit)padDecal(m.exit.x,m.exit.z,1.1,"Exit");
}
// what the pointer can hit to pick a chair, and which chair a hit means
function chairPickMeshes(){return chairG.length&&chairG[0].mesh&&chairG[0].mesh.userData.chairList?chairG.filter(g=>g.tint).map(g=>g.mesh):[chairG[2]&&chairG[2].mesh,chairG[3]&&chairG[3].mesh].filter(Boolean)}
function chairOfHit(h){const L=h.object.userData.chairList;return L?L[h.instanceId]:h.object===(chairG[2]&&chairG[2].mesh)||h.object===(chairG[3]&&chairG[3].mesh)?chairs[h.instanceId]:null}
function deskColor(di){const d=WM.desks[di];if(target&&target.kind==="desk"&&target.w===WKEY&&target.di===di)return new THREE.Color(S.acc);const tc=d.person>=0?teamColorOf(d.team):"#BDBBB3";return mix(pal("desk"),tc,S.td||0)}
function chairColor(c){if(c.desk>=0&&WM.desks[c.desk]){const d=WM.desks[c.desk];if(d.person<0)return mix(pal("chair"),"#9A978F",Math.min(1,(S.tc||0)*.8+.2));return mix(pal("chair"),teamColorOf(d.team),S.tc||0)}return mix(pal("chair"),"#8A8F96",(S.tc||0)*.5)}
function buildChairs(){
  const n=chairs.length;
  if(S.hd){chairG=HD.buildChairs(chairs);chairs.forEach(c=>{if(!c.hs)return;HD.chairPaint(c,chairColor(c));chairMatrices(c)});chairG.forEach(g=>g.commit());return}
  chairs.forEach(c=>{c.hs=null});
  chairG=[IG(cyl(.27,.27,.03,10),"leg",n),IG(cyl(.025,.025,.42,8),"leg",n),IG(ibx(.48,.08,.48),"chair",n,{colored:true,teamEdge:S.teamEdges}),IG(ibx(.48,.5,.06),"chair",n,{colored:true,teamEdge:S.teamEdges})];
  chairs.forEach(c=>{const col=chairColor(c);chairG[2].paint(c.i,col);chairG[3].paint(c.i,col);if(S.teamEdges){const d=c.desk>=0&&WM.desks[c.desk];const ec=d&&d.person>=0?teamColorOf(d.team):"#7d7a9c";chairG[2].edge(c.i,ec);chairG[3].edge(c.i,ec)}chairMatrices(c)});
  chairG.forEach(g=>g.commit());
}

/* ---------- campus world (outside) ---------- */
function buildCampusWorld(m){
  const grass=S.faceIsBg?null:mix(pal("plant"),pal("floor"),S.mat==="basic"?.2:.55).getStyle();
  groundPlane(m.w,m.d,grass);
  const AC_={road:()=>mix(pal("tire"),pal("floor"),.45),parking:()=>mix(pal("tire"),pal("floor"),.6),plaza:()=>mix(pal("floor"),pal("desk"),.55),walk:()=>mix(pal("desk"),pal("floor"),.3),grass:()=>mix(pal("plant"),pal("floor"),.4)};
  (m.areas||[]).forEach((a,i)=>{if(!(a.w>0&&a.d>0))return;const f=AC_[a.kind]||AC_.plaza;flatRect(a.x,a.z,a.w,a.d,.004+Math.min(i,30)*.0004,"carpet",S.faceIsBg?null:f().getStyle())});
  const ls=(m.lines||[]).filter(l=>[l.x1,l.z1,l.x2,l.z2].every(isFinite));
  const lg=IG(new THREE.BoxGeometry(1,1,1),"stripe",ls.length,{colored:true,noCast:1,noEdge:!S.glow});
  ls.forEach((l,i)=>{const L=Math.hypot(l.x2-l.x1,l.z2-l.z1);_Q.setFromAxisAngle(YAX,Math.atan2(-(l.z2-l.z1),l.x2-l.x1));_M.compose(_P.set((l.x1+l.x2)/2,.02,(l.z1+l.z2)/2),_Q,_S.set(Math.max(.05,L),.01,.12));lg.set(i,_M);lg.paint(i,HEX.test(l.c)?l.c:"#F4F1EA")});lg.commit();
  // buildings: storeys with window bands, slabs, roof, entrance canopy, a name sign
  for(const b of m.buildings||[]){
    const h=b.h>0?b.h:b.floors*FLOOR_H;
    const body=part(bx(b.w,h,b.d),"bldg",b.x,h/2,b.z,null,{still:1});body.userData.bldg=b.id;bldgMeshes.push(body);
    for(let k=1;k<=b.floors;k++){
      part(new THREE.BoxGeometry(b.w+.1,1.7,b.d+.1),"bwin",b.x,(k-1)*FLOOR_H+2.1,b.z,null,{still:1,noCast:1});
      part(new THREE.BoxGeometry(b.w+.18,.16,b.d+.18),"slab",b.x,k*FLOOR_H,b.z,null,{still:1,noCast:1});
    }
    part(bx(b.w*.18,1.4,b.d*.22),"roof",b.x-b.w*.2,h+.7,b.z-b.d*.15,null,{still:1});part(bx(b.w*.1,1.1,b.d*.14),"roof",b.x+b.w*.22,h+.55,b.z+b.d*.1,null,{still:1});
    if(b.door){const dx=b.door.x,dz=b.door.z,fa=b.door.a||0,fx_=-Math.sin(fa),fz_=-Math.cos(fa);
      const cx=dx-fx_*1.2,cz=dz-fz_*1.2,along=Math.abs(fx_)>Math.abs(fz_);
      part(new THREE.BoxGeometry(along?2.6:5,.18,along?5:2.6),"roof",cx+fx_*.6,3.3,cz+fz_*.6,null,{still:1});
      padDecal(dx,dz,1.2,null);
      addSign([b.name,"Drive in to enter"],cx+fx_*.4,4.6,cz+fz_*.4,1.1,S.acc);
    }
  }
  buildItems(m.items);buildAO(null,m.items);
  (m.items||[]).forEach(it=>{if(it.t==="sign"&&it.text&&isFinite(it.x))addSign([String(it.text).slice(0,40)],it.x,(it.h>0?it.h:1.2)+.7,it.z,1.0,S.acc)});
  (m.ramps||[]).forEach(buildRamp);
  (m.signs||[]).forEach(s=>{if(s&&s.lines&&isFinite(s.x))addSign(s.lines,s.x,isFinite(s.y)?s.y:3,s.z,s.h>0?s.h:1,s.stripe&&HEX.test(s.stripe)?s.stripe:null)});
}
let planOn=store.get("rc-plan")!=="0";
// plan images: stored assets are served at /_blob/<id>; without the page's storage (local preview, GitHub Pages) they live in memory
const LOCAL_BLOBS=new Map(),planTex=new Map();
function blobUrl(id){return LOCAL_BLOBS.get(id)||"/_blob/"+id}
function buildWorld(){
  HDCS=THREE.ColorManagement.enabled=!!S.hd;renderer.outputColorSpace=S.hd?THREE.SRGBColorSpace:THREE.LinearSRGBColorSpace;
  jseed=11;root=new THREE.Group();scene.add(root);HD.enter();
  HULL=S.outline?new THREE.MeshBasicMaterial({color:S.outline,side:THREE.BackSide}):null;
  scene.background=S.depthOnly?null:new THREE.Color(S.bg);
  const big=WKIND==="campus";
  scene.fog=S.fog?new THREE.Fog(S.bg,S.fog[0]*(big?2.2:1),S.fog[1]*(big?2.6:1)):null;
  renderer.shadowMap.enabled=!!S.shadows;
  lights();
  if(!WM)return;
  if(WKIND==="campus")buildCampusWorld(WM);else buildFloorWorld(WM);
  if(S.hd)BAKE.world(WKEY,WM,WKIND); // baked light when this world has a matching bake (game-2e-bake.js); before the props, which are not in the bake
  PHYS.build(); // loose props (and their physics world once the engine has loaded)
}
