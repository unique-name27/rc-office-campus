/* ===================== game part 3b: fun in the normal world: coins, power-up boxes, power-ups ===================== */
// Every floor and the campus have gold coins in short trails (every third trail arcs up: jump for those) and floating
// supply boxes. Drive or walk through a coin to pick it up; your total stays in this browser. Drive through a box for a
// power-up that runs a few seconds (FUN.POWERS: coffee rush, moon jump, coin magnet, double coins). Where they sit is
// the same for everyone (FUN.place); what you have picked up is yours: a coin comes back after COIN_BACK seconds, a box
// after BOX_BACK, and leaving a floor and coming back doesn't reset them.
const COIN_BACK=75,BOX_BACK=15,COIN_R=.55,BOX_R=.65;
let fun=null,power=null,funG=null,funMats=null,funKey="",coinTotal=Math.max(0,parseInt(store.get("rc-coins"),10)||0);
const funKept=new Map(); // world key -> what you picked up there, while you are somewhere else
const funNow=()=>performance.now()/1000;
const FUN_HIDE=new THREE.Matrix4().makeScale(0,0,0),_UM=new THREE.Matrix4(),_UQ=new THREE.Quaternion(),_UE=new THREE.Euler(),_UP=new V3(),_US=new V3(1,1,1);

/* ---------- this world's coins and boxes ---------- */
// placed again whenever the world is built (a new floor, or the same one rebuilt); not on the spawn spot, the elevator
// pads or the doors, where you arrive
function funWorld(){
  if(fun&&fun.root===root&&fun.w===WKEY)return fun;
  funDrop();if(!WM||!root)return null;
  let P={coins:[],boxes:[]};
  try{
    const av=[],s=WM.spawn;if(s)av.push([s.x,s.z,2]);
    for(const e of WM.elevators||[])if(e.pad)av.push([e.pad.x,e.pad.z,(e.pad.r||1)+.8]);
    if(WM.exit)av.push([WM.exit.x,WM.exit.z,(WM.exit.r||1.2)+1]);
    for(const b of WM.buildings||[])if(b.door)av.push([b.door.x,b.door.z,(b.door.r||1.2)+1]);
    P=FUN.place(WKEY,PW,PD,(x,z)=>spotFree(x,z)&&!walkBlocked(x,z),{avoid:av});
  }catch(e){console.error(e)}
  const k=funKept.get(WKEY),same=!!k&&k.c.length===P.coins.length&&k.b.length===P.boxes.length;
  fun={w:WKEY,root,vis:null,
    coins:P.coins.map((c,i)=>{const y=groundY(c.x,c.z)+c.y;return{hx:c.x,hz:c.z,hy:y,x:c.x,z:c.z,y,t:same?k.c[i]:0}}),
    boxes:P.boxes.map((b,i)=>({x:b.x,z:b.z,y:groundY(b.x,b.z),t:same?k.b[i]:0}))};
  return fun;
}
// leaving this world (or it was rebuilt): remember what was picked up, and let go of the meshes
function funDrop(){
  if(!fun)return;funKept.set(fun.w,{c:fun.coins.map(c=>c.t),b:fun.boxes.map(b=>b.t)});
  const v=fun.vis;if(v)for(const m of [v.coin,v.box,v.halo])if(m){if(m.parent)m.parent.remove(m);m.dispose()}
  fun=null;
}

/* ---------- drawing: spinning coins, bobbing boxes with a glow on the floor under each ---------- */
function funVis(){
  const F=fun;if(F.vis)return F.vis;
  if(!funG){const g=funGeos(),halo=new THREE.CircleGeometry(.42,28);halo.rotateX(-Math.PI/2);funG={coin:g.coin,box:g.crate,halo};for(const k in funG)funG[k].userData.keep=true} // shared by every world: clearRoot keeps them
  if(!funMats){
    funMats={coin:new THREE.MeshStandardMaterial({vertexColors:true,metalness:.45,roughness:.3,emissive:0x6a4300,emissiveIntensity:.65}),
      box:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,emissive:0x3a2200,emissiveIntensity:.35}),
      halo:new THREE.MeshBasicMaterial({color:0xFFC24A,transparent:true,opacity:.38,depthWrite:false})};
    for(const k in funMats)funMats[k].userData.keep=true;
  }
  const mk=(g,m,n)=>{if(!n)return null;const im=new THREE.InstancedMesh(g,m,n);im.frustumCulled=false;im.userData.dyn=true;im.userData.noAO=1;im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(im);return im};
  F.vis={coin:mk(funG.coin,funMats.coin,F.coins.length),box:mk(funG.box,funMats.box,F.boxes.length),halo:mk(funG.halo,funMats.halo,F.boxes.length)};
  if(F.vis.halo)F.vis.halo.renderOrder=2;
  return F.vis;
}
function funDraw(t){
  const v=funVis(),F=fun,spin=REDUCED?.8:2.6;
  if(v.coin){
    F.coins.forEach((c,i)=>{if(c.t){v.coin.setMatrixAt(i,FUN_HIDE);return}
      _UE.set(0,t*spin+i*.7,0);_UQ.setFromEuler(_UE);_UP.set(c.x,c.y+(REDUCED?0:Math.sin(t*3+i)*.04),c.z);_UM.compose(_UP,_UQ,_US.set(.85,.85,.85));v.coin.setMatrixAt(i,_UM)});
    v.coin.instanceMatrix.needsUpdate=true;
  }
  if(v.box){
    F.boxes.forEach((b,i)=>{if(b.t||race||run){v.box.setMatrixAt(i,FUN_HIDE);v.halo.setMatrixAt(i,FUN_HIDE);return}
      _UE.set(0,t*1.3+i,0);_UQ.setFromEuler(_UE);_UP.set(b.x,b.y+.5+(REDUCED?0:Math.sin(t*2.2+i)*.07),b.z);_UM.compose(_UP,_UQ,_US.set(1.3,1.3,1.3));v.box.setMatrixAt(i,_UM);
      _UM.makeTranslation(b.x,b.y+.015,b.z);v.halo.setMatrixAt(i,_UM)});
    v.box.instanceMatrix.needsUpdate=true;v.halo.instanceMatrix.needsUpdate=true;
  }
}

