/* ===================== game part 1: core (utils, renderer, styles, materials, instancing, sprites, models, fx, audio) ===================== */
const $=id=>document.getElementById(id);
function fatal(msg){const f=$("fatal");f.hidden=false;f.querySelector("p").textContent=msg;["bar","start","side","panel","mapwrap","speedo","help"].forEach(id=>{const e=$(id);if(e)e.style.display="none"})}
if(!window.THREE){fatal("The 3D library didn't load, so the campus can't be shown. Check your connection and reload the page.");return}

/* ---------- utils ---------- */
const clamp=(v,a,b)=>v<a?a:v>b?b:v,lerp=(a,b,t)=>a+(b-a)*t,angDiff=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
const easeIO=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const REDUCED=matchMedia("(prefers-reduced-motion: reduce)").matches;
const TOUCH=matchMedia("(pointer: coarse)").matches;
if(TOUCH)document.body.classList.add("touch");
addEventListener("pointerdown",e=>{if(e.pointerType==="touch")document.body.classList.add("touch")},{capture:true,passive:true});
const store={get(k){try{return localStorage.getItem(k)}catch(_){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(_){}}};
const V3=THREE.Vector3,HEX=/^#[0-9a-fA-F]{6}$/;
let jseed=1;const jr=()=>{jseed=(jseed*16807)%2147483647;return(jseed-1)/2147483646};
function bright(hex){const c=new THREE.Color(hex),h={};c.getHSL(h);if(h.s<.12)return"#FFFFFF";c.setHSL(h.h,Math.max(h.s,.75),Math.max(h.l,.62));return"#"+c.getHexString()}
const lum=hex=>{const c=new THREE.Color(hex),f=v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b)};
const fmt=t=>{const cs=Math.round(t*100),m=Math.floor(cs/6000),s=(cs-m*6000)/100;return m+":"+(s<10?"0":"")+s.toFixed(2)};
const safeHex=(c,d)=>HEX.test(c)?c:d;
const mix=(a,b,t)=>new THREE.Color(a).lerp(new THREE.Color(b),t);
const esc=s=>String(s==null?"":s);
const plural=(n,w,p)=>n+" "+(n===1?w:(p||w+"s"));
const nf=n=>Number(n).toLocaleString("en-US");

/* ---------- renderer ---------- */
let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true})}catch(e){fatal("This browser can't show 3D graphics (WebGL), so the campus can't be shown here.");return}
renderer.setClearColor(0x000000,0);renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const stage=$("stage"),cv=renderer.domElement;stage.appendChild(cv);cv.tabIndex=-1;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,1,.03,900);
const DPR=Math.min(window.devicePixelRatio||1,TOUCH?1.75:2),SM=TOUCH?1024:2048;

/* ---------- textures ---------- */
function ctex(w,h,fn){const c=document.createElement("canvas");c.width=w;c.height=h;fn(c.getContext("2d"),w,h);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t}
const SHARED=new Set();
const RADIAL=ctex(64,64,g=>{const r=g.createRadialGradient(32,32,0,32,32,32);r.addColorStop(0,"rgba(255,255,255,1)");r.addColorStop(1,"rgba(255,255,255,0)");g.fillStyle=r;g.fillRect(0,0,64,64)});SHARED.add(RADIAL);
const hazardImg=document.createElement("canvas");hazardImg.width=128;hazardImg.height=32;{const g=hazardImg.getContext("2d");g.fillStyle="#F2C14E";g.fillRect(0,0,128,32);g.fillStyle="#1E1F21";for(let x=-32;x<160;x+=32){g.beginPath();g.moveTo(x,32);g.lineTo(x+16,32);g.lineTo(x+48,0);g.lineTo(x+32,0);g.closePath();g.fill()}}
function hazardTex(rx){const t=new THREE.CanvasTexture(hazardImg);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,1);return t}
let ks=7;const kr=()=>{ks=(ks*16807)%2147483647;return(ks-1)/2147483646};
const FLOORTEX={
  checker:(w,d)=>{const t=ctex(16,16,g=>{for(let y=0;y<2;y++)for(let x=0;x<2;x++){g.fillStyle=(x+y)%2?"#5A5748":"#6E6A58";g.fillRect(x*8,y*8,8,8)}});t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;t.repeat.set(w,d);return t},
  kraft:(w,d)=>{ks=7;const t=ctex(256,256,(g,W,H)=>{g.fillStyle="#C9A97A";g.fillRect(0,0,W,H);for(let i=0;i<900;i++){g.strokeStyle=kr()<.5?"rgba(120,85,45,.18)":"rgba(255,240,210,.22)";g.lineWidth=kr()*1.2+.3;const x=kr()*W,y=kr()*H,a=kr()*Math.PI,l=kr()*14+3;g.beginPath();g.moveTo(x,y);g.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l);g.stroke()}});t.repeat.set(w/4,d/4);return t},
  dots:(w,d)=>{const t=ctex(32,32,g=>{g.fillStyle="#FFE07A";g.fillRect(0,0,32,32);g.fillStyle="#F2B705";g.beginPath();g.arc(16,16,6,0,7);g.fill()});t.repeat.set(w/.3,d/.3);return t}
};
const GRAD=(()=>{const t=new THREE.DataTexture(new Uint8Array([135,135,135,200,200,200,255,255,255]),3,1,THREE.RGBFormat);t.minFilter=t.magFilter=THREE.NearestFilter;t.generateMipmaps=false;t.needsUpdate=true;return t})();

