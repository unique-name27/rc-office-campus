/* ===================== game part 3: play (cars, modes, camera, input, worlds, elevator, doors, routes, races, coffee) ===================== */
function newCar(x,z,h,paint,kind){return{kind:kind||"car",jumpReq:false,jumpCd:0,phase:0,x,z,y:0,vy:0,h,camH:h,vx:0,vz:0,vF:0,lat:0,air:false,pitch:0,roll:0,steer:0,thr:0,boost:1,boosting:false,drift:false,driftDir:0,driftT:0,gPrev:0,squash:0,paint,vis:null,cup:false,sk:[null,null],stuck:0,rev:0,wi:0,lastHit:0,airT:0,
  // skills: car drift charge (tier) and turbo; boost lockout; jump buffer; cat air jumps and flip; dog woof; sx counts skill events for presence,
  // skEv names the last one ("t1"/"t2"/"j"/"w", sent as "sk"). Not c.sk: that is the two wheels' last skid-mark points, and a string there
  // made every later frame throw (the game froze after the first turbo, double jump or woof)
  driftTier:0,driftCd:0,turboT:0,turboPend:0,boostLock:false,jumpBuf:0,airJumps:0,bonk:false,flipT:0,woofReq:false,woofCd:0,woofT:0,sx:0,sl:0,skEv:""}}
const PAINTS=[["#E4572E","Tomato"],["#2F6FED","Cobalt"],["#F2C14E","Taxi"],["#2E9C7A","Racing green"],["#8E6FBF","Grape"],["#FF2E97","Hot pink"],["#22B8CF","Teal"],["#F4F1EA","Pearl"],["#1F2421","Carbon"]];
let paint=store.get("rc-paint");if(!PAINTS.some(p=>p[0]===paint))paint=PAINTS[Math.floor(Math.random()*7)][0];
const me=newCar(0,0,0,paint,(()=>{const a=store.get("rc-av");return a==="dog"||a==="cat"?a:"car"})());
if(me.kind!=="car"){const c=store.get("rc-coat-"+me.kind),list=COATS[me.kind];paint=me.paint=list.some(x=>x[0]===c)?c:list[0][0]}
const bot=newCar(0,0,0,"#22B8CF");bot.name="Mailbot";
let BOTPATH=[[0,0]];
function spawn(c,x,z,h){c.x=x;c.z=z;c.h=c.camH=h;c.vx=c.vz=c.vF=c.vy=c.lat=0;c.hop=false;c.jumpReq=false;c.y=groundY(x,z);c.gPrev=c.y;c.air=false;c.drift=false;c.boost=1;c.sk=[null,null];c.pitch=c.roll=0;
  c.driftT=0;c.driftTier=0;c.driftCd=0;c.turboT=0;c.turboPend=0;c.boostLock=false;c.jumpBuf=0;c.jumpCd=0;c.airJumps=0;c.bonk=false;c.flipT=0;c.woofReq=false;c.woofCd=0;c.woofT=0;c.squash=0;c.airT=0}
const G=12,CRAD=.155,AX=.13,IDLE={thr:0,steer:0,boost:false,drift:false,park:true};
// handling per avatar: top speed, boost speed, acceleration, turn rate, side grip, reverse speed, jump speed (m/s), body radius
const AVP={car:{max:7.2,bmax:11.5,acc:11,bacc:20,turn:3.3,grip:13,rev:3.2,jump:3.4,drift:true,r:.155,ax:.13},
  dog:{max:6.2,bmax:9.2,acc:15,bacc:22,turn:4.4,grip:22,rev:2.2,jump:3.8,drift:false,r:.15,ax:.12},
  cat:{max:6.6,bmax:9.8,acc:17,bacc:24,turn:5,grip:24,rev:2.4,jump:5,drift:false,r:.12,ax:.1}};
