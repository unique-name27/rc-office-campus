/* ===================== game part 1: core (utils, renderer, styles, materials, instancing, sprites, models, fx, audio) ===================== */
const $=id=>document.getElementById(id);
function fatal(msg){const f=$("fatal");f.hidden=false;f.querySelector("p").textContent=msg;["bar","start","side","panel","mapwrap","speedo","help"].forEach(id=>{const e=$(id);if(e)e.style.display="none"})}

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
// high-performance: on a laptop with two graphics chips, ask for the fast one (the browser may still choose)
try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"high-performance"})}catch(e){fatal("This browser can't show 3D graphics (WebGL), so the campus can't be shown here.");return}
renderer.setClearColor(0x000000,0);renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const stage=$("stage"),cv=renderer.domElement;stage.appendChild(cv);cv.tabIndex=-1;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,1,.03,900);
const DPR=Math.min(window.devicePixelRatio||1,TOUCH?1.75:2),SM=TOUCH?1024:2048;

/* ---------- textures ---------- */
// Studio (HD) is color-managed (sRGB textures, linear light); the other styles keep the classic unmanaged colors
let HDCS=false; // set per world build (S.hd)
const texCS=t=>{t.colorSpace=HDCS?THREE.SRGBColorSpace:THREE.NoColorSpace;return t};
function ctex(w,h,fn){const c=document.createElement("canvas");c.width=w;c.height=h;fn(c.getContext("2d"),w,h);const t=texCS(new THREE.CanvasTexture(c));t.wrapS=t.wrapT=THREE.RepeatWrapping;return t}
const SHARED=new Set();
const RADIAL=ctex(64,64,g=>{const r=g.createRadialGradient(32,32,0,32,32,32);r.addColorStop(0,"rgba(255,255,255,1)");r.addColorStop(1,"rgba(255,255,255,0)");g.fillStyle=r;g.fillRect(0,0,64,64)});SHARED.add(RADIAL);
const hazardImg=document.createElement("canvas");hazardImg.width=128;hazardImg.height=32;{const g=hazardImg.getContext("2d");g.fillStyle="#F2C14E";g.fillRect(0,0,128,32);g.fillStyle="#1E1F21";for(let x=-32;x<160;x+=32){g.beginPath();g.moveTo(x,32);g.lineTo(x+16,32);g.lineTo(x+48,0);g.lineTo(x+32,0);g.closePath();g.fill()}}
function hazardTex(rx){const t=texCS(new THREE.CanvasTexture(hazardImg));t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,1);return t}
let ks=7;const kr=()=>{ks=(ks*16807)%2147483647;return(ks-1)/2147483646};
const FLOORTEX={
  dots:(w,d)=>{const t=ctex(32,32,g=>{g.fillStyle="#FFE07A";g.fillRect(0,0,32,32);g.fillStyle="#F2B705";g.beginPath();g.arc(16,16,6,0,7);g.fill()});t.repeat.set(w/.3,d/.3);return t}
};
// per-role physically based finish for Studio: [roughness, metalness, clearcoat, env intensity]
const PBR={_:[.7,0,0,1],floor:[.38,0,0,.9],carpet:[.95,0,0,.35],desk:[.42,0,0,.8],top:[.42,0],table:[.42,0],bench:[.5,0],counter:[.3,0,0,1.1],reception:[.3,0,0,1.1],board:[.12,0,0,1.2],
  panel:[.85,0,0,.6],cabinet:[.55,.05],locker:[.5,.3],leg:[.3,.85],frame:[.3,.85],shelf:[.4,.7],metal:[.2,.95],rim:[.18,.95],elevdoor:[.2,.95],
  mon:[.3,.3],rack:[.45,.4],scope:[.4,.3],chamber:[.45,.2],probe:[.45,.3],printer:[.5,0],fridge:[.25,.45],machine:[.25,.6],
  chair:[.82,0,0,.5],sofa:[.9,0,0,.4],body:[.8,0],head:[.6,0],fur:[.92,0,0,.35],wall:[.9,0,0,.7],solid:[.85,0],bldg:[.6,0],slab:[.5,.1],roof:[.75,0],
  glass:[.05,.25,0,1.6],win:[.06,.1,0,1.4],glassRoom:[.04,.1,0,1.3],bwin:[.08,.35,0,1.7],booth:[.05,.1,0,1.3],cabin:[.08,.4,0,1.5],
  plant:[.7,0,0,.5],pot:[.45,0],trunk:[.9,0],ramp:[.5,0],rampSide:[.6,0],cup:[.25,0],lid:[.5,0],tire:[.85,0,0,.4],
  car:[.36,.12,1,.6],carbody:[.34,.25,1,.7],screen:[.2,0],post:[.35,.7],flag:[.8,0],
  shirt:[.88,0,0,.45],pants:[.9,0,0,.4],shoe:[.6,0,0,.6],figure:[.48,0,0,.8],eye:[.25,0,0,1],badge:[.45,0],hat:[.85,0,0,.45],mug:[.3,0,0,1]};
