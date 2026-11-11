/* ===================== game part 2c: Studio in HD ===================== */
// The Studio style draws with three.js r165's physically based pipeline: image-based light (RoomEnvironment), soft
// shadows, ambient occlusion (GTAO), bloom on true emissives only, MSAA and neutral tone mapping, with Kenney furniture
// (CC0, www.kenney.nl) and lab props made in Blender (src/blender/props.py). Quality levels keep it smooth on laptops:
// Auto times the GPU and steps down (or back up). The other four styles keep their own simpler pipeline.
// The floor pieces here grew out of the HD test floor (prototypes/hd-floor).
const HD=(()=>{
const keep=m=>{m.userData.keep=true;return m},shared=t=>{SHARED.add(t);return t};

/* ---------- procedural textures (no image downloads) ---------- */
function canvasTex(w, h, draw, repeat, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (repeat) t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
}
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 };
const noiseInto = (g, w, h, base, amp, n, sizeMax) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = (rnd() - .5) * amp, a = Math.abs(v); g.fillStyle = v > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; const s = 1 + rnd() * sizeMax; g.fillRect(rnd() * w, rnd() * h, s, s) } };
// polished concrete: soft mottling + fine grit + faint saw cuts every 3 m
function concreteTex(w, d) {
  return canvasTex(512, 512, (g, W, H) => {
    noiseInto(g, W, H, '#CFCBC4', .05, 9000, 2);
    for (let i = 0; i < 70; i++) { const r = 30 + rnd() * 90, x = rnd() * W, y = rnd() * H, gr = g.createRadialGradient(x, y, 0, x, y, r); const dark = rnd() < .5; gr.addColorStop(0, dark ? 'rgba(80,72,60,.06)' : 'rgba(255,255,255,.07)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r) }
    g.fillStyle = 'rgba(60,55,50,.18)'; g.fillRect(0, 0, W, 1.5); g.fillRect(0, 0, 1.5, H);
  }, [w / 3, d / 3]);
}
const carpetTex = canvasTex(256, 256, (g, W, H) => { noiseInto(g, W, H, '#FFFFFF', .09, 26000, 1.4); for (let y = 0; y < H; y += 4) { g.fillStyle = 'rgba(0,0,0,.015)'; g.fillRect(0, y, W, 1) } }, [1, 1]);
// lobby terrazzo: pale base with stone and a few copper chips
const terrazzoTex = canvasTex(512, 512, (g, W, H) => { g.fillStyle = '#DCD8D1'; g.fillRect(0, 0, W, H); const cols = ['#B9B4AC', '#8D8A86', '#F3F1EC', '#A9A49C']; for (let i = 0; i < 5200; i++) { g.fillStyle = rnd() < .03 ? '#B87333' : cols[Math.floor(rnd() * cols.length)]; const r = 1 + rnd() * 2.6; g.beginPath(); g.ellipse(rnd() * W, rnd() * H, r, r * (.6 + rnd() * .5), rnd() * 3, 0, 7); g.fill() } }, [1, 1]);
// what the screens show: a document, code, a chip layout; scopes show waveforms
const screenTex = kind => canvasTex(256, 160, (g, W, H) => {
  if (kind === 'doc') { g.fillStyle = '#E9EEF3'; g.fillRect(0, 0, W, H); g.fillStyle = '#C8D0D8'; g.fillRect(0, 0, W, 14); for (let y = 26; y < H - 8; y += 9) { g.fillStyle = '#9AA3AD'; g.fillRect(14, y, 40 + rnd() * 180, 4) } }
  else if (kind === 'code') { g.fillStyle = '#1B2230'; g.fillRect(0, 0, W, H); const cs = ['#7FB3FF', '#B5D98A', '#F2C14E', '#C9A0F0', '#8C96A3']; for (let y = 10; y < H - 6; y += 8) { let x = 12 + Math.floor(rnd() * 4) * 10; for (let k = 0; k < 1 + rnd() * 4; k++) { const w = 10 + rnd() * 40; g.fillStyle = cs[Math.floor(rnd() * cs.length)]; g.fillRect(x, y, w, 3); x += w + 6 } } }
  else if (kind === 'chip') { g.fillStyle = '#0D1014'; g.fillRect(0, 0, W, H); const cs = ['rgba(232,72,72,.32)', 'rgba(72,200,120,.3)', 'rgba(80,140,255,.34)', 'rgba(240,200,60,.28)']; for (let i = 0; i < 34; i++) { g.fillStyle = cs[i % 4]; const w = 10 + rnd() * 60, h = 4 + rnd() * 30; g.fillRect(rnd() * (W - w), rnd() * (H - h), w, h) } g.strokeStyle = 'rgba(255,255,255,.35)'; g.strokeRect(6, 6, W - 12, H - 12) }
  else { g.fillStyle = '#0B1410'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(120,160,140,.18)'; for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(i * W / 10, 0); g.lineTo(i * W / 10, H); g.stroke() } for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(0, i * H / 8); g.lineTo(W, i * H / 8); g.stroke() }
    [['#F5D433', 30, 0], ['#33D1F0', 70, 1], ['#E04BC8', 108, 2], ['#4BD07A', 140, 3]].forEach(([c, y0, k]) => { g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); for (let x = 0; x <= W; x += 2) { const t = x / W * Math.PI * (4 + k * 3); const y = k === 1 ? y0 + (Math.sin(t) > 0 ? -10 : 10) : y0 + Math.sin(t + k) * (10 - k) + (k === 3 ? Math.sin(t * 7) * 3 : 0); x ? g.lineTo(x, y) : g.moveTo(x, y) } g.stroke() }) }
}, null);
const SCREEN = {};
const screenMat = kind => SCREEN[kind] || (SCREEN[kind] = keep(new THREE.MeshStandardMaterial({ color: '#05070A', roughness: .18, emissive: '#FFFFFF', emissiveMap: shared(screenTex(kind)), emissiveIntensity: kind === 'wave' ? 1.8 : .75, envMapIntensity: .5 })));
const UNITPLANE = new THREE.PlaneGeometry(1, 1);
const woodTex = canvasTex(512, 512, (g, W, H) => {
  g.fillStyle = '#A88A6C'; g.fillRect(0, 0, W, H); const ph = H / 8;
  for (let r = 0; r < 8; r++) { const off = rnd() * W; g.fillStyle = `hsl(${30 + rnd() * 5},${22 + rnd() * 8}%,${50 + rnd() * 9}%)`; g.fillRect(0, r * ph, W, ph - 2); for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(70,40,15,${.05 + rnd() * .07})`; g.beginPath(); const y = r * ph + rnd() * ph; g.moveTo(0, y); g.bezierCurveTo(W * .3, y + (rnd() - .5) * 6, W * .7, y + (rnd() - .5) * 6, W, y); g.stroke() } g.fillStyle = 'rgba(40,25,10,.35)'; g.fillRect((off) % W, r * ph, 2, ph) }
}, [1, 1]);
const tileTex = canvasTex(256, 256, (g, W, H) => { g.fillStyle = '#ECEAE5'; g.fillRect(0, 0, W, H); const n = 4, s = W / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = `rgba(0,0,0,${rnd() * .035})`; g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4) } g.strokeStyle = 'rgba(120,115,105,.55)'; g.lineWidth = 2; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, H); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(W, i * s); g.stroke() } }, [1, 1]);
[carpetTex,terrazzoTex,woodTex,tileTex].forEach(t=>SHARED.add(t));

/* ---------- Blender-made PBR sets (pbr-data.js, src/blender/pbr_textures.py); the canvas finishes above stay as the fallback ---------- */
const pbr = (name, w, d) => typeof pbrSet === 'function' ? pbrSet(name, w, d) : null;
const pbrRough = name => (typeof PBR_DATA !== 'undefined' && PBR_DATA && PBR_DATA.sets[name] && PBR_DATA.sets[name].rough) || .5;
// a new material from a set (three multiplies roughness by the map, so the map alone sets it unless `rough` asks for a mean)
function pbrMat(s, name, color, extra = {}, rough) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, map: s.map, normalMap: s.normalMap, normalScale: new THREE.Vector2(s.normalScale, s.normalScale), roughnessMap: s.roughnessMap,
    roughness: rough ? rough / pbrRough(name) : 1, metalness: s.metalness || 0 }, extra));
}
// a set's maps on an existing material; true color keeps the material's own color by dividing out the map's average
function pbrOn(m, name, trueColor) {
  const s = pbr(name); if (!s || m.userData.pbr) return m; m.userData.pbr = name;
  m.map = s.map; m.normalMap = s.normalMap; m.normalScale = new THREE.Vector2(s.normalScale, s.normalScale); m.roughnessMap = s.roughnessMap; m.roughness = m.roughness / pbrRough(name);
  if (trueColor) { const a = new THREE.Color(s.avg); m.color.multiply(new THREE.Color(1 / Math.max(.05, a.r), 1 / Math.max(.05, a.g), 1 / Math.max(.05, a.b))) }
  m.needsUpdate = true; return m;
}

/* ---------- materials ---------- */
const MAT = {};
const std = (key, color, rough, metal = 0, extra = {}) => MAT[key] || (MAT[key] = keep(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal, envMapIntensity: .4 }, extra))));
const M = {
  wallWhite: () => std('wallWhite', '#E9E6E0', .92),
  baseboard: () => std('baseboard', '#5F6266', .6),
  spandrel: () => std('spandrel', '#D9D6D0', .8),
  alu: () => pbrOn(std('alu', '#B9BEC4', .3, .9), 'metal'),
  aluDark: () => pbrOn(std('aluDark', '#43474D', .35, .7), 'metal'),
  glass: () => std('glass', '#CFE3EC', .04, 0, { transparent: true, opacity: .16, depthWrite: false, envMapIntensity: 1.6 }),
  sky: () => MAT.sky || (MAT.sky = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.7, 1.8) }))),
  felt: () => std('felt', '#AEB4AC', .97),
  core: () => std('core', '#D8D4CC', .85),
  coreTop: () => std('coreTop', '#9E9A93', .8),
  steel: () => pbrOn(std('steel', '#AEB3B8', .28, .95), 'metal'),
  white: () => std('white', '#E8E6E0', .55),
  offwhite: () => std('offwhite', '#E6E3DC', .6),
  epoxy: () => std('epoxy', '#1E2124', .28, .05, { envMapIntensity: 1 }),
  darkMetal: () => std('darkMetal', '#2A2D31', .45, .6),
  rackFace: () => std('rackFace', '#16181B', .5, .4),
  led: () => MAT.led || (MAT.led = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5) }))),
  screen: () => std('screen', '#20262E', .2, 0, { emissive: '#B9C8D6', emissiveIntensity: .45 }),
  casework: () => std('casework', '#AEB7BF', .5, .1),
  instr: () => std('instr', '#7E868E', .45, .25),
  esdMat: () => std('esdMat', '#55707E', .85),
  birch: () => std('birch', '#D9C6A5', .5),
  graphite: () => std('graphite', '#3A3E44', .45, .6),
  team: () => std('teamFelt', '#FFFFFF', .97),
  screenOff: () => std('screenOff', '#101215', .25, .2),
  board: () => std('board', '#FAFAF8', .2),
  oak: () => MAT.oak || (pbr('oak') ? (MAT.oak = keep(pbrMat(pbr('oak'), 'oak', '#FFFFFF', { envMapIntensity: .4 }, .5))) : std('oak', '#D8C3A8', .5, 0, { map: woodTex })),
  laminate: () => std('laminate', '#E9E6DF', .45),
  yellow: () => std('yellow', '#F2C14E', .5),
};
// Kenney's palette names -> this scene's materials
const KMAT = {
  wood: () => M.laminate(), woodDark: () => std('k.woodDark', '#8A6A4F', .6), metal: () => std('k.metal', '#C3C8CD', .3, .85),
  metalMedium: () => std('k.metalMed', '#7D858C', .38, .8), metalDark: () => std('k.metalDark', '#24272B', .42, .35), metalLight: () => std('k.metalLight', '#EEF0F1', .26, .2),
  carpet: () => std('k.fabric', '#4E5866', .93), carpetBlue: () => std('k.fabricBlue', '#3C6B8F', .9), carpetWhite: () => std('k.fabricWhite', '#ECEBE6', .9),
  carpetDarker: () => std('k.fabricDark', '#6E5452', .9), plant: () => std('k.plant', '#3D7B47', .7), lamp: () => std('k.lamp', '#FFF3D6', .4, 0, { emissive: '#FFE7B0', emissiveIntensity: 1.2 }),
  glass: () => M.glass(), _defaultMat: () => std('k.white', '#F4F4F2', .6),
};
const tintMats = {};
function tintMat(name, base) { // white base so per-instance colors show true
  if (tintMats[name]) return tintMats[name];
  const m = (base || KMAT[name] || KMAT._defaultMat)().clone(); m.color.set('#FFFFFF'); return tintMats[name] = keep(m);
}

/* ---------- models: Kenney furniture and the Blender lab props, packed into KITMESH (src/tools/pack_kit.py) ---------- */
const BL_NAMES=['oscilloscope','powerSupply','testChamber','probeStation','serverRack','waferPod'],BL=new Set(BL_NAMES);
const KIT={};
const b64u8=s=>{const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u};
function kitGeo(p,q){
  const P=new Int16Array(b64u8(p.p).buffer),I=p.w===4?new Uint32Array(b64u8(p.i).buffer):new Uint16Array(b64u8(p.i).buffer),pos=new Float32Array(P.length);
  for(let i=0;i<P.length;i++)pos[i]=P[i]/q;
  let g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setIndex(new THREE.BufferAttribute(I,1));
  if(p.vc){const C=b64u8(p.vc),col=new Float32Array(C.length),lin=x=>(x/=255)<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);for(let i=0;i<C.length;i++)col[i]=lin(C[i]);g.setAttribute('color',new THREE.BufferAttribute(col,3))} // sRGB bytes -> linear
  if(p.f){g=g.toNonIndexed();g.computeVertexNormals();fixNormals(g)} // flat-shaded: split per face, one normal per face
  else{
    const N=new Int8Array(b64u8(p.n).buffer),nor=new Float32Array(N.length);for(let i=0;i<N.length;i+=3){const l=Math.hypot(N[i],N[i+1],N[i+2]);if(l>0){nor[i]=N[i]/l;nor[i+1]=N[i+1]/l;nor[i+2]=N[i+2]/l}else nor[i+1]=1}
    g.setAttribute('normal',new THREE.BufferAttribute(nor,3));
    if(p.u){const U=new Uint16Array(b64u8(p.u).buffer),uv=new Float32Array(U.length);for(let i=0;i<U.length;i++)uv[i]=U[i]/65535;g.setAttribute('uv',new THREE.BufferAttribute(uv,2))}
    if(p.a){const A=b64u8(p.a),col=new Float32Array(A.length*3);for(let i=0;i<A.length;i++)col[i*3]=col[i*3+1]=col[i*3+2]=A[i]/255;g.setAttribute('color',new THREE.BufferAttribute(col,3))}
  }
  g.computeBoundingBox();g.userData.keep=true;return g;
}
// a zero-length normal (from a paper-thin triangle) shades as NaN: bloom would spread it over the screen as a black flash
function fixNormals(g){const n=g.attributes.normal.array;for(let i=0;i<n.length;i+=3)if(!(Math.abs(n[i])+Math.abs(n[i+1])+Math.abs(n[i+2])>1e-6)){n[i]=0;n[i+1]=1;n[i+2]=0}}
function loadKit(){
  for(const n in KITMESH){
    const rec=KITMESH[n],box=new THREE.Box3(),parts=[];
    for(const p of rec.parts){const geo=kitGeo(p,rec.q);box.union(geo.boundingBox);parts.push({mat:p.k,geo,c:p.c,r:p.r,m:p.m,e:p.e,o:p.o,vc:!!p.vc})}
    KIT[n]={parts,box,size:box.getSize(new THREE.Vector3()),bl:BL.has(n)};
  }
  // a lower office-chair back, so shoulders and shirts show over it from behind (and from the RC car)
  const ch=KIT.chairDesk;if(!ch)return;const ys=seatHeight('chairDesk');ch.seatY=ys;
  for(const p of ch.parts){const pos=p.geo.attributes.position;for(let i=0;i<pos.count;i++){const y=pos.getY(i)-ch.box.min.y;if(y>ys+.02)pos.setY(i,ch.box.min.y+ys+.02+(y-ys-.02)*.45)}pos.needsUpdate=true;p.geo.computeBoundingBox();p.geo.computeVertexNormals();fixNormals(p.geo)}
  ch.box=new THREE.Box3();for(const p of ch.parts)ch.box.union(p.geo.boundingBox);ch.size=ch.box.getSize(new THREE.Vector3());
}
const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), YAX = new THREE.Vector3(0, 1, 0);
// list items: {x, y, z, a, w?, h?, d? (target size in the model's own axes) | s? (uniform scale), tint?}
// o: {yaw: model's facing correction, tint: [material names colored per instance], mats: {name: material}, cast}
const BLM={};
function blMat(name,p){
  const key=name+'/'+p.mat;if(BLM[key])return BLM[key];
  if(p.mat==='screen')return BLM[key]=screenMat({oscilloscope:'wave',serverRack:'wave',probeStation:'chip',testChamber:'doc'}[name]||'code');
  if(/^led/.test(p.mat)){const c=p.e&&p.e.some(x=>x)?p.e:p.c;return BLM[key]=keep(new THREE.MeshBasicMaterial({color:new THREE.Color().setRGB(c[0],c[1],c[2]).multiplyScalar(4)}))}
  const m=new THREE.MeshStandardMaterial({color:new THREE.Color().setRGB(p.c[0],p.c[1],p.c[2]),roughness:p.r??.6,metalness:p.m??0,vertexColors:true,envMapIntensity:.45});
  if(p.o!=null&&p.o<1){m.transparent=true;m.opacity=Math.max(.25,p.o);m.depthWrite=false}
  return BLM[key]=keep(m);
}
// the patch.gg models (Polyfork, CC BY 4.0): one white material per model, colored per vertex. userData.avg is the
// model's average color, which the light bake uses for the light it bounces.
function vcMat(name,p){
  const key='vc/'+name;if(BLM[key])return BLM[key];
  const m=new THREE.MeshStandardMaterial({color:'#FFFFFF',roughness:p.r??.8,metalness:p.m??0,vertexColors:true,envMapIntensity:.45});
  const c=p.geo.attributes.color,avg=new THREE.Color(0,0,0);if(c){for(let i=0;i<c.count;i++){avg.r+=c.getX(i);avg.g+=c.getY(i);avg.b+=c.getZ(i)}avg.multiplyScalar(1/Math.max(1,c.count))}
  m.userData.avg=avg;return BLM[key]=keep(m);
}
function placeKit(name, list, o = {}) {
  const k = KIT[name]; if (!k || !list.length) return;
  const b = k.box, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, sz = k.size;
  for (const p of k.parts) {
    const tint = !!(o.tint && o.tint.includes(p.mat));
    const mat = (o.mats && o.mats[p.mat]) || (k.bl ? blMat(name, p) : p.vc ? vcMat(name, p) : tint ? tintMat(p.mat) : (KMAT[p.mat] || KMAT._defaultMat)());
    const im = new THREE.InstancedMesh(p.geo, mat, list.length); im.castShadow = o.cast !== false && !mat.transparent; im.receiveShadow = true;
    list.forEach((q, i) => {
      const u = q.s || 1;
      _s.set(q.w ? q.w / sz.x : u, q.h ? q.h / sz.y : u, q.d ? q.d / sz.z : u);
      _q.setFromAxisAngle(YAX, (q.a || 0) + (o.yaw || 0));
      _m.compose(_v.set(q.x, q.y || 0, q.z), _q, _s).multiply(_t.makeTranslation(-cx, -b.min.y, -cz));
      im.setMatrixAt(i, _m); if (tint) im.setColorAt(i, _c.set(q.tint || '#5A6470'));
    });
    root.add(im);
  }
}
// height of a model's seat: the highest upward-facing "carpet" surface in its lower 70%
function seatHeight(name) {
  if (KIT[name].seatY) return KIT[name].seatY;
  const k = KIT[name], p = k.parts.find(x => /carpet/.test(x.mat)); if (!p) return k.size.y * .5;
  const pos = p.geo.attributes.position, nor = p.geo.attributes.normal; let best = 0;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) - k.box.min.y; if (nor.getY(i) > .9 && y < k.size.y * .7 && y > best) best = y } return best || k.size.y * .5;
}

/* ---------- instanced procedural boxes and cylinders ---------- */
const UNITBOX = new THREE.BoxGeometry(1, 1, 1), UNITCYL = new THREE.CylinderGeometry(.5, .5, 1, 24);
function batch(geo, mat, o = {}) {
  const L = [];
  return {
    add(x, y, z, w, h, d, a = 0, col) { L.push([x, y, z, w, h, d, a, col]) },
    done() {
      if (!L.length) return; const m = col => col && !mat.isMeshBasicMaterial ? tintMat('b.' + mat.uuid, () => mat) : mat;
      const colored = L.some(l => l[7]); const im = new THREE.InstancedMesh(geo, colored ? m(true) : mat, L.length);
      im.castShadow = o.cast !== false && !mat.transparent; im.receiveShadow = o.receive !== false;
      L.forEach((l, i) => { _q.setFromAxisAngle(YAX, l[6]); _m.compose(_v.set(l[0], l[1], l[2]), _q, _s.set(l[3], l[4], l[5])); im.setMatrixAt(i, _m); if (colored) im.setColorAt(i, _c.set(l[7] || '#FFFFFF')) });
      root.add(im); if (o.bake) BAKE.reg(im, geo === UNITCYL); // lightmapped when the world has a matching bake (game-2e-bake.js)
    }
  };
}
[UNITBOX,UNITCYL,UNITPLANE].forEach(g=>g.userData.keep=true);
const loc = (it, lx, lz) => { const c = Math.cos(it.a || 0), s = Math.sin(it.a || 0); return [it.x + lx * c + lz * s, it.z - lx * s + lz * c] };
const dims=it=>{const d=IDEF[it.t]||[1,1,1];return{w:it.w>0?it.w:d[0],d:it.d>0?it.d:d[1],h:it.h>0?it.h:d[2],y:isFinite(it.y)?it.y:0}};
const mixh=(a,b,t)=>'#'+new THREE.Color(a).lerp(new THREE.Color(b),t).getHexString();
let floorKey='';

/* ---------- the floor: ground, finishes, walls, cores ---------- */
function ground(m){
  const W=m.w,D=m.d;
  // ground: polished concrete, then floor finishes on top
  const cs = pbr('concrete', W + 6, D + 6);
  const gm = new THREE.Mesh(new THREE.PlaneGeometry(W + 6, D + 6), cs ? pbrMat(cs, 'concrete', '#FFFFFF', { envMapIntensity: .3 }) : new THREE.MeshStandardMaterial({ color: '#E9E3D9', roughness: .55, map: concreteTex(W + 6, D + 6), envMapIntensity: .3 })); gm.rotation.x = -Math.PI / 2; gm.receiveShadow = true; root.add(gm);
  (m.areas || []).forEach((a, i) => {
    if (!(a.w > 0 && a.d > 0)) return; const y = .004 + Math.min(i, 30) * .0004, tc = a.team ? teamColorOf(a.team) : null;
    let mat; const P = n => pbr(n, a.w, a.d), tint = (h, k) => '#' + new THREE.Color(h).multiplyScalar(k).getHexString();
    if (a.kind === 'esd' && P('carpet')) mat = pbrMat(P('carpet'), 'carpet', tint('#6F8597', 1.09), { envMapIntensity: .25 }, .6);
    else if (a.kind === 'tile' && P('tile')) mat = pbrMat(P('tile'), 'tile', '#FFFFFF', { envMapIntensity: .5 }, .45);
    else if (a.kind === 'lobby' && P('terrazzo')) mat = pbrMat(P('terrazzo'), 'terrazzo', '#FFFFFF', { envMapIntensity: .7 }, .35);
    else if (a.kind === 'wood' && P('oak')) mat = pbrMat(P('oak'), 'oak', '#FFFFFF', { envMapIntensity: .6 }, .5);
    else if (!['esd', 'tile', 'lobby', 'wood'].includes(a.kind) && P('carpet')) mat = pbrMat(P('carpet'), 'carpet', tint(tc ? mixh('#A29E97', tc, .32) : '#A29E97', 1.09), { envMapIntensity: .25 }, .97);
    else if (a.kind === 'esd') mat = std('esd', '#6F8597', .55, 0, { map: carpetTex });
    else if (a.kind === 'tile') { const t = tileTex.clone(); t.repeat.set(a.w / 1.2, a.d / 1.2); t.needsUpdate = true; mat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', map: t, roughness: .45, envMapIntensity: .5 }) }
    else if (a.kind === 'lobby') { const t = terrazzoTex.clone(); t.repeat.set(a.w / 3, a.d / 3); t.needsUpdate = true; mat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', map: t, roughness: .35, envMapIntensity: .7 }) }
    else if (a.kind === 'wood') { const t = woodTex.clone(); t.repeat.set(a.w / 4, a.d / 4); t.needsUpdate = true; mat = new THREE.MeshStandardMaterial({ color: '#E2D8CC', map: t, roughness: .5, envMapIntensity: .6 }) }
    else { const t = carpetTex.clone(); t.repeat.set(a.w / 1.5, a.d / 1.5); t.needsUpdate = true; mat = new THREE.MeshStandardMaterial({ color: tc ? mixh('#A29E97', tc, .32) : '#A29E97', map: t, roughness: .97, envMapIntensity: .25 }) }
    const p = new THREE.Mesh(new THREE.PlaneGeometry(a.w, a.d), mat); p.rotation.x = -Math.PI / 2; p.position.set(a.x, y, a.z); p.receiveShadow = true; root.add(p);
    if (tc && a.kind !== 'esd') { const tb = batch(UNITBOX, M.team(), { cast: false }), tw = .18, col = mixh('#9A958D', tc, .7); tb.add(a.x, y + .002, a.z - a.d / 2 + tw / 2, a.w, .002, tw, 0, col); tb.add(a.x, y + .002, a.z + a.d / 2 - tw / 2, a.w, .002, tw, 0, col); tb.add(a.x - a.w / 2 + tw / 2, y + .002, a.z, tw, .002, a.d - 2 * tw, 0, col); tb.add(a.x + a.w / 2 - tw / 2, y + .002, a.z, tw, .002, a.d - 2 * tw, 0, col); tb.done() }
    if (a.kind === 'esd') { const tb = batch(UNITBOX, M.yellow(), { cast: false }); const tw = .06; tb.add(a.x, y + .002, a.z - a.d / 2 + tw / 2, a.w, .002, tw); tb.add(a.x, y + .002, a.z + a.d / 2 - tw / 2, a.w, .002, tw); tb.add(a.x - a.w / 2 + tw / 2, y + .002, a.z, tw, .002, a.d); tb.add(a.x + a.w / 2 - tw / 2, y + .002, a.z, tw, .002, a.d); tb.done() }
  });

}
function cores(m){
  const core = batch(UNITBOX, M.core(), { bake: 1 }), coreTop = batch(UNITBOX, M.coreTop(), { cast: false, bake: 1 });
  for (const r of m.rooms || []) if (r.solid && r.w > 0 && r.d > 0 && r.type !== 'open') { core.add(r.x, H / 2, r.z, r.w, H, r.d, 0, r.type === 'elevator' ? '#B9BEC3' : null); coreTop.add(r.x, H + .01, r.z, r.w + .04, .02, r.d + .04) }
  core.done(); coreTop.done();
}
function buildWalls(walls) {
  const wb = batch(UNITBOX, M.wallWhite(), { bake: 1 }), base = batch(UNITBOX, M.baseboard(), { cast: false }), span = batch(UNITBOX, M.spandrel(), { bake: 1 }), sky = batch(UNITBOX, M.sky(), { cast: false, receive: false }),
    alu = batch(UNITBOX, M.alu()), aluD = batch(UNITBOX, M.aluDark()), glass = batch(UNITBOX, M.glass(), { cast: false }), felt = batch(UNITBOX, M.felt(), { bake: 1 });
  for (const w of walls) {
    if (![w.x1, w.z1, w.x2, w.z2].every(isFinite)) continue; const L = Math.hypot(w.x2 - w.x1, w.z2 - w.z1); if (L < .02) continue;
    const a = Math.atan2(-(w.z2 - w.z1), w.x2 - w.x1), mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2, k = w.kind || 'int';
    const t = w.t > 0 ? w.t : (k === 'ext' ? .3 : k === 'part' ? .06 : k === 'glass' ? .05 : .15), h = w.h > 0 ? w.h : (k === 'part' ? 1.3 : k === 'glass' ? 2.7 : H);
    const along = (u, y, z, ww, hh, dd, b, col) => { const c = Math.cos(a), s = Math.sin(a); b.add(mx + u * c + z * s, y, mz - u * s + z * c, ww, hh, dd, a, col) };
    if (k === 'ext') {
      // curtain wall: spandrel, a tall daylight band split by mullions, a head band
      along(0, .45, 0, L + t, .9, t, span); along(0, (H + 2.75) / 2, 0, L + t, H - 2.75, t, span);
      along(0, 1.825, 0, L, 1.85, t * .35, sky);
      const n = Math.max(1, Math.round(L / 1.5)); for (let i = 0; i <= n; i++) along(-L / 2 + L * i / n, 1.825, 0, .06, 1.85, t * .9, aluD);
      along(0, .91, 0, L, .04, t + .06, alu);
    } else if (k === 'glass') {
      along(0, h / 2, 0, L, h, .02, glass); along(0, .03, 0, L, .06, .07, alu); along(0, h - .03, 0, L, .06, .07, alu);
      const n = Math.max(1, Math.round(L / 1.2)); for (let i = 0; i <= n; i++) along(-L / 2 + L * i / n, h / 2, 0, .045, h, .06, alu);
    } else if (k === 'part') {
      along(0, h / 2, 0, L, h, t, felt); along(0, h + .01, 0, L, .02, t + .02, alu);
    } else {
      along(0, h / 2, 0, L + t * .98, h, t, wb); along(0, .04, 0, L + t, .08, t + .02, base);
    }
  }
  [wb, base, span, sky, alu, aluD, glass, felt].forEach(b => b.done());
}

// a silicon wafer: a die grid on a mirror-like disc
let _wafer = null;
function waferMat() {
  if (_wafer) return _wafer;
  const t = canvasTex(512, 512, (g, W, H) => { g.fillStyle = '#9AA6B8'; g.fillRect(0, 0, W, H); const n = 22, s = W / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const cx = (i + .5) * s - W / 2, cy = (j + .5) * s - H / 2; if (Math.hypot(cx, cy) > W * .47) continue; g.fillStyle = `hsl(${200 + (i * 7 + j * 13) % 60},${30 + rnd() * 20}%,${45 + rnd() * 15}%)`; g.fillRect(i * s + 1, j * s + 1, s - 2, s - 2) } }, null);
  return _wafer = keep(new THREE.MeshStandardMaterial({ map: shared(t), metalness: 1, roughness: .15, envMapIntensity: 1.2 }));
}
function buildItems(items) {
  const waferAt = [];
  const by = {}; for (const it of items) { if (!isFinite(it.x) || !isFinite(it.z)) continue; (by[it.t] || (by[it.t] = [])).push(it) }
  const white = batch(UNITBOX, M.white(), { bake: 1 }), cw = batch(UNITBOX, M.casework(), { bake: 1 }), ins = batch(UNITBOX, M.instr()), esdm = batch(UNITBOX, M.esdMat(), { cast: false }), aluD = batch(UNITBOX, M.aluDark()), wave = batch(UNITPLANE, screenMat('wave'), { cast: false }), offw = batch(UNITBOX, M.offwhite(), { bake: 1 }), epoxy = batch(UNITBOX, M.epoxy(), { bake: 1 }), dm = batch(UNITBOX, M.darkMetal()), steel = batch(UNITBOX, M.steel()),
    rackF = batch(UNITBOX, M.rackFace()), led = batch(UNITBOX, M.led(), { cast: false }), scr = batch(UNITBOX, M.screen(), { cast: false }), felt = batch(UNITBOX, M.felt(), { bake: 1 }), oak = batch(UNITBOX, M.oak(), { bake: 1 }),
    board = batch(UNITBOX, M.board(), { bake: 1 }), alu = batch(UNITBOX, M.alu()), glass = batch(UNITBOX, M.glass(), { cast: false }), cyl = batch(UNITCYL, M.white(), { bake: 1 }), cylMetal = batch(UNITCYL, M.steel()), lam = batch(UNITBOX, M.laminate(), { bake: 1 });
  const put = (b, it, lx, y, lz, w, h, d, col) => { const [x, z] = loc(it, lx, lz); b.add(x, y, z, w, h, d, it.a || 0, col) };
  // lab gear: the Blender props when present, the code-built pieces otherwise
  const blp = n => !!KIT[n], blList = { oscilloscope: [], testChamber: [], probeStation: [], serverRack: [], powerSupply: [], waferPod: [] };
  for (const it of by.panel || []) { const q = dims(it); put(felt, it, 0, q.h / 2, 0, q.w, q.h, Math.max(.03, q.d), it.c ? mixh('#AEB4AC', it.c, .25) : null); put(alu, it, 0, q.h + .008, 0, q.w, .016, .05) }
  for (const it of by.table || []) { const q = dims(it); put(cyl, it, 0, q.h - .02, 0, q.w, .04, q.w); put(cylMetal, it, 0, (q.h - .04) / 2, 0, .1, q.h - .04, .1); put(cylMetal, it, 0, .012, 0, Math.min(.6, q.w * .5), .024, Math.min(.6, q.w * .5)) }
  for (const it of by.rtable || []) { const q = dims(it); put(lam, it, 0, q.h - .02, 0, q.w, .04, q.d); for (const sx of [-1, 1]) { put(steel, it, sx * (q.w / 2 - .3), (q.h - .04) / 2, 0, .06, q.h - .04, Math.max(.1, q.d * .7)); put(steel, it, sx * (q.w / 2 - .3), .02, 0, .08, .04, Math.max(.1, q.d * .8)) } }
  // lab benches: white cabinets, black epoxy top, an instrument shelf on posts
  for (const it of by.bench || []) { const q = dims(it); put(cw, it, 0, (q.h - .04) / 2, 0, q.w - .04, q.h - .04, q.d - .06); put(dm, it, 0, .05, 0, q.w - .06, .1, q.d - .1); put(epoxy, it, 0, q.h - .015, 0, q.w, .03, q.d); put(esdm, it, 0, q.h + .002, .04, q.w - .12, .004, q.d - .2); for (let i = 1; i < 4; i++) for (const sz of [-1, 1]) put(aluD, it, -q.w / 2 + q.w * i / 4, (q.h - .02) / 2, sz * (q.d / 2 - .02), .012, q.h - .2, .006) }
  for (const it of by.shelf || []) { const q = dims(it); const y0 = q.y || .9; for (const sx of [-1, 1]) put(steel, it, sx * (q.w / 2 - .03), y0 + q.h / 2, 0, .04, q.h, .04); put(lam, it, 0, y0 + q.h, 0, q.w, .025, q.d);
    if (blp('powerSupply')) { const n = 2 + Math.floor(rnd() * 2); for (let k = 0; k < n; k++) { const lx = -q.w / 2 + q.w * (k + .5) / n + (rnd() - .5) * .2, [x, z] = loc(it, lx, 0), pod = blp('waferPod') && rnd() < .18; blList[pod ? 'waferPod' : 'powerSupply'].push({ x, y: y0 + q.h + .0125, z, a: it.a || 0, s: pod ? .85 : 1 }) } continue }
    const n = 2 + Math.floor(rnd() * 2); for (let k = 0; k < n; k++) { const lx = -q.w / 2 + q.w * (k + .5) / n + (rnd() - .5) * .2, hh = .12 + rnd() * .06; put(rnd() < .5 ? ins : dm, it, lx, y0 + q.h + .0125 + hh / 2, 0, .26, hh, Math.min(.26, q.d - .02)); put(led, it, lx - .05, y0 + q.h + .0125 + hh * .65, Math.min(.13, q.d / 2 - .01) + .003, .08, .022, .004, rnd() < .5 ? '#FF5A4E' : '#62F0A8') } }
  for (const it of by.rack || []) { if (blp('serverRack')) { const q = dims(it); blList.serverRack.push({ x: it.x, z: it.z, a: (it.a || 0) + Math.PI, w: q.w, h: q.h, d: q.d }); continue } const q = dims(it); put(rackF, it, 0, q.h / 2, 0, q.w, q.h, q.d); for (let r = 0; r < 7; r++) { put(dm, it, 0, .25 + r * .24, -(q.d / 2 + .004), q.w * .86, .2, .006); put(led, it, -q.w * .3 + (r % 3) * .05, .3 + r * .24, -(q.d / 2 + .009), .024, .024, .004, r % 4 === 0 ? '#FFB547' : '#62F0A8') } }
  for (const it of by.scope || []) { if (blp('oscilloscope')) { const q = dims(it); blList.oscilloscope.push({ x: it.x, y: q.y || 0, z: it.z, a: it.a || 0, w: q.w, h: q.h, d: q.d }); continue } const q = dims(it); const y0 = q.y || 0; put(ins, it, 0, y0 + q.h / 2, 0, q.w, q.h, q.d); put(dm, it, -q.w * .15, y0 + q.h * .55, q.d / 2 + .002, q.w * .56, q.h * .68, .004); { const [x, z] = loc(it, -q.w * .15, q.d / 2 + .0045); wave.add(x, y0 + q.h * .55, z, q.w * .5, q.h * .6, 1, it.a || 0) } for (let k = 0; k < 3; k++) put(dm, it, q.w * .22 + (k % 2) * .06, y0 + q.h * (.35 + k * .2), q.d / 2 + .006, .03, .03, .012) }
  for (const it of by.chamber || []) { if (blp('testChamber')) { const q = dims(it); blList.testChamber.push({ x: it.x, z: it.z, a: (it.a || 0) + Math.PI, w: q.w, h: q.h, d: q.d }); continue } const q = dims(it); put(white, it, 0, q.h / 2, 0, q.w, q.h, q.d); put(glass, it, 0, q.h * .55, -(q.d / 2 + .01), q.w * .45, q.h * .3, .02); put(dm, it, 0, q.h * .55, -(q.d / 2 + .004), q.w * .52, q.h * .37, .006); put(scr, it, q.w * .32, q.h * .8, -(q.d / 2 + .01), q.w * .18, q.h * .08, .01) }
  for (const it of by.probe || []) { if (blp('probeStation')) { const q = dims(it); blList.probeStation.push({ x: it.x, z: it.z, a: (it.a || 0) + Math.PI, w: q.w, d: q.d, s: q.w / KIT.probeStation.size.x }); continue } const q = dims(it); put(dm, it, 0, .4, 0, q.w, .8, q.d); put(steel, it, 0, .82, 0, q.w * .7, .04, q.d * .7); put(steel, it, 0, 1.05, q.d * .1, .1, .5, .1); put(dm, it, 0, 1.32, q.d * .1, .25, .14, .25) }
  // Polyfork models from patch.gg (CC BY 4.0, src/assets/patch/CREDITS.md) where they fit, the code-built pieces otherwise
  const pgList = { storageCupboard: [], lockerBank: [], printer: [], whiteboard: [] };
  for (const it of by.cabinet || []) { const q = dims(it); if (blp('storageCupboard')) { const n = Math.max(1, Math.round(q.w / 1.1)); for (let i = 0; i < n; i++) { const [x, z] = loc(it, -q.w / 2 + q.w * (i + .5) / n, 0); pgList.storageCupboard.push({ x, z, a: (it.a || 0) + Math.PI, w: q.w / n, h: q.h, d: q.d }) } continue }
    put(offw, it, 0, q.h / 2, 0, q.w, q.h, q.d); for (let r = 1; r < 3; r++) put(dm, it, 0, q.h * r / 3, -(q.d / 2 + .003), q.w * .96, .006, .004); put(lam, it, 0, q.h + .01, 0, q.w + .02, .02, q.d + .02) }
  for (const it of by.locker || []) { const q = dims(it); if (blp('lockerBank')) { const n = Math.max(1, Math.round(q.w)); for (let i = 0; i < n; i++) { const [x, z] = loc(it, -q.w / 2 + q.w * (i + .5) / n, 0); pgList.lockerBank.push({ x, z, a: (it.a || 0) + Math.PI, w: q.w / n, h: q.h, d: q.d }) } continue }
    put(steel, it, 0, q.h / 2, 0, q.w, q.h, q.d) }
  for (const it of by.reception || []) { const q = dims(it); put(white, it, 0, q.h / 2, 0, q.w, q.h, q.d); put(oak, it, 0, q.h + .02, 0, q.w + .06, .04, q.d + .06);
    // a wafer on a plinth beside the desk
    { const [x, z] = loc(it, q.w / 2 + 1.1, 0); cyl.add(x, .5, z, .42, 1, .42); waferAt.push([x, 1.012, z]) } }
  for (const it of by.printer || []) { const q = dims(it); if (blp('printer')) { pgList.printer.push({ x: it.x, z: it.z, a: (it.a || 0) + Math.PI, w: q.w, h: q.h, d: q.d }); continue } put(offw, it, 0, q.h / 2, 0, q.w, q.h, q.d); put(dm, it, 0, q.h + .02, 0, q.w * .8, .04, q.d * .6); put(scr, it, q.w * .3, q.h * .9, -(q.d / 2 + .003), .12, .07, .005) }
  for (const it of by.whiteboard || []) { const q = dims(it); const y0 = q.y || .9; if (blp('whiteboard')) { pgList.whiteboard.push({ x: it.x, y: y0 - .06, z: it.z, a: (it.a || 0) + Math.PI, w: q.w, h: q.h + .1, d: .1 }); continue } put(board, it, 0, y0 + q.h / 2, 0, q.w, q.h, .03); put(alu, it, 0, y0 - .01, 0, q.w + .04, .03, .06) }
  for (const it of by.elevdoor || []) { const q = dims(it); for (const sx of [-1, 1]) put(steel, it, sx * q.w / 4, q.h / 2, 0, q.w / 2 - .02, q.h, .06); put(dm, it, 0, q.h + .08, 0, q.w + .24, .16, .1) }
  for (const it of by.booth || []) { const q = dims(it); put(glass, it, 0, q.h / 2, 0, q.w, q.h, q.d); put(alu, it, 0, q.h, 0, q.w + .04, .06, q.d + .04); put(felt, it, 0, .02, 0, q.w - .1, .04, q.d - .1, '#5C6E7A') }
  [white, cw, ins, esdm, aluD, wave, offw, epoxy, dm, steel, rackF, led, scr, felt, oak, board, alu, glass, cyl, cylMetal, lam].forEach(b => b.done());
  for (const n in blList) placeKit(n, blList[n]);
  for (const n in pgList) placeKit(n, pgList[n]);
  for (const [x, y, z] of waferAt) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.15, .15, .004, 64), waferMat()); w.position.set(x, y, z); w.rotation.z = .5; w.castShadow = true; root.add(w) }

  // Kenney models for the things a kit does well
  const kp = (name, list, o) => placeKit(name, list, o);
  kp('pottedPlant', (by.plant || []).map(it => { const q = dims(it); return { x: it.x, z: it.z, a: it.a, s: q.h / KIT.pottedPlant.size.y * (.9 + rnd() * .2) } }));
  // kitchen counters: a run of base cabinets (one with the sink); upper cabinets on the wall side
  const cab = [], sink = [], upper = [];
  for (const it of by.counter || []) { const q = dims(it), n = Math.max(1, Math.round(q.w / .6)), cw = q.w / n; for (let i = 0; i < n; i++) { const [x, z] = loc(it, -q.w / 2 + cw * (i + .5), 0); (i === Math.floor(n / 2) ? sink : cab).push({ x, z, a: (it.a || 0) + Math.PI, w: cw, h: q.h, d: q.d }) } }
  kp('kitchenCabinet', cab); kp('kitchenSink', sink);
  kp('kitchenCoffeeMachine', (by.coffee || []).map(it => { const q = dims(it); return { x: it.x, y: q.y, z: it.z, a: (it.a || 0) + Math.PI, s: q.w / KIT.kitchenCoffeeMachine.size.x } }));
  kp('kitchenFridgeLarge', (by.fridge || []).map(it => { const q = dims(it); return { x: it.x, z: it.z, a: (it.a || 0) + Math.PI, w: q.w, h: q.h, d: q.d } }));
  // in Kenney's TV and laptop the screen is the 'metal' part and the body is 'metalDark'
  kp('televisionModern', (by.screen || []).map(it => { const q = dims(it); return { x: it.x, y: q.y, z: it.z, a: (it.a || 0) + Math.PI, s: q.w / KIT.televisionModern.size.x } }), { mats: { metal: M.screen(), metalDark: std('tvBody', '#1C1E21', .4, .3) } });
  kp('loungeDesignSofa', (by.sofa || []).map(it => { const q = dims(it); return { x: it.x, z: it.z, a: (it.a || 0) + Math.PI, w: q.w, h: q.h, d: q.d } }), { mats: { carpetBlue: std('sofa', '#5A6470', .9) } });
}
// a stable 0..1 per (desk or item, slot) on this floor, so extra props never shift the rnd() sequence the rest depends on
function hz(i, k) {
  let h = 2166136261; for (let j = 0; j < floorKey.length; j++) h = Math.imul(h ^ floorKey.charCodeAt(j), 16777619);
  h ^= Math.imul(i + 1013, 0x9E3779B1) ^ Math.imul(k + 17, 0x85EBCA6B); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* ---------- campus street furniture in Studio: Polyfork models from patch.gg (CC BY 4.0, src/assets/patch/CREDITS.md) ---------- */
// takes the campus items, places the ones a model covers and returns the rest for the game's own builder
const CAMPUS_KIT = { tree: 'oakTree', lamp: 'lampPost', bench: 'parkBench', bikerack: 'bikeRack', planter: 'planterBox', bollard: 'bollard', flag: 'flagPole' };
function campusItems(items) {
  const lists = {}, rest = []; floorKey = 'campus'; // the same tree turns on every visit (the light bake saw them so)
  (items || []).forEach((it, i) => {
    const n = CAMPUS_KIT[it.t], k = n && KIT[n]; if (!k || !isFinite(it.x) || !isFinite(it.z)) { rest.push(it); return }
    const L = lists[n] || (lists[n] = []), a = it.a || 0, sz = k.size, h = it.h > 0 ? it.h : 0;
    if (it.t === 'tree') L.push({ x: it.x, z: it.z, a: hz(i, 1) * 6.283, s: (h || 4.5) / sz.y * (.94 + hz(i, 2) * .12) });
    else if (it.t === 'planter') { // a long planter is a row of square boxes
      const w = it.w > 0 ? it.w : 2, d = it.d > 0 ? it.d : 1, along = w >= d, n2 = Math.max(1, Math.round((along ? w : d) / (along ? d : w))), L2 = (along ? w : d) / n2;
      for (let j = 0; j < n2; j++) { const o = -(along ? w : d) / 2 + L2 * (j + .5), [x, z] = loc({ x: it.x, z: it.z, a }, along ? o : 0, along ? 0 : o); L.push({ x, z, a, w: along ? L2 : w, d: along ? d : L2, h: sz.y * (h || .6) / .6 }) }
    }
    else L.push({ x: it.x, z: it.z, a: a + Math.PI, s: ({ lamp: (h || 5) / sz.y, bollard: (h || .9) / sz.y, flag: (h || 8) / sz.y })[it.t] || (it.w > 0 ? it.w : sz.x) / sz.x });
  });
  for (const n in lists) placeKit(n, lists[n]);
  return rest;
}

/* ---------- desks: birch tops on graphite end frames (the RC car drives underneath), Kenney monitors, keyboards, mice ---------- */
// the tops are the game's desk instances (deskG), so a desk can still light up as a route target
function buildDesks(m){
  const desks=m.desks||[],mon=[],kb=[],mouse=[],lap=[],plants=[],drawn=[],clut={mug:[],takeawayCup:[],headphones:[],bookStack:[],cactus:[]};
  desks.forEach((d,i)=>{if(d.arr!=='hot'&&d.arr!=='lab'&&isFinite(d.x)&&isFinite(d.z))drawn.push(i)});
  deskInst=new Array(desks.length).fill(-1);instDesk=drawn.slice();drawn.forEach((di,k)=>deskInst[di]=k);
  deskG=IG(new THREE.BoxGeometry(1,.03,1),'desk',drawn.length,{colored:true});
  if(deskG.mesh&&deskG.mesh.material.isMeshStandardMaterial)pbrOn(deskG.mesh.material,'birch',true); // birch grain under the desk color (a route target still lights up)
  const legB=batch(UNITBOX,M.graphite(),{bake:1}),scrB=batch(UNITBOX,M.team(),{bake:1});
  desks.forEach((d,i)=>{
    if(!isFinite(d.x)||!isFinite(d.z))return;const w=d.w>0?d.w:1.56,dd=d.dd>0?d.dd:.78,it={x:d.x,z:d.z,a:d.a||0},sit=d.person>=0;
    if(deskInst[i]>=0){
      const put=(b,lx,y,lz,ww,hh,ddd,col)=>{const [x,z]=loc(it,lx,lz);b.add(x,y,z,ww,hh,ddd,d.a||0,col)};
      _q.setFromAxisAngle(YAX,d.a||0);_m.compose(_v.set(d.x,.76,d.z),_q,_s.set(w,1,dd));deskG.set(deskInst[i],_m);deskG.paint(deskInst[i],deskColor(i));
      for(const sx of [-1,1]){put(legB,sx*(w/2-.04),.37,0,.05,.74,dd-.1);put(legB,sx*(w/2-.04),.015,0,.07,.03,dd-.04)}
      if(d.arr==='bench')put(scrB,0,.775+.19,-(dd/2-.0125),w-.02,.38,.025,sit?mixh('#B4B8B2',teamColorOf(d.team),.5):'#B4B8B2');
    }
    const top=d.arr==='lab'?.9:d.arr==='hot'?.74:.775;
    if(!sit)return;
    // a little of each person's stuff (Polyfork models from patch.gg), picked per floor and desk without touching rnd()
    const odds=k=>hz(i,k),stuff=(n,lx,lz,s,k)=>{const [x,z]=loc(it,lx,lz);clut[n].push({x,y:top,z,a:(d.a||0)+Math.PI+(odds(k)-.5)*1.4,s})};
    if(d.arr==='hot'){const [x,z]=loc(it,0,-.02);lap.push({x,y:top,z,a:(d.a||0)+Math.PI,s:1.25});if(odds(1)<.35)stuff('takeawayCup',w/2-.2,.06,1.4,2);return}
    if(d.mon){const [x,z]=loc(it,0,-(dd/2-.2));mon.push({x,y:top,z,a:d.a||0,s:1.45})}
    {const [x,z]=loc(it,-.02,dd/2-.24);kb.push({x,y:top,z,a:(d.a||0)+Math.PI,s:1.5})}
    {const [x,z]=loc(it,.32,dd/2-.22);mouse.push({x,y:top,z,a:(d.a||0)+Math.PI,s:1.4})}
    if(d.arr!=='lab'&&rnd()<.35){const [x,z]=loc(it,-(w/2-.14),-(dd/2-.16));plants.push({x,y:top,z,a:rnd()*6,s:1.5+rnd()*.5,k:1+Math.floor(rnd()*3)})}
    if(d.arr==='lab')return;
    const cup=odds(3);if(cup<.38)stuff('mug',w/2-.2,dd/2-.36,1.4,4);else if(cup<.55)stuff('takeawayCup',w/2-.2,dd/2-.36,1.4,4);
    if(odds(5)<.25)stuff('headphones',-(w/2-.24),dd/2-.3,1.4,6);
    const back=odds(7);if(back<.22)stuff('bookStack',w/2-.22,-(dd/2-.2),1.3,8);else if(back<.34)stuff('cactus',w/2-.18,-(dd/2-.17),1.5,8);
  });
  deskG.commit();if(deskG.mesh)BAKE.reg(deskG.mesh,false);legB.done();scrB.done();
  // screens: a document, code or a chip layout, picked per desk
  {const kinds=['doc','code','code','chip','chip'],sb={};for(const k of new Set(kinds))sb[k]=batch(UNITPLANE,screenMat(k),{cast:false});
    for(const q of mon){const c=Math.cos(q.a),s=Math.sin(q.a);sb[kinds[Math.floor(rnd()*kinds.length)]].add(q.x+.084*s,q.y+.27,q.z+.084*c,.5,.29,1,q.a)}for(const k in sb)sb[k].done()}
  placeKit('computerScreen',mon,{mats:{metalDark:std('monBezel','#1C1E21',.4,.3),metal:std('monBack','#2E3135',.4,.5)}});
  placeKit('computerKeyboard',kb);placeKit('computerMouse',mouse);placeKit('laptop',lap,{mats:{metal:M.screen(),metalDark:std('lapBody','#3A3E44',.45,.5)}});
  for(const k of [1,2,3])placeKit('plantSmall'+k,plants.filter(p=>p.k===k));
  for(const n in clut)placeKit(n,clut[n],{cast:false});
}

/* ---------- pushable chairs: Kenney office chairs, bar stools and guest chairs, one instanced group per material ---------- */
// each chair keeps its set (kind) and its index in that set; the game moves chairs by setting their matrices
const CHK={task:'chairDesk',stool:'stoolBar',guest:'chairModernFrameCushion'},CHSEAT={task:.5,stool:.5,guest:.46};
const kindOf=c=>c.kind==='stool'?'stool':c.kind==='task'?'task':'guest';
function buildChairs(list){
  const all=[];
  for(const kind of ['task','stool','guest']){
    const mine=list.filter(c=>kindOf(c)===kind),name=CHK[kind],k=KIT[name];if(!mine.length||!k)continue;
    const b=k.box,s=CHSEAT[kind]/seatHeight(name),pre=new THREE.Matrix4().makeRotationY(Math.PI).multiply(new THREE.Matrix4().makeScale(s,s,s)).multiply(new THREE.Matrix4().makeTranslation(-(b.min.x+b.max.x)/2,-b.min.y,-(b.min.z+b.max.z)/2));
    const set={pre,ig:[]};
    for(const p of k.parts){
      const tint=/carpet/.test(p.mat),mat=tint?tintMat(p.mat):kind==='stool'&&p.mat==='wood'?M.steel():(KMAT[p.mat]||KMAT._defaultMat)();
      const g=IG(p.geo,'chair',mine.length,{mat,colored:tint});g.mesh.userData.chairList=mine;g.tint=tint;set.ig.push(g);all.push(g);
    }
    mine.forEach((c,i)=>{c.hs=set;c.hk=i});
  }
  return all;
}
function chairMatrix(c,M_,M2){BAKE.chair(c);M_.makeRotationY(c.a);M_.setPosition(c.x,0,c.z);M2.multiplyMatrices(M_,c.hs.pre);for(const g of c.hs.ig)g.set(c.hk,M2)}
function chairPaint(c,col){for(const g of c.hs.ig)if(g.tint)g.paint(c.hk,col)}

/* ---------- materials for everything else the game draws (cars, pets, people, ramps, the campus) ---------- */
function roleMat(role,co,glassy){
  const q=PBR[role]||PBR[ALIAS[role]]||PBR._,c=new THREE.Color(co||pal(role));
  if(role==='light'||role==='tail'||role==='led')return new THREE.MeshBasicMaterial({color:c.multiplyScalar(role==='light'?2.4:2.8)}); // above the bloom threshold
  if(role==='stripe')return new THREE.MeshBasicMaterial({color:c});
  const base={color:c,roughness:q[0],metalness:q[1],envMapIntensity:(q[3]==null?.75:q[3])*.55};
  if(role==='screen'){base.emissive=c.clone();base.emissiveIntensity=.8}
  if(glassy||role==='bwin'){base.transparent=true;base.opacity=role==='bwin'?.9:.2;base.depthWrite=role==='bwin'}
  if(q[2])return new THREE.MeshPhysicalMaterial(Object.assign(base,{clearcoat:q[2],clearcoatRoughness:.08}));
  return new THREE.MeshStandardMaterial(base);
}

/* ---------- light: image-based light from a soft room, a warm sun with soft shadows, a cool fill ---------- */
let env=null;
function environment(){if(env)return env;const pm=new THREE.PMREMGenerator(renderer);env=pm.fromScene(new RoomEnvironment(renderer),.04).texture;pm.dispose();return env}
cv.addEventListener('webglcontextrestored',()=>{if(!env)return;env=null;if(S&&S.hd)scene.environment=environment()});

/* ---------- post: AO, bloom, output; quality levels ---------- */
let composer=null,gtao=null,bloom=null,fxOn=false,aoScale=.75;
function post(){
  if(composer)return composer;
  const rt=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,samples:4});
  composer=new EffectComposer(renderer,rt);composer.addPass(new RenderPass(scene,camera));
  gtao=new GTAOPass(scene,camera,1,1);
  gtao.updateGtaoMaterial({radius:.5,distanceExponent:1.6,thickness:1.2,scale:1,samples:12});
  gtao.updatePdMaterial({lumaPhi:10,depthPhi:2,normalPhi:3,radius:4,rings:2,samples:8});
  {const gs=gtao.setSize.bind(gtao);gtao.setSize=(w,h)=>gs(Math.ceil(w*aoScale),Math.ceil(h*aoScale))}
  gtao.blendIntensity=1;
  // labels, tags and lines are not surfaces: keep them out of the AO pass
  {const ov=gtao.overrideVisibility.bind(gtao);gtao.overrideVisibility=()=>{ov();scene.traverse(o=>{if(o.isSprite||o.isLine||o.isPoints||o.userData.noAO)o.visible=false})}}
  composer.addPass(gtao);
  bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.3,.35,1.5);composer.addPass(bloom); // only true emissives (LEDs, lamps) pass the threshold
  // one NaN or infinite pixel would be blurred across the whole screen (a black flash): bloom ignores them
  {const m=bloom.materialHighPassFilter,a='vec4 texel = texture2D( tDiffuse, vUv );';if(m.fragmentShader.includes(a)){m.fragmentShader=m.fragmentShader.replace(a,a+' if(any(isnan(texel))||any(isinf(texel)))texel=vec4(0.0); texel=min(texel,vec4(64.0));');m.needsUpdate=true}}
  composer.addPass(new OutputPass());
  return composer;
}
const LEVELS=[
  {n:'High',msaa:4,ao:.75,post:true,cap:2},
  {n:'Balanced',msaa:0,ao:.5,post:true,cap:1.5},
  {n:'Low',msaa:0,ao:.5,post:false,cap:1.25},
  {n:'Lowest',msaa:0,ao:.5,post:false,cap:.8},   // Auto only: fewer pixels than the screen has
];
let qMode='auto',qLevel=TOUCH?2:0,qChanged=0,bootGrace=0;
{const q=store.get('rc-quality');if(q&&q!=='auto'&&LEVELS[+q]&&+q<3){qMode='fixed';qLevel=+q}}
function pixelRatio(){return S&&S.hd?Math.min(devicePixelRatio||1,LEVELS[qLevel].cap):DPR}
function applyQuality(i,user){
  qLevel=Math.max(0,Math.min(LEVELS.length-1,i));const L=LEVELS[qLevel];
  if(S&&S.hd){
    const c=post(),dpr=pixelRatio(),pr=L.msaa&&dpr>=1.75?0:L.msaa; // at very high density MSAA buys little
    for(const t of [c.renderTarget1,c.renderTarget2])if(t.samples!==pr){t.samples=pr;t.dispose()}
    aoScale=dpr>=1.5?L.ao*.67:L.ao;fxOn=L.post;bloom.enabled=L.post;gtao.enabled=L.post&&!BAKE.on; // baked light already holds the AO
  }else fxOn=false;
  if(aoBlobs)aoBlobs.visible=!fxOn&&!BAKE.on; // the soft blobs under furniture stand in for AO when it is off
  qChanged=performance.now();if(user)bootGrace=0;resize();qUI();
}
function setQuality(q){qMode=q==='auto'?'auto':'fixed';store.set('rc-quality',q);applyQuality(q==='auto'?qLevel:+q,true)}
// GPU time per frame, from the browser's GPU timer when it offers one (Chrome and Edge on most PCs and Macs do)
const gl=renderer.getContext(),TQ=gl.getExtension('EXT_disjoint_timer_query_webgl2'),qPend=[];
let gpuMs=-1,dtMs=16.7,slowFor=0,fastFor=0,acc=0,frames=0,fps=0;
function gpuPoll(){
  while(qPend.length&&gl.getQueryParameter(qPend[0],gl.QUERY_RESULT_AVAILABLE)){
    const q=qPend.shift();if(!gl.getParameter(TQ.GPU_DISJOINT_EXT)){const ms=gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6;gpuMs=gpuMs<0?ms:gpuMs*.92+ms*.08}gl.deleteQuery(q);
  }
}
// about once a second: below roughly 45 fps step down; with lots of GPU headroom for a while, step back up.
// A hidden tab, the editor or the first seconds after a build (shaders compile, shadows draw) don't count.
function autoQuality(dt){
  if(!S||!S.hd||qMode!=='auto'||performance.now()-qChanged<2500||performance.now()<bootGrace||document.hidden){slowFor=fastFor=0;return}
  const slow=gpuMs>=0?gpuMs>11:dtMs>22,fast=gpuMs>=0&&gpuMs<4.5;
  slowFor=slow?slowFor+dt:0;fastFor=fast?fastFor+dt:0;
  if(slowFor>3&&qLevel<LEVELS.length-1){applyQuality(qLevel+1);slowFor=0}
  else if(fastFor>8&&qLevel>0){applyQuality(qLevel-1);fastFor=0}
}
function qUI(){
  const box=$('quality');if(!box)return;$('qualityRow').hidden=!(S&&S.hd);
  box.querySelectorAll('.chip').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.q===(qMode==='auto'?'auto':String(qLevel)))));
  $('qnote').textContent=qMode==='auto'?`Auto is using ${LEVELS[qLevel].n}${LEVELS[qLevel].n==='Lowest'?' (reduced resolution)':''}${gpuMs>=0?` · ${fps} fps, GPU ${gpuMs.toFixed(1)} ms`:fps?` · ${fps} fps`:''}`:`${LEVELS[qLevel].n}, fixed${gpuMs>=0?` · ${fps} fps, GPU ${gpuMs.toFixed(1)} ms`:fps?` · ${fps} fps`:''}`;
}
function render(dt){BAKE.frame();
  FX.frame(dt);
  let tq=null;if(TQ&&qPend.length<6){tq=gl.createQuery();gl.beginQuery(TQ.TIME_ELAPSED_EXT,tq)}
  if(S.hd&&fxOn)composer.render(dt);else renderer.render(scene,camera);
  if(tq){gl.endQuery(TQ.TIME_ELAPSED_EXT);qPend.push(tq)}if(TQ)gpuPoll();dtMs=dtMs*.95+dt*1000*.05;
  acc+=dt;frames++;if(acc>1){fps=Math.round(frames/acc);autoQuality(acc);if(S.hd&&!$('stylePop').hidden)qUI();acc=0;frames=0}
}
function resizeFx(w,h){if(!composer||!S||!S.hd)return;composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(w,h)}

/* ---------- the floor, in HD ---------- */
const TYPES=new Set(['panel','table','rtable','bench','shelf','rack','scope','chamber','probe','cabinet','locker','reception','printer','whiteboard','elevdoor','booth','plant','counter','coffee','fridge','screen','sofa']);
function floor(m){
  seed=7;floorKey=m.key||'';
  ground(m);buildWalls(m.walls||[]);cores(m);
  buildItems((m.items||[]).filter(it=>TYPES.has(it.t)));
  buildDesks(m);
  return (m.items||[]).filter(it=>!TYPES.has(it.t)); // anything else is drawn by the game's own builder
}
// a new world: light it, and give Auto a few seconds before it judges the frame rate
function enter(){FX.clear();BAKE.enter();scene.environment=S.hd?environment():null;bootGrace=performance.now()+5000;gpuMs=-1}

loadKit();
return{floor,campusItems,enter,restyle:()=>applyQuality(qLevel),draw:()=>{if(S.hd&&fxOn)composer.render(1/60);else renderer.render(scene,camera)},buildChairs,chairMatrix,chairPaint,mat:roleMat,applyQuality,setQuality,pixelRatio,render,resizeFx,qUI,KIT,LEVELS,
  get quality(){return{mode:qMode,level:LEVELS[qLevel].n,gpuMs,fps,timer:!!TQ,fx:fxOn}},get passes(){return{composer,gtao,bloom}}};
})();