// how tall each avatar is (for ceilings: the underside of a desk, table, parked car or bench above you)
const BODY_H={car:.2,dog:.52,cat:.45};
// is there headroom for this avatar at (x,y,z)? (the RC car can sit under a bench that a dog would not fit under)
function roomFor(kind,x,z,y){const bh=BODY_H[kind]||.2,l=query(x,z,.1,8);for(let i=0;i<l.length;i++){const p=l[i];if(p.u==null||x<p.x0||x>p.x1||z<p.z0||z>p.z1)continue;if(y<p.u-.02&&y+bh>p.u+.02)return false}return true}
// the ground under (x,z): ramps for everyone; animals can also stand on desk tops, tables, sofas, counters, parked cars...
// A surface counts only if your feet were already at or above it at the start of this step (y0), so jumping up from
// underneath never pops you through it.
function surfaceY(c,x,z,y0){
  let g=groundY(x,z);if(c.kind==="car")return g;
  const top=Math.max(y0,c.gPrev)+.04,l=query(x,z,.1,8);
  for(let i=0;i<l.length;i++){const p=l[i];if(p.h>g&&p.h<=top&&x>=p.x0-.06&&x<=p.x1+.06&&z>=p.z0-.06&&z<=p.z1+.06)g=p.h}
  return g;
}
let shake=0;
function carStep(c,ctl,dt,isMe){
  const P=AVP[c.kind]||AVP.car,fx_=-Math.sin(c.h),fz_=-Math.cos(c.h),rx=-fz_,rz=fx_;
  let vF=c.vx*fx_+c.vz*fz_;const vR=c.vx*rx+c.vz*rz,sp=Math.abs(vF);let ground=!c.air;
  c.jumpCd=Math.max(0,c.jumpCd-dt);c.jumpBuf=Math.max(0,c.jumpBuf-dt);c.driftCd=Math.max(0,c.driftCd-dt);c.woofCd=Math.max(0,c.woofCd-dt);c.turboT=Math.max(0,c.turboT-dt);
  c.rubT=Math.max(0,(c.rubT||0)-dt); // touching a wall lately: the grind sound
  if(ctl.park){c.jumpBuf=0;c.turboPend=0} // countdowns, cut-scenes, result cards: no skill fires
  // jump: a press you can't use yet is kept for .2 s and fires when you land. Cats get one more jump in the air:
  // press again, or just keep holding jump and it fires by itself near the top of the first leap.
  if(c.jumpReq){c.jumpReq=false;if(!ctl.park){if(!ground&&c.kind==="cat"&&c.airJumps<1)vF=airJump(c,P,vF,isMe);else c.jumpBuf=.2}}
  if(c.kind==="cat"&&ctl.jumpHeld&&!ground&&c.hop&&!c.bonk&&c.airJumps<1&&c.vy<=.5&&!ctl.park)vF=airJump(c,P,vF,isMe);
  if(c.jumpBuf>0&&ground&&c.jumpCd<=0&&!ctl.park){c.jumpBuf=0;c.bonk=false;c.vy=Math.max(P.jump,Math.max(c.vy,0)+P.jump*.6);c.hop=true;c.y+=.01;c.air=true;ground=false;c.jumpCd=.3;c.squash=.4;if(isMe){SFX.jump(c.kind);for(let k=0;k<3;k++)puff(c.x+(Math.random()-.5)*.2,.03,c.z+(Math.random()-.5)*.2,smokeCol(c))}}
  // the dog's big woof: pushes chairs (and the Mailbot) away; at most once every 1.5 s
  if(c.woofReq){c.woofReq=false;if(c.kind==="dog"&&c.woofCd<=0&&!ctl.park){c.woofCd=1.5;woofAt(c.x,c.z,c);if(isMe){c.sx++;c.skEv="w";presDirty=true;skillFx(c,"woof",1)}}}
  // a turbo earned in the air (drift released mid-jump) pays out on landing
  if(c.turboPend&&ground){vF=payTurbo(c,c.turboPend,vF,P,isMe);c.turboPend=0}
  // boost: an empty meter locks until it has refilled to a quarter (no flicker while Shift stays held)
  if(c.boost<=.02)c.boostLock=true;else if(c.boostLock&&c.boost>=.25)c.boostLock=false;
  c.boosting=!!ctl.boost&&!c.boostLock&&c.boost>.02&&ctl.thr>=0&&!ctl.park;
  if(c.boosting)c.boost=Math.max(0,c.boost-.42*dt);else c.boost=Math.min(1,c.boost+.11*dt);
  let thr=ctl.park?0:(c.boosting?1:ctl.thr);c.thr=thr;
  const fast=c.boosting||c.turboT>0,maxF=fast?P.bmax:P.max,acc=fast?P.bacc:P.acc;
  if(ground){
    if(ctl.park){const r=12*dt;vF=Math.abs(vF)<r?0:vF-Math.sign(vF)*r}
    else if(thr>0){if(vF<-.3)vF=Math.min(0,vF+18*dt);else if(vF<maxF)vF=Math.min(maxF,vF+acc*thr*dt*(1-.5*Math.max(0,vF)/maxF))}
    else if(thr<0){if(vF>.3)vF=Math.max(0,vF+18*thr*dt);else if(vF>-P.rev)vF=Math.max(-P.rev,vF+8*thr*dt)}
    else{const r=2.2*dt;vF=Math.abs(vF)<r?0:vF-Math.sign(vF)*r}
    if(vF>maxF)vF=Math.max(maxF,vF-6*dt);if(vF<-P.rev)vF=Math.min(-P.rev,vF+6*dt);
  }else if(!P.drift&&thr>0&&!ctl.park&&vF<maxF*.75)vF=Math.min(maxF*.75,vF+P.acc*.45*thr*dt); // animals can push forward mid-leap
  c.steer+=((ctl.park?0:ctl.steer)-c.steer)*Math.min(1,dt*10);
  // charged drift: the charge builds while sliding on the ground. Let go after .7 s (blue) for a turbo; at 1.4 s
  // (orange) the big turbo fires by itself, and holding the drift through a long bend starts the next charge.
  const want=P.drift&&ctl.drift&&ground&&sp>2.4&&Math.abs(ctl.steer)>.2&&c.driftCd<=0&&!ctl.park;
  if(want&&!c.drift){c.drift=true;c.driftDir=Math.sign(ctl.steer);c.driftT=0;c.driftTier=0}
  if(c.drift){
    if(ground)c.driftT+=dt;
    const tier=c.driftT>=1.4?2:c.driftT>=.7?1:0;if(tier>c.driftTier){c.driftTier=tier;if(isMe&&tier===1)SFX.tier()}
    let pay=0,end=false;
    if(ctl.park||sp<1.4)end=true;                           // stopped (a wall) or parked: the charge is lost
    else if(c.driftTier===2){pay=2;end=true;c.driftCd=.3}   // full charge fires by itself
    else if(!ctl.drift){pay=c.driftTier;end=true}           // let go: pay what's charged
    if(end){c.drift=false;c.driftTier=0;c.driftT=0;if(pay){if(ground)vF=payTurbo(c,pay,vF,P,isMe);else c.turboPend=pay}}
  }
  let yaw;
  if(c.drift&&ground)yaw=(c.driftDir+c.steer*.6)*1.55*clamp(sp/2.5,0,1);
  else yaw=c.steer*(ground?P.turn:.7)*(P.drift?clamp(sp/1.3,0,1):Math.max(.5,clamp(sp/.8,0,1)))*(1-.3*clamp(sp/11,0,1))*(vF<0?-1:1); // animals can turn on the spot
  c.h+=yaw*dt;
  const nfx=-Math.sin(c.h),nfz=-Math.cos(c.h),nrx=-nfz,nrz=nfx;
  const wx=fx_*vF+rx*vR,wz=fz_*vF+rz*vR;
  if(c.drift&&ground){
    // arcade drift: the slide keeps its speed while the velocity trails the nose by a steady angle
    const spd=Math.hypot(wx,wz)*(1-.06*dt);let va=Math.atan2(-wx,-wz);va+=angDiff(va,c.h-c.driftDir*.2)*Math.min(1,dt*6);
    c.vx=-Math.sin(va)*spd;c.vz=-Math.cos(va)*spd;c.vF=c.vx*nfx+c.vz*nfz;c.lat=c.vx*nrx+c.vz*nrz;
  }else{
    const f2=wx*nfx+wz*nfz;let r2=wx*nrx+wz*nrz;if(ground)r2*=Math.exp(-P.grip*dt);
    c.lat=r2;c.vF=f2;c.vx=nfx*f2+nrx*r2;c.vz=nfz*f2+nrz*r2;
  }
  const px0=c.x,pz0=c.z;c.x+=c.vx*dt;c.z+=c.vz*dt;
  // a near-vertical step in the ground (the sides of a kick ramp) acts like a wall instead of a launch pad
  {const rise=groundY(c.x,c.z)-Math.max(c.y,c.gPrev),mx=c.x-px0,mz=c.z-pz0,ml=Math.hypot(mx,mz);
   let wall=rise>.03&&rise>ml*1.05;
   if(!wall&&ml>1e-5&&c.y<=c.gPrev+.02){const ux=mx/ml,uz=mz/ml,ah=groundY(c.x+ux*.03,c.z+uz*.03);wall=ah-groundY(c.x-ux*.03,c.z-uz*.03)>.063&&ah>c.y+.015}
   if(wall){
     let sx=c.x,sz=c.z;{const b0=Math.max(c.y,c.gPrev)+.015;let a=0,b=1;for(let i=0;i<6;i++){const m=(a+b)/2;if(groundY(px0+mx*m,pz0+mz*m)>b0)b=m;else a=m}if(b<1){sx=px0+mx*b;sz=pz0+mz*b}}const gx=groundY(sx+.05,sz)-groundY(sx-.05,sz),gz=groundY(sx,sz+.05)-groundY(sx,sz-.05),gl=Math.hypot(gx,gz);
     c.x=px0;c.z=pz0;
     if(gl>1e-6){const dx=gx/gl,dz=gz/gl,vn=c.vx*dx+c.vz*dz;if(vn>0){c.vx-=1.3*vn*dx;c.vz-=1.3*vn*dz;if(isMe&&vn>1.4){SFX.bump(vn);if(c.kind==="car"&&vn>3)SFX.crash(vn);shake=Math.max(shake,Math.min(.6,vn*.08))}}}else{c.vx*=-.3;c.vz*=-.3}
   }}
  // vertical
  const y0=c.y;c.vy-=G*dt;c.y+=c.vy*dt;
  // ceilings: rising into the underside of something above you stops the jump
  if(c.vy>0){const bh=BODY_H[c.kind]||.2,l=query(c.x,c.z,.05,8);for(let i=0;i<l.length;i++){const p=l[i];if(p.u==null||c.x<p.x0||c.x>p.x1||c.z<p.z0||c.z>p.z1)continue;if(y0+bh<=p.u+.02&&c.y+bh>p.u){c.y=Math.max(y0,p.u-bh);c.vy=0;c.bonk=true}}}
  // and nobody leaves through the floor's ceiling
  if(WKIND==="floor"){const bh=BODY_H[c.kind]||.2;if(c.y+bh>H-.05){c.y=H-.05-bh;if(c.vy>0){c.vy=0;c.bonk=true}}}
  const g=surfaceY(c,c.x,c.z,y0);
  if(c.y<=g){
    // a fall longer than your own hop lands hard (thud, dust, a little shake); a plain hop lands softly
    const heavy=c.air&&(c.kind==="cat"?-c.vy>8.5:c.vy<-1.5&&(!c.hop||-c.vy>P.jump+.6)); // cats land on their feet from up to ~3 m
    if(heavy){c.squash=Math.min(1,-c.vy/5);if(isMe){SFX.land(-c.vy);FX.land(-c.vy,c);shake=Math.max(shake,Math.min(.6,-c.vy*.08))}for(let k=0;k<4;k++)puff(c.x+(Math.random()-.5)*.3,.03,c.z+(Math.random()-.5)*.3,smokeCol(c))}
    else if(c.air&&c.vy<-1){c.squash=Math.min(.5,-c.vy/9);if(isMe&&c.kind!=="car")SFX.step(c.kind)}
    c.vy=dt>0?Math.min(4.5,(g-c.gPrev)/dt,.4*Math.hypot(c.vx,c.vz)):0;c.y=g;if(c.air&&!c.hop&&c.airT>.35&&isMe)toastAir(c.airT);c.air=false;c.airT=0;c.hop=false;c.airJumps=0;c.bonk=false;
  }else{c.air=(c.y-g)>.012;if(c.air)c.airT+=dt}
  c.gPrev=g;
  // static collisions (two circles along the body)
  let hit=0,hx=0,hz=0;
  for(let it=0;it<2;it++)for(const s of[1,-1]){
    const ox=nfx*P.ax*s,oz=nfz*P.ax*s,bh=BODY_H[c.kind]||.2;
    const touch=col=>{if(circleVs(col,c.x+ox,c.z+oz,P.r)){c.rubT=.12;c.x+=HIT.nx*HIT.pen;c.z+=HIT.nz*HIT.pen;const vn=c.vx*HIT.nx+c.vz*HIT.nz;
        if(vn<0){c.vx-=1.3*vn*HIT.nx;c.vz-=1.3*vn*HIT.nz;c.vx*=.94;c.vz*=.94;if(-vn>hit){hit=-vn;hx=c.x+ox-HIT.nx*P.r;hz=c.z+oz-HIT.nz*P.r}}}};
    let list=query(c.x+ox,c.z+oz,P.r+.05,1);
    for(let q=0;q<list.length;q++){const col=list[q];if((c.y>.7&&!col.tall)||(col.top!=null&&c.y>=col.top-.03)||(col.minY!=null&&c.y<col.minY))continue;touch(col)}
    list=query(c.x+ox,c.z+oz,P.r+.05,8);
    for(let q=0;q<list.length;q++){const p=list[q];if(p.u!=null&&p.u<c.y+bh&&c.y<p.h-.03)touch(p)}
  }
  // chairs
  if(c.y<.5)for(const s of[1,-1]){
    const px=c.x+nfx*P.ax*s,pz=c.z+nfz*P.ax*s;
    for(const ch of chairsNear(px,pz,.5)){
      const dx=px-ch.x,dz=pz-ch.z,rs=P.r+CHR,d2=dx*dx+dz*dz;if(d2>=rs*rs)continue;
      const d=Math.sqrt(d2)||1e-4,nx=dx/d,nz=dz/d,pen=rs-d;
      c.x+=nx*pen*.4;c.z+=nz*pen*.4;ch.x-=nx*pen*.6;ch.z-=nz*pen*.6;
      const rvx=c.vx-ch.vx,rvz=c.vz-ch.vz,vn=rvx*nx+rvz*nz;
      if(vn<0){const j=-(1.35*vn)/(1+1/1.6);c.vx+=j*nx;c.vz+=j*nz;ch.vx-=j*nx/1.6;ch.vz-=j*nz/1.6;ch.va+=(rvx*-nz+rvz*nx)*.9;if(-vn>1.1&&isMe)bumpedChair(ch,-vn)}
      ch.awake=true;chairCell(ch);dirtyChairs.add(ch);
    }
  }
  c.x=clamp(c.x,-PW/2+.25,PW/2-.25);c.z=clamp(c.z,-PD/2+.25,PD/2-.25);
  if(hit>1.4){if(isMe){SFX.bump(hit);if(c.kind==="car"&&hit>3)SFX.crash(hit);shake=Math.max(shake,Math.min(.8,hit*.09))}if(hit>2.2)for(let k=0;k<Math.min(14,hit*2);k++)spark(hx,c.y+.08,hz,"#FFD27A",hit*.5)}
  if(hit>2.2)FX.crash(hx,hz,hit,c,isMe); // pre-recorded physics moments (game-2d-fx.js)
}
function smokeCol(c){const s=S.smoke[0];return s==="paint"?bright(c.paint):s}
function chairsStep(dt){
  for(const ch of dirtyChairs){
    if(!ch.awake){dirtyChairs.delete(ch);continue}
    {const v=Math.hypot(ch.vx,ch.vz);if(v>6){ch.vx*=6/v;ch.vz*=6/v}} // never faster than 6 m/s (no passing through walls)
    ch.x+=ch.vx*dt;ch.z+=ch.vz*dt;ch.a+=ch.va*dt;
    const f=Math.exp(-2.6*dt);ch.vx*=f;ch.vz*=f;ch.va*=Math.exp(-3*dt);
    for(let it=0;it<2;it++){const list=query(ch.x,ch.z,CHR+.05,2);for(let q=0;q<list.length;q++){if(circleVs(list[q],ch.x,ch.z,CHR)){ch.x+=HIT.nx*HIT.pen;ch.z+=HIT.nz*HIT.pen;const vn=ch.vx*HIT.nx+ch.vz*HIT.nz;if(vn<0){ch.vx-=1.4*vn*HIT.nx;ch.vz-=1.4*vn*HIT.nz}}}
      // desk and table tops (walker-only blocks): a chair may tuck in a little but not slide through
      const l4=query(ch.x,ch.z,CHR+.05,4);for(let q=0;q<l4.length;q++){const c=l4[q];if(!c.b||c.tall||(c.m&3))continue;_CB.x0=c.x0+.3;_CB.x1=c.x1-.3;_CB.z0=c.z0+.3;_CB.z1=c.z1-.3;if(_CB.x1<=_CB.x0||_CB.z1<=_CB.z0)continue;
        if(circleVs(_CB,ch.x,ch.z,CHR)){ch.x+=HIT.nx*HIT.pen;ch.z+=HIT.nz*HIT.pen;const vn=ch.vx*HIT.nx+ch.vz*HIT.nz;if(vn<0){ch.vx-=1.4*vn*HIT.nx;ch.vz-=1.4*vn*HIT.nz}}}}
    for(const o of chairsNear(ch.x,ch.z,.6)){if(o===ch)continue;const dx=ch.x-o.x,dz=ch.z-o.z,d2=dx*dx+dz*dz;if(d2>=4*CHR*CHR)continue;const d=Math.sqrt(d2)||1e-4,nx=dx/d,nz=dz/d,pen=2*CHR-d;ch.x+=nx*pen*.5;ch.z+=nz*pen*.5;o.x-=nx*pen*.5;o.z-=nz*pen*.5;const vn=(ch.vx-o.vx)*nx+(ch.vz-o.vz)*nz;if(vn<0){const j=-vn*.6;ch.vx+=j*nx;ch.vz+=j*nz;o.vx-=j*nx;o.vz-=j*nz}o.awake=true;dirtyChairs.add(o);chairCell(o)}
    ch.x=clamp(ch.x,-PW/2+.4,PW/2-.4);ch.z=clamp(ch.z,-PD/2+.4,PD/2-.4);chairCell(ch);
    if(Math.abs(ch.vx)+Math.abs(ch.vz)+Math.abs(ch.va)<.03){ch.vx=ch.vz=ch.va=0;ch.awake=false}
  }
  if((dirtyChairs.size||chairsMoved)&&chairG.length){for(const ch of dirtyChairs){chairMatrices(ch);figChair(ch)}if(chairsMoved){chairs.forEach(chairMatrices);figAll()}chairG.forEach(g=>g.commit());chairsMoved=false}
}
const _CB={b:1,x0:0,x1:0,z0:0,z1:0};
/* ---------- skills: the cat's air jump, the car's turbo, the dog's woof ---------- */
// one extra jump in the air: +.75 m of height on top of whatever the cat has, a little push forward, and a flip
function airJump(c,P,vF,isMe){
  c.airJumps++;c.vy=Math.sqrt(Math.max(c.vy,0)**2+2*G*.75);c.hop=true;c.squash=.25;
  if(vF<P.max){const fx_=-Math.sin(c.h),fz_=-Math.cos(c.h),add=Math.min(P.max,vF+1.2)-vF;c.vx+=fx_*add;c.vz+=fz_*add;vF+=add}
  if(isMe){c.sx++;c.skEv="j";presDirty=true;skillFx(c,"jump2",1)}
  return vF;
}
// a drift turbo: tier 1 = +2.6 m/s for .4 s, tier 2 = +4 m/s for .7 s (never past 13 m/s), and some boost back
function payTurbo(c,tier,vF,P,isMe){
  if(vF<=0)return vF;
  vF=Math.min(P.bmax+1.5,vF+(tier===2?4:2.6));c.boost=Math.min(1,c.boost+(tier===2?.25:.15));c.turboT=Math.max(c.turboT,tier===2?.7:.4);
  if(isMe){c.sx++;c.sl=tier;c.skEv="t"+tier;presDirty=true;skillFx(c,"turbo",1,tier)}
  return vF;
}
// chairs within 2.4 m slide away (the nearer, the faster) and spin; the Mailbot backs off
function woofAt(x,z,src){
  PHYS.blast(x,z,2.6,3.2); // loose boxes, bins and cones blow over too
  walkStartle(x,z,2.4);     // and coworkers walking by hop
  for(const ch of chairsNear(x,z,2.4)){
    const dx=ch.x-x,dz=ch.z-z,d=Math.hypot(dx,dz);if(d>2.4)continue;
    const a=d>1e-3?Math.atan2(dz,dx):Math.random()*Math.PI*2,v=1+3*(1-d/2.4),ux=Math.cos(a),uz=Math.sin(a),vn=ch.vx*ux+ch.vz*uz;
    if(vn<v){ch.vx+=(v-vn)*ux;ch.vz+=(v-vn)*uz} // at least v outward: woofs don't stack
    ch.va=clamp(ch.va+(Math.random()<.5?-1:1)*(2+Math.random()),-6,6);ch.awake=true;chairCell(ch);dirtyChairs.add(ch);
  }
  if(src!==bot&&BOTPATH.length>1){const dx=bot.x-x,dz=bot.z-z,d=Math.hypot(dx,dz);if(d<3){bot.rev=.8;const ux=dx/(d||1),uz=dz/(d||1),vn=bot.vx*ux+bot.vz*uz;if(vn<2){bot.vx+=(2-vn)*ux;bot.vz+=(2-vn)*uz}pop(bot.x,bot.y+.55,bot.z,"!","#FFB547")}}
}
// what everyone sees and hears when a skill fires (also run for other players' skills, quieter with distance)
function skillFx(c,ev,vol,tier){
  const y=c.y;
  if(ev==="jump2"){SFX.jump2(vol);if(!REDUCED)c.flipT=.4;for(let k=0;k<6;k++)spark(c.x,y+.1,c.z,"#FFFFFF",1.2);ringPuff(c.x,y+.04,c.z,6,"#FFFFFF",1.6)}
  else if(ev==="woof"){SFX.woof(vol);c.woofT=.35;c.squash=Math.max(c.squash,.3);ringPuff(c.x,y+.05,c.z,10,"#FFFFFF",3);if(c===me)shake=Math.max(shake,.2)}
  else if(ev==="turbo"){
    SFX.turbo(tier,vol);const fx_=-Math.sin(c.h),fz_=-Math.cos(c.h),col=tier===2?"#FFA43C":"#5BC0FF";
    for(let k=0;k<(tier===2?18:10);k++)spark(c.x-fx_*.25,y+.05,c.z-fz_*.25,col,tier===2?2.8:2.2);
    if(tier===2)pop(c.x,y+.42,c.z,"TURBO!",col);
  }
}
function tidyChairs(){chairs.forEach(c=>{c.x=c.hx;c.z=c.hz;c.a=c.ha;c.vx=c.vz=c.va=0;c.awake=false;chairCell(c)});dirtyChairs.clear();chairsMoved=true}
function botCtl(c,dt){
  if(BOTPATH.length<2)return IDLE;
  const [tx,tz]=BOTPATH[c.wi%BOTPATH.length];if(Math.hypot(tx-c.x,tz-c.z)<1.3)c.wi=(c.wi+1)%BOTPATH.length;
  const hd=Math.atan2(-(tx-c.x),-(tz-c.z)),d=angDiff(c.h,hd);
  if(c.rev>0){c.rev-=dt;return{thr:-1,steer:-Math.sign(d),boost:false,drift:false}}
  if(Math.abs(c.vF)<.4&&!c.air)c.stuck+=dt;else c.stuck=0;if(c.stuck>1.4){c.stuck=0;c.rev=.9;c.wi=(c.wi+1)%BOTPATH.length}
  return{thr:c.vF>5.6?0:Math.abs(d)>.7?.45:.9,steer:clamp(d*2.4,-1,1),boost:false,drift:false};
}
function wheelPos(c,lx,lz){const ch=Math.cos(c.h),sh=Math.sin(c.h);return[c.x+lx*ch+lz*sh,c.z-lx*sh+lz*ch]}
let T=0;
function syncCar(c,dt,remote){
  if(!c.vis)return;const v=c.vis,sp=Math.abs(c.vF);
  v.g.position.set(c.x,c.y,c.z);v.g.rotation.y=c.h;
  if(!remote){
    let tp,tr;
    if(!c.air){const fx_=-Math.sin(c.h),fz_=-Math.cos(c.h),rx=-fz_,rz=fx_;tp=Math.atan((groundY(c.x+fx_*.15,c.z+fz_*.15)-groundY(c.x-fx_*.15,c.z-fz_*.15))/.3);tr=Math.atan((groundY(c.x+rx*.1,c.z+rz*.1)-groundY(c.x-rx*.1,c.z-rz*.1))/.2)+clamp(-c.steer*Math.min(sp/7,1)*.09,-.1,.1)+(c.drift?-c.driftDir*.05:0);tp+=c.boosting?.04:c.thr*.02}
    else{tp=clamp(Math.atan2(c.vy,Math.max(1,sp)),-.55,.55)*.8;tr=c.roll*.98}
    c.pitch+=(tp-c.pitch)*Math.min(1,dt*(c.air?4:14));c.roll+=(tr-c.roll)*Math.min(1,dt*10);
  }
  c.squash=Math.max(0,c.squash-dt*4);
  v.tilt.rotation.set(c.pitch,0,c.roll);v.tilt.position.y=-c.squash*.025;
  if(v.legs){animateAnimal(c,v,dt);skillPose(c,v,dt);v.head.visible=!(c===me&&mode==="drive"&&!fly&&camMode==="bumper");if(v.under)v.under.rotation.x=c.pitch;v.cup.visible=!!c.cup;return}
  v.wheels.forEach(w=>{w.sp.rotation.x-=c.vF/.055*dt;if(w.f)w.pv.rotation.y=c.drift?-c.driftDir*.32:c.steer*.42});
  v.ap.rotation.z=Math.sin(T*9)*.05*Math.min(1,sp/3)-c.steer*.06;v.ap.rotation.x=clamp(c.thr*-.12,-.2,.2);
  if(v.under&&S.glow){v.under.material.opacity=.65+Math.sin(T*4+c.x)*.15}
  if(v.under)v.under.rotation.x=c.pitch;
  const flame=c.boosting||c.turboT>0;v.flame.visible=flame;if(flame){const f=(c.turboT>0?1.1:.8)+Math.random()*.5;v.flame.scale.set(1,1,f)}
  v.cup.visible=!!c.cup;
  const skid=!c.air&&(c.drift||Math.abs(c.lat)>1.8||(c.thr<0&&c.vF>3));
  [-.128,.128].forEach((lx,k)=>{
    const [wx,wz]=wheelPos(c,lx,.14);
    if(skid){const y=groundY(wx,wz)+.005,l=c.sk[k];if(l&&Math.hypot(wx-l[0],wz-l[1])>.05){skidSeg(l[0],l[1],l[2],wx,wz,y,S.skid[0]==="paint"?bright(c.paint):S.skid[0]);c.sk[k]=[wx,wz,y]}else if(!l)c.sk[k]=[wx,wz,y];if(Math.random()<dt*14)puff(wx,.04,wz,smokeCol(c))}
    else c.sk[k]=null;
  });
  // drift charge sparks: blue once a turbo is earned, orange just before the big one fires
  if(c.drift&&c.driftTier>0&&Math.random()<dt*(c.driftT>1.1?32:20)){const [wx,wz]=wheelPos(c,c.driftDir*.13,.14);spark(wx,c.y+.03,wz,c.driftT>1.1?"#FFA43C":"#5BC0FF",.8)}
}
// the cat's flip turns about its middle; the dog's woof rears up on its hind legs
function skillPose(c,v,dt){
  v.tilt.position.z=0;
  if(c.flipT>0){c.flipT=Math.max(0,c.flipT-dt);const k=1-c.flipT/.4,th=-Math.PI*2*easeIO(k),cy=.2;v.tilt.rotation.x+=th;v.tilt.position.y+=cy-cy*Math.cos(th);v.tilt.position.z=-cy*Math.sin(th)}
  if(c.woofT>0){c.woofT=Math.max(0,c.woofT-dt);const k=1-c.woofT/.35,th=.35*Math.sin(Math.PI*k),zb=.15;v.tilt.rotation.x+=th;v.tilt.position.y+=zb*Math.sin(th);v.tilt.position.z+=zb*(1-Math.cos(th))}
}
function buildCars(){
  me.vis=makeAvatar(me.kind,me.paint);bot.vis=makeCar(bot.paint);
  for(const r of remotes.values()){r.car.vis=null;r.wvis=null}
}