const GRAD=(()=>{const t=new THREE.DataTexture(new Uint8Array([135,135,135,255,200,200,200,255,255,255,255,255]),3,1,THREE.RGBAFormat);t.minFilter=t.magFilter=THREE.NearestFilter;t.generateMipmaps=false;t.needsUpdate=true;return t})();

/* ---------- the 5 styles ---------- */
const BASE={floor:"#D9D5CB",carpet:"#CFE0EE",desk:"#F7F5EF",panel:"#9AA09A",leg:"#6E736C",mon:"#23272B",screen:"#3d6fb0",chair:"#3E7CB1",car:"#E4572E",glass:"#16202a",tire:"#1E1F21",rim:"#C9CCD1",wall:"#F4F3EF",win:"#BFD3DE",plant:"#4F9D69",pot:"#E9E2D0",ramp:"#F2C14E",light:"#FFF6D8",tail:"#ff2a2a",cup:"#FFFFFF",lid:"#5A3A22"};
// roles used by v4 furniture/equipment/campus map onto the 21 base palette roles every style defines
const ALIAS={counter:"panel",top:"desk",table:"desk",frame:"leg",machine:"mon",glassRoom:"win",rampSide:"leg",body:"chair",head:"pot",
  bench:"desk",cabinet:"panel",shelf:"leg",rack:"mon",led:"screen",scope:"mon",chamber:"wall",probe:"panel",sofa:"chair",reception:"panel",
  fridge:"wall",printer:"wall",board:"desk",metal:"rim",booth:"win",locker:"panel",solid:"wall",roof:"panel",trunk:"pot",bldg:"wall",bwin:"win",slab:"panel",carbody:"car",cabin:"glass",fur:"car",post:"leg",flag:"ramp",stripe:"light",pad:"ramp",
  shirt:"chair",pants:"leg",shoe:"tire",figure:"pot",eye:"mon",badge:"ramp",hat:"chair",mug:"cup"};
