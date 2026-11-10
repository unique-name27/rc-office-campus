/* ===================== game part 4: input, UI, search, HUD, multiplayer, data, setup, boot ===================== */

/* ---------- input ---------- */
const keys={},tc={gas:false,brake:false,boost:false,drift:false,joy:false,jx:0,jy:0};
const q=$("q"),typing=()=>{const a=document.activeElement;return!!a&&(a.tagName==="INPUT"||a.tagName==="TEXTAREA"||a.tagName==="SELECT"||a.isContentEditable)};
let edOpen=false;
function readDrive(){
  const k=keys,up=k.KeyW||k.ArrowUp,dn=k.KeyS||k.ArrowDown,lf=k.KeyA||k.ArrowLeft,rt=k.KeyD||k.ArrowRight;
  const boost=!!(k.ShiftLeft||k.ShiftRight||tc.boost),drift=me.kind==="car"&&!!(k.Space||tc.drift);let thr=0,steer=0;
  if(camMode==="top"){
    let dx=(rt?1:0)-(lf?1:0),dz=(dn?1:0)-(up?1:0);if(tc.joy){dx+=tc.jx;dz+=tc.jy}
    const m=Math.min(1,Math.hypot(dx,dz));
    if(m>.18){const hd=Math.atan2(-dx,-dz),d=angDiff(me.h,hd);steer=clamp(d*2.4,-1,1);thr=Math.abs(d)>2.6&&me.vF>1.5?-1:m}
    if(tc.gas&&!(m>.18))thr=1;if(tc.brake)thr=-1;
  }else{
    thr=(up?1:0)-(dn?1:0)+(tc.gas?1:0)-(tc.brake?1:0);steer=(lf?1:0)-(rt?1:0)-(tc.joy?tc.jx*1.3:0);
  }
  return{thr:clamp(thr,-1,1),steer:clamp(steer,-1,1),boost,drift,park:false};
}
function overviewKey(){if(fly||trans)return;if(mode!=="overview")flyTo("overview");else if(WKIND==="floor")goCampus();else{if(camMode==="top")setCam("chase");flyTo("drive",2.4)}}
function goCampus(){return goWorld("campus",{mode:"overview",title:DATA.campus.name||"Campus",sub:`${DATA.campus.buildings.length} buildings`})}
function goFloor(key,dest){return goWorld(key,{mode:"overview"}).then(ok=>{if(ok&&dest){setTarget(dest);routeVisuals(true);ov.tx=dest.x*.5;ov.tz=dest.z*.5}return ok})}
addEventListener("keydown",e=>{
  if(edOpen)return;
  audio();
  if(!$("setup").hidden){if(e.key==="Escape"&&!$("dlg")){closeSetup()}return}
  if(e.key==="/"&&!typing()){e.preventDefault();openFind();return}
  if(e.key==="Escape"){if(typing()){document.activeElement.blur();return}if(!$("stylePop").hidden){closeStyle();return}if($("panel").classList.contains("open")){closeFind();return}if(!$("result").hidden){closeResult();return}if(elevAt){elevDismissed=elevAt.id;hideElev();return}}
  if(typing())return;
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  const tag=document.activeElement&&document.activeElement.tagName;
  if(mode==="drive"&&(e.code==="Space"||e.code.startsWith("Arrow")))e.preventDefault();
  keys[e.code]=true;
  if(tour&&/^(Key[WASD]|Arrow)/.test(e.code))tour=null;
  if(e.repeat)return;
  if(/^Digit[0-9]$/.test(e.code)){const n=+e.code.slice(5);if(elevAt){const b=bldgOfKey(WKEY);if(b&&n>=1&&n<=b.floors)ride(n);return}if(n>=1&&n<=ST.length)applyStyle(n-1);return}
  switch(e.code){
    case"KeyO":overviewKey();break;
    case"KeyC":if(fly||trans)break;if(mode==="overview")flyTo(WKIND==="floor"?"walk":"drive",2.2);else flyTo(mode==="walk"?"drive":"walk",1.1);break;
    case"KeyV":if(mode==="drive")cycleCam();break;
    case"KeyN":applyStyle(cur===1?(prevStyle!=null?prevStyle:0):1);break;
    case"KeyM":setMuted(!muted);toast(muted?"Sound off":"Sound on");break;
    case"KeyH":if(mode==="drive")honk();break;
    case"KeyR":if(mode==="drive"&&!fly&&!trans){if(run)runStart();else if(race)startRace(race.dest);else{const s=WM.spawn||{x:0,z:0,a:0};spawnNear(s.x,s.z,s.a||0);toast("Back at the start")}}break;
    case"KeyT":tidyChairs();toast("Chairs tidied");break;
    case"KeyX":if(route||target){clearRoute();toast("Route cleared")}break;
    case"KeyJ":if(mode==="drive"&&!fly&&!trans)me.jumpReq=true;break;
    case"Space":if(mode==="drive"&&!fly&&!trans&&me.kind!=="car")me.jumpReq=true;break;
    case"KeyY":joinRace();break;
    case"Enter":if(elevAt&&tag!=="BUTTON"){const f=routeNextFloor();if(f){ride(f);break}}if(mode==="drive"&&!fly&&tag!=="BUTTON"){if(run)runCancel("Coffee run cancelled");else if(race)raceCancel("Race cancelled");else runStart()}break;
  }
});
addEventListener("keyup",e=>{keys[e.code]=false;if(e.key==="Meta")stopKeys();if(mode==="drive"&&e.code==="Space")e.preventDefault()});
addEventListener("blur",()=>stopKeys());
function cycleCam(){const order=["chase","bumper","high","top"];setCam(order[(order.indexOf(camMode)+1)%order.length])}
function setCam(m){camMode=m;$("bCam").innerHTML=camName(m)+' <kbd>V</kbd>';$("joyHint").textContent=m==="top"?"Drive":"Steer";camYawOff=0;toast(camName(m)+(m==="top"?": push the way you want to go":""))}
// canvas pointer: overview orbit/zoom + picking, drive look-around, walk look/stick
const ptrs=new Map();let pinch=0,stick=null;
const pickRay=new THREE.Raycaster(),_ndc=new THREE.Vector2();
function look(dx,dy){walker.yaw-=dx*.0022;walker.pitch=clamp(walker.pitch-dy*.0022,-1.3,1.2)}
function ndc(e){const r=cv.getBoundingClientRect();_ndc.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);pickRay.setFromCamera(_ndc,camera)}
function bldgAt(e){if(!bldgMeshes.length)return null;ndc(e);const h=pickRay.intersectObjects(bldgMeshes,false)[0];if(!h)return null;const b=bldg(h.object.userData.bldg);if(!b)return null;return{b,f:clamp(Math.floor(h.point.y/FLOOR_H)+1,1,b.floors)}}
function deskAt(e){
  if(WKIND!=="floor"||!(WM.desks||[]).length)return null;ndc(e);
  const objs=[deskG&&deskG.mesh,chairG[2]&&chairG[2].mesh].filter(Boolean),h=objs.length?pickRay.intersectObjects(objs,false)[0]:null;
  if(h){const di=deskG&&h.object===deskG.mesh?instDesk[h.instanceId]:(chairs[h.instanceId]||{}).desk;if(di!=null&&di>=0)return di}
  // lab benches and shared tables are furniture: take the seat nearest to where the click meets the work surface
  const r=pickRay.ray;if(Math.abs(r.direction.y)<1e-4)return null;const t=(.8-r.origin.y)/r.direction.y;if(t<0)return null;
  const px=r.origin.x+r.direction.x*t,pz=r.origin.z+r.direction.z*t;let best=1.2,bi=null;
  WM.desks.forEach((d,k)=>{const dd=Math.hypot(d.x-px,d.z-pz);if(dd<best){best=dd;bi=k}});return bi;
}
const tip=$("tip");
cv.addEventListener("pointerdown",e=>{
  audio();if(typing())document.activeElement.blur();if(e.button>0)return;
  try{cv.setPointerCapture(e.pointerId)}catch(_){}
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,ox:e.clientX,oy:e.clientY,t0:performance.now(),walk:e.clientX<innerWidth/2,t:e.pointerType,moved:0});
  if(mode==="overview")ov.lastUser=performance.now();
  if(mode==="walk"&&!fly){if(e.pointerType==="mouse"&&cv.requestPointerLock){try{const r=cv.requestPointerLock();r&&r.catch&&r.catch(()=>{})}catch(_){}}else tour=null}
  pinch=0;
});
cv.addEventListener("pointermove",e=>{
  if(mode==="walk"&&document.pointerLockElement===cv){look(e.movementX,e.movementY);return}
  const o=ptrs.get(e.pointerId);
  if(!o){if(mode==="overview"&&WKIND==="campus"&&e.pointerType==="mouse"&&!fly&&!trans){const hit=bldgAt(e);if(hit){tip.hidden=false;tip.textContent=`${hit.b.name} · Floor ${hit.f}`;tip.style.left=e.clientX+"px";tip.style.top=e.clientY+"px";cv.style.cursor="pointer"}else{tip.hidden=true;cv.style.cursor=""}}return}
  const dx=e.clientX-o.x,dy=e.clientY-o.y;o.x=e.clientX;o.y=e.clientY;o.moved+=Math.abs(dx)+Math.abs(dy);
  if(mode==="overview"){
    ov.lastUser=performance.now();tip.hidden=true;
    if(ptrs.size>=2){const a=[...ptrs.values()],d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);if(pinch)ov.zoom=clamp(ov.zoom*pinch/d,.25,1.8);pinch=d}
    else{ov.a-=dx*.005;ov.e=clamp(ov.e+dy*.004,.3,1.45)}
  }else if(mode==="walk"){if(o.t==="touch"){if(o.walk)stick={x:(e.clientX-o.ox)/60,y:(e.clientY-o.oy)/60};else look(dx*1.6,dy*1.6)}else look(dx,dy)}
  else if(mode==="drive"){if(camMode==="top")return;camYawOff=clamp(camYawOff-dx*.006,-3,3);camDrag=true}
});
function ptrUp(e){
  const o=ptrs.get(e.pointerId);
  if(o&&e.type==="pointerup"&&o.moved<8&&performance.now()-o.t0<600&&mode==="overview"&&!fly&&!trans&&ptrs.size===1){
    if(WKIND==="campus"){const hit=bldgAt(e);if(hit){tip.hidden=true;goFloor(CAMPUS.key(hit.b.id,hit.f))}}
    else{const di=deskAt(e);if(di!=null){const d=WM.desks[di];if(d.person>=0){const it=(buildIndex()).find(x=>x.w===WKEY&&x.id==="desk:"+d.id);if(it){openFind(true);showPick(it)}}}}
  }
  if(o&&o.walk)stick=null;ptrs.delete(e.pointerId);if(!ptrs.size){camDrag=false;pinch=0}
}
cv.addEventListener("pointerup",ptrUp);cv.addEventListener("pointercancel",ptrUp);cv.addEventListener("lostpointercapture",e=>{if(ptrs.has(e.pointerId))ptrUp(e)});
cv.addEventListener("pointerleave",()=>{tip.hidden=true});
cv.addEventListener("wheel",e=>{e.preventDefault();if(mode==="overview"){ov.zoom=clamp(ov.zoom*Math.exp(e.deltaY*.0012),.25,1.8);ov.lastUser=performance.now()}else if(mode==="drive"&&camMode==="top"){topH=clamp(topH*Math.exp(e.deltaY*.0012),3.5,WKIND==="campus"?60:24)}},{passive:false});
// touch controls
const joy=$("joy"),knob=$("knob");let joyId=null;
function setKnob(x,y){knob.style.transform=`translate(${x*40}px,${y*40}px)`}
joy.addEventListener("pointerdown",e=>{audio();joyId=e.pointerId;try{joy.setPointerCapture(e.pointerId)}catch(_){}joyMove(e);e.preventDefault()});
function joyMove(e){if(e.pointerId!==joyId)return;const r=joy.getBoundingClientRect(),x=clamp((e.clientX-(r.left+r.width/2))/50,-1,1),y=clamp((e.clientY-(r.top+r.height/2))/50,-1,1);tc.joy=true;tc.jx=x;tc.jy=y;setKnob(x,y)}
joy.addEventListener("pointermove",joyMove);
const joyEnd=e=>{if(e.pointerId!==joyId)return;joyId=null;tc.joy=false;tc.jx=tc.jy=0;setKnob(0,0)};
joy.addEventListener("pointerup",joyEnd);joy.addEventListener("pointercancel",joyEnd);
const PEDALS=[["pGas","gas"],["pBrake","brake"],["pBoost","boost"],["pDrift","drift"]];
function reassertPedals(){for(const[id,k]of PEDALS)if($(id).dataset.on==="1")tc[k]=true}
PEDALS.forEach(([id,k])=>{const b=$(id);
  const on=e=>{audio();tc[k]=true;b.dataset.on="1";try{b.setPointerCapture(e.pointerId)}catch(_){}e.preventDefault()},off=()=>{tc[k]=false;b.dataset.on="0"};
  b.addEventListener("pointerdown",on);b.addEventListener("pointerup",off);b.addEventListener("pointercancel",off);b.addEventListener("contextmenu",e=>e.preventDefault())});
$("pHorn").addEventListener("pointerdown",e=>{e.preventDefault();audio();honk()});

