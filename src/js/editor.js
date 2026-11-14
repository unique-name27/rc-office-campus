/* RC Campus v4 · EDITOR — the owner's floor editor (SPEC §8).
   A full-screen overlay for drawing one floor: walls, glass, rooms, team areas and desks; lining up a real
   floor-plan image; importing CAD walls (DXF) and facilities desk coordinates. Written for facilities/HR people,
   not CAD experts: everything snaps, everything undoes, and nothing throws on messy data.
   All pure logic lives in T (exposed as EDITOR._t for node tests). The DOM/canvas layer only runs inside open().
   Frame (SPEC): meters, origin = plate center, +x east, +z south; yaw a with forward = (-sin a, -cos a). */
const EDITOR=(()=>{

/* ================================================================ constants */
const PI=Math.PI,HALF=PI/2;
const GRID=.25,END_SNAP=.4,MIN_SIZE=1,UNDO_CAP=100,BUILD_MS=150,MIN_SEG=.2,MAX_IMPORT=6000;
const MIN_PLATE=4,MAX_PLATE=400,DESK_W=1.6,DESK_D=.8;
const SIDES=["n","s","e","w"],SIDE_NAMES={n:"North",s:"South",e:"East",w:"West"};
const HEX=/^#[0-9a-fA-F]{6}$/;
const ROOM_TYPES=[["conf","Conference room"],["office","Private office"],["phone","Phone booth"],["kitchen","Kitchen"],
  ["lab","Lab"],["restroom","Restroom"],["stairs","Stairs"],["elevator","Elevator"],["lobby","Lobby"],["server","Server room"],
  ["storage","Storage"],["mail","Mail & print"],["wellness","Wellness room"],["open","Open area (label only)"]];
const ROOM_NAME=Object.fromEntries(ROOM_TYPES);
// outline colors per room type: mid-lightness so they read on the light and the dark ground
const ROOM_COLOR={conf:"#3D8BD9",office:"#8E6FBF",phone:"#2E9C7A",kitchen:"#D9822B",lab:"#C2456B",restroom:"#6F86A6",
  stairs:"#9A8662",elevator:"#7C8796",lobby:"#C29A2E",server:"#5E7FA8",storage:"#8C929B",mail:"#B06A3B",wellness:"#3BA39C",open:"#9AA0A6"};
const ARR=["bench","cubes","offices","lab","hot"];
const ARR_NAMES={bench:"Open benches",cubes:"Cubicles",offices:"Private offices",lab:"Lab benches",hot:"Hot desks"};
// quick-add rooms (door null = solid block)
const PRESETS=[
  {k:"conf",label:"Conference",type:"conf",w:6,d:4,door:"s"},
  {k:"phone",label:"Phone booth",type:"phone",w:1.5,d:1.5,door:"s"},
  {k:"kitchen",label:"Kitchen",type:"kitchen",w:8,d:5,door:"s"},
  {k:"restroom",label:"Restroom",type:"restroom",w:6,d:4,door:null},
  {k:"elevator",label:"Elevator",type:"elevator",w:2.6,d:2.4,door:"s"},
  {k:"stairs",label:"Stairs",type:"stairs",w:3,d:5,door:null}];
const UNITS={in:.0254,ft:.3048,mm:.001,cm:.01,m:1};
const UNIT_NAMES={in:"Inches",ft:"Feet",mm:"Millimeters",cm:"Centimeters",m:"Meters"};
const PALETTE=["#3E7CB1","#8E6FBF","#D9822B","#2E9C7A","#C2456B","#5A9E3A","#B8860B","#2F8F9D","#A0522D","#6A5ACD","#CC5A71","#4F7A28"];
// same guesses as CAMPUS.defaultArr (SPEC §2); copied because EDITOR has no load-time dependencies
const ARR_RULES=[[/lab|validation|characteri|reliab|failure|test floor|bring.?up|silicon val/i,"lab"],
  [/financ|legal|exec|ceo|cfo|counsel/i,"offices"],
  [/hr|people|account|payroll|procure|supply|operation|quality|facilit/i,"cubes"],
  [/sales|market|customer|field|support|business dev/i,"hot"]];
const WALL_LAYER=/wall|a-wall|partition|ptn|glaz/i,GLASS_LAYER=/glaz|glass/i;
const KINDS={room:"rooms",zone:"zones",desk:"desks",wall:"walls",glass:"glass"};

/* ================================================================ small utils */
const isNum=v=>typeof v==="number"&&Number.isFinite(v);
function num(v,def){if(typeof v==="string"&&v.trim()!=="")v=Number(v.trim());return isNum(v)?v:def}
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const r3=v=>(Math.round(v*1000)/1000)||0;            // also turns -0 / NaN into 0
const r2=v=>(Math.round(v*100)/100)||0;
const hyp=Math.hypot;
const str=v=>v==null?"":String(v).trim();
const arr=v=>Array.isArray(v)?v:[];
function snap(v,step){step=step||GRID;return r3(Math.round(v/step)*step)}
function clone(o){try{return JSON.parse(JSON.stringify(o))}catch(_){return null}}
function fmtM(v){return String(r2(num(v,0)))}
const plural=(n,one,many)=>n+" "+(n===1?one:(many||one+"s"));
function msgOf(err){return str(err&&(err.message||err))}

// yaw snapped to the nearest 90°: one of 0 (north), π/2 (west), π (south), -π/2 (east)
function yawIndex(a){return((Math.round(num(a,0)/HALF)%4)+4)%4}
function snapYaw(a){return[0,HALF,PI,-HALF][yawIndex(a)]}
function facingName(a){return["north","west","south","east"][yawIndex(a)]}

/* ================================================================ spec normalization */
function normSeg(v){
  let a=v;
  if(a&&!Array.isArray(a)&&typeof a==="object")a=[a.x1,a.z1,a.x2,a.z2];
  if(!Array.isArray(a)||a.length<4)return null;
  const s=[num(a[0],NaN),num(a[1],NaN),num(a[2],NaN),num(a[3],NaN)];
  if(!s.every(isNum)||hyp(s[2]-s[0],s[3]-s[1])<.01)return null;
  return s;
}
function normRect(o){
  const x=num(o.x,NaN),z=num(o.z,NaN),w=num(o.w,NaN),d=num(o.d,NaN);
  return[x,z,w,d].every(isNum)?{x,z,w:Math.abs(w),d:Math.abs(d)}:null;
}
// "S", " south " -> "s" (LAYOUT and CAMPUS read sides this loosely, so a save must not drop them); else null
const SIDE_WORDS={north:"n",south:"s",east:"e",west:"w"};
function sideOf(v){const k=str(v).toLowerCase();return SIDES.includes(k)?k:Object.prototype.hasOwnProperty.call(SIDE_WORDS,k)?SIDE_WORDS[k]:null}
// "Lab " -> "lab" (LAYOUT lowercases too); unknown -> null
function arrOf(v){const k=str(v).toLowerCase();return ARR.includes(k)?k:null}
function normDoor(d){
  const side=d&&typeof d==="object"?sideOf(d.side):null;
  if(!side)return null;
  return{side,at:num(d.at,0),w:clamp(num(d.w,3),1,12)};
}
function normPlan(p){
  if(!p||typeof p!=="object"||typeof p.asset!=="string"||!p.asset)return null;
  const x=num(p.x,NaN),z=num(p.z,NaN),w=num(p.w,NaN),d=num(p.d,NaN);
  if(![x,z,w,d].every(isNum)||!(w>0)||!(d>0))return null;
  return{asset:p.asset,x,z,w,d,opacity:clamp(num(p.opacity,.55),.05,1)};
}
function nextId(prefix,list){
  let max=0;const used=new Set();
  for(const o of arr(list)){const id=str(o&&o.id);used.add(id);const m=/^([a-z]+)(\d+)$/i.exec(id);if(m&&m[1]===prefix)max=Math.max(max,+m[2])}
  let n=max+1;while(used.has(prefix+n))n++;
  return prefix+n;
}
// Clean up a LayoutSpec from the db or a spreadsheet. Unknown fields are kept; unreadable items are dropped and counted.
function normalize(src,o){
  o=o||{};let dropped=0;
  const s=(src&&typeof src==="object"&&!Array.isArray(src)&&clone(src))||{};
  s.v=1;
  if(typeof s.key!=="string"||!s.key)s.key=str(o.key);
  const km=/^(.*)-(\d+)$/.exec(s.key);
  if(typeof s.b!=="string"||!s.b)s.b=km?km[1]:"";
  const f=num(s.f,km?+km[2]:NaN);s.f=isNum(f)?Math.round(f):null;
  s.w=r3(clamp(num(s.w,72),MIN_PLATE,MAX_PLATE));
  s.d=r3(clamp(num(s.d,44),MIN_PLATE,MAX_PLATE));
  s.door=normDoor(s.door);
  s.plan=normPlan(s.plan);
  for(const k of["walls","glass"]){const out=[];for(const v of arr(s[k])){const g=normSeg(v);if(g)out.push(g);else dropped++}s[k]=out}
  const rooms=[];
  for(const r of arr(s.rooms)){
    const g=r&&typeof r==="object"?normRect(r):null;if(!g){dropped++;continue}
    const t=str(r.type).toLowerCase();
    const room=Object.assign({},r,g,{id:str(r.id),type:Object.prototype.hasOwnProperty.call(ROOM_NAME,t)?t:"open",name:str(r.name),door:sideOf(r.door)});
    const seats=num(r.seats,NaN);if(seats>0)room.seats=Math.round(seats);else delete room.seats;
    rooms.push(room);
  }
  rooms.forEach(r=>{if(!r.id)r.id=nextId(r.type==="elevator"?"e":"r",rooms)});
  s.rooms=rooms;
  const zones=[];
  for(const z of arr(s.zones)){
    const g=z&&typeof z==="object"?normRect(z):null;if(!g){dropped++;continue}
    // arr/dir read as loosely as LAYOUT does; no dir = LAYOUT's default (rows along the long side), so an untouched
    // zone lays out exactly the same after a save
    const dir=str(z.dir).toLowerCase();
    zones.push(Object.assign({},z,g,{id:str(z.id),team:str(z.team),arr:arrOf(z.arr),dir:dir==="v"||dir==="h"?dir:(g.w>=g.d?"h":"v")}));
  }
  zones.forEach(z=>{if(!z.id)z.id=nextId("z",zones)});
  s.zones=zones;
  const desks=[];
  for(const d of arr(s.desks)){
    if(!d||typeof d!=="object"){dropped++;continue}
    const x=num(d.x,NaN),z=num(d.z,NaN);if(!isNum(x)||!isNum(z)){dropped++;continue}
    const desk=Object.assign({},d,{id:str(d.id),x,z,a:snapYaw(d.a)});
    const da=arrOf(d.arr);if(da)desk.arr=da;else delete desk.arr;
    const tm=str(d.team);if(tm)desk.team=tm;else delete desk.team;
    desks.push(desk);
  }
  s.desks=desks;
  s.ramps=Array.isArray(s.ramps)?s.ramps.filter(r=>r&&typeof r==="object"&&isNum(num(r.x,NaN))&&isNum(num(r.z,NaN))):null;
  s.updatedAt=num(s.updatedAt,0);
  return{spec:s,dropped};
}
const normSpec=(src,o)=>normalize(src,o).spec;
// The spec as it is saved: normalized, coordinates rounded to the millimeter (yaws stay exact).
function finalize(spec,o){
  const s=normSpec(spec,o);
  s.walls=s.walls.map(g=>g.map(r3));s.glass=s.glass.map(g=>g.map(r3));
  for(const k of["rooms","zones"])s[k].forEach(q=>{q.x=r3(q.x);q.z=r3(q.z);q.w=r3(q.w);q.d=r3(q.d)});
  s.desks.forEach(d=>{d.x=r3(d.x);d.z=r3(d.z)});
  if(s.plan){const p=s.plan;p.x=r3(p.x);p.z=r3(p.z);p.w=r3(p.w);p.d=r3(p.d);p.opacity=r2(p.opacity)}
  if(s.door){s.door.at=r3(s.door.at);s.door.w=r3(s.door.w)}
  return s;
}

/* ================================================================ geometry & snapping */
function distSeg(px,pz,x1,z1,x2,z2){
  const dx=x2-x1,dz=z2-z1,L2=dx*dx+dz*dz;
  const t=L2>0?clamp(((px-x1)*dx+(pz-z1)*dz)/L2,0,1):0;
  return hyp(px-(x1+t*dx),pz-(z1+t*dz));
}
const segLen=g=>hyp(g[2]-g[0],g[3]-g[1]);
const rectOf=o=>({x0:o.x-o.w/2,x1:o.x+o.w/2,z0:o.z-o.d/2,z1:o.z+o.d/2});
function inRect(o,x,z,pad){pad=pad||0;const r=rectOf(o);return x>=r.x0-pad&&x<=r.x1+pad&&z>=r.z0-pad&&z<=r.z1+pad}
// world -> desk-local (w along local x, depth along local z); inverse of world=(lx cos a + lz sin a, -lx sin a + lz cos a)
function toLocal(d,x,z){const a=num(d.a,0),c=Math.cos(a),s=Math.sin(a),dx=x-d.x,dz=z-d.z;return[dx*c-dz*s,dx*s+dz*c]}
function inDesk(d,x,z,pad,w,dd){
  pad=pad||0;w=w||DESK_W;dd=dd||DESK_D;
  const l=toLocal(d,x,z);return Math.abs(l[0])<=w/2+pad&&Math.abs(l[1])<=dd/2+pad;
}
// Points a new wall end may snap to: wall/glass ends, plate corners, room corners. skip = {kind,i} leaves one segment out.
function collectEnds(spec,skip){
  const out=[];
  for(const k of["walls","glass"])arr(spec[k]).forEach((g,i)=>{
    if(skip&&KINDS[skip.kind]===k&&skip.i===i)return;
    out.push([g[0],g[1]],[g[2],g[3]]);
  });
  const hw=num(spec.w,0)/2,hd=num(spec.d,0)/2;
  out.push([-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]);
  for(const r of arr(spec.rooms)){const q=rectOf(r);out.push([q.x0,q.z0],[q.x1,q.z0],[q.x1,q.z1],[q.x0,q.z1])}
  return out;
}
// Snap a cursor point. Priority: existing end within tol > 0/45/90° from anchor (unless free) > grid.
// o = { anchor:[x,z]|null, ends:[[x,z]], free:bool (Shift), off:bool (Alt: no snapping), tol, step }
function snapPoint(x,z,o){
  o=o||{};
  if(o.off)return{x:r3(x),z:r3(z),kind:"free"};
  const tol=o.tol==null?END_SNAP:o.tol;
  let best=null,bd=tol;
  for(const e of arr(o.ends)){const d=hyp(e[0]-x,e[1]-z);if(d<=bd){bd=d;best=e}}
  if(best)return{x:best[0],z:best[1],kind:"end"};
  const a=o.anchor;
  if(a&&!o.free){
    const dx=x-a[0],dz=z-a[1];
    if(hyp(dx,dz)<1e-9)return{x:a[0],z:a[1],kind:"angle",deg:0};
    const q=Math.round(Math.atan2(dz,dx)/(PI/4));
    const sx=Math.round(Math.cos(q*PI/4)),sz=Math.round(Math.sin(q*PI/4));
    // project onto the snapped direction, then round the run so a grid anchor lands on the grid
    const k=snap(sx&&sz?(dx*sx+dz*sz)/2:dx*sx+dz*sz,o.step);
    const deg=(((-q*45)%360)+360)%360;               // compass-ish for display: 0 = east, 90 = north
    return{x:r3(a[0]+sx*k),z:r3(a[1]+sz*k),kind:"angle",deg};
  }
  return{x:snap(x,o.step),z:snap(z,o.step),kind:"grid"};
}

/* ================================================================ hit testing */
// Topmost first: explicit desks > glass > walls > the smallest room/zone under the point (rooms win ties).
function hitTest(spec,x,z,tol,only){
  const ok=k=>!only||only.includes(k);
  tol=tol||0;
  if(ok("desk")){const ds=arr(spec.desks);for(let i=ds.length-1;i>=0;i--)if(inDesk(ds[i],x,z,tol*.5))return{kind:"desk",i}}
  let best=null,bd=Infinity;
  for(const[k,key,half]of[["glass","glass",.05],["wall","walls",.075]]){
    if(!ok(k))continue;
    arr(spec[key]).forEach((g,i)=>{const d=distSeg(x,z,g[0],g[1],g[2],g[3])-half;if(d<=tol&&d<bd-1e-9){bd=d;best={kind:k,i}}});
  }
  if(best)return best;
  let ba=Infinity;
  for(const[k,key]of[["zone","zones"],["room","rooms"]]){
    if(!ok(k))continue;
    arr(spec[key]).forEach((o,i)=>{if(!inRect(o,x,z,0))return;const a=o.w*o.d;if(a<=ba+1e-9){ba=a;best={kind:k,i}}});
  }
  return best;
}
// Corner handle under the point: 0 nw, 1 ne, 2 se, 3 sw, or -1.
function cornerAt(o,x,z,tol){
  const r=rectOf(o),c=[[r.x0,r.z0],[r.x1,r.z0],[r.x1,r.z1],[r.x0,r.z1]];
  let best=-1,bd=Infinity;
  c.forEach((p,i)=>{const d=Math.max(Math.abs(p[0]-x),Math.abs(p[1]-z));if(d<=tol&&d<bd){bd=d;best=i}});
  return best;
}
function wallEndAt(g,x,z,tol){
  const a=hyp(g[0]-x,g[1]-z),b=hyp(g[2]-x,g[3]-z);
  if(Math.min(a,b)>tol)return-1;
  return a<=b?0:1;
}

/* ================================================================ move / resize */
// Moving a rectangle snaps its top-left corner to the grid (so edges line up), keeping its size.
function moveRect(o,dx,dz,snapOn){
  if(!snapOn)return{x:r3(o.x+dx),z:r3(o.z+dz)};
  const x0=snap(o.x-o.w/2+dx),z0=snap(o.z-o.d/2+dz);
  return{x:r3(x0+o.w/2),z:r3(z0+o.d/2)};
}
function moveSeg(g,dx,dz,snapOn){
  if(snapOn){dx=snap(g[0]+dx)-g[0];dz=snap(g[1]+dz)-g[1]}
  return[r3(g[0]+dx),r3(g[1]+dz),r3(g[2]+dx),r3(g[3]+dz)];
}
function movePt(x,z,dx,dz,snapOn){return snapOn?{x:snap(x+dx),z:snap(z+dz)}:{x:r3(x+dx),z:r3(z+dz)}}
// Drag corner c to (px,pz); the opposite corner stays put; never flips, never smaller than min.
function resizeRect(o,c,px,pz,snapOn,min){
  min=min==null?MIN_SIZE:min;
  const r=rectOf(o),sx=(c===1||c===2)?1:-1,sz=c>=2?1:-1;
  const fx=sx>0?r.x0:r.x1,fz=sz>0?r.z0:r.z1;
  if(snapOn){px=snap(px);pz=snap(pz)}
  px=sx>0?Math.max(px,fx+min):Math.min(px,fx-min);
  pz=sz>0?Math.max(pz,fz+min):Math.min(pz,fz-min);
  return{x:r3((px+fx)/2),z:r3((pz+fz)/2),w:r3(Math.abs(px-fx)),d:r3(Math.abs(pz-fz))};
}
// Rectangle from a drag (a = where it started). Grows away from a to at least min.
function rectFromDrag(ax,az,bx,bz,snapOn,min){
  min=min==null?MIN_SIZE:min;
  if(snapOn){ax=snap(ax);az=snap(az);bx=snap(bx);bz=snap(bz)}
  const sx=bx>=ax?1:-1,sz=bz>=az?1:-1;
  if(Math.abs(bx-ax)<min)bx=ax+sx*min;
  if(Math.abs(bz-az)<min)bz=az+sz*min;
  return{x:r3((ax+bx)/2),z:r3((az+bz)/2),w:r3(Math.abs(bx-ax)),d:r3(Math.abs(bz-az))};
}
function presetRect(p,cx,cz,snapOn){
  const x0=snapOn?snap(cx-p.w/2):cx-p.w/2,z0=snapOn?snap(cz-p.d/2):cz-p.d/2;
  return{x:r3(x0+p.w/2),z:r3(z0+p.d/2),w:p.w,d:p.d};
}
// Door gap: 1 m centered on the door side, 2 m for a lobby, none for elevators (closed doors) or solid rooms.
function roomOutline(r){
  const q=rectOf(r);
  const gap=r.door&&r.type!=="elevator"&&r.type!=="open"?(r.type==="lobby"?2:1):0;
  const sides={n:[q.x0,q.z0,q.x1,q.z0],s:[q.x0,q.z1,q.x1,q.z1],w:[q.x0,q.z0,q.x0,q.z1],e:[q.x1,q.z0,q.x1,q.z1]};
  const out=[];
  for(const k of SIDES){
    const g=sides[k];
    if(k===r.door&&gap>0&&segLen(g)>gap+.1){
      const mx=(g[0]+g[2])/2,mz=(g[1]+g[3])/2,ux=(g[2]-g[0])/segLen(g),uz=(g[3]-g[1])/segLen(g);
      out.push([g[0],g[1],mx-ux*gap/2,mz-uz*gap/2],[mx+ux*gap/2,mz+uz*gap/2,g[2],g[3]]);
    }else out.push(g);
  }
  return out;
}
// Exterior shell with the doorway gap (spec.door: side, at = offset from that wall's middle, w = width).
function plateOutline(spec){
  const hw=spec.w/2,hd=spec.d/2,dr=spec.door,out=[];
  const edges={n:[-hw,-hd,hw,-hd],s:[-hw,hd,hw,hd],w:[-hw,-hd,-hw,hd],e:[hw,-hd,hw,hd]};
  for(const k of SIDES){
    const e=edges[k];
    if(!dr||dr.side!==k){out.push(e);continue}
    const along=k==="n"||k==="s",L=along?spec.w:spec.d,gw=clamp(num(dr.w,3),.5,L),c=clamp(num(dr.at,0),-L/2+gw/2,L/2-gw/2);
    if(along)out.push([-hw,e[1],c-gw/2,e[1]],[c+gw/2,e[1],hw,e[1]]);
    else out.push([e[0],-hd,e[0],c-gw/2],[e[0],c+gw/2,e[0],hd]);
  }
  return out.filter(g=>segLen(g)>1e-6);
}
function translateSpec(s,dx,dz){
  const mv=g=>[r3(g[0]+dx),r3(g[1]+dz),r3(g[2]+dx),r3(g[3]+dz)];
  s.walls=arr(s.walls).map(mv);s.glass=arr(s.glass).map(mv);
  for(const k of["rooms","zones","desks"])arr(s[k]).forEach(o=>{o.x=r3(o.x+dx);o.z=r3(o.z+dz)});
  if(Array.isArray(s.ramps))s.ramps.forEach(o=>{o.x=r3(num(o.x,0)+dx);o.z=r3(num(o.z,0)+dz)});
  if(s.plan){s.plan.x=r3(s.plan.x+dx);s.plan.z=r3(s.plan.z+dz)}
  return s;
}

/* ================================================================ wall chain (pure state machine) */
// st = { pts:[[x,z],...] }. ev = {t:"click",p:[x,z]} | {t:"end"} | {t:"dbl"}.
// Returns { st, seg: [x1,z1,x2,z2]|null (a wall to add now), done }.
// A repeat click on the last point is ignored (that is the first half of a double-click); clicking the start of a
// 3+ point chain closes the loop and ends it.
function chainStep(st,ev){
  const pts=arr(st&&st.pts).slice();
  if(!ev||ev.t!=="click")return{st:{pts:[]},seg:null,done:pts.length>0};
  const p=ev.p;
  if(!Array.isArray(p)||!isNum(p[0])||!isNum(p[1]))return{st:{pts},seg:null,done:false};
  if(!pts.length)return{st:{pts:[[p[0],p[1]]]},seg:null,done:false};
  const last=pts[pts.length-1];
  if(hyp(last[0]-p[0],last[1]-p[1])<.05)return{st:{pts},seg:null,done:false};
  const seg=[last[0],last[1],p[0],p[1]];
  if(pts.length>=3&&hyp(pts[0][0]-p[0],pts[0][1]-p[1])<1e-6)return{st:{pts:[]},seg,done:true};
  pts.push([p[0],p[1]]);
  return{st:{pts},seg,done:false};
}

/* ================================================================ undo history */
// Snapshots (JSON strings) of the state BEFORE each change. key coalesces a run of edits (typing a name) into one step.
function createHistory(cap){
  cap=cap||UNDO_CAP;
  const past=[],future=[];let lastKey=null;
  return{
    record(snap,key){
      future.length=0;
      if(key&&key===lastKey)return false;
      past.push(snap);if(past.length>cap)past.shift();
      lastKey=key||null;return true;
    },
    undo(cur){if(!past.length)return null;future.push(cur);lastKey=null;return past.pop()},
    redo(cur){if(!future.length)return null;past.push(cur);if(past.length>cap)past.shift();lastKey=null;return future.pop()},
    canUndo:()=>past.length>0,canRedo:()=>future.length>0,
    breakCoalesce(){lastKey=null},
    size:()=>({past:past.length,future:future.length}),
  };
}
// Selection after undo/redo swaps spec prev for next: same index if that list kept its length (in-place edits)
// or the item is still there, else the same item found by content, else null (it's gone).
function reselect(prev,next,sel){
  const key=sel&&KINDS[sel.kind],a=arr(prev&&prev[key]),b=arr(next&&next[key]);if(!key||a[sel.i]==null)return null;
  const js=JSON.stringify(a[sel.i]);
  if(sel.i<b.length&&(b.length===a.length||JSON.stringify(b[sel.i])===js))return{kind:sel.kind,i:sel.i};
  const i=b.findIndex(o=>JSON.stringify(o)===js);return i>=0?{kind:sel.kind,i}:null;
}

/* ================================================================ teams, desk ids, labels */
function guessArr(team){const t=str(team);for(const[re,a]of ARR_RULES)if(re.test(t))return a;return"bench"}
function teamInfo(teams,team){const t=teams&&typeof teams==="object"&&team?teams[team]:null;return t&&typeof t==="object"?t:null}
function teamArr(teams,team){const t=teamInfo(teams,team);return t&&ARR.includes(t.arr)?t.arr:guessArr(team)}
function hashStr(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function teamColor(teams,team){const t=teamInfo(teams,team);if(t&&HEX.test(str(t.color)))return str(t.color);return PALETTE[hashStr(str(team).toLowerCase())%PALETTE.length]}
function rosterRows(roster){
  const out=[];
  for(const r of arr(roster)){
    if(Array.isArray(r)){out.push({desk:str(r[0]),name:str(r[1]),team:str(r[2]),title:str(r[3])});continue}
    if(!r||typeof r!=="object")continue;
    const o={desk:str(r.desk),name:str(r.name),team:str(r.team),title:str(r.title)};
    const x=num(r.x,NaN),y=num(r.y,NaN);if(isNum(x)&&isNum(y)){o.x=x;o.y=y}
    const rot=num(r.rot,NaN);if(isNum(rot))o.rot=rot;
    out.push(o);
  }
  return out;
}
function teamNames(teams,roster,spec){
  const m=new Map(),add=n=>{n=str(n);if(n&&!m.has(n.toLowerCase()))m.set(n.toLowerCase(),n)};
  if(teams&&typeof teams==="object")Object.keys(teams).forEach(add);
  rosterRows(roster).forEach(r=>add(r.team));
  arr(spec&&spec.zones).forEach(z=>add(z.team));
  arr(spec&&spec.desks).forEach(d=>add(d.team));
  return[...m.values()].sort((a,b)=>a.localeCompare(b));
}
function headcounts(roster){const m=new Map();for(const r of rosterRows(roster)){const k=r.team.toLowerCase();if(k)m.set(k,(m.get(k)||0)+1)}return m}
// Desks the live preview put in zone zi (by model.desks[].zone = zone id or index; falls back to "inside the rectangle").
function zoneCounts(model,spec,zi,roster){
  const z=arr(spec&&spec.zones)[zi];if(!z)return{desks:0,people:0};
  const ds=arr(model&&model.desks);let n=0,tagged=false;
  for(const d of ds){if(!d)continue;if(d.zone!=null&&d.zone!==-1&&d.zone!=="")tagged=true;if(d.zone===z.id||d.zone===zi)n++}
  if(!tagged)n=ds.filter(d=>d&&isNum(d.x)&&isNum(d.z)&&inRect(z,d.x,d.z)).length;
  const t=str(z.team).toLowerCase();
  return{desks:n,people:t?rosterRows(roster).filter(r=>r.team.toLowerCase()===t).length:0};
}
// Next free desk id in the floor's most common "prefix + number" pattern (e.g. 3-114 -> 3-115).
// extra = more real ids (the roster's desk numbers) that count toward the pattern; avoid = ids that must not be
// reused but say nothing about the numbering (e.g. ids the preview made up for auto-filled desks).
function suggestDeskId(spec,extra,avoid){
  const all=[];
  arr(spec&&spec.desks).forEach(d=>all.push(str(d.id)));
  arr(spec&&spec.rooms).forEach(r=>{if(r.type==="office")all.push(str(r.id))});
  arr(extra).forEach(x=>all.push(str(x)));
  const used=new Set(all.concat(arr(avoid).map(str)).filter(Boolean).map(s=>s.toLowerCase()));
  const groups=new Map();
  for(const id of all){const m=/^(.*?)(\d+)$/.exec(id);if(!m)continue;const g=groups.get(m[1])||{n:0,max:0,pad:0};g.n++;g.max=Math.max(g.max,+m[2]);g.pad=Math.max(g.pad,m[2].length);groups.set(m[1],g)}
  let pre=null,g=null;for(const[p,v]of groups)if(!g||v.n>g.n){pre=p;g=v}
  if(!g){pre=(isNum(spec&&spec.f)?spec.f:1)+"-";g={max:100,pad:3}}
  let n=g.max+1,id;
  do{id=pre+String(n).padStart(g.pad,"0");n++}while(used.has(id.toLowerCase()));
  return id;
}
function roomLabel(r){const t=(ROOM_NAME[r.type]||"Room").replace(/ \(.*\)$/,"");return r.name?`"${r.name}" (${t.toLowerCase()})`:`An unnamed ${t.toLowerCase()}`}
function zoneLabel(z){return z.team?`The "${z.team}" team area`:"A team area with no team"}
function describe(spec,sel){
  if(!sel)return"Nothing selected";
  const o=arr(spec&&spec[KINDS[sel.kind]])[sel.i];if(!o)return"Nothing selected";
  switch(sel.kind){
    case"room":return`${(ROOM_NAME[o.type]||"Room").replace(/ \(.*\)$/,"")}${o.name?" "+o.name:""}, ${fmtM(o.w)} by ${fmtM(o.d)} meters`;
    case"zone":return`Team area ${o.team||"with no team"}, ${fmtM(o.w)} by ${fmtM(o.d)} meters`;
    case"desk":return`Desk ${o.id||"with no id"}, faces ${facingName(o.a)}`;
    default:return`${sel.kind==="glass"?"Glass partition":"Wall"}, ${fmtM(segLen(o))} meters long`;
  }
}

/* ================================================================ validation */
// -> { errors:[{msg,ref}], warnings:[{msg,ref}] }. Errors block saving; warnings ask once.
// ctx.floors = floors in this building (unknown => assume more than one); ctx.model = latest preview (for unplaced people).
function validate(spec,ctx){
  ctx=ctx||{};
  const errors=[],warnings=[];
  const E=(msg,ref)=>errors.push({msg,ref:ref||null}),W=(msg,ref)=>warnings.push({msg,ref:ref||null});
  const rooms=arr(spec&&spec.rooms),zones=arr(spec&&spec.zones),desks=arr(spec&&spec.desks);
  const hw=num(spec&&spec.w,0)/2,hd=num(spec&&spec.d,0)/2;
  // desk ids: present and unique (case-insensitive, like the roster match)
  const seen=new Map();
  desks.forEach((d,i)=>{
    const id=str(d.id);
    if(!id){E("A desk has no id. Give it the desk number from your seating chart, or delete it.",{kind:"desk",i});return}
    const k=id.toLowerCase();if(!seen.has(k))seen.set(k,[]);seen.get(k).push(i);
  });
  for(const list of seen.values())if(list.length>1)E(`Desk id "${str(desks[list[0]].id)}" is used by ${list.length} desks. Each desk needs its own id.`,{kind:"desk",i:list[1]});
  const roomIds=new Map();
  rooms.forEach((r,i)=>{
    const k=str(r.id).toLowerCase();
    if(k){if(roomIds.has(k))E(`Two rooms share the id "${r.id}". Change one of them.`,{kind:"room",i});else roomIds.set(k,i)}
    if(r.type==="office"&&seen.has(k))E(`Desk id "${r.id}" is also used by the private office ${r.name?`"${r.name}"`:"here"}. Change one of them.`,{kind:"room",i});
  });
  // sizes and the plate edge
  const edge=(o,ref,label)=>{
    if(!(o.w>=.1)||!(o.d>=.1)){E(`${label} has no size. Set its width and depth, or delete it.`,ref);return}
    const q=rectOf(o),eps=.01;
    if(q.x1<=-hw||q.x0>=hw||q.z1<=-hd||q.z0>=hd)W(`${label} is outside the floor, so it won't show up.`,ref);
    else if(q.x0<-hw-eps||q.x1>hw+eps||q.z0<-hd-eps||q.z1>hd+eps)W(`${label} sticks out past the edge of the floor. The part outside will be cut off.`,ref);
  };
  rooms.forEach((r,i)=>edge(r,{kind:"room",i},roomLabel(r)));
  zones.forEach((z,i)=>{edge(z,{kind:"zone",i},zoneLabel(z));if(!str(z.team)&&z.w>=.1&&z.d>=.1)W("A team area has no team picked, so nobody will sit there.",{kind:"zone",i})});
  const outD=[];desks.forEach((d,i)=>{if(Math.abs(d.x)>hw||Math.abs(d.z)>hd)outD.push(i)});
  if(outD.length){const ids=outD.slice(0,3).map(i=>str(desks[i].id)||"(no id)").join(", ");W(`${plural(outD.length,"desk is","desks are")} outside the floor: ${ids}${outD.length>3?` and ${outD.length-3} more`:""}.`,{kind:"desk",i:outD[0]})}
  const outW=[];
  for(const[key,kind]of[["walls","wall"],["glass","glass"]])arr(spec&&spec[key]).forEach((g,i)=>{
    const out=p=>Math.abs(g[p])>hw+.5||Math.abs(g[p+1])>hd+.5;if(out(0)&&out(2))outW.push({kind,i});
  });
  if(outW.length)W(`${plural(outW.length,"wall is","walls are")} outside the floor and will be cut off.`,outW[0]);
  // building connections
  const floors=num(ctx.floors,NaN);
  if(!(floors===1)&&!rooms.some(r=>r.type==="elevator"))W("There's no elevator on this floor, so nobody can ride here from another floor. Add one under Room › Elevator.",null);
  if(spec&&spec.f===1&&!spec.door)W("Floor 1 has no outside doorway, so cars can't drive out to the campus. Set one under Floor › Doorway.",null);
  const un=arr(ctx.model&&ctx.model.unplaced).length;
  if(un)W(`${plural(un,"person","people")} on this floor ${un===1?"doesn't":"don't"} have a desk yet. Add desks or make a team area bigger.`,null);
  return{errors,warnings};
}

/* ================================================================ facilities desks */
// Roster rows that carry facilities x,y (raw drawing units, y up). One row per desk id.
function facilityRows(roster){
  const seen=new Set(),rows=[];let dupes=0;
  for(const r of rosterRows(roster)){
    if(!r.desk||!isNum(r.x)||!isNum(r.y))continue;
    const k=r.desk.toLowerCase();if(seen.has(k)){dupes++;continue}
    seen.add(k);rows.push(r);
  }
  return{rows,dupes};
}
// The two rows farthest apart (best for lining up). Exact up to 1500 rows, else extreme points of x±y.
function farthestPair(rows){
  const n=arr(rows).length;if(n<2)return null;
  let cand=rows.map((_,i)=>i);
  if(n>1500){const ext=[[1,1],[1,-1]].flatMap(([a,b])=>{let lo=0,hi=0;rows.forEach((r,i)=>{const v=a*r.x+b*r.y;if(v<a*rows[lo].x+b*rows[lo].y)lo=i;if(v>a*rows[hi].x+b*rows[hi].y)hi=i});return[lo,hi]});cand=[...new Set(ext)]}
  let best=null,bd=0;
  for(let a=0;a<cand.length;a++)for(let b=a+1;b<cand.length;b++){const p=rows[cand[a]],q=rows[cand[b]],d=hyp(p.x-q.x,p.y-q.y);if(d>bd){bd=d;best=[cand[a],cand[b]]}}
  return best;
}
// Fallback with IMPORT.similarity's contract: maps p1->q1, p2->q2 with uniform scale + rotation + translation.
function simFallback(p1,p2,q1,q2){
  const vx=p2[0]-p1[0],vy=p2[1]-p1[1],ux=q2[0]-q1[0],uy=q2[1]-q1[1],lv=hyp(vx,vy),lu=hyp(ux,uy);
  const s=lv>1e-12&&lu>1e-12?lu/lv:1,r=lv>1e-12&&lu>1e-12?Math.atan2(uy,ux)-Math.atan2(vy,vx):0;
  const c=Math.cos(r)*s,n=Math.sin(r)*s,tx=q1[0]-(c*p1[0]-n*p1[1]),ty=q1[1]-(n*p1[0]+c*p1[1]);
  return{s,r,tx,ty,apply:p=>[c*p[0]-n*p[1]+tx,n*p[0]+c*p[1]+ty]};
}
// Place every facilities desk using two of them clicked on the plan (qa, qb in floor meters).
// Raw y is flipped (drawing y up -> floor z down). The mapping's rotation is read back from apply() so any
// similarity() sign convention works; a desk's facing = its rot (degrees) minus that rotation, snapped to 90°.
function facilityPlace(rows,ia,ib,qa,qb,simFn){
  const A=arr(rows)[ia],B=arr(rows)[ib];
  if(!A||!B||!Array.isArray(qa)||!Array.isArray(qb))return null;
  if(hyp(A.x-B.x,A.y-B.y)<1e-9||hyp(qa[0]-qb[0],qa[1]-qb[1])<1e-9)return null;
  let sim;try{sim=(typeof simFn==="function"?simFn:simFallback)([A.x,-A.y],[B.x,-B.y],qa,qb)}catch(_){return null}
  if(!sim||typeof sim.apply!=="function")return null;
  const ap=p=>{try{const q=sim.apply(p);return q&&isNum(+q[0])&&isNum(+q[1])?[+q[0],+q[1]]:null}catch(_){return null}};
  const o=ap([0,0]),e=ap([1,0]);if(!o||!e)return null;
  const s=hyp(e[0]-o[0],e[1]-o[1]);if(!(s>0))return null;
  const rot=Math.atan2(e[1]-o[1],e[0]-o[0]);
  const desks=[];
  for(const r of rows){const q=ap([r.x,-r.y]);if(!q)continue;desks.push({id:r.desk,x:r3(q[0]),z:r3(q[1]),a:isNum(r.rot)?snapYaw(r.rot*PI/180-rot):0})}
  return{desks,s,r:rot};
}
// Without a plan image: take the raw x,y as feet or meters and center the group on the plate.
function unitPlace(rows,unit){
  const f=UNITS[unit]||1,list=arr(rows);if(!list.length)return[];
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  list.forEach(r=>{x0=Math.min(x0,r.x);x1=Math.max(x1,r.x);y0=Math.min(y0,r.y);y1=Math.max(y1,r.y)});
  const cx=(x0+x1)/2,cy=(y0+y1)/2;
  return list.map(r=>({id:r.desk,x:r3((r.x-cx)*f),z:r3(-(r.y-cy)*f),a:isNum(r.rot)?snapYaw(r.rot*PI/180):0}));
}
// Replace explicit desks that share an id with a placed one (keeping their arrangement/team), append the rest.
function mergeDesks(old,placed){
  const by=new Map();arr(placed).forEach(p=>{const k=str(p.id).toLowerCase();if(k&&!by.has(k))by.set(k,p)});
  const out=[],used=new Set();
  for(const d of arr(old)){
    const k=str(d.id).toLowerCase(),p=by.get(k);
    if(!p){out.push(d);continue}
    if(used.has(k))continue;                     // an older duplicate of a placed id: drop it
    used.add(k);out.push(Object.assign({},d,{id:p.id,x:p.x,z:p.z,a:p.a}));
  }
  for(const[k,p]of by)if(!used.has(k))out.push({id:p.id,x:p.x,z:p.z,a:p.a});
  return out;
}
function countOutside(desks,spec){const hw=spec.w/2,hd=spec.d/2;return arr(desks).filter(d=>Math.abs(d.x)>hw||Math.abs(d.z)>hd).length}
// Rough unit read-back from a fitted scale (meters per raw unit), for a sanity line in the panel.
function unitFromScale(s){let best=null,bd=.08;for(const k in UNITS){const d=Math.abs(Math.log(s/UNITS[k]));if(d<bd){bd=d;best=k}}return best}

/* ================================================================ DXF -> walls */
const INSUNITS={1:"in",2:"ft",4:"mm",5:"cm",6:"m"};
function unitKey(u){
  if(isNum(u))return INSUNITS[u]||null;
  const s=str(u).toLowerCase();
  if(/^(in|inch|inches|")$/.test(s))return"in";
  if(/^(ft|foot|feet|')$/.test(s))return"ft";
  if(/^(mm|millimet(er|re)s?)$/.test(s))return"mm";
  if(/^(cm|centimet(er|re)s?)$/.test(s))return"cm";
  if(/^(m|met(er|re)s?)$/.test(s))return"m";
  return null;
}
function segBounds(segs){
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(const s of arr(segs)){if(!s)continue;for(const[x,y]of[[s.x1,s.y1],[s.x2,s.y2]]){const a=num(x,NaN),b=num(y,NaN);if(!isNum(a)||!isNum(b))continue;x0=Math.min(x0,a);x1=Math.max(x1,a);y0=Math.min(y0,b);y1=Math.max(y1,b)}}
  return x0<=x1?{x0,x1,y0,y1,w:x1-x0,h:y1-y0}:null;
}
// Units of a parsed DXF: { unit: key of UNITS or "file", factor: meters per drawing unit, how: "file"|"guess", label }
function dxfUnit(dxf,plateW){
  const k=unitKey(dxf&&dxf.units);
  if(k)return{unit:k,factor:UNITS[k],how:"file",label:UNIT_NAMES[k]};
  const sc=num(dxf&&dxf.scale,NaN);
  if(sc>0){
    for(const u in UNITS)if(Math.abs(UNITS[u]/sc-1)<.02)return{unit:u,factor:UNITS[u],how:"file",label:UNIT_NAMES[u]};
    return{unit:"file",factor:sc,how:"file",label:`Drawing units (${str(dxf.units)||"from the file"})`};
  }
  // no units in the file: pick the one that makes the drawing closest to this floor's width
  const b=segBounds(dxf&&dxf.segments),ext=b?Math.max(b.w,b.h):0;
  if(!(ext>0))return{unit:"m",factor:1,how:"guess",label:UNIT_NAMES.m};
  let best="m",bd=Infinity;
  for(const u in UNITS){const d=Math.abs(Math.log(ext*UNITS[u]/(num(plateW,72)||72)));if(d<bd){bd=d;best=u}}
  return{unit:best,factor:UNITS[best],how:"guess",label:UNIT_NAMES[best]};
}
const layerOf=s=>str(s&&s.layer)||"0";
// Layers that hold line segments: [{name,count,checked,glass}], most lines first.
function dxfLayers(dxf){
  const m=new Map();
  for(const s of arr(dxf&&dxf.segments)){if(!s)continue;const n=layerOf(s);m.set(n,(m.get(n)||0)+1)}
  return[...m].map(([name,count])=>({name,count,checked:WALL_LAYER.test(name),glass:GLASS_LAYER.test(name)}))
    .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
}
// Segments on the picked layers -> floor walls/glass, scaled to meters, y flipped, centered on the plate.
// unit = key of UNITS or a number (meters per unit). Pieces shorter than 0.2 m and exact duplicates are skipped.
function dxfToWalls(dxf,layers,unit,o){
  o=o||{};
  const f=isNum(unit)&&unit>0?unit:(UNITS[unit]||1),minLen=o.minLen==null?MIN_SEG:o.minLen,cap=o.cap||MAX_IMPORT;
  const pick=new Set(Array.from(layers||[]).map(String));
  const segs=[],keys=new Set();let skipped=0,dups=0;
  for(const s of arr(dxf&&dxf.segments)){
    if(!s||!pick.has(layerOf(s)))continue;
    const c=[num(s.x1,NaN)*f,-num(s.y1,NaN)*f,num(s.x2,NaN)*f,-num(s.y2,NaN)*f];
    if(!c.every(isNum)||segLen(c)<minLen){skipped++;continue}
    const a=`${Math.round(c[0]*100)},${Math.round(c[1]*100)}`,b=`${Math.round(c[2]*100)},${Math.round(c[3]*100)}`,key=a<b?a+"|"+b:b+"|"+a;
    if(keys.has(key)){dups++;continue}
    keys.add(key);segs.push({g:GLASS_LAYER.test(layerOf(s)),c});
  }
  let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
  for(const s of segs){x0=Math.min(x0,s.c[0],s.c[2]);x1=Math.max(x1,s.c[0],s.c[2]);z0=Math.min(z0,s.c[1],s.c[3]);z1=Math.max(z1,s.c[1],s.c[3])}
  const cx=segs.length?(x0+x1)/2:0,cz=segs.length?(z0+z1)/2:0;
  const capped=Math.max(0,segs.length-cap);if(capped)segs.length=cap;
  const walls=[],glass=[];
  for(const s of segs){const g=[r3(s.c[0]-cx),r3(s.c[1]-cz),r3(s.c[2]-cx),r3(s.c[3]-cz)];(s.g?glass:walls).push(g)}
  return{walls,glass,skipped,dups,capped,w:segs.length?r2(x1-x0):0,d:segs.length?r2(z1-z0):0};
}

/* ================================================================ plan image */
// Fit an image inside the plate, centered, keeping its aspect.
function planFit(iw,ih,pw,pd,asset,opacity){
  iw=num(iw,0);ih=num(ih,0);if(!(iw>0&&ih>0)){iw=pw;ih=pd}
  const k=Math.min(pw/iw,pd/ih),w=r3(iw*k),d=r3(ih*k);
  return{asset:String(asset||""),x:r3(-w/2),z:r3(-d/2),w,d,opacity:isNum(opacity)?opacity:.55};
}
// "Set scale": p1,p2 clicked on the plan are really `real` units apart -> rescale the plan about p1.
function planRescale(plan,p1,p2,real,unit){
  if(!plan||!Array.isArray(p1)||!Array.isArray(p2))return null;
  const m=num(real,NaN)*(UNITS[unit]||1),dist=hyp(p2[0]-p1[0],p2[1]-p1[1]);
  if(!(m>0)||!(dist>1e-6))return null;
  const k=m/dist;
  return Object.assign({},plan,{x:r3(p1[0]+(plan.x-p1[0])*k),z:r3(p1[1]+(plan.z-p1[1])*k),w:r3(plan.w*k),d:r3(plan.d*k)});
}
// "Match floor to plan": the plate becomes the plan's size; everything shifts so the plan is centered on it.
function matchFloorToPlan(s){
  if(!s||!s.plan)return false;
  const cx=s.plan.x+s.plan.w/2,cz=s.plan.z+s.plan.d/2;
  translateSpec(s,-cx,-cz);
  s.w=r2(clamp(s.plan.w,MIN_PLATE,MAX_PLATE));s.d=r2(clamp(s.plan.d,MIN_PLATE,MAX_PLATE));
  return true;
}

/* ================================================================ misc pure helpers */
// Preview throttle: run now if `ms` passed since the last run, else wait the rest.
function throttle(last,now,ms){const wait=last+ms-now;return wait<=0?{run:true,wait:0}:{run:false,wait:Math.ceil(wait)}}
function isDark(c){
  c=str(c);let r,g,b;
  const m=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if(m){let x=m[1];if(x.length===3)x=x.replace(/./g,"$&$&");r=parseInt(x.slice(0,2),16);g=parseInt(x.slice(2,4),16);b=parseInt(x.slice(4,6),16)}
  else{const n=/rgba?\(([^)]+)\)/i.exec(c);if(!n)return false;[r,g,b]=n[1].split(/[\s,/]+/).map(Number)}
  return(.2126*r+.7152*g+.0722*b)/255<.45;
}
function shortName(name,full){const p=str(name).split(/\s+/);if(full||p.length<2)return str(name);return p[0]+" "+p[p.length-1][0]+"."}

const T={GRID,END_SNAP,MIN_SIZE,UNDO_CAP,BUILD_MS,MIN_SEG,MAX_IMPORT,DESK_W,DESK_D,ROOM_TYPES,ROOM_NAME,ARR_NAMES,PRESETS,UNITS,
  snap,snapYaw,yawIndex,facingName,normalize,normSpec,finalize,nextId,distSeg,segLen,rectOf,inRect,inDesk,toLocal,collectEnds,snapPoint,
  hitTest,cornerAt,wallEndAt,moveRect,moveSeg,movePt,resizeRect,rectFromDrag,presetRect,roomOutline,plateOutline,translateSpec,
  chainStep,createHistory,reselect,guessArr,teamArr,teamColor,rosterRows,teamNames,headcounts,zoneCounts,suggestDeskId,describe,validate,
  facilityRows,farthestPair,simFallback,facilityPlace,unitPlace,mergeDesks,countOutside,unitFromScale,
  unitKey,dxfUnit,dxfLayers,dxfToWalls,planFit,planRescale,matchFloorToPlan,throttle,isDark,shortName,fmtM};

/* ================================================================ DOM layer (only runs inside open) */
const TOOLS=[{k:"select",label:"Select",key:"V"},{k:"wall",label:"Wall",key:"W"},{k:"glass",label:"Glass",key:"G"},{k:"room",label:"Room",key:"R"},
  {k:"zone",label:"Team area",key:"T"},{k:"desk",label:"Desk",key:"D"},{k:"erase",label:"Erase",key:"X"},{k:"floor",label:"Floor",key:"F"}];
const ICONS={
  select:'<path d="M4 2.5l8.5 5-3.9 1.1 2.2 3.9-1.6.9-2.2-3.9L4.4 12z" fill="currentColor" stroke="none"/>',
  wall:'<path d="M3 13L13 3" stroke-width="3.2"/>',
  glass:'<path d="M2.5 11.5l9-9M4.5 13.5l9-9"/>',
  room:'<path d="M6.5 2.5h-4v11h11v-11h-4"/>',
  zone:'<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" fill="currentColor" fill-opacity=".28"/>',
  desk:'<rect x="2.5" y="3.5" width="11" height="5" rx="1"/><circle cx="8" cy="12" r="1.8"/>',
  erase:'<path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/>',
  floor:'<path d="M9.5 12.5h4v-9h-11v9h4"/>'};
const PLAN_ACCEPT="image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf";
const CSS=`
#ed{--ed-danger:#C43B3B;position:fixed;inset:0;z-index:40;background:var(--ground);color:var(--ink);font:500 13px/1.4 var(--display);display:grid;grid-template-columns:auto minmax(0,1fr) 316px;grid-template-rows:auto minmax(0,1fr) auto;grid-template-areas:"top top top" "rail stage props" "status status status";overflow:hidden;-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%;padding:0 env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) #ed{--ed-danger:#FF8A80}}
:root[data-theme="dark"] #ed{--ed-danger:#FF8A80}
#ed,#ed *,#ed *::before,#ed *::after{box-sizing:border-box}
#ed [hidden]{display:none!important}
#ed button,#ed input,#ed select{font:inherit;color:inherit}
#ed :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#ed .tb{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--btn);color:var(--ink);font:600 12px var(--display);cursor:pointer;white-space:nowrap;text-align:left}
#ed .tb:hover:not(:disabled){border-color:var(--muted)}
#ed .tb[aria-pressed="true"]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
#ed .tb:disabled,#ed .primary:disabled{opacity:.45;cursor:default}
#ed .primary{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:7px 14px;border-radius:9px;border:0;background:var(--accent);color:var(--on-accent);font:700 13px var(--display);cursor:pointer;white-space:nowrap}
#ed .primary:hover:not(:disabled){filter:brightness(1.07)}
#ed .ed-danger{color:var(--ed-danger)}
#ed kbd{font:500 10px var(--mono);color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 4px;margin-left:auto}
#ed .ed-top{grid-area:top;display:flex;align-items:center;gap:10px;padding:8px 12px;padding-top:calc(8px + env(safe-area-inset-top,0px));border-bottom:1px solid var(--line);background:var(--glass2);min-width:0}
#ed .ed-ttl{flex:1;min-width:0;line-height:1.15}
#ed .ed-ttl small{display:block;font:500 10px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
#ed .ed-ttl b{display:block;font-size:16px;font-weight:800;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ed .ed-dirty{font:500 11px var(--mono);color:var(--muted);white-space:nowrap}
#ed .ed-acts{display:flex;gap:6px;flex:none;align-items:center}
#ed .ed-rail{grid-area:rail;display:flex;flex-direction:column;gap:4px;padding:8px;width:150px;border-right:1px solid var(--line);overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}
#ed .ed-tool{justify-content:flex-start;width:100%;min-height:36px}
#ed .ed-tool svg{display:block}
#ed .ed-sep{flex:none;height:1px;margin:4px 2px;background:var(--line)}
#ed .ed-stage{grid-area:stage;position:relative;min-width:0;min-height:0;overflow:hidden}
#ed canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;-webkit-user-select:none;user-select:none}
#ed canvas:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
#ed .ed-zoom{position:absolute;right:10px;bottom:10px;display:flex;gap:4px;padding:4px;border-radius:10px;border:1px solid var(--line);background:var(--glass)}
#ed .ed-zoom .tb{min-width:34px;padding:6px 8px}
#ed .ed-banner{position:absolute;left:12px;top:10px;max-width:min(520px,calc(100% - 24px));padding:8px 8px 8px 12px;border-radius:10px;border:1px solid var(--accent);background:var(--glass2);font:500 13px/1.4 var(--display);display:flex;gap:10px;align-items:flex-start;z-index:2;box-shadow:0 4px 14px rgba(0,0,0,.12)}
#ed .ed-banner[hidden]{display:none}#ed .ed-banner span{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
#ed .ed-notein{width:100%;box-sizing:border-box;min-height:84px;resize:vertical;font:500 14px/1.4 var(--display);padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--btn);color:var(--ink)}
#ed .ed-msg{position:absolute;left:50%;top:10px;transform:translateX(-50%);max-width:calc(100% - 24px);padding:7px 12px;border-radius:9px;border:1px solid var(--line);background:var(--glass2);font:600 12px var(--display);pointer-events:none;text-align:center;z-index:2}
#ed .ed-props{grid-area:props;display:flex;flex-direction:column;min-height:0;min-width:0;border-left:1px solid var(--line);background:var(--glass2)}
#ed .ed-sheet{display:none}
#ed .ed-body{flex:1;min-height:0;overflow-y:auto;padding:12px 14px 20px;display:flex;flex-direction:column;gap:16px}
#ed .ed-body h2{margin:0;font-size:17px;font-weight:800;letter-spacing:-.01em;overflow-wrap:anywhere}
#ed .ed-kick{font:500 10px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px}
#ed .ed-sec{display:flex;flex-direction:column;gap:8px}
#ed .ed-sec h3{margin:0;font:500 11px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
#ed .ed-fld{display:flex;flex-direction:column;gap:4px;min-width:0}
#ed .ed-fld>label,#ed .ed-lab{font:600 12px var(--display)}
#ed .ed-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#ed .ed-presets{display:grid;grid-template-columns:1fr 1fr;gap:6px}
#ed .ed-presets .tb{justify-content:space-between}
#ed .ed-presets .tb span{font:400 11px var(--mono);color:var(--muted)}
#ed .ed-in{width:100%;min-height:34px;padding:6px 9px;border:1px solid var(--line);border-radius:7px;background:var(--btn);color:var(--ink);font:500 13px var(--display)}
#ed select.ed-in{padding-right:4px}
#ed select.ed-in option{background:var(--ground);color:var(--ink)}
#ed .ed-num{font-family:var(--mono);font-variant-numeric:tabular-nums}
#ed .ed-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
#ed .ed-seg{display:flex;flex-wrap:wrap;gap:4px}
#ed .ed-seg .tb{flex:1 0 auto;padding:6px 8px;justify-content:center}
#ed .ed-note,#ed .ed-hint{margin:0;font-size:12px;line-height:1.45;color:var(--muted)}
#ed .ed-warn{color:var(--ed-danger)}
#ed .ed-stat{margin:0;font:500 12px var(--mono);font-variant-numeric:tabular-nums;line-height:1.5}
#ed .ed-step{margin:0;padding:8px 10px;border-radius:8px;background:var(--chip);font-weight:700}
#ed .ed-checks{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
#ed .ed-checks li{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:1.4}
#ed .ed-checks li span{flex:1;min-width:0}
#ed .ed-checks .tb{min-height:28px;padding:3px 8px;flex:none}
#ed .ed-chips{display:flex;flex-wrap:wrap;gap:6px}
#ed .ed-chips .tb{border-radius:999px}
#ed .ed-check{display:flex;gap:8px;align-items:center;min-height:32px;font-size:13px;cursor:pointer}
#ed input[type=range]{width:100%;accent-color:var(--accent);min-height:32px;margin:0}
#ed input[type=checkbox]{width:18px;height:18px;accent-color:var(--accent);margin:0;flex:none}
#ed .ed-keys{font:400 11px/1.7 var(--mono);color:var(--muted);margin:0}
#ed .ed-status{grid-area:status;display:flex;gap:14px;align-items:center;padding:5px 12px;border-top:1px solid var(--line);font:400 11px var(--mono);color:var(--muted);white-space:nowrap;overflow:hidden;min-width:0;min-height:26px}
#ed .ed-status .ed-hintline{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--ink)}
#ed .ed-modal{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.4)}
#ed .ed-dlg{width:min(500px,100%);max-height:100%;overflow:auto;padding:18px;border-radius:14px;border:1px solid var(--line);background:var(--ground);box-shadow:0 18px 50px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:12px}
#ed .ed-dlg h2{margin:0;font-size:18px;font-weight:800}
#ed .ed-dlg p{margin:0;line-height:1.45}
#ed .ed-dlg-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:4px}
#ed .ed-layers{display:flex;flex-direction:column;gap:2px;max-height:min(260px,40vh);overflow:auto;border:1px solid var(--line);border-radius:8px;padding:4px}
#ed .ed-layers label{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;min-height:34px;cursor:pointer}
#ed .ed-layers label:hover{background:var(--chip)}
#ed .ed-layers .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 12px var(--mono)}
#ed .ed-layers .c{font:400 11px var(--mono);color:var(--muted)}
#ed .ed-tag{font:500 10px var(--mono);color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 4px}
#ed .ed-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
@media (max-width:760px),(max-height:520px){
  #ed{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr) auto;grid-template-areas:"top" "rail" "stage" "status"}
  #ed .ed-rail{flex-direction:row;width:auto;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid var(--line);padding:6px 8px;scrollbar-width:none}
  #ed .ed-rail::-webkit-scrollbar{display:none}
  #ed .ed-tool{width:auto;flex:none;min-height:34px}
  #ed .ed-sep{width:1px;height:auto;align-self:stretch;margin:2px}
  #ed .ed-tool kbd,#ed .ed-ttl small,#ed .ed-dirty{display:none}
  #ed .ed-acts .tb,#ed .ed-acts .primary{padding-left:9px;padding-right:9px}
  #ed .ed-props{grid-area:stage;z-index:3;border:1px solid var(--line);box-shadow:0 -6px 24px rgba(0,0,0,.18);overflow:hidden}
  #ed .ed-sheet{display:flex;align-items:center;gap:8px;width:100%;min-height:42px;padding:8px 14px;border:0;border-bottom:1px solid var(--line);background:transparent;cursor:pointer;font:700 13px var(--display);text-align:left;flex:none}
  #ed .ed-sheet span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #ed .ed-sheet b{font:500 11px var(--mono);color:var(--muted)}
  #ed.ed-collapsed .ed-body{display:none}
  #ed.ed-collapsed .ed-sheet{border-bottom:0}
  #ed .ed-zoom{right:auto;left:8px;bottom:auto;top:8px}
  #ed .ed-msg{top:56px}
}
@media (max-width:760px) and (min-height:521px){
  #ed .ed-props{align-self:end;max-height:58%;border-radius:14px 14px 0 0;border-bottom:0;border-left:0;border-right:0}
}
@media (max-height:520px){
  #ed .ed-props{justify-self:end;align-self:stretch;width:min(320px,48vw);border-radius:12px 0 0 12px;border-right:0}
  #ed.ed-collapsed .ed-props{align-self:start;width:auto;max-width:60vw;border-radius:0 0 0 12px;border-top:0}
  #ed .ed-top{padding-top:calc(5px + env(safe-area-inset-top,0px));padding-bottom:5px}
}
@media (pointer:coarse){#ed .ed-xy{display:none}}
`;

let live=null;   // the open editor instance (one at a time)

function h(tag,attrs,...kids){
  const el=document.createElement(tag);let val;
  if(attrs)for(const k in attrs){
    const v=attrs[k];if(v==null||v===false)continue;
    if(k==="text")el.textContent=v;
    else if(k==="class")el.className=v;
    else if(k==="value")val=v;
    else if(k.slice(0,2)==="on"&&typeof v==="function")el.addEventListener(k.slice(2),v);
    else if(v===true){if(k in el)el[k]=true;else el.setAttribute(k,"")}
    else el.setAttribute(k,String(v));
  }
  for(const c of kids.flat(Infinity))if(c!=null&&c!==false)el.append(c.nodeType?c:String(c));
  if(val!==undefined)el.value=val;
  return el;
}
function icon(k){const s=document.createElement("span");s.setAttribute("aria-hidden","true");s.style.display="inline-flex";s.innerHTML=`<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]||""}</svg>`;return s}
function injectStyle(){if(document.getElementById("ed-style"))return;const st=document.createElement("style");st.id="ed-style";st.textContent=CSS;document.head.append(st)}

function open(opts){
  if(typeof document==="undefined")return{close(){}};
  if(live)live.close();
  const inst=makeEditor(opts&&typeof opts==="object"?opts:{});
  return{close(){inst.close()}};
}
function isOpen(){return!!live}

function makeEditor(opts){
  const doc=document,win=window;
  injectStyle();
  const prevFocus=doc.activeElement;
  const teams=opts.teams&&typeof opts.teams==="object"?opts.teams:{};
  const roster=rosterRows(opts.roster);
  const nPeople=roster.filter(r=>r.name).length;   // the host adds name-less rows for open desks (facilities placement)
  const facil=facilityRows(opts.roster);
  const N=normalize(opts.spec,{key:opts.key});
  const title=str(opts.title)||("Floor "+(N.spec.key||""));
  const COARSE=!!(win.matchMedia&&win.matchMedia("(pointer: coarse)").matches);
  const SMALL=win.matchMedia?win.matchMedia("(max-width:760px),(max-height:520px)"):null;
  const S={spec:N.spec,base:"",sel:null,hover:null,tool:"select",mode:null,pending:null,chain:{pts:[]},cursor:null,snapInfo:null,
    drag:null,pinch:null,space:false,model:null,modelErr:null,lastBuild:-Infinity,buildTimer:0,rev:0,ends:null,endsRev:-1,
    view:{cx:0,cz:0,s:10},fitS:10,fitted:false,W:0,H:0,dpr:1,raf:0,saving:false,warnedKey:"",busy:"",planErr:"",
    deskA:0,nextTeam:null,newTeam:false,dirty:false,alive:true,psig:"",titleFn:null,timers:new Set(),msgTimer:0,rectPrev:null};
  S.base=JSON.stringify(S.spec);
  const hist=createHistory(UNDO_CAP);
  const images=new Map();           // asset -> { img, ok, err }
  const urls=[];                    // object URLs to revoke on close
  const offs=[];
  const on=(t,type,fn,o)=>{t.addEventListener(type,fn,o);offs.push(()=>t.removeEventListener(type,fn,o))};
  const ptrs=new Map();
  let binders=[],modal=null,uid=0,ro=null,mo=null;
  const inst={close:()=>teardown()};
  live=inst;

  /* ---------- DOM ---------- */
  const root=h("div",{id:"ed",role:"dialog","aria-modal":"true","aria-labelledby":"ed-ttl"});
  const bUndo=h("button",{class:"tb",type:"button",text:"Undo",title:"Undo (Ctrl+Z)",onclick:()=>undo()});
  const bRedo=h("button",{class:"tb",type:"button",text:"Redo",title:"Redo (Ctrl+Shift+Z)",onclick:()=>redo()});
  const bCancel=h("button",{class:"tb",type:"button",text:"Cancel",onclick:()=>cancel()});
  // mode "suggest": a coworker's proposed change, sent to the page's admins with a note instead of saved over the floor
  const SUGGEST=opts.mode==="suggest",SAVE_L=SUGGEST?"Send suggestion":"Save",SAVING_L=SUGGEST?"Sending…":"Saving…";
  const bSave=h("button",{class:"primary",type:"button",text:SAVE_L,title:SAVE_L+" (Ctrl+S)",onclick:()=>save()});
  const dirtyEl=h("span",{class:"ed-dirty"});
  const top=h("header",{class:"ed-top"},h("div",{class:"ed-ttl"},h("small",{text:str(opts.kicker)||(SUGGEST?"Suggest a change":"Floor editor")}),h("b",{id:"ed-ttl",text:title})),dirtyEl,h("div",{class:"ed-acts"},bUndo,bRedo,bCancel,bSave));
  const toolBtns={};
  const rail=h("nav",{class:"ed-rail","aria-label":"Drawing tools"},TOOLS.map(t=>{
    const fl=t.k==="floor";   // Floor is an action (shows floor settings), not a drawing tool
    const b=h("button",{class:"tb ed-tool",type:"button","aria-pressed":fl?null:"false",title:fl?"Floor settings, plan image and imports (F)":`${t.label} (${t.key})`,onclick:()=>fl?showFloor():setTool(t.k)},icon(t.k),h("span",{text:t.label}),h("kbd",{text:t.key}));
    toolBtns[t.k]=b;return fl?[h("span",{class:"ed-sep","aria-hidden":"true"}),b]:b}));
  const cv=h("canvas",{role:"application",tabindex:"0","aria-roledescription":"floor drawing","aria-label":`Floor drawing for ${title}. Pick a tool on the left, then click or drag here. Arrow keys nudge the selection, [ and ] step through items, plus and minus zoom.`});
  const ctx=cv.getContext("2d");
  const zoomBox=h("div",{class:"ed-zoom"},
    h("button",{class:"tb",type:"button",text:"−","aria-label":"Zoom out",title:"Zoom out (−)",onclick:()=>zoomBy(1/1.25)}),
    h("button",{class:"tb",type:"button",text:"Fit",title:"Fit the floor (0)",onclick:()=>fit()}),
    h("button",{class:"tb",type:"button",text:"+","aria-label":"Zoom in",title:"Zoom in (+)",onclick:()=>zoomBy(1.25)}));
  const msgEl=h("div",{class:"ed-msg",role:"status",hidden:true});
  // a note shown over the drawing (the host passes a suggestion's note while an admin reviews it); Hide tucks it away
  const bannerEl=str(opts.banner)?h("div",{class:"ed-banner",role:"note"},h("span",{text:str(opts.banner)}),h("button",{class:"tb",type:"button",text:"Hide",onclick:()=>{bannerEl.hidden=true}})):null;
  const stage=h("div",{class:"ed-stage"},cv,zoomBox,msgEl,bannerEl);
  const sheetTitle=h("span"),sheetState=h("b",{text:"Hide"});
  const sheetBtn=h("button",{class:"ed-sheet",type:"button","aria-expanded":"true",onclick:()=>setCollapsed(!root.classList.contains("ed-collapsed"))},sheetTitle,sheetState);
  const body=h("div",{class:"ed-body"});
  const props=h("aside",{class:"ed-props","aria-label":"Properties"},sheetBtn,body);
  const stXY=h("span",{class:"ed-xy",text:"—"}),stZoom=h("span",{class:"ed-zm"}),stHint=h("span",{class:"ed-hintline"});
  const status=h("div",{class:"ed-status"},stXY,stZoom,stHint);
  const sr=h("div",{class:"ed-sr","aria-live":"polite","aria-atomic":"true"});
  root.append(top,rail,stage,props,status,sr);
  doc.body.append(root);
  if(SMALL&&SMALL.matches)setCollapsed(true);

  /* ---------- small helpers ---------- */
  const json=()=>JSON.stringify(S.spec);
  const listOf=k=>S.spec[KINDS[k]]||[];
  const item=()=>S.sel?listOf(S.sel.kind)[S.sel.i]:null;
  const sameSel=(a,b)=>!!a&&!!b&&a.kind===b.kind&&a.i===b.i||!a&&!b;
  const later=(fn,ms)=>{const id=setTimeout(()=>{S.timers.delete(id);if(S.alive)fn()},ms);S.timers.add(id);return id};
  const tapWord=t=>COARSE?t.replace(/\bClick\b/g,"Tap").replace(/\bclick\b/g,"tap"):t;
  const toS=(x,z)=>[(x-S.view.cx)*S.view.s+S.W/2,(z-S.view.cz)*S.view.s+S.H/2];
  const toW=(sx,sy)=>[(sx-S.W/2)/S.view.s+S.view.cx,(sy-S.H/2)/S.view.s+S.view.cz];
  const evPos=e=>{const r=cv.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};
  const tcache=new Map();
  function tcol(team){const k=str(team).toLowerCase();if(!tcache.has(k))tcache.set(k,teamColor(teams,str(team)));return tcache.get(k)}
  function arrLabel(z){return z.arr?ARR_NAMES[z.arr]:"Team default · "+ARR_NAMES[teamArr(teams,z.team)]}
  // roster desk numbers set the numbering pattern; ids the preview invented for auto desks are only avoided
  function nextDeskId(sp){return suggestDeskId(sp,roster.map(r=>r.desk),arr(S.model&&S.model.desks).map(d=>d&&d.id))}
  function ends(){if(S.endsRev!==S.rev){S.ends=collectEnds(S.spec);S.endsRev=S.rev}return S.ends}
  function announce(t){sr.textContent="";later(()=>{sr.textContent=t},40)}
  function flash(t,ms){msgEl.textContent=t;msgEl.hidden=!t;if(S.msgTimer){clearTimeout(S.msgTimer);S.timers.delete(S.msgTimer)}S.msgTimer=ms===0||!t?0:later(()=>{msgEl.hidden=true},ms||4000)}
  function setCollapsed(c){root.classList.toggle("ed-collapsed",!!c);sheetBtn.setAttribute("aria-expanded",String(!c));sheetState.textContent=c?"Show":"Hide"}
  const small=()=>!!(SMALL&&SMALL.matches);

  /* ---------- view ---------- */
  function bounds(){
    const sp=S.spec;let x0=-sp.w/2,x1=sp.w/2,z0=-sp.d/2,z1=sp.d/2;
    if(sp.plan){x0=Math.min(x0,sp.plan.x);x1=Math.max(x1,sp.plan.x+sp.plan.w);z0=Math.min(z0,sp.plan.z);z1=Math.max(z1,sp.plan.z+sp.plan.d)}
    return{cx:(x0+x1)/2,cz:(z0+z1)/2,w:x1-x0,d:z1-z0};
  }
  function fitScale(){const b=bounds();return Math.max(.5,Math.min((S.W-40)/b.w,(S.H-40)/b.d))}
  const clampS=s=>clamp(s,Math.min(S.fitS/4,2),400);
  function fit(){if(!S.W||!S.H)return;const b=bounds();S.fitS=fitScale();S.view={cx:b.cx,cz:b.cz,s:S.fitS};S.fitted=true;S.atFit=true;updateStatus();invalidate()}
  function zoomAt(sx,sy,f){S.atFit=false;const w=toW(sx,sy),s=clampS(S.view.s*f);S.view.s=s;S.view.cx=w[0]-(sx-S.W/2)/s;S.view.cz=w[1]-(sy-S.H/2)/s;updateStatus();invalidate()}
  function zoomBy(f){zoomAt(S.W/2,S.H/2,f)}
  function centerOn(x,z){S.atFit=false;S.view.cx=x;S.view.cz=z;invalidate()}
  function resize(){
    const r=stage.getBoundingClientRect(),W=Math.max(0,Math.round(r.width)),H=Math.max(0,Math.round(r.height)),dpr=Math.min(3,win.devicePixelRatio||1);
    if(W===S.W&&H===S.H&&dpr===S.dpr)return;
    S.W=W;S.H=H;S.dpr=dpr;cv.width=Math.max(1,Math.round(W*dpr));cv.height=Math.max(1,Math.round(H*dpr));
    if(!S.fitted||S.atFit)fit();else{S.fitS=fitScale();updateStatus()}   // still showing the whole floor (e.g. a phone rotated): refit
    invalidate();
  }
  function invalidate(){if(!S.raf&&S.alive)S.raf=win.requestAnimationFrame(draw)}

  /* ---------- preview build (throttled) ---------- */
  function scheduleBuild(){
    if(typeof opts.build!=="function"||!S.alive)return;
    const t=throttle(S.lastBuild,performance.now(),BUILD_MS);
    if(t.run){if(S.buildTimer){clearTimeout(S.buildTimer);S.buildTimer=0}runBuild()}
    else if(!S.buildTimer)S.buildTimer=setTimeout(()=>{S.buildTimer=0;runBuild()},t.wait);
  }
  function runBuild(){
    if(!S.alive)return;
    S.lastBuild=performance.now();
    try{const m=opts.build(clone(S.spec));S.model=m&&typeof m==="object"?m:null;S.modelErr=null;tcache.clear();
      arr(S.model&&S.model.teams).forEach(t=>{if(t&&t.team&&HEX.test(str(t.color)))tcache.set(str(t.team).toLowerCase(),str(t.color))})}
    catch(err){S.modelErr=msgOf(err)||"error"}
    invalidate();refreshPanel();
  }

  /* ---------- edits & history ---------- */
  function edit(fn,key){
    const before=json();
    try{fn(S.spec)}catch(err){S.spec=JSON.parse(before);flash("That change couldn't be made.");return false}
    const after=json();if(after===before)return false;
    hist.record(before,key);committed(after);return true;
  }
  function committed(js){
    S.rev++;S.dirty=(js||json())!==S.base;
    if(S.sel&&!item())S.sel=null;
    updateTop();scheduleBuild();invalidate();renderPanel();
  }
  function liveChange(){S.rev++;scheduleBuild();invalidate();refreshPanel()}
  function undo(){
    if(S.drag)cancelDrag();endChain(true);
    if(S.mode&&S.mode.t==="cadmove")S.mode=null;   // its wall indexes may no longer hold
    const prev=hist.undo(json());if(prev==null){announce("Nothing to undo");return}
    swapSpec(prev);announce("Undone");
  }
  function redo(){
    if(S.drag)cancelDrag();endChain(true);
    if(S.mode&&S.mode.t==="cadmove")S.mode=null;
    const next=hist.redo(json());if(next==null){announce("Nothing to redo");return}
    swapSpec(next);announce("Redone");
  }
  // selection and hover are list indexes: keep the selection on the same item, not the same slot
  function swapSpec(js){const old=S.spec;S.spec=JSON.parse(js);S.sel=reselect(old,S.spec,S.sel);S.hover=null;committed(js)}
  function updateTop(){
    bUndo.disabled=!hist.canUndo()||S.saving;bRedo.disabled=!hist.canRedo()||S.saving;
    bSave.disabled=S.saving;bCancel.disabled=S.saving;bSave.textContent=S.saving?SAVING_L:SAVE_L;
    dirtyEl.textContent=S.saving?SAVING_L:S.dirty?(SUGGEST?"Not sent yet":"Unsaved changes"):"";
  }

  /* ---------- selection & tools ---------- */
  function setSel(sel,quiet){
    const same=sameSel(sel,S.sel);
    S.sel=sel||null;hist.breakCoalesce();
    if(!same){S.newTeam=false;renderPanel();if(!quiet)announce(S.sel?describe(S.spec,S.sel):"Nothing selected")}
    syncRail();invalidate();updateStatus();
  }
  function syncRail(){
    for(const t of TOOLS)if(t.k!=="floor")toolBtns[t.k].setAttribute("aria-pressed",String(t.k===S.tool));
  }
  function setTool(k){
    if(S.drag)cancelDrag();
    endChain(true);
    const changed=S.tool!==k||S.mode||S.pending;
    S.pending=null;S.mode=null;S.tool=k;S.hover=null;S.snapInfo=null;
    if(changed&&S.sel)S.sel=null;
    hist.breakCoalesce();syncRail();renderPanel();updateStatus();setCursor();invalidate();
    if(changed)announce(`${TOOLS.find(t=>t.k===k).label} tool`);
  }
  function showFloor(){
    setTool("select");setSel(null,true);setCollapsed(false);renderPanel(true);
    announce("Floor settings");
    const f=body.querySelector("input,select,button");if(f)f.focus({preventScroll:true});
  }
  function exitMode(){S.mode=null;S.pending=null;renderPanel();updateStatus();setCursor();invalidate();syncRail()}
  function endChain(quiet){
    if(!S.chain.pts.length)return;
    S.chain={pts:[]};S.snapInfo=null;
    if(!quiet)announce("Wall finished");
    renderPanel();invalidate();updateStatus();
  }
  function deleteSel(){
    const sel=S.sel;if(!sel)return;
    const d=describe(S.spec,sel).split(",")[0];
    S.sel=null;edit(s=>{s[KINDS[sel.kind]].splice(sel.i,1)});
    renderPanel();announce("Deleted "+d);
  }
  function duplicate(){
    const sel=S.sel,o=item();if(!sel||!o)return;
    let ns=null;
    edit(s=>{
      const list=s[KINDS[sel.kind]];let c=clone(o);
      if(sel.kind==="wall"||sel.kind==="glass")c=c.map(v=>r3(v+1));
      else{
        c.x=r3(c.x+1);c.z=r3(c.z+1);
        if(sel.kind==="room")c.id=c.type==="office"?nextDeskId(s):nextId(c.type==="elevator"?"e":"r",s.rooms);
        else if(sel.kind==="zone")c.id=nextId("z",s.zones);
        else c.id=nextDeskId(s);
      }
      list.push(c);ns={kind:sel.kind,i:list.length-1};
    });
    if(ns){setSel(ns,true);announce("Duplicated. "+describe(S.spec,ns))}
  }
  function rotateDesk(dir){
    if(!S.sel||S.sel.kind!=="desk")return;const i=S.sel.i;
    edit(s=>{const o=s.desks[i];if(o)o.a=snapYaw(o.a+dir*HALF)});
    const o=item();if(o){S.deskA=o.a;announce("Faces "+facingName(o.a))}
  }
  function nudge(dx,dz){
    if(S.mode&&S.mode.t==="planmove"&&S.spec.plan){edit(s=>{s.plan.x=r3(s.plan.x+dx);s.plan.z=r3(s.plan.z+dz)},"nudge-plan");return}
    if(S.mode&&S.mode.t==="cadmove"){const m=S.mode;edit(s=>shiftBatch(s,m,null,dx,dz),"nudge-cad");return}
    if(!S.sel){   // nothing selected: arrows pan the view (40 px, Shift 160 px)
      const px=(Math.abs(dx)>GRID||Math.abs(dz)>GRID?160:40)/S.view.s;
      S.atFit=false;S.view.cx+=Math.sign(dx)*px;S.view.cz+=Math.sign(dz)*px;invalidate();return;
    }
    const sel=S.sel;
    edit(s=>{
      const list=s[KINDS[sel.kind]],o=list[sel.i];if(!o)return;
      if(sel.kind==="wall"||sel.kind==="glass")list[sel.i]=moveSeg(o,dx,dz,false);
      else if(sel.kind==="desk")Object.assign(o,movePt(o.x,o.z,dx,dz,false));
      else Object.assign(o,moveRect(o,dx,dz,false));
    },`nudge:${sel.kind}:${sel.i}`);
  }
  function allItems(){const out=[];for(const k of["room","zone","desk","wall","glass"])listOf(k).forEach((_,i)=>out.push({kind:k,i}));return out}
  function itemCenter(sel){const o=arrFor(sel);if(!o)return null;if(Array.isArray(o))return[(o[0]+o[2])/2,(o[1]+o[3])/2];return[o.x,o.z]}
  function arrFor(sel){return sel?listOf(sel.kind)[sel.i]:null}
  function cycleSel(dir){
    const list=allItems();if(!list.length){announce("Nothing to select yet");return}
    const i=list.findIndex(s=>sameSel(s,S.sel));const n=list[(i<0?(dir>0?0:list.length-1):(i+dir+list.length)%list.length)];
    if(S.tool!=="select"){S.tool="select";S.pending=null;S.mode=null;endChain(true)}
    setSel(n);const c=itemCenter(n);if(c&&!visibleW(c[0],c[1]))centerOn(c[0],c[1]);
  }
  function visibleW(x,z){const p=toS(x,z);return p[0]>=0&&p[1]>=0&&p[0]<=S.W&&p[1]<=S.H}
  function showRef(ref){
    if(!ref||!arrFor(ref))return;
    if(S.tool!=="select")setTool("select");
    setSel(ref);const c=itemCenter(ref);if(c)centerOn(c[0],c[1]);
    if(small())setCollapsed(false);
  }

  /* ---------- creating things ---------- */
  function autoName(type){
    if(["restroom","elevator","stairs","kitchen","lobby","mail","server","storage"].includes(type))return(ROOM_NAME[type]||"").replace(/ \(.*\)$/,"");
    const n=S.spec.rooms.filter(r=>r.type===type).length+1;
    return(ROOM_NAME[type]||"Room").replace(/ \(.*\)$/,"")+" "+n;
  }
  function roomIdFor(type,s){return type==="office"?nextDeskId(s):nextId(type==="elevator"?"e":"r",s.rooms)}
  function addRoom(type,rect,door){
    let ni=-1;
    edit(s=>{s.rooms.push(Object.assign({id:roomIdFor(type,s),type,name:autoName(type)},rect,{door}));ni=s.rooms.length-1});
    if(ni>=0){setSel({kind:"room",i:ni},true);announce("Added "+describe(S.spec,{kind:"room",i:ni}))}
    return ni;
  }
  function defaultTeam(){
    if(S.nextTeam)return S.nextTeam;
    const have=new Set(S.spec.zones.map(z=>str(z.team).toLowerCase()));
    let best="",bn=0;for(const[k,n]of headcounts(roster)){if(!have.has(k)&&n>bn){bn=n;best=k}}
    if(!best)return"";
    const r=roster.find(r=>r.team.toLowerCase()===best);return r?r.team:"";
  }
  function addZone(rect){
    let ni=-1;
    edit(s=>{s.zones.push(Object.assign({id:nextId("z",s.zones),team:defaultTeam(),arr:null},rect,{dir:rect.w>=rect.d?"h":"v"}));ni=s.zones.length-1});
    S.nextTeam=null;
    if(ni>=0){setSel({kind:"zone",i:ni},true);announce("Added "+describe(S.spec,{kind:"zone",i:ni}))}
  }
  function placePreset(p,x,z,keep){
    const ni=addRoom(p.type,presetRect(p,x,z,true),p.door);
    if(!keep)S.pending=null;
    if(ni>=0&&!keep&&small())setCollapsed(false);
    renderPanel();updateStatus();
  }
  function choosePreset(p,ev){
    if(ev&&ev.detail===0){placePreset(p,S.view.cx,S.view.cz,false);return}   // keyboard: drop it in the middle of the view
    S.pending=S.pending&&S.pending.k===p.k?null:p;S.sel=null;
    if(S.pending&&small())setCollapsed(true);
    renderPanel();updateStatus();setCursor();invalidate();
    if(S.pending)announce(tapWord(`Click where the ${p.label.toLowerCase()} goes`));
  }
  function addDesk(x,z){
    let ni=-1;
    edit(s=>{s.desks.push({id:nextDeskId(s),x:snap(x),z:snap(z),a:S.deskA});ni=s.desks.length-1});
    if(ni>=0){setSel({kind:"desk",i:ni},true);announce("Added "+describe(S.spec,{kind:"desk",i:ni}))}
  }
  function wallSnap(x,z,m){
    const last=S.chain.pts[S.chain.pts.length-1]||null;
    return snapPoint(x,z,{anchor:last,ends:ends(),free:!!(m&&m.shiftKey),off:!!(m&&m.altKey),tol:Math.max(END_SNAP,6/S.view.s)});
  }
  function chainClick(x,z,e){
    const p=wallSnap(x,z,e),key=S.tool==="glass"?"glass":"walls";
    const res=chainStep(S.chain,{t:"click",p:[p.x,p.z]});
    if(res.seg)edit(s=>{s[key].push(res.seg.map(r3))});
    S.chain=res.st;
    if(res.done)announce("Wall finished");else if(res.seg)announce(`${fmtM(segLen(res.seg))} meter ${key==="glass"?"glass":"wall"} added`);
    renderPanel();updateStatus();invalidate();
  }
  function eraseAt(x,z,touch){
    const hit=hitTest(S.spec,x,z,(touch?14:7)/S.view.s);if(!hit){announce("Nothing there to erase");return}
    const d=describe(S.spec,hit).split(",")[0];
    if(sameSel(hit,S.sel))S.sel=null;
    edit(s=>{s[KINDS[hit.kind]].splice(hit.i,1)});
    S.hover=null;announce("Deleted "+d);
  }

  /* ---------- pointer input ---------- */
  function setCursor(){
    let c="default";const d=S.drag;
    if(d&&d.type==="pan"||S.pinch)c="grabbing";
    else if(S.space)c="grab";
    else if(d&&d.type==="move")c="move";
    else if(S.mode&&(S.mode.t==="planmove"||S.mode.t==="cadmove"))c="move";
    else if(S.mode||S.pending)c="crosshair";
    else if(S.tool==="select"){if(S.hoverHandle)c=S.hoverHandle;else if(S.hover)c="move"}
    else if(S.tool==="erase")c=S.hover?"pointer":"default";
    else c="crosshair";
    cv.style.cursor=c;
  }
  function handleHit(x,z,tol){
    const o=item();if(!o||S.tool!=="select")return null;
    if(S.sel.kind==="room"||S.sel.kind==="zone"){const c=cornerAt(o,x,z,tol);if(c>=0)return{type:"resize",corner:c,cursor:c%2===0?"nwse-resize":"nesw-resize"}}
    if(S.sel.kind==="wall"||S.sel.kind==="glass"){const e=wallEndAt(o,x,z,tol);if(e>=0)return{type:"wallend",end:e,cursor:"crosshair"}}
    return null;
  }
  function onDown(e){
    if(!S.alive||modal)return;
    const p=evPos(e);
    ptrs.set(e.pointerId,{x:p[0],y:p[1]});
    try{cv.setPointerCapture(e.pointerId)}catch(_){}
    if(doc.activeElement!==cv)cv.focus({preventScroll:true});
    if(ptrs.size===2){cancelDrag();startPinch();e.preventDefault();return}
    if(ptrs.size>2)return;
    const w=toW(p[0],p[1]),touch=e.pointerType==="touch"||e.pointerType==="pen";
    const base={id:e.pointerId,sx:p[0],sy:p[1],wx:w[0],wz:w[1],moved:false,touch,v0:{cx:S.view.cx,cz:S.view.cz}};
    if(e.button===1||(e.button===0&&S.space)){S.drag=Object.assign(base,{type:"pan"});setCursor();e.preventDefault();return}
    if(e.button===2){if(S.chain.pts.length)endChain();return}
    if(e.button!==0)return;
    e.preventDefault();
    const tol=(touch?14:7)/S.view.s;
    if(S.mode&&S.mode.t==="planmove"){
      const pl=S.spec.plan;
      S.drag=pl&&w[0]>=pl.x&&w[0]<=pl.x+pl.w&&w[1]>=pl.z&&w[1]<=pl.z+pl.d?Object.assign(base,{type:"plan",orig:Object.assign({},pl),before:json()}):Object.assign(base,{type:"tap"});
      return;
    }
    if(S.mode&&S.mode.t==="cadmove"){const m=S.mode;S.drag=Object.assign(base,{type:"cad",orig:{walls:S.spec.walls.slice(m.w0,m.w0+m.nW),glass:S.spec.glass.slice(m.g0,m.g0+m.nG)},before:json()});return}
    if(S.mode||S.pending){S.drag=Object.assign(base,{type:"tap"});return}
    if(S.tool==="select"){
      const hd=handleHit(w[0],w[1],tol*1.4);
      if(hd){S.drag=Object.assign(base,{type:hd.type,corner:hd.corner,end:hd.end,orig:clone(item()),before:json()});return}
      const hit=hitTest(S.spec,w[0],w[1],tol);
      if(hit){if(!sameSel(hit,S.sel))setSel(hit);S.drag=Object.assign(base,{type:"move",orig:clone(item()),before:json()});return}
      S.drag=Object.assign(base,{type:"tap",empty:true});return;
    }
    if(S.tool==="room"||S.tool==="zone"){S.drag=Object.assign(base,{type:"rect",hit:hitTest(S.spec,w[0],w[1],tol,[S.tool])});return}
    S.drag=Object.assign(base,{type:"tap"});
  }
  function onMove(e){
    if(!S.alive)return;
    const p=evPos(e);
    if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,{x:p[0],y:p[1]});
    if(S.pinch){if(ptrs.size>=2)updatePinch();return}
    const w=toW(p[0],p[1]);S.cursor=w;updateStatus();
    const d=S.drag;
    if(d&&d.id===e.pointerId){
      if(!d.moved){if(hyp(p[0]-d.sx,p[1]-d.sy)<(d.touch?8:4))return;d.moved=true;if(d.type==="tap")d.type="pan";setCursor()}
      dragMove(d,p,w,e);return;
    }
    if(!d)hoverAt(w,e);
  }
  function hoverAt(w,e){
    const tol=(e&&e.pointerType==="touch"?14:7)/S.view.s;
    let hv=null,hh=null,si=null;
    if(!S.mode&&!S.pending){
      if(S.tool==="select"){const hd=handleHit(w[0],w[1],tol*1.4);hh=hd?hd.cursor:null;if(!hd)hv=hitTest(S.spec,w[0],w[1],tol)}
      else if(S.tool==="erase")hv=hitTest(S.spec,w[0],w[1],tol);
      else if(S.tool==="wall"||S.tool==="glass")si=wallSnap(w[0],w[1],e);
    }
    S.hover=hv;S.hoverHandle=hh;S.snapInfo=si;setCursor();invalidate();
  }
  function dragMove(d,p,w,e){
    const dx=w[0]-d.wx,dz=w[1]-d.wz,snapOn=!e.altKey;
    switch(d.type){
      case"pan":S.atFit=false;S.view.cx=d.v0.cx-(p[0]-d.sx)/S.view.s;S.view.cz=d.v0.cz-(p[1]-d.sy)/S.view.s;invalidate();return;
      case"move":{
        const k=S.sel&&S.sel.kind,list=k?listOf(k):null;if(!list||!list[S.sel.i])return;
        if(k==="wall"||k==="glass")list[S.sel.i]=moveSeg(d.orig,dx,dz,snapOn);
        else if(k==="desk")Object.assign(list[S.sel.i],movePt(d.orig.x,d.orig.z,dx,dz,snapOn));
        else Object.assign(list[S.sel.i],moveRect(d.orig,dx,dz,snapOn));
        liveChange();return;
      }
      case"resize":{const o=item();if(o){Object.assign(o,resizeRect(d.orig,d.corner,w[0],w[1],snapOn));liveChange()}return}
      case"wallend":{
        const o=item();if(!o)return;
        const other=d.end===0?[d.orig[2],d.orig[3]]:[d.orig[0],d.orig[1]];
        const q=snapPoint(w[0],w[1],{anchor:other,ends:collectEnds(S.spec,S.sel),free:e.shiftKey,off:e.altKey,tol:Math.max(END_SNAP,6/S.view.s)});
        if(hyp(q.x-other[0],q.z-other[1])<.05)return;
        o[d.end*2]=q.x;o[d.end*2+1]=q.z;S.snapInfo=q;liveChange();return;
      }
      case"plan":{const pl=S.spec.plan;if(pl){pl.x=r3(d.orig.x+dx);pl.z=r3(d.orig.z+dz);liveChange()}return}
      case"cad":if(S.mode&&S.mode.t==="cadmove"){shiftBatch(S.spec,S.mode,d.orig,dx,dz);liveChange()}return;
      case"rect":S.rectPrev=rectFromDrag(d.wx,d.wz,w[0],w[1],snapOn);invalidate();return;
    }
  }
  function onUp(e){
    if(!S.alive)return;
    ptrs.delete(e.pointerId);
    if(S.pinch){if(ptrs.size<2)S.pinch=null;setCursor();return}
    const d=S.drag;if(!d||d.id!==e.pointerId)return;
    S.drag=null;
    const p=evPos(e),w=toW(p[0],p[1]);
    if(!d.moved)onTap(d,w,e);
    else if(d.type==="rect")finishRect(d,w,e);
    else if(d.before!=null){const after=json();if(after!==d.before){hist.record(d.before);committed(after)}}
    S.snapInfo=null;S.rectPrev=null;setCursor();invalidate();
  }
  function onCancel(e){ptrs.delete(e.pointerId);if(S.pinch&&ptrs.size<2)S.pinch=null;if(S.drag&&S.drag.id===e.pointerId)cancelDrag()}
  // Abort a drag; edits made by it are undone (they were never recorded in history).
  function cancelDrag(){
    const d=S.drag;S.drag=null;S.rectPrev=null;S.snapInfo=null;
    if(d&&d.before!=null&&d.moved){const now=json();if(now!==d.before){S.spec=JSON.parse(d.before);S.rev++;if(S.sel&&!item())S.sel=null;scheduleBuild();refreshPanel()}}
    setCursor();invalidate();
  }
  function onTap(d,w,e){
    const m=S.mode;
    if(m&&m.t==="scale"){scaleClick(w[0],w[1]);return}
    if(m&&m.t==="facil"){facilClick(w[0],w[1]);return}
    if(m)return;
    if(S.pending){placePreset(S.pending,w[0],w[1],e.shiftKey);return}
    switch(S.tool){
      case"select":if(d.empty)setSel(null);return;
      case"wall":case"glass":chainClick(w[0],w[1],e);return;
      case"room":case"zone":if(d.hit)setSel(d.hit);else flash(tapWord(S.tool==="room"?"Drag to draw a room, or pick a ready-made one in the panel.":"Drag a rectangle to draw a team area."),2500);return;
      case"desk":{const hit=hitTest(S.spec,w[0],w[1],(d.touch?14:7)/S.view.s,["desk"]);if(hit)setSel(hit);else addDesk(w[0],w[1]);return}
      case"erase":eraseAt(w[0],w[1],d.touch);return;
    }
  }
  function finishRect(d,w,e){
    const r=rectFromDrag(d.wx,d.wz,w[0],w[1],!e.altKey);
    if(S.tool==="room"){addRoom("conf",r,"s");if(small())setCollapsed(false)}
    else{addZone(r);if(small())setCollapsed(false)}
  }
  function onWheel(e){
    if(!S.alive||modal)return;
    e.preventDefault();
    const p=evPos(e);let dy=e.deltaY,dx=e.deltaX;
    if(e.deltaMode===1){dy*=16;dx*=16}else if(e.deltaMode===2){dy*=S.H;dx*=S.W}
    if(!e.ctrlKey&&Math.abs(dx)>Math.abs(dy)){S.atFit=false;S.view.cx+=dx/S.view.s;invalidate();return}
    zoomAt(p[0],p[1],Math.exp(-dy*(e.ctrlKey?.01:.0015)));
  }
  function startPinch(){const[a,b]=[...ptrs.values()];const mid=[(a.x+b.x)/2,(a.y+b.y)/2];S.pinch={d0:Math.max(1,hyp(a.x-b.x,a.y-b.y)),s0:S.view.s,w:toW(mid[0],mid[1])};setCursor()}
  function updatePinch(){
    const[a,b]=[...ptrs.values()],mid=[(a.x+b.x)/2,(a.y+b.y)/2],s=clampS(S.pinch.s0*hyp(a.x-b.x,a.y-b.y)/S.pinch.d0);
    S.atFit=false;S.view.s=s;S.view.cx=S.pinch.w[0]-(mid[0]-S.W/2)/s;S.view.cz=S.pinch.w[1]-(mid[1]-S.H/2)/s;updateStatus();invalidate();
  }
  function onDbl(e){
    if(!S.alive||modal)return;
    if((S.tool==="wall"||S.tool==="glass")&&S.chain.pts.length){endChain();return}
    if(S.tool==="select"&&S.sel){setCollapsed(false);const f=body.querySelector("input:not([type=range]),select");if(f)f.focus()}
  }

  /* ---------- keyboard ---------- */
  function focusables(box){return[...box.querySelectorAll('button,input,select,textarea,canvas,[tabindex]')].filter(el=>!el.disabled&&el.getAttribute("tabindex")!=="-1"&&!(el.type==="file")&&el.getClientRects().length>0)}
  function trapTab(e,box){
    const list=focusables(box);if(!list.length)return;
    const i=list.indexOf(doc.activeElement);
    if(e.shiftKey&&i<=0){e.preventDefault();list[list.length-1].focus()}
    else if(!e.shiftKey&&(i<0||i===list.length-1)){e.preventDefault();list[0].focus()}
  }
  function onKey(e){
    if(!S.alive)return;
    e.stopPropagation();                       // the game behind the overlay must not drive while editing
    const k=e.key||"",kl=k.length===1?k.toLowerCase():k;
    if(e.type==="keyup"){
      if(k===" "){S.space=false;setCursor()}
      if((k==="Shift"||k==="Alt")&&S.cursor&&(S.tool==="wall"||S.tool==="glass")&&!S.drag){S.snapInfo=wallSnap(S.cursor[0],S.cursor[1],e);invalidate()}
      return;
    }
    if(modal){if(k==="Escape"){e.preventDefault();modal.done(null)}else if(k==="Tab")trapTab(e,modal.box);return}
    const t=e.target,inRoot=root.contains(t);
    const typing=inRoot&&((t.tagName==="INPUT"&&!/^(button|checkbox|radio|range|file)$/i.test(t.type))||t.tagName==="SELECT"||t.tagName==="TEXTAREA"||t.isContentEditable);
    const mod=e.ctrlKey||e.metaKey;
    if(k==="Tab"){trapTab(e,root);return}
    if(k==="Escape"){e.preventDefault();if(typing){t.blur();cv.focus({preventScroll:true});return}escape();return}
    if(mod&&kl==="s"){e.preventDefault();if(typing)t.blur();save();return}
    // input listeners never see keydown (stopPropagation above, in capture), so Enter in Real length is handled here
    if(k==="Enter"&&!mod&&!e.altKey&&inRoot&&t.dataset&&t.dataset.k==="scale-real"){e.preventDefault();applyScale();return}
    if(typing)return;
    if(mod&&kl==="z"){e.preventDefault();if(e.shiftKey)redo();else undo();return}
    if(mod&&kl==="y"){e.preventDefault();redo();return}
    if(mod&&kl==="d"){e.preventDefault();duplicate();return}
    if((k==="Shift"||k==="Alt")&&S.cursor&&(S.tool==="wall"||S.tool==="glass")&&!S.drag){if(k==="Alt")e.preventDefault();S.snapInfo=wallSnap(S.cursor[0],S.cursor[1],e);invalidate();return}
    if(mod||e.altKey)return;
    const onCtl=inRoot&&(t.tagName==="BUTTON"||t.tagName==="INPUT");
    if(k===" "){if(onCtl)return;e.preventDefault();if(!S.space){S.space=true;setCursor()}return}
    if(k==="Enter"){if(onCtl)return;if(S.chain.pts.length){e.preventDefault();endChain()}return}
    if(k==="Delete"||k==="Backspace"){if(S.sel){e.preventDefault();deleteSel()}return}
    if(k.startsWith("Arrow")){
      if(t.type==="range")return;
      e.preventDefault();const st=e.shiftKey?1:GRID;
      nudge(k==="ArrowLeft"?-st:k==="ArrowRight"?st:0,k==="ArrowUp"?-st:k==="ArrowDown"?st:0);return;
    }
    if(k==="+"||k==="="){zoomBy(1.25);return}
    if(k==="-"||k==="_"){zoomBy(1/1.25);return}
    if(k==="0"){fit();return}
    if(k==="["||k==="]"){e.preventDefault();cycleSel(k==="]"?1:-1);return}
    switch(kl){
      case"v":setTool("select");break;
      case"w":setTool("wall");break;
      case"g":setTool("glass");break;
      case"r":if(S.sel&&S.sel.kind==="desk")rotateDesk(e.shiftKey?1:-1);else setTool("room");break;
      case"t":setTool("zone");break;
      case"d":setTool("desk");break;
      case"x":setTool("erase");break;
      case"f":showFloor();break;
      default:return;
    }
    e.preventDefault();
  }
  // Esc: drag -> wall chain -> pending room / scale / facilities step -> tool back to Select -> selection.
  function escape(){
    if(S.drag){cancelDrag();return}
    if(S.chain.pts.length){endChain();return}
    if(S.pending||S.mode){exitMode();announce("Cancelled");return}
    if(S.tool!=="select"){setTool("select");return}
    if(S.sel)setSel(null);
  }

  /* ---------- dialogs ---------- */
  // dialog({title, body:[nodes], buttons:[{label,value,primary,danger,ref}]}) -> Promise<value|null>
  function dialog(o){
    return new Promise(res=>{
      const prev=doc.activeElement,id="ed-dlg-"+(++uid);
      const btns=(o.buttons||[{label:"OK",value:true,primary:true}]).map(b=>{const el=h("button",{class:(b.primary?"primary":"tb")+(b.danger?" ed-danger":""),type:"button",text:b.label,onclick:()=>done(b.value)});if(b.ref)b.ref(el);return el});
      const box=h("div",{class:"ed-dlg",role:"dialog","aria-modal":"true","aria-labelledby":id},h("h2",{id,text:o.title}),o.body||[],h("div",{class:"ed-dlg-acts"},btns));
      const wrap=h("div",{class:"ed-modal"},box);
      wrap.addEventListener("pointerdown",ev=>{if(ev.target===wrap)done(null)});
      root.append(wrap);
      const m={wrap,box,done};modal=m;
      function done(v){if(modal!==m)return;wrap.remove();modal=null;try{if(prev&&prev.focus&&doc.contains(prev))prev.focus({preventScroll:true})}catch(_){}res(v)}
      const first=btns.find(b=>b.classList.contains("primary"))||btns[0];
      later(()=>{if(modal===m)(o.focus||first).focus()},0);
    });
  }
  const para=(t,cls)=>h("p",{class:cls||null,text:t});
  async function issuesDialog(title,intro,items,saveAnyway){
    let show=null;
    const list=h("ul",{class:"ed-checks"},items.map(it=>h("li",null,h("span",{text:it.msg}),it.ref?h("button",{class:"tb",type:"button",text:"Show",onclick:()=>{show=it.ref;modal&&modal.done("show")}}):null)));
    const v=await dialog({title,body:[para(intro),list],buttons:saveAnyway?[{label:"Keep editing",value:false},{label:"Save anyway",value:true,primary:true}]:[{label:"OK",value:false,primary:true}]});
    return{ok:v===true,show:v==="show"?show:null};
  }

  // what changed and why, in the suggester's words (optional, up to 400 characters) -> the text, or null to keep editing
  async function noteDialog(){
    const ta=h("textarea",{class:"ed-notein",maxlength:"400","aria-label":"What did you change, and why?",placeholder:"For example: the kitchen moved to the east side, and the new phone booths are by the lifts."});
    const v=await dialog({title:"Send your suggestion",body:[para("The page's admins will see your changes and this note, and can apply them."),ta],
      buttons:[{label:"Keep editing",value:false},{label:"Send to the admins",value:true,primary:true}],focus:ta});
    return v===true?str(ta.value).trim().slice(0,400):null;
  }

  /* ---------- save / cancel / close ---------- */
  async function save(){
    if(S.saving||!S.alive||modal)return;
    if(S.drag)cancelDrag();
    endChain(true);
    const savedJs=json(),spec=finalize(S.spec,{key:S.spec.key});   // the state this save writes
    const v=validate(spec,{floors:opts.floors,model:S.model});
    if(v.errors.length){
      const r=await issuesDialog("Fix these before saving",`${plural(v.errors.length,"problem")} would break this floor for everyone:`,v.errors,false);
      if(r.show)showRef(r.show);return;
    }
    if(v.warnings.length){
      const key=JSON.stringify(v.warnings.map(w=>w.msg));
      if(key!==S.warnedKey){
        const r=await issuesDialog("Save with these warnings?","You can save now and fix these later:",v.warnings,true);
        if(r.show){showRef(r.show);return}
        if(!r.ok||!S.alive)return;
        S.warnedKey=key;
      }
    }
    // a suggestion: something must have changed, and it goes with a short note for the admins
    let extra;
    if(SUGGEST){
      if(json()===S.base){await dialog({title:"Nothing changed yet",body:[para("Move, add or remove something on the floor first, then send it.")]});return}
      const note=await noteDialog();if(note==null||!S.alive)return;
      extra={note};
    }
    if(typeof opts.onSave!=="function"){teardown();return}
    S.saving=true;updateTop();flash(SAVING_L,0);
    try{await opts.onSave(spec,extra)}
    catch(err){
      if(!S.alive)return;
      S.saving=false;updateTop();flash("");
      await dialog({title:SUGGEST?"Couldn't send":"Couldn't save",body:[para(msgOf(err)||"Something went wrong while saving."),para("Your changes are still here. Try again in a moment.","ed-note")]});
      return;
    }
    if(!S.alive)return;
    S.saving=false;S.base=savedJs;
    // edits made while the save was in flight aren't in it: stay open with them unsaved
    if(json()!==savedJs){S.dirty=true;updateTop();flash("Saved. Save again to keep the changes you made while saving.");return}
    S.dirty=false;teardown();
  }
  async function cancel(){
    if(S.saving||modal)return;
    if(S.drag)cancelDrag();
    if(!S.dirty){teardown();return}
    const ok=await dialog({title:"Discard your changes?",body:[para(`Your edits to ${title} haven't been ${SUGGEST?"sent":"saved"}.`)],buttons:[{label:"Keep editing",value:false},{label:"Discard changes",value:true,primary:true}]});
    if(ok)teardown();
  }
  function teardown(){
    if(!S.alive)return;
    if(modal)modal.done(null);
    S.alive=false;
    if(S.raf)win.cancelAnimationFrame(S.raf);
    if(S.buildTimer)clearTimeout(S.buildTimer);
    S.timers.forEach(id=>clearTimeout(id));S.timers.clear();
    offs.forEach(f=>{try{f()}catch(_){}});
    if(ro)ro.disconnect();if(mo)mo.disconnect();
    urls.forEach(u=>{try{URL.revokeObjectURL(u)}catch(_){}});
    root.remove();
    if(live===inst)live=null;
    try{if(prevFocus&&prevFocus.focus&&doc.contains(prevFocus))prevFocus.focus({preventScroll:true})}catch(_){}
    try{if(typeof opts.onClose==="function")opts.onClose()}catch(_){}
  }

  /* ---------- plan image ---------- */
  function loadPlanImage(asset,url){
    if(!asset||!url||images.has(asset))return;
    const rec={img:new Image(),ok:false,err:false};images.set(asset,rec);
    rec.img.decoding="async";
    rec.img.onload=()=>{rec.ok=true;invalidate()};
    rec.img.onerror=()=>{rec.err=true;invalidate();renderPanel(true)};
    rec.img.src=url;
  }
  function loadImg(url){return new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(new Error("The image couldn't be opened."));im.src=url})}
  function setBusy(t,err){S.busy=t||"";if(err!==undefined)S.planErr=err||"";renderPanel()}
  function pickFile(accept,cb){
    root.querySelectorAll("input[type=file]").forEach(x=>x.remove());
    const inp=h("input",{type:"file",accept,hidden:true,tabindex:"-1"});
    inp.addEventListener("change",()=>{const f=inp.files&&inp.files[0];inp.remove();if(f)cb(f)});
    root.append(inp);inp.click();
  }
  async function loadPlanFile(file){
    if(!S.alive)return;
    if(typeof opts.upload!=="function"){setBusy("","Only editors of this page can add plan images.");return}
    const isPdf=/pdf$/i.test(file.type)||/\.pdf$/i.test(file.name);
    const isImg=/^image\/(png|jpe?g|webp)$/i.test(file.type)||/\.(png|jpe?g|webp)$/i.test(file.name);
    if(!isPdf&&!isImg){setBusy("","That file isn't a PNG, JPG, WebP or PDF.");return}
    if(file.size>40e6){setBusy("","That file is over 40 MB. Export a smaller image of the plan and try again.");return}
    try{
      let blob=file;
      if(isPdf){
        if(typeof opts.renderPDF!=="function")throw new Error("PDF plans can't be read here. Save the plan as a PNG or JPG and load that instead.");
        setBusy("Reading the PDF…","");blob=await opts.renderPDF(file);
        if(!S.alive)return;   // closed while reading: don't upload
        if(!blob||!blob.size)throw new Error("The PDF didn't turn into an image.");
      }
      setBusy("Measuring the image…","");
      const local=URL.createObjectURL(blob);urls.push(local);
      // teardown already revoked urls: one made for a load that outlived the editor is revoked here
      const img=await loadImg(local).finally(()=>{if(!S.alive)try{URL.revokeObjectURL(local)}catch(_){}});
      if(!S.alive)return;
      setBusy("Uploading the plan…","");
      const res=await opts.upload(blob);
      if(!S.alive)return;
      if(!res||typeof res.asset!=="string"||!res.asset)throw new Error("The upload didn't return an image id.");
      images.set(res.asset,{img,ok:true,err:false});
      const old=S.spec.plan;
      edit(s=>{s.plan=planFit(img.naturalWidth,img.naturalHeight,s.w,s.d,res.asset,old?old.opacity:.55)});
      setBusy("","");fit();announce("Floor plan loaded");
      flash("Plan loaded. Use Set scale so its walls match real distances.",5000);
    }catch(err){if(S.alive)setBusy("","Couldn't load the plan: "+(msgOf(err)||"unknown error"))}
  }
  function startScale(){
    if(!S.spec.plan)return;
    setTool("select");S.sel=null;S.mode={t:"scale",p1:null,p2:null,real:"",unit:"ft"};
    if(small())setCollapsed(true);
    renderPanel();updateStatus();setCursor();invalidate();syncRail();
    announce(tapWord("Set scale: click the first end of a length you know"));
  }
  function scaleClick(x,z){
    const m=S.mode;
    if(!m.p1||m.p2){m.p1=[r3(x),r3(z)];m.p2=null}
    else m.p2=[r3(x),r3(z)];
    renderPanel();updateStatus();invalidate();
    if(m.p2){if(small())setCollapsed(false);later(()=>{const el=body.querySelector('[data-k="scale-real"]');if(el)el.focus()},0)}
  }
  function applyScale(){
    const m=S.mode;if(!m||m.t!=="scale")return;
    const np=planRescale(S.spec.plan,m.p1,m.p2,m.real,m.unit);
    if(!np){flash("Type the real length first (a number bigger than zero).");return}
    edit(s=>{s.plan=np});exitMode();fit();flash(`Plan rescaled to ${fmtM(np.w)} × ${fmtM(np.d)} m`);
  }
  function togglePlanMove(){
    if(S.mode&&S.mode.t==="planmove"){exitMode();return}
    setTool("select");S.sel=null;S.mode={t:"planmove"};renderPanel();updateStatus();setCursor();invalidate();syncRail();
    announce("Move plan: drag the image or use the arrow keys");
  }

  /* ---------- CAD import ---------- */
  async function importDXF(file){
    if(typeof opts.parseDXF!=="function"){flash("CAD import isn't available here.");return}
    if(file.size>60e6){flash("That drawing is over 60 MB, too big to import.");return}
    setBusy("Reading the drawing…","");
    let text="",dxf=null;
    try{text=await file.text();dxf=opts.parseDXF(text)}catch(_){dxf=null}
    setBusy("","");
    if(!S.alive)return;
    const layers=dxfLayers(dxf);
    if(!layers.length){
      await dialog({title:"No walls found",body:[para(str(dxf&&dxf.note)&&dxf.error?str(dxf.note):"That file has no lines we can turn into walls. Check that it's an ASCII DXF export of the floor plan (not a DWG or a PDF).")]});
      return;
    }
    const u=dxfUnit(dxf,S.spec.w);
    const st={on:new Set(layers.filter(l=>l.checked).map(l=>l.name)),unit:u.unit};
    let addBtn=null,replace=false;
    const factor=()=>st.unit==="file"?u.factor:UNITS[st.unit];
    const sizeEl=h("p",{class:"ed-stat","aria-live":"polite"});
    const upd=()=>{
      const r=dxfToWalls(dxf,st.on,factor()),n=r.walls.length+r.glass.length;
      sizeEl.textContent=n?`${plural(r.walls.length,"wall")} + ${r.glass.length} glass · drawing is ${fmtM(r.w)} × ${fmtM(r.d)} m (this floor: ${fmtM(S.spec.w)} × ${fmtM(S.spec.d)} m)${r.skipped?` · ${r.skipped} tiny pieces skipped`:""}${r.capped?` · only the first ${MAX_IMPORT} are added`:""}`:"Pick at least one layer.";
      if(addBtn){addBtn.textContent=n?`Add ${plural(Math.min(n,MAX_IMPORT),"wall")}`:"Add walls";addBtn.disabled=!n}
    };
    const uopts=Object.keys(UNITS).map(k=>[k,UNIT_NAMES[k]]);if(u.unit==="file")uopts.unshift(["file",u.label]);
    const unitSel=h("select",{class:"ed-in",id:"ed-dxf-unit"},uopts.map(([v,l])=>h("option",{value:v,text:l})));
    unitSel.value=st.unit;unitSel.addEventListener("change",()=>{st.unit=unitSel.value;upd()});
    const list=h("div",{class:"ed-layers",role:"group","aria-label":"Layers to import"},layers.map(l=>{
      const cb=h("input",{type:"checkbox",checked:st.on.has(l.name)});
      cb.addEventListener("change",()=>{if(cb.checked)st.on.add(l.name);else st.on.delete(l.name);upd()});
      return h("label",null,cb,h("span",{class:"n",text:l.name,title:l.name}),l.glass?h("span",{class:"ed-tag",text:"glass"}):null,h("span",{class:"c",text:String(l.count)}));
    }));
    const existing=S.spec.walls.length+S.spec.glass.length;
    let rep=null;
    if(existing){const c=h("input",{type:"checkbox"});c.addEventListener("change",()=>{replace=c.checked});rep=h("label",{class:"ed-check"},c,h("span",{text:`Replace the ${plural(existing,"wall")} already on this floor`}))}
    const pr=dialog({title:"Import CAD walls",body:[
      para(`${file.name} · ${plural(arr(dxf.segments).length,"line")} on ${plural(layers.length,"layer")}`,"ed-note"),
      h("div",{class:"ed-fld"},h("label",{for:"ed-dxf-unit",text:"Drawing units"}),unitSel,para(u.how==="file"?"Read from the drawing.":"The drawing doesn't say, so this is a guess. Check that the size below looks right.","ed-hint")),
      h("div",{class:"ed-fld"},h("span",{class:"ed-lab",text:"Layers to turn into walls"}),list,para("Layers named glazing or glass become glass partitions. Furniture and text layers are usually best left off.","ed-hint")),
      sizeEl,rep],
      buttons:[{label:"Cancel",value:null},{label:"Add walls",value:"add",primary:true,ref:el=>{addBtn=el}}]});
    upd();
    const v=await pr;
    if(v!=="add"||!S.alive)return;
    const r=dxfToWalls(dxf,st.on,factor());
    const w0=replace?0:S.spec.walls.length,g0=replace?0:S.spec.glass.length;
    edit(s=>{if(replace){s.walls=[];s.glass=[]}s.walls.push(...r.walls);s.glass.push(...r.glass)});
    fit();
    // the drawing arrives centered on its own outline: let them slide the whole batch onto the plan
    setTool("select");S.mode={t:"cadmove",w0,g0,nW:r.walls.length,nG:r.glass.length};
    if(small())setCollapsed(false);
    renderPanel();updateStatus();setCursor();invalidate();syncRail();
    flash(`Added ${plural(r.walls.length,"wall")} and ${r.glass.length} glass. Drag them to line up, then Done.`,5000);
  }
  // Move the walls/glass added by the last CAD import together (from = their positions when the drag began).
  function shiftBatch(s,m,from,dx,dz){
    for(const[k,i0,n]of[["walls",m.w0,m.nW],["glass",m.g0,m.nG]])
      for(let j=0;j<n;j++){const g=from?from[k][j]:s[k][i0+j];if(g&&s[k][i0+j])s[k][i0+j]=moveSeg(g,dx,dz,false)}
  }

  /* ---------- facilities desks ---------- */
  function startFacil(){
    const rows=facil.rows;if(!rows.length)return;
    const fp=farthestPair(rows)||[0,0];
    setTool("select");S.sel=null;
    S.mode={t:"facil",a:fp[0],b:fp[1],qa:null,qb:null,step:rows.length>1?"a":"done",unit:"ft",placed:null,byUnits:false,s:0,err:""};
    if(rows.length<2){S.mode.byUnits=true;S.mode.placed=unitPlace(rows,"ft")}
    renderPanel();updateStatus();setCursor();invalidate();syncRail();
    announce(hintText());
  }
  function facilClick(x,z){
    const m=S.mode;
    if(m.step==="a"){m.qa=[r3(x),r3(z)];m.step=m.qb?"done":"b"}
    else if(m.step==="b"){m.qb=[r3(x),r3(z)];m.step="done"}
    else return;
    if(m.qa&&m.qb)computeFacil();
    renderPanel();updateStatus();invalidate();announce(hintText());
  }
  function computeFacil(){
    const m=S.mode;m.err="";m.byUnits=false;
    if(m.a===m.b){m.placed=null;m.err="Pick two different desks.";return}
    const res=facilityPlace(facil.rows,m.a,m.b,m.qa,m.qb,opts.similarity);
    if(!res){m.placed=null;m.err="Those two desks are at the same spot in your file, or you clicked the same point twice. Pick two desks far apart.";return}
    m.placed=res.desks;m.s=res.s;
  }
  function placeFacil(){
    const m=S.mode;if(!m||!m.placed||!m.placed.length)return;
    const n=m.placed.length;
    edit(s=>{s.desks=mergeDesks(s.desks,m.placed)});
    exitMode();flash(`Placed ${plural(n,"desk")} from your facilities file`,4000);
  }

  /* ---------- panel ---------- */
  function fld(label,ctrl,hint){
    const isCtl=/^(INPUT|SELECT|TEXTAREA)$/.test(ctrl.tagName);
    if(isCtl&&!ctrl.id)ctrl.id="ed-i"+(++uid);
    return h("div",{class:"ed-fld"},isCtl?h("label",{for:ctrl.id,text:label}):h("span",{class:"ed-lab",text:label}),ctrl,hint?h("p",{class:"ed-hint",text:hint}):null);
  }
  function sec(t,...kids){return h("section",{class:"ed-sec"},t?h("h3",{text:t}):null,...kids)}
  const row=(...kids)=>h("div",{class:"ed-row"},...kids);
  const grid2=(...kids)=>h("div",{class:"ed-grid2"},...kids);
  const note=(t,cls)=>h("p",{class:"ed-note"+(cls?" "+cls:""),text:t});
  function btn(label,fn,o){
    o=o||{};
    return h("button",{class:(o.primary?"primary":"tb")+(o.danger?" ed-danger":""),type:"button",onclick:fn,title:o.title,"aria-label":o.aria,
      "aria-pressed":o.pressed==null?null:String(!!o.pressed),disabled:o.disabled?true:null,"data-k":o.k,text:label});
  }
  function bindText(el,get){binders.push(()=>{const v=get();if(el.textContent!==v)el.textContent=v});return el}
  function numIn(k,get,set,o){
    o=o||{};
    const show=()=>{const v=get();return isNum(v)?String(r3(v)):""};
    const el=h("input",{class:"ed-in ed-num",type:"number",inputmode:"decimal",step:o.step||".25",min:o.min,max:o.max,value:show(),"data-k":k});
    el.addEventListener("change",()=>{
      const raw=el.value.trim();
      if(raw===""&&o.empty){set(null);return}
      const v=num(raw,NaN);if(!isNum(v)){el.value=show();return}
      set(clamp(v,o.min==null?-1e5:+o.min,o.max==null?1e5:+o.max));el.value=show();
    });
    binders.push(()=>{if(doc.activeElement!==el){const v=show();if(el.value!==v)el.value=v}});
    return el;
  }
  function txtIn(k,get,set,o){
    o=o||{};
    const el=h("input",{class:"ed-in",type:"text",value:get()||"",placeholder:o.ph,maxlength:String(o.max||80),autocomplete:"off",spellcheck:"false",list:o.list,"data-k":k,"aria-describedby":o.desc});
    el.addEventListener("input",()=>set(el.value,true));
    el.addEventListener("change",()=>{hist.breakCoalesce();set(el.value,false)});
    binders.push(()=>{if(doc.activeElement!==el){const v=get()||"";if(el.value!==v)el.value=v}});
    return el;
  }
  function pickIn(k,options,get,set){
    const el=h("select",{class:"ed-in","data-k":k},options.map(([v,l])=>h("option",{value:v,text:l})));
    el.value=get();
    el.addEventListener("change",()=>set(el.value));
    binders.push(()=>{if(doc.activeElement!==el&&el.value!==get())el.value=get()});
    return el;
  }
  function segIn(k,label,options,get,set){
    const wrap=h("div",{class:"ed-seg",role:"group","aria-label":label});
    const bs=options.map(([v,l],j)=>{const b=h("button",{class:"tb",type:"button",text:l,"data-k":k+"-"+j,onclick:()=>{set(v);upd()}});b._v=v;return b});
    wrap.append(...bs);
    function upd(){const c=get();bs.forEach(b=>b.setAttribute("aria-pressed",String(b._v===c)))}
    upd();binders.push(upd);return wrap;
  }
  function head(kick,titleFn){S.titleFn=titleFn;const t=h("h2");bindText(t,titleFn);return h("div",null,h("div",{class:"ed-kick",text:kick}),t)}
  function sizeFields(kind,i,listKey){
    const o=()=>S.spec[listKey][i]||{},set=fn=>edit(s=>{const q=s[listKey][i];if(q)fn(q)});
    return sec("Size & position",grid2(
      fld("Width (m)",numIn(kind+"-w",()=>o().w,v=>set(q=>{q.w=v}),{min:MIN_SIZE,max:MAX_PLATE})),
      fld("Depth (m)",numIn(kind+"-d",()=>o().d,v=>set(q=>{q.d=v}),{min:MIN_SIZE,max:MAX_PLATE})),
      fld("Center x (m)",numIn(kind+"-x",()=>o().x,v=>set(q=>{q.x=v}))),
      fld("Center z (m)",numIn(kind+"-z",()=>o().z,v=>set(q=>{q.z=v})))),
      note("x runs west to east, z runs north to south, from the middle of the floor."));
  }
  const actions=()=>row(btn("Duplicate",()=>duplicate(),{k:"dup",title:"Duplicate (Ctrl+D)"}),btn("Delete",()=>deleteSel(),{k:"del",danger:true,title:"Delete (Del)"}));

  function panelSig(){
    const m=S.mode,o=item();
    return JSON.stringify([S.tool,S.sel&&S.sel.kind,S.sel&&S.sel.i,m&&m.t,m&&m.step,m&&!!m.placed,m&&m.byUnits,m&&m.err,m&&!!m.p1,m&&!!m.p2,
      S.pending&&S.pending.k,S.chain.pts.length>0,S.busy,S.planErr,S.spec.plan&&S.spec.plan.asset,S.spec.door&&S.spec.door.side,
      S.sel&&S.sel.kind==="room"&&o&&o.type,S.sel&&S.sel.kind==="zone"&&o&&o.team,!!S.model,S.newTeam,S.nextTeam]);
  }
  function renderPanel(force){
    if(!S.alive)return;
    if(!S.sel||S.sel.kind!=="zone")S.newTeam=false;   // "New team…" belongs to the selected team area only
    const sig=panelSig();
    if(!force&&sig===S.psig){refreshPanel();return}
    S.psig=sig;
    const ae=doc.activeElement,fk=ae&&body.contains(ae)&&ae.dataset?ae.dataset.k:null;
    binders=[];S.titleFn=null;
    let kids=[];
    try{kids=buildPanel()}catch(err){kids=[note("This panel couldn't be shown: "+msgOf(err),"ed-warn")]}
    body.replaceChildren(...kids.filter(Boolean));
    if(fk){const el=[...body.querySelectorAll("[data-k]")].find(x=>x.dataset.k===fk);if(el)el.focus({preventScroll:true})}   // no selector: keys can hold team names
    refreshPanel();syncRail();
  }
  function refreshPanel(){
    if(!S.alive)return;
    for(const f of binders){try{f()}catch(_){}}
    sheetTitle.textContent=S.titleFn?S.titleFn():"Properties";
  }
  function buildPanel(){
    const m=S.mode;
    if(m&&m.t==="facil")return panelFacil();
    if(m&&m.t==="scale")return panelScale();
    if(m&&m.t==="cadmove")return[head("CAD drawing",()=>"Line up the new walls"),
      note(tapWord(`The ${plural(m.nW+m.nG,"imported wall")} are highlighted. Drag anywhere on the floor to slide them all onto the plan, or use the arrow keys (Shift moves 1 m).`)),
      note(S.spec.plan?"Tip: zoom in on a corner of the building to line it up exactly.":"No plan image? Line them up with the floor's outside walls instead."),
      row(btn("Done",()=>{exitMode();announce("Walls placed")},{primary:true,k:"cad-done"}),btn("Undo import",()=>undo(),{k:"cad-undo"}))];
    if(S.sel&&item()){const k=S.sel.kind;return k==="room"?panelRoom():k==="zone"?panelZone():k==="desk"?panelDesk():panelSeg()}
    if(S.tool==="room")return panelRoomTool();
    if(S.tool==="zone")return panelZoneTool();
    if(S.tool==="desk")return panelDeskTool();
    if(S.tool==="wall"||S.tool==="glass")return panelWallTool();
    if(S.tool==="erase")return[head("Tool",()=>"Erase"),note(tapWord("Click a wall, room, team area or desk to delete it. Undo (Ctrl+Z) brings it back."))];
    return panelFloor();
  }
  function panelRoom(){
    const i=S.sel.i,r=()=>S.spec.rooms[i]||{},set=(fn,key)=>edit(s=>{const o=s.rooms[i];if(o)fn(o)},key);
    const type=r().type;
    const kids=[head("Room",()=>r().name||ROOM_NAME[r().type]||"Room"),
      fld("Type",pickIn("room-type",ROOM_TYPES,()=>r().type,v=>{
        set(o=>{
          o.type=v;
          if(v==="office"&&/^r\d+$/.test(o.id))o.id=nextDeskId(S.spec);
          if(v==="elevator"&&!/^e\d+$/.test(o.id))o.id=nextId("e",S.spec.rooms);
          if(v==="elevator"&&!o.door)o.door="s";
          if(v!=="conf")delete o.seats;
        });
        renderPanel(true);
      })),
      fld("Name",txtIn("room-name",()=>r().name,(v,lv)=>set(o=>{o.name=lv?v:str(v)},lv?"room-name:"+i:null),{ph:ROOM_NAME[type]}),"Shown on the sign over the door."),
      fld(type==="elevator"?"Doors face":"Door",segIn("room-door","Door side",[["n","North"],["s","South"],["e","East"],["w","West"]].concat(type==="elevator"?[]:[["none","None"]]),
        ()=>r().door||"none",v=>set(o=>{o.door=v==="none"?null:v})),
        type==="elevator"?"Cars ride by stopping on the pad in front of these doors.":"None makes it a solid block nobody can drive into.")];
    if(type==="conf")kids.push(fld("Seats",numIn("room-seats",()=>r().seats,v=>set(o=>{if(v==null)delete o.seats;else o.seats=Math.round(v)}),{min:1,max:80,step:"1",empty:true}),"Leave empty to fit the table to the room."));
    if(type==="office"){
      const err=h("p",{class:"ed-hint ed-warn",id:"ed-office-err"});
      binders.push(()=>{const id=str(r().id).toLowerCase();const dup=!!id&&(S.spec.desks.some(d=>str(d.id).toLowerCase()===id)||S.spec.rooms.some((o,j)=>j!==i&&str(o.id).toLowerCase()===id));err.textContent=!id?"The office needs a desk id.":dup?"Another desk or room already uses this id.":"";err.hidden=!err.textContent});
      kids.push(fld("Desk id",txtIn("room-id",()=>r().id,(v,lv)=>set(o=>{o.id=lv?v:str(v)},lv?"room-id:"+i:null),{list:"ed-dl-desks",desc:"ed-office-err"}),"The person whose desk number matches sits in this office."),err,deskIdList());
      kids.push(bindText(h("p",{class:"ed-stat"}),()=>whoSits(r().id)));
    }
    if(type==="elevator")kids.push(fld("Elevator id",txtIn("room-id",()=>r().id,(v,lv)=>set(o=>{o.id=lv?v:str(v)},lv?"room-id:"+i:null)),"Use the same id, in the same spot, on every floor of this building so rides line up."));
    if(type==="lab")kids.push(note("A lab is just the room. Draw a team area inside it with Lab benches to fill it."));
    kids.push(sizeFields("room",i,"rooms"),actions());
    return kids;
  }
  function whoSits(id){
    if(!S.model)return"";
    const k=str(id).toLowerCase(),d=arr(S.model.desks).find(x=>x&&str(x.id).toLowerCase()===k);
    if(!d)return"Not in the preview yet.";
    const p=isNum(d.person)&&d.person>=0?arr(S.model.people)[d.person]:null;
    return p?`${p.name}${p.team?" · "+p.team:""}`:"Open desk · nobody sits here yet";
  }
  function deskIdList(){
    const have=new Set(S.spec.desks.map(d=>str(d.id).toLowerCase()));S.spec.rooms.forEach(r=>{if(r.type==="office")have.add(str(r.id).toLowerCase())});
    const opts2=[];const seen=new Set();
    for(const r of roster){const k=r.desk.toLowerCase();if(!k||have.has(k)||seen.has(k))continue;seen.add(k);opts2.push(h("option",{value:r.desk,text:r.name}));if(opts2.length>=300)break}
    return h("datalist",{id:"ed-dl-desks"},opts2);
  }
  function panelZone(){
    const i=S.sel.i,z=()=>S.spec.zones[i]||{},set=(fn,key)=>edit(s=>{const o=s.zones[i];if(o)fn(o)},key);
    const names=teamNames(teams,roster,S.spec),cur=z().team;
    const topt=[];if(!cur)topt.push(["","Pick a team…"]);names.forEach(n=>topt.push([n,n]));topt.push(["__new__","New team…"]);
    const kids=[head("Team area",()=>z().team||"Team area"),
      fld("Team",pickIn("zone-team",topt,()=>S.newTeam?"__new__":z().team,v=>{
        if(v==="__new__"){S.newTeam=true;renderPanel();later(()=>{const el=body.querySelector('[data-k="zone-newteam"]');if(el)el.focus()},0);return}
        S.newTeam=false;set(o=>{o.team=v});renderPanel();
      }))];
    if(S.newTeam)kids.push(fld("New team name",txtIn("zone-newteam",()=>"",(v,lv)=>{if(lv)return;const t=str(v);if(!t)return;S.newTeam=false;set(o=>{o.team=t});renderPanel()},{ph:"Exactly as in your people file"}),"Press Enter when done."));
    kids.push(
      fld("Arrangement",pickIn("zone-arr",[["","Team default · "+ARR_NAMES[teamArr(teams,cur)]]].concat(ARR.map(a=>[a,ARR_NAMES[a]])),()=>z().arr||"",v=>set(o=>{o.arr=v||null}))),
      fld("Rows run",segIn("zone-dir","Rows run",[["h","East – west"],["v","North – south"]],()=>z().dir||"h",v=>set(o=>{o.dir=v}))),
      bindText(h("p",{class:"ed-stat"}),()=>{const c=zoneCounts(S.model,S.spec,i,roster);return S.model?`${plural(c.desks,"desk")} · ${plural(c.people,"person","people")} on this team`:`${plural(c.people,"person","people")} on this team`}),
      bindText(h("p",{class:"ed-hint ed-warn"}),()=>{if(!S.model)return"";const c=zoneCounts(S.model,S.spec,i,roster);return c.people>c.desks?`${c.people-c.desks} short if the whole team sits here. Make the area bigger or add another one.`:""}),
      sizeFields("zone",i,"zones"),actions());
    return kids;
  }
  function panelDesk(){
    const i=S.sel.i,d=()=>S.spec.desks[i]||{},set=(fn,key)=>edit(s=>{const o=s.desks[i];if(o)fn(o)},key);
    const err=h("p",{class:"ed-hint ed-warn",id:"ed-desk-err"});
    binders.push(()=>{const id=str(d().id).toLowerCase();const dup=!!id&&(S.spec.desks.some((o,j)=>j!==i&&str(o.id).toLowerCase()===id)||S.spec.rooms.some(r=>r.type==="office"&&str(r.id).toLowerCase()===id));err.textContent=!id?"Every desk needs an id.":dup?"Another desk already uses this id.":"";err.hidden=!err.textContent});
    const names=teamNames(teams,roster,S.spec);
    return[head("Desk",()=>"Desk "+(d().id||"(no id)")),
      fld("Desk id",txtIn("desk-id",()=>d().id,(v,lv)=>set(o=>{o.id=lv?v:str(v)},lv?"desk-id:"+i:null),{list:"ed-dl-desks",desc:"ed-desk-err"}),"The desk number from your seating chart. The person with this number sits here."),
      err,deskIdList(),
      bindText(h("p",{class:"ed-stat"}),()=>whoSits(d().id)),
      fld("Facing",h("div",{class:"ed-row"},btn("↺ Turn left",()=>rotateDesk(1),{k:"desk-left"}),btn("Turn right ↻",()=>rotateDesk(-1),{k:"desk-right",title:"Turn right (R)"}),
        bindText(h("span",{class:"ed-note"}),()=>"Faces "+facingName(d().a)))),
      fld("Arrangement",pickIn("desk-arr",[["","Automatic"]].concat(ARR.map(a=>[a,ARR_NAMES[a]])),()=>d().arr||"",v=>set(o=>{if(v)o.arr=v;else delete o.arr}))),
      fld("Team",pickIn("desk-team",[["","From the person who sits here"]].concat(names.map(n=>[n,n])),()=>d().team||"",v=>set(o=>{if(v)o.team=v;else delete o.team}))),
      sec("Position",grid2(fld("x (m)",numIn("desk-x",()=>d().x,v=>set(o=>{o.x=v}))),fld("z (m)",numIn("desk-z",()=>d().z,v=>set(o=>{o.z=v}))))),
      actions()];
  }
  function panelSeg(){
    const k=S.sel.kind,key=KINDS[k],i=S.sel.i,g=()=>S.spec[key][i]||[0,0,0,0];
    const set=(j,v)=>edit(s=>{const q=s[key][i];if(q)q[j]=v});
    return[head(k==="glass"?"Glass partition":"Wall",()=>`${k==="glass"?"Glass":"Wall"} · ${fmtM(segLen(g()))} m`),
      fld("Kind",segIn("seg-kind","Kind",[["wall","Wall"],["glass","Glass"]],()=>k,v=>{
        if(v===k)return;const dst=KINDS[v];let ni=-1;
        S.sel=null;edit(s=>{const seg=s[key].splice(i,1)[0];if(seg){s[dst].push(seg);ni=s[dst].length-1}});
        if(ni>=0)setSel({kind:v,i:ni});
      })),
      sec("Ends",grid2(
        fld("Start x",numIn("seg-x1",()=>g()[0],v=>set(0,v))),fld("Start z",numIn("seg-z1",()=>g()[1],v=>set(1,v))),
        fld("End x",numIn("seg-x2",()=>g()[2],v=>set(2,v))),fld("End z",numIn("seg-z2",()=>g()[3],v=>set(3,v)))),
        note("Drag the round handles on the floor to move an end.")),
      row(btn("Duplicate",()=>duplicate(),{k:"dup"}),btn("Delete",()=>deleteSel(),{k:"del",danger:true}))];
  }
  function panelRoomTool(){
    return[head("Tool",()=>"Rooms"),
      note(tapWord("Drag a rectangle on the floor to draw a room, then pick its type and name here.")),
      sec("Ready-made rooms",note(tapWord("Pick one, then click the floor where it goes. Shift-click places several.")),
        h("div",{class:"ed-presets"},PRESETS.map(p=>{const b=btn("",ev=>choosePreset(p,ev),{pressed:!!(S.pending&&S.pending.k===p.k),k:"preset-"+p.k});b.append(h("b",{text:p.label}),h("span",{text:`${fmtM(p.w)}×${fmtM(p.d)}`}));return b}))),
      note("Restrooms and stairs are solid blocks. Elevators need the same spot on every floor.")];
  }
  function panelZoneTool(){
    const names=teamNames(teams,roster,S.spec),have=new Set(S.spec.zones.map(z=>str(z.team).toLowerCase()));
    const missing=[...headcounts(roster)].filter(([k])=>!have.has(k)).sort((a,b)=>b[1]-a[1]);
    const nameOf=k=>{const r=roster.find(r=>r.team.toLowerCase()===k);return r?r.team:k};
    return[head("Tool",()=>"Team areas"),
      note(tapWord("Drag a rectangle where a team sits. Desks fill in on their own, using the team's arrangement (offices for finance, lab benches for a lab, and so on).")),
      fld("Team for the next area",pickIn("next-team",[["","Most people without an area"]].concat(names.map(n=>[n,n])),()=>S.nextTeam||"",v=>{S.nextTeam=v||null;renderPanel()})),
      missing.length?sec("Teams without an area yet",h("div",{class:"ed-chips"},missing.slice(0,24).map(([k,n])=>btn(`${nameOf(k)} · ${n}`,()=>{S.nextTeam=nameOf(k);renderPanel();announce("Next area: "+nameOf(k))},{pressed:!!S.nextTeam&&S.nextTeam.toLowerCase()===k,k:"miss-"+k})))):note("Every team on this floor has an area.")];
  }
  function panelDeskTool(){
    const kids=[head("Tool",()=>"Desks"),
      note(tapWord("Click to place a desk where your facilities team has a numbered desk. Team areas fill with desks on their own.")),
      bindText(h("p",{class:"ed-stat"}),()=>"Next desk id: "+nextDeskId(S.spec)),
      fld("New desks face",segIn("desk-face","New desks face",[[0,"North"],[-HALF,"East"],[PI,"South"],[HALF,"West"]],()=>S.deskA,v=>{S.deskA=v}))];
    if(facil.rows.length)kids.push(btn(`Place ${plural(facil.rows.length,"desk")} from your facilities file…`,startFacil,{k:"facil"}));
    return kids;
  }
  function panelWallTool(){
    const g=S.tool==="glass";
    return[head("Tool",()=>g?"Glass partitions":"Walls"),
      note(tapWord(`Click to start a ${g?"glass partition":"wall"}, then click each corner. Enter, double-click or Esc finishes.`)),
      S.chain.pts.length?btn("Finish this "+(g?"partition":"wall"),()=>endChain(),{primary:true,k:"finish"}):null,
      note("Snaps to the 0.25 m grid, to wall ends within 0.4 m, and to 45° angles. Hold Shift for any angle, Alt to turn snapping off."),
      S.spec.plan?note("Tracing a plan? Turn its opacity up under Floor › Floor plan image."):null];
  }
  function panelFloor(){
    const sp=S.spec,p=sp.plan,rec=p&&images.get(p.asset),busy=!!S.busy;
    const kids=[head("Floor",()=>title),bindText(h("p",{class:"ed-stat"}),()=>`${fmtM(S.spec.w)} × ${fmtM(S.spec.d)} m · ${plural(S.spec.rooms.length,"room")} · ${plural(S.spec.walls.length+S.spec.glass.length,"wall")}`)];
    kids.push(sec("Floor plate",grid2(
      fld("Width (m)",numIn("floor-w",()=>S.spec.w,v=>edit(s=>{s.w=r3(v)}),{min:MIN_PLATE,max:MAX_PLATE,step:"1"})),
      fld("Depth (m)",numIn("floor-d",()=>S.spec.d,v=>edit(s=>{s.d=r3(v)}),{min:MIN_PLATE,max:MAX_PLATE,step:"1"}))),
      note("The outside walls follow this rectangle.")));
    if(sp.f===1||sp.door||sp.f==null){
      const d=()=>S.spec.door;
      kids.push(sec("Doorway to outside",
        segIn("floor-door","Doorway side",[["none","None"],["n","N"],["s","S"],["e","E"],["w","W"]],()=>d()?d().side:"none",v=>{edit(s=>{s.door=v==="none"?null:{side:v,at:s.door?s.door.at:0,w:s.door?s.door.w:3}});renderPanel()}),
        d()?grid2(fld("Offset from middle (m)",numIn("door-at",()=>d()&&d().at,v=>edit(s=>{if(s.door)s.door.at=v}))),fld("Width (m)",numIn("door-w",()=>d()&&d().w,v=>edit(s=>{if(s.door)s.door.w=v}),{min:1,max:12}))):null,
        note("Floor 1 only: where cars drive out to the campus.")));
    }
    const plan=[];
    if(typeof opts.upload!=="function")plan.push(note("Only editors of this page can add plan images."));
    else plan.push(btn(p?"Replace floor plan…":"Load floor plan…",()=>pickFile(PLAN_ACCEPT,loadPlanFile),{primary:!p,disabled:busy,k:"plan-load"}));
    if(S.busy)plan.push(note(S.busy));
    if(S.planErr)plan.push(note(S.planErr,"ed-warn"));
    if(!p&&typeof opts.upload==="function")plan.push(note("PNG, JPG, WebP or PDF, with north at the top. It sits under your drawing so you can trace walls and rooms."));
    if(p){
      const rg=h("input",{type:"range",min:"0.1",max:"1",step:"0.05",value:String(p.opacity),"data-k":"plan-op",id:"ed-plan-op"});
      rg.addEventListener("input",()=>edit(s=>{if(s.plan)s.plan.opacity=clamp(+rg.value,.05,1)},"plan-opacity"));
      rg.addEventListener("change",()=>hist.breakCoalesce());
      binders.push(()=>{if(doc.activeElement!==rg&&S.spec.plan)rg.value=String(S.spec.plan.opacity)});
      if(rec&&rec.err)plan.push(note("The plan image couldn't be loaded right now.","ed-warn"));
      else if(!rec)plan.push(note("The plan image isn't available on this device."));
      plan.push(fld("Opacity",rg),
        row(btn("Move plan",togglePlanMove,{pressed:!!(S.mode&&S.mode.t==="planmove"),k:"plan-move"}),btn("Set scale…",startScale,{k:"plan-scale"})),
        row(btn("Match floor to plan",()=>{edit(s=>{matchFloorToPlan(s)});fit();flash(`Floor is now ${fmtM(S.spec.w)} × ${fmtM(S.spec.d)} m`)},{k:"plan-match"}),
          btn("Remove plan",()=>{if(S.mode&&S.mode.t==="planmove")S.mode=null;edit(s=>{s.plan=null});announce("Plan removed")},{k:"plan-remove",danger:true})),
        bindText(h("p",{class:"ed-stat"}),()=>S.spec.plan?`Plan is ${fmtM(S.spec.plan.w)} × ${fmtM(S.spec.plan.d)} m`:""));
    }
    kids.push(sec("Floor plan image",...plan));
    kids.push(sec("CAD drawing",typeof opts.parseDXF==="function"?btn("Import CAD walls (DXF)…",()=>pickFile(".dxf,application/dxf,image/vnd.dxf",importDXF),{k:"cad",disabled:busy}):note("CAD import isn't available here."),
      note("Turns the wall and glass layers of an architect's DXF export into walls.")));
    if(facil.rows.length)kids.push(sec("Facilities desks",btn(`Place ${plural(facil.rows.length,"desk")} from your facilities file…`,startFacil,{k:"facil"}),
      note("Your people file has x,y positions for these desks. Line them up by clicking two of them on the plan.")));
    // live checks
    const checks=h("ul",{class:"ed-checks"});let lastChecks="";
    binders.push(()=>{
      const v=validate(S.spec,{floors:opts.floors,model:S.model}),all=v.errors.map(x=>Object.assign({err:1},x)).concat(v.warnings),key=JSON.stringify(all.map(x=>x.msg));
      if(key===lastChecks)return;lastChecks=key;
      checks.replaceChildren(...(all.length?all.slice(0,8).map(x=>h("li",null,h("span",{class:x.err?"ed-warn":null,text:(x.err?"Must fix: ":"")+x.msg}),x.ref?h("button",{class:"tb",type:"button",text:"Show",onclick:()=>showRef(x.ref)}):null)):[h("li",null,h("span",{class:"ed-note",text:"Everything looks good."}))]));
    });
    kids.push(sec("Checks",checks));
    kids.push(sec("People on this floor",bindText(h("p",{class:"ed-stat"}),()=>{
      if(S.modelErr)return"Preview unavailable: "+S.modelErr;
      const st=S.model&&S.model.stats;if(!st)return`${plural(nPeople,"person","people")}`;
      const un=arr(S.model.unplaced);
      return`${plural(nPeople,"person","people")} · ${plural(num(st.desks,0),"desk")} · ${num(st.open,0)} open${un.length?` · ${un.length} without a desk: ${un.slice(0,4).map(u=>u&&u.name).filter(Boolean).join(", ")}${un.length>4?"…":""}`:""}`;
    })));
    kids.push(h("p",{class:"ed-keys",text:"V select · W wall · G glass · R room · T team area · D desk · X erase · F floor · Ctrl+Z undo · Space+drag or middle-drag pans · 0 fits"}));
    if(N.dropped)kids.push(note(`${plural(N.dropped,"item")} in the saved floor couldn't be read and ${N.dropped===1?"was":"were"} left out.`,"ed-warn"));
    return kids;
  }
  function panelScale(){
    const m=S.mode;
    const real=h("input",{class:"ed-in ed-num",type:"number",inputmode:"decimal",min:"0",step:"any",value:m.real,"data-k":"scale-real",placeholder:"e.g. 30"});
    real.addEventListener("input",()=>{m.real=real.value});   // Enter is handled in onKey
    return[head("Plan",()=>"Set the plan's scale"),
      note(tapWord("Click both ends of something on the plan whose real length you know: a long wall, a dimension line or the column grid.")),
      h("p",{class:"ed-step",text:tapWord(!m.p1?"1. Click the first end":!m.p2?"2. Click the other end":"3. Type the real length")}),
      m.p1&&m.p2?bindText(h("p",{class:"ed-stat"}),()=>m.p1&&m.p2?`Measures ${fmtM(hyp(m.p2[0]-m.p1[0],m.p2[1]-m.p1[1]))} m on the plan right now`:""):null,
      m.p1&&m.p2?grid2(fld("Real length",real),fld("Units",segIn("scale-unit","Units",[["ft","Feet"],["m","Meters"]],()=>m.unit,v=>{m.unit=v}))):null,
      row(m.p1&&m.p2?btn("Apply",applyScale,{primary:true,k:"scale-apply"}):null,m.p1?btn("Start over",()=>{m.p1=m.p2=null;renderPanel();updateStatus();invalidate()},{k:"scale-redo"}):null,btn("Cancel",()=>exitMode(),{k:"scale-cancel"})),
      note("Only the plan image changes size. Walls and rooms you've drawn stay put.")];
  }
  function panelFacil(){
    const m=S.mode,rows=facil.rows,hasPlan=!!S.spec.plan;
    const optList=rows.map((r,i)=>[String(i),r.desk+(r.name?" · "+r.name:"")]);
    const pickRow=(k,lab)=>fld(lab,pickIn("facil-"+k,optList,()=>String(m[k]),v=>{m[k]=+v;m.qa=null;m.qb=null;m.step="a";m.placed=null;m.byUnits=false;m.err="";renderPanel();updateStatus();invalidate()}));
    const kids=[head("Facilities",()=>"Place desks from your facilities file"),
      note(`${plural(rows.length,"desk")} in your people file ${rows.length===1?"has an":"have"} x,y position${rows.length===1?"":"s"}${facil.dupes?` (${facil.dupes} repeated desk ids skipped)`:""}.`)];
    if(rows.length>1){
      kids.push(note(tapWord(`Pick two desks you can find on the ${hasPlan?"plan":"floor"}, far apart, then click where each one is.`)),pickRow("a","Desk A"),pickRow("b","Desk B"),
        h("p",{class:"ed-step",text:tapWord(m.step==="a"?"Click desk A on the plan":m.step==="b"?"Now click desk B":m.byUnits?"Placed by units, centered on the floor":"Both desks clicked. Check the dots.")}),
        row(m.qa?btn("Click A again",()=>{m.step="a";renderPanel();updateStatus()},{k:"facil-ra"}):null,m.qb?btn("Click B again",()=>{m.step="b";renderPanel();updateStatus()},{k:"facil-rb"}):null));
    }
    if(m.err)kids.push(note(m.err,"ed-warn"));
    if(!hasPlan||rows.length<2)kids.push(sec("No plan image?",note("Place them using their own units instead, centered on the floor."),
      fld("Your file's x,y are in",segIn("facil-unit","Units",[["ft","Feet"],["m","Meters"]],()=>m.unit,v=>{m.unit=v;if(m.byUnits){m.placed=unitPlace(rows,v);invalidate();refreshPanel()}})),
      btn("Preview by units",()=>{m.placed=unitPlace(rows,m.unit);m.byUnits=true;m.step="done";m.qa=m.qb=null;m.err="";renderPanel();updateStatus();invalidate()},{k:"facil-units"})));
    if(m.placed){
      const out=countOutside(m.placed,S.spec),have=new Set(S.spec.desks.map(d=>str(d.id).toLowerCase())),moving=m.placed.filter(p=>have.has(str(p.id).toLowerCase())).length;
      const u=!m.byUnits&&m.s?unitFromScale(m.s):null;
      kids.push(h("p",{class:"ed-stat",text:`${plural(m.placed.length,"desk")}${out?` · ${out} land outside the floor`:""}${moving?` · ${moving} already here will move`:""}${u?` · your file looks like it's in ${UNIT_NAMES[u].toLowerCase()}`:""}`}));
      if(out)kids.push(note("Desks outside the floor won't show up. Check you clicked the right desks, or set the plan's scale first.","ed-warn"));
    }
    kids.push(row(btn("Place desks",placeFacil,{primary:true,disabled:!m.placed||!m.placed.length,k:"facil-place"}),btn("Cancel",()=>exitMode(),{k:"facil-cancel"})));
    return kids;
  }

  /* ---------- status line ---------- */
  function hintText(){
    const m=S.mode;let t;
    if(m&&m.t==="scale")t=!m.p1?"Click the first end of a length you know on the plan":!m.p2?"Click the other end":"Type the real length in the panel, then Apply";
    else if(m&&m.t==="facil"){const r=facil.rows;t=m.step==="a"?`Click where desk ${r[m.a]&&r[m.a].desk} is on the plan`:m.step==="b"?`Click where desk ${r[m.b]&&r[m.b].desk} is`:"Check the dots, then Place desks"}
    else if(m&&m.t==="cadmove")t="Drag anywhere to slide the imported walls into place · arrow keys nudge (Shift = 1 m) · Done or Esc when finished";
    else if(m&&m.t==="planmove")t="Drag the plan image to line it up · arrow keys nudge it · Esc when done";
    else if(S.pending)t=`Click where the ${S.pending.label.toLowerCase()} goes · Shift-click places more · Esc cancels`;
    else switch(S.tool){
      case"wall":case"glass":t=S.chain.pts.length?"Click the next corner · Enter, double-click or Esc finishes · Shift: any angle · Alt: no snap":`Click to start a ${S.tool==="glass"?"glass partition":"wall"}`;break;
      case"room":t="Drag a rectangle to draw a room, or pick a ready-made room in the panel";break;
      case"zone":t="Drag a rectangle where a team sits — desks fill in automatically";break;
      case"desk":t="Click to place a desk · R turns the selected desk";break;
      case"erase":t="Click anything to delete it · Ctrl+Z brings it back";break;
      default:t=S.sel?"Drag to move · corners resize · arrows nudge (Shift = 1 m) · Delete removes":"Click to select · drag empty space to pan · scroll or pinch to zoom";
    }
    return tapWord(t);
  }
  function updateStatus(){
    if(!S.alive)return;
    stXY.textContent=S.cursor?`x ${fmtM(S.cursor[0])} · z ${fmtM(S.cursor[1])} m`:"—";
    stZoom.textContent=Math.round(S.view.s/(S.fitS||1)*100)+"%";
    const t=hintText();if(stHint.textContent!==t)stHint.textContent=t;
  }

  /* ---------- drawing ---------- */
  function colors(){
    const cs=win.getComputedStyle(root),g=(n,d)=>(cs.getPropertyValue(n)||"").trim()||d;
    const ground=g("--ground","#EEF0EA"),dark=isDark(ground);
    return{ground,dark,ink:g("--ink",dark?"#EEF0F7":"#1F2421"),muted:g("--muted","#5D655F"),line:g("--line","rgba(31,36,33,.14)"),accent:g("--accent","#E4572E"),
      plate:g("--btn",dark?"rgba(255,255,255,.06)":"#fff"),display:g("--display","system-ui,sans-serif"),mono:g("--mono","ui-monospace,monospace"),
      glass:dark?"#6CB4FF":"#2F80D1",danger:dark?"#FF8A80":"#D23B3B",ramp:"#E8B43A",exit:dark?"#4CD08A":"#1F9D57",plant:dark?"#5FBF6A":"#4E9A57"};
  }
  function rotRect(x,z,w,d,a){
    const p=toS(x,z),s=S.view.s,c=Math.cos(a),n=Math.sin(a),hw=w*s/2,hd=d*s/2;
    const P=(lx,lz)=>[p[0]+lx*c+lz*n,p[1]-lx*n+lz*c];
    const q=[P(-hw,-hd),P(hw,-hd),P(hw,hd),P(-hw,hd)];
    ctx.moveTo(q[0][0],q[0][1]);for(let k=1;k<4;k++)ctx.lineTo(q[k][0],q[k][1]);ctx.closePath();
  }
  function segPath(list){for(const g of list){const a=toS(g[0],g[1]),b=toS(g[2],g[3]);ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1])}}
  function fitText(t,maxW){
    t=str(t);if(!t)return"";if(!maxW||ctx.measureText(t).width<=maxW)return t;
    if(maxW<14)return"";
    let lo=0,hi=t.length;while(lo<hi){const mid=(lo+hi+1)>>1;if(ctx.measureText(t.slice(0,mid)+"…").width<=maxW)lo=mid;else hi=mid-1}
    return lo>=2?t.slice(0,lo)+"…":"";
  }
  function drawLabels(C,labels){
    ctx.textBaseline="middle";ctx.lineJoin="round";
    for(const L of labels){
      ctx.font=L.font;const t=fitText(L.text,L.maxW);if(!t)continue;
      ctx.textAlign=L.align||"center";ctx.lineWidth=3;ctx.strokeStyle=C.ground;ctx.strokeText(t,L.x,L.y);ctx.fillStyle=L.color;ctx.fillText(t,L.x,L.y);
    }
  }
  function draw(){
    S.raf=0;
    if(!S.alive||S.W<2||S.H<2)return;
    const C=colors(),s=S.view.s,W=S.W,H=S.H,sp=S.spec;
    ctx.setTransform(S.dpr,0,0,S.dpr,0,0);ctx.globalAlpha=1;ctx.setLineDash([]);ctx.lineCap="butt";
    ctx.fillStyle=C.ground;ctx.fillRect(0,0,W,H);
    const v0=toW(0,0),v1=toW(W,H);
    const vis=(x0,z0,x1,z1)=>x1>=v0[0]&&x0<=v1[0]&&z1>=v0[1]&&z0<=v1[1];
    const hw=sp.w/2,hd=sp.d/2,P0=toS(-hw,-hd);
    ctx.fillStyle=C.plate;ctx.fillRect(P0[0],P0[1],sp.w*s,sp.d*s);
    // plan image
    if(sp.plan){
      const p=sp.plan,q=toS(p.x,p.z),rec=images.get(p.asset);
      if(rec&&rec.ok){ctx.globalAlpha=clamp(p.opacity,.05,1);try{ctx.drawImage(rec.img,q[0],q[1],p.w*s,p.d*s)}catch(_){}ctx.globalAlpha=1}
      else{ctx.setLineDash([4,4]);ctx.strokeStyle=C.muted;ctx.lineWidth=1;ctx.strokeRect(q[0],q[1],p.w*s,p.d*s);ctx.setLineDash([])}
    }
    // grid: 1 m minor (when it is at least 7 px apart), 5 m major, inside the plate
    {
      const x0=Math.max(-hw,v0[0]),x1=Math.min(hw,v1[0]),z0=Math.max(-hd,v0[1]),z1=Math.min(hd,v1[1]);
      if(x1>x0&&z1>z0){
        const lines=(step,skip)=>{ctx.beginPath();
          for(let x=Math.ceil(x0/step)*step;x<=x1;x+=step){if(skip&&Math.round(x)%skip===0)continue;const X=Math.round(toS(x,0)[0])+.5;ctx.moveTo(X,toS(0,z0)[1]);ctx.lineTo(X,toS(0,z1)[1])}
          for(let z=Math.ceil(z0/step)*step;z<=z1;z+=step){if(skip&&Math.round(z)%skip===0)continue;const Z=Math.round(toS(0,z)[1])+.5;ctx.moveTo(toS(x0,0)[0],Z);ctx.lineTo(toS(x1,0)[0],Z)}
          ctx.stroke()};
        ctx.strokeStyle=C.line;ctx.lineWidth=1;
        if(s>=7){ctx.globalAlpha=.55;lines(1,5);ctx.globalAlpha=1}
        if(s*5>=7){ctx.globalAlpha=1;lines(5,0)}
      }
    }
    const labels=[];
    // zones
    sp.zones.forEach(z=>{
      const r=rectOf(z);if(!vis(r.x0,r.z0,r.x1,r.z1))return;
      const col=tcol(z.team),a=toS(r.x0,r.z0),w=z.w*s,d=z.d*s;
      ctx.globalAlpha=.2;ctx.fillStyle=col;ctx.fillRect(a[0],a[1],w,d);ctx.globalAlpha=1;
      ctx.setLineDash([6,4]);ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.strokeRect(a[0]+.75,a[1]+.75,Math.max(0,w-1.5),Math.max(0,d-1.5));ctx.setLineDash([]);
      if(w>48&&d>26){
        labels.push({text:z.team||"No team yet",x:a[0]+6,y:a[1]+11,font:`700 12px ${C.display}`,color:C.ink,align:"left",maxW:w-12});
        if(d>44)labels.push({text:arrLabel(z),x:a[0]+6,y:a[1]+26,font:`500 11px ${C.display}`,color:C.muted,align:"left",maxW:w-12});
      }
    });
    drawModel(C,vis,labels);
    // rooms
    sp.rooms.forEach(r=>{
      const q=rectOf(r);if(!vis(q.x0,q.z0,q.x1,q.z1))return;
      const col=ROOM_COLOR[r.type]||C.muted,a=toS(q.x0,q.z0),w=r.w*s,d=r.d*s,solid=!r.door&&r.type!=="open";
      if(r.type!=="open"){ctx.globalAlpha=solid?.22:.07;ctx.fillStyle=col;ctx.fillRect(a[0],a[1],w,d);ctx.globalAlpha=1}
      ctx.beginPath();
      if(r.type==="elevator"){ctx.moveTo(a[0],a[1]);ctx.lineTo(a[0]+w,a[1]+d);ctx.moveTo(a[0]+w,a[1]);ctx.lineTo(a[0],a[1]+d)}
      if(r.type==="stairs"){const along=r.w>=r.d,n=Math.min(40,Math.floor((along?r.w:r.d)/.3));for(let k=1;k<n;k++){const f=k/n;if(along){ctx.moveTo(a[0]+w*f,a[1]);ctx.lineTo(a[0]+w*f,a[1]+d)}else{ctx.moveTo(a[0],a[1]+d*f);ctx.lineTo(a[0]+w,a[1]+d*f)}}}
      ctx.strokeStyle=col;ctx.globalAlpha=.55;ctx.lineWidth=1;ctx.stroke();ctx.globalAlpha=1;
      ctx.beginPath();segPath(roomOutline(r));
      ctx.strokeStyle=col;ctx.lineWidth=clamp(.12*s,1.5,5);if(r.type==="open")ctx.setLineDash([5,4]);ctx.stroke();ctx.setLineDash([]);
      if(r.type==="elevator"&&r.door){   // closed elevator doors: a thick 1 m bar in the middle of the door side
        const m={n:[r.x,q.z0],s:[r.x,q.z1],e:[q.x1,r.z],w:[q.x0,r.z]}[r.door],ax=r.door==="n"||r.door==="s",c=toS(m[0],m[1]);
        ctx.beginPath();ctx.moveTo(c[0]-(ax?.5*s:0),c[1]-(ax?0:.5*s));ctx.lineTo(c[0]+(ax?.5*s:0),c[1]+(ax?0:.5*s));ctx.lineWidth=clamp(.3*s,2.5,8);ctx.stroke();
      }
      if(w>30&&d>16){
        labels.push({text:r.name||ROOM_NAME[r.type],x:a[0]+w/2,y:a[1]+d/2-(d>40?6:0),font:`700 12px ${C.display}`,color:C.ink,maxW:w-6});
        if(d>40&&r.name)labels.push({text:(ROOM_NAME[r.type]||"").replace(/ \(.*\)$/,"")+(r.type==="office"?" · "+r.id:""),x:a[0]+w/2,y:a[1]+d/2+9,font:`500 10px ${C.mono}`,color:C.muted,maxW:w-6});
      }
    });
    // walls and glass
    ctx.lineCap="round";
    if(sp.walls.length){ctx.beginPath();segPath(sp.walls);ctx.strokeStyle=C.ink;ctx.lineWidth=Math.max(2,.15*s);ctx.stroke()}
    if(sp.glass.length){
      ctx.beginPath();segPath(sp.glass);ctx.strokeStyle=C.glass;const lw=Math.max(2,.1*s);ctx.lineWidth=lw;ctx.stroke();
      if(lw>=5){ctx.beginPath();segPath(sp.glass);ctx.strokeStyle=C.plate==="#fff"?"#fff":C.ground;ctx.lineWidth=lw*.35;ctx.stroke()}
    }
    ctx.lineCap="butt";
    // explicit desks: outline + facing tick (the model draws their fill)
    ctx.beginPath();
    for(const d of sp.desks){if(!vis(d.x-1,d.z-1,d.x+1,d.z+1))continue;rotRect(d.x,d.z,DESK_W,DESK_D,d.a)}
    ctx.strokeStyle=C.ink;ctx.lineWidth=1.5;ctx.stroke();
    if(s>=10){
      ctx.beginPath();
      for(const d of sp.desks){if(!vis(d.x-1,d.z-1,d.x+1,d.z+1))continue;const c=toS(d.x,d.z),fx=-Math.sin(d.a),fz=-Math.cos(d.a),L=DESK_D*.45*s;
        ctx.moveTo(c[0]+fx*L,c[1]+fz*L);ctx.lineTo(c[0]-fz*L*.45,c[1]+fx*L*.45);ctx.lineTo(c[0]+fz*L*.45,c[1]-fx*L*.45);ctx.closePath()}
      ctx.fillStyle=C.ink;ctx.fill();
    }
    // exterior shell
    ctx.beginPath();segPath(plateOutline(sp));ctx.strokeStyle=C.ink;ctx.lineWidth=Math.max(2.5,.3*s);ctx.lineCap="square";ctx.stroke();ctx.lineCap="butt";
    if(sp.door){
      const dr=sp.door,along=dr.side==="n"||dr.side==="s",L=along?sp.w:sp.d,gw=clamp(dr.w,.5,L),c=clamp(dr.at,-L/2+gw/2,L/2-gw/2);
      const pt=along?[c,dr.side==="n"?-hd-1.2:hd+1.2]:[dr.side==="w"?-hw-1.2:hw+1.2,c],q=toS(pt[0],pt[1]);
      labels.push({text:"Entrance",x:q[0],y:q[1],font:`700 11px ${C.display}`,color:C.exit});
    }
    drawLabels(C,labels);
    drawOverlay(C);
  }
  function drawModel(C,vis,labels){
    const m=S.model;if(!m)return;const s=S.view.s;
    // partitions (cubicle / office walls generated by the layout)
    const parts=arr(m.walls).filter(w=>w&&w.kind==="part"&&[w.x1,w.z1,w.x2,w.z2].every(isNum));
    if(parts.length){ctx.beginPath();segPath(parts.map(w=>[w.x1,w.z1,w.x2,w.z2]));ctx.strokeStyle=C.muted;ctx.globalAlpha=.6;ctx.lineWidth=Math.max(1,.06*s);ctx.stroke();ctx.globalAlpha=1}
    // furniture & equipment
    const rects=new Path2D(),rounds=new Path2D(),plants=new Path2D();
    for(const it of arr(m.items)){
      if(!it||!isNum(it.x)||!isNum(it.z)||it.t==="elevdoor")continue;
      const w=Math.max(.1,num(it.w,.5)),d=Math.max(.1,num(it.d,w)),r=Math.max(w,d);
      if(!vis(it.x-r,it.z-r,it.x+r,it.z+r))continue;
      const c=toS(it.x,it.z);
      if(it.t==="plant"){plants.moveTo(c[0]+w/2*s,c[1]);plants.arc(c[0],c[1],Math.max(1.5,w/2*s),0,2*PI)}
      else if(it.t==="table"){rounds.moveTo(c[0]+w/2*s,c[1]);rounds.arc(c[0],c[1],Math.max(1.5,w/2*s),0,2*PI)}
      else{
        const a=num(it.a,0),cc=Math.cos(a),nn=Math.sin(a),hw=w*s/2,hd=d*s/2,Q=(lx,lz)=>[c[0]+lx*cc+lz*nn,c[1]-lx*nn+lz*cc],k=[Q(-hw,-hd),Q(hw,-hd),Q(hw,hd),Q(-hw,hd)];
        rects.moveTo(k[0][0],k[0][1]);for(let j=1;j<4;j++)rects.lineTo(k[j][0],k[j][1]);rects.closePath();
      }
    }
    ctx.fillStyle=C.muted;ctx.globalAlpha=.16;ctx.fill(rects);ctx.fill(rounds);ctx.globalAlpha=.55;ctx.strokeStyle=C.muted;ctx.lineWidth=1;ctx.stroke(rects);ctx.stroke(rounds);
    ctx.globalAlpha=.75;ctx.fillStyle=C.plant;ctx.fill(plants);ctx.globalAlpha=1;
    // chairs
    if(s>=8){
      const ch=new Path2D();
      for(const c of arr(m.chairs)){if(!c||!isNum(c.x)||!isNum(c.z)||!vis(c.x-.3,c.z-.3,c.x+.3,c.z+.3))continue;const p=toS(c.x,c.z);ch.moveTo(p[0]+.22*s,p[1]);ch.arc(p[0],p[1],.22*s,0,2*PI)}
      ctx.fillStyle=C.muted;ctx.globalAlpha=.35;ctx.fill(ch);ctx.globalAlpha=1;
    }
    // desks: occupied ones filled with the team color (darker), open ones hollow
    const people=arr(m.people);
    for(const d of arr(m.desks)){
      if(!d||!isNum(d.x)||!isNum(d.z))continue;
      const w=Math.max(.2,num(d.w,DESK_W)),dd=Math.max(.2,num(d.dd,DESK_D)),r=Math.max(w,dd);
      if(!vis(d.x-r,d.z-r,d.x+r,d.z+r))continue;
      const occ=isNum(d.person)&&d.person>=0,per=occ?people[d.person]:null;
      ctx.beginPath();rotRect(d.x,d.z,w,dd,num(d.a,0));
      if(occ){ctx.fillStyle=tcol(d.team||(per&&per.team));ctx.globalAlpha=.85;ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle=C.ink;ctx.globalAlpha=.45;ctx.lineWidth=1;ctx.stroke();ctx.globalAlpha=1}
      else{ctx.fillStyle=C.plate;ctx.fill();ctx.strokeStyle=C.muted;ctx.lineWidth=1;ctx.stroke()}
      if(s>=30&&per&&per.name){const p=toS(d.x,d.z);labels.push({text:shortName(per.name,s>=70),x:p[0],y:p[1],font:`600 10px ${C.display}`,color:C.ink,maxW:Math.max(w,dd)*s-4})}
    }
    // elevator pads, exit pad, coffee pickup, ramps
    for(const e of arr(m.elevators)){const p=e&&e.pad;if(!p||!isNum(p.x)||!isNum(p.z))continue;const c=toS(p.x,p.z);ctx.beginPath();ctx.arc(c[0],c[1],num(p.r,1)*s,0,2*PI);ctx.setLineDash([4,3]);ctx.strokeStyle=C.ink;ctx.globalAlpha=.6;ctx.lineWidth=1.5;ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1}
    if(m.exit&&isNum(m.exit.x)&&isNum(m.exit.z)){const c=toS(m.exit.x,m.exit.z);ctx.beginPath();ctx.arc(c[0],c[1],num(m.exit.r,1.2)*s,0,2*PI);ctx.fillStyle=C.exit;ctx.globalAlpha=.2;ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle=C.exit;ctx.lineWidth=1.5;ctx.stroke()}
    const pk=m.kitchen&&m.kitchen.pickup;
    if(pk&&isNum(pk.x)&&isNum(pk.z)){const c=toS(pk.x,pk.z);ctx.beginPath();ctx.arc(c[0],c[1],num(pk.r,.9)*s,0,2*PI);ctx.strokeStyle="#A0522D";ctx.setLineDash([3,3]);ctx.lineWidth=1.5;ctx.stroke();ctx.setLineDash([])}
    for(const r of arr(m.ramps)){if(!r||!isNum(r.x)||!isNum(r.z))continue;const L=num(r.len,1.4),Wd=num(r.w,1.2);ctx.beginPath();rotRect(r.x,r.z,r.ax==="z"?Wd:L,r.ax==="z"?L:Wd,0);ctx.fillStyle=C.ramp;ctx.globalAlpha=.7;ctx.fill();ctx.globalAlpha=1}
  }
  function handlePx(){return COARSE?12:9}
  function drawOverlay(C){
    const s=S.view.s,o=item();
    // hover
    if(S.hover&&!sameSel(S.hover,S.sel)&&!S.drag){strokeItem(S.hover,S.tool==="erase"?C.danger:C.accent,S.tool==="erase"?3:1.5,S.tool==="erase"?1:.6)}
    // selection + handles
    if(o){
      strokeItem(S.sel,C.accent,2,1);
      const k=S.sel.kind,hp=handlePx();
      ctx.fillStyle=C.ground;ctx.strokeStyle=C.accent;ctx.lineWidth=2;
      if(k==="room"||k==="zone"){const r=rectOf(o);for(const[x,z]of[[r.x0,r.z0],[r.x1,r.z0],[r.x1,r.z1],[r.x0,r.z1]]){const p=toS(x,z);ctx.fillRect(p[0]-hp/2,p[1]-hp/2,hp,hp);ctx.strokeRect(p[0]-hp/2,p[1]-hp/2,hp,hp)}}
      if(k==="wall"||k==="glass"){for(const j of[0,2]){const p=toS(o[j],o[j+1]);ctx.beginPath();ctx.arc(p[0],p[1],hp/2+1,0,2*PI);ctx.fill();ctx.stroke()}}
    }
    // wall chain + snap marker
    const ch=S.chain.pts;
    if(ch.length){
      ctx.fillStyle=C.accent;for(const p of ch){const q=toS(p[0],p[1]);ctx.beginPath();ctx.arc(q[0],q[1],3,0,2*PI);ctx.fill()}
      if(S.snapInfo){
        const a=toS(ch[ch.length-1][0],ch[ch.length-1][1]),b=toS(S.snapInfo.x,S.snapInfo.z);
        ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.strokeStyle=S.tool==="glass"?C.glass:C.accent;ctx.lineWidth=Math.max(2,.12*s);ctx.setLineDash([6,4]);ctx.stroke();ctx.setLineDash([]);
        const L=hyp(S.snapInfo.x-ch[ch.length-1][0],S.snapInfo.z-ch[ch.length-1][1]);
        if(L>.01)drawLabels(C,[{text:`${fmtM(L)} m${S.snapInfo.kind==="angle"?" · "+S.snapInfo.deg+"°":""}`,x:(a[0]+b[0])/2,y:(a[1]+b[1])/2-12,font:`600 11px ${C.mono}`,color:C.ink}]);
      }
    }
    if(S.snapInfo){
      const p=toS(S.snapInfo.x,S.snapInfo.z),k=S.snapInfo.kind;ctx.strokeStyle=C.accent;ctx.lineWidth=2;ctx.beginPath();
      if(k==="end")ctx.arc(p[0],p[1],7,0,2*PI);
      else if(k==="angle"){ctx.moveTo(p[0],p[1]-6);ctx.lineTo(p[0]+6,p[1]);ctx.lineTo(p[0],p[1]+6);ctx.lineTo(p[0]-6,p[1]);ctx.closePath()}
      else{ctx.moveTo(p[0]-6,p[1]);ctx.lineTo(p[0]+6,p[1]);ctx.moveTo(p[0],p[1]-6);ctx.lineTo(p[0],p[1]+6)}
      ctx.stroke();
    }
    // rectangle being drawn
    if(S.rectPrev)ghostRect(C,S.rectPrev,`${fmtM(S.rectPrev.w)} × ${fmtM(S.rectPrev.d)} m`);
    // ready-made room / new desk following the cursor
    if(S.cursor&&!S.drag){
      if(S.pending)ghostRect(C,presetRect(S.pending,S.cursor[0],S.cursor[1],true),S.pending.label);
      else if(S.tool==="desk"&&!S.mode){ctx.beginPath();rotRect(snap(S.cursor[0]),snap(S.cursor[1]),DESK_W,DESK_D,S.deskA);ctx.setLineDash([4,3]);ctx.strokeStyle=C.accent;ctx.lineWidth=1.5;ctx.stroke();ctx.setLineDash([])}
    }
    const m=S.mode;
    if(m&&m.t==="cadmove"){
      ctx.beginPath();segPath(S.spec.walls.slice(m.w0,m.w0+m.nW));segPath(S.spec.glass.slice(m.g0,m.g0+m.nG));
      ctx.strokeStyle=C.accent;ctx.globalAlpha=.7;ctx.lineWidth=Math.max(2,.12*s);ctx.lineCap="round";ctx.stroke();ctx.globalAlpha=1;ctx.lineCap="butt";
    }
    if(m&&m.t==="planmove"&&S.spec.plan){const p=S.spec.plan,q=toS(p.x,p.z);ctx.setLineDash([8,5]);ctx.strokeStyle=C.accent;ctx.lineWidth=2;ctx.strokeRect(q[0],q[1],p.w*s,p.d*s);ctx.setLineDash([])}
    if(m&&m.t==="scale"){
      const pts=[m.p1,m.p2].filter(Boolean).map(p=>toS(p[0],p[1]));
      if(pts.length===2){ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);ctx.lineTo(pts[1][0],pts[1][1]);ctx.strokeStyle=C.accent;ctx.lineWidth=2;ctx.stroke()}
      pts.forEach((p,j)=>marker(C,p,String(j+1)));
    }
    if(m&&m.t==="facil"){
      if(m.placed){
        const hw=S.spec.w/2,hd=S.spec.d/2,inP=new Path2D(),outP=new Path2D(),r=Math.max(2,Math.min(5,.35*s));
        for(const d of m.placed){const p=toS(d.x,d.z),P=Math.abs(d.x)>hw||Math.abs(d.z)>hd?outP:inP;P.moveTo(p[0]+r,p[1]);P.arc(p[0],p[1],r,0,2*PI)}
        ctx.fillStyle=C.accent;ctx.fill(inP);ctx.fillStyle=C.danger;ctx.fill(outP);
      }
      if(m.qa)marker(C,toS(m.qa[0],m.qa[1]),"A");
      if(m.qb)marker(C,toS(m.qb[0],m.qb[1]),"B");
    }
    if(S.modelErr){ctx.font=`600 11px ${C.display}`;ctx.textAlign="left";ctx.textBaseline="bottom";ctx.fillStyle=C.danger;ctx.fillText("Preview unavailable: "+fitText(S.modelErr,S.W-200),10,S.H-8)}
  }
  function marker(C,p,t){
    ctx.beginPath();ctx.arc(p[0],p[1],9,0,2*PI);ctx.fillStyle=C.accent;ctx.fill();
    ctx.font=`800 11px ${C.display}`;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillStyle="#fff";ctx.fillText(t,p[0],p[1]+.5);
  }
  function ghostRect(C,r,label){
    const q=rectOf(r),a=toS(q.x0,q.z0),w=r.w*S.view.s,d=r.d*S.view.s;
    ctx.globalAlpha=.12;ctx.fillStyle=C.accent;ctx.fillRect(a[0],a[1],w,d);ctx.globalAlpha=1;
    ctx.setLineDash([6,4]);ctx.strokeStyle=C.accent;ctx.lineWidth=2;ctx.strokeRect(a[0],a[1],w,d);ctx.setLineDash([]);
    drawLabels(C,[{text:label,x:a[0]+w/2,y:a[1]+d/2,font:`700 12px ${C.display}`,color:C.ink}]);
  }
  function strokeItem(sel,color,lw,alpha){
    const o=listOf(sel.kind)[sel.i];if(!o)return;
    ctx.globalAlpha=alpha;ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.beginPath();
    if(sel.kind==="room"||sel.kind==="zone"){const q=rectOf(o),a=toS(q.x0,q.z0);ctx.rect(a[0],a[1],o.w*S.view.s,o.d*S.view.s)}
    else if(sel.kind==="desk")rotRect(o.x,o.z,DESK_W+.1,DESK_D+.1,o.a);
    else{segPath([o]);ctx.lineWidth=Math.max(lw,(sel.kind==="glass"?.1:.15)*S.view.s+3);ctx.lineCap="round"}
    ctx.stroke();ctx.globalAlpha=1;ctx.lineCap="butt";
  }

  /* ---------- wire up ---------- */
  on(cv,"pointerdown",onDown);on(cv,"pointermove",onMove);on(cv,"pointerup",onUp);on(cv,"pointercancel",onCancel);
  on(cv,"pointerleave",e=>{if(!S.drag&&e.pointerType!=="touch"){S.hover=null;S.snapInfo=null;S.cursor=null;updateStatus();invalidate()}});
  on(cv,"wheel",onWheel,{passive:false});on(cv,"dblclick",onDbl);on(cv,"contextmenu",e=>e.preventDefault());
  on(win,"keydown",onKey,true);on(win,"keyup",onKey,true);
  on(win,"resize",resize);
  on(win,"blur",()=>{S.space=false;setCursor()});
  if(win.ResizeObserver){ro=new win.ResizeObserver(()=>resize());ro.observe(stage)}
  if(win.MutationObserver){mo=new win.MutationObserver(()=>invalidate());mo.observe(doc.documentElement,{attributes:true,attributeFilter:["data-theme","class","style"]})}
  const mq=win.matchMedia&&win.matchMedia("(prefers-color-scheme: dark)");
  if(mq){const f=()=>invalidate();if(mq.addEventListener){mq.addEventListener("change",f);offs.push(()=>mq.removeEventListener("change",f))}}
  if(SMALL&&SMALL.addEventListener){const f=()=>{resize();invalidate()};SMALL.addEventListener("change",f);offs.push(()=>SMALL.removeEventListener("change",f))}

  if(S.spec.plan&&opts.planUrl)loadPlanImage(S.spec.plan.asset,String(opts.planUrl));
  updateTop();syncRail();renderPanel(true);resize();updateStatus();runBuild();
  later(()=>{resize();cv.focus({preventScroll:true})},0);
  announce(`Editing ${title}. ${N.dropped?plural(N.dropped,"item")+" couldn't be read and were left out. ":""}Press F for floor settings.`);
  return inst;
}

return{open,isOpen,_t:T};
})();
