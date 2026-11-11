/* ===================== game part 2b: coworkers at their desks (creatures, or seated figures) ===================== */
// Coworkers are creatures by default (dragons, dogs, robots...; PEOPLE in people.js picks one per desk); anyone can pick
// the simple seated person for themselves. Instanced: a few groups for the whole floor, not one mesh per person. A
// coworker rides their chair: push the chair and they roll away with it (a person's hands drop to their lap until the
// chair is tidied). Heads turn to watch you go by.
const FIG_SURF={lab:.9,hot:.74};                     // work-surface height per arrangement (desks are .775)
const FIG_SH=[[-.165,.955,.035],[.165,.955,.035]];    // shoulders, in the chair's frame (the sitter faces -z)
const FIG_HEAD=new V3(0,1.152,.035);
let figG=null,FIG=[],FIGP=[],figByChair=new Map(),figPick=new Map();
const figTurned=new Set();
const _FB=new THREE.Matrix4(),_FA=new THREE.Matrix4(),_FM=new THREE.Matrix4(),_FH=new THREE.Matrix4(),_FQ=new THREE.Quaternion(),_FV=new V3(),_FV2=new V3(),_FS=new V3(),_FD=new V3(),FIG_DOWN=new V3(0,-1,0);

// one BufferGeometry from several (position + normal only; each part already moved into place)
function mergeGeos(list){
  const parts=list.filter(Boolean).map(g=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();if(!n.attributes.normal)n.computeVertexNormals();return n});
  let len=0;for(const g of parts)len+=g.attributes.position.count*3;
  const pos=new Float32Array(len),nor=new Float32Array(len);let o=0;
  for(const g of parts){pos.set(g.attributes.position.array,o);nor.set(g.attributes.normal.array,o);o+=g.attributes.position.count*3;g.dispose()}
  const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.BufferAttribute(pos,3));out.setAttribute("normal",new THREE.BufferAttribute(nor,3));return out;
}
// Studio and Comic get smooth shapes; Neon, Blueprint and Vector draw edges, so they get low-poly shapes whose edges outline the figure
function figGeos(){
  // phones get a little less roundness (a floor can seat 200+ people)
  const sm=S.mat!=="basic",q=TOUCH?.75:1,sg=n=>Math.max(4,Math.round(n*q)),T=(g,x,y,z)=>{g.translate(x,y,z);return g},hemi=(r,y)=>{const g=new THREE.SphereGeometry(r,14,6,0,Math.PI*2,0,Math.PI/2);g.translate(0,y,0);return g};
  const G={};
  G.pants=mergeGeos([T(new THREE.BoxGeometry(.3,.13,.36),0,.585,-.08),T(cyl(.052,.046,.5,sm?10:6),-.085,.3,-.255),T(cyl(.052,.046,.5,sm?10:6),.085,.3,-.255)]);
  G.shoes=mergeGeos([T(new THREE.BoxGeometry(.1,.07,.19),-.085,.035,-.3),T(new THREE.BoxGeometry(.1,.07,.19),.085,.035,-.3)]);
  if(sm)G.torso=new THREE.LatheGeometry([[0,0],[.12,.005],[.15,.05],[.158,.14],[.155,.26],[.152,.36],[.14,.42],[.1,.455],[.04,.47],[0,.472]].map(([r,y])=>new THREE.Vector2(r,y)),sg(16));
  else{G.torso=new THREE.CylinderGeometry(.118,.15,.46,6);G.torso.translate(0,.23,0)}
  G.torso.scale(1,1,.8);G.torso.rotateX(-.08);G.torso.translate(0,.555,.045);
  G.arm=sm?cyl(.05,.046,1,8):new THREE.BoxGeometry(.09,1,.09);G.arm.translate(0,-.5,0);   // unit length, hangs from its joint
  G.joint=sm?new THREE.SphereGeometry(.05,sg(7),sg(5)):null;                                        // rounds off shoulders and elbows
  G.hand=sm?new THREE.SphereGeometry(.042,sg(8),sg(6)):null;
  G.head=sm?new THREE.SphereGeometry(.135,sg(16),sg(11)):new THREE.IcosahedronGeometry(.14,0);
  G.eyes=sm?mergeGeos([T(new THREE.SphereGeometry(.017,6,4),-.047,.012,-.122),T(new THREE.SphereGeometry(.017,6,4),.047,.012,-.122)]):null;
  G.glasses=sm?mergeGeos([T(new THREE.TorusGeometry(.029,.0055,4,12),-.047,.012,-.143),T(new THREE.TorusGeometry(.029,.0055,4,12),.047,.012,-.143),T(new THREE.BoxGeometry(.036,.006,.006),0,.016,-.145)]):null;
  G.badge=new THREE.BoxGeometry(.048,.064,.012);G.badge.rotateX(-.08);G.badge.translate(-.072,.87,-.095);
  if(sm){
    const cup=x=>{const g=cyl(.05,.05,.045,14);g.rotateZ(Math.PI/2);g.translate(x,0,0);return g};
    G.phones=mergeGeos([new THREE.TorusGeometry(.146,.014,6,20,Math.PI),cup(-.142),cup(.142)]);
    G.beanie=mergeGeos([hemi(.146,.035),T(cyl(.149,.149,.045,18),0,.055,0),T(new THREE.SphereGeometry(.03,8,6),0,.2,0)]);
    G.cap=mergeGeos([hemi(.143,.04),T(new THREE.BoxGeometry(.17,.014,.12),0,.045,-.165),T(new THREE.SphereGeometry(.014,6,4),0,.185,0)]);
  }else{
    G.phones=mergeGeos([new THREE.TorusGeometry(.15,.016,4,8,Math.PI),T(new THREE.BoxGeometry(.045,.09,.09),-.145,0,0),T(new THREE.BoxGeometry(.045,.09,.09),.145,0,0)]);
    G.beanie=mergeGeos([T(new THREE.CylinderGeometry(.11,.152,.13,6),0,.1,0)]);
    G.cap=mergeGeos([T(new THREE.CylinderGeometry(.13,.15,.08,6),0,.09,0),T(new THREE.BoxGeometry(.17,.014,.12),0,.055,-.17)]);
  }
  const handle=new THREE.TorusGeometry(.022,.006,6,10);handle.rotateY(Math.PI/2);
  G.mug=mergeGeos([T(cyl(.036,.033,.09,sm?14:6),0,.045,0),T(handle,.043,.048,0)]);
  return G;
}
/* ---------- creatures: the default coworkers (PEOPLE.SPECIES picks one per desk) ----------
   Each kind is drawn from simple shapes in two instanced pieces: the body (sat in the chair, paws on the desk) and the
   head (turns to watch you). Parts are either the coat, which every creature gets in its own color, or fixed details
   (eyes, horns, bellies, beaks) baked into vertex colors. One shader tweak lets both share a mesh: a vertex whose color is
   pure white takes the creature's coat color, any other vertex keeps its own. A scarf in the team's color marks the team. */