/* ---------- styles: apply + UI ---------- */
let prevStyle=null;
function styleUI(i){
  const root_=document.documentElement;root_.dataset.theme=S.ui;root_.style.setProperty("--ground",S.bg);root_.style.setProperty("--accent",S.acc);root_.style.setProperty("--on-accent",(()=>{const a=lum(S.acc),d=lum("#14161f");return(a+.05)/(d+.05)>1.05/(a+.05)?"#14161f":"#ffffff"})());
  $("tiltT").hidden=$("tiltB").hidden=!S.tilt;$("scan").hidden=!S.scan;$("vig").hidden=!S.vignette;
  renderer.toneMapping=S.tone?THREE.ACESFilmicToneMapping:THREE.NoToneMapping;renderer.toneMappingExposure=S.exposure||1;
  cv.style.imageRendering=S.pixel?"pixelated":"";cv.style.filter=S.glowCss||(S.tilt?"saturate(1.35) contrast(1.05)":"");
  document.querySelectorAll(".chip[data-i]").forEach(c=>c.setAttribute("aria-pressed",String(+c.dataset.i===i)));
  $("styleName").textContent=S.n;$("styleDescA").textContent=$("styleDescB").textContent=S.d;store.set("rc-style",String(i));store.set("rc-style-v","2");
}
function applyStyle(i){
  if(i===cur&&root)return;if(i!==1&&cur!==1)prevStyle=null;if(i===1&&cur!==1)prevStyle=cur;
  clearRoot();S=ST[i];cur=i;buildWorld();buildCars();fxRestyle();rebuildTags();restoreCups();
  setTarget(target);routeVisuals(true);updateGates();
  styleUI(i);
  if(S.cam&&mode==="drive"&&camMode==="chase")setCam(S.cam);
  resize();drawMapBase();labelsClear();
  if(markerTag){disposeSprite(markerTag);markerTag=null;markerFor=-1}
}
["chipsA","chipsB"].forEach(id=>{const box=$(id);ST.forEach((s,i)=>{const b=document.createElement("button");b.type="button";b.className="chip";b.dataset.i=i;b.textContent=(i+1)+". "+s.n;b.setAttribute("aria-pressed","false");b.onclick=()=>applyStyle(i);box.appendChild(b)})});
function openStyle(){$("stylePop").hidden=false;$("bStyle").setAttribute("aria-expanded","true");const p=$("stylePop").querySelector('.chip[aria-pressed="true"]');(p||$("styleClose")).focus()}
function closeStyle(){$("stylePop").hidden=true;$("bStyle").setAttribute("aria-expanded","false")}
$("bStyle").onclick=()=>{$("stylePop").hidden?openStyle():closeStyle()};
$("styleClose").onclick=closeStyle;
const swatches=()=>me.kind==="car"?PAINTS:COATS[me.kind];
function setPaint(p){paint=p;me.paint=p;store.set(me.kind==="car"?"rc-paint":"rc-coat-"+me.kind,p);if(root){dropVis(me.vis);me.vis=makeAvatar(me.kind,p)}if(meTag){disposeSprite(meTag);meTag=tagSprite(myName||"You",p);tags.add(meTag)}document.querySelectorAll(".sw").forEach(s=>s.setAttribute("aria-checked",String(s.dataset.p===p)));$("paintName").textContent=(swatches().find(x=>x[0]===p)||[0,""])[1];presDirty=true}
function renderSwatches(){const box=$("paints");box.innerHTML="";box.setAttribute("aria-label",me.kind==="car"?"Car paint":"Coat color");$("paintLbl").textContent=me.kind==="car"?"Paint":"Coat";
  swatches().forEach(([p,n])=>{const b=document.createElement("button");b.type="button";b.className="sw";b.style.background=p;b.dataset.p=p;b.setAttribute("role","radio");b.setAttribute("aria-label",n);b.onclick=()=>setPaint(p);box.appendChild(b)})}
$("paints").addEventListener("keydown",e=>{if(!/Arrow(Left|Right|Up|Down)/.test(e.key))return;e.preventDefault();e.stopPropagation();const L=swatches(),i=L.findIndex(x=>x[0]===paint),n=(i+(/Right|Down/.test(e.key)?1:-1)+L.length)%L.length;setPaint(L[n][0]);$("paints").children[n].focus()});
// play as an RC car, a dog or a cat
function setAvatar(av){
  if(!AV_KINDS.has(av))av="car";me.kind=av;store.set("rc-av",av);document.body.classList.toggle("animal",av!=="car");
  document.querySelectorAll("#avChips .chip").forEach(c=>c.setAttribute("aria-checked",String(c.dataset.av===av)));
  $("avName").textContent=(AVATARS.find(x=>x[0]===av)||[0,""])[1];
  $("pBoost").textContent=av==="car"?"Boost":"Sprint";$("pHorn").textContent=av==="dog"?"Bark":av==="cat"?"Meow":"Horn";
  renderSwatches();const L=swatches(),saved=store.get(av==="car"?"rc-paint":"rc-coat-"+av);setPaint(L.some(x=>x[0]===saved)?saved:L.some(x=>x[0]===paint)?paint:L[0][0]);
  $("bCam").innerHTML=camName(camMode)+' <kbd>V</kbd>';setHelp();
}
AVATARS.forEach(([k,n])=>{const b=document.createElement("button");b.type="button";b.className="chip";b.dataset.av=k;b.textContent=n;b.setAttribute("role","radio");b.setAttribute("aria-checked","false");b.onclick=()=>setAvatar(k);$("avChips").appendChild(b)});
$("avChips").addEventListener("keydown",e=>{if(!/Arrow(Left|Right|Up|Down)/.test(e.key))return;e.preventDefault();e.stopPropagation();const i=AVATARS.findIndex(x=>x[0]===me.kind),n=(i+(/Right|Down/.test(e.key)?1:-1)+AVATARS.length)%AVATARS.length;setAvatar(AVATARS[n][0]);$("avChips").children[n].focus()});
$("pJump").addEventListener("pointerdown",e=>{e.preventDefault();audio();if(mode==="drive")me.jumpReq=true});
$("go").onclick=()=>{if(camMode==="top")setCam("chase");flyTo("drive",2.4)};
$("goTop").onclick=()=>{camMode="top";$("bCam").innerHTML=camName("top")+' <kbd>V</kbd>';$("joyHint").textContent="Drive";flyTo("drive",2.2)};
$("goWalk").onclick=()=>flyTo("walk",2.4);
$("bOver").onclick=()=>{if(!fly&&!trans)flyTo("overview")};
$("bUp").onclick=$("bUp2").onclick=()=>{if(!fly&&!trans)goCampus()};
$("bSwap").onclick=()=>{if(!fly&&!trans)flyTo(mode==="walk"?"drive":"walk",1.1)};
$("bCam").onclick=cycleCam;
$("bar").addEventListener("click",e=>{const b=e.target.closest("button");if(b&&e.detail>0&&document.activeElement===b)b.blur()});
$("bRun").onclick=()=>{if(run)runCancel("Coffee run cancelled");else runStart()};
$("bSound").onclick=()=>{audio();setMuted(!muted)};
function closeTimes(){$("side").classList.remove("open");$("bTimes").setAttribute("aria-expanded","false");$("start").classList.remove("tucked")}
$("bTimes").onclick=()=>{const o=$("side").classList.toggle("open");$("bTimes").setAttribute("aria-expanded",String(o));$("start").classList.toggle("tucked",o)};
document.addEventListener("pointerdown",()=>audio(),{once:true});

/* ---------- start card, brand, building + floor pickers ---------- */
// counts from the seating lists (cheap: no floor models needed for the campus card)
function campusStats(){let people=0;for(const k of floorKeys())people+=(DATA.rosters[k]||[]).length;return{people}}
function updateBrand(){
  $("brandT").textContent=WKIND==="campus"?(DATA.campus.name||"Campus"):floorName(WKEY);
  $("brandS").textContent=WKIND==="campus"?"RC office":(WM.stats?plural(WM.stats.occupied||0,"person","people"):"RC office");
  $("mapCap").textContent=WKIND==="campus"?"Outside":floorShort(WKEY);
}
function renderStart(){
  if(!DATA)return;
  const camp=WKIND==="campus",c=DATA.campus;
  $("goWalk").textContent=camp?"Walk around":"Walk the floor";
  $("myDesk").hidden=!myDesk;
  $("bSetup").hidden=$("bSetup2").hidden=!canSetup;
  const ban=$("banner");ban.hidden=!DATA.demo;ban.textContent=canSetup?"These are sample people. Load your real seating in Set up.":"These are sample people until the page owner loads real seating.";
  if(camp){
    const st=campusStats(),nf=floorKeys().length;
    $("stKick").textContent=`${c.name||"Campus"} · ${plural(c.buildings.length,"building")} · ${plural(nf,"floor")} · ${nf_(st.people)} people`;
    $("startH").textContent="Drive the campus";
    $("stP").textContent="Pick a floor to look around, or take the wheel outside and drive in through a front door. Everyone who opens this page drives here too.";
    const box=$("bldgs");box.innerHTML="";
    for(const b of c.buildings){
      const el=document.createElement("div");el.className="bl";
      const n=document.createElement("div");n.className="bn";n.textContent=b.name;
      const fl=document.createElement("div");fl.className="fls";fl.setAttribute("role","group");fl.setAttribute("aria-label",b.name+" floors");
      let ppl=0;const teams=new Set();
      for(let f=1;f<=b.floors;f++){const k=CAMPUS.key(b.id,f),ro=DATA.rosters[k]||[];ppl+=ro.length;ro.forEach(p=>p.team&&teams.add(p.team));
        const btn=document.createElement("button");btn.type="button";btn.className="fl";btn.textContent=f+"F";btn.title=`${b.name} · Floor ${f}`;btn.setAttribute("aria-label",`${b.name}, floor ${f}`+(myDesk&&myDesk.w===k?" (your desk)":""));if(myDesk&&myDesk.w===k){const y=document.createElement("span");y.className="you";y.textContent="you";btn.appendChild(y)}btn.onclick=()=>goFloor(k);fl.appendChild(btn)}
      const s=document.createElement("div");s.className="bs";const tl=[...teams];s.textContent=`${nf_(ppl)} people · ${tl.slice(0,3).join(", ")}${tl.length>3?` +${tl.length-3} more`:""}`;
      el.append(n,fl,s);box.appendChild(el);
    }
    $("ovKeys").textContent="Drag to spin · scroll to zoom · click a building to open a floor";
  }else{
    const p=CAMPUS.parseKey(WKEY),b=bldg(p.b),st=WM.stats||{};
    $("stKick").textContent=`${b.name} · Floor ${p.f} · ${nf_(st.occupied||0)} people · ${nf_(st.desks||0)} desks`;
    $("startH").textContent=`${b.short||b.name} · Floor ${p.f}`;
    const tl=(WM.teams||[]).filter(t=>t.team).sort((x,y)=>y.count-x.count).map(t=>t.team);
    $("stP").textContent=tl.length?(tl.length===1?tl[0]+" sits here.":tl.slice(0,-1).join(", ")+" and "+tl[tl.length-1]+" sit here.")+" Take the elevator to other floors, or drive out the front door on floor 1.":"Nobody sits on this floor yet.";
    const fc=$("flChips");fc.innerHTML="";for(let f=1;f<=b.floors;f++){const k=CAMPUS.key(b.id,f),btn=document.createElement("button");btn.type="button";btn.className="fl";btn.textContent=f+"F";btn.setAttribute("aria-label","Floor "+f);if(f===p.f)btn.setAttribute("aria-current","true");btn.onclick=()=>{if(k!==WKEY)goFloor(k)};fc.appendChild(btn)}
    $("ovKeys").textContent="Drag to spin · scroll to zoom · click a desk to see who sits there";
    const sp=DATA.floors[WKEY];$("planT").hidden=!(sp&&sp.plan&&sp.plan.asset);$("planT").textContent=planOn?"Hide floor plan":"Show floor plan";
  }
  renderLegend();
}
const nf_=nf;
function rebuildScene(){clearRoot();buildWorld();buildCars();rebuildTags();restoreCups();setTarget(target);routeVisuals(true);updateGates();drawMapBase();labelsClear()}
$("planT").onclick=()=>{planOn=!planOn;store.set("rc-plan",planOn?"1":"0");rebuildScene();renderStart()};
function renderLegend(){
  const lg=$("legend");lg.innerHTML="";if(WKIND!=="floor")return;
  (WM.teams||[]).filter(t=>t.team&&t.count).slice(0,10).forEach(t=>{const el=document.createElement("span"),i=document.createElement("i"),n=document.createElement("em"),b=document.createElement("b");i.style.background=teamColorOf(t.team);n.textContent=t.team;b.textContent=t.count;el.append(i,n,b);lg.appendChild(el)});
}

/* ---------- find: people, rooms and amenities on every floor ---------- */
let peopleIdx=null;
function buildIndex(){
  if(peopleIdx)return peopleIdx;const out=[];
  for(const k of floorKeys()){const m=modelFor(k);if(!m)continue;const byId=new Map();(m.desks||[]).forEach((d,i)=>byId.set("desk:"+d.id,i));
    for(const d of m.dests||[]){
      if(!isFinite(d.x)||!isFinite(d.z))continue;
      if(d.kind==="desk"){const di=byId.get(d.id);const desk=di!=null?m.desks[di]:null;if(!desk||desk.person<0)continue;const p=m.people[desk.person];if(!p)continue;
        out.push({w:k,kind:"desk",id:d.id,di,name:p.name,team:p.team,sub:`${p.title?p.title+" · ":""}${p.team||"No team"} · ${floorShort(k)} · Desk ${desk.id}`,x:d.x,z:d.z,a:d.a||0,s:(p.name+" "+(p.team||"")+" "+(p.title||"")+" "+desk.id).toLowerCase()})}
      else{if(/^elev:/.test(d.id)||d.id==="exit")continue;out.push({w:k,kind:d.kind,id:d.id,name:d.name,sub:(d.sub?d.sub+" · ":"")+floorShort(k),x:d.x,z:d.z,a:d.a||0,s:(d.name+" "+(d.sub||"")+" "+floorName(k)).toLowerCase()})}
    }
  }
  const E=extModel();if(E)for(const d of E.dests||[])if(isFinite(d.x))out.push({w:"campus",kind:"amenity",id:d.id,name:d.name,sub:d.sub||"Outside",x:d.x,z:d.z,a:d.a||0,s:(d.name+" "+(d.sub||"")).toLowerCase()});
  peopleIdx=out;findMyDesk();return out;
}
const results=$("results");let resList=[],resSel=-1,picked=null;
function openFind(keepPick){$("panel").classList.add("open");$("bFind").setAttribute("aria-expanded","true");if(document.pointerLockElement)document.exitPointerLock();const idx=buildIndex();$("findK").textContent=`${DATA.campus.name||"Campus"} · ${nf(idx.filter(x=>x.kind==="desk").length)} people · ${nf(idx.filter(x=>x.kind!=="desk").length)} rooms`;if(!keepPick){$("pick").hidden=true;picked=null}if(!keepPick||innerWidth>760)q.focus()}
function closeFind(){$("panel").classList.remove("open");$("bFind").setAttribute("aria-expanded","false");q.blur()}
$("bFind").onclick=()=>$("panel").classList.contains("open")?closeFind():openFind();
function search(v){
  v=v.trim().toLowerCase();if(!v)return[];const toks=v.split(/\s+/);const out=[];
  for(const it of buildIndex()){if(!toks.every(t=>it.s.includes(t)))continue;const nm=it.name.toLowerCase();let sc=nm.startsWith(v)?0:nm.split(/\s+/).some(w=>w.startsWith(toks[0]))?1:nm.includes(v)?2:3;if(it.w===WKEY)sc-=.5;if(it.kind!=="desk")sc+=.2;out.push([sc,it])}
  out.sort((a,b)=>a[0]-b[0]||a[1].name.localeCompare(b[1].name));return out.slice(0,8).map(a=>a[1]);
}
const KIND_LABEL=it=>it.kind==="desk"?"":it.id==="kitchen"?"Kitchen":/^room:/.test(it.id)?"Room":"Place";
function renderResults(list,msg){
  results.innerHTML="";resList=list;resSel=-1;
  list.forEach((it,i)=>{const li=document.createElement("li"),b=document.createElement("button");b.type="button";b.setAttribute("role","option");b.id="res"+i;b.setAttribute("aria-selected","false");
    const n=document.createElement("span");n.className="rn";n.textContent=it.name;const kl=KIND_LABEL(it);if(kl){const k=document.createElement("span");k.className="kd";k.textContent=kl;n.appendChild(k)}
    const m=document.createElement("span");m.className="rm";m.textContent=it.sub;b.append(n,m);b.onclick=()=>showPick(it);li.appendChild(b);results.appendChild(li)});
  if(msg){const li=document.createElement("li");li.style.cssText="font-size:13px;color:var(--muted);padding:6px 8px";li.textContent=msg;results.appendChild(li)}
}
q.addEventListener("input",()=>{const v=q.value.trim();if(!v){renderResults([]);return}const hits=search(v);renderResults(hits,hits.length?"":`No one or nothing matches “${v}”.`)});
q.addEventListener("keydown",e=>{
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){if(!resList.length)return;e.preventDefault();resSel=(resSel+(e.key==="ArrowDown"?1:-1)+resList.length)%resList.length;results.querySelectorAll("button[role=option]").forEach((b,i)=>b.setAttribute("aria-selected",String(i===resSel)));q.setAttribute("aria-activedescendant","res"+resSel);const b=$("res"+resSel);b&&b.scrollIntoView({block:"nearest"})}
  else if(e.key==="Enter"){const it=resList[resSel>=0?resSel:0];if(it)showPick(it)}
});
function showPick(it){
  picked=it;$("pick").hidden=false;$("pickN").textContent=it.name;$("pickM").textContent=it.sub;
  $("pRoute").textContent=mode==="walk"&&it.w===WKEY?"Walk me there":"Show route";
  $("pView").hidden=mode!=="overview"&&it.w===WKEY;$("pView").textContent=it.w===WKEY?"Show on floor":"See "+floorShort(it.w);
  $("pRace").hidden=it.w===WKEY&&Math.hypot(it.x-(WM.spawn||{x:0}).x,it.z-(WM.spawn||{z:0}).z)<6;
  setTarget(it);routeVisuals(true);
  $("pRoute").focus();
}
$("pRoute").onclick=()=>{const it=picked;if(!it)return;
  if(mode==="walk"&&it.w===WKEY){setTarget(it);tour={t:0,dur:Math.min(3.2,1+Math.hypot(it.x-walker.x,it.z-walker.z)/18),from:{x:walker.x,z:walker.z,yaw:walker.yaw,pitch:walker.pitch},to:{x:it.x,z:it.z,yaw:walker.yaw+angDiff(walker.yaw,it.a||0),pitch:-.32}};if(innerWidth<=760)closeFind();return}
  if(routeTo(it)){if(mode==="overview"){toast("Route ready. Take the wheel to drive it.")}if(innerWidth<=760||mode!=="overview")closeFind()}};