/* ---------- the 10 styles ---------- */
const BASE={floor:"#D9D5CB",carpet:"#CFE0EE",desk:"#F7F5EF",panel:"#9AA09A",leg:"#6E736C",mon:"#23272B",screen:"#3d6fb0",chair:"#3E7CB1",car:"#E4572E",glass:"#16202a",tire:"#1E1F21",rim:"#C9CCD1",wall:"#F4F3EF",win:"#BFD3DE",plant:"#4F9D69",pot:"#E9E2D0",ramp:"#F2C14E",light:"#FFF6D8",tail:"#ff2a2a",cup:"#FFFFFF",lid:"#5A3A22"};
// roles used by v4 furniture/equipment/campus map onto the 21 base palette roles every style defines
const ALIAS={counter:"panel",top:"desk",table:"desk",frame:"leg",machine:"mon",glassRoom:"win",rampSide:"leg",body:"chair",head:"pot",
  bench:"desk",cabinet:"panel",shelf:"leg",rack:"mon",led:"screen",scope:"mon",chamber:"wall",probe:"panel",sofa:"chair",reception:"panel",
  fridge:"wall",printer:"wall",board:"desk",metal:"rim",booth:"win",locker:"panel",solid:"wall",roof:"panel",trunk:"pot",bldg:"wall",bwin:"win",slab:"panel",carbody:"car",cabin:"glass",post:"leg",flag:"ramp",stripe:"light",pad:"ramp"};