const PAL=o=>Object.assign({},BASE,o);
const NEON_TEAM=["#3DA5FF","#B26BFF","#FFB547","#39FF9E","#FF2E97"],COMIC_TEAM=["#3B8BFF","#A35BFF","#FF9F1C","#2BD97C","#FF4FA0"];
const ST=[
{n:"Studio",d:"Real materials in soft daylight: polished concrete, birch desks, Kenney furniture, lab gear made in Blender, glossy cars, with soft shadows and ambient occlusion.",bg:"#DDE4EA",mat:"pbr",hd:true,light:"hd",shadows:true,round:true,roundR:.016,ao:true,tone:true,exposure:.72,vignette:true,ramp:"hazard",ui:"light",acc:"#E4572E",tc:.5,td:0,tcar:.32,fog:[60,190],skid:["#2a2a2a",.3,0],smoke:["#ffffff",.5,0],pal:PAL({floor:"#B9B3A9",carpet:"#A29E97",desk:"#D9C6A5",panel:"#AEB4AC",leg:"#3A3E44",mon:"#1C1E21",screen:"#6E9EF2",chair:"#4A525C",car:"#E4572E",glass:"#17222C",tire:"#1A1B1D",rim:"#CDD1D6",wall:"#E9E6E0",win:"#CFE3EC",plant:"#3D7B47",pot:"#E6E3DC",ramp:"#F2B33D",light:"#FFF3D6",counter:"#2B3833",cup:"#FFFFFF",lid:"#3A2A1E"})},
{n:"Neon night",d:"Lights off. A dark floor with a glowing grid, lit edges and screens, and car underglow.",bg:"#07071A",mat:"basic",light:"none",edges:{c:"#2DE2E6",o:.95},carEdge:true,carFace:true,teamEdges:true,teamPal:NEON_TEAM,edgeRole:{plant:"#7CFF6B",pot:"#7CFF6B",ramp:"#FFB547",rampSide:"#FFB547",win:"#5B4BFF",glassRoom:"#5B4BFF",bwin:"#5B4BFF",led:"#FF2E97",stripe:"#FFB547",pad:"#FFB547"},grid:{c:"#FF2E97",o:.45},glow:true,ui:"dark",acc:"#FFB547",tc:0,td:0,tcar:0,fog:[18,90],skid:["paint",.85,1],smoke:["paint",.4,1],pal:PAL({floor:"#0B0A20",carpet:"#0E0C26",desk:"#100E2A",panel:"#100E2A",leg:"#100E2A",mon:"#100E2A",screen:"#2DE2E6",chair:"#100E2A",car:"#140B2A",glass:"#0b0820",tire:"#07071A",rim:"#140B2A",wall:"#0B0A20",win:"#120d3a",plant:"#0B0A20",pot:"#0B0A20",ramp:"#120d30",light:"#E8FFFF",tail:"#FF2E97",cup:"#E8FFFF",lid:"#100E2A"})},
{n:"Blueprint",d:"A white technical drawing on drafting blue, with each car picked out in its own color.",bg:"#123A6B",mat:"basic",faceIsBg:true,light:"none",edges:{c:"#E8F1FF",o:.9},carEdge:true,grid:{c:"#E8F1FF",o:.13},ui:"dark",label:{bg:"rgba(18,58,107,.94)",fg:"#E8F1FF",sub:"#A9C6EE"},acc:"#FFB547",fog:null,skid:["#E8F1FF",.3,0],smoke:["#E8F1FF",.3,0],pal:PAL({})},
{n:"Comic cel-shade",d:"Flat bold colors, thick ink outlines and halftone dots on the floor.",bg:"#FFF1C9",mat:"toon",light:"cel",outline:"#111111",floorTex:"dots",ramp:"hazard",ui:"light",acc:"#FF3B3B",tc:1,td:0,tcar:.55,teamPal:COMIC_TEAM,fog:null,skid:["#111111",.5,0],smoke:["#ffffff",.85,0],pal:PAL({floor:"#FFFFFF",carpet:"#7FD1FF",desk:"#FFFFFF",panel:"#FF7A3D",leg:"#2B2B2B",mon:"#2B2B2B",screen:"#5CC8FF",chair:"#FF3B3B",car:"#FF3B3B",glass:"#1A1A1A",tire:"#1A1A1A",rim:"#FFE14D",wall:"#FFFDF5",win:"#9FE0FF",plant:"#3FC35A",pot:"#FF9F1C",ramp:"#FFFFFF",counter:"#3FA7D6"})},
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
  if(S.hd)return HD.mat(role,co,glassy);
  const off=(S.faceIsBg||S.edges)?{polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}:{};
  if(role==="light"||role==="tail"||role==="led"||role==="stripe")return new THREE.MeshBasicMaterial(Object.assign({color:S.faceIsBg?S.bg:(co||pal(role)),toneMapped:false},off)); // self-lit: never dimmed by tone mapping
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
// instanced pieces are scaled per instance, so rounded edges would stretch (and cost ~26x the triangles): keep them square in Studio
function ibx(w,h,d){return S.hd?new THREE.BoxGeometry(w,h,d):bx(w,h,d)}
function bx(w,h,d){
  if(!S.round)return new THREE.BoxGeometry(w,h,d);
  const r=Math.min(S.roundR||.035,w*.3,h*.3,d*.3),iw=Math.max(.002,w-2*r),ih=Math.max(.002,h-2*r),id=Math.max(.002,d-2*r);
  const g=new THREE.ExtrudeGeometry(rr(iw,ih,S.roundR?Math.min(r,Math.min(iw,ih)*.25):Math.min(iw,ih)*.25),{depth:id,bevelEnabled:true,bevelThickness:r,bevelSize:r,bevelSegments:3,curveSegments:4});g.translate(0,0,-id/2);return g;
}
const seg=n=>S.lowpoly?Math.max(5,Math.round(n/3)):n;
function cyl(rt,rb,h,n){
  return new THREE.CylinderGeometry(rt,rb,h,seg(n||18));
}

/* instanced groups: faces + optional outline hulls + optional baked edge lines, all moved together.
   count may be 0 (an empty group whose methods do nothing). */
const NOOP_G={set(){},paint(){},edge(){},commit(){},mesh:null,count:0};
function IG(geo,role,count,o){
  o=o||{};if(!count){geo.dispose();return NOOP_G}
  const g={count};
  const m=new THREE.InstancedMesh(geo,o.mat||mat(role,o.color),count);m.frustumCulled=false;root.add(m);g.mesh=m;
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
    if(g.hi>=g.lo){const full=g.lo===0&&g.hi===count-1,rng=(a,sz)=>{a.clearUpdateRanges();if(!full)a.addUpdateRange(g.lo*sz,(g.hi-g.lo+1)*sz);a.needsUpdate=true};rng(m.instanceMatrix,16);if(g.hull)rng(g.hull.instanceMatrix,16);if(g.lines)rng(g.lines.geometry.attributes.position,g.eb.length);g.lo=1e9;g.hi=-1}
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
  const tex=texCS(new THREE.CanvasTexture(canvas));tex.minFilter=THREE.LinearFilter;
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:!top,transparent:true,fog:false,toneMapped:false}));
  s.scale.set(h*canvas.width/canvas.height,h,1);s.userData.h=h;s.userData.ar=canvas.width/canvas.height;if(top)s.renderOrder=10;return s;
}
function disposeSprite(s){if(!s)return;if(s.parent)s.parent.remove(s);s.material.map.dispose();s.material.dispose()}
function addSign(lines,x,y,z,h,stripe){const s=spriteFrom(textCanvas(lines,{stripe}),h);s.position.set(x,y,z);root.add(s);signs.push({s,lines,stripe,h});return s}