$("pRace").onclick=()=>{const it=picked;if(!it)return;closeFind();startRace(it)};
$("pView").onclick=()=>{const it=picked;if(!it)return;closeFind();if(it.w!==WKEY)goFloor(it.w,it).then(()=>{if(mode!=="overview")flyTo("overview")});else{if(mode!=="overview")flyTo("overview");setTarget(it);routeVisuals(true);ov.tx=it.x*.5;ov.tz=it.z*.5}};
$("rand").onclick=()=>{const ppl=buildIndex().filter(x=>x.kind==="desk");if(!ppl.length)return;const local=ppl.filter(x=>x.w===WKEY),pool_=local.length&&Math.random()<.6?local:ppl;showPick(pool_[Math.floor(Math.random()*pool_.length)])};
$("clear").onclick=()=>{clearRoute();$("pick").hidden=true};
let myDesk=null;
const normName=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
// match the signed-in name to the seating (only the floor that has them gets built)
function findMyDesk(){
  myDesk=null;const n=normName(myName);
  if(n&&DATA)for(const k of floorKeys()){
    if(!(DATA.rosters[k]||[]).some(p=>normName(p.name)===n))continue;
    const m=modelFor(k);if(!m)break;const pi=(m.people||[]).findIndex(p=>normName(p.name)===n),p=m.people[pi],d=p&&m.desks[p.desk];
    const dest=d&&(m.dests||[]).find(x=>x.id==="desk:"+d.id);
    if(dest)myDesk={w:k,kind:"desk",id:dest.id,di:p.desk,name:p.name,team:p.team,sub:`${p.title?p.title+" · ":""}${p.team||"No team"} · ${floorShort(k)} · Desk ${d.id}`,x:dest.x,z:dest.z,a:dest.a||0,s:""};
    break;
  }
  $("myDeskB").hidden=!myDesk;$("myDesk").hidden=!myDesk;
}
$("myDeskB").onclick=$("myDesk").onclick=()=>{if(!myDesk)return;showPick(myDesk);openFind(true);if(mode!=="overview"||myDesk.w===WKEY){routeTo(myDesk)}};

/* ---------- labels near you ---------- */
const labelCache=new Map(),liveLabels=new Set();
function labelFor(di){if(labelCache.has(di))return labelCache.get(di);const d=WM.desks[di],p=WM.people[d.person];const s=spriteFrom(textCanvas([p?p.name:"Open desk",d.id],{size:48,pad:18,stripe:p?teamColorOf(d.team):"#BDBBB3"}),.26);const ch=d.chair>=0&&WM.chairs[d.chair];s.position.set(ch?(d.x*.55+ch.x*.45):d.x,1.42,ch?(d.z*.55+ch.z*.45):d.z);labelCache.set(di,s);return s}
function labelsClear(){for(const i of liveLabels){const s=labelCache.get(i);if(s)scene.remove(s)}liveLabels.clear();for(const s of labelCache.values())disposeSprite(s);labelCache.clear()}
function updateLabels(){
  if(WKIND!=="floor"){if(liveLabels.size)labelsClear();return}
  let fxp,fzp,rng,max;
  if(mode==="walk"){fxp=walker.x;fzp=walker.z;rng=7;max=36}else if(mode==="drive"&&!fly){fxp=me.x;fzp=me.z;rng=camMode==="top"?Math.min(9,topH*.9):5.5;max=camMode==="top"?44:26}else{rng=-1;max=0}
  const near=[],desks=WM.desks||[];if(rng>0)for(let i=0;i<desks.length;i++){const d=desks[i];if(d.person<0)continue;const dd=Math.abs(d.x-fxp)+Math.abs(d.z-fzp);if(dd<rng*1.42){const e=Math.hypot(d.x-fxp,d.z-fzp);if(e<rng)near.push([e,i])}}
  near.sort((a,b)=>a[0]-b[0]);const want=new Set(near.slice(0,max).map(a=>a[1]));if(target&&target.kind==="desk"&&target.w===WKEY&&target.di>=0&&mode!=="overview")want.add(target.di);
  for(const i of liveLabels)if(!want.has(i)){scene.remove(labelFor(i));liveLabels.delete(i)}
  for(const i of want)if(!liveLabels.has(i)&&WM.desks[i]&&WM.desks[i].person>=0){scene.add(labelFor(i));liveLabels.add(i)}
  const sc=mode==="drive"&&camMode==="top"?clamp(topH/5,1,3.2):1;
  for(const i of liveLabels){const s=labelFor(i);s.scale.set(.26*sc*s.userData.ar,.26*sc,1)}
}

/* ---------- tags over cars + honk pops ---------- */
function tagSprite(name,col){return spriteFrom(textCanvas([name],{size:44,pad:16,stripe:col}),.13,true)}
let meTag=null,botTag=null;
function rebuildTags(){
  disposeSprite(meTag);disposeSprite(botTag);meTag=tagSprite(myName||"You",paint);botTag=tagSprite("Mailbot",bot.paint);tags.add(meTag);tags.add(botTag);
  for(const r of remotes.values()){disposeSprite(r.tag);r.tag=null}
}
function placeTag(s,x,y,z){if(!s)return;s.position.set(x,y,z);const d=camera.position.distanceTo(s.position),k=clamp(d/4.2,1,15)*s.userData.h;s.scale.set(k*s.userData.ar,k,1)}
const pops=[];
function pop(x,y,z,txt,col){const s=spriteFrom(textCanvas([txt],{size:52,pad:14,stripe:col}),.12,true);s.position.set(x,y,z);tags.add(s);pops.push({s,t:0})}
function popsFrame(dt){for(let i=pops.length-1;i>=0;i--){const p=pops[i];p.t+=dt;p.s.position.y+=dt*.5;const d=camera.position.distanceTo(p.s.position),k=clamp(d/3.2,1,26)*p.s.userData.h*(1+Math.min(1,p.t*6)*.3);p.s.scale.set(k*p.s.userData.ar,k,1);p.s.material.opacity=1-Math.max(0,(p.t-.5)/.4);if(p.t>.9){disposeSprite(p.s);pops.splice(i,1)}}}
let hornCount=0,lastHonk=0;
const HONK={car:["horn","HONK"],dog:["bark","WOOF"],cat:["meow","MEOW"]};
function honk(){const n=performance.now();if(n-lastHonk<350)return;lastHonk=n;hornCount++;const h=HONK[me.kind]||HONK.car;SFX[h[0]](1);pop(me.x,me.y+.5+tagH(me.kind)-.36,me.z,h[1],paint);presDirty=true}
const tagH=k=>k==="dog"?.66:k==="cat"?.52:.36;

/* ---------- look card (walk: who you're looking at; drive: whose desk you're under / whose chair you bumped) ---------- */
const ray=new THREE.Raycaster(),lookEl=$("look");ray.far=9;let lastLook=-2,bumpMsg=null;
function deskInfo(di){const d=WM.desks[di],p=d&&d.person>=0?WM.people[d.person]:null;return{d,p}}
function bumpedChair(ch){if(ch.desk<0)return;const{d,p}=deskInfo(ch.desk);if(!d)return;bumpMsg={i:ch.desk,t:performance.now(),txt:p?"You bumped "+p.name+"'s chair":"You bumped an open desk's chair"}}
function underDesk(x,z){const desks=WM.desks||[];for(let k=0;k<desks.length;k++){const d=desks[k];if(d.arr==="hot"||d.arr==="lab")continue;const dx=x-d.x,dz=z-d.z;if(Math.abs(dx)>1.2||Math.abs(dz)>1.2)continue;const c=Math.cos(d.a||0),s=Math.sin(d.a||0),lx=dx*c-dz*s,lz=dx*s+dz*c,w=d.w||1.56,dd=d.dd||.78;if(Math.abs(lx)<w/2&&Math.abs(lz)<dd/2)return k}return -1}
function updateLookCard(force){
  let i=null,title="",meta="";
  if(WKIND==="floor"&&mode==="walk"&&!fly&&(WM.desks||[]).length){ray.setFromCamera({x:0,y:0},camera);const objs=[deskG&&deskG.mesh,chairG[2]&&chairG[2].mesh,chairG[3]&&chairG[3].mesh].filter(Boolean);const h=objs.length?ray.intersectObjects(objs,false)[0]:null;
    let di=h?(deskG&&h.object===deskG.mesh?instDesk[h.instanceId]:(chairs[h.instanceId]||{desk:-1}).desk):-1;
    if(di<0){ // lab benches and shared tables are furniture, not desk tops: pick the nearest seat you're facing
      let best=2.3;const fx_=-Math.sin(walker.yaw),fz_=-Math.cos(walker.yaw);
      (WM.desks||[]).forEach((d,k)=>{const dx=d.x-walker.x,dz=d.z-walker.z,dist=Math.hypot(dx,dz);if(dist<best&&dist>.05&&(dx*fx_+dz*fz_)/dist>.8){best=dist;di=k}})}
    if(di>=0){const{d,p}=deskInfo(di);i=di;title=p?p.name:"Open desk";meta=p?`${p.title?p.title+" · ":""}${p.team||""} · ${d.id}`:`${d.id} · Bookable desk`}}
  else if(WKIND==="floor"&&mode==="drive"&&!fly){
    if(bumpMsg&&performance.now()-bumpMsg.t<1800){i=1e6+bumpMsg.i;title=bumpMsg.txt;const{d,p}=deskInfo(bumpMsg.i);meta=p?`${p.title?p.title+" · ":""}${d.id}`:d.id}
    else{const k=underDesk(me.x,me.z);if(k>=0){const{d,p}=deskInfo(k);i=k;const on=me.y>.5;title=p?(on?"On ":"Under ")+p.name+"'s desk":(on?"On an open desk":"Under an open desk");meta=p?`${p.title?p.title+" · ":""}${p.team||""}`:d.id}}
  }
  if(i===lastLook&&!force)return;lastLook=i;
  if(i==null){lookEl.hidden=true;return}
  lookEl.hidden=false;$("lookName").textContent=title;$("lookMeta").textContent=meta;
}

/* ---------- toast ---------- */
let toastT=0;function toast(m){const t=$("toast");t.textContent=m;t.dataset.show="1";clearTimeout(toastT);toastT=setTimeout(()=>t.dataset.show="0",2800)}
function toastAir(s){if(s>.45)pop(me.x,me.y+.5,me.z,s.toFixed(1)+"s air",paint)}

