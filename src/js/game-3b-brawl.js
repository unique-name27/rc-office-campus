/* ===================== game part 3b: Banana Brawl (a kart battle on the floor you're on) ===================== */
// The rules are in brawl.js (BRAWL); this part runs them: item crates, throws and hits, the bots, the HUD, and the
// brawl's share of presence. Everyone brawling on a floor plays everyone else brawling there. When nobody else is,
// three bots join you (so the public page, which has no live room, plays the same game).
// Loaded before game-4-ui.js, whose boot code already asks whether a brawl is on.

let brawl=null,myPeer=null,brThrowId=1+Math.floor(Math.random()*1e6);
const brCounted=new Set(),brMine=new Map(); // hits already credited ("victim|id"); my throws by id -> when thrown
const BR_BOTS=[["Stapler","#E4572E","car"],["Shredder","#2F6FED","dog"],["Laminator","#F2C14E","cat"]];
const BR_SCALE={nana:1.3,peel:1.4,ball:.9,plane:1.2},BR_R={car:.2,dog:.22,cat:.18},BR_TALL={car:.28,dog:.58,cat:.5};
const brNow=()=>performance.now()/1000;
const BR_ZERO=new THREE.Matrix4().makeScale(0,0,0),_BM=new THREE.Matrix4(),_BQ=new THREE.Quaternion(),_BE=new THREE.Euler(0,0,0,"YXZ"),_BP=new V3(),_BS=new V3(1,1,1);

/* ---------- start / leave ---------- */
function brawlStart(){
  if(brawl||trans)return;
  if(WKIND!=="floor"){toast("Brawls happen on a floor: pick one under Go to, then "+(document.body.classList.contains("touch")?"tap Banana Brawl.":"press B."));return}
  if(run)runCancel();if(race)raceCancel();closeResult();
  if(mode!=="drive")flyTo("drive",1.1);
  const t=brNow();
  const intro=document.body.classList.contains("touch")?"Banana Brawl! Drive through crates, then tap Item to throw (hold Brake to drop it behind).":"Banana Brawl! Drive through crates · F throws · G drops a peel behind you · B leaves.";
  brawl={w:WKEY,st:BRAWL.fresh(t),item:null,uses:0,pj:[],hb:[],seen:new Map(),crates:brawlCrates(),bots:[],vis:null,
    spin:1,alone:t,t0:t,intro,hudKey:"",boardT:0,lastHp:BRAWL.HEARTS,cap:{nana:24,peel:48,ball:24,plane:16,bub:8}};
  document.body.classList.add("brawl");setOpts(false);$("bBrawl").innerHTML="Leave the brawl <kbd>B</kbd>";
  const s=brawlSpot(brawlRemotes().map(r=>r.car));spawnNear(s[0],s[1],me.h);
  toast(intro);
  SFX.gate();brawlHud(true);setHelp();presDirty=true;
}
function brawlLeave(msg){
  if(!brawl)return;
  for(const b of brawl.bots)brawlDropBot(b);
  brawlDropVis();brawl=null;
  document.body.classList.remove("brawl");$("brawlHud").hidden=true;$("brawlBoard").hidden=true;$("bBrawl").innerHTML="Banana Brawl <kbd>B</kbd>";
  me.turboT=0;setHelp();presDirty=true;if(msg)toast(msg);
}
const brawlToggle=()=>brawl?brawlLeave("You left the brawl."):brawlStart();

/* ---------- the arena: crate spots and respawn spots, the same for everyone on this floor ---------- */
function brawlCands(){
  const c=[];for(const p of BOTPATH)c.push([p[0],p[1]]);
  for(const d of WM.dests||[])if(d.kind!=="desk"&&isFinite(d.x))c.push([d.x,d.z]);
  if(c.length<12)for(let x=-PW/2+2;x<PW/2-2;x+=3)for(let z=-PD/2+2;z<PD/2-2;z+=3)c.push([x,z]);
  return c.filter(([x,z])=>spotFree(x,z));
}
function brawlCrates(){return BRAWL.crateSpots(WKEY,brawlCands(),8,4.5).map(([x,z])=>({x,z,until:0}))}
// the free spot farthest from everyone else (respawns and bots)
function brawlSpot(others){
  const c=brawlCands();if(!c.length){const s=WM.spawn||{x:0,z:0};return[s.x,s.z]}
  let best=c[0],bd=-1;for(const p of c){let d=1e9;for(const o of others)d=Math.min(d,Math.hypot(p[0]-o.x,p[1]-o.z));if(d>bd){bd=d;best=p}}
  return best;
}