/* ---------- power-ups ---------- */
function funPower(id){
  const P=FUN.POWERS[id];if(!P)return;
  power={id,until:funNow()+P.dur,dur:P.dur};me.pu=P;
  SFX.power();pop(me.x,me.y+.65,me.z,P.n+"!","#FFC24A");toast(`${P.n}! ${P.d} for ${P.dur} s`);
  if(P.turbo){const fx=-Math.sin(me.h),fz=-Math.cos(me.h),cur=me.vx*fx+me.vz*fz,want=Math.max(cur,(AVP[me.kind]||AVP.car).bmax*.8);me.vx+=fx*(want-cur);me.vz+=fz*(want-cur);SFX.turbo(2,1)}
  funHud(true);
}
function funPowerEnd(){power=null;me.pu=null;funHud(true)}

/* ---------- each frame (after the cars move) ---------- */
function funFrame(dt){
  if(!WM||!root)return;const F=funWorld();if(!F)return;const t=funNow();
  if(power&&t>=power.until)funPowerEnd();
  const P=power&&FUN.POWERS[power.id];
  if(P&&P.turbo&&mode==="drive")me.turboT=Math.max(me.turboT,.12);   // coffee: a turbo that lasts (top speed, flames)
  const live=!fly&&!trans&&(mode==="drive"||mode==="walk"),walk=mode==="walk",p=walk?walker:me;
  // where your body is, for coins up in the air (on foot you reach them all)
  const py=walk?0:(me.y||0)+(BODY_H[me.kind]||.2)*.5;
  let got=0;
  for(const c of F.coins){
    if(c.t){if(t<c.t)continue;c.t=0;c.x=c.hx;c.z=c.hz;c.y=c.hy}   // back again, where it started (even if a magnet had it)
    if(!live)continue;
    const dx=c.x-p.x,dz=c.z-p.z,d=Math.hypot(dx,dz);
    if(P&&P.magnet&&d<P.magnet&&d>.05){const s=Math.min(d,dt*(5+10*(1-d/P.magnet)));c.x-=dx/d*s;c.z-=dz/d*s;if(!walk)c.y+=(py-c.y)*Math.min(1,dt*5)}
    if(d<COIN_R&&(walk||Math.abs(c.y-py)<.5)){c.t=t+COIN_BACK;got++;for(let k=0;k<5;k++)spark(c.x,c.y,c.z,"#FFD34A",1.6)}
  }
  if(got){const n=got*(P&&P.coin||1);coinTotal+=n;store.set("rc-coins",String(coinTotal));SFX.coin();if(n>1)pop(p.x,walk?1.3:me.y+.55,p.z,"+"+n,"#FFC531");funHud(true)}
  // boxes: driving (as the car, the dog or the cat) through one
  if(live&&!walk&&!race&&!run)for(const b of F.boxes){   // not in a race or coffee run: those times go on shared boards
    if(b.t){if(t<b.t)continue;b.t=0}
    if(Math.hypot(b.x-me.x,b.z-me.z)<BOX_R&&me.y<b.y+1.3){
      b.t=t+BOX_BACK;for(let k=0;k<10;k++)spark(b.x,b.y+.5,b.z,"#FFC24A",2.2);PHYS.burst(b.x,b.y+.5,b.z,"card");
      funPower(FUN.roll(Math.random(),power&&power.id));
    }
  }
  funDraw(t);funHud();
}

/* ---------- HUD: your coins, and the power-up running down ---------- */
function funHud(force){
  const t=funNow(),left=power?Math.max(0,power.until-t):0,key=coinTotal+"|"+(power?power.id+"|"+Math.ceil(left*8):"");
  if(!force&&key===funKey)return;funKey=key;
  const cn=$("coinN"),cs=nf(coinTotal);if(cn.textContent!==cs)cn.textContent=cs;
  const box=$("pwBox");box.hidden=!power;
  if(power){
    const P=FUN.POWERS[power.id];
    if(box.dataset.id!==power.id){box.dataset.id=power.id;$("pwIc").innerHTML=FUN_ICON[power.id]||"";$("pwN").textContent=P.n;box.title=P.n+": "+P.d}
    $("pwBar").style.transform=`scaleX(${(left/power.dur).toFixed(3)})`;
  }else box.dataset.id="";
}
$("coinIc").innerHTML=FUN_ICON.coin;funHud(true);