/* ---------- minimap ---------- */
const map=$("map"),mg=map.getContext("2d"),mbase=document.createElement("canvas");mbase.width=map.width;mbase.height=map.height;
let msc=1,mox=0,moz=0;const mx=x=>mox+(x+PW/2)*msc,mz=z=>moz+(z+PD/2)*msc;
function drawMapBase(){
  const g=mbase.getContext("2d"),dark=S.ui==="dark",ink=dark?"#C9D2E3":"#5D655F",W_=mbase.width,H_=mbase.height;g.clearRect(0,0,W_,H_);
  msc=Math.min(W_/PW,H_/PD)*.97;mox=(W_-PW*msc)/2;moz=(H_-PD*msc)/2;
  if(!WM)return;
  if(WKIND==="campus"){
    g.fillStyle=dark?"rgba(255,255,255,.05)":"#DCE5D2";g.fillRect(mx(-PW/2),mz(-PD/2),PW*msc,PD*msc);
    const AC2={road:dark?"rgba(255,255,255,.16)":"#B9B7AF",parking:dark?"rgba(255,255,255,.1)":"#CFCDC6",plaza:dark?"rgba(255,255,255,.08)":"#EDEAE2",walk:dark?"rgba(255,255,255,.08)":"#EDEAE2",grass:dark?"rgba(120,255,140,.08)":"#CFE0C3"};
    (WM.areas||[]).forEach(a=>{g.fillStyle=AC2[a.kind]||AC2.plaza;g.fillRect(mx(a.x-a.w/2),mz(a.z-a.d/2),a.w*msc,a.d*msc)});
    (WM.buildings||[]).forEach(b=>{g.fillStyle=ink;g.fillRect(mx(b.x-b.w/2),mz(b.z-b.d/2),b.w*msc,b.d*msc);g.fillStyle=dark?"#07071A":"#FFFFFF";g.font="700 18px Archivo, sans-serif";g.textAlign="center";g.textBaseline="middle";g.fillText(b.short||b.id,mx(b.x),mz(b.z));if(b.door){g.fillStyle=S.acc;g.beginPath();g.arc(mx(b.door.x),mz(b.door.z),5,0,7);g.fill()}});
    return;
  }
  g.fillStyle=dark?"rgba(255,255,255,.05)":"#E4E2DB";g.fillRect(mx(-PW/2),mz(-PD/2),PW*msc,PD*msc);
  (WM.areas||[]).forEach(a=>{const c=a.team?teamColorOf(a.team):a.kind==="esd"?"#3F7FB0":a.kind==="tile"?"#FFFFFF":null;if(!c)return;g.fillStyle=c+(dark?"44":"33");g.fillRect(mx(a.x-a.w/2),mz(a.z-a.d/2),a.w*msc,a.d*msc)});
  (WM.rooms||[]).forEach(r=>{if(r.type==="open")return;g.fillStyle=r.solid?(dark?"rgba(255,255,255,.18)":"#C9C6BD"):"transparent";g.fillRect(mx(r.x-r.w/2),mz(r.z-r.d/2),r.w*msc,r.d*msc)});
  (WM.desks||[]).forEach(d=>{g.fillStyle=d.person>=0?teamColorOf(d.team):"#BDBBB3";const w=(Math.abs(Math.sin(d.a||0))>.5?d.dd:d.w)||1.5,dd=(Math.abs(Math.sin(d.a||0))>.5?d.w:d.dd)||.78;g.fillRect(mx(d.x-w/2),mz(d.z-dd/2),Math.max(1,w*msc),Math.max(1,dd*msc))});
  g.strokeStyle=ink;g.lineCap="round";(WM.walls||[]).forEach(w=>{g.lineWidth=w.kind==="ext"?3:w.kind==="part"?.8:w.kind==="glass"?1:1.6;g.globalAlpha=w.kind==="glass"?.6:1;g.beginPath();g.moveTo(mx(w.x1),mz(w.z1));g.lineTo(mx(w.x2),mz(w.z2));g.stroke()});g.globalAlpha=1;
  g.fillStyle="#F2C14E";(WM.ramps||[]).forEach(r=>{const l=r.k==="hump"?r.len:r.len+KB,w=r.w;r.ax==="x"?g.fillRect(mx(r.x-l/2),mz(r.z-w/2),l*msc,w*msc):g.fillRect(mx(r.x-w/2),mz(r.z-l/2),w*msc,l*msc)});
  g.fillStyle=S.acc;(WM.elevators||[]).forEach(e=>{if(e.pad)g.fillRect(mx(e.pad.x)-4,mz(e.pad.z)-4,8,8)});if(WM.exit){g.beginPath();g.arc(mx(WM.exit.x),mz(WM.exit.z),5,0,7);g.fill()}
}
function mapArrow(x,z,h,col,big){mg.save();mg.translate(mx(x),mz(z));mg.rotate(-h);mg.fillStyle=col;mg.strokeStyle=S.ui==="dark"?"#07071A":"#ffffff";mg.lineWidth=2;const s=big?1.3:1;mg.beginPath();mg.moveTo(0,-9*s);mg.lineTo(6*s,7*s);mg.lineTo(-6*s,7*s);mg.closePath();mg.fill();mg.stroke();mg.restore()}
function drawMap(){
  mg.clearRect(0,0,map.width,map.height);mg.drawImage(mbase,0,0);
  const leg=race?{pts:race.pts}:curLeg();
  if(leg&&leg.pts&&leg.pts.length>1){mg.strokeStyle=S.acc;mg.lineWidth=3;mg.lineJoin="round";mg.beginPath();leg.pts.forEach((p,i)=>i?mg.lineTo(mx(p[0]),mz(p[1])):mg.moveTo(mx(p[0]),mz(p[1])));mg.stroke();const e=leg.pts[leg.pts.length-1];mg.fillStyle=S.acc;mg.beginPath();mg.arc(mx(e[0]),mz(e[1]),6,0,7);mg.fill()}
  else{const obj=objective();if(obj){mg.strokeStyle=S.acc;mg.setLineDash([6,6]);mg.lineWidth=2;mg.beginPath();const p=mode==="walk"?walker:me;mg.moveTo(mx(p.x),mz(p.z));mg.lineTo(mx(obj.x),mz(obj.z));mg.stroke();mg.setLineDash([]);mg.fillStyle=S.acc;mg.beginPath();mg.arc(mx(obj.x),mz(obj.z),7,0,7);mg.fill()}}
  if(BOTPATH.length)mapArrow(bot.x,bot.z,bot.h,bot.paint);
  for(const r of remotes.values()){if(!r.has||r.w!==WKEY||r.m==="o")continue;if(r.m==="w"&&r.wx!=null){mg.fillStyle=r.paint;mg.beginPath();mg.arc(mx(r.wx),mz(r.wz),5,0,7);mg.fill()}mapArrow(r.car.x,r.car.z,r.car.h,r.paint)}
  if(mode==="walk"){mg.save();mg.translate(mx(walker.x),mz(walker.z));mg.rotate(-walker.yaw);mg.fillStyle=S.ui==="dark"?"rgba(255,255,255,.15)":"rgba(31,36,33,.15)";mg.beginPath();mg.moveTo(0,0);mg.arc(0,0,40,-Math.PI/2-.6,-Math.PI/2+.6);mg.fill();mg.restore();mapArrow(walker.x,walker.z,walker.yaw,S.ui==="dark"?"#ffffff":"#1F2421",true)}
  mapArrow(me.x,me.z,me.h,paint,mode==="drive");
  const p=mode==="walk"?walker:me;$("coords").textContent=`${p.x.toFixed(0)}, ${p.z.toFixed(0)} m`;
}
function objective(){if(run&&run.phase!=="done"){const s=ROUTE[run.stage];return{x:s.x,z:s.z,k:"run",s}}if(race){const g=race.gates[race.gi];return g?{x:g.x,z:g.z,k:"race"}:null}if(target&&target.w===WKEY)return{x:target.x,z:target.z,k:"pin"};return null}

/* ---------- HUD ---------- */
const statusEl=$("status");let statusKey="";
const ARROW='<svg class="cmp" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l7 18-7-4-7 4z" fill="currentColor"/></svg>';
function hudFrame(){
  const sp=Math.abs(me.vF)*3.6;$("spd").textContent=Math.round(sp);
  $("boostBar").style.transform=`scaleX(${me.boost.toFixed(3)})`;
  $("tBoostTag").dataset.on=me.boosting?"1":"0";$("tDriftTag").dataset.on=me.drift?"1":"0";$("tAirTag").dataset.on=me.air?"1":"0";
  if(mode==="overview"){if(!statusEl.hidden)statusEl.hidden=true;statusKey="";return}
  if(joinable&&performance.now()<joinable.until&&mode==="drive"&&!run&&!race){ // a coworker just started a race here: offer a tappable Join
    const key="join|"+joinable.rc.t0;
    if(key!==statusKey){statusKey=key;statusEl.innerHTML='<span class="tx"><em></em> is racing to <em></em></span><button class="tb" type="button" id="joinB">Join race <kbd>Y</kbd></button>';const ems=statusEl.querySelectorAll("em");ems[0].textContent=joinable.r.name||"A coworker";ems[1].textContent=joinable.rc.n;$("joinB").onclick=joinRace}
    statusEl.hidden=false;return;
  }
  const p=mode==="walk"?walker:me;let kind=null,tx,tz,txt,em="",dist,clock=null,closable=false;
  if(run){const s=ROUTE[run.stage];kind="run";tx=s.x;tz=s.z;clock=run.t;txt=run.phase==="count"?"Get ready":s.k==="pickup"?"Next: kitchen":"Deliver to <em></em>";em=s.name||"";dist=Math.hypot(tx-p.x,tz-p.z)}
  else if(race){const g=race.gates[race.gi]||race.gates[race.gates.length-1];kind="race";tx=g.x;tz=g.z;clock=race.t;txt=race.phase==="count"?"Get ready":`Gate ${race.gi+1}/${race.gates.length} · <em></em>`;em=race.dest.name;dist=Math.hypot(tx-p.x,tz-p.z)}
  else if(route){const leg=curLeg();closable=true;
    if(leg&&route.tr){kind="route";const a=route.tr.ahead||leg.pts[leg.pts.length-1];tx=a[0];tz=a[1];dist=route.tr.remain;
      if(leg.end.kind==="dest"){txt=route.arrived?"Arrived at <em></em>":"To <em></em>";em=route.to.name}else{txt="<em></em>";em=leg.end.label||"Keep going"}}
    else{kind="route";tx=route.to.x;tz=route.to.z;dist=null;txt="Finding a route to <em></em>";em=route.to.name}}
  else if(target&&target.w===WKEY){kind="pin";closable=true;tx=target.x;tz=target.z;dist=Math.hypot(tx-p.x,tz-p.z);txt="Pinned: <em></em>";em=target.name}
  else if(target){kind="pin";closable=true;tx=p.x;tz=p.z-1;dist=null;txt="<em></em> is on "+esc(floorShort(target.w)).replace(/[<>&]/g,"")+" · open Find for a route";em=target.name}
  if(!kind){if(!statusEl.hidden)statusEl.hidden=true;statusKey="";return}
  const key=kind+"|"+txt+"|"+em+"|"+(clock!=null)+closable;
  if(key!==statusKey){statusKey=key;statusEl.innerHTML=ARROW+(clock!=null?'<span class="tmr"></span>':"")+'<span class="tx">'+txt+'<span class="ds"></span></span>'+(closable?'<button class="x" type="button" aria-label="Clear route" title="Clear route (X)">×</button>':"");const e=statusEl.querySelector("em");if(e)e.textContent=em;const x=statusEl.querySelector(".x");if(x)x.onclick=()=>{clearRoute();$("pick").hidden=true}}
  statusEl.hidden=false;
  const camYaw=Math.atan2(-(camLook.x-camPos.x),-(camLook.z-camPos.z)),bearing=Math.atan2(-(tx-p.x),-(tz-p.z)),rel=camMode==="top"&&mode==="drive"?-bearing:-angDiff(camYaw,bearing);
  statusEl.querySelector(".cmp").style.transform=`rotate(${(rel*180/Math.PI).toFixed(1)}deg)`;
  statusEl.querySelector(".ds").textContent=dist!=null?" · "+Math.max(0,dist).toFixed(0)+" m":"";
  const tm=statusEl.querySelector(".tmr");if(tm)tm.textContent=fmt(clock||0);
}
function setHelp(){
  const h=$("help");
  if(mode==="drive")h.innerHTML=me.kind==="car"?"<kbd>W A S D</kbd> drive · <kbd>Space</kbd> drift · <kbd>J</kbd> jump · <kbd>Shift</kbd> boost · <kbd>H</kbd> horn · <kbd>V</kbd> camera · <kbd>/</kbd> find · <kbd>R</kbd> restart · <kbd>X</kbd> clear route"
    :"<kbd>W A S D</kbd> run · <kbd>Space</kbd> jump · <kbd>Shift</kbd> sprint · <kbd>H</kbd> "+(me.kind==="dog"?"bark":"meow")+" · <kbd>V</kbd> camera · <kbd>/</kbd> find · <kbd>R</kbd> restart · <kbd>X</kbd> clear route"+(me.kind==="cat"?" · cats can jump onto desks":"");
  else if(mode==="walk")h.innerHTML="<kbd>Click</kbd> to look around · <kbd>W A S D</kbd> walk · <kbd>Shift</kbd> run · <kbd>/</kbd> find · <kbd>Esc</kbd> free mouse";
  else h.innerHTML="";
}

/* ---------- results + leaderboards (one doc per person: races/<id> = {t:{raceKey:seconds}, paint, at}) ---------- */
let raceDocs=[],myRaces={},lbLoaded=false,lbFresh=false,lbTimedOut=false;
const validT=v=>typeof v==="number"&&isFinite(v)&&v>.5&&v<3600;
let postDenied=false; // set when a time save is refused for access (rules: races/<you> needs Contributor)
function bestOf(key){const v=myRaces[key];return validT(v)?v:null}
function boardFor(key,n){const out=[];for(const d of raceDocs){const v=d.data(),t=v&&v.t&&v.t[key];if(validT(t))out.push({id:d.id,t,paint:HEX.test(v.paint)?v.paint:"#9AA0A6"})}out.sort((a,b)=>a.t-b.t);return out.slice(0,n||10)}
async function fillBoard(ol,list){
  let ps={};if(user&&list.length){try{ps=await user.profiles(list.map(d=>d.id))}catch(_){}}
  ol.innerHTML="";
  list.forEach((d,i)=>{const li=document.createElement("li");const rk=document.createElement("span");rk.className="rk";rk.textContent=i+1;const dot=document.createElement("i");dot.className="dot";dot.style.background=d.paint;const n=document.createElement("span");n.className="nm";n.textContent=(ps[d.id]&&ps[d.id].name)||"Someone";li.append(rk,dot,n);if(myId&&d.id===myId){const y=document.createElement("span");y.className="you";y.textContent="you";li.append(y)}const t=document.createElement("span");t.className="tm";t.textContent=fmt(d.t);li.append(t);ol.appendChild(li)});
}
async function renderBoard(){
  const ol=$("board"),note=$("boardNote");
  if(WKIND!=="floor"){$("boardH").textContent="Fastest coffee runs";ol.innerHTML="";note.textContent="Open a floor to see its coffee-run times.";return}
  $("boardH").textContent="Fastest coffee runs · "+floorShort(WKEY);
  if(!db){ol.innerHTML="";note.textContent="Times aren't saved in this view, but you can still race the clock.";return}
  const key=WKEY+":coffee",list=boardFor(key,10);await fillBoard(ol,list);
  if(!lbLoaded){note.textContent=lbTimedOut?"Can't reach the leaderboard yet.":"Loading times…";return}
  const mine=bestOf(key);
  const denied=postDenied||(db&&!myId);
  note.textContent=(lbTimedOut&&!lbFresh?"Times may be out of date. ":"")+(list.length?(mine!=null?"Your best here: "+fmt(mine):denied?"Posting a time needs Contributor access to this page.":"Press Coffee run while driving to set a time."):(denied?"No times yet. Posting a time needs Contributor access to this page.":"No times on this floor yet. Press Coffee run while driving to set the first."));
}
let saving=false;
function showResult(key,t,title,again,againLabel){
  const prev=bestOf(key),isBest=prev==null||t<prev;if(isBest)myRaces[key]=t;
  $("resK").textContent=title;$("resT").textContent=fmt(t);
  $("resM").textContent=isBest?(prev==null?"Your first time here.":"New personal best, "+(prev-t).toFixed(2)+"s faster."):"Your best is "+fmt(prev)+".";
  $("again").textContent=againLabel||"Go again";$("again").onclick=()=>{closeResult();again&&again()};
  fillBoard($("resBoard"),boardFor(key,5));
  $("result").hidden=false;$("again").focus();
  if(isBest)saveTime(key,t);
}
function closeResult(){$("result").hidden=true}
$("resClose").onclick=()=>{closeResult();cv.focus&&cv.focus()};
async function saveTime(key,t){
  const note=$("resM");
  if(!db||!myId){note.textContent+=" Times can't be saved in this view.";return}
  if(saving)return;saving=true;
  try{
    // read our own doc first; never fall through to a full overwrite on a failed read (it would erase our other best times)
    const ref=db.doc("races/"+myId);let cur_=null;
    try{cur_=await ref.get()}catch(_){await sleep(400+Math.random()*400);cur_=await ref.get()}
    const v=cur_.exists?cur_.data():null,old=v&&v.t&&v.t[key];
    if(validT(old)&&old<=t){myRaces[key]=old;note.textContent="Your best is "+fmt(old)+".";return}
    const tt=Math.round(t*1000)/1000;
    if(v)await ref.update({t:{[key]:tt},paint,at:Date.now()});
    else{const all={};for(const k in myRaces)if(validT(myRaces[k])&&k.length<140)all[k]=Math.round(myRaces[k]*1000)/1000;all[key]=tt;await ref.set({t:all,paint,at:Date.now()})}
    note.textContent+=" Saved to the leaderboard.";
  }catch(e){if(e&&e.code==="invalid_argument"){postDenied=true;renderBoard()}note.textContent+=e&&e.code==="invalid_argument"?" Posting a time needs Contributor access to this page.":e&&e.code==="quota_exceeded"?" The leaderboard is full.":" Couldn't save your time. Try again later."}
  finally{saving=false}
}
function startBoard(){
  if(!db){renderBoard();return}
  const tm=setTimeout(()=>{lbTimedOut=true;renderBoard()},10000);
  try{
    db.collection("races").limit(1000).onSnapshot(s=>{if(!s.metadata.fromCache){lbFresh=true;clearTimeout(tm)}lbLoaded=true;raceDocs=s.docs;renderBoard()},()=>{clearTimeout(tm);lbLoaded=false;$("boardNote").textContent="The leaderboard is unavailable right now."});
    if(myId)db.doc("races/"+myId).onSnapshot(d=>{const v=d.exists?d.data():null;if(v&&v.t&&typeof v.t==="object")for(const k in v.t){if(validT(v.t[k])&&(myRaces[k]==null||v.t[k]<myRaces[k]))myRaces[k]=v.t[k]}renderBoard()},()=>{});
  }catch(_){clearTimeout(tm);$("boardNote").textContent="The leaderboard is unavailable right now."}
}