const PAL=o=>Object.assign({},BASE,o);
const NEON_TEAM=["#3DA5FF","#B26BFF","#FFB547","#39FF9E","#FF2E97"],COMIC_TEAM=["#3B8BFF","#A35BFF","#FF9F1C","#2BD97C","#FF4FA0"];
const ST=[
{n:"Toy showroom",d:"Glossy plastic cars in bright daylight with soft shadows. Clean and cheerful.",bg:"#EEF0EA",mat:"phong",light:"day",shadows:true,ramp:"hazard",ui:"light",acc:"#E4572E",tc:1,td:.35,tcar:.3,fog:[34,110],skid:["#3a3a3a",.35,0],smoke:["#ffffff",.55,0],pal:PAL({})},
{n:"Neon night",d:"Lights off. A dark floor with a glowing grid, lit edges and screens, and car underglow.",bg:"#07071A",mat:"basic",light:"none",edges:{c:"#2DE2E6",o:.95},carEdge:true,carFace:true,teamEdges:true,teamPal:NEON_TEAM,edgeRole:{plant:"#7CFF6B",pot:"#7CFF6B",ramp:"#FFB547",rampSide:"#FFB547",win:"#5B4BFF",glassRoom:"#5B4BFF",bwin:"#5B4BFF",led:"#FF2E97",stripe:"#FFB547",pad:"#FFB547"},grid:{c:"#FF2E97",o:.45},glow:true,ui:"dark",acc:"#FFB547",tc:0,td:0,tcar:0,fog:[18,90],skid:["paint",.85,1],smoke:["paint",.4,1],pal:PAL({floor:"#0B0A20",carpet:"#0E0C26",desk:"#100E2A",panel:"#100E2A",leg:"#100E2A",mon:"#100E2A",screen:"#2DE2E6",chair:"#100E2A",car:"#140B2A",glass:"#0b0820",tire:"#07071A",rim:"#140B2A",wall:"#0B0A20",win:"#120d3a",plant:"#0B0A20",pot:"#0B0A20",ramp:"#120d30",light:"#E8FFFF",tail:"#FF2E97",cup:"#E8FFFF",lid:"#100E2A"})},
{n:"Blueprint",d:"A white technical drawing on drafting blue, with each car picked out in its own color.",bg:"#123A6B",mat:"basic",faceIsBg:true,light:"none",edges:{c:"#E8F1FF",o:.9},carEdge:true,grid:{c:"#E8F1FF",o:.13},ui:"dark",label:{bg:"rgba(18,58,107,.94)",fg:"#E8F1FF",sub:"#A9C6EE"},acc:"#FFB547",fog:null,skid:["#E8F1FF",.3,0],smoke:["#E8F1FF",.3,0],pal:PAL({})},
{n:"Comic cel-shade",d:"Flat bold colors, thick ink outlines and halftone dots on the floor.",bg:"#FFF1C9",mat:"toon",light:"cel",outline:"#111111",floorTex:"dots",ramp:"hazard",ui:"light",acc:"#FF3B3B",tc:1,td:0,tcar:.55,teamPal:COMIC_TEAM,fog:null,skid:["#111111",.5,0],smoke:["#ffffff",.85,0],pal:PAL({floor:"#FFFFFF",carpet:"#7FD1FF",desk:"#FFFFFF",panel:"#FF7A3D",leg:"#2B2B2B",mon:"#2B2B2B",screen:"#5CC8FF",chair:"#FF3B3B",car:"#FF3B3B",glass:"#1A1A1A",tire:"#1A1A1A",rim:"#FFE14D",wall:"#FFFDF5",win:"#9FE0FF",plant:"#3FC35A",pot:"#FF9F1C",ramp:"#FFFFFF",counter:"#3FA7D6"})},
{n:"Low-res retro 3D",d:"Chunky pixels, flat polygons and a foggy checkerboard floor, like an early 3D console.",bg:"#3B4A6B",mat:"flat",light:"retro",pixel:true,lowpoly:true,fog:[7,32],floorTex:"checker",blob:true,ui:"dark",acc:"#F2C14E",tc:.85,td:.2,tcar:.5,skid:["#1b1b1b",.45,0],smoke:["#d8d8d8",.6,0],pal:PAL({floor:"#FFFFFF",carpet:"#4E6E5D",desk:"#B8A882",panel:"#7A6A55",leg:"#3C3A36",mon:"#2A2A33",screen:"#4FD1C5",chair:"#A23B3B",car:"#E0452B",glass:"#1A1A22",tire:"#141414",rim:"#BFBFBF",wall:"#8C8A84",win:"#7FA6C9",plant:"#3E8E41",pot:"#9C5B3B",ramp:"#E2B33C"})},
{n:"Claymation",d:"Soft matte clay with rounded, slightly squashed shapes in warm light.",bg:"#F3E3D3",mat:"lambert",light:"soft",shadows:true,round:true,jitter:.03,ui:"light",acc:"#E85D4A",tc:.7,td:.2,tcar:.35,fog:[36,110],skid:["#8C6B5A",.35,0],smoke:["#fff4e6",.6,0],pal:PAL({floor:"#E8C39E",carpet:"#B9D8C2",desk:"#F7DDB0",panel:"#C98B6B",leg:"#8C6B5A",mon:"#5B4B49",screen:"#8FD3E8",chair:"#E86A50",car:"#E85D4A",glass:"#4A3F45",tire:"#3E3236",rim:"#F2E2C4",wall:"#F6E7D6",win:"#BFE1EA",plant:"#6DBE6A",pot:"#D9824E",ramp:"#F4C95D",counter:"#7FB3A0"})},
{n:"Papercraft",d:"Folded paper facets and crisp creases on a kraft-paper floor.",bg:"#EFE6D2",mat:"flat",light:"soft",shadows:true,lowpoly:true,floorTex:"kraft",edges:{c:"#8a6b45",o:.35},carEdgeColor:"#1d5e57",jitter:.02,ui:"light",acc:"#E76F51",tc:.8,td:.15,tcar:.4,fog:[36,110],skid:["#5b4630",.3,0],smoke:["#fbf8f1",.7,0],pal:PAL({floor:"#FFFFFF",carpet:"#E9C46A",desk:"#FBF8F1",panel:"#E76F51",leg:"#D8D2C4",mon:"#264653",screen:"#8ECAE6",chair:"#F4A261",car:"#2A9D8F",glass:"#264653",tire:"#3A3A3A",rim:"#FBF8F1",wall:"#F6F1E6",win:"#CFE6EE",plant:"#5FA26B",pot:"#C1694F",ramp:"#E9C46A"})},
{n:"Tilt-shift miniature",d:"A realistic office seen from above with blurred edges, so it reads as a scale model.",bg:"#DDE3E6",mat:"phong",light:"day",shadows:true,tilt:true,cam:"high",ramp:"hazard",ui:"light",acc:"#D7263D",tc:.5,td:0,tcar:.25,fog:[40,130],skid:["#222222",.35,0],smoke:["#ffffff",.5,0],pal:PAL({floor:"#A9A49B",carpet:"#7F8A8F",desk:"#C9A27A",panel:"#E8E6E1",leg:"#2E3135",mon:"#1E2124",screen:"#5d87b5",chair:"#2B2E33",car:"#F2C14E",glass:"#121820",tire:"#1A1B1C",rim:"#D0D3D6",wall:"#EDEBE6",win:"#A9C6DA",plant:"#3F7F4F",pot:"#F0EEE9",ramp:"#E8B33A",counter:"#4A5A54"})},
{n:"Architect's model",d:"An all-white scale model, with only the cars in color.",bg:"#F4F4F2",mat:"lambert",light:"soft",shadows:true,edges:{c:"#B9B9B2",o:.6},noCarEdge:true,ui:"light",acc:"#FF5A1F",tc:0,td:0,tcar:0,fog:[45,140],skid:["#9a9a94",.3,0],smoke:["#ffffff",.6,0],pal:PAL({floor:"#ECECE8",carpet:"#E4E4DF",desk:"#FAFAF8",panel:"#F0F0EC",leg:"#E6E6E1",mon:"#EDEDE9",screen:"#E3E3DE",chair:"#F4F4F1",glass:"#DADAD4",tire:"#CFCFC9",rim:"#FFFFFF",wall:"#F7F7F4",win:"#E1E6E8",plant:"#EDEDE8",pot:"#F2F2EE",ramp:"#EFEFEB",light:"#FFFFFF",tail:"#FFFFFF",lid:"#E6E6E1"})},
{n:"Vector arcade",d:"Glowing green line art on black, with old-monitor scanlines.",bg:"#030703",mat:"basic",faceIsBg:true,depthOnly:true,light:"none",edges:{c:"#39FF6A",o:.95},carEdge:true,grid:{c:"#39FF6A",o:.22},scan:true,glowCss:"drop-shadow(0 0 1.5px #39FF6A) drop-shadow(0 0 5px rgba(57,255,106,.6))",ui:"dark",label:{bg:"rgba(3,12,4,.92)",fg:"#9CFFB4",sub:"#39FF6A"},acc:"#F2FFF4",fog:null,skid:["paint",.6,1],smoke:["#39FF6A",.3,1],pal:PAL({})}
];
const LABEL={light:{bg:"rgba(250,251,248,.93)",fg:"#1F2421",sub:"#5D655F"},dark:{bg:"rgba(12,13,30,.9)",fg:"#F2F4FA",sub:"#9FB0C8"}};
let S=null,cur=-1,root=null,HULL=null,sun=null,lineMats=[],glowMats=[],signs=[];
const sunDir=new V3(3.5,6.5,3).normalize();
const NOSHADOW={floor:1,carpet:1,win:1,glassRoom:1,screen:1,light:1,tail:1,led:1,bwin:1,stripe:1,pad:1,booth:1};
const NOOUT={floor:1,carpet:1,win:1,screen:1,light:1,tail:1,ramp:1,rampSide:1,glassRoom:1,led:1,bwin:1,stripe:1,pad:1,booth:1};
const pal=role=>S.pal[role]||S.pal[ALIAS[role]]||"#cccccc";
function color(role,co){if(S.faceIsBg)return S.bg;return co||pal(role)}
const INVIS=new THREE.MeshBasicMaterial({visible:false});
function mat(role,co){
  const glassy=role==="glassRoom"||role==="booth";
  if(glassy&&(S.depthOnly||S.faceIsBg))return INVIS;
  if(S.depthOnly)return new THREE.MeshBasicMaterial({colorWrite:false,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  const off=(S.faceIsBg||S.edges)?{polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}:{};
  if(role==="light"||role==="tail"||role==="led"||role==="stripe")return new THREE.MeshBasicMaterial(Object.assign({color:S.faceIsBg?S.bg:(co||pal(role))},off));
  const base=Object.assign({color:color(role,co)},off);
  if(glassy){base.transparent=true;base.opacity=S.mat==="basic"?.4:.26;base.depthWrite=false}
  if(role==="bwin"&&!S.faceIsBg){base.transparent=true;base.opacity=.85}
  if(S.mat==="basic")return new THREE.MeshBasicMaterial(base);
  if(role==="screen")base.emissive=new THREE.Color(base.color).multiplyScalar(.55);
  if(S.mat==="phong"){const gl=role==="car"||role==="carbody"||role==="glass"||role==="rim"||role==="metal"||role==="bwin";return new THREE.MeshPhongMaterial(Object.assign(base,{shininess:role==="glass"?130:role==="car"||role==="carbody"?95:gl?80:10,specular:gl?0x888888:0x151515}))}
  if(S.mat==="flat")return new THREE.MeshPhongMaterial(Object.assign(base,{flatShading:true,shininess:0,specular:0x000000}));
  if(S.mat==="toon")return new THREE.MeshToonMaterial(Object.assign(base,{gradientMap:GRAD}));
  return new THREE.MeshLambertMaterial(base);
}
function hullT(geo,isCar){if(!geo.boundingBox)geo.computeBoundingBox();const sz=new V3();geo.boundingBox.getSize(sz);return isCar?.013:Math.min(.024,Math.max(.011,Math.min(sz.x,sz.y,sz.z)*.25+.008))}
function hullScale(geo,t){const b=geo.boundingBox,sz=new V3(),c=new V3();b.getSize(sz);b.getCenter(c);return{c,sx:1+2*t/Math.max(sz.x,.002),sy:1+2*t/Math.max(sz.y,.002),sz:1+2*t/Math.max(sz.z,.002)}}
function hullChild(m,geo,isCar){const t=hullT(geo,isCar),k=hullScale(geo,t);const h=new THREE.Mesh(geo,HULL);h.scale.set(k.sx,k.sy,k.sz);h.position.set(k.c.x*(1-k.sx),k.c.y*(1-k.sy),k.c.z*(1-k.sz));m.add(h)}
function hullGeo(geo,t){if(!geo.boundingBox)geo.computeBoundingBox();t=t==null?hullT(geo,false):t;const k=hullScale(geo,t);const g=geo.clone();g.translate(-k.c.x,-k.c.y,-k.c.z);g.scale(k.sx,k.sy,k.sz);g.translate(k.c.x,k.c.y,k.c.z);return g}
function edgeColor(role,o){
  if(!S.edges)return null;
  if(o&&o.edge)return o.edge;
  if(o&&o.car){if(S.noCarEdge)return null;if(S.carEdge)return bright(o.paint||"#ffffff");if(S.carEdgeColor)return S.carEdgeColor}
  return(S.edgeRole&&S.edgeRole[role])||S.edges.c;
}
function part(geo,role,x,y,z,parent,o){
  o=o||{};
  const m=new THREE.Mesh(geo,mat(role,o.color));m.position.set(x,y,z);(parent||root).add(m);
  if(S.shadows){m.receiveShadow=true;if(!NOSHADOW[role]&&!o.noCast)m.castShadow=true}
  if(S.edges&&role!=="floor"&&!o.noEdge){const ec=edgeColor(role,o);if(ec){const lm=new THREE.LineBasicMaterial({color:ec,transparent:S.edges.o<1,opacity:S.edges.o});lineMats.push(lm);m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo,30),lm))}}
  if(S.outline&&!NOOUT[role]&&!o.noOutline)hullChild(m,geo,o.car);
  if(S.jitter&&!o.car&&!o.still&&!NOOUT[role]&&role!=="wall"){m.rotation.y+=(jr()-.5)*S.jitter*2;m.rotation.z+=(jr()-.5)*S.jitter*.6}
  return m;
}
function rr(w,h,rad){const s=new THREE.Shape(),x=-w/2,y=-h/2;s.moveTo(x+rad,y);s.lineTo(x+w-rad,y);s.quadraticCurveTo(x+w,y,x+w,y+rad);s.lineTo(x+w,y+h-rad);s.quadraticCurveTo(x+w,y+h,x+w-rad,y+h);s.lineTo(x+rad,y+h);s.quadraticCurveTo(x,y+h,x,y+h-rad);s.lineTo(x,y+rad);s.quadraticCurveTo(x,y,x+rad,y);return s}
function bx(w,h,d){
  if(!S.round)return new THREE.BoxGeometry(w,h,d);
  const r=Math.min(.035,w*.3,h*.3,d*.3),iw=Math.max(.002,w-2*r),ih=Math.max(.002,h-2*r),id=Math.max(.002,d-2*r);
  const g=new THREE.ExtrudeGeometry(rr(iw,ih,Math.min(iw,ih)*.25),{depth:id,bevelEnabled:true,bevelThickness:r,bevelSize:r,bevelSegments:3,curveSegments:4});g.translate(0,0,-id/2);return g;
}
const seg=n=>S.lowpoly?Math.max(5,Math.round(n/3)):n;
const cyl=(rt,rb,h,n)=>new THREE.CylinderGeometry(rt,rb,h,seg(n||18));