/* ---------- car + walker models ---------- */
// the RC car, dog and cat are in game-1b-avatars.js (modeled in Blender)
function makeWalker(paint){
  const g=new THREE.Group();root.add(g);
  const face=S.carFace?pal("chair"):paint,o={car:true,paint,color:face};
  part(cyl(.17,.22,1.0,14),"body",0,.62,0,g,o);part(new THREE.SphereGeometry(.15,14,10),"head",0,1.32,0,g,{car:true,paint});
  part(new THREE.BoxGeometry(.16,.05,.05),"light",0,1.34,-.13,g,{car:true,paint});
  return g;
}
function dropVis(o){if(!o)return;const g=o.g||o;if(g.parent)g.parent.remove(g);const gone=new Set();g.traverse(x=>{if(x.geometry&&!x.geometry.userData.keep)x.geometry.dispose();if(x.material&&x.material!==HULL&&x.material!==INVIS){if(x.material.map&&!SHARED.has(x.material.map))x.material.map.dispose();x.material.dispose();gone.add(x.material)}});if(gone.size){lineMats=lineMats.filter(m=>!gone.has(m));glowMats=glowMats.filter(m=>!gone.has(m))}}

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
function puff(x,y,z,col){const p=smoke[smokeI=(smokeI+1)%smoke.length];p.life=p.max=.7+Math.random()*.3;p.s.position.set(x,y,z);p.vx=(Math.random()-.5)*.3;p.vy=.25+Math.random()*.2;p.vz=(Math.random()-.5)*.3;p.g0=.08;p.g1=.45;p.s.material.color.set(col);p.a=S.smoke[1];p.s.visible=true;return p}
// a ring of puffs pushed outward along the floor (a woof, a double jump)
function ringPuff(x,y,z,n,col,sp){const a0=Math.random()*Math.PI*2;for(let i=0;i<n;i++){const a=a0+i*Math.PI*2/n,p=puff(x,y,z,col);p.vx=Math.cos(a)*sp;p.vz=Math.sin(a)*sp;p.vy=.12;p.life=p.max=.45+Math.random()*.15;p.g0=.06;p.g1=.3}}
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
// route arrows, gates, beacons and particles are signals, not scenery: keep them out of Studio's tone mapping
[beamM,ringM,mBeamM,mRingM,chevMat,gateMat,gateNext.material,skMat].forEach(m=>m.toneMapped=false);
function fxRestyle(){
  smoke.concat(sparks).forEach(p=>p.s.material.toneMapped=false);
  const add=S.skid[2]?THREE.AdditiveBlending:THREE.NormalBlending;skMat.blending=add;skMat.opacity=S.skid[1];skMat.needsUpdate=true;
  smoke.forEach(p=>{p.s.material.blending=S.smoke[2]?THREE.AdditiveBlending:THREE.NormalBlending;p.s.material.needsUpdate=true});
  sparks.forEach(p=>{p.s.material.blending=THREE.AdditiveBlending;p.s.material.needsUpdate=true});
  beamM.color.set(S.acc);ringM.color.set(S.acc);mBeamM.color.set(S.acc);mRingM.color.set(S.acc);
  chevMat.color.set(S.acc);gateMat.color.set(S.acc);gateMat.opacity=.55;gateNext.material.color.set(S.acc);
  chevMat.blending=S.glow||S.depthOnly?THREE.AdditiveBlending:THREE.NormalBlending;chevMat.needsUpdate=true;
}
const tags=new THREE.Group();scene.add(tags);