/* ---------- multiplayer: presence (who's where), names, race invites ---------- */
const capUse=n=>(window.claude&&typeof window.claude.use==="function")?Promise.resolve(window.claude.use(n)).catch(()=>null):Promise.resolve(null);
let roomSettled=false,user=null,db=null,room=null,assets=null,downloads=null,myId=null,myName="",canWrite=null,canSetup=false,presDirty=true,presT=0,lastPres="";
const remotes=new Map();let joinable=null;
function num(v,a,b){return typeof v==="number"&&isFinite(v)?clamp(v,a,b):null}
const WKEY_RE=/^(campus|[A-Za-z0-9]{1,8}-\d{1,2})$/;
function syncPeers(peers){
  const seen=new Set(),now=performance.now();
  for(const p of peers){
    if(p.sameTab||p.kind!=="viewer")continue;seen.add(p.peer);
    let r=remotes.get(p.peer);
    if(!r){r={peer:p.peer,uid:null,car:newCar(0,0,0,"#9AA0A6"),paint:"#9AA0A6",name:"",m:"o",w:"",has:false,tx:0,tz:0,ty:0,th:0,tp:0,tr:0,vx:0,vz:0,t:0,pres:null,tag:null,wvis:null,isMe:p.isMe,rc:null};remotes.set(p.peer,r)}
    if(r.pres===p.presence)continue;r.pres=p.presence;const pr=p.presence||{};
    r.uid=p.by||(typeof pr.u==="string"&&pr.u.length<200?pr.u:null);
    const av=pr.av==="dog"||pr.av==="cat"?pr.av:"car";if(av!==r.car.kind){r.car.kind=av;dropVis(r.car.vis);r.car.vis=null}
    r.m=pr.m==="d"||pr.m==="w"?pr.m:"o";
    const w=typeof pr.w==="string"&&WKEY_RE.test(pr.w)?pr.w:"";
    if(w!==r.w){r.w=w;r.has=false;if(r.car.vis){dropVis(r.car.vis);r.car.vis=null}if(r.wvis){dropVis(r.wvis);r.wvis=null}}
    const c=HEX.test(pr.c)?pr.c:"#9AA0A6";if(c!==r.paint){r.paint=c;r.car.paint=c;dropVis(r.car.vis);r.car.vis=null;dropVis(r.wvis);r.wvis=null;disposeSprite(r.tag);r.tag=null}
    const x=num(pr.x,-400,400),z=num(pr.z,-400,400),h=num(pr.h,-1e5,1e5);
    if(x!=null&&z!=null&&h!=null){
      if(r.has){const dtm=Math.max(.04,(now-r.t)/1000);r.vx=lerp(r.vx,clamp((x-r.tx)/dtm,-15,15),.5);r.vz=lerp(r.vz,clamp((z-r.tz)/dtm,-15,15),.5)}else{r.car.x=x;r.car.z=z;r.car.h=h}
      r.tx=x;r.tz=z;r.ty=num(pr.y,0,6)||0;r.th=h;r.t=now;r.has=true;r.tp=num(pr.p,-1.5,1.5)||0;r.tr=num(pr.r,-1.5,1.5)||0;
      r.car.air=pr.a===1;r.car.vF=num(pr.s,-20,20)||0;r.car.steer=num(pr.st,-1,1)||0;r.car.boosting=pr.b===1;r.car.drift=pr.d===1;r.car.driftDir=Math.sign(r.car.steer)||1;
    }
    if(r.m!=="d"){r.vx=r.vz=0}
    r.wx=num(pr.wx,-400,400);r.wz=num(pr.wz,-400,400);r.wy=num(pr.wy,-1e5,1e5)||0;
    const rc=pr.rc&&typeof pr.rc==="object"&&typeof pr.rc.k==="string"&&pr.rc.k.length<140&&num(pr.rc.t0,0,1e15)!=null?{k:pr.rc.k,t0:pr.rc.t0,n:typeof pr.rc.n==="string"?pr.rc.n.slice(0,60):"a race"}:null;
    if(rc&&(!r.rc||r.rc.t0!==rc.t0)&&r.w===WKEY&&mode==="drive"&&!race&&!run&&Date.now()-rc.t0<2600&&rc.t0<Date.now()+1500){joinable={r,rc,until:performance.now()+3000};toast(`${r.name||"A coworker"} is racing to ${rc.n} · ${document.body.classList.contains("touch")?"tap Join race":"press Y to join"}`)}
    r.rc=rc;
    const hk=typeof pr.hk==="number"?pr.hk:0;if(r.hk!==undefined&&hk>r.hk&&r.has&&r.w===WKEY){const d=camera.position.distanceTo(_P.set(r.car.x,r.car.y,r.car.z));const h=HONK[r.car.kind]||HONK.car;SFX[h[0]](clamp(1-d/30,.12,1));pop(r.car.x,r.car.y+.5,r.car.z,h[1],r.paint)}r.hk=hk;
  }
  for(const [k,r] of remotes)if(!seen.has(k)){removeRemote(r);remotes.delete(k)}
  resolveNames();
}
function joinRace(){
  if(!joinable||performance.now()>joinable.until||mode!=="drive"){toast("No race to join right now.");return}
  const{rc}=joinable;joinable=null;const [w,id]=rc.k.split(">");const dest=buildIndex().find(x=>x.w===w&&x.id===id);
  if(!dest){toast("Couldn't find that race's finish line.");return}
  if(Date.now()-rc.t0>2900){toast("Too late to join that one.");return}
  startRace(dest,rc.t0);
}
function removeRemote(r){dropVis(r.car.vis);r.car.vis=null;dropVis(r.wvis);r.wvis=null;disposeSprite(r.tag);r.tag=null}
let nameBusy=false,namePending=false;
async function resolveNames(){
  if(!user){renderRoster();return}if(nameBusy){namePending=true;return}nameBusy=true;namePending=false;
  try{
    const ids=[...new Set([...remotes.values()].map(r=>r.uid).filter(Boolean).concat(myId?[myId]:[]))];
    if(ids.length){const ps=await user.profiles(ids);for(const r of remotes.values()){const nm=(r.uid&&ps[r.uid]&&ps[r.uid].name)||"";if(nm!==r.name){r.name=nm;disposeSprite(r.tag);r.tag=null}}const mn=(myId&&ps[myId]&&ps[myId].name)||"";if(mn!==myName){myName=mn;disposeSprite(meTag);meTag=tagSprite(myName||"You",paint);tags.add(meTag);findMyDesk();renderStart()}}
  }catch(_){}
  nameBusy=false;renderRoster();if(namePending)resolveNames();
}
function remoteFrame(dt,now){
  let drawn=0;
  for(const r of remotes.values()){
    // only people driving or walking on this floor get a car; viewers in the overview stay in the roster only
    if(!r.has)continue;const c=r.car,here=r.w===WKEY&&r.m!=="o"&&drawn<16;if(here)drawn++;
    if(!here){if(c.vis)c.vis.g.visible=false;if(r.wvis)r.wvis.visible=false;if(r.tag)r.tag.visible=false;continue}
    if(!c.vis&&root)c.vis=makeAvatar(c.kind,r.paint);if(c.vis)c.vis.g.visible=true;
    const lead=Math.min(.3,(now-r.t)/1000),px=r.tx+r.vx*lead,pz=r.tz+r.vz*lead;
    if(Math.hypot(px-c.x,pz-c.z)>4){c.x=px;c.z=pz}
    const k=1-Math.exp(-dt*10);c.x+=(px-c.x)*k;c.z+=(pz-c.z)*k;c.y+=(r.ty-c.y)*k;c.h+=angDiff(c.h,r.th)*k;c.pitch+=(r.tp-c.pitch)*k;c.roll+=(r.tr-c.roll)*k;c.vx=r.vx;c.vz=r.vz;c.lat=0;
    syncCar(c,dt,true);
    if(!r.tag){r.tag=tagSprite(r.name||"Coworker",r.paint);tags.add(r.tag)}r.tag.visible=true;
    if(r.m==="w"&&r.wx!=null){if(!r.wvis&&root)r.wvis=makeWalker(r.paint);if(r.wvis){r.wvis.visible=true;r.wvis.position.set(r.wx,0,r.wz);r.wvis.rotation.y=r.wy}placeTag(r.tag,r.wx,1.75,r.wz)}
    else{if(r.wvis)r.wvis.visible=false;placeTag(r.tag,c.x,c.y+tagH(c.kind),c.z)}
  }
}
function renderRoster(){
  const ul=$("roster");ul.innerHTML="";
  const add=(col,name,state,you)=>{const li=document.createElement("li");const d=document.createElement("i");d.className="dot";d.style.background=col;const n=document.createElement("span");n.className="nm";n.textContent=name;li.append(d,n);if(you){const y=document.createElement("span");y.className="you";y.textContent="you";li.append(y)}const s=document.createElement("span");s.className="st";s.textContent=state;li.append(s);ul.appendChild(li)};
  const st=(m,w,rc)=>(rc?"racing":m==="d"||m==="drive"?"driving":m==="w"||m==="walk"?"walking":"looking")+(w?" · "+floorShort(w):"");
  add(paint,myName||"You",st(mode,WKEY,race),true);
  for(const r of remotes.values())add(r.paint,r.name||"Coworker",st(r.m,r.w,r.rc),r.isMe);
  $("rosterNote").textContent=room?(remotes.size||!roomSettled?"":"Just you so far. Share this page and coworkers' cars show up here live."):"Live driving with coworkers isn't available in this view.";
}
function sendPresence(){
  if(!room)return;
  const m=mode==="drive"?"d":mode==="walk"?"w":"o",r2=v=>Math.round(v*100)/100;
  const o={v:2,m,w:WKEY,c:paint,x:r2(me.x),z:r2(me.z),y:r2(me.y),h:Math.round(me.h*1000)/1000,p:r2(me.pitch),r:r2(me.roll),s:Math.round(me.vF*10)/10,st:r2(me.steer),b:me.boosting?1:0,d:me.drift?1:0,hk:hornCount};
  if(myId)o.u=myId;
  if(mode==="walk"){o.wx=r2(walker.x);o.wz=r2(walker.z);o.wy=r2(walker.yaw)}else{o.wx=null;o.wz=null;o.wy=null}
  o.rc=race?{k:race.key,t0:race.t0,n:race.dest.name.slice(0,60)}:null;
  if(me.kind!=="car")o.av=me.kind;if(me.air)o.a=1;
  const key=JSON.stringify(o);if(key===lastPres)return;lastPres=key;
  room.presence(o).catch(()=>{});
}