/* instanced groups: faces + optional outline hulls + optional baked edge lines, all moved together.
   count may be 0 (an empty group whose methods do nothing). */
const NOOP_G={set(){},paint(){},edge(){},commit(){},mesh:null,count:0};
function IG(geo,role,count,o){
  o=o||{};if(!count){geo.dispose();return NOOP_G}
  const g={count};
  const m=new THREE.InstancedMesh(geo,mat(role,o.color),count);m.frustumCulled=false;root.add(m);g.mesh=m;
  g.colored=!!o.colored&&!S.faceIsBg&&!S.depthOnly;if(g.colored&&m.material.color)m.material.color.set(0xffffff);
  if(S.shadows){m.receiveShadow=true;if(!NOSHADOW[role]&&!o.noCast)m.castShadow=true}
  if(S.outline&&!NOOUT[role]&&!o.noHull){g.hull=new THREE.InstancedMesh(hullGeo(geo,o.hullT),HULL,count);g.hull.frustumCulled=false;root.add(g.hull)}
  if(S.edges&&!o.noEdge){
    const ec=edgeColor(role,o);
    if(ec||o.teamEdge){
      g.eb=new THREE.EdgesGeometry(geo,30).attributes.position.array;
      const n=g.eb.length*count,pos=new Float32Array(n),col=new Float32Array(n);
      const c=new THREE.Color(ec||S.edges.c);for(let k=0;k<n;k+=3){col[k]=c.r;col[k+1]=c.g;col[k+2]=c.b}
      const bg=new THREE.BufferGeometry();bg.setAttribute("position",new THREE.BufferAttribute(pos,3));bg.setAttribute("color",new THREE.BufferAttribute(col,3));
      const lm=new THREE.LineBasicMaterial({vertexColors:true,transparent:S.edges.o<1,opacity:S.edges.o});lineMats.push(lm);
      g.lines=new THREE.LineSegments(bg,lm);g.lines.frustumCulled=false;root.add(g.lines);
    }
  }
  g.lo=1e9;g.hi=-1;g.cd=false;
  g.set=(i,M)=>{if(i<g.lo)g.lo=i;if(i>g.hi)g.hi=i;m.setMatrixAt(i,M);if(g.hull)g.hull.setMatrixAt(i,M);if(g.lines){const b=g.eb,p=g.lines.geometry.attributes.position.array,off=i*b.length,e=M.elements;for(let k=0;k<b.length;k+=3){const x=b[k],y=b[k+1],z=b[k+2];p[off+k]=e[0]*x+e[4]*y+e[8]*z+e[12];p[off+k+1]=e[1]*x+e[5]*y+e[9]*z+e[13];p[off+k+2]=e[2]*x+e[6]*y+e[10]*z+e[14]}}};
  g.paint=(i,c)=>{if(g.colored){m.setColorAt(i,c instanceof THREE.Color?c:new THREE.Color(c));g.cd=true}};
  g.edge=(i,c)=>{if(!g.lines)return;g.cd=true;const cc=new THREE.Color(c),b=g.eb.length,a=g.lines.geometry.attributes.color.array;for(let k=i*b;k<(i+1)*b;k+=3){a[k]=cc.r;a[k+1]=cc.g;a[k+2]=cc.b}};
  g.commit=()=>{
    if(g.hi>=g.lo){const full=g.lo===0&&g.hi===count-1,rng=(a,sz)=>{a.updateRange.offset=full?0:g.lo*sz;a.updateRange.count=full?-1:(g.hi-g.lo+1)*sz;a.needsUpdate=true};rng(m.instanceMatrix,16);if(g.hull)rng(g.hull.instanceMatrix,16);if(g.lines)rng(g.lines.geometry.attributes.position,g.eb.length);g.lo=1e9;g.hi=-1}
    if(g.cd){if(m.instanceColor)m.instanceColor.needsUpdate=true;if(g.lines)g.lines.geometry.attributes.color.needsUpdate=true;g.cd=false}
  };
  return g;
}

