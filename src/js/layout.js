/* LAYOUT — turns one floor's layout spec + roster into a FloorModel (SPEC.md §4).
   Pure and deterministic: the same inputs give a deep-equal model. Never throws on bad data;
   anything skipped or clamped is listed in model.problems (strings).
   Geometry never depends on the roster, so people moving desks never moves furniture or ramps. */
const LAYOUT=(()=>{
  const ARR=["bench","cubes","offices","lab","hot"];
  const PI=Math.PI,HP=PI/2;
  // spacing rules (meters)
  const AISLE=1.4,MARGIN=1.0,WALL_CLR=0.6,EDGE=1.2;
  const H=3.0,T_EXT=0.3,T_INT=0.15,T_GLASS=0.08,T_PART=0.06,H_PART=1.3;
  const CHAIR_OFF=0.36;   // chair center sits this far behind the desk's sitter edge (pods: 1.15 - 0.79)
  const STAND=0.6;        // a visitor stands this far behind the chair
  const KB=0.28;          // kick-ramp back face length (floor-walk.html)
  const DOOR_W=1.0,LOBBY_DOOR=2.0;
  const WALK_CLR=0.35;    // dest standing points stay this far from walker blocks
  const GRID=0.25,REACH_CLR=0.32;   // internal reachability grid (a bit stricter than NAV/tests)
  const LED=["#39D98A","#3DA5FF","#FFB547","#FF5C7A","#B26BFF"];
  const PALETTE=["#3E7CB1","#8E6FBF","#D9822B","#2E9C7A","#C2456B","#5B8C3A","#B8860B","#2F7F8F","#A0522D","#6A5ACD","#C0392B","#16A085"];
  const NEUTRAL="#CFCAB9";
  const HEX=/^#[0-9a-fA-F]{6}$/;
  const ROOM_TYPES=["conf","office","phone","kitchen","lab","restroom","stairs","elevator","lobby","server","storage","mail","wellness","open"];
  const ROOM_NAME={conf:"Conference room",office:"Office",phone:"Phone room",kitchen:"Kitchen",lab:"Lab",restroom:"Restrooms",stairs:"Stairs",
    elevator:"Elevator",lobby:"Lobby",server:"Server room",storage:"Storage",mail:"Mail & print",wellness:"Wellness room",open:"Open area"};
  // loose room-type words from spreadsheets / other people's edits -> ROOM_TYPE
  const ROOM_ALIAS=[[/conf|meet|huddle|board|training|war ?room/,"conf"],[/phone|focus|booth|call/,"phone"],
    [/kitchen|break|cafe|pantry|coffee|lunch|galley/,"kitchen"],[/rest ?room|bath|toilet|\bwc\b|lav/,"restroom"],[/stair/,"stairs"],
    [/elev|lift/,"elevator"],[/lobby|recep|entr/,"lobby"],[/server|\bidf\b|\bmdf\b|network|comms/,"server"],
    [/stor|supply|closet|janitor/,"storage"],[/mail|print|copy/,"mail"],[/well|mother|lactat|quiet|nap|medit/,"wellness"],
    [/office/,"office"],[/\blab/,"lab"],[/open|commons|town ?hall|atrium/,"open"]];
  // null prototype: a side of "constructor" or "__proto__" from bad data must not resolve to an inherited member
  const SIDES=Object.assign(Object.create(null),{n:"n",s:"s",e:"e",w:"w",north:"n",south:"s",east:"e",west:"w"});
  const DOOR_Q={s:0,e:1,n:2,w:3};      // room frame quarter turn that puts the door on local +v
  const QA=[0,HP,PI,-HP];              // quarter turn -> yaw
  const FWD=[[0,-1],[-1,0],[0,1],[1,0]];  // quarter turn -> forward (u,v) in its frame
  const COS=[1,0,-1,0],SIN=[0,1,0,-1];

  /* ---------- small utils ---------- */
  const num=(v,d)=>{const n=typeof v==="number"?v:(typeof v==="string"&&v.trim()!=="")?Number(v):NaN;return Number.isFinite(n)?n:d};
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const r3=v=>(Math.round(v*1000)/1000)||0;
  const str=v=>v==null?"":(typeof v==="string"?v:String(v)).trim();
  const low=v=>str(v).toLowerCase();
  const na=a=>{a=num(a,0)%(2*PI);if(a>PI)a-=2*PI;else if(a<=-PI)a+=2*PI;return a||0};
  const snapQ=a=>{const q=Math.round(na(a)/HP);return((q%4)+4)%4};   // yaw -> nearest quarter turn
  const yawTo=(x,z,tx,tz)=>{const dx=tx-x,dz=tz-z;return(dx*dx+dz*dz<1e-9)?0:na(Math.atan2(-dx,-dz))};
  function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
  function rng(seed){let s=seed|0;return()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
  const letter=i=>{let s="";i++;while(i>0){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=(i-m-1)/26}return s};
  const pad2=n=>n<10?"0"+n:""+n;
  const hit=(a,b)=>a.x0<b.x1-1e-6&&b.x0<a.x1-1e-6&&a.z0<b.z1-1e-6&&b.z0<a.z1-1e-6;
  const grow=(b,g)=>({x0:b.x0-g,x1:b.x1+g,z0:b.z0-g,z1:b.z1+g});
  const rectOf=(x,z,w,d)=>({x0:x-w/2,x1:x+w/2,z0:z-d/2,z1:z+d/2});

  /* A frame maps local (u,v) to the floor: rotation by q quarter turns (same sense as yaw) around (cx,cz).
     q=0: u=+x, v=+z.  q=3: u=+z, v=-x (rows that run along z).  Yaws add: world = local + q*90deg. */
  function frame(cx,cz,q){
    q=((q%4)+4)%4;const c=COS[q],s=SIN[q];
    const f={cx,cz,q,
      x:(u,v)=>cx+u*c+v*s, z:(u,v)=>cz-u*s+v*c,
      a:ql=>QA[(q+ql)&3],
      box:(u,v,hu,hv)=>{const x=cx+u*c+v*s,z=cz-u*s+v*c,ex=q&1?hv:hu,ez=q&1?hu:hv;return{x0:x-ex,x1:x+ex,z0:z-ez,z1:z+ez}},
      sub:(u,v,q2)=>frame(cx+u*c+v*s,cz-u*s+v*c,q+(q2|0))};
    return f;
  }

  /* ---------- input normalization (spreadsheets, editor drafts, old docs) ---------- */
  function roomType(t){
    const s=low(t);if(ROOM_TYPES.includes(s))return s;
    for(const [re,ty] of ROOM_ALIAS)if(re.test(s))return ty;
    return null;
  }
  // clip a center/size rect to the plate; null if nothing usable is left
  function clipRect(o,HW,HD,min){
    const x=num(o.x,NaN),z=num(o.z,NaN),w=Math.abs(num(o.w,NaN)),d=Math.abs(num(o.d,NaN));
    if(![x,z,w,d].every(Number.isFinite))return null;
    const x0=Math.max(x-w/2,-HW),x1=Math.min(x+w/2,HW),z0=Math.max(z-d/2,-HD),z1=Math.min(z+d/2,HD);
    if(x1-x0<min||z1-z0<min)return null;
    return{x:(x0+x1)/2,z:(z0+z1)/2,w:x1-x0,d:z1-z0,clipped:(x1-x0<w-1e-6||z1-z0<d-1e-6)};
  }
  // Liang-Barsky clip of a segment to the plate
  function clipSeg(s,HW,HD){
    let x1,z1,x2,z2;
    if(Array.isArray(s))[x1,z1,x2,z2]=s.map(v=>num(v,NaN));
    else if(s&&typeof s==="object"){x1=num(s.x1,NaN);z1=num(s.z1,NaN);x2=num(s.x2,NaN);z2=num(s.z2,NaN)}
    if(![x1,z1,x2,z2].every(Number.isFinite))return null;
    const dx=x2-x1,dz=z2-z1;let t0=0,t1=1;
    const p=[-dx,dx,-dz,dz],q=[x1+HW,HW-x1,z1+HD,HD-z1];
    for(let i=0;i<4;i++){
      if(Math.abs(p[i])<1e-12){if(q[i]<0)return null;continue}
      const t=q[i]/p[i];if(p[i]<0){if(t>t1)return null;if(t>t0)t0=t}else{if(t<t0)return null;if(t<t1)t1=t}
    }
    const a=[x1+dx*t0,z1+dz*t0,x1+dx*t1,z1+dz*t1];
    return Math.hypot(a[2]-a[0],a[3]-a[1])<0.05?null:a;
  }
  function uniqueId(raw,fallback,used,P,what){
    let id=str(raw)||fallback,k=2;const base=id;
    while(used.has(low(id)))id=base+"~"+(k++);
    if(id!==base)P.push(`Duplicate ${what} id "${base}" renamed to "${id}"`);
    used.add(low(id));return id;
  }
  function normSpec(spec,P){
    const s=spec&&typeof spec==="object"?spec:{};
    if(s!==spec)P.push("Layout spec missing: using an empty 72 x 44 m floor");
    const w=clamp(Math.abs(num(s.w,72))||72,8,400),d=clamp(Math.abs(num(s.d,44))||44,8,400),HW=w/2,HD=d/2;
    const f=num(s.f,NaN);
    const key=str(s.key)||(str(s.b)&&Number.isFinite(f)?str(s.b)+"-"+f:"floor");
    const out={key,b:str(s.b)||null,f:Number.isFinite(f)?f:null,w,d,door:null,walls:[],glass:[],rooms:[],zones:[],desks:[],ramps:null};
    if(s.door&&typeof s.door==="object"){
      const side=SIDES[low(s.door.side)];
      if(side){const len=(side==="n"||side==="s")?w:d,dw=clamp(Math.abs(num(s.door.w,3))||3,1.2,Math.max(1.2,len-2));
        out.door={side,w:dw,at:clamp(num(s.door.at,0),-len/2+dw/2+0.5,len/2-dw/2-0.5)}}
      else P.push("Exterior door has no valid side (n/s/e/w): ignored");
    }
    for(const k of["walls","glass"]){
      (Array.isArray(s[k])?s[k]:[]).forEach((g,i)=>{const c=clipSeg(g,HW,HD);if(c)out[k].push(c);else P.push(`${k} #${i+1} is invalid or outside the floor: skipped`)});
    }
    const rid=new Set();
    (Array.isArray(s.rooms)?s.rooms:[]).forEach((r,i)=>{
      if(!r||typeof r!=="object"){P.push(`Room #${i+1} is not an object: skipped`);return}
      const c=clipRect(r,HW,HD,1.0);
      if(!c){P.push(`Room "${str(r.name)||str(r.id)||"#"+(i+1)}" has no usable size inside the floor: skipped`);return}
      if(c.clipped)P.push(`Room "${str(r.name)||str(r.id)}" was clipped to the floor plate`);
      let type=roomType(r.type);
      if(!type){P.push(`Room "${str(r.name)||str(r.id)}" has unknown type "${str(r.type)}": treated as open area`);type="open"}
      const id=uniqueId(r.id,"room"+(i+1),rid,P,"room");
      const seats=Math.floor(num(r.seats,0));
      out.rooms.push({id,type,name:str(r.name)||ROOM_NAME[type],x:c.x,z:c.z,w:c.w,d:c.d,door:SIDES[low(r.door)]||null,seats:seats>0?Math.min(seats,60):0});
    });
    const zid=new Set();
    (Array.isArray(s.zones)?s.zones:[]).forEach((z,i)=>{
      if(!z||typeof z!=="object")return;
      const c=clipRect(z,HW,HD,0.5);
      if(!c){P.push(`Zone "${str(z.team)||str(z.id)||"#"+(i+1)}" has no usable size inside the floor: skipped`);return}
      const dir=low(z.dir);
      out.zones.push({id:uniqueId(z.id,"z"+(i+1),zid,P,"zone"),team:str(z.team),arr:ARR.includes(low(z.arr))?low(z.arr):null,
        x:c.x,z:c.z,w:c.w,d:c.d,dir:dir==="h"||dir==="v"?dir:null});
    });
    (Array.isArray(s.desks)?s.desks:[]).forEach((k,i)=>{
      if(!k||typeof k!=="object")return;
      let x=num(k.x,NaN),z=num(k.z,NaN);
      if(!Number.isFinite(x)||!Number.isFinite(z)){P.push(`Desk "${str(k.id)||"#"+(i+1)}" has no position: skipped`);return}
      const cx=clamp(x,-HW+0.8,HW-0.8),cz=clamp(z,-HD+0.8,HD-0.8);
      if(cx!==x||cz!==z)P.push(`Desk "${str(k.id)}" was outside the floor: moved inside`);
      out.desks.push({id:str(k.id),x:cx,z:cz,q:snapQ(k.a),arr:ARR.includes(low(k.arr))?low(k.arr):null,team:str(k.team)});
    });
    if(Array.isArray(s.ramps)){
      out.ramps=[];
      s.ramps.forEach(r=>{
        if(!r||typeof r!=="object")return;
        const x=num(r.x,NaN),z=num(r.z,NaN);if(!Number.isFinite(x)||!Number.isFinite(z))return;
        const k=r.k==="kick"?"kick":"hump";
        out.ramps.push({k,x,z,ax:r.ax==="z"?"z":"x",dir:num(r.dir,1)<0?-1:1,len:clamp(Math.abs(num(r.len,k==="kick"?1.4:1.5)),0.3,6),
          w:clamp(Math.abs(num(r.w,k==="kick"?1.3:1.8)),0.3,6),h:clamp(Math.abs(num(r.h,k==="kick"?0.32:0.14)),0.02,1)});
      });
    }
    return out;
  }
  // teams map lookup: exact name, then case-insensitive
  function teamLookup(teams){
    const t=teams&&typeof teams==="object"?teams:{},lc=new Map();
    for(const k of Object.keys(t))if(!lc.has(low(k)))lc.set(low(k),t[k]);
    const get=n=>{const v=Object.prototype.hasOwnProperty.call(t,n)?t[n]:lc.get(low(n));return v&&typeof v==="object"?v:null};
    return{
      arr:n=>{const v=get(n);const a=v&&low(v.arr);return ARR.includes(a)?a:null},
      color:n=>{const v=get(n);if(v&&HEX.test(str(v.color)))return str(v.color).toUpperCase();return n?PALETTE[hash(low(n))%PALETTE.length]:NEUTRAL}
    };
  }
  function normRoster(roster,P){
    const out=[];
    (Array.isArray(roster)?roster:[]).forEach((r,i)=>{
      let o=null;
      if(Array.isArray(r))o={desk:str(r[0]),name:str(r[1]),team:str(r[2]),title:str(r[3])};
      else if(r&&typeof r==="object")o={desk:str(r.desk),name:str(r.name),team:str(r.team),title:str(r.title)};
      if(!o||!o.name){P.push(`Roster row ${i+1} has no name: skipped`);return}
      out.push(o);
    });
    return out;
  }

  const OUT_YAW={s:PI,n:0,e:-HP,w:HP};             // facing out through an exterior wall
  const INWARD={s:[0,-1],n:[0,1],e:[-1,0],w:[1,0]};
  const AMENITY=new Set(["kitchen","restroom","stairs","lobby","mail","wellness","elevator"]);
  const ROOM_SUB={office:"Private office",phone:"Phone room",kitchen:"Kitchen",lab:"Lab",restroom:"Restrooms",stairs:"Stairs",
    elevator:"Elevator",lobby:"Lobby",server:"Server room",storage:"Storage",mail:"Mail & print",wellness:"Wellness room",open:"Open area"};

  function build(spec,roster,teams,opt){
    const lite=!!(opt&&opt.lite);
    const P=[];
    const S=normSpec(spec,P);
    const W=S.w,D=S.d,HW=W/2,HD=D/2;
    const R=rng(hash(S.key+"|"+W+"x"+D));
    const TM=teamLookup(teams);
    const M={key:S.key,b:S.b,f:S.f,w:W,d:D,walls:[],rooms:[],areas:[],desks:[],people:[],unplaced:[],chairs:[],items:[],blocks:[],posts:[],
      elevators:[],stairs:[],exit:null,spawn:{x:0,z:0,a:0},kitchen:null,coffee:[],ramps:[],signs:[],dests:[],teams:[],stats:null,problems:P};
    const hints=[];        // per desk: standing-point guess [x,z]
    const obst=[];         // grown rects that desk groups must not overlap
    const keepOut=[];      // rects room furniture must not cover (exterior doorway, elevator pads)
    const forbidR=[];      // rects ramps must not cover
    const forbidC=[];      // circles [x,z,r] ramps must not cover
    const roomDests=[];    // { id, kind, name, sub, x, z, tx, tz } -> finalized into M.dests
    const usedIds=new Set();

    /* ---------- emitters ---------- */
    const block=(x0,x1,z0,z1,m,tall)=>{if(x1>x0&&z1>z0)M.blocks.push({x0:r3(x0),x1:r3(x1),z0:r3(z0),z1:r3(z1),m,tall})};
    const brect=(b,m,tall)=>block(b.x0,b.x1,b.z0,b.z1,m,tall);
    const post=(x,z,r,m,tall)=>{M.posts.push({x:r3(x),z:r3(z),r,m,tall})};
    const item=(t,x,z,y,a,w,d,h,c)=>{const o={t,x:r3(x),z:r3(z),y:r3(y),a,w:r3(w),d:r3(d),h:r3(h)};if(c)o.c=c;M.items.push(o);return o};
    // item centered at local (u,v), turned ql quarter turns in frame F
    const fitem=(F,t,u,v,ql,y,w,d,h,c)=>item(t,F.x(u,v),F.z(u,v),y,F.a(ql),w,d,h,c);
    // world AABB of an item-like box (w along its own x) turned ql in F
    const fbox=(F,u,v,ql,w,d)=>F.box(u,v,ql&1?d/2:w/2,ql&1?w/2:d/2);
    const chair=(x,z,q,desk,kind,jit)=>{M.chairs.push({x:r3(x),z:r3(z),a:jit?r3(na(QA[q&3]+(R()-.5)*jit)):QA[q&3],desk,kind});return M.chairs.length-1};
    const fchair=(F,u,v,ql,kind,jit)=>chair(F.x(u,v),F.z(u,v),(F.q+ql)&3,-1,kind,jit);
    function segBoxes(x1,z1,x2,z2,t){
      const e=t/2,dx=x2-x1,dz=z2-z1;
      if(Math.abs(dz)<1e-6)return[{x0:Math.min(x1,x2),x1:Math.max(x1,x2),z0:z1-e,z1:z1+e}];
      if(Math.abs(dx)<1e-6)return[{x0:x1-e,x1:x1+e,z0:Math.min(z1,z2),z1:Math.max(z1,z2)}];
      // any other angle: drawn as one wall, collides as a chain of small boxes (0.25 m steps)
      const n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/0.25)),out=[];
      for(let i=0;i<n;i++){const xa=x1+dx*i/n,za=z1+dz*i/n,xb=x1+dx*(i+1)/n,zb=z1+dz*(i+1)/n;
        out.push({x0:Math.min(xa,xb)-e,x1:Math.max(xa,xb)+e,z0:Math.min(za,zb)-e,z1:Math.max(za,zb)+e})}
      return out;
    }
    // collide: add m=7 blocks; clr>0: desk groups keep this distance from the wall
    function wall(x1,z1,x2,z2,t,h,kind,collide,clr){
      if(!(Math.hypot(x2-x1,z2-z1)>=0.05))return;
      M.walls.push({x1:r3(x1),z1:r3(z1),x2:r3(x2),z2:r3(z2),t,h,kind});
      const bs=segBoxes(x1,z1,x2,z2,t);
      if(collide!==false)for(const b of bs)brect(b,7,h>0.7?1:0);
      if(clr>0)for(const b of bs)obst.push(grow(b,clr));
    }
    // four walls of a U x V box in frame F; the local +v side gets a centered doorway when gap > 0
    function shell(F,U,V,kind,t,gap,collide,clr){
      const hu=U/2,hv=V/2,seg=(u1,v1,u2,v2)=>wall(F.x(u1,v1),F.z(u1,v1),F.x(u2,v2),F.z(u2,v2),t,H,kind,collide,clr);
      seg(-hu,-hv,hu,-hv);seg(-hu,-hv,-hu,hv);seg(hu,-hv,hu,hv);
      if(!(gap>0))seg(-hu,hv,hu,hv);
      else if(U>gap+0.4){seg(-hu,hv,-gap/2,hv);seg(gap/2,hv,hu,hv)}
    }
    /* desk at local (u,v) of F, sitter facing ql. o: { id, w, dd, arr, team, zone, mon, legs, top, chair, hint } */
    function desk(F,u,v,ql,o){
      const q=(F.q+ql)&3,fu=FWD[ql&3][0],fv=FWD[ql&3][1],x=F.x(u,v),z=F.z(u,v);
      const ex=q&1?o.dd/2:o.w/2,ez=q&1?o.w/2:o.dd/2,i=M.desks.length;
      const d={id:o.id,x:r3(x),z:r3(z),a:QA[q],w:o.w,dd:o.dd,arr:o.arr,team:o.team||"",zone:o.zone==null?null:o.zone,person:-1,mon:!!o.mon,chair:-1};
      M.desks.push(d);
      if(o.top)block(x-ex,x+ex,z-ez,z+ez,4,0);                       // walker-only: the car drives under
      if(o.legs)for(const sx of[-1,1])for(const sz of[-1,1])post(x+sx*(ex-.04),z+sz*(ez-.04),.03,3,0);
      const co=o.dd/2+CHAIR_OFF,so=co+STAND;
      if(o.chair)d.chair=chair(F.x(u-fu*co,v-fv*co),F.z(u-fu*co,v-fv*co),q,i,o.chair,o.chair==="stool"?.6:.4);
      hints.push(o.hint||[F.x(u-fu*so,v-fv*so),F.z(u-fu*so,v-fv*so)]);
      return i;
    }
    const sign=(lines,x,y,z,h,stripe)=>{M.signs.push({lines:lines.filter(Boolean),x:r3(x),y,z:r3(z),h,stripe:stripe||null})};
    const keepClear=b=>!keepOut.some(k=>hit(k,b));
    // which wall of a box faces the plate center (default door side)
    const towardCenter=(x,z)=>Math.abs(x)/W>Math.abs(z)/D?(x>0?"w":"e"):(z>0?"n":"s");

    /* ---------- exterior shell, doorway, exit pad, spawn ---------- */
    let spawn=null;
    (function exterior(){
      const dr=S.door,e=T_EXT/2;
      const sides={n:[-HW-e,-HD,HW+e,-HD],s:[-HW-e,HD,HW+e,HD],w:[-HW,-HD-e,-HW,HD+e],e:[HW,-HD-e,HW,HD+e]};
      for(const k of["n","s","w","e"]){
        const [x1,z1,x2,z2]=sides[k];
        if(!dr||dr.side!==k){wall(x1,z1,x2,z2,T_EXT,H,"ext");continue}
        const a=dr.at-dr.w/2,b=dr.at+dr.w/2;
        if(k==="n"||k==="s"){wall(x1,z1,a,z1,T_EXT,H,"ext");wall(b,z1,x2,z2,T_EXT,H,"ext")}
        else{wall(x1,z1,x1,a,T_EXT,H,"ext");wall(x1,b,x2,z2,T_EXT,H,"ext")}
      }
      if(!dr)return;
      const horiz=dr.side==="n"||dr.side==="s",n=INWARD[dr.side];
      const gx=horiz?dr.at:(dr.side==="e"?HW:-HW),gz=horiz?(dr.side==="s"?HD:-HD):dr.at;
      M.exit={x:r3(gx+n[0]*1.2),z:r3(gz+n[1]*1.2),a:OUT_YAW[dr.side],r:1.2};
      spawn={x:gx+n[0]*2.6,z:gz+n[1]*2.6,a:na(OUT_YAW[dr.side]+PI)};
      // keep the entrance clear: 5 m deep, door width + 1 m each side
      const zx0=horiz?dr.at-dr.w/2-1:(dr.side==="w"?-HW:HW-5),zx1=horiz?dr.at+dr.w/2+1:(dr.side==="w"?-HW+5:HW);
      const zz0=horiz?(dr.side==="n"?-HD:HD-5):dr.at-dr.w/2-1,zz1=horiz?(dr.side==="n"?-HD+5:HD):dr.at+dr.w/2+1;
      const dz={x0:zx0,x1:zx1,z0:zz0,z1:zz1};
      obst.push(dz);keepOut.push(dz);forbidR.push(grow(dz,1));
    })();

    /* ---------- authored walls and glass (any angle) ---------- */
    S.walls.forEach(s=>wall(s[0],s[1],s[2],s[3],T_INT,H,"int",true,WALL_CLR));
    S.glass.forEach(s=>wall(s[0],s[1],s[2],s[3],T_GLASS,H,"glass",true,WALL_CLR));

    /* ---------- rooms ---------- */
    S.rooms.forEach(r=>usedIds.add(low(r.id)));
    // elevator pads first, so lobby furniture etc. never lands on them
    const roomDoor=r=>r.door||((r.type==="office"||r.type==="elevator")?towardCenter(r.x,r.z):null);
    S.rooms.forEach(r=>{
      if(r.type!=="elevator")return;
      const q=DOOR_Q[roomDoor(r)],F=frame(r.x,r.z,q),hv=(q&1?r.w:r.d)/2;
      const pr=rectOf(F.x(0,hv+1.3),F.z(0,hv+1.3),2,2);
      keepOut.push(grow(pr,0.2));obst.push(grow(pr,0.6));
    });
    let kitchenDone=false;
    S.rooms.forEach(r=>doRoom(r));

    function doRoom(r){
      const door=roomDoor(r),T=r.type;
      const open=T==="open"||T==="lobby"||(T==="kitchen"&&!door);
      const solid=T==="elevator"||T==="phone"||(!door&&!open);
      const q=DOOR_Q[door||towardCenter(r.x,r.z)],F=frame(r.x,r.z,q);
      const U=q&1?r.d:r.w,V=q&1?r.w:r.d,hu=U/2,hv=V/2,rect=rectOf(r.x,r.z,r.w,r.d);
      M.rooms.push({id:r.id,type:T,name:r.name,x:r3(r.x),z:r3(r.z),w:r3(r.w),d:r3(r.d),door:open&&T!=="lobby"?null:(door||null),solid});
      const wallKind=T==="conf"?"glass":"int",wt=T==="conf"?T_GLASS:T_INT;
      // collision shell + how desk groups must keep away
      if(T==="open"){/* label only */}
      else if(T==="lab"&&!solid){
        shell(F,U,V,"int",T_INT,DOOR_W,true,WALL_CLR);
        obst.push(grow(fbox(F,0,hv,0,DOOR_W,0.1),1.6));          // keep the lab entrance clear inside and out
        M.areas.push({kind:"esd",x:r3(r.x),z:r3(r.z),w:r3(r.w),d:r3(r.d)});
      }else{
        obst.push(grow(rect,AISLE));
        if(T!=="lobby")forbidR.push(grow(rect,0.3));
        if(solid){brect(rect,7,1);if(T!=="phone")shell(F,U,V,wallKind,wt,0,false)}
        else if(T!=="lobby"&&!(T==="kitchen"&&!door))shell(F,U,V,wallKind,wt,DOOR_W,true);
      }
      let sub=ROOM_SUB[T]||"",standU=0,standV=hv+0.9,tgtV=hv,kind=AMENITY.has(T)?"amenity":"room",did="room:"+r.id;
      if(open){standV=0;tgtV=0}
      const inner=!solid;   // furniture gets colliders only when you can get inside
      if(T==="conf"){
        sub=confRoom(F,U,V,r,inner);
        M.areas.push({kind:"wood",x:r3(r.x),z:r3(r.z),w:r3(r.w),d:r3(r.d)});
      }else if(T==="office"){
        const vd=-hv+0.75+CHAIR_OFF+0.375,gst=V>=3.0;
        desk(F,0,vd,2,{id:r.id,w:Math.min(1.6,Math.max(0.8,U-0.6)),dd:.75,arr:"offices",team:"",zone:null,mon:true,legs:true,top:true,chair:"task",
          hint:[F.x(0,hv+0.9),F.z(0,hv+0.9)]});
        if(gst)fchair(F,U>=2.4?-0.35:0,vd+0.375+0.45,0,"guest",.3);
        if(U>=3.0&&V>=2.6){fitem(F,"cabinet",hu-0.55,-hv+0.33,2,0,.8,.45,1.0);brect(fbox(F,hu-0.55,-hv+0.33,2,.8,.45),7,1)}
      }else if(T==="phone"){
        fitem(F,"booth",0,0,2,0,Math.max(0.6,U-0.1),Math.max(0.6,V-0.1),2.3);
      }else if(T==="kitchen"){
        M.areas.push({kind:"tile",x:r3(r.x),z:r3(r.z),w:r3(r.w),d:r3(r.d)});
        const pk=kitchen(F,U,V,!!door);
        if(!kitchenDone){kitchenDone=true;did="kitchen";M.kitchen={x:r3(r.x),z:r3(r.z),pickup:{x:r3(pk[0]),z:r3(pk[1]),r:0.9}};
          roomDests.push({id:did,kind,name:r.name,sub,x:pk[0],z:pk[1],tx:pk[2],tz:pk[3],pickup:true});
          sign([r.name,sub],r.x,2.9,r.z,.5,null);return}
      }else if(T==="elevator"){
        fitem(F,"elevdoor",0,hv+0.06,2,0,clamp(U-0.6,0.8,1.6),.1,2.2);
        const px=F.x(0,hv+1.3),pz=F.z(0,hv+1.3);
        M.elevators.push({id:r.id,x:r3(r.x),z:r3(r.z),a:F.a(2),pad:{x:r3(px),z:r3(pz),r:1.0}});
        forbidC.push([px,pz,1.6]);
        did="elev:"+r.id;standV=hv+1.3;
      }else if(T==="stairs"){
        M.stairs.push({id:r.id,x:r3(r.x),z:r3(r.z)});
      }else if(T==="lobby"){
        M.areas.push({kind:"lobby",x:r3(r.x),z:r3(r.z),w:r3(r.w),d:r3(r.d)});
        lobby(F,U,V);
      }else if(T==="server"){
        server(F,U,V,!!door,inner);
      }else if(T==="storage"){
        const n=clamp(Math.floor((U-0.4)/0.95),0,5),v=-hv+0.075+0.27;
        for(let k=0;k<n;k++){const u=(k-(n-1)/2)*0.95;fitem(F,"cabinet",u,v,2,0,.9,.5,2.0)}
        if(n&&inner)brect(F.box(0,v,n*0.95/2,0.25),7,1);
      }else if(T==="mail"){
        const cw=clamp(U-1.6,0.8,3),v=-hv+0.075+0.32;
        fitem(F,"counter",-hu+0.2+cw/2,v,2,0,cw,.6,.95);
        if(U>=2.4)fitem(F,"printer",hu-0.55,v,2,0,.65,.6,1.1);
        if(inner){brect(fbox(F,-hu+0.2+cw/2,v,2,cw,.6),7,1);if(U>=2.4)brect(fbox(F,hu-0.55,v,2,.65,.6),7,1)}
      }else if(T==="wellness"){
        const sw=clamp(U-1.4,1.0,2.2),v=-hv+0.075+0.45;
        fitem(F,"sofa",0,v,2,0,sw,.85,.8);
        if(U>=2.4){fitem(F,"plant",hu-0.4,-hv+0.45,0,0,.5,.5,1.1);if(inner)post(F.x(hu-0.4,-hv+0.45),F.z(hu-0.4,-hv+0.45),.22,7,1)}
        if(inner)brect(fbox(F,0,v,2,sw,.85),7,1);
      }
      sign([r.name,sub],r.x,2.9,r.z,.5,null);
      roomDests.push({id:did,kind,name:r.name,sub,x:F.x(standU,standV),z:F.z(standU,standV),tx:F.x(0,tgtV),tz:F.z(0,tgtV)});
    }

    // conference room: table sized to the room, chairs around it, wall screen opposite the door. Returns the sign sub-line.
    function confRoom(F,U,V,r,inner){
      const hu=U/2,hv=V/2,along=U>=V,L=along?U:V,Wd=along?V:U;
      const tl=clamp(L-2.4,1.0,9),tw=clamp(Wd-2.6,0.9,1.6),tq=along?0:1;
      fitem(F,"rtable",0,0,tq,0,tl,tw,.74);
      fitem(F,"screen",0,-hv+0.1,2,1.0,Math.min(2.0,U*0.45),.06,1.0);
      if(!inner)return`Conference · ${r.seats||Math.max(2,2*Math.floor(tl/0.75))} seats`;
      brect(fbox(F,0,0,tq,tl,tw),4,0);
      const pk=tl>1.8?[-tl/4,tl/4]:[0];
      for(const p of pk)post(F.x(along?p:0,along?0:p),F.z(along?p:0,along?0:p),.08,3,0);
      // chair slots: both long sides from the middle out, then the ends (only when the table runs across the room)
      const n=Math.max(1,Math.floor(tl/0.75)),off=tw/2+0.4,slots=[];
      const order=[];for(let k=0;k<n;k++)order.push(k);
      order.sort((a,b)=>Math.abs(a-(n-1)/2)-Math.abs(b-(n-1)/2)||a-b);
      for(const k of order){const s=(k-(n-1)/2)*(tl/n);
        if(along){slots.push([s,-off,2],[s,off,0])}else{slots.push([-off,s,3],[off,s,1])}}
      if(along&&(L-tl)/2>=1.0){slots.push([-(tl/2+0.4),0,3],[tl/2+0.4,0,1])}
      const N=r.seats>0?Math.min(r.seats,slots.length):slots.length;
      for(let k=0;k<N;k++)fchair(F,slots[k][0],slots[k][1],slots[k][2],"conf",.3);
      return`Conference · ${r.seats||N} seats`;
    }
    // kitchen: fridge + counter with coffee along the back wall, round tables in front. Returns [pickupX, pickupZ, coffeeX, coffeeZ].
    function kitchen(F,U,V,hasDoor){
      const hu=U/2,hv=V/2,back=-hv+0.075;
      // fridge + counter, centered on the back wall
      const fr=U>=3.4,cl=Math.min(6,Math.max(0.8,U-0.6-(fr?0.9:0)));
      let u0=-(cl+(fr?0.9:0))/2;
      if(fr){const fv=back+0.39;fitem(F,"fridge",u0+0.4,fv,2,0,.8,.72,1.9);brect(fbox(F,u0+0.4,fv,2,.8,.72),7,1);u0+=0.9}
      const cu=u0+cl/2,cv=back+0.35;
      fitem(F,"counter",cu,cv,2,0,cl,.66,.95);brect(fbox(F,cu,cv,2,cl,.66),7,1);
      fitem(F,"coffee",cu,cv,2,.95,.45,.4,.5);
      const pv=cv+0.33+0.9;
      // tables: 2.6 m cells between the pickup aisle and the doorway
      const v0=pv+0.6,v1=hv-(hasDoor?1.3:0.6),u1=hu-0.5;
      const nu=Math.floor((2*u1)/2.6),nv=Math.floor((v1-v0)/2.6);
      let placed=0;
      for(let j=0;j<nv&&placed<4;j++)for(let i=0;i<nu&&placed<4;i++){
        const u=(i-(nu-1)/2)*2.6,v=v0+1.3+j*2.6;
        if(hasDoor&&Math.abs(u)<1.2&&j===nv-1&&nu>2)continue;      // leave the doorway lane open
        fitem(F,"table",u,v,0,0,.9,.9,.74);brect(F.box(u,v,.45,.45),4,0);post(F.x(u,v),F.z(u,v),.07,3,0);
        for(let k=0;k<4;k++){const f=FWD[k];fchair(F,u-f[0]*0.75,v-f[1]*0.75,k,"conf",.5)}
        placed++;
      }
      return[F.x(cu,pv),F.z(cu,pv),F.x(cu,cv),F.z(cu,cv)];
    }
    function lobby(F,U,V){
      const hu=U/2,hv=V/2;
      const put=(t,u,v,ql,w,d,h,solidH)=>{const b=fbox(F,u,v,ql,w,d);if(!keepClear(b))return;fitem(F,t,u,v,ql,0,w,d,h);brect(b,7,solidH>0.7?1:0)};
      if(V>=4)put("reception",0,-hv+1.4,2,clamp(U*0.3,1.6,3.2),.8,1.1,1.1);
      if(U>=5){const sw=clamp(V*0.3,1.4,2.2);put("sofa",-hu+0.75,0,3,sw,.85,.8,.8);put("sofa",hu-0.75,0,1,sw,.85,.8,.8)}
      for(const [su,sv] of[[-1,-1],[1,-1],[-1,1],[1,1]]){
        const u=su*(hu-0.5),v=sv*(hv-0.5),b=F.box(u,v,.25,.25);if(!keepClear(grow(b,0.3)))continue;
        fitem(F,"plant",u,v,0,0,.5,.5,1.1);post(F.x(u,v),F.z(u,v),.22,7,1);
      }
    }
    function server(F,U,V,hasDoor,inner){
      const hu=U/2,hv=V/2,n=Math.floor((U-0.8)/0.62);
      if(n<1)return;
      for(let v=-hv+0.6,k=0;v+0.5<=hv-(hasDoor?1.4:0.3);v+=2.4,k++){
        for(let i=0;i<n;i++)fitem(F,"rack",(i-(n-1)/2)*0.62,v,k%2?0:2,0,.6,1.0,2.0,LED[Math.floor(R()*LED.length)]);
        if(inner)brect(F.box(0,v,n*0.62/2,0.5),7,1);
      }
    }

    /* ---------- explicit desks (facilities coordinates / hand placed); ids kept verbatim ---------- */
    const fl=S.f!=null?S.f:S.key,exFrom=M.desks.length;
    S.desks.forEach((k,i)=>{
      const id=uniqueId(k.id,`${fl}-X${pad2(i+1)}`,usedIds,P,"desk");
      const arr=k.arr||TM.arr(k.team)||"bench",F=frame(k.x,k.z,k.q),base={id,arr,team:k.team,zone:null};
      let foot;   // local footprint [u0,u1,v0,v1]; the sitter faces -v, the chair is on +v
      if(arr==="lab"){
        fitem(F,"bench",0,0,0,0,1.5,.9,.9);brect(F.box(0,0,.75,.45),7,1);fitem(F,"scope",.25,-.1,0,.9,.42,.34,.26);
        desk(F,0,0,0,Object.assign(base,{w:1.5,dd:.9,mon:false,chair:"stool"}));foot=[-.75,.75,-.45,1.12];
      }else if(arr==="hot"){
        fitem(F,"rtable",0,0,0,0,1.2,.6,.74);brect(F.box(0,0,.6,.3),4,0);post(F.x(0,0),F.z(0,0),.07,3,0);
        desk(F,0,0,0,Object.assign(base,{w:1.2,dd:.6,mon:false,chair:"task"}));foot=[-.6,.6,-.3,.93];
      }else{
        const w=arr==="bench"?1.56:1.6,dd=arr==="bench"?.78:arr==="cubes"?.7:.75;
        desk(F,0,0,0,Object.assign(base,{w,dd,mon:true,legs:true,top:true,chair:"task"}));
        foot=[-w/2,w/2,-dd/2,dd/2+CHAIR_OFF+0.27];
        if(arr==="offices"){fchair(F,0,-(dd/2+0.45),2,"guest",.3);foot[2]-=0.75}   // no walls for explicit office desks
      }
      obst.push(grow(F.box((foot[0]+foot[1])/2,(foot[2]+foot[3])/2,(foot[1]-foot[0])/2,(foot[3]-foot[2])/2),AISLE));
    });

    const exTo=M.desks.length;   // M.desks[exFrom..exTo) are the hand-placed desks

    /* ---------- team zones: auto-filled desk groups ---------- */
    // a group footprint (local rect in frame G) is accepted when it stays inside the plate edge aisle and clear of every obstacle
    function fits(c,G,u,v,hu,hv){
      const b=G.box(u,v,hu,hv);
      if(b.x0<-HW+EDGE||b.x1>HW-EDGE||b.z0<-HD+EDGE||b.z1>HD-EDGE)return false;
      for(const o of obst)if(hit(o,b))return false;
      c.groups.push(b);return true;
    }
    function nextId(c){
      let id;do{id=`${fl}-${c.L}${pad2(++c.n)}`}while(usedIds.has(low(id)));
      usedIds.add(low(id));return id;
    }
    const zdesk=(c,G,u,v,ql,o)=>{const i=desk(G,u,v,ql,Object.assign(o,{id:nextId(c),team:c.zone.team,zone:c.zone.id}));c.desks.push(i);return i};
    // centered grid of group slots with the given pitch; groups are HU x HV half-sizes
    function grid(c,PU,PV,HU,HV,fn){
      const nu=c.Ui>=2*HU?Math.floor((c.Ui-2*HU)/PU+1e-9)+1:0,nv=c.Vi>=2*HV?Math.floor((c.Vi-2*HV)/PV+1e-9)+1:0;
      for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const u=(i-(nu-1)/2)*PU,v=(j-(nv-1)/2)*PV;if(fits(c,c.F,u,v,HU,HV))fn(u,v)}
      return nu*nv;
    }
    const FILL={
      // pods of 6: two rows of 3 back to back with a divider panel (floor-walk.html geometry)
      bench(c){
        const pod=(u,v)=>{
          const G=c.F.sub(u,v,0);
          fitem(G,"panel",0,0,0,.3,4.74,.03,.42);brect(G.box(0,0,2.37,.03),7,0);brect(G.box(0,0,2.18,.58),2,0);
          for(const s of[-1,1])for(const ox of[-1.6,0,1.6])zdesk(c,G,ox,s*0.4,s<0?2:0,{w:1.56,dd:.78,arr:"bench",mon:true,legs:true,top:true,chair:"task"});
        };
        if(grid(c,6.2,5.0,2.38,1.42,pod)>0||c.Vi<1.9)return;
        // too shallow for a pod: one row of 3 desks facing -v
        const nu=c.Ui>=4.76?Math.floor((c.Ui-4.76)/6.2+1e-9)+1:0;
        for(let i=0;i<nu;i++){const u=(i-(nu-1)/2)*6.2;if(!fits(c,c.F,u,0,2.38,0.95))continue;
          const G=c.F.sub(u,-0.55,0);
          for(const ox of[-1.6,0,1.6])zdesk(c,G,ox,0,0,{w:1.56,dd:.78,arr:"bench",mon:true,legs:true,top:true,chair:"task"})}
      },
      // 2x2 cubicle clusters: 1.3 m partitions on three sides, opening (with short returns) toward the aisle
      cubes(c){
        const E=2.46;
        grid(c,6.4,6.4,E+0.03,E+0.03,(u,v)=>{
          const G=c.F.sub(u,v,0),pw=(u1,v1,u2,v2)=>wall(G.x(u1,v1),G.z(u1,v1),G.x(u2,v2),G.z(u2,v2),T_PART,H_PART,"part",true);
          pw(-E,-E,-E,E);pw(0,-E,0,E);pw(E,-E,E,E);pw(-E,0,E,0);
          for(const s of[-1,1]){pw(-E,s*E,-E+0.45,s*E);pw(-0.45,s*E,0.45,s*E);pw(E-0.45,s*E,E,s*E)}
          for(const s of[-1,1])for(const cu of[-1.23,1.23])zdesk(c,G,cu,s*0.4,s<0?2:0,{w:1.6,dd:.7,arr:"cubes",mon:true,legs:true,top:true,chair:"task"});
        });
      },
      // private offices 3.2 x 3.6 in rows; two rows on a 2 m corridor when deep enough
      offices(c){
        const CW=3.2,CD=3.6,COR=2.0;
        // Rows are anchored at the zone edge, so first trim the band to stay EDGE (+ the 0.08 wall half) off the plate:
        // a zone drawn flush with the exterior wall (window offices) keeps its outer row instead of fits() dropping it.
        // room(dx,dz) = distance from the zone center to that keep-out line along the unit axis (dx,dz).
        const q=c.F.q,K=EDGE+0.08,room=(dx,dz)=>dx?HW-K-dx*c.F.cx:HD-K-dz*c.F.cz;
        const v0=Math.max(-c.Vi/2,-room(-SIN[q],-COS[q])),v1=Math.min(c.Vi/2,room(SIN[q],COS[q]));   // local +v = (sin, cos)
        const u0=Math.max(-c.Ui/2,-room(-COS[q],SIN[q])),u1=Math.min(c.Ui/2,room(COS[q],-SIN[q]));   // local +u = (cos, -sin)
        const n=Math.floor((u1-u0+1e-9)/CW),uc=(u0+u1)/2;
        if(n<1||v1-v0<CD-1e-9)return;
        const rows=[];let v=v0;
        while(v1-v>=2*CD+COR-1e-9){rows.push([v+CD/2,0,COR/2],[v+CD+COR+CD/2,2,COR/2]);v+=2*CD+COR+1.6}
        if(v1-v>=CD-1e-9){
          if(rows.length)rows.push([v1-CD/2,2,1.0]);
          else{ // single row: back wall toward the nearer plate edge (window offices), doors face the floor
            const ed=(x,z)=>Math.min(HW-Math.abs(x),HD-Math.abs(z));
            const lo=ed(c.F.x(0,v0),c.F.z(0,v0)),hi=ed(c.F.x(0,v1),c.F.z(0,v1));
            rows.push(lo<=hi?[v0+CD/2,0,1.0]:[v1-CD/2,2,1.0]);
          }
        }
        for(const [vc,ql,front] of rows){
          const Rf=c.F.sub(0,vc,ql),hv=CD/2,us=[],ok=[];
          for(let i=0;i<n;i++){const u=uc+(i-(n-1)/2)*CW;us.push(u);
            const lo=-hv-0.08,hi=hv+front;ok.push(fits(c,Rf,u,(lo+hi)/2,CW/2+0.08,(hi-lo)/2))}
          const pw=(u1,v1,u2,v2)=>wall(Rf.x(u1,v1),Rf.z(u1,v1),Rf.x(u2,v2),Rf.z(u2,v2),T_INT,H,"int",true);
          for(let a=0;a<n;a++){
            if(!ok[a])continue;let b=a;while(b+1<n&&ok[b+1])b++;
            pw(us[a]-CW/2,-hv,us[b]+CW/2,-hv);
            for(let k=a;k<=b;k++){
              const u=us[k],C=Rf.sub(u,0,0);
              pw(u-CW/2,-hv,u-CW/2,hv);
              pw(u-CW/2,hv,u+0.125,hv);pw(u+1.075,hv,u+CW/2,hv);            // 0.95 m door, off-center
              zdesk(c,C,0,-0.315,2,{w:1.6,dd:.75,arr:"offices",mon:true,legs:true,top:true,chair:"task",hint:[C.x(0.6,hv+0.9),C.z(0.6,hv+0.9)]});
              fchair(C,-0.35,0.51,0,"guest",.3);
              fitem(C,"cabinet",1.0,-hv+0.32,2,0,.8,.45,1.0);brect(fbox(C,1.0,-hv+0.32,2,.8,.45),7,1);
            }
            pw(us[b]+CW/2,-hv,us[b]+CW/2,hv);
            a=b;
          }
        }
      },
      // lab: racks along one edge, rows of solid benches (2 seats each, stools on the aisle side), test gear at row ends
      lab(c){
        const F=c.F,Ui=c.Ui,Vi=c.Vi;let top=-Vi/2;
        if(Vi>=5.6){
          const v=-Vi/2+0.5,run=6,pitch=0.62,len=m=>m*pitch+Math.floor((m-1)/run)*1.6;
          let n=0;while(len(n+1)<=Ui)n++;
          const st=-len(n)/2;
          for(let i=0;i<n;i++){const u=st+i*pitch+Math.floor(i/run)*1.6+pitch/2;
            if(!fits(c,F,u,v,0.31,0.5))continue;
            fitem(F,"rack",u,v,2,0,.6,1.0,2.0,LED[Math.floor(R()*LED.length)]);brect(F.box(u,v,.3,.5),7,1)}
          top=-Vi/2+1.0+1.6;
        }
        const T=n=>n*3+Math.max(0,Math.ceil(n/3)-1)*1.6;
        for(let v=top+0.45,row=0;v+1.12<=Vi/2+1e-9;v+=3.4,row++){
          const endItem=Ui>=T(3)+2.8,avail=endItem?Ui-2.8:Ui;
          let n=0;while(T(n+1)<=avail+1e-9)n++;
          if(!n)break;
          let u=-(T(n)+(endItem?2.8:0))/2;
          for(let k=0;k<n;k++){
            if(k>0&&k%3===0)u+=1.6;
            const bu=u+1.5;u+=3;
            if(!fits(c,F,bu,v+0.335,1.5,0.785))continue;
            const G=F.sub(bu,v,0);
            fitem(G,"bench",0,0,0,0,3.0,.9,.9);brect(G.box(0,0,1.5,.45),7,1);
            fitem(G,"shelf",0,-0.32,0,.9,2.9,.24,.6);
            const ns=R()<0.5?1:2,side=R()<0.5?-1:1;
            for(let s=0;s<ns;s++)fitem(G,"scope",(s?-side:side)*0.75,-0.05,0,.9,.42,.34,.26);
            for(const du of[-0.75,0.75])zdesk(c,G,du,0,0,{w:1.5,dd:.9,arr:"lab",mon:false,chair:"stool"});
          }
          if(endItem){
            const ch=row%2===0,w=ch?1.2:1.0,eu=u+1.6+0.6;
            if(fits(c,F,eu,v,w/2,0.5)){fitem(F,ch?"chamber":"probe",eu,v,2,0,w,1.0,ch?1.9:1.3);brect(F.box(eu,v,w/2,.5),7,1)}
          }
        }
      },
      // shared tables, 3 seats a side
      hot(c){
        grid(c,5.0,4.4,1.8,1.13,(u,v)=>{
          const G=c.F.sub(u,v,0);
          fitem(G,"rtable",0,0,0,0,3.6,1.0,.74);brect(G.box(0,0,1.8,.5),4,0);
          for(const p of[-1.2,1.2])post(G.x(p,0),G.z(p,0),.08,3,0);
          for(const s of[-1,1])for(const ox of[-1.2,0,1.2])zdesk(c,G,ox,s*0.25,s<0?2:0,{w:1.2,dd:.5,arr:"hot",mon:false,chair:"task"});
        });
      }
    };
    const zones=[];
    S.zones.forEach((z,zi)=>{
      const arr=z.arr||TM.arr(z.team)||"bench",color=z.team?TM.color(z.team):NEUTRAL;
      const area={kind:arr==="lab"?"esd":"carpet",x:r3(z.x),z:r3(z.z),w:r3(z.w),d:r3(z.d)};
      if(z.team)area.team=z.team;area.color=color;
      M.areas.push(area);
      const dir=z.dir||(z.w>=z.d?"h":"v"),F=frame(z.x,z.z,dir==="h"?0:3);
      const U=dir==="h"?z.w:z.d,V=dir==="h"?z.d:z.w;
      const c={F,Ui:U-2*MARGIN,Vi:V-2*MARGIN,zone:z,L:letter(zi),n:0,groups:[],desks:[],color};
      if(c.Ui>0&&c.Vi>0)FILL[arr](c);
      c.groups.forEach(g=>obst.push(grow(g,AISLE)));
      obst.push(grow(rectOf(z.x,z.z,z.w,z.d),AISLE-MARGIN));   // later zones yield to this one
      zones.push(c);
    });

    /* ---------- people -> desks ---------- */
    // 1) exact desk id  2) a free desk in their team's zones or among hand-placed desks tagged with their team
    // 3) a free desk in a zone without a team or an untagged hand-placed desk (never a hot desk)  4) unplaced
    const rows=lite?[]:normRoster(roster,P);
    const idMap=new Map();M.desks.forEach((d,i)=>{if(!idMap.has(low(d.id)))idMap.set(low(d.id),i)});
    const owner=new Int32Array(M.desks.length).fill(-1),deskOf=new Int32Array(rows.length).fill(-1),autoOf=new Uint8Array(rows.length);
    const pending=[];
    rows.forEach((p,r)=>{const k=p.desk?idMap.get(low(p.desk)):undefined;if(k!==undefined&&owner[k]<0){owner[k]=r;deskOf[r]=k}else pending.push(r)});
    const pools=new Map(),openPool={list:[],at:0};
    zones.forEach(c=>{const t=low(c.zone.team);if(!t){openPool.list.push(...c.desks);return}
      if(!pools.has(t))pools.set(t,{list:[],at:0});pools.get(t).list.push(...c.desks)});
    for(let k=exFrom;k<exTo;k++){const d=M.desks[k];if(d.arr==="hot")continue;const t=low(d.team);
      if(!t){openPool.list.push(k);continue}if(!pools.has(t))pools.set(t,{list:[],at:0});pools.get(t).list.push(k)}
    const take=pool=>{while(pool.at<pool.list.length){const k=pool.list[pool.at++];if(owner[k]<0)return k}return -1};
    const rest=[];
    for(const r of pending){const pool=pools.get(low(rows[r].team)),k=pool?take(pool):-1;if(k>=0){owner[k]=r;deskOf[r]=k;autoOf[r]=1}else rest.push(r)}
    for(const r of rest){const k=take(openPool);if(k>=0){owner[k]=r;deskOf[r]=k;autoOf[r]=1}}
    rows.forEach((p,r)=>{
      if(deskOf[r]<0){M.unplaced.push({name:p.name,team:p.team,title:p.title,desk:p.desk});return}
      const d=M.desks[deskOf[r]];d.person=M.people.length;if(!d.team)d.team=p.team;
      M.people.push({name:p.name,team:p.team,title:p.title,desk:deskOf[r],auto:!!autoOf[r]});
    });
    if(M.unplaced.length)P.push(`${M.unplaced.length} ${M.unplaced.length===1?"person has":"people have"} no free desk on this floor`);

    /* ---------- team signs, team list, stats ---------- */
    zones.forEach(c=>{
      const z=c.zone,n=c.desks.reduce((s,i)=>s+(M.desks[i].person>=0?1:0),0);
      sign([z.team||"Open seating",`Zone ${c.L} · ${n} ${n===1?"person":"people"}`],z.x,3.4,z.z,r3(clamp(Math.min(z.w,z.d)/10,0.6,1.25)),z.team?c.color:null);
    });
    const tl=new Map(),addTeam=t=>{if(t&&!tl.has(low(t)))tl.set(low(t),{team:t,color:TM.color(t),count:0})};
    zones.forEach(c=>addTeam(c.zone.team));S.desks.forEach(k=>addTeam(k.team));M.people.forEach(p=>addTeam(p.team));
    M.people.forEach(p=>{if(p.team)tl.get(low(p.team)).count++});
    M.teams=[...tl.values()];
    const occupied=M.people.length;
    M.stats={desks:M.desks.length,occupied,open:M.desks.length-occupied,unplaced:M.unplaced.length};

    /* ---------- walker lookups ---------- */
    const HC=2,hnx=Math.ceil(W/HC)+2,hnz=Math.ceil(D/HC)+2,buckets=new Map();
    const bi=(x,z)=>clamp(Math.floor((z+HD)/HC)+1,0,hnz-1)*hnx+clamp(Math.floor((x+HW)/HC)+1,0,hnx-1);
    function hput(x0,x1,z0,z1,ref){
      const i0=clamp(Math.floor((x0+HW)/HC)+1,0,hnx-1),i1=clamp(Math.floor((x1+HW)/HC)+1,0,hnx-1),j0=clamp(Math.floor((z0+HD)/HC)+1,0,hnz-1),j1=clamp(Math.floor((z1+HD)/HC)+1,0,hnz-1);
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const k=j*hnx+i;let b=buckets.get(k);if(!b)buckets.set(k,b=[]);b.push(ref)}
    }
    M.blocks.forEach((b,i)=>{if(b.m&4)hput(b.x0,b.x1,b.z0,b.z1,i)});
    M.posts.forEach((p,i)=>{if(p.m&4)hput(p.x-p.r,p.x+p.r,p.z-p.r,p.z+p.r,-1-i)});
    // true when a walker can stand at (x,z) with `m` clearance from every walker obstacle
    function freeAt(x,z,m){
      if(x<-HW+0.4||x>HW-0.4||z<-HD+0.4||z>HD-0.4)return false;
      const seen=new Set();
      for(const k of[bi(x-m,z-m),bi(x+m,z-m),bi(x-m,z+m),bi(x+m,z+m)]){
        if(seen.has(k))continue;seen.add(k);
        const b=buckets.get(k);if(!b)continue;
        for(const ref of b){
          if(ref>=0){const o=M.blocks[ref],dx=Math.max(o.x0-x,0,x-o.x1),dz=Math.max(o.z0-z,0,z-o.z1);if(dx*dx+dz*dz<m*m)return false}
          else{const p=M.posts[-1-ref],rr=p.r+m;if((p.x-x)**2+(p.z-z)**2<rr*rr)return false}
        }
      }
      return true;
    }
    // nearest point to (px,pz) passing ok(), searching rings outward, preferring the side away from (tx,tz)
    // (candidates are rounded to mm first, so the point that passed is exactly the one stored)
    function search(px,pz,tx,tz,ok){
      if(ok(r3(px),r3(pz)))return[r3(px),r3(pz)];
      const base=Math.abs(px-tx)+Math.abs(pz-tz)>1e-6?Math.atan2(pz-tz,px-tx):0;
      for(let k=1;k<=16;k++)for(let j=0;j<16;j++){
        const g=base+(j%2?1:-1)*Math.ceil(j/2)*PI/8,x=r3(px+Math.cos(g)*k*0.25),z=r3(pz+Math.sin(g)*k*0.25);
        if(ok(x,z))return[x,z];
      }
      return null;
    }

    if(lite){if(!spawn)spawn=M.elevators.length?{x:M.elevators[0].pad.x,z:M.elevators[0].pad.z,a:M.elevators[0].a}:{x:0,z:0,a:0};
      M.spawn={x:r3(spawn.x),z:r3(spawn.z),a:spawn.a};return finish()}

    /* ---------- walker grid: 0.25 m cells, car|walker obstacles grown by REACH_CLR ---------- */
    const GW=Math.max(1,Math.ceil(W/GRID)),GD=Math.max(1,Math.ceil(D/GRID)),blocked=new Uint8Array(GW*GD),reach=new Uint8Array(GW*GD);
    const ci0=x=>Math.max(0,Math.ceil((x+HW)/GRID-0.5)),ci1=x=>Math.min(GW-1,Math.floor((x+HW)/GRID-0.5));
    const cj0=z=>Math.max(0,Math.ceil((z+HD)/GRID-0.5)),cj1=z=>Math.min(GD-1,Math.floor((z+HD)/GRID-0.5));
    for(const b of M.blocks){if(!(b.m&5))continue;
      for(let j=cj0(b.z0-REACH_CLR),J=cj1(b.z1+REACH_CLR);j<=J;j++)for(let i=ci0(b.x0-REACH_CLR),I=ci1(b.x1+REACH_CLR);i<=I;i++)blocked[j*GW+i]=1}
    for(const p of M.posts){if(!(p.m&5))continue;const rr=p.r+REACH_CLR;
      for(let j=cj0(p.z-rr),J=cj1(p.z+rr);j<=J;j++)for(let i=ci0(p.x-rr),I=ci1(p.x+rr);i<=I;i++){
        const cx=-HW+(i+0.5)*GRID,cz=-HD+(j+0.5)*GRID;if((cx-p.x)**2+(cz-p.z)**2<=rr*rr)blocked[j*GW+i]=1}}
    const cellAt=(x,z)=>{const i=Math.floor((x+HW)/GRID),j=Math.floor((z+HD)/GRID);return i<0||j<0||i>=GW||j>=GD?-1:j*GW+i};
    const cx=c=>-HW+(c%GW+0.5)*GRID,cz=c=>-HD+(Math.floor(c/GW)+0.5)*GRID;
    // 4-connected flood fill over open cells; returns the number of cells marked
    function flood(s0,mark,label){
      const qu=new Int32Array(GW*GD);let h=0,t=0;qu[t++]=s0;mark[s0]=label;
      const go=c=>{if(!blocked[c]&&!mark[c]){mark[c]=label;qu[t++]=c}};
      while(h<t){const c=qu[h++],i=c%GW;if(i>0)go(c-1);if(i<GW-1)go(c+1);if(c>=GW)go(c-GW);if(c+GW<GW*GD)go(c+GW)}
      return t;
    }

    /* ---------- spawn: inside the doorway, else at the first elevator, else the middle of the biggest open area ---------- */
    if(!spawn&&M.elevators.length)spawn={x:M.elevators[0].pad.x,z:M.elevators[0].pad.z,a:M.elevators[0].a};
    if(!spawn){
      const lab=new Int32Array(GW*GD),sizes=[0];let best=0,bc=-1,bd=Infinity;
      for(let c=0;c<GW*GD;c++)if(!blocked[c]&&!lab[c]){sizes.push(flood(c,lab,sizes.length));if(sizes[sizes.length-1]>sizes[best])best=sizes.length-1}
      for(let c=0;c<GW*GD;c++)if(best&&lab[c]===best){const d=cx(c)**2+cz(c)**2;if(d<bd&&freeAt(cx(c),cz(c),WALK_CLR)){bd=d;bc=c}}
      spawn=bc>=0?{x:cx(bc),z:cz(bc),a:0}:{x:0,z:0,a:0};
    }
    {const s=search(spawn.x,spawn.z,spawn.x,spawn.z,(x,z)=>{const c=cellAt(x,z);return c>=0&&!blocked[c]&&freeAt(x,z,WALK_CLR)});
      if(!s)P.push("No free spot for the spawn point");else{spawn.x=s[0];spawn.z=s[1]}}
    M.spawn={x:r3(spawn.x),z:r3(spawn.z),a:spawn.a};
    {const s0=cellAt(M.spawn.x,M.spawn.z);if(s0>=0&&!blocked[s0])flood(s0,reach,1)}
    const okStand=(x,z)=>{const c=cellAt(x,z);return c>=0&&reach[c]===1&&freeAt(x,z,WALK_CLR)};
    const place=(id,px,pz,tx,tz)=>{const s=search(px,pz,tx,tz,okStand);if(s)return s;P.push(`No reachable standing point for ${id}`);return[px,pz]};

    /* ---------- destinations ---------- */
    for(const rd of roomDests){
      const s=place(rd.id,rd.x,rd.z,rd.tx,rd.tz);
      if(rd.pickup&&M.kitchen){M.kitchen.pickup.x=r3(s[0]);M.kitchen.pickup.z=r3(s[1])}
      M.dests.push({id:rd.id,kind:rd.kind,name:rd.name,sub:rd.sub,x:r3(s[0]),z:r3(s[1]),a:yawTo(s[0],s[1],rd.tx,rd.tz)});
    }
    if(M.exit){
      const s=place("exit",M.exit.x,M.exit.z,M.exit.x,M.exit.z);
      M.dests.push({id:"exit",kind:"amenity",name:"Exit",sub:"Way out to the campus",x:r3(s[0]),z:r3(s[1]),a:M.exit.a});
    }
    M.desks.forEach((d,i)=>{
      const p=d.person>=0?M.people[d.person]:null,s=place("desk "+d.id,hints[i][0],hints[i][1],d.x,d.z);
      M.dests.push({id:"desk:"+d.id,kind:"desk",name:p?p.name:"Open desk",sub:"Desk "+d.id+(d.team?" · "+d.team:""),x:r3(s[0]),z:r3(s[1]),a:yawTo(s[0],s[1],d.x,d.z)});
    });

    /* ---------- ramps ---------- */
    if(S.ramps)M.ramps=S.ramps.map(r=>({k:r.k,x:r3(r.x),z:r3(r.z),ax:r.ax,dir:r.dir,len:r.len,w:r.w,h:r.h}));
    else autoRamps();
    function autoRamps(){
      // summed-area tables: cells a car can't freely use (unreachable / near obstacles) and cells a ramp must not cover
      const forb=new Uint8Array(GW*GD);
      const stampR=(x0,x1,z0,z1)=>{for(let j=cj0(z0),J=cj1(z1);j<=J;j++)for(let i=ci0(x0),I=ci1(x1);i<=I;i++)forb[j*GW+i]=1};
      const stampC=(x,z,r)=>{for(let j=cj0(z-r),J=cj1(z+r);j<=J;j++)for(let i=ci0(x-r),I=ci1(x+r);i<=I;i++){
        const cx=-HW+(i+0.5)*GRID,cz=-HD+(j+0.5)*GRID;if((cx-x)**2+(cz-z)**2<=r*r)forb[j*GW+i]=1}};
      forbidR.forEach(b=>stampR(b.x0,b.x1,b.z0,b.z1));
      forbidC.forEach(c=>stampC(c[0],c[1],c[2]));
      M.chairs.forEach(c=>stampC(c.x,c.z,0.27+1.0));
      M.dests.forEach(d=>stampC(d.x,d.z,1.0));
      stampC(M.spawn.x,M.spawn.z,3.0);
      if(M.exit)stampC(M.exit.x,M.exit.z,1.8);
      if(M.kitchen)stampC(M.kitchen.pickup.x,M.kitchen.pickup.z,1.4);
      const sat=src=>{const s=new Int32Array((GW+1)*(GD+1));
        for(let j=0;j<GD;j++){let row=0;for(let i=0;i<GW;i++){row+=src(j*GW+i);s[(j+1)*(GW+1)+i+1]=s[j*(GW+1)+i+1]+row}}return s};
      const SN=sat(c=>reach[c]?0:1),SF=sat(c=>forb[c]);
      // any cell overlapping the rect counts; outside the grid counts as blocked
      const sum=(s,x0,x1,z0,z1)=>{const i0=Math.floor((x0+HW)/GRID),i1=Math.floor((x1+HW)/GRID),j0=Math.floor((z0+HD)/GRID),j1=Math.floor((z1+HD)/GRID);
        if(i0<0||j0<0||i1>=GW||j1>=GD)return 1;const R1=GW+1;return s[(j1+1)*R1+i1+1]-s[j0*R1+i1+1]-s[(j1+1)*R1+i0]+s[j0*R1+i0]};
      const SHAPE={hump:{len:1.5,w:1.8,h:0.14,back:0},kick:{len:1.4,w:1.3,h:0.32,back:KB}};
      const RUN=3.0;
      // rect along the ramp axis from a to b (in units along dir), half-width hw
      const span=(x,z,ax,dir,a,b,hw)=>{const p=dir>0?[a,b]:[-b,-a];
        return ax==="x"?{x0:x+p[0],x1:x+p[1],z0:z-hw,z1:z+hw}:{x0:x-hw,x1:x+hw,z0:z+p[0],z1:z+p[1]}};
      const cands={hump:[],kick:[]};
      for(let z=-HD+2;z<=HD-2;z+=1)for(let x=-HW+2;x<=HW-2;x+=1)for(const k of["hump","kick"])for(const ax of["x","z"])for(const dir of[1,-1]){
        const sp=SHAPE[k],foot=span(x,z,ax,dir,-sp.len/2,sp.len/2+sp.back,sp.w/2),lane=span(x,z,ax,dir,-sp.len/2-RUN,sp.len/2+sp.back+RUN,sp.w/2+0.1);
        if(sum(SN,lane.x0,lane.x1,lane.z0,lane.z1)||sum(SF,foot.x0-0.3,foot.x1+0.3,foot.z0-0.3,foot.z1+0.3))continue;
        cands[k].push({k,x,z,ax,dir,foot,lane,j:(hash(S.key+k+ax+dir+x+","+z)%1000)/1000*1.5});
      }
      const want=clamp(Math.round(W*D/550),3,6),chosen=[];
      let kind=R()<0.5?"hump":"kick";
      for(let t=0;t<want;t++,kind=kind==="hump"?"kick":"hump"){
        let best=null,bs=-1;
        for(const c of(cands[kind].length?cands[kind]:cands[kind==="hump"?"kick":"hump"])){
          let dm=Math.hypot(c.x-M.spawn.x,c.z-M.spawn.z);
          let bad=false;
          for(const o of chosen){const d=Math.hypot(c.x-o.x,c.z-o.z);if(d<6||hit(c.lane,o.foot)||hit(o.lane,c.foot)){bad=true;break}if(d<dm)dm=d}
          if(bad)continue;
          const sc=Math.min(dm,14)+c.j;
          if(sc>bs){bs=sc;best=c}
        }
        if(!best)break;
        chosen.push(best);
      }
      if(chosen.length<3)P.push(`Only ${chosen.length} auto ramp${chosen.length===1?"":"s"} fit in open aisles`);
      M.ramps=chosen.map(c=>{const sp=SHAPE[c.k];return{k:c.k,x:c.x,z:c.z,ax:c.ax,dir:c.dir,len:sp.len,w:sp.w,h:sp.h}});
    }

    /* ---------- coffee run: 5 occupied desks spread far apart ---------- */
    const occ=[];M.desks.forEach((d,i)=>{if(d.person>=0)occ.push(i)});
    if(occ.length>=5){
      const ref=M.kitchen?M.kitchen.pickup:M.spawn,md=occ.map(i=>(M.desks[i].x-ref.x)**2+(M.desks[i].z-ref.z)**2);
      while(M.coffee.length<5){
        let b=-1;for(let k=0;k<occ.length;k++)if(md[k]>=0&&(b<0||md[k]>md[b]+1e-9))b=k;
        const d0=M.desks[occ[b]];M.coffee.push(occ[b]);md[b]=-1;
        for(let k=0;k<occ.length;k++)if(md[k]>=0)md[k]=Math.min(md[k],(M.desks[occ[k]].x-d0.x)**2+(M.desks[occ[k]].z-d0.z)**2);
      }
    }
    return finish();

    function finish(){return M}
  }

  // desks a spec holds per zone (built with nobody seated; cheap)
  function capacity(spec,teams){
    const m=build(spec,[],teams,{lite:true}),byZone={};
    normSpec(spec,[]).zones.forEach(z=>{byZone[z.id]=0});
    for(const d of m.desks)if(d.zone!=null&&byZone[d.zone]!=null)byZone[d.zone]++;
    return{total:m.desks.length,byZone};
  }

  return{ARR,build,capacity};
})();