/* ---------- campus data: sample campus, the page's database, merging ---------- */
let dbCampus,dbFloors={},dbRosters={},dbXY={},seen={c:false,f:false,r:false};
const SAFE_ID=/^[A-Za-z0-9]{1,8}$/;
function validCampus(v){
  if(!v||!Array.isArray(v.buildings)||!v.buildings.length)return null;
  const bs=[];for(const b of v.buildings.slice(0,6)){if(!b||!SAFE_ID.test(b.id)||bs.some(x=>x.id===b.id))continue;const n=x=>typeof x==="number"&&isFinite(x);
    bs.push({id:b.id,name:String(b.name||b.id).slice(0,40),short:String(b.short||b.id).slice(0,12),floors:clamp(Math.round(n(b.floors)?b.floors:4),1,12),x:n(b.x)?clamp(b.x,-500,500):0,z:n(b.z)?clamp(b.z,-500,500):0,w:n(b.w)?clamp(b.w,12,300):70,d:n(b.d)?clamp(b.d,12,300):44})}
  if(!bs.length)return null;
  const teams={};if(v.teams&&typeof v.teams==="object")Object.keys(v.teams).slice(0,400).forEach(k=>{const t=v.teams[k];if(!t||typeof k!=="string"||k.length>60)return;teams[k]={color:HEX.test(t.color)?t.color:CAMPUS.teamColor(k,0),arr:LAYOUT.ARR.includes(t.arr)?t.arr:CAMPUS.defaultArr(k)}});
  return{v:1,name:String(v.name||"Campus").slice(0,60),demo:v.demo!==false,buildings:bs,teams,src:typeof v.src==="string"?v.src.slice(0,120):"",at:typeof v.at==="number"?v.at:0};
}
function validSpec(v,id){if(!v||typeof v!=="object"||!CAMPUS.parseKey(id))return null;const p=CAMPUS.parseKey(id);return Object.assign({},v,{key:id,b:p.b,f:p.f})}
function validRoster(v){if(!v||!Array.isArray(v.rows))return null;return v.rows.slice(0,5000).filter(r=>Array.isArray(r)&&typeof r[1]==="string"&&r[1].trim()).map(r=>({desk:String(r[0]||"").slice(0,24),name:String(r[1]).slice(0,80),team:String(r[2]||"").slice(0,60),title:String(r[3]||"").slice(0,80)}))}
// returns null when nothing changed, else {changed:Set of floor keys, all, campus} describing what to rebuild
function mergeData(first){
  const campus=dbCampus||DEMO.campus,real=!!(dbCampus&&dbCampus.demo===false);
  const floors={},rosters={};
  const teams=Object.assign({},DEMO.campus.teams,campus.teams||{});
  const next={campus:Object.assign({},campus,{teams}),floors,rosters,demo:!real};
  const prev=DATA;DATA=next;
  for(const b of campus.buildings)for(let f=1;f<=b.floors;f++){
    const k=CAMPUS.key(b.id,f),demoF=DEMO.floors[k]&&DEMO.floors[k].b===b.id?DEMO.floors[k]:null,dbF=dbFloors[k];
    // sample mode shows the sample people: floors the owner drew by hand stay, layouts generated from a real headcount don't
    floors[k]=real?(dbF||demoF):((dbF&&!dbF.auto)?dbF:demoF);
    rosters[k]=real?(dbRosters[k]||[]):(DEMO.rosters[k]||[]);
  }
  for(const b of campus.buildings)for(let f=1;f<=b.floors;f++){const k=CAMPUS.key(b.id,f);if(!floors[k])floors[k]=blankSpec(b,f)}
  if(first||!prev){invalidate();return{all:true,changed:new Set(Object.keys(floors)),campus:true}}
  const sig=o=>JSON.stringify(o);
  const teamsChanged=sig(prev.campus.teams)!==sig(next.campus.teams)||sig(prev.campus.buildings)!==sig(next.campus.buildings);
  const campusChanged=teamsChanged||prev.demo!==next.demo||prev.campus.name!==next.campus.name;
  const changed=new Set();
  for(const k of new Set([...Object.keys(prev.floors),...Object.keys(floors)]))if(teamsChanged||sig(prev.floors[k])!==sig(floors[k])||sig(prev.rosters[k])!==sig(rosters[k]))changed.add(k);
  if(!changed.size&&!campusChanged)return null;
  if(teamsChanged)invalidate();else invalidate([...changed]);
  return{all:teamsChanged,changed,campus:campusChanged||[...changed].some(k=>/-1$/.test(k))};
}
let mergeT=0,applying=false;
function scheduleMerge(){clearTimeout(mergeT);mergeT=setTimeout(()=>{if(edOpen||applying){scheduleMerge();return}const ch=mergeData();if(ch)applyChange(ch)},250)}
// rebuild the viewer's world only if what they're standing in changed; otherwise just refresh lists and cards
function applyChange(ch){
  const here=WKEY==="campus"?ch.campus:(ch.all||ch.changed.has(WKEY)||!floorKeys().includes(WKEY));
  if(here){refreshWorld();return}
  peopleIdx=null;findMyDesk();if(route)routeTo(route.to,true);updateBrand();renderStart();if(!$("setup").hidden)renderSetup();
}
function refreshWorld(){
  // keep the viewer where they are (and moving) if their floor still exists
  const keys=floorKeys(),key=WKEY==="campus"||keys.includes(WKEY)?WKEY:"campus";
  const p=mode==="walk"?{x:walker.x,z:walker.z,a:walker.yaw}:{x:me.x,z:me.z,a:me.h},m=mode,hadRun=!!run,vel={vx:me.vx,vz:me.vz,vF:me.vF,boost:me.boost};
  enterWorld(key,mode==="overview"?null:p);
  if(m!=="overview"&&mode===m){if(m==="walk"){walker.x=p.x;walker.z=p.z}else{spawnNear(p.x,p.z,p.a);if(Math.hypot(me.x-p.x,me.z-p.z)<.3)Object.assign(me,vel)}}
  if(hadRun)toast("This floor was just updated, so the coffee run stopped.");else if(m!=="overview")toast("This floor was just updated.");
  if(route)routeTo(route.to,true);peopleIdx=null;findMyDesk();renderStart();if(!$("setup").hidden)renderSetup();
}
// fresh = the listener has delivered a snapshot confirmed by the store (not a cached copy). Setup writes wait for all three.
const fresh={c:false,f:false,r:false};
const dataReady=()=>!db||(fresh.c&&fresh.f&&fresh.r);
function watchData(){
  if(!db){dataSettled=true;findMyDesk();return}
  const done=()=>{if(seen.c&&seen.f&&seen.r&&!dataSettled){dataSettled=true;const ch=mergeData();if(ch)refreshWorld();else{findMyDesk();renderStart()}hideLoading()}};
  const onErr=()=>{seen.c=seen.f=seen.r=true;done();if(!$("setup").hidden)renderSetup()};
  const mark=(k,s)=>{seen[k]=true;if(s&&s.metadata&&!s.metadata.fromCache){const was=dataReady();fresh[k]=true;if(!was&&dataReady()&&!$("setup").hidden)renderSetup()}};
  try{
    db.doc("campus/main").onSnapshot(d=>{dbCampus=d.exists?validCampus(d.data()):null;mark("c",d);dataSettled?scheduleMerge():done()},onErr);
    db.collection("floors").limit(200).onSnapshot(s=>{const o={};s.docs.forEach(d=>{const v=validSpec(d.data(),d.id);if(v)o[d.id]=v});dbFloors=o;mark("f",s);dataSettled?scheduleMerge():done()},onErr);
    db.collection("roster").limit(200).onSnapshot(s=>{const o={};s.docs.forEach(d=>{const v=validRoster(d.data());if(v)o[d.id]=v});dbRosters=o;mark("r",s);dataSettled?scheduleMerge():done()},onErr);
    db.collection("deskxy").limit(200).onSnapshot(s=>{const o={};s.docs.forEach(d=>{const v=d.data();if(v&&Array.isArray(v.rows))o[d.id]=v.rows.slice(0,5000)});dbXY=o},()=>{});
  }catch(_){onErr()}
  setTimeout(()=>{if(!dataSettled){dataSettled=true;const ch=mergeData();if(ch)refreshWorld();hideLoading()}},4000);
}
let dataSettled=false;
function showLoading(){const fd=$("fade"),ft=$("fadeT");ft.textContent="Loading the campus…";fd.dataset.on="1"}
function hideLoading(){$("fade").dataset.on="0"}

/* ---------- auto floor plans for imported people (keeps the floor's rooms, re-divides team areas by headcount) ---------- */
function autoFloor(base,roster,teams){
  const spec=JSON.parse(JSON.stringify(base));spec.auto=true;spec.desks=[];spec.ramps=null;
  const slots=(base.zones||[]).map(z=>({x:z.x,z:z.z,w:z.w,d:z.d,dir:z.dir}));
  if(!slots.length)slots.push({x:0,z:0,w:Math.max(4,spec.w-4),d:Math.max(4,spec.d-4)});
  const counts=new Map();for(const p of roster){const t=p.team||"";counts.set(t,(counts.get(t)||0)+1)}
  const order=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  const cap=(s,team)=>{try{const c=LAYOUT.capacity(Object.assign({},spec,{zones:[{id:"t",team,arr:null,x:s.x,z:s.z,w:s.w,d:s.d,dir:s.dir}],desks:[]}),teams);return(c.byZone&&c.byZone.t)||0}catch(_){return 0}};
  const sub=(s,hz,f0,f1)=>hz?{x:s.x-s.w/2+s.w*(f0+f1)/2,z:s.z,w:s.w*(f1-f0),d:s.d,dir:s.dir}:{x:s.x,z:s.z-s.d/2+s.d*(f0+f1)/2,w:s.w,d:s.d*(f1-f0),dir:s.dir};
  const zones=[],queue=slots.slice();let zi=0;
  for(const [team,n] of order){
    let need=n;
    while(need>0&&queue.length){
      const s=queue.shift(),c=cap(s,team);if(c<=0)continue;
      if(c<=need*1.25||Math.min(s.w,s.d)<7){zones.push(Object.assign({id:"z"+(++zi),team,arr:null},s));need-=c;continue}
      // split along the long side; never cut a strip thinner than 8 m (thin areas hold almost no desks)
      const hz=s.w>=s.d,len=hz?s.w:s.d,fmin=Math.min(1,8/len);let lo=fmin,hi=1,best=null;
      if(cap(sub(s,hz,0,fmin),team)>=need*1.1)best=fmin;
      else for(let it=0;it<7;it++){const f=(lo+hi)/2,a=sub(s,hz,0,f),ca=cap(a,team);if(ca>=need*1.1){best=f;hi=f}else lo=f}
      let f=best||1;if((1-f)*len<8)f=1;
      const a=sub(s,hz,0,f);zones.push(Object.assign({id:"z"+(++zi),team,arr:null},a));need-=cap(a,team);
      if(f<1){const rest=sub(s,hz,f,1);if(Math.min(rest.w,rest.d)>=6)queue.unshift(rest)}
    }
  }
  queue.forEach(s=>zones.push(Object.assign({id:"z"+(++zi),team:"",arr:null},s)));
  spec.zones=zones;spec.updatedAt=Date.now();return spec;
}