/* ---------- text sprites ---------- */
function theme(){return S.label||LABEL[S.ui]}
function textCanvas(lines,opts){
  const th=theme(),{size=64,pad=24,stripe}=opts||{};
  const c=document.createElement("canvas"),g=c.getContext("2d");
  const l0=String(lines[0]||"").slice(0,60),l1=lines[1]?String(lines[1]).slice(0,70):"";
  g.font=`800 ${size}px Archivo, sans-serif`;let w=g.measureText(l0).width;
  if(l1){g.font=`400 ${size*.55}px "IBM Plex Mono", monospace`;w=Math.max(w,g.measureText(l1).width)}
  c.width=Math.max(8,Math.ceil(w+pad*2+(stripe?14:0)));c.height=Math.ceil(size*(l1?1.9:1.25)+pad);
  g.fillStyle=th.bg;g.beginPath();g.roundRect?g.roundRect(0,0,c.width,c.height,16):g.rect(0,0,c.width,c.height);g.fill();
  if(stripe){g.fillStyle=stripe;g.fillRect(0,0,10,c.height)}
  const x0=pad+(stripe?14:0);g.textBaseline="top";g.fillStyle=th.fg;g.font=`800 ${size}px Archivo, sans-serif`;g.fillText(l0,x0,pad*.55);
  if(l1){g.fillStyle=th.sub;g.font=`400 ${size*.55}px "IBM Plex Mono", monospace`;g.fillText(l1,x0,pad*.55+size*1.1)}
  return c;
}
function spriteFrom(canvas,h,top){
  const tex=new THREE.CanvasTexture(canvas);tex.minFilter=THREE.LinearFilter;
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:!top,transparent:true,fog:false}));
  s.scale.set(h*canvas.width/canvas.height,h,1);s.userData.h=h;s.userData.ar=canvas.width/canvas.height;if(top)s.renderOrder=10;return s;
}
function disposeSprite(s){if(!s)return;if(s.parent)s.parent.remove(s);s.material.map.dispose();s.material.dispose()}
function addSign(lines,x,y,z,h,stripe){const s=spriteFrom(textCanvas(lines,{stripe}),h);s.position.set(x,y,z);root.add(s);signs.push({s,lines,stripe,h});return s}