/* ---------- players: me, the bots, and coworkers brawling on this floor ---------- */
// {id, car, st, bot?} for the local ones; coworkers come from presence (their own client decides their hits)
const BR_ME={id:"me",get car(){return me},get st(){return brawl.st}};
function brawlLocals(){const out=[BR_ME];for(const b of brawl.bots)out.push(b);return out}
// a coworker counts while their brawl presence is fresh (it ticks every second; a hidden or closed page stops ticking)
function brawlRemotes(){const out=[],now=performance.now();for(const r of remotes.values())if(r.bw&&r.w===WKEY&&r.m==="d"&&r.has&&now-(r.bwAt||0)<3000)out.push(r);return out}
// a coworker's throws count only if each new one first appears near their car, and not too many at once: nobody can
// conjure throws on top of other players (the first ones seen from a peer are taken as they are)
function brawlVet(r,bw){
  const now=performance.now();if(!r.bwIds){r.bwIds=new Map();r.bwNew=[];r.bwFirst=true}
  const ok=[];
  for(const q of bw.pj){
    let good=r.bwIds.get(q.i);
    if(good===undefined){
      if(r.bwFirst)good=true;
      else{r.bwNew=r.bwNew.filter(x=>now-x<3000);good=Math.hypot(q.x-r.tx,q.z-r.tz)<=2.5+Math.hypot(q.vx,q.vz)*.35&&r.bwNew.length<5;if(good)r.bwNew.push(now)}
      r.bwIds.set(q.i,good);
    }
    if(good)ok.push(q);
  }
  r.bwFirst=false;bw.pj=ok;
  if(r.bwIds.size>300)for(const k of[...r.bwIds.keys()])if(!bw.pj.some(q=>q.i===k))r.bwIds.delete(k);
}
const brBody=c=>({x:c.x,y:c.y,z:c.z,r:BR_R[c.kind]||.2,tall:BR_TALL[c.kind]||.3});

/* ---------- items ---------- */
// use the item held by player pl (me or a bot); back = drop a banana behind
function brawlUse(back,pl){
  if(!brawl)return;pl=pl||{id:"me",car:me};
  const isMe=pl.id==="me",holder=isMe?brawl:pl,t=brNow(),st=isMe?brawl.st:pl.st;
  if(isMe&&(mode!=="drive"||fly||trans))return;
  if(st.outUntil>t||st.spinUntil>t)return;
  const it=holder.item;
  if(!it){if(isMe)pop(me.x,me.y+.55,me.z,"No item",paint);return}
  const c=pl.car;
  if(it==="coffee"){c.turboT=Math.max(c.turboT,2.4);const fx=-Math.sin(c.h),fz=-Math.cos(c.h),cur=c.vx*fx+c.vz*fz,want=Math.max(cur,(AVP[c.kind]||AVP.car).bmax*.8);c.vx+=fx*(want-cur);c.vz+=fz*(want-cur);if(isMe){SFX.turbo(2,1);pop(c.x,c.y+.55,c.z,"COFFEE!","#B5651D")}}
  else if(it==="bubble"){if(isMe)brawl.st=Object.assign({},brawl.st,{bubbleUntil:t+BRAWL.BUBBLE});else pl.st=Object.assign({},pl.st,{bubbleUntil:t+BRAWL.BUBBLE});if(isMe)SFX.chime()}
  else{
    const kind=it==="paper"?"ball":it==="plane"?"plane":"nana",p=BRAWL.launch(kind,c,brThrowId++,back&&(it==="banana"||it==="bunch"));p.own=pl.id;
    brawl.pj.push(p);if(isMe)brMine.set(p.i,t);brawlTrimPeels(pl.id);
    if(isMe)SFX.whoosh();else{const d=camera.position.distanceTo(_BP.set(c.x,c.y,c.z));if(d<14)SFX.whoosh()}
  }
  if(--holder.uses<=0){holder.item=null;holder.uses=0}
  if(isMe){brawlHud();presDirty=true}
}
// at most six peels each (bananas in flight count: they'll land as peels), and no more of my throws than presence
// carries, so everyone sees every throw that can hit them: the oldest goes
function brawlTrimPeels(id){
  const mine=brawl.pj.filter(p=>p.own===id&&(p.k==="peel"||p.k==="nana"));while(mine.length>6)brawl.pj.splice(brawl.pj.indexOf(mine.shift()),1);
  const all=brawl.pj.filter(p=>p.own===id);while(all.length>BRAWL.MAX_PJ){const o=all.find(q=>q.k==="peel")||all[0];all.splice(all.indexOf(o),1);brawl.pj.splice(brawl.pj.indexOf(o),1)}
}
function brawlPickup(t){
  const pls=brawlLocals(),rem=brawlRemotes(),best=Math.max(0,...pls.map(p=>p.st.kos),...rem.map(r=>r.bw.ko));
  for(const cr of brawl.crates){
    if(cr.until>t)continue;
    for(const pl of pls){
      const c=pl.car,holder=pl.id==="me"?brawl:pl;if(pl.st.outUntil>t)continue;
      if(Math.hypot(c.x-cr.x,c.z-cr.z)>.62||c.y>1.2)continue;
      cr.until=t+5;
      for(let k=0;k<8;k++)spark(cr.x,.5,cr.z,"#FFC24A",2.2);PHYS.burst(cr.x,.5,cr.z,"card");
      if(!holder.item){const it=BRAWL.rollItem(Math.random(),pl.st.kos<best);holder.item=it;holder.uses=BRAWL.ITEM[it].uses;
        if(pl.id==="me"){SFX.chime();pop(c.x,c.y+.6,c.z,BRAWL.ITEM[it].n,"#FFC24A");brawlHud();presDirty=true}}
      break;
    }
    if(cr.until<=t)for(const r of rem){if(r.bw.out)continue;const c=r.car;if(Math.hypot(c.x-cr.x,c.z-cr.z)>.62||c.y>1.2)continue;cr.until=t+5;for(let k=0;k<8;k++)spark(cr.x,.5,cr.z,"#FFC24A",2.2);PHYS.burst(cr.x,.5,cr.z,"card");break}
  }
}

