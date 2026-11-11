/* ===================== game part 2d: pre-recorded physics moments ===================== */
// Two moments simulated in Blender (src/blender/fx_sim.py) and stored as transform tracks in FX_DATA (fx-data.js):
//   desk scatter: a hard hit (3 m/s or more) on a desk throws the papers, notebook, mug, pens and sticky notes off its top,
//                 away from whoever hit it;
//   splash:       crashing into the kitchen counter, the coffee machine or the fridge throws a burst of droplets back.
// crash(x, z, speed, car, isMe): a hard hit at (x, z), called from carStep; frame(dt): advance playing effects, called
// every frame from HD.render; clear(): a new world. Everything is drawn with instanced groups (IG) in root and the
// current style's own materials, so all five styles show it their way. Lighting is baked, so nothing stays lying around:
// the pieces shrink away a few seconds after they land.
const FX=(()=>{
const D=FX_DATA,NONE={crash(){},frame(){},clear(){}};
if(!D||!D.scatter||!D.splash)return NONE;
const i16=s=>{const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return new Int16Array(u.buffer)};
const SC=D.scatter,SP=D.splash,NP=SC.pieces.length,ND=SP.count;
let scT=null,spT=null; // tracks, decoded at the first crash
const MAX_SC=2,MAX_SP=2;            // effects of each kind that can play at once
const SC_HIT=3,SC_HOLD=3.6,SC_FADE=.6,SC_COOL=9; // desk: hit speed needed (m/s), seconds the pieces lie there, shrink time, per-desk cooldown
const SP_HOLD=2.4,SP_FADE=.6,SP_COOL=3.5;
const PAINT={paper:"#E4E1D9",book:"#34506E",mug:"#E4572E",pen1:"#2B5FA8",pen2:"#C0392B",note:"#F2D14E",note2:"#F29BB8"};
const LIQUID={counter:"#BFDDF0",coffee:"#5A3A22",fridge:"#F6F5F0"};
// which instance each scatter piece uses inside its group (boxes and cylinders are separate groups)
const pIdx=[],boxes=SC.pieces.filter(p=>p.s==="b").length,cyls=NP-boxes;{let b=0,c=0;for(const p of SC.pieces)pIdx.push(p.s==="b"?b++:c++)}
const dropR=[];for(let j=0;j<ND;j++)dropR.push(.011+.012*((j*7919%97)/97)); // droplet radius, 11 to 23 mm
const m4=new THREE.Matrix4(),zero=new THREE.Matrix4().makeScale(0,0,0),q=new THREE.Quaternion(),qy=new THREE.Quaternion(),p3=new V3(),s3=new V3(),YUP=new V3(0,1,0),col=new THREE.Color();
let own=null,boxG=null,cylG=null,dropG=null,painted=false,clock=0,live=0;
const slot=()=>({on:false,t:0,x:0,y:0,z:0,c:1,s:0,a:0,yk:1,still:false});
const scS=[],spS=[];for(let i=0;i<MAX_SC;i++)scS.push(slot());for(let i=0;i<MAX_SP;i++)spS.push(slot());
const cool=new Map();

function forget(){own=null;boxG=cylG=dropG=null;live=0;for(const s of scS)s.on=false;for(const s of spS)s.on=false}
function clear(){forget();cool.clear()}
// the instanced groups live in root: a new world or a new style throws root away, so they are rebuilt on demand
function ready(){
  if(!root)return false;
  if(own===root)return true;
  forget();own=root;
  if(!scT){scT=i16(SC.t);spT=i16(SP.t)}
  const basic=S.mat==="basic";painted=!basic&&!S.faceIsBg&&!S.depthOnly;
  boxG=IG(new THREE.BoxGeometry(1,1,1),"panel",MAX_SC*boxes,{colored:painted});
  cylG=IG(new THREE.CylinderGeometry(1,1,1,S.edges?8:16),basic?"panel":"cup",MAX_SC*cyls,{colored:painted});
  // line-art styles draw only edges: an octahedron has them, a smooth ball would vanish
  dropG=IG(S.edges?new THREE.OctahedronGeometry(1,0):new THREE.IcosahedronGeometry(1,1),basic?"screen":"cup",MAX_SP*ND,{colored:painted,noHull:1,noCast:1});
  for(const g of[boxG,cylG,dropG]){for(let i=0;i<g.count;i++)g.set(i,zero);g.commit()}
  if(painted)for(let k=0;k<MAX_SC;k++)SC.pieces.forEach((p,j)=>(p.s==="b"?boxG:cylG).paint(k*(p.s==="b"?boxes:cyls)+pIdx[j],col.set(p.c==="mug"?S.acc:PAINT[p.c]||"#FFFFFF")));
  return true;
}
function take(list){let best=null;for(const s of list){if(!s.on)return s;if(!best||s.t>best.t)best=s}return best} // a free slot, else the oldest
function start(s,x,y,z,a,yk){if(!s.on)live++;s.on=true;s.t=0;s.x=x;s.y=y;s.z=z;s.a=a;s.c=Math.cos(a);s.s=Math.sin(a);s.yk=yk;s.still=false}

/* ---------- what was hit ---------- */
// local coordinates of a world point in the frame of something at (x, z) turned a (the game's convention: local +x -> (cos a, -sin a))
let lx=0,lz=0;
function local(px,pz,x,z,a){const dx=px-x,dz=pz-z,c=Math.cos(a),s=Math.sin(a);lx=dx*c-dz*s;lz=dx*s+dz*c}
function crash(hx,hz,speed,car){
  if(REDUCED||WKIND!=="floor"||!WM||!isFinite(hx)||!isFinite(hz))return;
  // the kitchen: the coffee machine (it sits on the counter), then the counter or the fridge the hit point touches
  const items=WM.items||[];let hit=null,kind="";
  for(let i=0;i<items.length;i++){const it=items[i];if(it.t!=="coffee"&&it.t!=="counter"&&it.t!=="fridge")continue;
    const w=(it.w>0?it.w:1)/2,d=(it.d>0?it.d:.6)/2,pad=it.t==="coffee"?.4:.14;local(hx,hz,it.x,it.z,it.a||0);
    if(Math.abs(lx)<w+pad&&Math.abs(lz)<d+pad&&(!hit||it.t==="coffee")){hit=it;kind=it.t;if(kind==="coffee")break}}
  if(hit){
    const key="k"+Math.round(hit.x*10)+","+Math.round(hit.z*10);if(cool.get(key)>clock||!ready())return;cool.set(key,clock+SP_COOL);
    let dx=car.x-hx,dz=car.z-hz;const l=Math.hypot(dx,dz);if(l<1e-4)return;dx/=l;dz/=l; // droplets fly back towards the car
    const s=take(spS),k=spS.indexOf(s),y=SP.h+(kind==="coffee"?.12:0);start(s,hx+dx*.03,y,hz+dz*.03,Math.atan2(-dz,dx),y/SP.h);
    if(painted){col.set(LIQUID[kind]);for(let j=0;j<ND;j++)dropG.paint(k*ND+j,col);dropG.commit()}
    return;
  }
  // a desk, hit hard: the nearest one whose top (plus a little) the hit point lies in
  if(speed<SC_HIT)return;
  const desks=WM.desks||[];let best=null,bd=1e9;
  for(let i=0;i<desks.length;i++){const d=desks[i];if(!isFinite(d.x)||!isFinite(d.z)||Math.abs(d.x-hx)>2||Math.abs(d.z-hz)>2)continue;
    const w=(d.w>0?d.w:1.56)/2,dd=(d.dd>0?d.dd:.78)/2;local(hx,hz,d.x,d.z,d.a||0);
    const over=Math.max(Math.abs(lx)-w,Math.abs(lz)-dd);if(over<.14&&over<bd){bd=over;best=d}}
  if(!best)return;
  const key="d"+Math.round(best.x*10)+","+Math.round(best.z*10);if(cool.get(key)>clock||!ready())return;cool.set(key,clock+SC_COOL);
  const a=best.a||0,w=(best.w>0?best.w:1.56)/2,dd=(best.dd>0?best.dd:.78)/2;
  // the way the car was going, snapped to the desk's own axes: the things fly off that way
  local(hx,hz,car.x,car.z,a);const vx=lx,vz=lz;local(hx,hz,best.x,best.z,a);
  const alongX=Math.abs(vx)>=Math.abs(vz),sg=(alongX?vx:vz)>=0?1:-1,HALF=.39; // the recorded desk patch is .78 m square
  // the patch sits at the far end of the top (so the things clear the desk), level with where the car hit
  const ox=alongX?sg*Math.max(0,w-HALF):clamp(lx,-Math.max(0,w-HALF),Math.max(0,w-HALF)),oz=alongX?clamp(lz,-Math.max(0,dd-HALF),Math.max(0,dd-HALF)):sg*Math.max(0,dd-HALF);
  const c=Math.cos(a),sn=Math.sin(a),top=best.arr==="lab"?.9:best.arr==="hot"?.74:.775;
  start(take(scS),best.x+ox*c+oz*sn,top,best.z-ox*sn+oz*c,a+(alongX?(sg>0?0:Math.PI):(sg>0?-Math.PI/2:Math.PI/2)),top/SC.top);
}

/* ---------- playback ---------- */
function place(s,x,y,z){p3.set(s.x+x*s.c+z*s.s,s.y+(y<0?y*s.yk:y),s.z-x*s.s+z*s.c)} // effect space -> world (below the start height: scaled to reach the floor)
function scatterFrame(s,k){
  const dur=(SC.n-1)/SC.fps,end=SC_HOLD+SC_FADE;
  if(s.t>=end){s.on=false;live--;for(let j=0;j<NP;j++)(SC.pieces[j].s==="b"?boxG:cylG).set(k*(SC.pieces[j].s==="b"?boxes:cyls)+pIdx[j],zero);return}
  if(s.t>dur&&s.t<SC_HOLD){if(s.still)return;s.still=true} // lying still: nothing to update until they shrink away
  const f=Math.min(s.t*SC.fps,SC.n-1),i0=Math.min(Math.floor(f),SC.n-2),u=f-i0,sh=s.t>SC_HOLD?Math.max(0,1-(s.t-SC_HOLD)/SC_FADE):1,ps=SC.ps;
  qy.setFromAxisAngle(YUP,s.a);
  for(let j=0;j<NP;j++){
    const P=SC.pieces[j],o=(i0*NP+j)*7,n=o+NP*7,T=scT;
    place(s,(T[o]+(T[n]-T[o])*u)*ps,(T[o+1]+(T[n+1]-T[o+1])*u)*ps,(T[o+2]+(T[n+2]-T[o+2])*u)*ps);
    q.set(T[o+3]+(T[n+3]-T[o+3])*u,T[o+4]+(T[n+4]-T[o+4])*u,T[o+5]+(T[n+5]-T[o+5])*u,T[o+6]+(T[n+6]-T[o+6])*u).normalize().premultiply(qy);
    s3.set(P.d[0]*sh,P.d[1]*sh,P.d[2]*sh);m4.compose(p3,q,s3);
    (P.s==="b"?boxG:cylG).set(k*(P.s==="b"?boxes:cyls)+pIdx[j],m4);
  }
}
function splashFrame(s,k){
  const dur=(SP.n-1)/SP.fps,end=SP_HOLD+SP_FADE;
  if(s.t>=end){s.on=false;live--;for(let j=0;j<ND;j++)dropG.set(k*ND+j,zero);return}
  if(s.t>dur&&s.t<SP_HOLD){if(s.still)return;s.still=true}
  const f=Math.min(s.t*SP.fps,SP.n-1),i0=Math.min(Math.floor(f),SP.n-2),u=f-i0,sh=s.t>SP_HOLD?Math.max(0,1-(s.t-SP_HOLD)/SP_FADE):1,ps=SP.ps,T=spT;
  q.identity();
  for(let j=0;j<ND;j++){
    const o=(i0*ND+j)*3,n=o+ND*3,r=dropR[j]*sh*Math.min(1,.35+s.t*8); // they start small, as one gush
    place(s,(T[o]+(T[n]-T[o])*u)*ps,(T[o+1]+(T[n+1]-T[o+1])*u)*ps,(T[o+2]+(T[n+2]-T[o+2])*u)*ps);
    if(f>=SP.land[j]){p3.y=.004+j*.00004;s3.set(r*2.1,r*.16,r*2.1)}else s3.set(r,r*1.25,r); // landed: a small flat spot on the floor
    m4.compose(p3,q,s3);dropG.set(k*ND+j,m4);
  }
}
function frame(dt){
  clock+=dt;if(!live)return;
  if(own!==root||!boxG){forget();return}
  for(let k=0;k<MAX_SC;k++){const s=scS[k];if(s.on){s.t+=dt;scatterFrame(s,k)}}
  for(let k=0;k<MAX_SP;k++){const s=spS[k];if(s.on){s.t+=dt;splashFrame(s,k)}}
  boxG.commit();cylG.commit();dropG.commit();
}
// a hard landing on a desk top (off a ramp, a dog or cat leaping up) knocks its things off too. SFX.land is the game's own
// heavy-landing moment (carStep, the player's avatar only), so listen there rather than add another hook to carStep;
// landing on the kitchen counter splashes the same way
if(typeof SFX!=="undefined"&&SFX.land){const land0=SFX.land;SFX.land=s=>{land0(s);
  try{if(s>2.4&&typeof me!=="undefined"&&me.y>.5){const sp=Math.hypot(me.vx,me.vz)||1;crash(me.x,me.z,SC_HIT+s,{x:me.x-me.vx/sp*.5,z:me.z-me.vz/sp*.5})}}catch(_){}}}
return{crash,frame,clear};
})();