/* ---------- car + walker models ---------- */
function makeCar(paint){
  const g=new THREE.Group(),tilt=new THREE.Group();g.add(tilt);root.add(g);
  const face=S.carFace?pal("car"):paint,oc={car:true,paint};
  const rb=S.round?{t:.026,s:.022,n:4}:{t:.014,s:.012,n:S.lowpoly?1:3};
  const sh=new THREE.Shape();sh.moveTo(-.23,.045);sh.lineTo(.225,.045);sh.lineTo(.238,.068);sh.quadraticCurveTo(.235,.09,.2,.097);sh.lineTo(.06,.112);sh.lineTo(-.16,.118);sh.quadraticCurveTo(-.225,.12,-.235,.1);sh.lineTo(-.238,.06);sh.closePath();
  const body=new THREE.ExtrudeGeometry(sh,{depth:.2,bevelEnabled:true,bevelThickness:rb.t,bevelSize:rb.s,bevelSegments:rb.n,curveSegments:S.lowpoly?3:10});body.translate(0,0,-.1);body.rotateY(Math.PI/2);
  part(body,"car",0,0,0,tilt,Object.assign({color:face},oc));
  const cs=new THREE.Shape();cs.moveTo(.075,.105);cs.lineTo(.01,.158);cs.quadraticCurveTo(-.03,.166,-.09,.16);cs.lineTo(-.155,.112);cs.closePath();
  const cab=new THREE.ExtrudeGeometry(cs,{depth:.15,bevelEnabled:true,bevelThickness:.008,bevelSize:.007,bevelSegments:S.lowpoly?1:2,curveSegments:S.lowpoly?2:8});cab.translate(0,0,-.075);cab.rotateY(Math.PI/2);
  part(cab,"glass",0,0,0,tilt,oc);
  part(new THREE.BoxGeometry(.24,.01,.055),"tire",0,.172,.205,tilt,oc);
  [-.075,.075].forEach(x=>part(new THREE.BoxGeometry(.012,.05,.022),"tire",x,.145,.2,tilt,oc));
  const ex=rb.s-.012;
  [-.07,.07].forEach(x=>{part(new THREE.BoxGeometry(.045,.018,.006),"light",x,.074,-.252-ex,tilt,oc);part(new THREE.BoxGeometry(.05,.014,.006),"tail",x,.09,.253+ex,tilt,oc)});
  const wheels=[];
  [[-.128,-.145,1],[.128,-.145,1],[-.128,.14,0],[.128,.14,0]].forEach(([x,z,f])=>{
    const pv=new THREE.Group();pv.position.set(x,.055,z);tilt.add(pv);const sp=new THREE.Group();pv.add(sp);
    const tg=cyl(.055,.055,f?.042:.05,22);tg.rotateZ(Math.PI/2);part(tg,"tire",0,0,0,sp,oc);
    const rg=cyl(.033,.033,f?.044:.052,14);rg.rotateZ(Math.PI/2);part(rg,"rim",0,0,0,sp,oc);
    part(new THREE.BoxGeometry(.054,.062,.012),"tire",0,0,0,sp,oc);part(new THREE.BoxGeometry(.054,.012,.062),"tire",0,0,0,sp,oc);
    wheels.push({pv,sp,f});
  });
  const ap=new THREE.Group();ap.position.set(.08,.125,.17);tilt.add(ap);
  part(cyl(.003,.003,.14,6),"tire",0,.07,0,ap,oc);part(new THREE.SphereGeometry(.012,8,6),"car",0,.142,0,ap,Object.assign({color:face},oc));
  const cup=new THREE.Group();cup.position.set(0,.166,.0);tilt.add(cup);cup.visible=false;
  part(cyl(.03,.026,.075,12),"cup",0,.04,0,cup,oc);part(cyl(.032,.032,.012,12),"lid",0,.082,0,cup,oc);
  const flame=new THREE.Group();tilt.add(flame);flame.visible=false;
  const fmO=new THREE.MeshBasicMaterial({color:S.glow||S.depthOnly?bright(paint):"#FF9A3C",transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false}),fmI=new THREE.MeshBasicMaterial({color:"#FFF4C2",transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false});
  [-.05,.05].forEach(x=>{const o=new THREE.ConeGeometry(.024,.13,10);o.rotateX(Math.PI/2);const mo=new THREE.Mesh(o,fmO);mo.position.set(x,.075,.32);flame.add(mo);const i=new THREE.ConeGeometry(.012,.07,8);i.rotateX(Math.PI/2);const mi=new THREE.Mesh(i,fmI);mi.position.set(x,.075,.29);flame.add(mi)});
  let under=null,beam=null;
  if(S.glow){
    const pg=new THREE.PlaneGeometry(.38,.62);pg.rotateX(-Math.PI/2);const gm=new THREE.MeshBasicMaterial({map:RADIAL,color:bright(paint),transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false});glowMats.push(gm);under=new THREE.Mesh(pg,gm);under.position.y=.03;g.add(under);
    const bg=new THREE.ConeGeometry(.45,2.4,20,1,true);bg.rotateX(Math.PI/2);bg.translate(0,.07,-.25-1.2);beam=new THREE.Mesh(bg,new THREE.MeshBasicMaterial({color:"#E8FFFF",transparent:true,opacity:.07,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));tilt.add(beam);
  }
  if(S.blob){const pg=new THREE.PlaneGeometry(.38,.6);pg.rotateX(-Math.PI/2);under=new THREE.Mesh(pg,new THREE.MeshBasicMaterial({map:RADIAL,color:0x000000,transparent:true,opacity:.5,depthWrite:false}));under.position.y=.028;g.add(under)}
  return{g,tilt,wheels,ap,under,cup,flame,beam};
}
function makeWalker(paint){
  const g=new THREE.Group();root.add(g);
  const face=S.carFace?pal("chair"):paint,o={car:true,paint,color:face};
  part(cyl(.17,.22,1.0,14),"body",0,.62,0,g,o);part(new THREE.SphereGeometry(.15,14,10),"head",0,1.32,0,g,{car:true,paint});
  part(new THREE.BoxGeometry(.16,.05,.05),"light",0,1.34,-.13,g,{car:true,paint});
  return g;
}
function dropVis(o){if(!o)return;const g=o.g||o;if(g.parent)g.parent.remove(g);const gone=new Set();g.traverse(x=>{if(x.geometry)x.geometry.dispose();if(x.material&&x.material!==HULL&&x.material!==INVIS){if(x.material.map&&!SHARED.has(x.material.map))x.material.map.dispose();x.material.dispose();gone.add(x.material)}});if(gone.size){lineMats=lineMats.filter(m=>!gone.has(m));glowMats=glowMats.filter(m=>!gone.has(m))}}

/* ---------- fx: skids, smoke, sparks, markers ---------- */
const fx=new THREE.Group();scene.add(fx);
const SKN=1600,skPos=new Float32Array(SKN*12),skCol=new Float32Array(SKN*12),skIdx=[];for(let i=0;i<SKN;i++){const b=i*4;skIdx.push(b,b+1,b+2,b+2,b+1,b+3)}
const skGeo=new THREE.BufferGeometry();skGeo.setAttribute("position",new THREE.BufferAttribute(skPos,3));skGeo.setAttribute("color",new THREE.BufferAttribute(skCol,3));skGeo.setIndex(skIdx);
const skMat=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.35,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4,side:THREE.DoubleSide});
const skMesh=new THREE.Mesh(skGeo,skMat);skMesh.frustumCulled=false;skMesh.renderOrder=1;fx.add(skMesh);
let skHead=0,skDirty=false;const _c=new THREE.Color();
function skidSeg(ax,az,ay,bx_,bz,by,col){
  const dx=bx_-ax,dz=bz-az,l=Math.hypot(dx,dz)||1,px=-dz/l*.021,pz=dx/l*.021,o=skHead*12;
  skPos[o]=ax+px;skPos[o+1]=ay;skPos[o+2]=az+pz;skPos[o+3]=ax-px;skPos[o+4]=ay;skPos[o+5]=az-pz;skPos[o+6]=bx_+px;skPos[o+7]=by;skPos[o+8]=bz+pz;skPos[o+9]=bx_-px;skPos[o+10]=by;skPos[o+11]=bz-pz;
  _c.set(col);for(let k=0;k<12;k+=3){skCol[o+k]=_c.r;skCol[o+k+1]=_c.g;skCol[o+k+2]=_c.b}
  skHead=(skHead+1)%SKN;skDirty=true;
}
function clearSkids(){skPos.fill(0);skHead=0;skDirty=true}
function pool(n){const a=[];for(let i=0;i<n;i++){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:RADIAL,transparent:true,depthWrite:false,opacity:0}));s.visible=false;fx.add(s);a.push({s,life:0,max:1,vx:0,vy:0,vz:0,g0:0,g1:0})}return a}
const smoke=pool(48),sparks=pool(48);let smokeI=0,sparkI=0;
function puff(x,y,z,col){const p=smoke[smokeI=(smokeI+1)%smoke.length];p.life=p.max=.7+Math.random()*.3;p.s.position.set(x,y,z);p.vx=(Math.random()-.5)*.3;p.vy=.25+Math.random()*.2;p.vz=(Math.random()-.5)*.3;p.g0=.08;p.g1=.45;p.s.material.color.set(col);p.a=S.smoke[1];p.s.visible=true}
function spark(x,y,z,col,sp){const p=sparks[sparkI=(sparkI+1)%sparks.length];p.life=p.max=.25+Math.random()*.25;p.s.position.set(x,y,z);const a=Math.random()*Math.PI*2,v=(sp||2)*(.5+Math.random());p.vx=Math.cos(a)*v;p.vz=Math.sin(a)*v;p.vy=1+Math.random()*2;p.g0=p.g1=.05+Math.random()*.04;p.s.material.color.set(col);p.a=1;p.s.visible=true}
function fxFrame(dt){
  for(const p of smoke){if(!p.s.visible)continue;p.life-=dt;if(p.life<=0){p.s.visible=false;continue}const k=1-p.life/p.max;p.s.position.x+=p.vx*dt;p.s.position.y+=p.vy*dt;p.s.position.z+=p.vz*dt;const sc=lerp(p.g0,p.g1,k);p.s.scale.set(sc,sc,1);p.s.material.opacity=p.a*(1-k)}
  for(const p of sparks){if(!p.s.visible)continue;p.life-=dt;if(p.life<=0){p.s.visible=false;continue}p.vy-=9*dt;p.s.position.x+=p.vx*dt;p.s.position.y=Math.max(.01,p.s.position.y+p.vy*dt);p.s.position.z+=p.vz*dt;p.s.scale.set(p.g0,p.g0,1);p.s.material.opacity=p.life/p.max}
  if(skDirty){skGeo.attributes.position.needsUpdate=true;skGeo.attributes.color.needsUpdate=true;skDirty=false}
}
// destination beacon (route/pin) and objective marker (coffee run)
const beacon=new THREE.Group(),beamM=new THREE.MeshBasicMaterial({transparent:true,opacity:.35,side:THREE.DoubleSide,depthWrite:false}),ringM=new THREE.MeshBasicMaterial({side:THREE.DoubleSide,transparent:true,opacity:.95});
{const b=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,7,16,1,true),beamM);b.position.y=3.5;beacon.add(b);const r=new THREE.Mesh(new THREE.RingGeometry(.55,.75,32),ringM);r.rotation.x=-Math.PI/2;r.position.y=.02;beacon.add(r);beacon.userData.ring=r}
beacon.visible=false;fx.add(beacon);
const marker=new THREE.Group(),mBeamM=new THREE.MeshBasicMaterial({transparent:true,opacity:.4,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}),mRingM=new THREE.MeshBasicMaterial({side:THREE.DoubleSide,transparent:true,opacity:.95});
{const b=new THREE.Mesh(new THREE.CylinderGeometry(.5,.5,6,24,1,true),mBeamM);b.position.y=3;marker.add(b);const r=new THREE.Mesh(new THREE.RingGeometry(.62,.85,40),mRingM);r.rotation.x=-Math.PI/2;r.position.y=.02;marker.add(r);marker.userData.ring=r}
marker.visible=false;fx.add(marker);let markerTag=null;
// route chevrons (instanced flat arrows on the floor) + race gates (standing rings)
const CHEV_N=360;
const chevGeo=(()=>{const s=new THREE.Shape();s.moveTo(0,-.32);s.lineTo(.26,.06);s.lineTo(.13,.06);s.lineTo(0,-.12);s.lineTo(-.13,.06);s.lineTo(-.26,.06);s.closePath();const g=new THREE.ShapeGeometry(s);g.rotateX(-Math.PI/2);return g})();
// ShapeGeometry after rotateX(-90°): shape +y becomes world -z, so the arrow tip (shape y=-.32) points to +z; flip so it points forward (-z)
chevGeo.rotateY(Math.PI);
const chevMat=new THREE.MeshBasicMaterial({transparent:true,opacity:.9,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-6});
const chevMesh=new THREE.InstancedMesh(chevGeo,chevMat,CHEV_N);chevMesh.frustumCulled=false;chevMesh.count=0;chevMesh.renderOrder=2;fx.add(chevMesh);
const GATE_N=40,gateGeo=new THREE.TorusGeometry(1.15,.06,8,40),gateMat=new THREE.MeshBasicMaterial({transparent:true,opacity:.9});
const gateMesh=new THREE.InstancedMesh(gateGeo,gateMat,GATE_N);gateMesh.frustumCulled=false;gateMesh.count=0;fx.add(gateMesh);
const gateNext=new THREE.Mesh(new THREE.TorusGeometry(1.2,.11,10,48),new THREE.MeshBasicMaterial({transparent:true,opacity:1}));gateNext.visible=false;fx.add(gateNext);
// pads on the floor: elevator / exit / building door (rendered per world)
function fxRestyle(){
  const add=S.skid[2]?THREE.AdditiveBlending:THREE.NormalBlending;skMat.blending=add;skMat.opacity=S.skid[1];skMat.needsUpdate=true;
  smoke.forEach(p=>{p.s.material.blending=S.smoke[2]?THREE.AdditiveBlending:THREE.NormalBlending;p.s.material.needsUpdate=true});
  sparks.forEach(p=>{p.s.material.blending=THREE.AdditiveBlending;p.s.material.needsUpdate=true});
  beamM.color.set(S.acc);ringM.color.set(S.acc);mBeamM.color.set(S.acc);mRingM.color.set(S.acc);
  chevMat.color.set(S.acc);gateMat.color.set(S.acc);gateMat.opacity=.55;gateNext.material.color.set(S.acc);
  chevMat.blending=S.glow||S.depthOnly?THREE.AdditiveBlending:THREE.NormalBlending;chevMat.needsUpdate=true;
}
const tags=new THREE.Group();scene.add(tags);