/* ---------- navigation helpers (NAV over every floor + the outside) ---------- */
const navCache=new Map();
function navGrid(key){let g=navCache.get(key);if(!g){const m=key==="campus"?extModel():modelFor(key);if(!m)return null;try{g=NAV.grid(m)}catch(e){console.error(e);return null}navCache.set(key,g)}return g}
function navWorld(){const floors={};for(const k of floorKeys()){const m=modelFor(k);if(m)floors[k]=m}return{campus:extModel(),floors,grid:navGrid}}
function computeBotPath(){
  BOTPATH=[];const m=WM;if(!m)return;const g=navGrid(WKEY);if(!g)return;
  let cand=(m.dests||[]).filter(d=>d.kind!=="desk"&&isFinite(d.x));if(cand.length<3)cand=(m.dests||[]).filter(d=>isFinite(d.x));
  if(cand.length<2)return;
  const s=m.spawn||{x:0,z:0},pick=[];let px=s.x,pz=s.z;
  for(let k=0;k<5&&k<cand.length;k++){let best=null,bd=-1;for(const d of cand){if(pick.includes(d))continue;let dm=Math.hypot(d.x-px,d.z-pz);for(const p of pick)dm=Math.min(dm,Math.hypot(d.x-p.x,d.z-p.z));if(dm>bd){bd=dm;best=d}}if(!best)break;pick.push(best);px=best.x;pz=best.z}
  const pts=[];
  for(let k=0;k<pick.length;k++){const a=pick[k],b=pick[(k+1)%pick.length];let r=null;try{r=NAV.findPath(g,a.x,a.z,b.x,b.z)}catch(_){}if(!r||!r.pts||r.pts.length<2)continue;
    for(const p of (NAV.sample?NAV.sample(r.pts,2.4,0):r.pts.map(q=>({x:q[0],z:q[1]}))))pts.push([p.x,p.z])}
  BOTPATH=pts.length>=3?pts:[];
}