const CR_DK="#1E1F22",CR_WH="#F6F4EF",CR_PK="#E58C9A",CR_IV="#F1E6C8",CR_OR="#F28C38",CR_GD="#F2C14E";
const CR_HEAD=[0,1.12,.02],CR_NECK=[.965,1];
// per kind: build(P(body), H(head), shapes) and optional head pivot / neck [y, scale]
const CREATURE={
  dragon:{build(B,H,s){
    s.body(B,{belly:"#F2DB8E"});
    for(const k of[-1,1]){B("c",s.at(s.E(.02,.17,.12),k*.17,.93,.17,-.35,0,k*-.55));H("c",s.at(s.E(.015,.05,.04),k*.15,.04,.05,0,0,k*-.6))}
    [[1,.16],[.88,.205],[.76,.215]].forEach(([y,z])=>B(CR_OR,s.at(s.Co(.03,.08),0,y,z,1.2,0,0)));
    B("c",s.at(s.Co(.075,.5),0,.56,.42,1.85,0,0));B(CR_OR,s.at(s.Co(.035,.07),0,.5,.6,1.85,0,0));
    H("c",s.E(.16,.15,.16));H("c",s.at(s.E(.1,.075,.11),0,-.04,-.13));
    for(const k of[-1,1]){H(CR_DK,s.at(s.E(.012,.01,.01),k*.035,-.005,-.237));H(CR_IV,s.at(s.Co(.03,.13),k*.075,.14,.05,.55,0,k*-.35))}
    s.eyes(H,.068,.05,-.125,.03);
  }},
  dog:{build(B,H,s){
    s.body(B,{belly:"#EFE2CC"});B("c",s.at(s.Co(.035,.18),0,.66,.24,.5,0,0));
    H("c",s.E(.16,.15,.15));H("#EFE2CC",s.at(s.E(.085,.065,.085),0,-.05,-.12));H(CR_DK,s.at(s.E(.032,.024,.022),0,-.02,-.2));H(CR_PK,s.at(s.E(.028,.01,.03),0,-.1,-.15));
    for(const k of[-1,1])H("#6B4A33",s.at(s.E(.045,.1,.03),k*.15,-.01,.01,0,0,k*.3));
    s.eyes(H,.065,.04,-.13,.028);
  }},
  cat:{build(B,H,s){
    s.body(B,{belly:"#F1EDE6"});B("c",s.at(s.To(.15,.026,Math.PI*1.15),0,.72,.3,0,Math.PI/2,0));
    H("c",s.E(.155,.145,.145));H("#F4EFE6",s.at(s.E(.06,.04,.04),0,-.05,-.125));H(CR_PK,s.at(s.E(.016,.012,.01),0,-.025,-.148));
    for(const k of[-1,1]){H("c",s.at(s.Co(.055,.1),k*.085,.125,0,0,0,k*-.35));H(CR_PK,s.at(s.Co(.03,.06),k*.083,.12,-.028,0,0,k*-.35));
      H("#8BC34A",s.at(s.E(.03,.032,.016),k*.06,.03,-.128));H(CR_DK,s.at(s.E(.009,.025,.008),k*.06,.03,-.142));H(CR_WH,s.at(s.E(.008,.008,.005),k*.052,.042,-.146));
      if(s.sm)for(const w of[-1,1])H("#F4F1EA",s.at(s.Bx(.09,.004,.004),k*.1,-.045+w*.012,-.11,0,k*.35,k*w*.12))}
  }},
  fox:{build(B,H,s){
    s.body(B,{belly:"#F6F1E8",feet:"#3A2A22"});B("c",s.at(s.E(.09,.09,.22),0,.6,.36,.6,0,0));B("#F6F1E8",s.at(s.E(.065,.065,.08),0,.48,.53));
    H("c",s.E(.15,.14,.14));H("c",s.at(s.Co(.075,.17),0,-.04,-.16,-Math.PI/2,0,0));H("#F6F1E8",s.at(s.E(.1,.055,.08),0,-.065,-.1));H(CR_DK,s.at(s.E(.018,.016,.016),0,-.04,-.245));
    for(const k of[-1,1]){H("c",s.at(s.Co(.065,.15),k*.085,.14,.01,0,0,k*-.3));H("#3A2A22",s.at(s.Co(.035,.09),k*.083,.13,-.018,0,0,k*-.3))}
    s.eyes(H,.06,.03,-.122,.026);
  }},
  bear:{build(B,H,s){
    s.body(B,{belly:"#D9B892",bw:.21,bh:.25});
    H("c",s.E(.17,.16,.16));H("#D9B892",s.at(s.E(.08,.06,.07),0,-.055,-.125));H(CR_DK,s.at(s.E(.03,.022,.02),0,-.03,-.19));
    for(const k of[-1,1]){H("c",s.at(s.E(.055,.055,.035),k*.12,.12,0));H("#D9B892",s.at(s.E(.03,.03,.01),k*.12,.12,-.032))}
    s.eyes(H,.065,.035,-.14,.026);
  }},
  panda:{build(B,H,s){
    s.body(B,{arms:CR_DK,legs:CR_DK,bw:.2});B(CR_DK,s.at(s.E(.2,.06,.17),0,.9,.04));
    H("c",s.E(.17,.155,.16));H("c",s.at(s.E(.07,.05,.06),0,-.06,-.125));H(CR_DK,s.at(s.E(.028,.02,.018),0,-.035,-.185));
    for(const k of[-1,1]){H(CR_DK,s.at(s.E(.055,.055,.035),k*.12,.12,0));H(CR_DK,s.at(s.E(.045,.06,.025),k*.065,.025,-.14,0,0,k*.5));
      H(CR_WH,s.at(s.E(.014,.014,.008),k*.062,.035,-.163));H(CR_DK,s.at(s.E(.008,.008,.005),k*.062,.033,-.17))}
  }},
  bunny:{build(B,H,s){
    s.body(B,{belly:"#F6F2EC"});B("#F6F2EC",s.at(s.E(.065,.065,.06),0,.56,.22));
    H("c",s.E(.15,.14,.14));H("#F6F2EC",s.at(s.E(.06,.045,.045),0,-.05,-.12));H(CR_PK,s.at(s.E(.016,.012,.01),0,-.025,-.155));H(CR_WH,s.at(s.Bx(.03,.028,.008),0,-.085,-.148));
    for(const k of[-1,1]){H("c",s.at(s.E(.04,.15,.025),k*.055,.22,.02,-.15,0,k*-.15));H(CR_PK,s.at(s.E(.022,.11,.01),k*.055,.215,-.005,-.15,0,k*-.15))}
    s.eyes(H,.06,.025,-.12,.026);
  }},
  frog:{head:[0,1.08,.02],neck:[.93,1.1],build(B,H,s){
    s.body(B,{belly:"#E6F0B8",bw:.2,bh:.22,by:.72});
    H("c",s.at(s.E(.19,.12,.16),0,-.02,0));
    for(const k of[-1,1]){H("c",s.at(s.E(.065,.06,.06),k*.095,.09,-.04));H(CR_WH,s.at(s.E(.05,.05,.03),k*.098,.1,-.085));H(CR_DK,s.at(s.E(.025,.025,.012),k*.1,.1,-.115));H("#F2A0A8",s.at(s.E(.03,.018,.012),k*.13,-.04,-.11))}
    H(CR_DK,s.at(s.To(.1,.008,Math.PI*.7),0,.03,-.135,0,0,Math.PI*1.15));
  }},
  penguin:{head:[0,1.15,.02],neck:[.99,1],build(B,H,s){
    s.body(B,{belly:"#F4F2EE",bellyBig:true,bh:.26,by:.75,feet:"#F2A33A"});
    H("c",s.E(.15,.15,.15));H("#F4F2EE",s.at(s.E(.12,.11,.09),0,-.01,-.075));H("#F2A33A",s.at(s.Co(.035,.09),0,-.035,-.19,-Math.PI/2,0,0));
    s.eyes(H,.05,.03,-.152,.022);
  }},
  owl:{build(B,H,s){
    s.body(B,{belly:"#E8D9C0",bh:.25,feet:"#C98A2E"});
    H("c",s.E(.17,.16,.15));H("#E8D9C0",s.at(s.E(.14,.12,.07),0,-.005,-.095));H("#C98A2E",s.at(s.Co(.022,.06),0,-.045,-.17,Math.PI*.9,0,0));
    for(const k of[-1,1]){H("#F2B33D",s.at(s.E(.05,.05,.025),k*.06,.015,-.158));H(CR_DK,s.at(s.E(.028,.028,.012),k*.06,.015,-.178));H(CR_WH,s.at(s.E(.009,.009,.005),k*.05,.028,-.189));
      H("c",s.at(s.Co(.035,.09),k*.1,.15,0,0,0,k*-.45))}
  }},
  robot:{neck:[.95,1.25],build(B,H,s){
    s.body(B,{box:true,bw:.17,bh:.2,bd:.14,belly:"#2A2E35",paws:"#5A616B",feet:"#5A616B"});
    [["#E4572E",-.045],["#4FD1C5",0],[CR_GD,.045]].forEach(([c,x])=>B(c,s.at(s.E(.018,.018,.01),x,.79,-.108)));
    H("c",s.Bx(.3,.24,.26));H("#1E2530",s.at(s.Bx(.24,.09,.01),0,.02,-.131));H("#3A4048",s.at(s.Bx(.12,.025,.01),0,-.07,-.131));
    H("#3A4048",s.at(s.Cy(.008,.008,.12),0,.18,0));H("#E4572E",s.at(s.E(.026,.026,.026),0,.25,0));
    for(const k of[-1,1]){H("#5CE1FF",s.at(s.E(.03,.025,.01),k*.06,.02,-.139));H("#5A616B",s.at(s.Cy(.035,.035,.03),k*.16,0,0,0,0,Math.PI/2))}
  }},
  unicorn:{build(B,H,s){
    s.body(B,{});
    ["#F28CB1",CR_GD,"#7FB2F0"].forEach((c,i)=>B(c,s.at(s.E(.045,.045,.1),(i-1)*.03,.6-i*.04,.3+i*.03,.6,0,0)));
    H("c",s.E(.15,.145,.15));H("c",s.at(s.E(.085,.075,.1),0,-.06,-.12));H(CR_GD,s.at(s.Co(.03,.18),0,.17,-.06,-.35,0,0));
    for(const k of[-1,1]){H("c",s.at(s.Co(.035,.08),k*.075,.13,.03,0,0,k*-.3));H("#C9A9C9",s.at(s.E(.01,.008,.008),k*.03,-.05,-.218))}
    ["#F28CB1",CR_GD,"#7FD1AE","#7FB2F0","#B69CF0"].forEach((c,i)=>H(c,s.at(s.E(.05,.05,.05),0,.14-i*.05,.07+i*.025)));
    s.eyes(H,.062,.035,-.125,.025);
  }},
  dino:{build(B,H,s){
    s.body(B,{belly:"#EFE3B8",shortArms:true});
    B("c",s.at(s.Co(.09,.45),0,.57,.4,1.9,0,0));
    [[.99,.15],[.89,.2],[.78,.22],[.66,.3]].forEach(([y,z])=>B("#F5E6B0",s.at(s.Co(.035,.07),0,y,z,1.1,0,0)));
    H("c",s.at(s.E(.14,.13,.19),0,0,-.04));H("c",s.at(s.E(.12,.055,.16),0,-.08,-.07));
    for(const k of[-1,0,1])H(CR_WH,s.at(s.Co(.011,.03),k*.04,-.045,-.21,Math.PI,0,0));
    for(const k of[-1,1])H(CR_DK,s.at(s.E(.01,.008,.008),k*.03,.03,-.222));
    s.eyes(H,.085,.06,-.09,.026);
  }},
  alien:{neck:[.93,.9],build(B,H,s){
    s.body(B,{bw:.17,bh:.22,by:.72});
    H("c",s.at(s.E(.17,.2,.16),0,.04,0));H(CR_DK,s.at(s.E(.02,.006,.005),0,-.09,-.142));
    for(const k of[-1,1]){H(CR_DK,s.at(s.E(.045,.07,.02),k*.07,.03,-.145,0,k*-.3,k*.5));H(CR_WH,s.at(s.E(.012,.012,.006),k*.06,.06,-.163));
      H("c",s.at(s.Cy(.007,.007,.14),k*.06,.25,0,0,0,k*-.35));H(CR_GD,s.at(s.E(.025,.025,.025),k*.085,.316,0))}
  }},
};
// shapes (smooth for the shaded styles, low-poly for the line-art ones, whose edges then outline the creature)
function crShapes(sm){
  const q=TOUCH?.75:1,u=n=>Math.max(4,Math.round(n*q)),S1=sm?u(14):6,S2=sm?u(10):4;
  const s={sm,
    // detail follows size: eyes and nostrils don't need the body's roundness (a floor can seat 250 creatures)
    E:(rx,ry,rz)=>{const m=Math.max(rx,ry,rz),k=!sm||m>.1?1:m>.045?.7:.5,g=new THREE.SphereGeometry(1,Math.max(5,Math.round(S1*k)),Math.max(4,Math.round(S2*k)));g.scale(rx,ry,rz);return g},
    Co:(r,h)=>new THREE.ConeGeometry(r,h,sm?u(10):5),
    Cy:(a,b,h)=>new THREE.CylinderGeometry(a,b,h,sm?u(10):5),
    Bx:(w,h,d)=>new THREE.BoxGeometry(w,h,d),
    To:(R,r,arc)=>new THREE.TorusGeometry(R,r,sm?6:4,sm?u(18):8,arc),
    // rotate (x, y, z order as three's Euler) then move
    at:(g,x,y,z,rx,ry,rz)=>{if(rx||ry||rz)g.applyMatrix4(_FM.makeRotationFromEuler(new THREE.Euler(rx||0,ry||0,rz||0)));g.translate(x,y,z);return g},
    // two eyes facing forward: a dark eye and a small highlight
    eyes:(H,x,y,z,r)=>{for(const k of[-1,1]){H(CR_DK,s.at(s.E(r,r*1.12,r*.6),k*x,y,z));H(CR_WH,s.at(s.E(r*.34,r*.34,r*.2),k*x-k*r*.3,y+r*.42,z-r*.45))}},
    // the seated body: an egg (or a box) on the seat, a belly, thighs and feet over the seat's front edge, arms to the desk
    body:(B,o)=>{
      const by=o.by||.74,bw=o.bw||.19,bh=o.bh||.24,bd=o.bd||.17;
      B("c",o.box?s.at(s.Bx(bw*2,bh*2,bd*2),0,by,.04):s.at(s.E(bw,bh,bd),0,by,.04));
      if(o.belly)B(o.belly,o.box?s.at(s.Bx(bw*1.2,bh*1.1,.02),0,by-.01,.04-bd-.008):o.bellyBig?s.at(s.E(bw*.8,bh*.85,bd*.6),0,by-.02,-.05):s.at(s.E(bw*.72,bh*.75,bd*.55),0,by-.03,-.04));
      const lc=o.legs||"c",fc=o.feet||lc,ac=o.arms||"c",pc=o.paws||ac;
      for(const k of[-1,1]){
        B(lc,o.box?s.at(s.Bx(.11,.1,.2),k*.095,.565,-.12):s.at(s.E(.068,.06,.11),k*.095,.565,-.12));
        B(fc,o.box?s.at(s.Bx(.1,.06,.12),k*.095,.53,-.25):s.at(s.E(.055,.04,.07),k*.095,.53,-.25));
        if(o.shortArms){B(ac,s.at(s.E(.035,.07,.035),k*.15,.83,-.13,1.2,0,0));B(pc,s.at(s.E(.03,.025,.03),k*.15,.81,-.19))}
        else{B(ac,o.box?s.at(s.Cy(.035,.035,.29),k*.155,.845,-.16,1.33,0,0):s.at(s.E(.05,.15,.05),k*.155,.845,-.16,1.33,0,0));
          B(pc,o.box?s.at(s.Bx(.07,.05,.07),k*.14,.81,-.3):s.at(s.E(.045,.04,.05),k*.14,.81,-.3))}
      }
    }};
  return s;
}
// one geometry from colored parts: position, normal, and color (white = the coat)
function crMerge(parts){
  const list=parts.map(([c,g])=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();if(!n.attributes.normal)n.computeVertexNormals();return[c,n]});
  let len=0;for(const[,g]of list)len+=g.attributes.position.count*3;
  const pos=new Float32Array(len),nor=new Float32Array(len),col=new Float32Array(len),cc=new THREE.Color();let o=0;
  for(const[c,g]of list){
    pos.set(g.attributes.position.array,o);nor.set(g.attributes.normal.array,o);
    if(c==="c")cc.setRGB(1,1,1);else{cc.set(c);if(Math.min(cc.r,cc.g,cc.b)>.99)cc.multiplyScalar(.97)} // a fixed white must not read as the coat
    for(let k=0;k<g.attributes.position.count;k++){col[o+k*3]=cc.r;col[o+k*3+1]=cc.g;col[o+k*3+2]=cc.b}
    o+=g.attributes.position.count*3;g.dispose();
  }
  const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.BufferAttribute(pos,3));out.setAttribute("normal",new THREE.BufferAttribute(nor,3));out.setAttribute("color",new THREE.BufferAttribute(col,3));return out;
}
// head parts are listed around the head pivot; body parts in the chair's frame
function creatureGeo(kind,sm){
  const b=[],h=[],s=crShapes(sm);CREATURE[kind].build((c,g)=>b.push([c,g]),(c,g)=>h.push([c,g]),s);
  return{b:crMerge(b),h:crMerge(h)};
}
function scarfGeo(sm){
  const r=new THREE.TorusGeometry(.095,.042,sm?8:4,sm?20:8);r.rotateX(Math.PI/2);r.scale(1,.8,1);
  const t=new THREE.BoxGeometry(.06,.13,.022);t.rotateZ(.18);t.translate(.055,-.075,-.1);
  return mergeGeos([r,t]);
}
// the coat color goes only where a vertex is pure white (see the note above)
const COAT_VS="#if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )\n\tvColor = color * mix( vec3( 1.0 ), instanceColor.xyz, step( 0.999, min( color.r, min( color.g, color.b ) ) ) );\n#else\n#include <color_vertex>\n#endif";
function coatMat(){const m=mat("figure");if(!("vertexColors" in m)||!m.color)return m;m.vertexColors=true;m.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace("#include <color_vertex>",COAT_VS)};m.customProgramCacheKey=()=>"coat-mask";return m}
const crCoat=f=>{const cs=PEOPLE.coatsOf(f.look.kind);return cs.some(c=>c[0]===f.look.coat)?f.look.coat:cs.length?cs[0][0]:"#9AA0A6"};
const figBase=(f,M)=>{const c=f.ch;M.makeRotationY(c.a);M.setPosition(c.x,0,c.z);return M};
// the shirt you see: team color unless they picked one; a lab coat covers it
function figShirt(f){return f.look.labCoat?"#F2F1EC":f.look.shirt==="team"?teamColorOf(f.d.team):f.look.shirt}
function figTone(f){return f.look.tone===PEOPLE.DEFAULT_TONE&&S.mat==="toon"?"#DCE0EA":f.look.tone}