/* ---------- throws: move them, and see who they hit ---------- */
let brY=0;
// solid things in the way of a throw at height brY (desks only stop it below their top; the plate edge always)
function brBlocked(x,z,r){
  if(Math.abs(x)>PW/2-r||Math.abs(z)>PD/2-r)return true;
  const l=query(x,z,r+.05,1);
  for(let i=0;i<l.length;i++){const c=l[i];if(c.minY!=null&&brY<c.minY-.05)continue;if(c.top!=null&&brY>=c.top)continue;if(!c.tall&&c.top==null&&brY>.75)continue;if(circleVs(c,x,z,r))return true}
  return false;
}
// where a falling banana lands: the floor, or a desk top it's above
function brGround(x,z){let g=groundY(x,z);const l=query(x,z,.05,8);for(let i=0;i<l.length;i++){const p=l[i];if(p.h>g&&p.h<=brY+.05&&x>=p.x0&&x<=p.x1&&z>=p.z0&&z<=p.z1)g=p.h}return g}
function brTarget(p){
  // a paper plane chases the nearest brawler in front of it, never its thrower
  let best=null,bd=22;const va=Math.atan2(p.vx,p.vz);
  const consider=(id,x,z)=>{if(id===p.own)return;const d=Math.hypot(x-p.x,z-p.z);if(d>=bd)return;const a=Math.atan2(x-p.x,z-p.z);if(Math.abs(Math.atan2(Math.sin(a-va),Math.cos(a-va)))>1.6)return;bd=d;best={x,z}};
  const t=brNow();for(const pl of brawlLocals())if(pl.st.outUntil<=t)consider(pl.id,pl.car.x,pl.car.z);
  for(const r of brawlRemotes())if(!r.bw.out)consider(r.peer,r.car.x,r.car.z);
  return best;
}
const BR_ENV={blocked:brBlocked,ground:brGround,target:brTarget};
// apply a hit to a local player (me or a bot); by = the thrower's id ("me", a bot id, or a coworker's peer)
function brawlHit(pl,by,p,t){
  const isMe=pl.id==="me",r=BRAWL.hit(pl.st,t);
  if(isMe)brawl.st=r.state;else pl.st=r.state;
  const c=pl.car;
  if(r.blocked){pop(c.x,c.y+.6,c.z,"Blocked!","#7FD8FF");if(isMe){SFX.chime();if(by!=="me"&&!brawl.bots.some(b=>b.id===by))brawl.hb.push([by,p.i,2,t])}return r}
  if(!r.took)return r;
  if(isMe)brawl.spin=Math.random()<.5?-1:1;else pl.spin=Math.random()<.5?-1:1;
  c.vx*=.3;c.vz*=.3;c.vF*=.3;c.turboT=0;c.boosting=false;
  const near=camera.position.distanceTo(_BP.set(c.x,c.y,c.z))<16;
  if(near){SFX.bump(6);for(let k=0;k<10;k++)puff(c.x+(Math.random()-.5)*.3,c.y+.1,c.z+(Math.random()-.5)*.3,"#FFE14D")}
  if(r.ko){pop(c.x,c.y+.75,c.z,"KO!","#E4572E");PHYS.burst(c.x,c.y+.3,c.z,"paper");if(near)SFX.land(6);for(let k=0;k<16;k++)spark(c.x,c.y+.2,c.z,"#FFC24A",3)}
  else pop(c.x,c.y+.6,c.z,"−1 ♥","#E4572E");
  if(isMe){shake=Math.max(shake,.35);brawlHud();presDirty=true}
  // a local thrower gets the point straight away; a coworker hears about it from our presence (hb)
  const thr=by==="me"?{st:brawl.st,me:true}:brawl.bots.find(b=>b.id===by);
  if(thr&&by!==pl.id){const s=Object.assign({},thr.st,{sc:thr.st.sc+1,kos:thr.st.kos+(r.ko?1:0)});if(thr.me){brawl.st=s;brawlScored(r.ko,pl.name||"a bot")}else thr.st=s}
  else if(!thr&&isMe)brawl.hb.push([by,p.i,r.ko?1:0,t]);
  return r;
}
function brawlScored(ko,who){if(ko){SFX.fanfare();toast("KO! You knocked out "+who+".")}else SFX.ding();brawlHud();presDirty=true}
function brawlThrows(dt,t){
  const pls=brawlLocals(),rem=brawlRemotes();
  for(let i=brawl.pj.length-1;i>=0;i--){
    const p=brawl.pj[i];
    if(p.hitT){if(t-p.hitT>.6)brawl.pj.splice(i,1);continue}   // hit a coworker (as far as we can see): gone once they confirm, or soon
    const wasNana=p.k==="nana";brY=p.y;if(!BRAWL.step(p,dt,BR_ENV)){if(p.k==="ball"||p.k==="plane")for(let k=0;k<5;k++)puff(p.x,p.y,p.z,"#FFFFFF");brawl.pj.splice(i,1);continue}
    if(wasNana&&p.k==="peel"&&brawl.pj.filter(q=>q.own===p.own&&q.k==="peel").length>6){brawl.pj.splice(i,1);continue}
    let used=false;
    for(const pl of pls){
      if(pl.st.outUntil>t||!BRAWL.armed(p,p.own===pl.id)||!BRAWL.touches(p,brBody(pl.car)))continue;
      const r=brawlHit(pl,p.own,p,t);if(r.took||r.blocked){used=true;break}
    }
    if(used){brawl.pj.splice(i,1);continue}
    if(p.own==="me")for(const r of rem){if(r.bw.out||r.bw.iv||!BRAWL.touches(p,brBody(r.car)))continue;p.hitT=t;for(let k=0;k<6;k++)puff(p.x,p.y,p.z,"#FFE14D");break}
  }
  // coworkers' throws, as their presence last showed them (moved on by their speed): only they can hit me here
  if(brawl.st.outUntil<=t)for(const r of rem){
    const age=Math.min(.25,(performance.now()-r.t)/1000);
    for(const q of r.bw.pj){
      const key=r.peer+"|"+q.i;if(brawl.seen.has(key))continue;
      const p={k:q.k,x:q.x+q.vx*age,y:q.y,z:q.z+q.vz*age,t:9};
      if(!BRAWL.touches(p,brBody(me)))continue;
      const res=brawlHit({id:"me",car:me,st:brawl.st},r.peer,q,t);
      if(res.took||res.blocked)brawl.seen.set(key,t);
    }
  }
  for(const [k,v] of brawl.seen)if(t-v>BRAWL.PJ.peel.life+5)brawl.seen.delete(k);
  for(const [k,v] of brMine)if(t-v>BRAWL.PJ.peel.life+10)brMine.delete(k);
  brawl.hb=brawl.hb.filter(h=>t-h[3]<4).slice(-8);
  // hits coworkers say my throws made
  if(myPeer){const got=BRAWL.credits(myPeer,rem.map(r=>[r.peer,r.bw]),brCounted,brMine);
    for(const g of got){const k=brawl.pj.findIndex(p=>p.own==="me"&&p.i===g.id);if(k>=0)brawl.pj.splice(k,1);
      if(g.blocked)continue; // their bubble took it
      brawl.st=Object.assign({},brawl.st,{sc:brawl.st.sc+1,kos:brawl.st.kos+(g.ko?1:0)});const r=remotes.get(g.victim);brawlScored(g.ko,(r&&r.name)||"a coworker")}}
}