/* ---------- camera + modes ---------- */
let mode="overview",camMode="chase",fly=null,camYawOff=0,camDrag=false,topH=6.5,trans=false;
const camPos=new V3(),camLook=new V3(),_PP=new V3(),_LL=new V3();
const portrait=()=>innerWidth<innerHeight;
const ov={a:portrait()?Math.PI/2+.25:.45,e:.95,zoom:1,tx:0,tz:1,lastUser:-1e9};
const walker={x:0,z:0,yaw:0,pitch:-.05};
let tour=null;
function ovPose(P,L){
  const asp=camera.aspect||1,fov=asp<1?50:42,hf=2*Math.atan(Math.tan(fov*Math.PI/360)*asp);
  const camp=WKIND==="campus",R=asp<1?PD*(camp?.6:.64):PW*(camp?.56:.6),base=camp?60:30;
  const d=Math.max(base,R/Math.tan(hf/2))*ov.zoom;
  L.set(ov.tx,camp?6:0,ov.tz);P.set(ov.tx+Math.sin(ov.a)*Math.cos(ov.e)*d,Math.sin(ov.e)*d,ov.tz+Math.cos(ov.a)*Math.cos(ov.e)*d);
}
function walkPose(P,L){const arc=tour?Math.sin(easeIO(Math.min(1,tour.t))*Math.PI)*Math.min(6,Math.hypot(tour.to.x-tour.from.x,tour.to.z-tour.from.z)*.15):0;P.set(walker.x,1.62+arc,walker.z);L.set(walker.x-Math.sin(walker.yaw)*Math.cos(walker.pitch),P.y+Math.sin(walker.pitch),walker.z-Math.cos(walker.yaw)*Math.cos(walker.pitch))}
function drivePose(c,P,L){
  const h=c.camH+camYawOff,fx_=-Math.sin(h),fz_=-Math.cos(h),sp=Math.min(11,Math.hypot(c.vx,c.vz));
  const ah=c.kind==="dog"?.16:c.kind==="cat"?.08:0;
  if(camMode==="bumper"){const ey=c.kind==="dog"?.45:c.kind==="cat"?.34:.17,ez=c.kind==="car"?.04:Math.min(c.kind==="dog"?.34:.27,(AVP[c.kind]||AVP.car).ax+(AVP[c.kind]||AVP.car).r-.04);P.set(c.x-Math.sin(c.h)*ez,c.y+ey,c.z-Math.cos(c.h)*ez);L.set(c.x-Math.sin(c.h)*3,c.y+ey-.05,c.z-Math.cos(c.h)*3);return}
  if(camMode==="high"){P.set(c.x-fx_*3.6,c.y+3.4,c.z-fz_*3.6);L.set(c.x+fx_*1.2,c.y,c.z+fz_*1.2);return}
  if(camMode==="top"){const lx=c.x+c.vx*.3,lz=c.z+c.vz*.3;L.set(lx,c.y*.3,lz);P.set(lx,topH,lz+topH*.03);return}
  const dist=1.05+ah*1.2+sp*.035;P.set(c.x-fx_*dist,c.y+.42+ah*1.3+sp*.008,c.z-fz_*dist);L.set(c.x+fx_*.9,c.y+.12+ah,c.z+fz_*.9);
}
function fovFor(m){if(m==="overview")return camera.aspect<1?50:42;if(m==="walk")return 70;return camMode==="bumper"?76:camMode==="high"?55:camMode==="top"?50:62}
function poseFor(m,P,L){if(m==="overview")ovPose(P,L);else if(m==="walk")walkPose(P,L);else drivePose(me,P,L)}
const CAMNAMES={chase:"Chase cam",bumper:"Bumper cam",high:"High cam",top:"Top-down"};
const camName=m=>m==="bumper"&&me.kind!=="car"?"Eye-level cam":CAMNAMES[m];
function setMode(m){
  const was=mode;mode=m;document.body.dataset.mode=m;
  $("bSwap").innerHTML=m==="walk"?'Drive <kbd>C</kbd>':(WKIND==="campus"?'Walk <kbd>C</kbd>':'Walk <kbd>C</kbd>');
  $("bCam").innerHTML=camName(camMode)+' <kbd>V</kbd>';
  if(m!=="walk"){tour=null;if(document.pointerLockElement)document.exitPointerLock()}
  if(m!=="drive"){if(run)runCancel();if(race)raceCancel();if(brawl)brawlLeave("You left the brawl.");closeResult()}
  if(m!=="overview"){closeTimes();tip.hidden=true;cv.style.cursor=""}
  if(was==="overview"&&m!=="overview"&&$("start").contains(document.activeElement))document.activeElement.blur(); // arrow keys steer, not a chip
  if(m==="overview")hideElev();
  if(was==="walk"&&m!=="walk"&&innerWidth<=760)closeFind();
  setHelp();updateLookCard(true);renderStart();
}
function flyTo(m,dur){
  audio();if(m==="walk"&&mode==="drive"){const rx=Math.cos(me.h),rz=-Math.sin(me.h);walker.x=clamp(me.x+rx*.7,-PW/2+1,PW/2-1);walker.z=clamp(me.z+rz*.7,-PD/2+1,PD/2-1);walker.yaw=me.h;walker.pitch=-.15;if(walkBlocked(walker.x,walker.z)){outer:for(const r of[1.2,1.8,2.6,3.6,5])for(let a=0;a<16;a++){const x=clamp(me.x+Math.cos(a*Math.PI/8)*r,-PW/2+1,PW/2-1),z=clamp(me.z+Math.sin(a*Math.PI/8)*r,-PD/2+1,PD/2-1);if(!walkBlocked(x,z)){walker.x=x;walker.z=z;break outer}}}}
  if(m==="drive"&&mode==="walk"){spawnNear(walker.x,walker.z,walker.yaw)}
  if(m==="drive")me.camH=me.h;
  fly={t:0,dur:REDUCED?.35:(dur||2.2),p0:camPos.clone(),l0:camLook.clone(),f0:camera.fov,to:m};
  document.body.dataset.fly="1";setMode(m);if(!REDUCED&&dur!==1)SFX.whoosh();
  stopKeys();
}
// put the car on a free spot near (x,z)
const spotFree=(px,pz)=>{const l=query(px,pz,.3,1);for(let i=0;i<l.length;i++)if(circleVs(l[i],px,pz,.22))return false;return Math.abs(px)<PW/2-.4&&Math.abs(pz)<PD/2-.4};
function spawnNear(x,z,h){
  const free=spotFree;
  const done=()=>lockPadAt(me.x,me.z);
  if(free(x,z)){spawn(me,x,z,h);done();return}
  for(const r of[.6,1,1.5,2.2,3,4.2,6])for(let a=0;a<16;a++){const px=x+Math.cos(a*Math.PI/8)*r,pz=z+Math.sin(a*Math.PI/8)*r;if(free(px,pz)){spawn(me,px,pz,h);done();return}}
  const s=WM.spawn||{x:0,z:0,a:0};spawn(me,s.x,s.z,s.a||0);done();
}
// Switching avatars in place. Two cases need a short step to the nearest good spot:
//  - the low RC car becomes a dog or cat under something low (a bench, a parked car): find headroom
//  - a dog or cat perched on a desk, counter or parked car becomes the RC car, which can only drive on the floor and
//    ramps: step down beside it instead of dropping through the top
const onPlat=(x,z)=>{const l=query(x,z,.1,8);for(let i=0;i<l.length;i++){const p=l[i];if(x>=p.x0-.06&&x<=p.x1+.06&&z>=p.z0-.06&&z<=p.z1+.06)return true}return false};
function makeRoomFor(kind){
  if(!root)return false;
  const perched=kind==="car"&&me.y>groundY(me.x,me.z)+.05&&onPlat(me.x,me.z);
  if(!perched&&roomFor(kind,me.x,me.z,me.y))return false;
  for(const r of[.3,.6,1,1.5,2.2,3,4.2])for(let a=0;a<16;a++){const px=me.x+Math.cos(a*Math.PI/8)*r,pz=me.z+Math.sin(a*Math.PI/8)*r;if(spotFree(px,pz)&&(!perched||!onPlat(px,pz))&&roomFor(kind,px,pz,groundY(px,pz))){spawn(me,px,pz,me.h);lockPadAt(me.x,me.z);return true}}
  if(perched){const s=WM.spawn||{x:0,z:0,a:0};spawnNear(s.x,s.z,s.a||0);return true}
  return false;
}
function stopKeys(){for(const k in keys)keys[k]=false;tc.gas=tc.brake=tc.boost=tc.drift=tc.jump=false;tc.joy=false;tc.jx=tc.jy=0;setKnob(0,0)}
let shadowHS=0,camHintShown=false,vShift=0;
function camFrame(dt,now){
  if(fly){
    fly.t+=dt/fly.dur;const t=Math.min(1,fly.t),e=easeIO(t);poseFor(fly.to,_PP,_LL);
    const p0=fly.p0,dy=_PP.y-p0.y,ey=dy<-4?Math.pow(t,2.1):dy>4?1-Math.pow(1-t,2.1):e;
    camPos.set(lerp(p0.x,_PP.x,e),lerp(p0.y,_PP.y,ey),lerp(p0.z,_PP.z,e));
    camLook.lerpVectors(fly.l0,_LL,easeIO(Math.min(1,t*1.15)));
    camera.fov=lerp(fly.f0,fovFor(fly.to),e);
    if(t>=1){fly=null;document.body.dataset.fly="0";if(mode==="drive"&&!camHintShown){camHintShown=true;toast(document.body.classList.contains("touch")?(camMode==="top"?"Push the stick the way you want to go. ":"Steer with the stick, press Go to drive. ")+SKILL_TOUCH[me.kind]:me.kind==="car"?"W A S D to drive · hold Space through a turn for a turbo · Shift boost · J jump":me.kind==="dog"?"W A S D to run · Space jump · Shift sprint · H big woof pushes chairs":"W A S D to run · Space jump, again (or keep holding) to double jump · Shift sprint")}}
  }else if(mode==="overview"){
    if(!REDUCED&&now-ov.lastUser>6000)ov.a+=dt*.035;
    ovPose(_PP,_LL);const k=1-Math.exp(-dt*6);camPos.lerp(_PP,k);camLook.lerp(_LL,k);camera.fov+=(fovFor("overview")-camera.fov)*k;
  }else if(mode==="walk"){
    walkPose(camPos,camLook);camera.fov+=(70-camera.fov)*Math.min(1,dt*6);
  }else{
    me.camH+=angDiff(me.camH,me.h)*Math.min(1,dt*(me.drift?3:5.5));
    if(!camDrag)camYawOff*=Math.exp(-dt*2.5);
    drivePose(me,_PP,_LL);const k=camMode==="bumper"?1:1-Math.exp(-dt*(camMode==="top"?7:camMode==="high"?5:9));
    camPos.lerp(_PP,k);camLook.lerp(_LL,k);
    if(camMode!=="top"&&WKIND==="floor"){camPos.x=clamp(camPos.x,-PW/2+.4,PW/2-.4);camPos.z=clamp(camPos.z,-PD/2+.4,PD/2-.4)}camPos.y=Math.max(.08,camPos.y);
    if(WKIND==="floor"&&camMode!=="top")camPos.y=Math.min(camPos.y,H-.15);
    const ft=fovFor("drive")+((me.boosting||me.turboT>0)&&camMode!=="top"&&!REDUCED?10:0);camera.fov+=(ft-camera.fov)*Math.min(1,dt*4);
  }
  camera.position.copy(camPos);
  if(shake>0&&!REDUCED){camera.position.x+=(Math.random()-.5)*shake*.06;camera.position.y+=(Math.random()-.5)*shake*.04;camera.position.z+=(Math.random()-.5)*shake*.06}
  shake=Math.max(0,shake-dt*2.5);
  camera.lookAt(camLook);
  // in the overview, center the scene in the gap between the start card (left) and the side panel (right)
  const vw=innerWidth,wantShift=mode==="overview"&&!fly&&vw>900?Math.round((Math.min(430,vw-28)+14-(272+14))/2):0;
  vShift+=(wantShift-vShift)*Math.min(1,dt*5);
  if(Math.abs(vShift)>.5)camera.setViewOffset(vw,innerHeight,-vShift,0,vw,innerHeight);else if(camera.view&&camera.view.enabled)camera.clearViewOffset();
  camera.near=clamp(camPos.y*.015,.02,.8);camera.far=WKIND==="campus"?900:400;camera.updateProjectionMatrix();
  if(sun){
    const dist=camPos.distanceTo(camLook),hs=dist<3?9:dist<10?16:dist<24?28:dist<60?50:Math.min(140,Math.max(PW,PD)*.62);
    const sc=sun.shadow.camera;if(hs!==shadowHS){shadowHS=hs;sc.left=-hs;sc.right=hs;sc.top=hs;sc.bottom=-hs;sc.near=1;sc.far=hs*4+60;sc.updateProjectionMatrix()}
    const tex=2*hs/(sun.shadow.mapSize.x||SM),tx_=Math.round(camLook.x/tex)*tex,tz_=Math.round(camLook.z/tex)*tex,sd=hs*1.6+30; // whole texels: no shimmer
    sun.target.position.set(tx_,0,tz_);sun.position.set(tx_+sunDir.x*sd,sunDir.y*sd,tz_+sunDir.z*sd);
  }
  if(scene.fog){const big=WKIND==="campus",off=camPos.distanceTo(camLook)*.8;scene.fog.near=S.fog[0]*(big?2.2:1)+off;scene.fog.far=S.fog[1]*(big?2.6:1)+off}
}