function buildFigures(){
  figReset();
  if(WKIND!=="floor"||!root||!WM)return;
  const desks=WM.desks||[],people=WM.people||[];
  for(const c of chairs){
    if(c.desk<0)continue;const d=desks[c.desk];if(!d||d.person<0||!people[d.person])continue;
    const key=WKEY+"|"+d.id,look=PEOPLE.merge(PEOPLE.defaultLook(key,d.arr),LOOKS.get(key));
    const f={ch:c,di:c.desk,d,key,look,yaw:0,tyaw:0,n:-1,hat:-1,gl:-1,mug:-1,sp:null,ci:-1,si:-1};FIG.push(f);figByChair.set(c,f);
  }
  const G=figGeos(),cnt={phones:0,beanie:0,cap:0,glasses:0,mug:0},bySp=new Map();let nC=0;
  for(const f of FIG){
    if(f.look.mug&&f.d.arr!=="lab")f.mug=cnt.mug++;
    if(f.look.kind!=="person"&&CREATURE[f.look.kind]){const l=bySp.get(f.look.kind)||[];f.sp=f.look.kind;f.kb="cb_"+f.sp;f.kh="ch_"+f.sp;f.ci=l.length;l.push(f);bySp.set(f.sp,l);f.si=nC++;continue}
    f.n=FIGP.length;FIGP.push(f);
    if(f.look.hat!=="none")f.hat=cnt[f.look.hat]++;
    if(f.look.glasses&&G.glasses)f.gl=cnt.glasses++;
  }
  const n=FIGP.length,faces=!S.faceIsBg&&!S.depthOnly,o=(x)=>Object.assign({colored:true},x);
  figG={
    pants:IG(G.pants,"pants",n,o()),shoes:IG(G.shoes,"shoe",n,o({noCast:1})),torso:IG(G.torso,"shirt",n,o()),arm:IG(G.arm,"shirt",n*4,o()),joint:G.joint?IG(G.joint,"shirt",n*4,o({noCast:1})):NOOP_G,
    hand:G.hand?IG(G.hand,"figure",n*2,o({noCast:1})):NOOP_G,head:IG(G.head,"figure",n,o()),
    eyes:G.eyes&&faces?IG(G.eyes,"eye",n,{noCast:1,noHull:1}):(G.eyes&&G.eyes.dispose(),NOOP_G),
    glasses:G.glasses&&faces?IG(G.glasses,"eye",cnt.glasses,{noCast:1,noHull:1}):(G.glasses&&G.glasses.dispose(),NOOP_G),
    badge:IG(G.badge,"badge",n,o({noCast:1,noHull:1})),
    phones:IG(G.phones,"hat",cnt.phones,o()),beanie:IG(G.beanie,"hat",cnt.beanie,o()),cap:IG(G.cap,"hat",cnt.cap,o()),
    mug:IG(G.mug,"mug",cnt.mug,o({noCast:1})),
    scarf:IG(scarfGeo(S.mat!=="basic"),"shirt",nC,o({noCast:1})),
  };
  // creatures: two groups per kind on this floor; the coat color rides on the vertex colors (shaded styles only)
  const vc=faces&&S.mat!=="basic";
  for(const [sp,list] of bySp){const g=creatureGeo(sp,S.mat!=="basic");figG["cb_"+sp]=IG(g.b,"figure",list.length,o(vc?{mat:coatMat()}:{}));figG["ch_"+sp]=IG(g.h,"figure",list.length,o(vc?{mat:coatMat()}:{}));
    for(const k of["cb_","ch_"])if(figG[k+sp].mesh)figPick.set(figG[k+sp].mesh,list)}
  if(figG.torso.mesh)figPick.set(figG.torso.mesh,FIGP);if(figG.head.mesh)figPick.set(figG.head.mesh,FIGP);
  // Neon night: dark faces with colored edges (shirts in the team color, hats and mugs in their own)
  const neon=faces&&S.mat==="basic",dark=pal("chair"),P=(g,i,hex)=>g.paint(i,neon?dark:hex),E=(g,i,hex)=>{if(S.teamEdges)g.edge(i,bright(hex))};
  for(const f of FIGP){
    const L=f.look,sh=figShirt(f),tone=figTone(f),i=f.n,team=teamColorOf(f.d.team);
    P(figG.pants,i,L.pants);P(figG.shoes,i,L.shoes);P(figG.torso,i,sh);E(figG.torso,i,team);P(figG.head,i,tone);P(figG.badge,i,team);E(figG.badge,i,team);
    for(let s=0;s<4;s++){P(figG.arm,4*i+s,sh);E(figG.arm,4*i+s,team);P(figG.joint,4*i+s,sh)}for(let s=0;s<2;s++)P(figG.hand,2*i+s,tone);
    if(f.hat>=0){P(figG[L.hat],f.hat,L.hatColor);E(figG[L.hat],f.hat,L.hatColor)}
  }
  for(const f of FIG){
    const L=f.look;
    if(f.mug>=0){const d=f.d,dd=d.dd>0?d.dd:.78;_FA.makeRotationY(d.a||0);_FA.setPosition(d.x,FIG_SURF[d.arr]||.775,d.z);_FM.makeTranslation(.34,0,dd/2-.17);_FB.multiplyMatrices(_FA,_FM);figG.mug.set(f.mug,_FB);P(figG.mug,f.mug,L.mugColor);E(figG.mug,f.mug,L.mugColor)}
    if(f.sp){const coat=crCoat(f),team=teamColorOf(f.d.team);P(figG[f.kb],f.ci,coat);P(figG[f.kh],f.ci,coat);E(figG[f.kb],f.ci,team);P(figG.scarf,f.si,team);E(figG.scarf,f.si,team)}
  }
  FIG.forEach(figPose);figCommit();
}
// put one figure where its chair is now
function figPose(f){
  const c=f.ch;
  if(!figG)return;
  if(f.sp){const B=figBase(f,_FB),nk=CREATURE[f.sp].neck||CR_NECK;figG[f.kb].set(f.ci,B);
    _FA.makeTranslation(0,nk[0],.02);_FA.scale(_FS.set(nk[1],nk[1],nk[1]));_FM.multiplyMatrices(B,_FA);figG.scarf.set(f.si,_FM);figHead(f,B);return}
  const B=figBase(f,_FB),G=figG,i=f.n;
  G.torso.set(i,B);G.pants.set(i,B);G.shoes.set(i,B);G.badge.set(i,B);
  // typing at the desk (elbows in, forearms out to the keyboard), or hands in the lap once the chair has rolled away
  const lap=Math.hypot(c.x-c.hx,c.z-c.hz)>.14||Math.abs(angDiff(c.a,c.ha))>.45,surf=FIG_SURF[f.d.arr]||.775;
  for(let s=0;s<2;s++){
    const sx=Math.sign(FIG_SH[s][0]);
    FIG_J[0].set(FIG_SH[s][0],FIG_SH[s][1],FIG_SH[s][2]);
    if(lap){FIG_J[1].set(sx*.2,.72,-.03);FIG_J[2].set(sx*.12,.69,-.21)}
    else{const lift=clamp((surf-.775)*.9,-.05,.12);FIG_J[1].set(sx*.205,.8+lift,-.07);FIG_J[2].set(sx*.13,surf+.05,-.4)}
    for(let k=0;k<2;k++){
      _FD.subVectors(FIG_J[k+1],FIG_J[k]);const len=_FD.length();_FD.divideScalar(len);_FQ.setFromUnitVectors(FIG_DOWN,_FD);
      _FA.compose(FIG_J[k],_FQ,_FS.set(1,Math.max(.03,len),1));_FM.multiplyMatrices(B,_FA);G.arm.set(4*i+2*s+k,_FM);
      _FA.makeTranslation(FIG_J[k].x,FIG_J[k].y,FIG_J[k].z);_FM.multiplyMatrices(B,_FA);G.joint.set(4*i+2*s+k,_FM);
    }
    _FA.makeTranslation(FIG_J[2].x,FIG_J[2].y,FIG_J[2].z);_FM.multiplyMatrices(B,_FA);G.hand.set(2*i+s,_FM);
  }
  figHead(f,B);
}
const FIG_J=[new V3(),new V3(),new V3()];
function figHead(f,B){
  if(f.sp){const p=CREATURE[f.sp].head||CR_HEAD;_FH.makeRotationY(f.yaw);_FH.setPosition(p[0],p[1],p[2]);_FM.multiplyMatrices(B,_FH);figG[f.kh].set(f.ci,_FM);return}
  const G=figG,i=f.n;_FH.makeRotationY(f.yaw);_FH.setPosition(FIG_HEAD);_FM.multiplyMatrices(B,_FH);
  G.head.set(i,_FM);G.eyes.set(i,_FM);if(f.gl>=0)G.glasses.set(f.gl,_FM);if(f.hat>=0)G[f.look.hat].set(f.hat,_FM);
}
function figCommit(){if(figG)for(const k in figG)figG[k].commit()}
function figChair(ch){const f=figByChair.get(ch);if(f)figPose(f)}
function figAll(){FIG.forEach(figPose)}
// clearRoot already disposed everything under root: just forget it
function figReset(){figG=null;FIG=[];FIGP=[];figByChair=new Map();figPick=new Map();figTurned.clear()}
// a look changed: rebuild only the figures (the rest of the floor stays)
function rebuildFigures(){
  if(WKIND!=="floor"||!root)return;
  if(figG){const dead=new Set();for(const k in figG){const g=figG[k];for(const o of [g.mesh,g.hull,g.lines]){if(!o)continue;if(o.parent)o.parent.remove(o);o.geometry.dispose();if(o.material!==HULL){dead.add(o.material);o.material.dispose()}}}lineMats=lineMats.filter(m=>!dead.has(m))}
  buildFigures();
}
// which desk a ray hit on a figure points at (-1 if none)
function figDeskOf(h){if(!figG||!h)return -1;const L=figPick.get(h.object),f=L&&L[h.instanceId];return f?f.di:-1}
function figMeshes(){return figG?[...figPick.keys()]:[]}
// heads turn toward you when you drive or walk past (within about 3 m), then drift back to their screens
function figFrame(dt){
  if(!FIG.length||WKIND!=="floor")return;
  let tx=null,tz=null;
  if(mode==="drive"&&!fly){tx=me.x;tz=me.z}else if(mode==="walk"&&!fly){tx=walker.x;tz=walker.z}
  const want=new Set();
  if(tx!=null&&!REDUCED)for(const c of chairsNear(tx,tz,3.2)){const f=figByChair.get(c);if(!f)continue;const dx=tx-c.x,dz=tz-c.z,dist=Math.hypot(dx,dz);if(dist>3.2||dist<.08)continue;f.tyaw=clamp(angDiff(c.a,Math.atan2(-dx,-dz)),-1.15,1.15);want.add(f)}
  for(const f of figTurned)if(!want.has(f))f.tyaw=0;
  for(const f of want)figTurned.add(f);
  if(!figTurned.size)return;
  const k=1-Math.exp(-dt*5);
  for(const f of figTurned){
    let ny=f.yaw+(f.tyaw-f.yaw)*k;const done=f.tyaw===0&&Math.abs(ny)<.003;if(done)ny=0;
    if(ny!==f.yaw){f.yaw=ny;if(figG)figHead(f,figBase(f,_FB))}
    if(done)figTurned.delete(f);
  }
}