/* ---------- audio: a small synth (no samples) behind a soft master chain ---------- */
// everything plays into `bus` -> gentle low-pass (no fizz) -> compressor (overlapping sounds never clip) -> volume.
// A short, filtered echo adds a little room so sounds don't feel dry and clicky.
let AC=null,master,bus,noiseBuf,brownBuf,muted=store.get("rc-mute")==="1";
const VOL=.9;
let motor=null; // the RC car's continuous sounds: motor, gear whine, tyre roll, slide
function audio(){
  if(AC){if(AC.state==="suspended")AC.resume().catch(()=>{});return AC}
  const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;
  try{AC=new C()}catch(_){return null}
  master=AC.createGain();master.gain.value=muted?0:VOL;master.connect(AC.destination);
  const comp=AC.createDynamicsCompressor();comp.threshold.value=-22;comp.knee.value=20;comp.ratio.value=3.5;comp.attack.value=.004;comp.release.value=.22;comp.connect(master);
  const tame=AC.createBiquadFilter();tame.type="lowpass";tame.frequency.value=7000;tame.Q.value=.5;tame.connect(comp);
  bus=AC.createGain();bus.gain.value=1;bus.connect(tame);
  const dl=AC.createDelay(.5),fb=AC.createGain(),wet=AC.createGain(),dlf=AC.createBiquadFilter();
  dl.delayTime.value=.09;fb.gain.value=.24;wet.gain.value=.14;dlf.type="lowpass";dlf.frequency.value=2000;
  bus.connect(dl);dl.connect(dlf);dlf.connect(fb);fb.connect(dl);dlf.connect(wet);wet.connect(comp);
  // white noise for clicks and air, brown noise (deep, soft) for rumble
  const n=AC.sampleRate*2;noiseBuf=AC.createBuffer(1,n,AC.sampleRate);brownBuf=AC.createBuffer(1,n,AC.sampleRate);
  const wd=noiseBuf.getChannelData(0),bd=brownBuf.getChannelData(0);let b=0;
  for(let i=0;i<n;i++){const w=Math.random()*2-1;wd[i]=w;b=(b+.02*w)/1.02;bd[i]=b*3.5}
  // RC car: a triangle motor tone with a sine an octave down, a faint gear whine, tyre roll and a slide hiss
  const mk=(type,f)=>{const o=AC.createOscillator();o.type=type;o.frequency.value=f;o.start();return o};
  const gain=(v,to)=>{const g=AC.createGain();g.gain.value=v;if(to)g.connect(to);return g};
  const filt=(type,f,q,to)=>{const x=AC.createBiquadFilter();x.type=type;x.frequency.value=f;x.Q.value=q;if(to)x.connect(to);return x};
  const loop=(buf,to)=>{const s=AC.createBufferSource();s.buffer=buf;s.loop=true;s.connect(to);s.start(0,Math.random()*1.5);return s};
  const mG=gain(0,bus),mF=filt("lowpass",900,.7,mG),o1=mk("triangle",120),o2=mk("sine",60);o1.connect(mF);o2.connect(gain(.7,mF));
  const wG=gain(0,bus),wF=filt("bandpass",900,6,wG),o3=mk("sine",360);o3.connect(wF);
  const rG=gain(0,bus),rF=filt("lowpass",220,.6,rG);loop(brownBuf,rF);
  const sG=gain(0,bus),sF=filt("bandpass",1400,1.1,sG);loop(noiseBuf,sF);
  motor={o1,o2,o3,mG,mF,wG,wF,rG,rF,sG,sF};
  // real recordings (src/assets/sounds): decoded once; until they are ready, or where MP3 can't be decoded, the synth plays
  const data=typeof SOUND_DATA!=="undefined"?SOUND_DATA:{};
  for(const k in data){try{const b=atob(data[k]),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);
    AC.decodeAudioData(u.buffer).then(buf=>{SND[k]=buf;startEngine()}).catch(()=>{})}catch(_){}}
  return AC;
}
const SND={};
/* ---------- the car: a real engine, tyre screech and wall grind (audioFrame drives them) ---------- */
// The engine is a real recording: a 1985 Ford Escort (CC0, src/tools/make_engine_loops.py), cut into an idle loop and a
// pulling-under-throttle loop. Each file is [60 ms wrap-around][the loop][60 ms wrap-around], so the game loops from
// 60 ms to 60 ms + n samples and any shift the MP3 decoder adds can't open a seam. `hz` is each loop's firing frequency.
// The game runs the engine like a car's: a firing frequency from the road speed through six gears, rising through each
// gear and dropping back on every upshift; under 80 Hz the idle loop takes over. Lifting off quietens it and dulls it.
// Screech, crash and grind are "FREE CAR SFX" by LMGLolo (CC BY-ND 4.0), unedited (src/tools/make_car_sounds.py).
const ENGINE_LOOPS={"car-engine-idle":{n:110047,hz:51.5},"car-engine-load":{n:110152,hz:115.6}},LOOP_PAD=2646/44100;
const CAR_N={"car-grind":529200}; // LMGLolo's "(Loop)" file: loops end to end
const GEAR_V=[0,2.4,3.6,5,6.9,9.6,14];     // gear g runs from GEAR_V[g-1] to GEAR_V[g] m/s (the car tops out at 7.2 in 5th, boost 11.5 in 6th)
const F_IDLE=52,F_TOP=158;                 // firing frequency (Hz): idling, and where it shifts up (it drops to 105-115 Hz)
let eng=null,crashAt=0;
function startEngine(){
  if(eng||!AC||!bus||!SND["car-engine-idle"]||!SND["car-engine-load"]||!SND["car-grind"])return;
  const out=AC.createBiquadFilter();out.type="lowpass";out.frequency.value=3000;out.Q.value=.5;out.connect(bus); // the engine's tone
  const loop=(k,to)=>{const b=SND[k],E=ENGINE_LOOPS[k],s=AC.createBufferSource();let a,L;
    if(E){a=LOOP_PAD;L=E.n/44100}else{L=CAR_N[k]/44100;a=b.duration-L>.004?1105/44100:0} // 1105: LAME's encoder delay, where a decoder keeps it
    s.buffer=b;s.loop=true;s.loopStart=a;s.loopEnd=Math.min(b.duration,a+L);
    const g=AC.createGain();g.gain.value=0;s.connect(g);g.connect(to);s.start(0,a+Math.random()*L);return{s,g}};
  eng={idle:loop("car-engine-idle",out),load:loop("car-engine-load",out),out,grind:loop("car-grind",bus),scr:null,scrT:0,gear:1,vs:0,rev:0,air:0,dip:0,f:F_IDLE,on:0};
}
// let a playing sound fade out and stop
function fadeStop(o,t,tau){try{o.g.gain.setTargetAtTime(0,t,tau);o.s.stop(t+tau*7)}catch(_){}}
function engineFrame(dt,t,car,sp,thr,air,boost,slide,lat,rub){
  const E=eng,gas=Math.max(0,thr);
  // what the engine "feels": the road speed, able to climb only so fast (the RC car reaches top speed in well under a
  // second and would rattle through the gears) and to fall a little faster
  E.vs+=clamp(sp-E.vs,-9*dt,(boost?4.5:3.2)*dt);
  let g=E.gear;while(g<6&&E.vs>GEAR_V[g])g++;while(g>1&&E.vs<GEAR_V[g-1]*.88)g--;
  if(g>E.gear&&car)E.dip=.11; // the clutch: a short dip in level as it shifts up
  E.gear=g;
  E.rev=sp<.3&&gas>.1?Math.min(1,E.rev+dt/1.1):Math.max(0,E.rev-dt/.5); // throttle held standing still: it revs up
  E.air+=((air?1:0)-E.air)*Math.min(1,dt*(air?5:9));E.dip=Math.max(0,E.dip-dt);
  E.on+=((gas>.1?1:0)-E.on)*Math.min(1,dt*8);
  // firing frequency: first gear slips the clutch from idle; above it, the engine turns with the wheels
  let f=g===1?F_IDLE+(F_TOP-F_IDLE)*clamp(E.vs/GEAR_V[1],0,1):F_TOP*E.vs/GEAR_V[g];
  f=Math.max(f,F_IDLE+E.rev*95)+E.air*28*E.on;f=clamp(f,F_IDLE*.97,182);
  const drop=f<E.f-8;E.f=f; // a shift (or a landing) drops it fast; otherwise it glides
  const k=clamp((f-62)/(82-62),0,1); // idle loop below about 62 Hz, the pulling loop above about 82
  let vol=car?lerp(.075,.045+.025*E.on+.00015*(f-80),k)*(1-.4*(1-E.on)*k):0;if(E.dip>0)vol*=.55; // the loops are normalized: these set the mix
  const tau=drop?.025:.045;
  E.idle.s.playbackRate.setTargetAtTime(f/ENGINE_LOOPS["car-engine-idle"].hz,t,tau);E.load.s.playbackRate.setTargetAtTime(f/ENGINE_LOOPS["car-engine-load"].hz,t,tau);
  E.idle.g.gain.setTargetAtTime(vol*Math.sqrt(1-k),t,.05);E.load.g.gain.setTargetAtTime(vol*Math.sqrt(k),t,.05);
  E.out.frequency.setTargetAtTime(1300+2600*E.on+12*(f-52),t,.08); // lifting off dulls it
  // tyres: a screech while sliding or braking hard. The pack has four one-shot screeches (about 2 s each): a slide starts
  // one from the top, and while it lasts a fresh one (joined past its attack) takes over every second or so, so it never
  // runs into a screech's own fade. When the slide ends the last one fades out.
  const sk=car&&slide&&sp>1.2?Math.min(.1,.035+Math.abs(lat)*.016+(sp>6?.015:0)):0,sr=.95+Math.min(sp,11)*.01;
  if(sk>0){
    E.scrT-=dt;
    if(!E.scr||E.scrT<=0){const b=SND[pick("car-screech-",4)];if(b){const first=!E.scr,s=AC.createBufferSource(),g=AC.createGain();
      s.buffer=b;s.playbackRate.value=sr;g.gain.value=0;s.connect(g);g.connect(bus);g.gain.setTargetAtTime(sk,t,first?.015:.06);s.start(t,first?0:.3+Math.random()*.15);
      if(E.scr)fadeStop(E.scr,t,.09);E.scr={s,g};E.scrT=first?1.15:.9}}
    else{E.scr.g.gain.setTargetAtTime(sk,t,.06);E.scr.s.playbackRate.setTargetAtTime(sr,t,.1)}
  }else if(E.scr){fadeStop(E.scr,t,.07);E.scr=null;E.scrT=0}
  // a metal grind while scraping along a wall
  const gr=car&&rub&&sp>.7?Math.min(.17,.05+sp*.017):0;
  E.grind.g.gain.setTargetAtTime(gr,t,gr?.03:.08);if(gr)E.grind.s.playbackRate.setTargetAtTime(.85+Math.min(sp,10)*.03,t,.1);
}
// play a recording; false when it isn't loaded (the caller falls back to the synth)
function playSnd(k,vol,rate,at){if(!live()||!SND[k])return false;const s=AC.createBufferSource();s.buffer=SND[k];if(rate)s.playbackRate.value=rate;const g=AC.createGain();g.gain.value=vol;s.connect(g);g.connect(bus);s.start(AC.currentTime+(at||0));return true}
const pick=(base,n)=>base+(1+Math.floor(Math.random()*n));
const live=()=>AC&&!muted&&bus;
// one shaped note: oscillator -> optional filter -> envelope (soft attack, exponential tail)
function note(o){
  if(!live())return;const t=AC.currentTime+(o.at||0),dur=o.dur||.2,v=o.vol||.08;
  const osc=AC.createOscillator(),g=AC.createGain();osc.type=o.type||"sine";
  osc.frequency.setValueAtTime(o.f,t);if(o.to)osc.frequency.exponentialRampToValueAtTime(o.to,t+(o.glide||dur));
  if(o.vib){const l=AC.createOscillator(),lg=AC.createGain();l.frequency.value=o.vib[0];lg.gain.value=o.vib[1];l.connect(lg);lg.connect(osc.frequency);l.start(t);l.stop(t+dur+.1)}
  let tail=osc;if(o.lp){const f=AC.createBiquadFilter();f.type=o.bp?"bandpass":"lowpass";f.frequency.value=o.lp;f.Q.value=o.q||.7;osc.connect(f);tail=f}
  tail.connect(g);g.connect(bus);
  const a=o.atk||.008;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+a);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  osc.start(t);osc.stop(t+dur+.05);
}
// a burst of filtered noise (optionally sweeping its filter)
function hiss(o){
  if(!live())return;const t=AC.currentTime+(o.at||0),dur=o.dur||.1,v=o.vol||.05;
  const s=AC.createBufferSource();s.buffer=o.brown?brownBuf:noiseBuf;const f=AC.createBiquadFilter(),g=AC.createGain();
  f.type=o.type||"lowpass";f.frequency.setValueAtTime(o.f||800,t);if(o.to)f.frequency.exponentialRampToValueAtTime(o.to,t+dur);f.Q.value=o.q||.8;
  s.connect(f);f.connect(g);g.connect(bus);const a=o.atk||.004;
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+a);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  s.start(t,Math.random()*1.2);s.stop(t+dur+.05);
}
const bell=(f,at,vol,dur)=>{note({f,at,vol,dur:dur||.7,atk:.004});note({f:f*2.01,at,vol:(vol||.08)*.25,dur:(dur||.7)*.6,atk:.004})};
const SFX={
  // a friendly two-note toy-car "meep meep"
  horn:v=>{v=v==null?1:v;if(playSnd("car-horn",.2*v))return;[0,.17].forEach(at=>{note({type:"sawtooth",f:640,to:610,dur:.14,vol:.07*v,lp:1500,at,atk:.012});note({f:320,dur:.14,vol:.05*v,at,atk:.012})})},
  bump:s=>{const v=Math.min(1,s/6);note({f:130,to:55,dur:.14,vol:.17*v});hiss({f:320,dur:.05,vol:.07*v,brown:true})},
  land:s=>{const v=Math.min(1,s/5);note({f:95,to:48,dur:.18,vol:.18*v});hiss({f:260,dur:.07,vol:.06*v,brown:true})},
  // the car slamming into something at s m/s (3 and up): a recorded crash, never more than one every .35 s
  crash:s=>{if(!AC||AC.currentTime<crashAt)return;crashAt=AC.currentTime+.35;playSnd(pick("car-crash-",4),clamp((s-2.4)/5,.25,1)*.3,.94+Math.random()*.12)},
  chime:()=>{bell(880,0,.06);bell(1318.5,.07,.05);bell(1760,.14,.04,.9)},
  beep:hi=>hi?(note({f:988,dur:.4,vol:.07,atk:.006}),note({f:1480,dur:.32,vol:.035,atk:.006})):note({f:660,dur:.14,vol:.06,atk:.006}),
  // drift turbo: a whoosh up through a band-pass and a rising tone; the big (tier 2) one sweeps higher and longer
  turbo:(lvl,v)=>{v=v==null?1:v;const big=lvl===2;hiss({type:"bandpass",f:500,to:big?3400:2600,dur:big?.5:.35,vol:(big?.13:.11)*v,q:1.2});note({type:"triangle",f:300,to:big?820:620,dur:big?.42:.3,vol:.035*v,lp:1800})},
  // the drift has earned a turbo: a short ping
  tier:()=>note({f:880,dur:.06,vol:.05,atk:.004}),
  // the dog's big woof: a deep thump and a breath of air under the bark
  woof:v=>{v=v==null?1:v;note({f:90,to:45,dur:.28,vol:.16*v});hiss({f:420,to:160,dur:.3,vol:.06*v,brown:true,atk:.01})},
  // the cat's second jump: a quick upward chirp and a tiny bell
  jump2:v=>{v=v==null?1:v;note({f:900,to:1700,dur:.13,vol:.05*v,glide:.11});bell(2637,.05,.018*v,.35)},
  whoosh:()=>hiss({type:"bandpass",f:280,to:900,dur:1.1,vol:.08,q:.9,atk:.25}),
  fanfare:()=>{[[523.25,0],[659.25,.11],[783.99,.22],[1046.5,.33]].forEach(([f,at],i)=>{note({type:"triangle",f,at,vol:.06,dur:i===3?.75:.3,lp:2600});note({f:f*2,at,vol:.018,dur:i===3?.6:.25})})},
  ding:()=>{bell(1174.66,0,.06,1.1);bell(880,.2,.06,1.4)},
  doors:()=>{hiss({f:420,to:200,dur:.55,vol:.045,brown:true,atk:.08});note({f:70,dur:.12,vol:.08,at:.5})},
  gate:()=>{note({f:988,to:1480,dur:.1,vol:.07,glide:.08});note({f:1480,dur:.2,vol:.05,at:.07})},
  jump:k=>k==="cat"?note({f:620,to:1150,dur:.12,vol:.045,glide:.1}):k==="dog"?note({type:"triangle",f:330,to:640,dur:.13,vol:.05,lp:2000}):note({f:250,to:560,dur:.16,vol:.05}),
  // bark: a pitch-dropping voiced tone through a mouth-like band-pass, with a breathy burst on the attack; usually two
  bark:v=>{v=v==null?1:v;const a=pick("dog-bark-",3);if(playSnd(a,.28*v)){let b=pick("dog-bark-",3);if(b===a)b=pick("dog-bark-",3);playSnd(b,.22*v,1,.26);return}[0,.2].forEach((at,i)=>{const s=i?.85:1;note({type:"sawtooth",f:420,to:190,glide:.12,dur:.15,vol:.11*v*s,lp:750,bp:true,q:2.2,at,atk:.006});note({type:"triangle",f:210,to:110,glide:.12,dur:.13,vol:.07*v*s,at,atk:.006});hiss({type:"bandpass",f:1100,dur:.06,vol:.06*v*s,q:1.5,at})})},
  // meow: rising then falling pitch with a little vibrato through two vowel-like formants
  meow:v=>{v=v==null?1:v;if(playSnd(pick("cat-meow-",3),.34*v,.97+Math.random()*.08))return;[[950,.15],[2300,.06]].forEach(([fm,g])=>{if(!live())return;const t=AC.currentTime,o=AC.createOscillator(),f=AC.createBiquadFilter(),e=AC.createGain(),l=AC.createOscillator(),lg=AC.createGain();
    o.type="sawtooth";o.frequency.setValueAtTime(480,t);o.frequency.linearRampToValueAtTime(820,t+.2);o.frequency.linearRampToValueAtTime(520,t+.55);
    l.frequency.value=6.5;lg.gain.value=12;l.connect(lg);lg.connect(o.frequency);
    f.type="bandpass";f.frequency.setValueAtTime(fm*.85,t);f.frequency.linearRampToValueAtTime(fm,t+.2);f.frequency.linearRampToValueAtTime(fm*.7,t+.55);f.Q.value=3;
    o.connect(f);f.connect(e);e.connect(bus);e.gain.setValueAtTime(0,t);e.gain.linearRampToValueAtTime(g*v,t+.06);e.gain.linearRampToValueAtTime(g*v*.7,t+.38);e.gain.exponentialRampToValueAtTime(.0001,t+.62);
    o.start(t);l.start(t);o.stop(t+.66);l.stop(t+.66)})},
  // soft paw steps: a dull tap for dogs, a lighter one for cats
  step:k=>hiss({type:"bandpass",f:k==="cat"?2200:1400,dur:.035,vol:k==="cat"?.012:.02,q:1.3})
};
function setMuted(m){muted=m;store.set("rc-mute",m?"1":"0");if(master)master.gain.setTargetAtTime(m?0:VOL,AC.currentTime,.02);$("bSound").setAttribute("aria-pressed",String(!m))}
document.addEventListener("visibilitychange",()=>{if(!AC)return;if(document.hidden)AC.suspend().catch(()=>{});else AC.resume().catch(()=>{})});