/* ---------- worlds: entering a floor or the outside ---------- */
function enterWorld(key,at){
  const m=key==="campus"?extModel():modelFor(key);
  if(!m){toast("That floor couldn't be loaded.");return false}
  if(run)runCancel();if(race&&race.w!==key)raceCancel();
  WKEY=key;WM=m;WKIND=key==="campus"?"campus":"floor";PW=m.w;PD=m.d;RAMPS=Array.isArray(m.ramps)?m.ramps.filter(r=>r&&isFinite(r.x)&&isFinite(r.z)&&r.len>0&&r.w>0):[];
  document.body.dataset.world=WKIND;
  loadColliders(m);initChairs(m);
  labelsClear();clearSkids();bumpMsg=null;lastLook=-2;hideElev();elevLock=null;elevDismissed=null;
  computeBotPath();computeCoffee();
  clearRoot();buildWorld();buildCars();rebuildTags();restoreCups();drawMapBase();
  const s=at||m.spawn||{x:0,z:0,a:0};
  spawn(me,s.x,s.z,s.a||0);walker.x=s.x;walker.z=s.z;walker.yaw=s.a||0;walker.pitch=-.05;
  lockPadAt(s.x,s.z);
  if(BOTPATH.length){const[bx_,bz_]=BOTPATH[0];spawn(bot,bx_,bz_,0);bot.wi=1}else spawn(bot,-1e3,-1e3,0);
  ov.tx=0;ov.tz=WKIND==="campus"?0:1;
  if(target&&target.w===WKEY)resolveTarget();
  updateBrand();renderStart();renderBoard();routeVisuals(true);
  presDirty=true;
  return true;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// fade to the theme color, swap worlds, fade back in
async function goWorld(key,o){
  o=o||{};if(trans)return false;trans=true;bootLate=false;
  const fd=$("fade"),ft=$("fadeT");ft.innerHTML="";const big=document.createElement("div");big.textContent=o.title||floorName(key);ft.appendChild(big);if(o.sub){const sm=document.createElement("small");sm.textContent=o.sub;big.appendChild(sm)}
  fd.dataset.on="1";await sleep(REDUCED?60:240);
  let ok=false;try{ok=enterWorld(key,o.at)}catch(e){console.error(e)}
  if(ok&&o.mode){fly=null;document.body.dataset.fly="0";setMode(o.mode);if(o.mode==="drive")me.camH=me.h;poseFor(o.mode,camPos,camLook);camera.fov=fovFor(o.mode)}
  else if(ok&&!fly){camYawOff=0;me.camH=me.h;poseFor(mode,camPos,camLook)} // snap the camera to the new world instead of sliding across it
  await Promise.race([BAKE.ready(),sleep(900)]); // behind the fade: the baked light switches on (and its shaders compile) before you see the floor
  await sleep(REDUCED?40:o.hold||160);fd.dataset.on="0";trans=false;
  stopKeys();if(mode==="drive")reassertPedals(); // a pedal held through the door keeps driving
  return ok;
}

/* ---------- elevator ---------- */
let elevAt=null,elevLock=null,elevDismissed=null;
// arriving or respawning on a pad shouldn't pop the elevator panel until you've driven off it once
function lockPadAt(x,z){if(!WM||WKIND!=="floor")return;for(const e of WM.elevators||[])if(e.pad&&Math.hypot(x-e.pad.x,z-e.pad.z)<(e.pad.r||1)+.8){elevLock=e.id;if(elevAt)hideElev()}}
function elevFrame(){
  if(WKIND!=="floor"||fly||trans||mode==="overview"||race||run||brawl||!$("result").hidden){if(elevAt)hideElev();return}
  const p=mode==="walk"?walker:me;let near=null;const lg=curLeg(),wantRide=lg&&lg.end.kind==="elev";
  for(const e of WM.elevators||[]){if(!e.pad)continue;const d=Math.hypot(p.x-e.pad.x,p.z-e.pad.z),r=(e.pad.r||1)+(elevAt&&elevAt.id===e.id?.5:0);
    if(elevDismissed===e.id){if(d>r+.8)elevDismissed=null;continue} // Esc closed it: stays closed until you leave the pad
    if(elevLock===e.id&&!wantRide){if(d>r+.8)elevLock=null;continue}if(d<r)near=e}
  if(near&&(mode==="walk"||Math.abs(me.vF)<3.2)){if(!elevAt||elevAt.id!==near.id)showElev(near)}else if(!near&&elevAt)hideElev();
}
function showElev(e){
  elevAt=e;const p=CAMPUS.parseKey(WKEY),b=bldg(p.b),box=$("elevBtns");box.innerHTML="";
  $("elevK").textContent=`Elevator · ${b.name}`;
  const nxt=route&&routeNextFloor();
  for(let f=1;f<=b.floors;f++){const btn=document.createElement("button");btn.type="button";btn.className="fl";btn.textContent=String(f);btn.setAttribute("aria-label","Floor "+f+(f===p.f?" (you're here)":""));if(f===p.f){btn.setAttribute("aria-current","true");btn.disabled=true}if(nxt===f)btn.dataset.route="1";btn.onclick=()=>ride(f);box.appendChild(btn)}
  $("elevNote").textContent=nxt?`Your route goes to Floor ${nxt} · press ${nxt} or Enter`:`Press a floor number · drive off to cancel`;
  $("elev").hidden=false;
}
function hideElev(){elevAt=null;$("elev").hidden=true}
async function ride(f){
  if(!elevAt||trans)return;const e=elevAt,p=CAMPUS.parseKey(WKEY),key=CAMPUS.key(p.b,f);if(f===p.f)return;
  const m2=modelFor(key);if(!m2){toast("That floor isn't set up yet.");return}
  const e2=(m2.elevators||[]).find(x=>x.id===e.id)||(m2.elevators||[])[0];const at=e2&&e2.pad?{x:e2.pad.x,z:e2.pad.z,a:e2.a||0}:m2.spawn;
  hideElev();SFX.doors();const wasMode=mode;
  const ok=await goWorld(key,{at,title:`Floor ${f}`,sub:bldg(p.b).name+(f>p.f?" · going up":" · going down"),hold:REDUCED?60:380});
  if(ok){elevLock=e2?e2.id:null;SFX.ding();if(wasMode==="walk"){walker.yaw=at.a||0}toast(`${floorName(key)}${(modelFor(key).stats&&modelFor(key).stats.occupied)?" · "+plural(modelFor(key).stats.occupied,"person","people"):""}`)}
}
/* ---------- building doors (floor 1 exit <-> campus door pads) ---------- */
let doorLock=true;
function doorFrame(){
  if(fly||trans||mode==="overview"||race||run||brawl)return; // no doors mid-brawl: the arena is this floor
  const p=mode==="walk"?walker:me;
  if(WKIND==="floor"&&WM.exit){const ex=WM.exit,d=Math.hypot(p.x-ex.x,p.z-ex.z),r=ex.r||1.2;if(d<r){if(!doorLock)goOutside()}else if(d>r+1)doorLock=false;return}
  if(WKIND==="campus"){let nearAny=false;for(const b of WM.buildings||[]){const pd=b.door;if(!pd)continue;const d=Math.hypot(p.x-pd.x,p.z-pd.z),r=pd.r||1.2;if(d<r+1)nearAny=true;if(d<r&&!doorLock){goInside(b);return}}if(!nearAny)doorLock=false}
}
async function goOutside(){
  const p=CAMPUS.parseKey(WKEY),E=extModel();if(!E)return;const eb=(E.buildings||[]).find(b=>b.id===p.b);if(!eb||!eb.door)return;
  const a=eb.door.a||0,at={x:eb.door.x-Math.sin(a)*1.7,z:eb.door.z-Math.cos(a)*1.7,a};doorLock=true;
  const wm=mode;const ok=await goWorld("campus",{at,title:"Outside",sub:DATA.campus.name||"Campus"});if(ok){doorLock=true;if(wm==="walk")walker.yaw=a}
}
async function goInside(b){
  const key=CAMPUS.key(b.id,1),m=modelFor(key);if(!m){toast(b.name+" isn't set up yet.");doorLock=true;return}
  const ex=m.exit||m.spawn;const a=(ex.a||0)+Math.PI,at=m.exit?{x:ex.x-Math.sin(a)*1.9,z:ex.z-Math.cos(a)*1.9,a}:m.spawn;doorLock=true;
  const ok=await goWorld(key,{at,title:b.name,sub:"Floor 1 · lobby"});if(ok)doorLock=true;
}

/* ---------- routes (turn-by-turn to a person, room or amenity) ---------- */
let route=null,target=null;
// a destination: {w, kind, id, name, sub, x, z, a, di?}
function curPos(){if(mode==="walk")return{w:WKEY,x:walker.x,z:walker.z};if(mode==="drive")return{w:WKEY,x:me.x,z:me.z};const s=WM.spawn||{x:0,z:0};return{w:WKEY,x:s.x,z:s.z}}
function resolveTarget(){if(!target||target.kind!=="desk"||target.w!==WKEY)return;const id=target.id.replace(/^desk:/,"");const di=(WM.desks||[]).findIndex(d=>d.id===id);target.di=di}
function setTarget(dest){
  const old=target;target=dest||null;
  if(old&&old.kind==="desk"&&old.w===WKEY&&old.di>=0&&deskG&&deskInst[old.di]>=0){deskG.paint(deskInst[old.di],deskColor(old.di))}
  if(target){resolveTarget();if(target.kind==="desk"&&target.w===WKEY&&target.di>=0&&deskG&&deskInst[target.di]>=0)deskG.paint(deskInst[target.di],S.acc)}
  if(deskG)deskG.commit();$("clear").hidden=!target;
}
function routeTo(dest,quiet){
  setTarget(dest);
  let plan=null;try{plan=NAV.plan(navWorld(),curPos(),{w:dest.w,x:dest.x,z:dest.z,name:dest.name})}catch(e){console.error(e)}
  if(!plan||!plan.legs||!plan.legs.length){route=null;routeVisuals(true);if(!quiet)toast("Couldn't find a way to "+dest.name+" from here.");return false}
  route={to:dest,plan,li:0,hint:0,offT:0,last:performance.now(),arrived:false};syncLeg();routeVisuals(true);
  if(!quiet){const fl=dest.w===WKEY?"":" · "+floorName(dest.w);toast(`Route to ${dest.name}${fl} · ${Math.round(plan.len)} m`)}
  return true;
}
function clearRoute(){route=null;setTarget(null);routeVisuals(true);statusKey=""}
function syncLeg(){if(!route)return;const L=route.plan.legs;let i=route.li;if(!L[i]||L[i].w!==WKEY){const j=L.findIndex((l,k)=>k>=Math.min(route.li,L.length-1)&&l.w===WKEY);i=j>=0?j:L.findIndex(l=>l.w===WKEY)}if(i!==route.li){route.li=i;route.hint=0}}
function curLeg(){if(!route)return null;const l=route.plan.legs[route.li];return l&&l.w===WKEY?l:null}
function routeNextFloor(){const l=curLeg();if(!l||l.end.kind!=="elev")return null;const p=CAMPUS.parseKey(l.end.to||"");return p?p.f:null}
function routeFrame(dt,now){
  if(!route)return;syncLeg();const leg=curLeg();
  if(mode==="overview")return;
  if(!leg){if(now-route.last>1500){route.last=now;routeTo(route.to,true)}return}
  const p=mode==="walk"?walker:me;let tr=null;try{tr=NAV.track(leg,p.x,p.z,route.hint)}catch(_){}
  if(!tr)return;route.hint=tr.i;route.tr=tr;
  if(tr.off>2.6)route.offT+=dt;else route.offT=0;
  if(route.offT>1.1&&now-route.last>1500){route.last=now;route.offT=0;routeTo(route.to,true);return}
  if(leg.end.kind==="dest"){const e=leg.pts[leg.pts.length-1];if(Math.hypot(p.x-e[0],p.z-e[1])<1.4&&!route.arrived){route.arrived=true;SFX.chime();pop(e[0],1,e[1],"Arrived",S.acc);toast("You've arrived: "+route.to.name);const keep=route;setTimeout(()=>{if(route===keep){route=null;routeVisuals(true)}},2500)}}
}
let chevOff=0;
function routeVisuals(force){
  // chevrons along the active leg, a beacon at its end
  const leg=race?{pts:race.pts,end:{kind:"dest"}}:curLeg();
  if(!leg||!leg.pts||leg.pts.length<2){chevMesh.count=0;beacon.visible=!!(target&&target.w===WKEY&&!race);if(beacon.visible){beacon.position.set(target.x,0,target.z)}return}
  let pts=leg.pts;
  // while moving, start the arrows at your position and drop the part of the leg already behind you
  if(!race&&mode!=="overview"&&route&&route.tr){const p=mode==="walk"?walker:me;pts=[[p.x,p.z]].concat(leg.pts.slice(Math.min(leg.pts.length-1,route.tr.i+1)))}
  let smp=[];try{smp=NAV.sample(pts,1.2,chevOff%1.2)}catch(_){}
  const n=Math.min(CHEV_N,smp.length);
  for(let i=0;i<n;i++){const s=smp[i];_Q.setFromAxisAngle(YAX,s.a);const sc=WKIND==="campus"?1.6:1;_M.compose(_P.set(s.x,groundY(s.x,s.z)+.03,s.z),_Q,_S.set(sc,1,sc));chevMesh.setMatrixAt(i,_M)}
  chevMesh.count=n;chevMesh.instanceMatrix.needsUpdate=true;
  const e=leg.pts[leg.pts.length-1];beacon.visible=!race;beacon.position.set(e[0],0,e[1]);
}

/* ---------- coffee run (per floor: kitchen -> 5 desks) ---------- */
let ROUTE=[];
function computeCoffee(){
  ROUTE=[];if(WKIND!=="floor"||!WM.kitchen||!WM.kitchen.pickup||!(WM.coffee||[]).length)return;
  const pk=WM.kitchen.pickup;ROUTE.push({k:"pickup",x:pk.x,z:pk.z,r:pk.r||.9});
  for(const di of WM.coffee){const d=WM.desks[di];if(!d||d.person<0)continue;const dest=(WM.dests||[]).find(x=>x.id==="desk:"+d.id);const c=d.chair>=0&&WM.chairs[d.chair];const x=dest?dest.x:c?c.x:d.x,z=dest?dest.z:c?c.z:d.z;ROUTE.push({k:"drop",x,z,r:.95,di,name:WM.people[d.person].name,id:d.id})}
  if(ROUTE.length<3)ROUTE=[];
}
let run=null,lastBeep=4,markerFor=-1,cupsKey="";const cupsDone=[]; // delivered cups stay on the floor they were delivered on
function runStart(){
  if(brawl){toast("Leave the brawl first ("+(document.body.classList.contains("touch")?"tap Leave":"B")+"), then start a coffee run.");return}
  if(mode!=="drive"||fly||trans)return;if(WKIND!=="floor"||!ROUTE.length){toast(WKIND==="campus"?"Coffee runs happen inside. Drive into a building.":"This floor has no kitchen for a coffee run.");return}
  if(race)raceCancel();closeResult();tidyChairs();const s=WM.spawn;spawnNear(s.x,s.z,s.a||0);me.cup=false;cupsDone.length=0;cupsKey=WKEY;restoreCups();
  run={phase:"count",cd:3.4,stage:0,t:0};lastBeep=4;updateRunBtn();toast(`Grab coffee in the kitchen, then deliver it to ${ROUTE.length-1} desks`);
}
function runCancel(msg){if(!run)return;run=null;me.cup=false;$("count").textContent="";marker.visible=false;if(markerTag){disposeSprite(markerTag);markerTag=null;markerFor=-1}updateRunBtn();if(msg)toast(msg)}
function updateRunBtn(){$("bRun").innerHTML=(run?"Quit run":"Coffee run")+' <kbd>Enter</kbd>'}
// cup sits on the work surface: lab bench top .90, shared table .74, desk .775 (cup is .1 tall)
function placeCupMesh(di){const d=WM.desks[di];if(!d||!root)return;const fx_=-Math.sin(d.a||0),fz_=-Math.cos(d.a||0),rx=-fz_,rz=fx_,y=d.arr==="lab"?.95:d.arr==="hot"?.79:.83,side=Math.min(.42,(d.w||1.5)/2-.12);const m=part(cyl(.04,.035,.1,12),"cup",d.x+rx*side+fx_*.05,y,d.z+rz*side+fz_*.05);cupsMeshes.push(m)}
function restoreCups(){cupsMeshes.forEach(m=>dropVis(m));cupsMeshes=[];if(root&&WKIND==="floor"&&WKEY===cupsKey)cupsDone.forEach(placeCupMesh)}
function countdown(o,dt){const cnt=$("count");o.cd-=dt;const n=Math.ceil(o.cd-.4);if(n<lastBeep&&n>=1){SFX.beep();lastBeep=n}cnt.textContent=n>=1&&n<=3?String(n):"";if(o.cd<=.4){o.phase="go";o.t=0;SFX.beep(true);cnt.textContent="GO";setTimeout(()=>{if(cnt.textContent==="GO")cnt.textContent=""},700);return true}return false}
function runFrame(dt){
  if(!run)return;
  if(run.phase==="count")countdown(run,dt);
  else if(run.phase==="go"){
    run.t+=dt;const s=ROUTE[run.stage];
    if(Math.hypot(me.x-s.x,me.z-s.z)<s.r){
      SFX.chime();
      if(s.k==="pickup"){me.cup=true;const nx=ROUTE[1];toast("Got the coffee. First stop: "+nx.name)}
      else{cupsDone.push(s.di);placeCupMesh(s.di);pop(s.x,.9,s.z,"Delivered",S.acc);const left=ROUTE.length-1-run.stage;toast("Delivered to "+s.name+(left?` · ${left} to go`:""))}
      run.stage++;if(run.stage>=ROUTE.length){runFinish();return}
    }
  }
  if(run&&run.phase!=="done"){const s=ROUTE[run.stage];marker.visible=true;marker.position.set(s.x,0,s.z);const k=1+Math.sin(T*5)*.08;marker.userData.ring.scale.set(k,k,k);
    if(markerFor!==run.stage){disposeSprite(markerTag);markerTag=spriteFrom(textCanvas(s.k==="pickup"?["Pick up coffee","Kitchen"]:["Deliver to "+s.name,`Desk ${s.id}`],{size:48,pad:18,stripe:S.acc}),.3,true);tags.add(markerTag);markerFor=run.stage}
    placeTag(markerTag,s.x,1.6,s.z);
  }else marker.visible=false;
}
function runFinish(){
  const t=run.t;run=null;doorLock=true;lockPadAt(me.x,me.z);me.cup=false;marker.visible=false;if(markerTag){disposeSprite(markerTag);markerTag=null;markerFor=-1}updateRunBtn();SFX.fanfare();
  for(let k=0;k<30;k++)spark(me.x,.3,me.z,PAINTS[k%PAINTS.length][0],3);
  showResult(boardKey(WKEY+":coffee"),t,"Coffee run complete"+avSuffix(),()=>runStart(),"Run it again");
}

/* ---------- races to a destination (standard start, gates along the route) ---------- */
let race=null;
function raceStartPoint(w){const m=w==="campus"?extModel():modelFor(w);return m&&m.spawn}
async function startRace(dest,joinT0){
  if(trans)return;if(run)runCancel();
  const st=raceStartPoint(dest.w),g=navGrid(dest.w);if(!st||!g){toast("Can't race there yet.");return}
  let path=null;try{path=NAV.findPath(g,st.x,st.z,dest.x,dest.z)}catch(_){}
  if(!path||path.pts.length<2||path.len<6){toast(path&&path.len<6?"That's right next to the start. Pick somewhere farther away.":"Couldn't find a race route there.");return}
  let gates=[];try{gates=NAV.gates(path.pts,10)}catch(_){}
  if(!gates.length)gates=[{x:dest.x,z:dest.z,a:0}];
  if(brawl)brawlLeave("You left the brawl for the race.");
  clearRoute();closeResult();
  if(WKEY!==dest.w||mode!=="drive"){const ok=await goWorld(dest.w,{at:{x:st.x,z:st.z,a:st.a||0},mode:"drive",title:"Race to "+dest.name,sub:floorName(dest.w)});if(!ok)return}
  else{tidyChairs();spawnNear(st.x,st.z,st.a||0)}
  const key=raceKey(dest),t0=joinT0||Date.now();
  race={key,dest,w:dest.w,pts:path.pts,len:path.len,gates,gi:0,phase:"count",cd:clamp(3.4-(Date.now()-t0)/1000,.5,3.4),t:0,t0};lastBeep=4;
  setTarget(dest);routeVisuals(true);updateGates();presDirty=true;
  toast(`Race to ${dest.name} · ${gates.length} gates · ${Math.round(path.len)} m`);
}
const raceKey=dest=>dest.w+">"+dest.id;
function raceCancel(msg){if(!race)return;race=null;$("count").textContent="";gateMesh.count=0;gateNext.visible=false;setTarget(null);routeVisuals(true);presDirty=true;if(msg)toast(msg)}
function updateGates(){
  if(!race){gateMesh.count=0;gateNext.visible=false;return}
  let n=0;for(let i=race.gi+1;i<race.gates.length&&n<GATE_N;i++){const g=race.gates[i];_Q.setFromAxisAngle(YAX,g.a);_M.compose(_P.set(g.x,1.2,g.z),_Q,ONE);gateMesh.setMatrixAt(n++,_M)}
  gateMesh.count=n;gateMesh.instanceMatrix.needsUpdate=true;
  const g=race.gates[race.gi];if(g){gateNext.visible=true;gateNext.position.set(g.x,1.25,g.z);gateNext.rotation.set(0,g.a,0)}else gateNext.visible=false;
}
function raceFrame(dt){
  if(!race)return;
  if(race.phase==="count"){countdown(race,dt);return}
  race.t+=dt;const g=race.gates[race.gi];if(!g)return;
  const k=1+Math.sin(T*6)*.06;gateNext.scale.set(k,k,k);
  if(Math.hypot(me.x-g.x,me.z-g.z)<1.9){race.gi++;SFX.gate();pop(g.x,1.9,g.z,race.gi>=race.gates.length?"Finish":race.gi+"/"+race.gates.length,S.acc);
    if(race.gi>=race.gates.length){const r=race,t=r.t;race=null;doorLock=true;lockPadAt(me.x,me.z);gateMesh.count=0;gateNext.visible=false;SFX.fanfare();for(let q=0;q<30;q++)spark(me.x,.3,me.z,PAINTS[q%PAINTS.length][0],3);setTarget(null);routeVisuals(true);presDirty=true;
      showResult(boardKey(r.key),t,"Race to "+r.dest.name+avSuffix(),()=>startRace(r.dest),"Race again");return}
    updateGates();
  }
}