/* ---------- setup: people import, floors, teams, buildings (editors of the page only) ---------- */
let imp=null; // {file, parsed, map, alias, norm, diff}
const FIELDS=[["name","Full name"],["first","First name"],["last","Last name"],["team","Team / department"],["title","Job title"],["building","Building"],["floor","Floor"],["desk","Desk / seat ID"],["x","X (desk position)"],["y","Y (desk position)"],["rot","Rotation"]];
function el(tag,props,kids){const e=document.createElement(tag);if(props)for(const k in props){if(props[k]==null||props[k]===false)continue;if(k==="text")e.textContent=props[k];else if(k==="cls")e.className=props[k];else if(k.startsWith("on"))e[k]=props[k];else e.setAttribute(k,props[k])}(kids||[]).forEach(c=>c&&e.appendChild(typeof c==="string"?document.createTextNode(c):c));return e}
// unsaved edits in the Teams and Names sections survive re-renders (snapshots, imports, other saves)
const setupDraft={teams:{},names:{},campus:null};let setupOpener=null;
const INERT_IDS=["stage","bar","start","side","panel","stylePop","mapwrap","status","speedo","look","help","elev","touch","result"];
function setInert(on){INERT_IDS.forEach(id=>{const e=$(id);if(e){if(on)e.setAttribute("inert","");else e.removeAttribute("inert")}})}
function openSetup(){setupOpener=document.activeElement;$("setup").hidden=false;setInert(true);renderSetup();const h=$("setupBox")&&$("setupBox").querySelector("h2");h&&h.focus()}
function closeSetup(){$("setup").hidden=true;imp=null;setupDraft.teams={};setupDraft.names={};setupDraft.campus=null;setInert(false);if(setupOpener&&setupOpener.focus&&document.contains(setupOpener))setupOpener.focus();setupOpener=null}
$("bSetup").onclick=$("bSetup2").onclick=openSetup;
// close on a click that both started and ended on the backdrop (not a drag out of the dialog)
let setupDownBg=false;
$("setup").addEventListener("pointerdown",e=>{setupDownBg=e.target===$("setup")});
$("setup").addEventListener("click",e=>{if(setupDownBg&&e.target===$("setup"))closeSetup();setupDownBg=false});
function renderSetup(){
  const host=$("setup"),ae=document.activeElement,fk=ae&&host.contains(ae)?ae.getAttribute("aria-label")||ae.textContent:null,st=host.scrollTop;
  host.innerHTML="";const box=el("section",{id:"setupBox",cls:"glass",role:"dialog","aria-modal":"true","aria-labelledby":"setupH"});host.appendChild(box);
  box.appendChild(el("div",{cls:"row",style:"justify-content:space-between"},[el("h2",{id:"setupH",tabindex:"-1",text:"Set up the campus"}),el("button",{cls:"tb",type:"button",text:"Close",onclick:closeSetup})]));
  if(!dataReady()){box.appendChild(el("p",{cls:"note",text:"Loading the saved campus data. You can make changes as soon as it has loaded."}));return}
  renderSetupBody(box);
  host.scrollTop=st;
  if(fk){const t=[...box.querySelectorAll("button,select,input,summary")].find(x=>(x.getAttribute("aria-label")||x.textContent)===fk);if(t)t.focus()}
}
function renderSetupBody(box){
  box.appendChild(el("p",{cls:"note",text:db?"Load your people from a facilities export, draw each floor, and pick how each team sits. Changes show up for everyone who can open this page.":"Try-out mode: changes stay in this browser tab and disappear when you reload. Files you load here never leave your computer."}));
  // 1. people
  const s1=el("div",{cls:"sec"});box.appendChild(s1);
  s1.appendChild(el("h3",{text:"1. People and desks"}));
  s1.appendChild(el("p",{cls:"note",text:DATA.demo?"Right now the campus shows sample people. Export your seating list from your facilities or HR system as a CSV (one row per person: name, team, building, floor, desk) and drop it here. Only name, team, title and desk are kept. Every other column is ignored.":`Showing your seating${DATA.campus.src?" from "+DATA.campus.src:""}. Drop a newer export to update it; you'll see what changed before anything is saved.`}));
  const drop=el("div",{cls:"drop"});const fin=el("input",{type:"file",accept:".csv,text/csv,.txt,.tsv",class:"vh",id:"impFile"});
  drop.append(el("div",{text:"Drop a CSV here, or"}),el("div",{cls:"row"},[el("button",{cls:"tb",type:"button",text:"Choose file",onclick:()=>fin.click()}),el("button",{cls:"tb",type:"button",text:"Download template",onclick:()=>saveFile("seating-template.csv",IMPORT.template())}),el("button",{cls:"tb",type:"button",text:"Export current seating",onclick:exportSeating})]),fin);
  fin.onchange=()=>{if(fin.files[0])readImport(fin.files[0])};
  drop.addEventListener("dragover",e=>{e.preventDefault();drop.dataset.over="1"});drop.addEventListener("dragleave",()=>drop.dataset.over="0");drop.addEventListener("drop",e=>{e.preventDefault();drop.dataset.over="0";const f=e.dataTransfer.files&&e.dataTransfer.files[0];if(f)readImport(f)});
  s1.appendChild(drop);
  if(imp)s1.appendChild(importView());
  // 2. floors
  const s2=el("div",{cls:"sec"});box.appendChild(s2);
  s2.appendChild(el("h3",{text:"2. Floor plans"}));
  s2.appendChild(el("p",{cls:"note",text:"Open a floor to load its plan (PNG, JPG, PDF or CAD walls as DXF), trace rooms, place team areas, or place desks from your facilities coordinates. Floors you haven't drawn are laid out automatically from the people on them."}));
  const how=el("details",{cls:"how"},[el("summary",{text:"How to load a floor plan"}),el("ol",null,[
    el("li",{text:"Ask Facilities for each floor's plan as a PDF or PNG (an export from their CAD or space-planning tool). If they can share CAD, ask for a DXF too: its walls can be imported directly."}),
    el("li",{text:"Open the floor, choose Load floor plan, then Set scale: click two points whose real distance you know (a column-grid bay or a wall length) and type the distance in feet or meters. Use Match floor to plan so the floor is the same size."}),
    el("li",{text:"Trace what matters for driving and directions: rooms (conference rooms, labs, kitchen, restrooms), the elevators, and the front door on floor 1. Or use Import CAD walls."}),
    el("li",{text:"Draw a team area over each neighborhood and pick how that team sits (open benches, cubicles, offices, lab benches or hot desks). Desks fill in automatically."}),
    el("li",{text:"If your seating export has desk X and Y coordinates, use Place desks from your facilities file: click where two of those desks are on the plan and every other desk lines up."})])]);
  s2.appendChild(how);
  const grid=el("div",{cls:"fgrid"});s2.appendChild(grid);
  for(const k of floorKeys()){const m=modelFor(k),sp=DATA.floors[k]||{},st=(m&&m.stats)||{};
    const card=el("div",{cls:"fcard"},[el("b",{text:floorName(k)}),el("span",{text:`${nf(st.occupied||0)} people · ${nf(st.desks||0)} desks`}),el("span",{text:(sp.plan?"Plan image ✓":"No plan image")+" · "+(sp.auto?"auto layout":dbFloors[k]?"drawn":"sample layout")}),st.unplaced?el("span",{text:`${st.unplaced} without a desk`,style:"color:var(--warn)"}):null,el("button",{cls:"tb",type:"button",text:"Edit floor",onclick:()=>openEditor(k)})]);
    grid.appendChild(card)}
  // 3. teams
  const s3=el("div",{cls:"sec"});box.appendChild(s3);
  s3.appendChild(el("h3",{text:"3. Teams and how they sit"}));
  const counts=new Map();for(const k of floorKeys())for(const p of DATA.rosters[k]||[])counts.set(p.team,(counts.get(p.team)||0)+1);
  const tnames=[...counts.keys()].filter(Boolean).sort((a,b)=>counts.get(b)-counts.get(a));
  const draft={};tnames.forEach(t=>draft[t]=Object.assign({color:teamColorOf(t),arr:teamArrOf(t)},setupDraft.teams[t]||{}));
  const tw=el("div",{cls:"tscroll"}),tb=el("table",{cls:"tbl"});tw.appendChild(tb);
  tb.appendChild(el("thead",null,[el("tr",null,[el("th",{text:"Team"}),el("th",{text:"People"}),el("th",{text:"Color"}),el("th",{text:"Seating"})])]));
  const tbody=el("tbody");tb.appendChild(tbody);
  tnames.forEach(t=>{const sel=el("select",{"aria-label":"Seating for "+t});LAYOUT.ARR.forEach(a=>{const o=el("option",{value:a,text:CAMPUS.ARR_NAMES[a]||a});if(a===draft[t].arr)o.selected=true;sel.appendChild(o)});sel.onchange=()=>{draft[t].arr=sel.value;setupDraft.teams[t]=Object.assign({},draft[t])};
    const col=el("input",{type:"color",value:draft[t].color,"aria-label":"Color for "+t});col.oninput=()=>{draft[t].color=col.value;setupDraft.teams[t]=Object.assign({},draft[t])};
    tbody.appendChild(el("tr",null,[el("td",{text:t}),el("td",{text:String(counts.get(t))}),el("td",null,[col]),el("td",null,[sel])]))});
  s3.appendChild(tw);
  s3.appendChild(el("div",{cls:"row"},[el("button",{cls:"primary",type:"button",text:"Save teams",onclick:async()=>{const teams=Object.assign({},(dbCampus&&dbCampus.teams)||{},draft);try{await saveCampus({teams});setupDraft.teams={};toast("Teams saved")}catch(_){}}})]));
  // 4. buildings
  const s4=el("div",{cls:"sec"});box.appendChild(s4);
  s4.appendChild(el("h3",{text:"4. Campus and buildings"}));
  const cn=el("input",{type:"text",cls:"fld",value:setupDraft.campus!=null?setupDraft.campus:(DATA.campus.name||""),"aria-label":"Campus name",maxlength:"60"});cn.oninput=()=>setupDraft.campus=cn.value;
  s4.appendChild(el("label",{cls:"row"},[el("span",{cls:"lbl",text:"Campus name"}),cn]));
  const bIn=DATA.campus.buildings.map(b=>{const i=el("input",{type:"text",cls:"fld",value:setupDraft.names[b.id]!=null?setupDraft.names[b.id]:b.name,"aria-label":"Name of "+b.id,maxlength:"40"});i.oninput=()=>setupDraft.names[b.id]=i.value;s4.appendChild(el("label",{cls:"row"},[el("span",{cls:"lbl",text:b.id}),i]));return[b,i]});
  s4.appendChild(el("div",{cls:"row"},[el("button",{cls:"primary",type:"button",text:"Save names",onclick:async()=>{const bs=DATA.campus.buildings.map(b=>{const p=bIn.find(x=>x[0]===b);return Object.assign({},b,{name:(p[1].value.trim()||b.name).slice(0,40)})});try{await saveCampus({name:(cn.value.trim()||"Campus").slice(0,60),buildings:bs});setupDraft.names={};setupDraft.campus=null;toast("Names saved")}catch(_){}}})]));
  if(!DATA.demo)s4.appendChild(el("p",{cls:"note"},["Want the sample people back? ",el("button",{cls:"lnk",type:"button",text:"Show sample people",onclick:()=>confirmDlg("Show the sample people to everyone instead of your seating? Your seating stays saved, and you can switch back here.","Show sample people",async()=>{try{await saveCampus({demo:true});toast("Showing sample people")}catch(_){}})})]));
  else if(Object.keys(dbRosters).some(k=>(dbRosters[k]||[]).length))s4.appendChild(el("p",{cls:"note"},["Your saved seating is hidden right now. ",el("button",{cls:"lnk",type:"button",text:"Show my seating again",onclick:async()=>{try{await saveCampus({demo:false});toast("Showing your seating")}catch(_){}}})]));
}
function confirmDlg(msg,ok,fn){const d=el("section",{cls:"dlg glass",id:"dlg",role:"alertdialog","aria-modal":"true"},[el("p",{text:msg}),el("div",{cls:"row"},[el("button",{cls:"primary",type:"button",text:ok,onclick:()=>{d.remove();fn()}}),el("button",{cls:"tb",type:"button",text:"Cancel",onclick:()=>d.remove()})])]);document.body.appendChild(d);d.querySelector("button").focus();d.addEventListener("keydown",e=>{if(e.key==="Escape"){e.stopPropagation();d.remove()}})}
async function saveFile(name,text){
  if(!downloads)downloads=await capUse("downloads");
  if(downloads){try{await downloads.save({filename:name,data:text});return}catch(e){if(e&&e.code==="declined")return}}
  try{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type:"text/csv"}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}catch(_){toast("Downloads aren't available here.")}
}
function exportSeating(){
  const rows=[["Building","Floor","Desk","Name","Team","Title"]];
  for(const k of floorKeys()){const m=modelFor(k),p=CAMPUS.parseKey(k),b=bldg(p.b);if(!m)continue;for(const pp of m.people||[]){const d=m.desks[pp.desk];rows.push([b.name,String(p.f),d?d.id:"",pp.name,pp.team||"",pp.title||""])}}
  saveFile("campus-seating.csv",IMPORT.toCSV(rows));
}
async function readImport(file){
  if(file.size>15e6){toast("That file is too big. Export just the seating columns.");return}
  // pass bytes, not text: the importer detects UTF-16 ("Unicode text") and Windows-1252 Excel exports
  const buf=await file.arrayBuffer().catch(()=>null);if(buf==null){toast("Couldn't read that file.");return}
  let parsed;try{parsed=IMPORT.parseCSV(buf)}catch(e){parsed=null}
  if(!parsed||!parsed.header||!parsed.rows||!parsed.rows.length){imp={file:file.name,error:"That file doesn't look like a CSV with a header row and people in it."};renderSetup();return}
  const mc=IMPORT.mapColumns(parsed.header);imp={file:file.name,parsed,map:Object.assign({},mc.map),ignored:mc.ignored||[],alias:{}};runNormalize();renderSetup();
}
function runNormalize(){
  try{imp.norm=IMPORT.normalize(imp.parsed,imp.map,DATA.campus,imp.alias)}catch(e){console.error(e);imp.norm=null;imp.error="Couldn't read the people in that file."}
  if(imp.norm){const nr={};for(const k in imp.norm.floors)nr[k]=imp.norm.floors[k].filter(r=>!r.vacant);try{imp.diff=IMPORT.diff(dbRosters,nr)}catch(_){imp.diff=null}}
}
function importView(){
  const v=el("div",{cls:"sec"});
  if(imp.error){v.appendChild(el("p",{cls:"prob",text:imp.error}));return v}
  v.appendChild(el("h3",{text:"Reading "+imp.file}));
  // column mapping
  const tw=el("div",{cls:"tscroll"}),tb=el("table",{cls:"tbl"});tw.appendChild(tb);
  tb.appendChild(el("thead",null,[el("tr",null,[el("th",{text:"We need"}),el("th",{text:"Column in your file"})])]));
  const tbody=el("tbody");tb.appendChild(tbody);
  FIELDS.forEach(([f,label])=>{const sel=el("select",{"aria-label":label});sel.appendChild(el("option",{value:"-1",text:"— not in file —"}));imp.parsed.header.forEach((h,i)=>{const o=el("option",{value:String(i),text:String(h||"Column "+(i+1)).slice(0,40)});if(imp.map[f]===i)o.selected=true;sel.appendChild(o)});sel.onchange=()=>{imp.map[f]=+sel.value;runNormalize();renderSetup()};tbody.appendChild(el("tr",null,[el("td",{text:label}),el("td",null,[sel])]))});
  v.appendChild(tw);
  if(imp.ignored&&imp.ignored.length)v.appendChild(el("p",{cls:"note",text:"Ignored, not stored: "+imp.ignored.slice(0,12).join(", ")+(imp.ignored.length>12?` and ${imp.ignored.length-12} more`:"")}));
  const n=imp.norm;if(!n){v.appendChild(el("p",{cls:"prob",text:"Pick at least the name column."}));return v}
  // buildings
  const raws=Object.keys(n.buildings||{});
  if(raws.length){v.appendChild(el("div",{cls:"lbl",text:"Buildings in your file"}));
    raws.slice(0,20).forEach(raw=>{const sel=el("select",{"aria-label":"Building for "+raw});sel.appendChild(el("option",{value:"",text:"— skip these rows —"}));DATA.campus.buildings.forEach(b=>{const o=el("option",{value:b.id,text:b.name});if(n.buildings[raw]===b.id)o.selected=true;sel.appendChild(o)});sel.onchange=()=>{imp.alias[raw]=sel.value||null;runNormalize();renderSetup()};v.appendChild(el("label",{cls:"row"},[el("span",{text:raw||"(blank)",style:"min-width:120px;font-weight:700"}),sel]))})}
  // summary
  let people=0,floorsN=0,withXY=0;for(const k in n.floors){const rows=n.floors[k];const p=rows.filter(r=>!r.vacant).length;if(p)floorsN++;people+=p;withXY+=rows.filter(r=>isFinite(r.x)&&isFinite(r.y)).length}
  const d=imp.diff||{added:[],removed:[],moved:[]};
  v.appendChild(el("div",{cls:"stats"},[["People",nf(people)],["Floors",String(floorsN)],["New",nf(d.added.length)],["Moved",nf(d.moved.length)],["Leaving",nf(d.removed.length)]].map(([a,b])=>el("div",null,[el("b",{cls:"stat",text:b}),el("span",{text:a})]))));
  if(withXY)v.appendChild(el("p",{cls:"note",text:`${nf(withXY)} rows have desk coordinates. After applying, open a floor and use “Place desks from your facilities file” to put desks exactly where they are.`}));
  if(n.problems&&n.problems.length){v.appendChild(el("div",{cls:"lbl",text:`${n.problems.length} rows need a look`}));const ul=el("ul",{cls:"prob"});n.problems.slice(0,25).forEach(p=>ul.appendChild(el("li",{text:`Row ${p.row}: ${p.msg}`})));if(n.problems.length>25)ul.appendChild(el("li",{text:`…and ${n.problems.length-25} more`}));v.appendChild(ul)}
  const ok=people>0;
  v.appendChild(el("div",{cls:"row"},[el("button",{cls:"primary",type:"button",text:applying?"Saving…":ok?`Apply to the campus`:"Nothing to apply",disabled:ok&&!applying?null:"true",onclick:()=>applyImport()}),el("button",{cls:"tb",type:"button",text:"Cancel",onclick:()=>{imp=null;renderSetup()}})]));
  return v;
}
async function applyImport(){
  const n=imp&&imp.norm;if(!n||applying)return;
  if(!dataReady()){toast("The saved campus data hasn't loaded yet. Try again in a moment.");return}
  applying=true;renderSetup();
  try{await applyImportNow(n)}finally{applying=false;if(!$("setup").hidden)renderSetup();scheduleMerge()}
}
async function applyImportNow(n){
  const rosters={},xy={},names=new Set();
  for(const k of floorKeys()){const rows=n.floors[k]||[];rosters[k]=rows.filter(r=>!r.vacant&&r.name).map(r=>({desk:r.desk||"",name:r.name,team:r.team||"",title:r.title||""}));
    const pts=rows.filter(r=>r.desk&&isFinite(r.x)&&isFinite(r.y)).map(r=>[String(r.desk).slice(0,24),+r.x,+r.y,isFinite(r.rot)?+r.rot:0]);if(pts.length)xy[k]=pts;
    rosters[k].forEach(p=>p.team&&names.add(p.team))}
  // keep colors/seating the owner already chose for real teams; give new teams distinct palette colors (sample teams don't count)
  const prev=DATA.demo?{}:(dbCampus&&dbCampus.teams)||{},teams={},used=new Set();
  for(const t of names)if(prev[t]){teams[t]=prev[t];used.add(prev[t].color)}
  let ci=1;for(const t of [...names].sort()){if(teams[t])continue;let c=CAMPUS.teamColor(t,ci);for(let g=0;g<40&&used.has(c);g++)c=CAMPUS.teamColor(t,++ci);ci++;used.add(c);teams[t]={color:c,arr:CAMPUS.defaultArr(t)}}
  // never overwrite a floor someone drew by hand: ask the store which floors are drawn right now
  let drawn;
  if(db){let fs=null;try{fs=await db.collection("floors").limit(200).get()}catch(_){}
    if(!fs||fs.metadata.fromCache){toast("Saved floors can't be reached right now. Try again in a moment.");return}
    drawn=new Set(fs.docs.filter(d=>{const v=d.data();return v&&!v.auto}).map(d=>d.id))}
  else drawn=new Set(Object.keys(dbFloors).filter(k=>!dbFloors[k].auto));
  const floors={};
  for(const k of floorKeys()){if(drawn.has(k))continue;const base=(DEMO.floors[k]&&DEMO.floors[k].b===CAMPUS.parseKey(k).b)?DEMO.floors[k]:DATA.floors[k];floors[k]=autoFloor(base,rosters[k],teams)}
  const src=imp.file.slice(0,80)+" · "+new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
  try{
    if(db){
      await saveCampus({teams,demo:false,src,at:Date.now()},true);
      for(const k of floorKeys())await db.doc("roster/"+k).set({v:1,rows:rosters[k].map(p=>[p.desk,p.name,p.team,p.title]),src,updatedAt:Date.now()});
      for(const k in floors)await db.doc("floors/"+k).set(floors[k]);
      for(const k in xy)await db.doc("deskxy/"+k).set({rows:xy[k],updatedAt:Date.now()});
    }else{
      DATA.campus=Object.assign({},DATA.campus,{teams,demo:false,src});dbCampus=Object.assign({},DATA.campus);for(const k in rosters)dbRosters[k]=rosters[k];for(const k in floors)dbFloors[k]=floors[k];Object.assign(dbXY,xy);mergeData();refreshWorld();
    }
    imp=null;toast(`Seating loaded: ${nf(Object.values(rosters).reduce((a,r)=>a+r.length,0))} people`);
  }catch(e){toast(e&&e.code==="invalid_argument"?"Only editors of this page can change the seating.":e&&e.code==="quota_exceeded"?"The page's storage is full.":"Couldn't save the seating. Try again.")}
}
async function saveCampus(patch,quiet){
  if(db&&!dataReady()){const e=new Error("not loaded");if(!quiet)toast("The saved campus data hasn't loaded yet. Try again in a moment.");throw e}
  const next=Object.assign({},DATA.campus,patch);
  const doc={v:1,name:next.name,demo:next.demo!==false,buildings:next.buildings,teams:patch.teams||(dbCampus&&dbCampus.teams)||{},src:next.src||"",at:next.at||Date.now()};
  if(db){try{await db.doc("campus/main").set(doc)}catch(e){if(!quiet)toast(e&&e.code==="invalid_argument"?"Only editors of this page can change this.":"Couldn't save. Try again.");throw e}}
  else{dbCampus=validCampus(doc);if(mergeData())refreshWorld()}
}
// floor editor bridge
// plan images over 4096 px on the long side are scaled down once, before upload, so every viewer gets a bounded texture
async function shrinkPlan(blob){
  try{const bm=await createImageBitmap(blob),s=Math.min(1,4096/Math.max(bm.width,bm.height));if(s>=1){bm.close&&bm.close();return blob}
    const c=document.createElement("canvas");c.width=Math.round(bm.width*s);c.height=Math.round(bm.height*s);c.getContext("2d").drawImage(bm,0,0,c.width,c.height);bm.close&&bm.close();
    return await new Promise(r=>c.toBlob(b=>r(b||blob),blob.type==="image/jpeg"?"image/jpeg":"image/png",.9))}catch(_){return blob}
}
let pdfjs=null;
function loadPdfJs(){if(pdfjs)return pdfjs;pdfjs=new Promise((res,rej)=>{const s=document.createElement("script");s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";s.onload=()=>{const L=window.pdfjsLib;if(!L){rej(new Error("PDF reader didn't load"));return}try{L.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"}catch(_){}res(L)};s.onerror=()=>{pdfjs=null;rej(new Error("The PDF reader couldn't load. Export the plan as PNG instead."))};document.head.appendChild(s)});return pdfjs}
function openEditor(key){
  const spec=DATA.floors[key];if(!spec)return;
  const xyRows=dbXY[key]||[],xyBy=new Map(xyRows.map(r=>[String(r[0]).toLowerCase(),r]));
  const roster=(DATA.rosters[key]||[]).map(p=>{const r=xyBy.get(String(p.desk||"").toLowerCase());return r?Object.assign({},p,{x:r[1],y:r[2],rot:r[3]}):Object.assign({},p)});
  // desks with coordinates but nobody assigned (open desks) still get placed
  for(const r of xyRows)if(!roster.some(p=>String(p.desk||"").toLowerCase()===String(r[0]).toLowerCase()))roster.push({desk:String(r[0]),name:"",team:"",title:"",x:r[1],y:r[2],rot:r[3],vacant:true});
  $("setup").hidden=true;setInert(false);edOpen=true;stopKeys();
  try{
    EDITOR.open({key,title:floorName(key),spec,planUrl:spec.plan&&/^[0-9a-f]{32}$/.test(spec.plan.asset||"")?blobUrl(spec.plan.asset):null,teams:teamsMap(),roster,
      build:s=>LAYOUT.build(s,DATA.rosters[key]||[],teamsMap()),
      upload:assets?async blob=>{blob=await shrinkPlan(blob);const t=/^image\/(png|jpeg|webp|gif)$/.test(blob.type)?blob.type:"image/png";const r=await assets.upload(blob,{type:t});return{asset:r.id,url:r.url}}
        :!db?async blob=>{blob=await shrinkPlan(blob);const id=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,"0")).join(""),url=URL.createObjectURL(blob);LOCAL_BLOBS.set(id,url);return{asset:id,url}}:null,
      renderPDF:async f=>IMPORT.renderPDF(f,await loadPdfJs()),parseDXF:t=>IMPORT.parseDXF(t),similarity:(a,b,c,d)=>IMPORT.similarity(a,b,c,d),
      onSave:async s=>{s=Object.assign({},s,{key,b:CAMPUS.parseKey(key).b,f:CAMPUS.parseKey(key).f,updatedAt:Date.now()});delete s.auto;const size=JSON.stringify(s).length;if(size>240000)throw new Error(`This floor has too much detail to save (${Math.round(size/1024)} KB). Remove some walls or desks.`);
        if(db){try{await db.doc("floors/"+key).set(s)}catch(e){throw new Error(e&&e.code==="invalid_argument"?"Only editors of this page can save floors.":"Couldn't save the floor. Try again.")}}
        else{dbFloors[key]=s;mergeData();refreshWorld()}
        // floor 1 sets the building's footprint on the campus (the front door must line up with the floor's doorway)
        const pk=CAMPUS.parseKey(key),bb=bldg(pk.b);
        if(pk.f===1&&bb&&(Math.abs(bb.w-s.w)>.01||Math.abs(bb.d-s.d)>.01)){try{await saveCampus({buildings:DATA.campus.buildings.map(b=>b.id===bb.id?Object.assign({},b,{w:clamp(s.w,12,300),d:clamp(s.d,12,300)}):b)},true)}catch(_){}}
        toast(floorName(key)+" saved")},
      onClose:()=>{edOpen=false;stopKeys();if(canSetup){openSetup()}}
    });
  }catch(e){console.error(e);edOpen=false;toast("The floor editor couldn't open.")}
}

/* ---------- main loop ---------- */
function resize(){
  const w=innerWidth,h=innerHeight;renderer.setPixelRatio(S&&S.pixel?Math.min(1,520/w):DPR);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
}
addEventListener("resize",resize);
let last=performance.now(),lblAcc=0,lookAcc=0,mapAcc=0,rosterAcc=0;
function walkBlocked(x,z){if(Math.abs(x)>PW/2-.5||Math.abs(z)>PD/2-.5)return true;const l=query(x,z,.35,4);for(let i=0;i<l.length;i++)if(circleVs(l[i],x,z,.3))return true;return false}
function walkFrame(dt){
  if(tour){tour.t+=dt/tour.dur;const k=easeIO(Math.min(1,tour.t)),f=tour.from,t=tour.to;walker.x=f.x+(t.x-f.x)*k;walker.z=f.z+(t.z-f.z)*k;walker.yaw=f.yaw+(t.yaw-f.yaw)*k;walker.pitch=f.pitch+(t.pitch-f.pitch)*k;if(tour.t>=1)tour=null;return}
  let f=0,r=0;if(keys.KeyW||keys.ArrowUp)f++;if(keys.KeyS||keys.ArrowDown)f--;if(keys.KeyD)r++;if(keys.KeyA)r--;
  if(keys.ArrowLeft)walker.yaw+=1.8*dt;if(keys.ArrowRight)walker.yaw-=1.8*dt;
  if(stick){f-=clamp(stick.y,-1,1);r+=clamp(stick.x,-1,1)}
  if(f||r){const sp=(keys.ShiftLeft||keys.ShiftRight?6:3)*dt*(WKIND==="campus"?1.6:1),l=Math.max(1,Math.hypot(f,r)),y=walker.yaw;
    const dx=(-Math.sin(y)*f+Math.cos(y)*r)/l*sp,dz=(-Math.cos(y)*f-Math.sin(y)*r)/l*sp;
    const inside=walkBlocked(walker.x,walker.z);if(inside||!walkBlocked(walker.x+dx,walker.z))walker.x+=dx;if(inside||!walkBlocked(walker.x,walker.z+dz))walker.z+=dz}
}
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min(.05,(now-last)/1000);last=now;if(!(dt>0)||!WM)return;
  if(edOpen){if(presT>1){presT=0;sendPresence()}presT+=dt;return} // the editor covers the screen: skip simulation and rendering
  T+=dt;
  const ctl=mode==="drive"&&!fly&&!trans&&!((run&&run.phase==="count")||(race&&race.phase==="count"))&&$("result").hidden?readDrive():IDLE;
  const bctl=BOTPATH.length?botCtl(bot,dt):IDLE,n=Math.max(1,Math.ceil(dt/(1/120)));
  for(let k=0;k<n;k++){carStep(me,ctl,dt/n,true);if(BOTPATH.length)carStep(bot,bctl,dt/n,false)}
  chairsStep(dt);
  syncCar(me,dt,false);syncCar(bot,dt,false);if(bot.vis)bot.vis.g.visible=BOTPATH.length>0;
  remoteFrame(dt,now);
  if(mode==="walk"&&!fly&&!trans)walkFrame(dt);
  runFrame(dt);raceFrame(dt);routeFrame(dt,now);elevFrame();doorFrame();
  chevOff+=dt*1.4;if(route||race)routeVisuals();
  camFrame(dt,now);
  fxFrame(dt);popsFrame(dt);
  if(beacon.visible){const s=1+Math.sin(now/300)*.12;beacon.userData.ring.scale.set(s,s,s);beamM.opacity=.25+Math.sin(now/300)*.1}
  if(S.scan)lineMats.forEach(m=>m.opacity=.82+Math.random()*.16);
  if(mode==="drive"&&camMode==="top")placeTag(meTag,me.x,me.y+.3,me.z-.5);else placeTag(meTag,me.x,me.y+tagH(me.kind),me.z);if(meTag)meTag.visible=!(mode==="drive"&&!fly&&(camMode==="chase"||camMode==="bumper"));
  placeTag(botTag,bot.x,bot.y+.36,bot.z);if(botTag)botTag.visible=BOTPATH.length>0;
  if(joinable&&now>joinable.until)joinable=null;
  lblAcc+=dt;if(lblAcc>.2){lblAcc=0;updateLabels()}
  lookAcc+=dt;if(lookAcc>.1){lookAcc=0;updateLookCard()}
  mapAcc+=dt;if(mapAcc>.05&&mode!=="overview"){mapAcc=0;drawMap()}
  hudFrame();audioFrame();
  presT+=dt;if(presT>1/15){presT=0;sendPresence()}
  rosterAcc+=dt;if(rosterAcc>1){rosterAcc=0;if(mode==="overview")renderRoster()}
  renderer.render(scene,camera);
}
// continuous sounds follow the car (motor pitch rises with speed; tyre roll; a soft hiss when sliding); dogs and cats patter
let stepPh=0;
function audioFrame(){
  if(!AC||!motor)return;const t=AC.currentTime,M=motor,drv=mode==="drive"&&!fly&&!trans,car=drv&&me.kind==="car"&&!muted,sp=Math.abs(me.vF);
  const f=115+sp*36+(me.boosting?80:0)+(me.air?55:0);
  M.o1.frequency.setTargetAtTime(f,t,.06);M.o2.frequency.setTargetAtTime(f*.5,t,.06);M.o3.frequency.setTargetAtTime(f*3,t,.06);M.wF.frequency.setTargetAtTime(f*3,t,.06);
  M.mF.frequency.setTargetAtTime(600+sp*240,t,.08);
  M.mG.gain.setTargetAtTime(car?.03+Math.abs(me.thr)*.025+Math.min(sp,12)*.003:0,t,.1);
  M.wG.gain.setTargetAtTime(car?Math.min(.025,sp*.0022)+(me.boosting?.012:0):0,t,.1);
  M.rG.gain.setTargetAtTime(car&&!me.air?Math.min(.09,sp*.011):0,t,.08);M.rF.frequency.setTargetAtTime(160+sp*35,t,.1);
  const slide=car&&!me.air&&(me.drift||Math.abs(me.lat)>1.6);
  M.sG.gain.setTargetAtTime(slide?Math.min(.03,.01+Math.abs(me.lat)*.008):0,t,.05);
  if(drv&&me.kind!=="car"&&!me.air&&Math.hypot(me.vx,me.vz)>.6){const st=Math.floor((me.phase||0)/Math.PI);if(st!==stepPh){stepPh=st;SFX.step(me.kind)}}
}