/* ---------- claims: "This is me" and each person's own look ----------
   Shared: db looks/<uid> = {w, desk, name, look, at} (rules: everyone reads; you write only your own doc; editors can
   remove one). With sample people, or a view that can't save to the page, your look stays in this browser only. */
let LOOKS=new Map(),lookWinners=new Map(),lookStatus=new Map(),lookDocs=[],lookNames=new Map(),lookNamesBusy=false,lookNamesPending=false;
const LOCAL_LOOK="rc-mylook";
addEventListener("storage",e=>{if(e.key===LOCAL_LOOK)recomputeLooks()});
const lookShared=()=>!!(db&&myId&&DATA&&!DATA.demo);
const myLookUid=()=>lookShared()?myId:"local";
function localClaim(){let v=null;try{v=JSON.parse(store.get(LOCAL_LOOK)||"null")}catch(_){}const c=PEOPLE.validClaim(v);return c?Object.assign(c,{uid:"local"}):null}
function myClaimNow(){return lookShared()?lookDocs.find(c=>c.uid===myId)||null:localClaim()}
function claimsNow(){if(lookShared())return lookDocs;const l=localClaim();return l?[l]:[]}
function peopleOn(w){const m=floorKeys().includes(w)?modelFor(w):null;if(!m)return null;const out=[];(m.desks||[]).forEach(d=>{const p=d.person>=0&&m.people[d.person];if(p)out.push({desk:d.id,name:p.name})});return out}
function watchLooks(){
  if(!db)return;
  try{db.collection("looks").limit(1000).onSnapshot(s=>{lookDocs=s.docs.map(d=>{const c=PEOPLE.validClaim(d.data());return c&&Object.assign(c,{uid:d.id})}).filter(Boolean);recomputeLooks()},()=>{})}catch(_){}
}
// settle every claim against today's seating, then redraw this floor's figures if any of them changed
function recomputeLooks(){
  if(!DATA)return;
  const claims=claimsNow(),keys=floorKeys();
  const r=PEOPLE.resolve(claims,c=>PEOPLE.locate(c,peopleOn,keys),c=>{const n=lookNames.get(c.uid);return!!n&&PEOPLE.norm(n)===PEOPLE.norm(c.name)});
  const next=new Map();for(const [k,c] of r.winners)next.set(k,c.look);
  const prev=LOOKS;LOOKS=next;lookWinners=r.winners;lookStatus=r.status;
  if(WKIND==="floor"){const pre=WKEY+"|",sig=m=>k=>JSON.stringify(m.get(k)||null);let here=false;for(const k of new Set([...prev.keys(),...next.keys()]))if(k.startsWith(pre)&&sig(prev)(k)!==sig(next)(k)){here=true;break}if(here)rebuildFigures()}
  lookProfiles(lookDocs);
  if(typeof onLooksChanged==="function")onLooksChanged();
}
// claimants' own profile names decide a tie (fetched once per id; names are never stored)
async function lookProfiles(claims){
  if(!user)return;if(lookNamesBusy){lookNamesPending=true;return}
  const ids=[...new Set(claims.map(c=>c.uid))].filter(id=>id!=="local"&&!lookNames.get(id));if(!ids.length)return;
  lookNamesBusy=true;lookNamesPending=false;let changed=false;
  try{const ps=await user.profiles(ids);for(const id of ids){const n=(ps[id]&&ps[id].name)||"";if(n&&n!==lookNames.get(id)){lookNames.set(id,n);changed=true}}}catch(_){}
  lookNamesBusy=false;if(changed||lookNamesPending){lookNamesPending=false;recomputeLooks()}
}
// whose desk this is, as far as looks go: "mine", "taken" (someone else's claim holds it) or "open"
function deskClaimState(it){
  if(!it||it.kind!=="desk")return null;const key=it.w+"|"+it.id.slice(5),win=lookWinners.get(key);
  if(!win)return"open";if(win.uid===myLookUid())return"mine";
  const meNamed=lookShared()&&!!myName&&PEOPLE.norm(myName)===PEOPLE.norm(it.name),theyNamed=PEOPLE.norm(lookNames.get(win.uid)||"")===PEOPLE.norm(win.name);
  return meNamed&&!theyNamed?"open":"taken";
}
// my claimed desk as a Find item (null when I have no claim, or it no longer matches anyone)
function myClaimItem(){
  const st=lookStatus.get(myLookUid());if(!st||!st.key||st.state==="taken")return null;
  const i=st.key.indexOf("|"),w=st.key.slice(0,i),id="desk:"+st.key.slice(i+1);
  return buildIndex().find(x=>x.w===w&&x.id===id)||null;
}