/* ---------- spin-outs, knockouts, comebacks ---------- */
function brawlSelf(dt,t){
  const st=brawl.st;
  if(st.spinUntil>t){if(!REDUCED)me.h+=brawl.spin*9*dt;me.vx*=1-Math.min(1,dt*3);me.vz*=1-Math.min(1,dt*3);me.vF*=1-Math.min(1,dt*3)}
  if(st.outUntil&&st.outUntil<=t){const s=brawlSpot(brawlRemotes().map(r=>r.car).concat(brawl.bots.map(b=>b.car)));spawnNear(s[0],s[1],me.h);brawl.st=BRAWL.respawn(st,t);brawl.item=null;brawl.uses=0;SFX.gate();brawlHud();presDirty=true}
  if(brawl.st.hp!==brawl.lastHp){brawl.lastHp=brawl.st.hp;brawlHud()}
}
// the drive controls while brawling: none during a spin-out or a knockout
function brawlCtl(ctl){if(!brawl)return ctl;const t=brNow();return brawl.st.spinUntil>t||brawl.st.outUntil>t?IDLE:ctl}

/* ---------- bots: fill in while nobody else is brawling here ---------- */
function brawlBotsCheck(t){
  const others=brawlRemotes().length;
  if(others&&brawl.bots.length){for(const b of brawl.bots)brawlDropBot(b);brawl.bots=[];brawl.pj=brawl.pj.filter(p=>p.own==="me");toast("A coworker joined the brawl, so the bots stepped out.");brawlHud()}
  if(others){brawl.alone=t;return}
  if(!brawl.bots.length&&t-brawl.alone>1.2){
    BR_BOTS.forEach(([name,col,kind],i)=>{const s=brawlSpot([me].concat(brawl.bots.map(b=>b.car)));const car=newCar(s[0],s[1],Math.random()*6.28,col,kind);spawn(car,s[0],s[1],car.h);
      PHYS.track(car);brawl.bots.push({id:"bot"+i,name,col,car,st:BRAWL.fresh(t),item:null,uses:0,path:[],pi:0,repath:0,think:0,goal:null,spin:1,stuck:0,rev:0,tag:null,tagKey:""})});
    toast((t-brawl.t0<4?brawl.intro+" ":"")+"Three bots joined you: Stapler, Shredder and Laminator.");brawlHud();
  }
}
function brawlDropBot(b){PHYS.untrack(b.car);if(b.car.vis){dropVis(b.car.vis);b.car.vis=null}if(b.tag){disposeSprite(b.tag);b.tag=null}}
function botThink(b,t){
  const c=b.car,others=[{id:"me",car:me,st:brawl.st}].concat(brawl.bots.filter(o=>o!==b)).filter(o=>o.st.outUntil<=t);
  let goal=null;
  if(!b.item){let bd=1e9;for(const cr of brawl.crates){if(cr.until>t+1)continue;const d=Math.hypot(cr.x-c.x,cr.z-c.z);if(d<bd){bd=d;goal={x:cr.x,z:cr.z}}}}
  if(!goal){let bd=1e9;for(const o of others){const d=Math.hypot(o.car.x-c.x,o.car.z-c.z);if(d<bd){bd=d;goal={x:o.car.x,z:o.car.z,o}}}}
  b.goal=goal;
  if(goal&&(t>b.repath||!b.path.length)){b.repath=t+1.1;const g=navGrid(WKEY);let r=null;try{r=g&&NAV.findPath(g,c.x,c.z,goal.x,goal.z)}catch(_){}b.path=r&&r.pts&&r.pts.length?r.pts.slice(1):[[goal.x,goal.z]];b.pi=0}
  // use the item: throw at someone ahead, drop a peel on someone behind, drink the coffee on a long straight
  const it=b.item;if(!it||Math.random()<.35)return;
  for(const o of others){const dx=o.car.x-c.x,dz=o.car.z-c.z,d=Math.hypot(dx,dz),a=angDiff(c.h,Math.atan2(-dx,-dz));
    if((it==="banana"||it==="bunch"||it==="paper")&&d<12&&Math.abs(a)<.28){brawlUse(false,b);return}
    if(it==="plane"&&d<18&&Math.abs(a)<1.2){brawlUse(false,b);return}
    if((it==="banana"||it==="bunch")&&d<5&&Math.abs(a)>2.5){brawlUse(true,b);return}}
  if(it==="bubble")brawlUse(false,b);
  else if(it==="coffee"&&goal&&Math.hypot(goal.x-c.x,goal.z-c.z)>9)brawlUse(false,b);
}
function botDrive(b,dt,t){
  const c=b.car;if(b.st.spinUntil>t||b.st.outUntil>t)return IDLE;
  const pt=b.path[b.pi];if(!pt)return{thr:.4,steer:0,boost:false,drift:false};
  if(Math.hypot(pt[0]-c.x,pt[1]-c.z)<1&&b.pi<b.path.length-1)b.pi++;
  const hd=Math.atan2(-(pt[0]-c.x),-(pt[1]-c.z)),d=angDiff(c.h,hd);
  if(b.rev>0){b.rev-=dt;return{thr:-1,steer:-Math.sign(d),boost:false,drift:false}}
  if(Math.abs(c.vF)<.4&&!c.air)b.stuck+=dt;else b.stuck=0;if(b.stuck>1.2){b.stuck=0;b.rev=.8;b.repath=0}
  return{thr:Math.abs(d)>1.1?.35:.82,steer:clamp(d*2.6,-1,1),boost:false,drift:false};
}
function brawlBots(dt,t){
  for(const b of brawl.bots){
    if(t>b.think){b.think=t+.25+Math.random()*.15;botThink(b,t)}
    const ctl=botDrive(b,dt,t),n=Math.max(1,Math.ceil(dt/(1/120)));
    for(let k=0;k<n;k++)carStep(b.car,ctl,dt/n,false);
    if(b.st.spinUntil>t){const k=1-Math.min(1,dt*3);b.car.h+=b.spin*9*dt;b.car.vx*=k;b.car.vz*=k;b.car.vF*=k}
    if(b.st.outUntil&&b.st.outUntil<=t){const s=brawlSpot([me].concat(brawl.bots.filter(o=>o!==b).map(o=>o.car)));spawn(b.car,s[0],s[1],b.car.h);b.st=BRAWL.respawn(b.st,t);b.item=null;b.uses=0;b.path=[]}
    if(root&&(!b.car.vis||b.car.vis.g.parent!==root))b.car.vis=makeAvatar(b.car.kind,b.col);
    syncCar(b.car,dt,false);
    const tk=b.name+" "+"♥".repeat(b.st.hp);if(!b.tag||b.tagKey!==tk||b.tag.parent!==tags){if(b.tag)disposeSprite(b.tag);b.tag=tagSprite(tk,b.col);b.tagKey=tk;tags.add(b.tag)}
    placeTag(b.tag,b.car.x,b.car.y+tagH(b.car.kind),b.car.z);
  }
}