/* ---------- boot ---------- */
try{DEMO=CAMPUS.demo(LAYOUT)}catch(e){console.error(e);fatal("The campus couldn't be built. Reload the page to try again.");return}
DATA=null;mergeData(true);
{const OLD=[0,1,2,3,4,0,0,5,0,6];let saved=parseInt(store.get("rc-style"),10);if(store.get("rc-style-v")!=="2"&&Number.isInteger(saved))saved=OLD[saved];const i=Number.isInteger(saved)&&saved>=0&&saved<ST.length?saved:(matchMedia("(prefers-color-scheme: dark)").matches?1:0);S=ST[i];cur=i;fxRestyle();styleUI(i)}
resize();
{const last_=store.get("rc-world");enterWorld(last_&&(last_==="campus"||floorKeys().includes(last_))?last_:"campus")}
setAvatar(me.kind);setMuted(muted);setMode("overview");updateRunBtn();
ovPose(camPos,camLook);camera.fov=fovFor("overview");
addEventListener("pagehide",()=>store.set("rc-world",WKEY));
setInterval(()=>store.set("rc-world",WKEY),5000);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{signs.forEach(sg=>{const c=textCanvas(sg.lines,{stripe:sg.stripe});sg.s.material.map.dispose();sg.s.material.map=new THREE.CanvasTexture(c);sg.s.material.map.minFilter=THREE.LinearFilter;sg.s.material.needsUpdate=true;sg.s.scale.set(sg.h*c.width/c.height,sg.h,1)});labelsClear();rebuildTags();resolveNames()});
requestAnimationFrame(frame);
(async()=>{
  const [u,d,rm,as]=await Promise.all([capUse("user"),capUse("db"),capUse("room"),capUse("assets")]);
  user=u;db=d;room=rm;assets=as;
  if(db)showLoading();
  if(user){try{myId=await user.id()}catch(_){}try{canWrite=await user.can("data.write")}catch(_){}try{canSetup=!!(await user.canEdit())||!!(await user.isOwner())}catch(_){}}
  if(!db&&!window.claude)canSetup=true; // local preview: let the setup tools run in memory
  watchData();startBoard();renderStart();
  if(room){try{room.onPeers(ch=>syncPeers(ch.peers),()=>{room=null;for(const r of remotes.values())removeRemote(r);remotes.clear();renderRoster()});setTimeout(()=>{roomSettled=true;renderRoster()},2000)}catch(_){room=null}}
  presDirty=true;resolveNames();renderStart();
})();