/* ---------- audio ---------- */
let AC=null,master,engO1,engO2,engF,engG,sqG,noiseBuf,muted=store.get("rc-mute")==="1";
function audio(){
  if(AC){if(AC.state==="suspended")AC.resume().catch(()=>{});return AC}
  const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;
  try{AC=new C()}catch(_){return null}
  master=AC.createGain();master.gain.value=muted?0:.55;master.connect(AC.destination);
  engO1=AC.createOscillator();engO1.type="sawtooth";engO2=AC.createOscillator();engO2.type="square";
  const g2=AC.createGain();g2.gain.value=.3;engF=AC.createBiquadFilter();engF.type="lowpass";engF.Q.value=5;engF.frequency.value=600;
  engG=AC.createGain();engG.gain.value=0;engO1.connect(engF);engO2.connect(g2);g2.connect(engF);engF.connect(engG);engG.connect(master);engO1.frequency.value=60;engO2.frequency.value=120;engO1.start();engO2.start();
  noiseBuf=AC.createBuffer(1,AC.sampleRate,AC.sampleRate);const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  const ns=AC.createBufferSource();ns.buffer=noiseBuf;ns.loop=true;const sf=AC.createBiquadFilter();sf.type="bandpass";sf.frequency.value=2300;sf.Q.value=3;sqG=AC.createGain();sqG.gain.value=0;ns.connect(sf);sf.connect(sqG);sqG.connect(master);ns.start();
  return AC;
}
function tone(type,f0,f1,dur,vol,delay){if(!AC||muted)return;const t=AC.currentTime+(delay||0),o=AC.createOscillator(),g=AC.createGain();o.type=type;o.frequency.setValueAtTime(f0,t);if(f1)o.frequency.exponentialRampToValueAtTime(f1,t+dur);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(master);o.start(t);o.stop(t+dur+.05)}
function noise(dur,freq,vol,type){if(!AC||muted)return;const t=AC.currentTime,s=AC.createBufferSource();s.buffer=noiseBuf;const f=AC.createBiquadFilter();f.type=type||"lowpass";f.frequency.value=freq;const g=AC.createGain();g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);s.connect(f);f.connect(g);g.connect(master);s.start(t,Math.random()*.4);s.stop(t+dur+.05)}
const SFX={
  horn:v=>{v=v==null?1:v;tone("square",392,0,.15,.1*v);tone("square",494,0,.15,.08*v);tone("square",392,0,.22,.1*v,.19);tone("square",494,0,.22,.08*v,.19)},
  bump:s=>{const v=Math.min(1,s/6);noise(.12,900,.35*v);tone("sine",160,60,.14,.3*v)},
  land:s=>{const v=Math.min(1,s/5);tone("sine",110,45,.16,.35*v);noise(.08,500,.2*v)},
  chime:()=>[660,880,1320].forEach((f,i)=>tone("sine",f,0,.28,.12,i*.08)),
  beep:hi=>tone("square",hi?880:440,0,hi?.45:.14,.08),
  turbo:()=>{noise(.35,1800,.18,"bandpass");tone("sawtooth",300,900,.3,.05)},
  whoosh:()=>noise(1.3,500,.12,"bandpass"),
  fanfare:()=>[523,659,784,1047].forEach((f,i)=>tone("triangle",f,0,.35,.13,i*.11)),
  ding:()=>{tone("sine",1175,0,.9,.09);tone("sine",880,0,1.1,.07,.18)},
  doors:()=>noise(.6,300,.1,"lowpass"),
  gate:()=>tone("triangle",988,1480,.12,.08)
};
function setMuted(m){muted=m;store.set("rc-mute",m?"1":"0");if(master)master.gain.value=m?0:.55;$("bSound").setAttribute("aria-pressed",String(!m))}
document.addEventListener("visibilitychange",()=>{if(!AC)return;if(document.hidden)AC.suspend().catch(()=>{});else AC.resume().catch(()=>{})});