/* ---------- drawing: crates, throws in flight and on the floor, bubbles ---------- */
function brawlVis(){
  if(brawl.vis&&brawl.vis.root===root)return brawl.vis;
  brawl.vis=null;if(!root)return null;
  const sm=S.mat!=="basic",faces=!S.faceIsBg&&!S.depthOnly,G=typeof brawlGeos==="function"?brawlGeos(sm):brFallbackGeos(sm);
  const vm=()=>{const m=mat("figure");if(faces&&S.mat!=="basic"&&m.color&&"vertexColors" in m){m.vertexColors=true;m.color.set(0xffffff)}return m};
  const mk=(g,n,edge,o)=>{const r=IG(g,"figure",n,Object.assign({mat:vm(),edge,noCast:1},o));if(r.mesh)r.mesh.userData.dyn=true;return r},cap=brawl.cap;
  const v={root,crate:mk(G.crate,brawl.crates.length,"#FFB547"),nana:mk(G.banana,cap.nana,"#FFE14D"),peel:mk(G.peel,cap.peel,"#FFE14D"),ball:mk(G.paper,cap.ball,"#E8F1FF"),
    plane:mk(G.plane,cap.plane,"#E8F1FF",{noHull:1,mat:Object.assign(vm(),{side:THREE.DoubleSide})}),bub:[],used:{nana:cap.nana,peel:cap.peel,ball:cap.ball,plane:cap.plane},grow:false};
  if(G.coffee)G.coffee.dispose();
  const bg=new THREE.IcosahedronGeometry(.42,sm?3:1);
  for(let i=0;i<cap.bub;i++){const m=new THREE.Mesh(bg,new THREE.MeshBasicMaterial({color:S.faceIsBg?(S.edges?S.edges.c:"#7FD8FF"):"#7FD8FF",transparent:true,opacity:S.faceIsBg?.18:.26,depthWrite:false,wireframe:!!S.faceIsBg}));m.visible=false;m.renderOrder=3;m.userData.noAO=1;root.add(m);v.bub.push(m)}
  brawl.vis=v;return v;
}
function brawlDropVis(){
  const v=brawl&&brawl.vis;if(!v)return;brawl.vis=null;if(v.root!==root)return; // the world was rebuilt: already gone
  const dead=new Set();
  for(const k of["crate","nana","peel","ball","plane"]){const g=v[k];for(const o of[g.mesh,g.hull,g.lines]){if(!o)continue;if(o.parent)o.parent.remove(o);o.geometry.dispose();if(o.material!==HULL){dead.add(o.material);o.material.dispose()}}}
  lineMats=lineMats.filter(m=>!dead.has(m));
  for(const m of v.bub){if(m.parent)m.parent.remove(m);m.material.dispose()}if(v.bub[0])v.bub[0].geometry.dispose();
}
// stand-ins until the item art loads (and if it ever fails)
function brFallbackGeos(sm){
  const col=(g,c)=>[c,g],s=sm?12:5;
  const box=new THREE.BoxGeometry(.38,.38,.38),band=new THREE.BoxGeometry(.4,.07,.4);
  return{crate:crMerge([col(box,"#F2A33A"),col(band,"#FFF1C1")]),banana:crMerge([col(new THREE.CapsuleGeometry(.04,.16,4,s),"#FFE14D")]),
    peel:crMerge([col(new THREE.CylinderGeometry(.11,.11,.02,s),"#FFE14D")]),paper:crMerge([col(new THREE.IcosahedronGeometry(.11,1),"#F4F4EE")]),
    plane:crMerge([col(new THREE.ConeGeometry(.1,.3,3),"#F4F4EE")])}
}
function brawlDraw(t){
  const v=brawlVis();if(!v)return;
  v.crate.count&&brawl.crates.forEach((cr,i)=>{if(i>=v.crate.count)return;if(cr.until>t){v.crate.set(i,BR_ZERO);return}
    _BE.set(0,t*1.3+i,0);_BQ.setFromEuler(_BE);_BP.set(cr.x,.5+Math.sin(t*2.2+i)*.06,cr.z);_BM.compose(_BP,_BQ,_BS.set(1,1,1));v.crate.set(i,_BM)});
  const used={nana:0,peel:0,ball:0,plane:0};
  const put=(p,x,y,z)=>{const g=v[p.k];if(!g)return;if(used[p.k]>=g.count){brawl.cap[p.k]=Math.min(512,Math.max(8,g.count*2));v.grow=true;return}
    if(p.k==="nana")_BE.set(t*9+p.i,Math.atan2(p.vx,p.vz),0);
    else if(p.k==="peel")_BE.set(0,(p.i*2.399)%6.283,0);
    else if(p.k==="ball")_BE.set(-t*8,Math.atan2(p.vx,p.vz),0);
    else _BE.set(0,Math.atan2(-p.vx,-p.vz),Math.sin(t*5+p.i)*.15);
    const s=BR_SCALE[p.k]||1;_BQ.setFromEuler(_BE);_BM.compose(_BP.set(x,y,z),_BQ,_BS.set(s,s,s));g.set(used[p.k]++,_BM)};
  for(const p of brawl.pj)if(!p.hitT)put(p,p.x,p.y,p.z);
  for(const r of remotes.values()){if(!r.bw||r.w!==WKEY||!r.has)continue;const age=Math.min(.25,(performance.now()-r.t)/1000);
    for(const q of r.bw.pj)if(!brawl.seen.has(r.peer+"|"+q.i))put(q,q.x+q.vx*age,q.y,q.z+q.vz*age)}
  // hide only the slots that were in use last frame (the rest are already hidden)
  for(const k in used){const g=v[k],was=Math.min(v.used[k],g.count);for(let i=used[k];i<was;i++)g.set(i,BR_ZERO)}v.used=used;
  for(const k of["crate","nana","peel","ball","plane"])v[k].commit();
  // bubbles on whoever has one up
  let b=0;const bub=(c,on)=>{if(!on)return;if(b>=v.bub.length){brawl.cap.bub=Math.min(64,v.bub.length*2);v.grow=true;return}const m=v.bub[b++];m.visible=true;m.position.set(c.x,c.y+.18,c.z);const s=1+Math.sin(t*6)*.03;m.scale.set(s,s,s)};
  for(const pl of brawlLocals())bub(pl.car,pl.st.bubbleUntil>t);
  for(const r of brawlRemotes())bub(r.car,r.bw.sh===1);
  for(;b<v.bub.length;b++)v.bub[b].visible=false;
  if(v.grow)brawlDropVis(); // more throws than slots: rebuild bigger next frame
}

