/* PROPS: where the loose props of a floor go (pure, deterministic). The game (game-2f-physics.js) draws them and,
   when the physics engine loads, lets cars knock them around. See SPEC.md section 10. */
const PROPS=(()=>{
  // sizes in meters, mass in kg. Boxes and reams are w (along x) by h by d; bins and bottles are round (r); the cone has a square base
  const KINDS={
    box:{w:.44,h:.3,d:.34,m:1.1},      // cardboard box
    boxS:{w:.32,h:.22,d:.26,m:.6},     // small cardboard box
    ream:{w:.3,h:.055,d:.22,m:.8},     // ream of paper
    bin:{r:.15,h:.4,m:.7},             // recycling bin
    bottle:{r:.135,h:.46,m:1.6},       // water-cooler bottle
    cone:{w:.28,h:.46,d:.28,m:.5}           // wet-floor cone
  };
  const MIN=20,MAX=40;
  const fin=Number.isFinite,r3=v=>Math.round(v*1000)/1000;
  const hash=s=>{let h=2166136261;s=String(s);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0};
  const rng=seed=>{let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}};
  // the circle a prop covers on the floor
  const rad=k=>{const K=KINDS[k];return K.r||Math.max(K.w,K.d)/2+.01};

  /* plan(model, key, free) -> [{kind, x, y, z, a, g}]
     x,z = center on the floor, y = height of the prop's center (stacked props rest on the ones below), a = yaw (same sense as
     three's rotation.y), g = group number (one stack or cluster).
     free(x, z, r) -> true when a circle of radius r at (x,z) touches no furniture, wall or post. */
  function plan(m,key,free){
    const out=[];if(!m||!(m.w>0)||!(m.d>0)||typeof free!=="function")return out;
    const R=rng(hash("props|"+key)),J=s=>(R()-.5)*2*s,W=m.w,D=m.d,keep=[];
    const ko=(x,z,r)=>{if(fin(x)&&fin(z)&&fin(r))keep.push([x,z,r])};
    // keep clear: where you appear, elevator and exit pads, the coffee pickup, ramps, route end points, chairs
    if(m.spawn)ko(m.spawn.x,m.spawn.z,2.2);
    for(const e of m.elevators||[])if(e&&e.pad)ko(e.pad.x,e.pad.z,(e.pad.r||1)+1);
    if(m.exit)ko(m.exit.x,m.exit.z,(m.exit.r||1.2)+1);
    if(m.kitchen&&m.kitchen.pickup)ko(m.kitchen.pickup.x,m.kitchen.pickup.z,(m.kitchen.pickup.r||.9)+.5);
    for(const r of m.ramps||[])if(r)ko(r.x,r.z,Math.max(r.len||0,r.w||0)/2+1.3);
    for(const d of m.dests||[])if(d)ko(d.x,d.z,.75);
    for(const c of m.chairs||[])if(c)ko(c.x,c.z,.5);
    const clear=(x,z,r)=>{
      if(!(Math.abs(x)<W/2-.45-r&&Math.abs(z)<D/2-.45-r))return false;
      for(let i=0;i<keep.length;i++){const k=keep[i],dx=x-k[0],dz=z-k[1],rs=k[2]+r;if(dx*dx+dz*dz<rs*rs)return false}
      return !!free(x,z,r+.05);
    };
    let gid=0;
    // a group goes in whole or not at all; list = [[kind, x, y, z, a], ...]
    const put=(list,cx,cz,cr)=>{
      if(out.length+list.length>MAX)return false;
      for(const b of list)if(!clear(b[1],b[3],rad(b[0])))return false;
      for(const b of list)out.push({kind:b[0],x:r3(b[1]),y:r3(b[2]),z:r3(b[3]),a:r3(b[4]),g:gid});
      gid++;keep.push([cx,cz,cr]);return true;
    };
    // local frame at (cx,cz) turned by th: u along local x, v along local z
    const frame=(cx,cz,th)=>{const c=Math.cos(th),s=Math.sin(th);return(u,v)=>[cx+c*u+s*v,cz-s*u+c*v]};
    // try spots on rings around a point until one works
    const ring=(cx,cz,dists,fn)=>{const a0=R()*Math.PI*2;for(const d of dists)for(let k=0;k<8;k++){const a=a0+k*Math.PI/4;if(fn(cx+Math.cos(a)*d,cz+Math.sin(a)*d))return true}return false};
    const B=KINDS.box,S=KINDS.boxS,RM=KINDS.ream,BN=KINDS.bin,BT=KINDS.bottle,CN=KINDS.cone,G=.002;
    // box stacks: 0 a tower of three, 1 two with one on top, 2 three with two on top, 3 a box, a small box and a bin
    const stack=(P,th,type)=>{
      const L=[],b=(k,u,v,y,ja)=>{const p=P(u,v);L.push([k,p[0],y,p[1],th+J(ja)])},y1=B.h/2+G,y2=B.h*1.5+2*G;
      if(type===0){b("box",0,0,y1,.1);b("box",J(.02),J(.02),y2,.3);b("boxS",J(.03),J(.02),2*B.h+S.h/2+3*G,.5)}
      else if(type===1){b("box",-.235,0,y1,.04);b("box",.235,0,y1,.04);b("box",J(.04),0,y2,.2)}
      else if(type===2){b("box",-.47,0,y1,.03);b("box",0,0,y1,.03);b("box",.47,0,y1,.03);b("box",-.235,0,y2,.1);b("box",.235,0,y2,.1)}
      else{b("box",-.14,0,y1,.1);b("boxS",-.14+J(.03),0,B.h+S.h/2+2*G,.4);b("bin",.36,0,BN.h/2+G,3)}
      return L;
    };
    const reams=(x,z,a,n)=>{const L=[];for(let k=0;k<n;k++)L.push(["ream",x+J(.012),RM.h/2+G+k*(RM.h+G),z+J(.012),a+J(.3)]);return L};
    const bottles=(x,z,n)=>{const P=frame(x,z,R()*Math.PI*2),L=[];[[0,0],[.31,0],[.155,.27]].slice(0,n).forEach(([u,v])=>{const p=P(u-.15,v-.09);L.push(["bottle",p[0],BT.h/2+G,p[1],J(3)])});return L};
    const one=(kind,x,z)=>[[kind,x,(KINDS[kind].h)/2+G,z,J(3)]];
    const items=(m.items||[]).filter(it=>it&&fin(it.x)&&fin(it.z));

    // by each printer: a stack of paper reams and a recycling bin
    let np=0;
    for(const it of items){if(it.t!=="printer"||np>=3)continue;np++;
      const n=3+Math.floor(R()*3);
      ring(it.x,it.z,[.78,1,1.3],(x,z)=>put(reams(x,z,it.a||0,n),x,z,.42));
      ring(it.x,it.z,[.85,1.1,1.5],(x,z)=>put(one("bin",x,z),x,z,.4));
    }
    // the kitchen: spare water-cooler bottles by the fridge, a bin by the counter
    const fridge=items.find(it=>it.t==="fridge"),kx=fridge?fridge.x:m.kitchen?m.kitchen.x:NaN,kz=fridge?fridge.z:m.kitchen?m.kitchen.z:NaN;
    if(fin(kx)&&fin(kz)){
      const n=2+Math.floor(R()*2);
      ring(kx,kz,[1,1.3,1.7,2.2],(x,z)=>put(bottles(x,z,n),x,z,.6));
      const counter=items.find(it=>it.t==="counter");
      if(counter)ring(counter.x,counter.z,[.85,1.15,1.6,2.1],(x,z)=>put(one("bin",x,z),x,z,.4));
    }
    // wet-floor cones outside the restrooms and the kitchen
    let nc=0;
    for(const r of m.rooms||[]){
      if(!r||nc>=3||(r.type!=="restroom"&&r.type!=="kitchen")||!fin(r.x)||!fin(r.z))continue;
      const o={n:[0,-1],s:[0,1],e:[1,0],w:[-1,0]}[r.door];let x,z;
      if(o){x=r.x+o[0]*(r.w/2+1)+J(.3);z=r.z+o[1]*(r.d/2+1)+J(.3)}else{x=r.x;z=r.z}
      const f=(px,pz)=>put(one("cone",px,pz),px,pz,.45);
      if((o&&f(x,z))||ring(x,z,o?[.5,.9,1.4]:[Math.max(r.w,r.d)/2+.9,Math.max(r.w,r.d)/2+1.5],f))nc++;
    }
    // along the walls: stacks of cardboard boxes, spread over the floor, until the floor has its share
    const cand=[];
    for(const w of m.walls||[]){
      if(!w||(w.kind!=="ext"&&w.kind!=="int")||![w.x1,w.z1,w.x2,w.z2].every(fin))continue;
      const dx=w.x2-w.x1,dz=w.z2-w.z1,L=Math.hypot(dx,dz);if(L<2.4)continue;
      const ux=dx/L,uz=dz/L,off=(w.t>0?w.t:.15)/2+B.d/2+.12,th=Math.atan2(-uz,ux),n=Math.floor((L-1.6)/1.3)+1;
      for(let i=0;i<n;i++){const t=.8+i*1.3,px=w.x1+ux*t,pz=w.z1+uz*t;
        cand.push([px-uz*off,pz+ux*off,th]);cand.push([px+uz*off,pz-ux*off,th+Math.PI])}
    }
    for(let i=cand.length-1;i>0;i--){const j=Math.floor(R()*(i+1)),t=cand[i];cand[i]=cand[j];cand[j]=t}
    const target=26+Math.floor(R()*9),stacks=[];
    for(const gap of[7,4,2.2]){
      for(const c of cand){
        if(out.length>=(gap===7?target:MIN))break;
        let near=false;for(const s of stacks){const ddx=c[0]-s[0],ddz=c[1]-s[1];if(ddx*ddx+ddz*ddz<gap*gap){near=true;break}}
        if(near)continue;
        const type=Math.floor(R()*4);
        if(put(stack(frame(c[0],c[1],c[2]),c[2],type),c[0],c[1],type===2?1:.8))stacks.push(c);
      }
      if(out.length>=MIN)break;
    }
    return out;
  }

  /* fixed-step clock: add dt to the accumulator, return how many steps to run now (at most `max`; time beyond that is dropped) */
  function ticks(clock,dt,step,max){
    clock.acc=Math.min(clock.acc+(dt>0?dt:0),step*max+1e-9);
    let n=0;while(clock.acc>=step-1e-9&&n<max){clock.acc=Math.max(0,clock.acc-step);n++}
    return n;
  }
  /* the height span of one of the game's grid colliders for the physics world: {y0, y1}, or null when props ignore it.
     Platforms (mask 8) are slabs from their underside to their top; car blockers (mask 1) are low (0.7 m) unless tall. */
  function span(c,wallH){
    if(!c)return null;let y0=0,y1;
    if(c.m&8){y1=c.h;if(c.u!=null)y0=c.u}
    else if(c.m&1){if(c.minY!=null){y0=c.minY;y1=c.minY+.42}else y1=c.top!=null?c.top:c.tall?wallH:.7}
    else return null;
    return fin(y0)&&fin(y1)&&y1-y0>.01?{y0,y1}:null;
  }
  return{KINDS,MIN,MAX,plan,rad,hash,rng,ticks,span};
})();
