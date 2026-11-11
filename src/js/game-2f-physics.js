/* ===================== game part 2f: loose props with live physics (Rapier, loaded after the first frame) ===================== */
// Every floor gets 20 to 40 loose props (PROPS.plan): box stacks, bins, cones, water bottles, paper reams. They are drawn
// right away as instanced meshes. The physics engine is fetched after the first frame; once it is ready each floor gets a
// physics world (the collider grid as fixed shapes, the props as dynamic bodies, every car and chair as a kinematic body)
// and cars knock the props around. If the engine can't load or WebAssembly is blocked, the props simply stay where they are.
// The cars' own driving physics is never touched: props don't push back.
const PHYS=(()=>{
  const VER="0.21.0",SRC="https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@"+VER+"/dist/rapier.mjs";
  const STEP=1/60,MAXSTEP=3,DEB_N=48,DEB_LIFE=3,DEB_PER=6;
  const ROLE={box:"panel",boxS:"panel",ream:"desk",bin:"pot",bottle:"cup",cone:"flag"};
  const DEBCOL={card:["#C9A26B","#B98E55","#D8B884"],paper:["#F4F2EC","#E6E3DB","#FFFFFF"],confetti:["#E4572E","#2F6FED","#F2C14E","#2E9C7A","#FF2E97"]};
  let RAP=null,state="idle",err="",world=null,fresh=true,props=[],groups={},debG=null,deb=[],debI=0,tick=0,chairB=[],chairXZ=null,lastThud=0,live=0,idle=false,resync=false,near=false;
  const kin=new Map(),extra=new Set(),clock={acc:0},stats={ms:0,steps:0,awake:0,statics:0,buildMs:0,loadMs:0};

  /* ---------- shapes: built here with vertex colors, one instanced mesh per kind ---------- */
  function geo(kind){
    const K=PROPS.KINDS[kind],P=[],bx=(w,h,d)=>new THREE.BoxGeometry(w,h,d),cy=(rt,rb,h,n)=>new THREE.CylinderGeometry(rt,rb,h,n||14);
    const a=(c,g,x,y,z)=>{if(x||y||z)g.translate(x||0,y||0,z||0);P.push([c,g])};
    const flat=g=>{const n=g.toNonIndexed();g.dispose();n.computeVertexNormals();return n};
    if(kind==="box"||kind==="boxS"){
      const{w,h,d}=K,tape="#E8D6A8";
      a(kind==="box"?"#C49A63":"#B5874F",bx(w,h,d));
      a("#9C7645",bx(w+.004,.012,d+.004),0,h*.27);                                   // the seam under the lid
      a(tape,bx(w+.008,.008,d*.2),0,h/2);a(tape,bx(.008,h*.36,d*.2),-w/2,h*.32);a(tape,bx(.008,h*.36,d*.2),w/2,h*.32);
      a("#F4F1EA",bx(w*.34,h*.34,.008),w*.17,-h*.12,-d/2);                            // a shipping label
    }else if(kind==="ream"){
      const{w,h,d}=K;a("#F6F4EE",bx(w,h,d));a("#3E7CB1",bx(w*.46,h+.008,d+.008));
    }else if(kind==="bin"){
      const r=K.r,h=K.h,rb=r*.78,at=y=>rb+(r-rb)*(y+h/2)/h;
      a("#2F6FED",cy(r,rb,h));a("#2459C6",cy(r+.012,r+.012,.036),0,h/2-.018);a("#101C36",cy(r-.022,r-.022,.006),0,h/2+.001);
      a("#F4F1EA",cy(at(.09)+.005,at(-.03)+.005,.12),0,.03);                          // the white label band
    }else if(kind==="bottle"){
      const r=K.r,c="#7CC4EE";
      a(c,cy(r,r,.3),0,-.08);a(c,cy(.05,r,.07),0,.105);a(c,cy(.05,.05,.05,10),0,.165);a("#F4F7FA",cy(.06,.06,.04,10),0,.21);
      a("#5AAEE2",cy(r+.005,r+.005,.024),0,-.02);a("#5AAEE2",cy(r+.005,r+.005,.024),0,-.15);
    }else{ // cone: a yellow wet-floor cone on a dark base
      const pyr=(rt,rb,h)=>{const g=cy(rt,rb,h,4);g.rotateY(Math.PI/4);return flat(g)};
      a("#1E1F21",bx(K.w,.03,K.w),0,-.215);a("#F2C14E",pyr(.03,.118,.42),0,.01);a("#1E1F21",pyr(.0654,.0822,.08),0,.03);a("#1E1F21",bx(.07,.02,.07),0,.22);
    }
    return crMerge(P);
  }
  // the style's own material for the role; shaded styles show the vertex colors (line-art styles keep their flat faces)
  function propMat(role){
    const m=mat(role);if(S.faceIsBg||S.depthOnly||!m.color||!("vertexColors" in m))return m;
    m.vertexColors=true;m.color.set(S.glow?0x343058:0xffffff);return m;
  }
  const home=p=>{const o=p.o;p.x=o.x;p.y=o.y;p.z=o.z;p.qx=0;p.qy=Math.sin(o.a/2);p.qz=0;p.qw=Math.cos(o.a/2);p.vx=p.vy=p.vz=0;p.asleep=true};
  const setM=p=>{const g=groups[p.kind];if(!g)return;_M.compose(_P.set(p.x,p.y,p.z),_Q.set(p.qx,p.qy,p.qz,p.qw),ONE);g.set(p.k,_M)};
  // a spot is free when no wall, furniture, post or desk is within r of it
  function freeAt(x,z,r){if(!spotFree(x,z))return false;const l=query(x,z,r+.05,15);for(let i=0;i<l.length;i++)if(circleVs(l[i],x,z,r))return false;return true}
  function plan(){
    const n={};let list=[];
    if(WKIND==="floor"){try{list=PROPS.plan(WM,WKEY,freeAt)}catch(e){console.error(e);list=[]}}
    props=list.filter(o=>PROPS.KINDS[o.kind]).map(o=>{const p={kind:o.kind,k:n[o.kind]||0,o,body:null,tt:0,rest:0};n[o.kind]=p.k+1;home(p);return p});
  }
  function visuals(){
    groups={};const n={};for(const p of props)n[p.kind]=(n[p.kind]||0)+1;
    for(const kind in n){const role=ROLE[kind]||"panel";groups[kind]=IG(geo(kind),role,n[kind],{mat:propMat(role),edge:kind==="cone"&&S.edgeRole?S.edgeRole.ramp:null})}
    debG=IG(new THREE.BoxGeometry(.17,.012,.12),"panel",DEB_N,{colored:true,noHull:1});
    for(const g of[...Object.values(groups),debG])if(g.mesh)g.mesh.userData.dyn=true; // they move: never part of a baked-light layout
    showProps();
    for(let i=0;i<DEB_N;i++)debG.set(i,ZERO_M);debG.commit();
  }

  // props only show while the engine runs (without it nothing would stop a car driving straight through them)
  function showProps(){for(const p of props){if(RAP)setM(p);else{const g=groups[p.kind];if(g)g.set(p.k,ZERO_M)}}for(const k in groups)groups[k].commit()}

  /* ---------- world hooks ---------- */
  // a floor (or the outside) was entered: its props start over at the next build
  function floor(){fresh=true}
  // the scene was cleared (clearRoot disposed every mesh under root): just forget the instanced groups
  function clear(){groups={};debG=null}
  // the scene was built (a new world, or the same one in another style)
  function build(){
    groups={};debG=null;if(!root||!WM)return;
    if(fresh){fresh=false;dropWorld();plan()}else dropDebris();
    visuals();
    if(RAP&&!world)makeWorld();
  }
  function dropDebris(){if(world)for(const d of deb)if(d&&d.body){try{world.removeRigidBody(d.body)}catch(_){}}deb=[];debI=0}
  function dropWorld(){
    if(world){try{world.free()}catch(_){}}
    world=null;kin.clear();chairB=[];chairXZ=null;deb=[];debI=0;clock.acc=0;stats.awake=0;
    for(const p of props)p.body=null;
  }
  function fail(e){
    err=String((e&&e.message)||e||"failed");if(state!=="failed")console.info("Prop physics is off, the props stay put: "+err);
    state="failed";dropWorld();RAP=null;
    if(debG){for(let i=0;i<DEB_N;i++)debG.set(i,ZERO_M);debG.commit()}
    showProps();
  }

  /* ---------- the engine: fetched once, after the first frame ---------- */
  function load(){
    if(state!=="wait")return;state="loading";const t0=performance.now();
    let p;try{p=/[#&]nophys\b/.test(location.hash)?Promise.reject(new Error("turned off with #nophys")):import(SRC)}catch(e){p=Promise.reject(e)}
    p.then(m=>{const r=m&&(m.default||m);if(!r||typeof r.init!=="function"||!r.World)throw new Error("unexpected physics module");return Promise.resolve(r.init()).then(()=>r)})
     .then(r=>{const w=new r.World({x:0,y:-1,z:0});w.step();w.free(); // WebAssembly really runs here
       RAP=r;state="ready";stats.loadMs=performance.now()-t0;if(root&&WM&&!world){makeWorld();if(world)showProps()}})
     .catch(fail);
  }

  /* ---------- the physics world of the current floor ---------- */
  function shape(kind){
    const K=PROPS.KINDS[kind],C=RAP.ColliderDesc;let d=null;
    if(kind==="bin")d=C.cylinder(K.h/2,K.r*.92);
    else if(kind==="bottle"){const p=[];for(const[y,r]of[[-.23,.135],[.07,.135],[.14,.055],[.23,.058]])for(let i=0;i<10;i++){const a=i*Math.PI/5;p.push(Math.cos(a)*r,y,Math.sin(a)*r)}d=C.convexHull(new Float32Array(p))}
    else if(kind==="cone"){const p=[];for(const[y,r]of[[-.23,.14],[-.2,.14],[.23,.03]])for(const sx of[-1,1])for(const sz of[-1,1])p.push(sx*r,y,sz*r);d=C.convexHull(new Float32Array(p))}
    if(!d)d=K.r?C.cylinder(K.h/2,K.r):C.cuboid(K.w/2,K.h/2,K.d/2);
    return d.setMass(K.m).setFriction(kind==="bottle"?.45:.75).setRestitution(kind==="bottle"?.3:.15);
  }
  function makeWorld(){
    const t0=performance.now();
    try{
      const C=RAP.ColliderDesc,B=RAP.RigidBodyDesc;
      world=new RAP.World({x:0,y:-G,z:0});world.timestep=STEP;
      world.createCollider(C.cuboid(PW/2+4,.5,PD/2+4).setTranslation(0,-.5,0).setFriction(.8));
      // walls, posts, furniture and desk tops: every collider of the game's own grid, as a fixed box or cylinder
      const seen=new Set();let ns=0;
      for(const cell of cells)for(const c of cell){
        if(seen.has(c))continue;seen.add(c);if(!c.b&&c.r<.06)continue; // desk legs are too thin to matter to a box
        const sp=PROPS.span(c,H);if(!sp)continue;const hy=(sp.y1-sp.y0)/2,my=(sp.y0+sp.y1)/2;
        if(c.b)world.createCollider(C.cuboid(Math.max(.005,(c.x1-c.x0)/2),hy,Math.max(.005,(c.z1-c.z0)/2)).setTranslation((c.x0+c.x1)/2,my,(c.z0+c.z1)/2).setFriction(.6));
        else world.createCollider(C.cylinder(hy,Math.max(.005,c.r)).setTranslation(c.x,my,c.z).setFriction(.6));
        ns++;
      }
      // ramps: the same height function the cars drive on, as a small triangle mesh
      for(const r of RAMPS){
        const L=r.len+(r.k==="kick"?KB:0),nu=Math.max(2,Math.ceil(L/.12)),nv=Math.max(2,Math.ceil(r.w/.25)),vs=[],ix=[];
        for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){const u=-r.len/2+L*i/nu,v=-r.w/2+r.w*j/nv,x=r.x+(r.ax==="x"?u*r.dir:v),z=r.z+(r.ax==="x"?v:u*r.dir);vs.push(x,groundY(x,z),z)}
        for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const a=j*(nu+1)+i,b=a+1,c=a+nu+1,d=c+1;ix.push(a,c,b,b,c,d)}
        world.createCollider(C.trimesh(new Float32Array(vs),new Uint32Array(ix)).setFriction(.7));ns++;
      }
      stats.statics=ns;
      for(const p of props){
        p.body=world.createRigidBody(B.dynamic().setTranslation(p.x,p.y,p.z).setRotation({x:p.qx,y:p.qy,z:p.qz,w:p.qw}).setLinearDamping(.2).setAngularDamping(PROPS.KINDS[p.kind].r?1.2:.3).setCcdEnabled(true)); // round things don't roll forever
        world.createCollider(shape(p.kind),p.body);p.asleep=false;p.rest=0;p.vx=p.vy=p.vz=0; // they settle and fall asleep within a second
      }
      // chairs keep their own physics; here they are moving obstacles for the props
      chairB=[];chairXZ=new Float64Array(chairs.length*2);
      chairs.forEach((c,i)=>{const b=world.createRigidBody(B.kinematicPositionBased().setTranslation(c.x,.26,c.z));world.createCollider(C.cylinder(.26,CHR-.02).setFriction(.5),b);chairB.push(b);chairXZ[i*2]=c.x;chairXZ[i*2+1]=c.z});
      kin.clear();deb=[];debI=0;clock.acc=0;live=props.length;idle=false;
      world.step(); // the first step sorts every collider: do it now, behind the floor's fade, not in a frame
    }catch(e){fail(e)}
    stats.buildMs=performance.now()-t0;
  }
  // every car on this floor: me, the Mailbot, coworkers' cars, and anything added with PHYS.track
  function eachCar(fn){
    fn(me);if(BOTPATH.length)fn(bot);
    for(const r of remotes.values())if(r.has&&r.w===WKEY&&r.m!=="o")fn(r.car);
    for(const c of extra)fn(c);
  }
  const _kq={x:0,y:0,z:0,w:1},_kp={x:0,y:0,z:0};
  function moveCar(c){
    if(!c||!isFinite(c.x)||!isFinite(c.z)||!isFinite(c.h)||Math.abs(c.x)>PW/2+2||Math.abs(c.z)>PD/2+2)return;
    const kind=c.kind==="dog"||c.kind==="cat"?c.kind:"car",bh=BODY_H[kind],P=AVP[kind];
    _kp.x=c.x;_kp.y=(c.y||0)+bh/2+.015;_kp.z=c.z;_kq.y=Math.sin(c.h/2);_kq.w=Math.cos(c.h/2);
    let e=kin.get(c);
    if(e&&e.kind!==kind){world.removeRigidBody(e.body);e=null}
    if(!e){
      const body=world.createRigidBody(RAP.RigidBodyDesc.kinematicPositionBased().setTranslation(_kp.x,_kp.y,_kp.z).setRotation(_kq));
      // the RC car is a wedge (low nose, full height from the windscreen back), so what it rams rides up and tumbles
      const hw=P.r*.85,hh=bh/2,L=P.ax+P.r;let cd=null;
      if(kind==="car")cd=RAP.ColliderDesc.convexHull(new Float32Array([-hw,-hh,L,hw,-hh,L,-hw,hh,L,hw,hh,L,-hw,hh,-L*.15,hw,hh,-L*.15,-hw,-hh,-L,hw,-hh,-L,-hw,-hh*.2,-L,hw,-hh*.2,-L]));
      world.createCollider((cd||RAP.ColliderDesc.cuboid(hw,hh,L)).setFriction(.5),body);
      e={body,kind,x:_kp.x,y:_kp.y,z:_kp.z,h:c.h};kin.set(c,e);
    }else{
      const dx=_kp.x-e.x,dy=_kp.y-e.y,dz=_kp.z-e.z,d2=dx*dx+dy*dy+dz*dz;
      if(resync||d2>2.25){e.body.setTranslation(_kp,true);e.body.setRotation(_kq,true);e.x=_kp.x;e.y=_kp.y;e.z=_kp.z;e.h=c.h} // a respawn, an elevator ride, or the first step after a pause: not a shove
      else{ // this step's share of the frame's motion (the last step lands exactly on the car)
        e.x+=dx/kRem;e.y+=dy/kRem;e.z+=dz/kRem;e.h+=angDiff(e.h,c.h)/kRem;
        _kp.x=e.x;_kp.y=e.y;_kp.z=e.z;_kq.y=Math.sin(e.h/2);_kq.w=Math.cos(e.h/2);
        e.body.setNextKinematicTranslation(_kp);e.body.setNextKinematicRotation(_kq); // a touched prop wakes by itself
      }
    }
    e.tick=tick;
  }
  let kRem=1; // physics steps left this frame, counting this one
  function syncKin(rem){
    kRem=Math.max(1,rem||1);tick++;eachCar(moveCar);
    for(const[c,e]of kin)if(e.tick!==tick){world.removeRigidBody(e.body);kin.delete(c)}
    const n=Math.min(chairB.length,chairs.length);
    for(let i=0;i<n;i++){const c=chairs[i],ox=chairXZ[i*2],oz=chairXZ[i*2+1];if(c.x===ox&&c.z===oz)continue;
      const dx=c.x-ox,dz=c.z-oz;
      // a chair snapped home (tidied: no longer awake) or moved far is placed, not swept through what's in the way
      if(resync||!c.awake||dx*dx+dz*dz>1){_kp.x=c.x;_kp.y=.26;_kp.z=c.z;chairB[i].setTranslation(_kp,true);chairXZ[i*2]=c.x;chairXZ[i*2+1]=c.z}
      else{_kp.x=ox+dx/kRem;_kp.y=.26;_kp.z=oz+dz/kRem;chairB[i].setNextKinematicTranslation(_kp);chairXZ[i*2]=_kp.x;chairXZ[i*2+1]=_kp.z}}
  }
  // a soft thud when a prop is hit hard or lands hard; never more than one every 90 ms
  function thud(p,dv,now){
    if(now-lastThud<90||now-p.tt<220)return;
    const att=clamp(1-camera.position.distanceTo(_P.set(p.x,p.y,p.z))/14,0,1);if(att<.05)return;
    lastThud=p.tt=now;const s=Math.min(6,dv)*.55*att;
    if(p.kind==="bottle"||p.kind==="bin")SFX.land(s*1.1);else SFX.bump(p.kind==="ream"?s*.6:s);
  }
  // copy the bodies that moved into their instance matrices (resting bodies are skipped)
  function readBack(){
    const now=performance.now(),dirty={};let aw=0;
    for(const p of props){
      const b=p.body;if(!b)continue;const sl=b.isSleeping();if(sl&&p.asleep)continue;
      const t=b.translation();
      if(!(t.y>-2&&t.y<H+4&&Math.abs(t.x)<PW/2+2&&Math.abs(t.z)<PD/2+2)){ // fell out of the world: back to where it started
        home(p);b.setTranslation({x:p.x,y:p.y,z:p.z},false);b.setRotation({x:p.qx,y:p.qy,z:p.qz,w:p.qw},false);b.setLinvel({x:0,y:0,z:0},false);b.setAngvel({x:0,y:0,z:0},false);b.sleep();
      }else{
        const q=b.rotation(),v=b.linvel(),dv=Math.hypot(v.x-p.vx,v.y-p.vy,v.z-p.vz);
        p.x=t.x;p.y=t.y;p.z=t.z;p.qx=q.x;p.qy=q.y;p.qz=q.z;p.qw=q.w;p.vx=v.x;p.vy=v.y;p.vz=v.z;p.asleep=sl;
        if(sl)p.vx=p.vy=p.vz=0;
        else{
          aw++;if(dv>1.8)thud(p,dv,now);
          // barely moving for a second (a bin creeping along on its side): put it to rest
          const w=b.angvel();
          if(v.x*v.x+v.y*v.y+v.z*v.z<.04&&w.x*w.x+w.y*w.y+w.z*w.z<2.25){if(++p.rest>60){p.rest=0;b.sleep()}}else p.rest=0;
        }
      }
      setM(p);dirty[p.kind]=1;
    }
    for(const k in dirty)if(groups[k])groups[k].commit();
    stats.awake=live=aw;
  }

  /* ---------- debris: short-lived pieces for PHYS.burst ---------- */
  function debFrame(dt){
    if(!deb.length)return;let any=false,live=0;
    for(let k=0;k<deb.length;k++){
      const d=deb[k];if(!d||!d.body)continue;any=true;d.life-=dt;
      if(d.life<=0){world.removeRigidBody(d.body);d.body=null;if(debG)debG.set(k,ZERO_M);continue}
      live++;if(!debG)continue;
      const t=d.body.translation(),q=d.body.rotation(),s=Math.min(1,d.life/.6); // the last moments: shrink away
      _M.compose(_P.set(t.x,t.y,t.z),_Q.set(q.x,q.y,q.z,q.w),_S.set(s,s,s));debG.set(k,_M);
    }
    if(any&&debG)debG.commit();
    if(!live){deb=[];debI=0}
  }
  // about six pieces that fly up from (x,y,z), tumble, and are gone after 3 s. kind: "card" (cardboard flaps, the default),
  // "paper" or "confetti". Returns how many were made: 0 while the physics engine isn't running.
  function burst(x,y,z,kind){
    if(!world||!debG||!isFinite(x)||!isFinite(y)||!isFinite(z))return 0;
    const cols=DEBCOL[kind]||DEBCOL.card,rnd=s=>(Math.random()-.5)*2*s;
    try{
      for(let i=0;i<DEB_PER;i++){
        const k=debI;debI=(debI+1)%DEB_N;const old=deb[k];if(old&&old.body)world.removeRigidBody(old.body);
        const a=Math.random()*Math.PI*2,sp=1.2+Math.random()*2.2;_Q.set(rnd(1),rnd(1),rnd(1),rnd(1)+.01).normalize();
        const body=world.createRigidBody(RAP.RigidBodyDesc.dynamic().setTranslation(x+Math.cos(a)*.08,Math.max(.04,y)+.04+Math.random()*.12,z+Math.sin(a)*.08)
          .setRotation({x:_Q.x,y:_Q.y,z:_Q.z,w:_Q.w}).setLinvel(Math.cos(a)*sp,2.6+Math.random()*2.2,Math.sin(a)*sp).setAngvel({x:rnd(14),y:rnd(14),z:rnd(14)}).setLinearDamping(.9).setAngularDamping(.6));
        world.createCollider(RAP.ColliderDesc.cuboid(.085,.006,.06).setMass(.04).setFriction(.7).setRestitution(.2),body);
        deb[k]={body,life:DEB_LIFE};debG.paint(k,cols[Math.floor(Math.random()*cols.length)]);
      }
    }catch(e){fail(e);return 0}
    return DEB_PER;
  }
  // push every prop within r meters of (x,z) outward at up to v m/s (a woof, a crash). Returns how many were pushed.
  function blast(x,z,r,v){
    if(!world||!(r>0))return 0;let n=0;
    try{for(const p of props){if(!p.body)continue;const dx=p.x-x,dz=p.z-z,d=Math.hypot(dx,dz);if(d>r)continue;
      const k=(v>0?v:3)*(1-d/r)*PROPS.KINDS[p.kind].m;p.body.applyImpulse({x:d>1e-3?dx/d*k:0,y:k*.5,z:d>1e-3?dz/d*k:0},true);n++}}catch(e){fail(e);return 0}
    if(n)live=Math.max(live,1);return n;
  }

  /* ---------- every frame: a fixed 60 Hz step ---------- */
  // is there anything to simulate? a prop on the move, debris in the air, or a car or rolling chair within 1.8 m of a prop
  function nearProp(c){if(near||!c)return;for(const p of props){const dx=p.x-c.x,dz=p.z-c.z;if(dx*dx+dz*dz<3.24){near=true;return}}}
  function busy(){
    if(live>0||deb.length)return true;
    near=false;eachCar(nearProp);
    if(!near)for(const c of dirtyChairs){nearProp(c);if(near)break}
    return near;
  }
  function frame(dt){
    if(state==="idle"){state="wait";setTimeout(load,350)} // the first frame is on screen before anything is fetched
    stats.steps=0;if(!world){stats.ms=0;return}
    const t0=performance.now();
    try{
      const n=PROPS.ticks(clock,dt,STEP,MAXSTEP);
      if(n&&!busy())idle=true; // everything rests and nobody is near a prop: nothing to simulate
      else if(n){resync=idle;idle=false;for(let i=0;i<n;i++){syncKin(n-i);resync=false;world.step()}readBack();stats.steps=n}
      debFrame(dt);
    }catch(e){fail(e)}
    stats.ms=performance.now()-t0;
  }
  // test hook: the average cost in ms of one physics step (cars synced, bodies read back)
  function bench(n){if(!world)return -1;n=n||60;resync=idle;idle=false;const t0=performance.now();for(let i=0;i<n;i++){syncKin(1);resync=false;world.step();readBack()}return(performance.now()-t0)/n}

  return{VER,SRC,floor,clear,build,frame,burst,blast,bench,
    track:c=>{if(c)extra.add(c)},untrack:c=>{extra.delete(c)},
    get ready(){return!!world},get state(){return state},get error(){return err},get props(){return props},get stats(){return stats},get idle(){return idle}};
})();