/* ---------- HUD: hearts, the item, score; the standings ---------- */
const BR_ICON_TXT={banana:"🍌",bunch:"🍌×3",paper:"●",plane:"✈",coffee:"☕",bubble:"◯"};
function brawlHud(force){
  if(!brawl)return;const st=brawl.st,t=brNow();
  const key=[st.hp,st.sc,st.kos,brawl.item,brawl.uses,st.outUntil>t?1:0].join("|");if(!force&&key===brawl.hudKey)return;brawl.hudKey=key;
  const h=$("brawlHud");h.hidden=false;
  const hearts=$("brHearts");hearts.innerHTML="";for(let i=0;i<BRAWL.HEARTS;i++){const s=document.createElement("i");s.className="hrt"+(i<st.hp?"":" off");hearts.appendChild(s)}
  hearts.setAttribute("aria-label",st.hp+" of "+BRAWL.HEARTS+" hearts");
  const it=$("brItem"),icon=typeof BRAWL_ICON!=="undefined"&&brawl.item?BRAWL_ICON[brawl.item==="bunch"&&brawl.uses<3?"banana":brawl.item]:null;
  it.innerHTML=icon||"";if(!icon)it.textContent=brawl.item?BR_ICON_TXT[brawl.item]:"";
  it.dataset.empty=brawl.item?"0":"1";it.title=brawl.item?BRAWL.ITEM[brawl.item].n:"No item: drive through a crate";
  $("brUses").textContent=brawl.item&&brawl.uses>1?"×"+brawl.uses:"";
  $("brItemN").textContent=brawl.item?BRAWL.ITEM[brawl.item].n:"Grab a crate";
  $("brScore").textContent=st.outUntil>t?"Knocked out…":`${st.kos} KO · ${st.sc} hit${st.sc===1?"":"s"}`;
  const pi=$("pItem");pi.innerHTML=icon||(brawl.item?BR_ICON_TXT[brawl.item]:"Item");pi.dataset.empty=brawl.item?"0":"1";
  pi.setAttribute("aria-label",brawl.item?"Use "+BRAWL.ITEM[brawl.item].n+(brawl.uses>1?" ("+brawl.uses+" left)":""):"Item: none yet");
}
function brawlBoard(t){
  if(t<brawl.boardT)return;brawl.boardT=t+.4;
  const rows=[{id:"me",name:myName||"You",col:paint,sc:brawl.st.sc,ko:brawl.st.kos,hp:brawl.st.hp,you:true}];
  for(const b of brawl.bots)rows.push({id:b.id,name:b.name+" (bot)",col:b.col,sc:b.st.sc,ko:b.st.kos,hp:b.st.hp});
  for(const r of brawlRemotes())rows.push({id:r.peer,name:r.name||"Coworker",col:r.paint,sc:r.bw.sc,ko:r.bw.ko,hp:r.bw.hp});
  const ol=$("brawlBoard");ol.hidden=false;ol.innerHTML="";
  for(const x of BRAWL.standings(rows)){const li=document.createElement("li");const d=document.createElement("i");d.className="dot";d.style.background=x.col;
    const n=document.createElement("span");n.className="nm";n.textContent=x.name;const s=document.createElement("span");s.className="st";s.textContent=`${x.ko} KO · ${"♥".repeat(x.hp)}`;
    li.append(d,n,s);if(x.you)li.className="me";ol.appendChild(li)}
}

/* ---------- each frame (after the cars move) ---------- */
function brawlFrame(dt){
  if(!brawl)return;
  if(brawl.w!==WKEY||WKIND!=="floor"){brawlLeave("You left the brawl when you left the floor.");return}
  if(mode!=="drive"&&!fly){brawlLeave("You left the brawl.");return}
  const t=brNow();
  brawlBotsCheck(t);brawlSelf(dt,t);brawlBots(dt,t);brawlPickup(t);brawlThrows(dt,t);brawlDraw(t);brawlHud();brawlBoard(t);
}
// what this player shows everyone (sendPresence adds it as `bw`)
function brawlPres(){if(!brawl)return null;return BRAWL.enc(brawl.st,brNow(),brawl.item,brawl.uses,brawl.pj.filter(p=>p.own==="me"),brawl.hb.map(h=>h.slice(0,3)))}

/* ---------- controls ---------- */
document.addEventListener("visibilitychange",()=>{if(document.hidden&&brawl){brawlLeave("You left the brawl when the page was hidden.");sendPresence()}});
$("bBrawl").onclick=()=>{brawlToggle()};
$("brLeave").onclick=()=>brawlLeave("You left the brawl.");
{const pi=$("pItem");pi.addEventListener("pointerdown",e=>{e.preventDefault();audio();brawlUse(!!tc.brake)});pi.addEventListener("contextmenu",e=>e.preventDefault())}
