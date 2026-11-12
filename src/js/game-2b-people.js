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
    // (arms and paws carry their side, -1 or 1: the idle shader moves them about the shoulder)
    body:(B,o)=>{
      if(s.stand)return s.standBody(B,o);
      const by=o.by||.74,bw=o.bw||.19,bh=o.bh||.24,bd=o.bd||.17;
      B("c",o.box?s.at(s.Bx(bw*2,bh*2,bd*2),0,by,.04):s.at(s.E(bw,bh,bd),0,by,.04));
      if(o.belly)B(o.belly,o.box?s.at(s.Bx(bw*1.2,bh*1.1,.02),0,by-.01,.04-bd-.008):o.bellyBig?s.at(s.E(bw*.8,bh*.85,bd*.6),0,by-.02,-.05):s.at(s.E(bw*.72,bh*.75,bd*.55),0,by-.03,-.04));
      const lc=o.legs||"c",fc=o.feet||lc,ac=o.arms||"c",pc=o.paws||ac;
      for(const k of[-1,1]){
        B(lc,o.box?s.at(s.Bx(.11,.1,.2),k*.095,.565,-.12):s.at(s.E(.068,.06,.11),k*.095,.565,-.12));
        B(fc,o.box?s.at(s.Bx(.1,.06,.12),k*.095,.53,-.25):s.at(s.E(.055,.04,.07),k*.095,.53,-.25));
        if(o.shortArms){B(ac,s.at(s.E(.035,.07,.035),k*.15,.83,-.13,1.2,0,0),k);B(pc,s.at(s.E(.03,.025,.03),k*.15,.81,-.19),k)}
        else{B(ac,o.box?s.at(s.Cy(.035,.035,.29),k*.155,.845,-.16,1.33,0,0):s.at(s.E(.05,.15,.05),k*.155,.845,-.16,1.33,0,0),k);
          B(pc,o.box?s.at(s.Bx(.07,.05,.07),k*.14,.81,-.3):s.at(s.E(.045,.04,.05),k*.14,.81,-.3),k)}
      }
    },
    // standing, for a coworker who gets up and walks: the same body on two legs, arms at its sides. It is built in the seated
    // frame like everything else and walkerGeo() then moves the whole creature down by WALK_DY (there is no chair under it),
    // so tails, wings and heads keep their places. Legs and feet carry limb code ±1, arms and paws ±2 (the walk shader
    // swings them about the hip and shoulder heights left in s.hipY / s.shY).
    standBody:(B,o)=>{
      const by=o.by||.74,bw=o.bw||.19,bh=o.bh||.24,bd=o.bd||.17,D=-WALK_DY,hip=by-bh+.04,lo=D+.03;
      s.hipY=hip+WALK_DY;s.shY=by+bh*.4+WALK_DY;
      B("c",o.box?s.at(s.Bx(bw*2,bh*2,bd*2),0,by,.04):s.at(s.E(bw,bh,bd),0,by,.04));
      if(o.belly)B(o.belly,o.box?s.at(s.Bx(bw*1.2,bh*1.1,.02),0,by-.01,.04-bd-.008):o.bellyBig?s.at(s.E(bw*.8,bh*.85,bd*.6),0,by-.02,-.05):s.at(s.E(bw*.72,bh*.75,bd*.55),0,by-.03,-.04));
      const lc=o.legs||"c",fc=o.feet||lc,ac=o.arms||"c",pc=o.paws||ac;
      for(const k of[-1,1]){
        B(lc,o.box?s.at(s.Bx(.1,hip-lo,.11),k*.09,(hip+lo)/2,.04):s.at(s.E(.065,(hip-lo)/2+.02,.065),k*.09,(hip+lo)/2,.04),k);
        B(fc,o.box?s.at(s.Bx(.1,.06,.15),k*.09,D+.03,-.01):s.at(s.E(.06,.035,.085),k*.09,D+.035,-.01),k);
        if(o.shortArms){B(ac,s.at(s.E(.035,.07,.035),k*.15,.83,-.13,1.2,0,0),2*k);B(pc,s.at(s.E(.03,.025,.03),k*.15,.81,-.19),2*k)}
        else{B(ac,o.box?s.at(s.Cy(.035,.035,.26),k*(bw+.04),by-.02,.04):s.at(s.E(.045,.14,.045),k*(bw+.025),by-.02,.04,0,0,k*.15),2*k);
          B(pc,o.box?s.at(s.Bx(.07,.05,.07),k*(bw+.05),by-.17,.04):s.at(s.E(.042,.038,.045),k*(bw+.045),by-.16,.04),2*k)}
      }
    }};
  return s;
}
// one geometry from colored parts: position, normal, color (white = the coat) and the idle weights (see IDLE below).
// parts are [color, geometry, arm side]; headLift is set for a head (how far its pivot is above the seat)
function crMerge(parts,headLift){
  const list=parts.map(([c,g,arm])=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();if(!n.attributes.normal)n.computeVertexNormals();return[c,n,arm]});
  let len=0;for(const[,g]of list)len+=g.attributes.position.count*3;
  const pos=new Float32Array(len),nor=new Float32Array(len),col=new Float32Array(len),idl=new Float32Array(len/3*4),cc=new THREE.Color();let o=0;
  for(const[c,g,arm]of list){
    pos.set(g.attributes.position.array,o);nor.set(g.attributes.normal.array,o);
    if(c==="c")cc.setRGB(1,1,1);else{cc.set(c);if(Math.min(cc.r,cc.g,cc.b)>.99)cc.multiplyScalar(.97)} // a fixed white must not read as the coat
    for(let k=0;k<g.attributes.position.count;k++){col[o+k*3]=cc.r;col[o+k*3+1]=cc.g;col[o+k*3+2]=cc.b;
      const w=(o/3+k)*4;if(headLift!=null){idl[w+1]=headLift;idl[w+2]=1}else if(arm){idl[w]=arm;idl[w+1]=IDLE_SH}else idleBodyW(pos[o+k*3+1],idl,w)}
    o+=g.attributes.position.count*3;g.dispose();
  }
  const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.BufferAttribute(pos,3));out.setAttribute("normal",new THREE.BufferAttribute(nor,3));out.setAttribute("color",new THREE.BufferAttribute(col,3));out.setAttribute("aIdle",new THREE.BufferAttribute(idl,4));return out;
}
// head parts are listed around the head pivot; body parts in the chair's frame
function creatureGeo(kind,sm){
  const b=[],h=[],s=crShapes(sm);CREATURE[kind].build((c,g,arm)=>b.push([c,g,arm||0]),(c,g)=>h.push([c,g]),s);
  return{b:crMerge(b),h:crMerge(h,(CREATURE[kind].head||CR_HEAD)[1]-IDLE_SEAT)};
}
function scarfGeo(sm){
  const r=new THREE.TorusGeometry(.095,.042,sm?8:4,sm?20:8);r.rotateX(Math.PI/2);r.scale(1,.8,1);
  const t=new THREE.BoxGeometry(.06,.13,.022);t.rotateZ(.18);t.translate(.055,-.075,-.1);
  return mergeGeos([r,t]);
}
/* ---------- walking coworkers: the standing creature and its walk cycle ----------
   One geometry per kind (body and head together: a walker's head doesn't turn), with aWalk per vertex
   (x: 0 = body, ±1 = a leg or foot, ±2 = an arm or paw; y: the hip or shoulder height it swings about) and aWalkI per
   instance (x: a phase seed, y: gait, 0 standing .. 1 walking). The swing and a small bob happen in the vertex shader from
   one clock uniform; the line-art styles (whose edge lines are baked on the CPU) and reduced motion get no swing, and the
   line-art styles bob through the instance matrix instead. */
const WALK_DY=-.2,WALK_U={value:0},WALK_SWING=!REDUCED;
function walkerGeo(kind,sm){
  const parts=[],s=crShapes(sm),hp=CREATURE[kind].head||CR_HEAD;s.stand=true;
  CREATURE[kind].build((c,g,code)=>parts.push([c,g,code||0,0]),(c,g)=>{g.translate(hp[0],hp[1],hp[2]);parts.push([c,g,0,1])},s);
  const list=parts.map(([c,g,code,hd])=>{g.translate(0,WALK_DY,0);const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();if(!n.attributes.normal)n.computeVertexNormals();return[c,n,code,hd]});
  let len=0;for(const[,g]of list)len+=g.attributes.position.count*3;
  const pos=new Float32Array(len),nor=new Float32Array(len),col=new Float32Array(len),wk=new Float32Array(len/3*2),head=new Uint8Array(len/3),cc=new THREE.Color();let o=0;
  for(const[c,g,code,hd]of list){
    pos.set(g.attributes.position.array,o);nor.set(g.attributes.normal.array,o);
    if(c==="c")cc.setRGB(1,1,1);else{cc.set(c);if(Math.min(cc.r,cc.g,cc.b)>.99)cc.multiplyScalar(.97)}
    const piv=Math.abs(code)>1.5?s.shY:code?s.hipY:0;
    for(let k=0;k<g.attributes.position.count;k++){col[o+k*3]=cc.r;col[o+k*3+1]=cc.g;col[o+k*3+2]=cc.b;const w=(o/3+k)*2;wk[w]=code;wk[w+1]=piv;head[o/3+k]=hd}
    o+=g.attributes.position.count*3;g.dispose();
  }
  const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.BufferAttribute(pos,3));out.setAttribute("normal",new THREE.BufferAttribute(nor,3));
  out.setAttribute("color",new THREE.BufferAttribute(col,3));out.setAttribute("aWalk",new THREE.BufferAttribute(wk,2));out.userData.head=head;return out;
}
const WALK_GLSL=`
uniform float uWalkT;
attribute vec2 aWalk;
attribute vec2 aWalkI;
float wkSw, wkBob;
vec3 wkRX( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x, v.y * c - v.z * s, v.y * s + v.z * c ); }
void walkCalc() { float ph = uWalkT * 7.0 + aWalkI.x * 6.2832; wkSw = sin( ph ) * aWalkI.y; wkBob = abs( cos( ph ) ) * 0.028 * aWalkI.y; }
// legs swing about the hip, arms about the shoulder and against the leg on their side
float wkAng() { float L = aWalk.x; if ( abs( L ) < 0.5 ) return 0.0; return abs( L ) > 1.5 ? 0.45 * wkSw * sign( L ) : - 0.5 * wkSw * sign( L ); }
vec3 walkN( vec3 n ) { return wkRX( n, wkAng() ); }
vec3 walkP( vec3 p ) {
	float a = wkAng();
	if ( a != 0.0 ) { vec3 pv = vec3( 0.0, aWalk.y, 0.04 ); p = pv + wkRX( p - pv, a ); }
	if ( abs( aWalk.x ) < 0.5 || abs( aWalk.x ) > 1.5 ) p.y += wkBob; // the body bobs, the feet stay on the floor
	return p;
}
`;
function walkMat(m){
  if(!WALK_SWING||S.edges||!m||m===INVIS||m.userData.walk)return m;
  const ob=m.onBeforeCompile,ck=m.customProgramCacheKey;m.userData.walk=1;
  m.onBeforeCompile=function(sh,r){ob.call(this,sh,r);sh.uniforms.uWalkT=WALK_U;
    sh.vertexShader=sh.vertexShader.replace("#include <common>","#include <common>\n"+WALK_GLSL).replace(/void\s+main\s*\(\s*\)\s*\{/,x=>x+"\n\twalkCalc();")
      .replace("#include <beginnormal_vertex>","#include <beginnormal_vertex>\n\tobjectNormal = walkN( objectNormal );").replace("#include <begin_vertex>","#include <begin_vertex>\n\ttransformed = walkP( transformed );")};
  m.customProgramCacheKey=function(){return ck.call(this)+"|walk"};
  return m;
}
let walkHullM=null,walkHullOf=null,walkDepthM=null;
function walkHull(){if(walkHullOf!==HULL){walkHullOf=HULL;walkHullM=walkMat(HULL.clone())}return walkHullM}
function walkDepth(){return walkDepthM||(walkDepthM=walkMat(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking})))}
// a walker group: n slots, all hidden; its seeds and gaits live in aWalkI
function walkIG(geo,role,n,o,seed){
  const g=IG(geo,role,n,o);if(!g.mesh)return g;
  if(g.colored)g.paint(0,"#ffffff"); // instance colors exist from the start, so HD.warm compiles the variant the first walk uses
  g.mesh.userData.walk=true;          // HD's shadow gate counts walkers by where they are (walkShadowSig), not by this buffer
  const a=new Float32Array(n*2);for(let i=0;i<n;i++)a[2*i]=seed+i*.37;
  const at=new THREE.InstancedBufferAttribute(a,2);g.mesh.geometry.setAttribute("aWalkI",at);g.wa=at;
  for(const o2 of [g.mesh,g.hull])if(o2)o2.userData.dyn=true; // hidden slots sit at the origin: never part of a baked-light layout
  if(WALK_SWING&&!S.edges){walkMat(g.mesh.material);if(g.mesh.castShadow)g.mesh.customDepthMaterial=walkDepth();if(g.hull){g.hull.geometry.setAttribute("aWalkI",at);g.hull.material=walkHull()}}
  for(let i=0;i<n;i++)g.set(i,WALK_HIDE);
  return g;
}
const WALK_HIDE=new THREE.Matrix4().makeScale(0,0,0);
// the coat color goes only where a vertex is pure white (see the note above)
const COAT_VS="#if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )\n\tvColor = color * mix( vec3( 1.0 ), instanceColor.xyz, step( 0.999, min( color.r, min( color.g, color.b ) ) ) );\n#else\n#include <color_vertex>\n#endif";
function coatMat(){const m=mat("figure");if(!("vertexColors" in m)||!m.color)return m;m.vertexColors=true;m.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace("#include <color_vertex>",COAT_VS)};m.customProgramCacheKey=()=>"coat-mask";return m}
const crCoat=f=>{const cs=PEOPLE.coatsOf(f.look.kind);return cs.some(c=>c[0]===f.look.coat)?f.look.coat:cs.length?cs[0][0]:"#9AA0A6"};
const figBase=(f,M)=>{const c=f.ch;M.makeRotationY(c.a);M.setPosition(c.x,0,c.z);return M};
// the shirt you see: team color unless they picked one; a lab coat covers it
function figShirt(f){return f.look.labCoat?"#F2F1EC":f.look.shirt==="team"?teamColorOf(f.d.team):f.look.shirt}
function figTone(f){return f.look.tone===PEOPLE.DEFAULT_TONE&&S.mat==="toon"?"#DCE0EA":f.look.tone}

/* ---------- idle motion: typing, breathing, a look around, a stretch ----------
   All of it happens in the vertex shader, so a full floor costs one uniform a frame (IDLE_U, the clock) and no work per
   coworker. Every geometry that moves carries two extra attributes:
     aIdle  (per vertex)   x: arm (-1 / 1 = which side, on a creature's arm and paw; 0..1 along a person's forearm)
                           y: how far above the seat the vertex is (it rises with the breath and the stretch)
                           z: 1 on a head (it looks around, about the head pivot)   w: how much the chest swells here
     aIdleI (per instance) x: a seed in 0..1 from the desk's key (its own schedule: the floor never moves in step)
                           y: 0 = creature or plain part, -1 / 1 = a person's forearm or hand (side), 2 = no arm motion
   Outline hulls (Comic) get the same patch on their own copy of HULL, the shadow pass gets a patched depth material, and
   the edge lines (Neon, Blueprint, Vector), which IG bakes into world space, also carry where their instance is (aIdleB:
   position and heading) so the shader can move them the same way. With prefers-reduced-motion nothing is patched.
   The patch only touches the vertex shader, chains whatever onBeforeCompile / customProgramCacheKey the material already
   had, and adds "|idle" (or "|idle-l" for lines) to the program key. */
const IDLE_ON=!REDUCED,IDLE_U={value:0},IDLE_SEAT=.6,IDLE_SH=.275;   // seat height; a creature's shoulder above it
const IDLE_GLSL=`
uniform float uIdleT;
attribute vec4 aIdle;
attribute vec2 aIdleI;
#ifdef IDLE_LINES
attribute vec4 aIdleB;
#endif
float idArm, idSpread, idTap, idLift, idSwell, idYaw, idRoll, idPitch;
float idH( float n ) { return fract( sin( n * 12.9898 ) * 43758.5453 ); }
vec3 idRX( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x, v.y * c - v.z * s, v.y * s + v.z * c ); }
vec3 idRY( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x * c + v.z * s, v.y, v.z * c - v.x * s ); }
vec3 idRZ( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x * c - v.y * s, v.x * s + v.y * c, v.z ); }
void idleCalc() {
	float s = aIdleI.x, t = uIdleT + s * 97.0;
	float side = abs( aIdleI.y ) > 0.5 ? aIdleI.y : aIdle.x;
	// breathing: a slow swell, each at its own pace
	float br = sin( t * ( 1.2 + 0.7 * idH( s + 0.3 ) ) ) * 0.5 + 0.5;
	// a stretch now and then: arms up, chin up, a little taller (about 3.5 s, in some of the 30-60 s slots)
	float Ts = 30.0 + 30.0 * idH( s + 0.7 ), ks = t / Ts, ss = floor( ks ), fs = ( ks - ss ) * Ts;
	float st = step( 0.5, idH( ss * 1.37 + s * 31.0 ) ) * smoothstep( 0.0, 0.9, fs ) * ( 1.0 - smoothstep( 2.6, 3.6, fs ) );
	// a look around: the head turns away from the screen for a moment
	float Tl = 6.0 + 6.0 * idH( s + 1.9 ), kl = t / Tl + 0.37, sl = floor( kl ), fl = kl - sl;
	float lk = step( 0.55, idH( sl * 2.11 + s * 53.0 ) ) * smoothstep( 0.08, 0.2, fl ) * ( 1.0 - smoothstep( 0.5, 0.66, fl ) ) * ( 1.0 - st );
	float hy = idH( sl + s * 7.0 ) - 0.5;
	idYaw = lk * sign( hy ) * ( 0.3 + 0.7 * abs( hy ) );
	idRoll = lk * ( idH( sl * 3.3 + s * 11.0 ) - 0.5 ) * 0.4;
	idPitch = st * 0.32;
	// typing: bursts with pauses, the two paws out of step
	float Tt = 1.5 + 1.7 * idH( s + 2.3 ), kt = t / Tt, sb = floor( kt ), fb = kt - sb;
	float burst = step( 0.3, idH( sb * 1.73 + s * 19.0 ) ) * smoothstep( 0.0, 0.12, fb ) * ( 1.0 - smoothstep( 0.85, 1.0, fb ) ) * ( 1.0 - st ) * ( 1.0 - 0.7 * lk );
	float w = t * ( 15.0 + 6.0 * idH( s + 3.1 ) ) + ( side > 0.0 ? 3.1416 : 0.0 );
	idTap = burst * max( 0.0, sin( w ) ) * ( 0.65 + 0.35 * sin( w * 0.37 + side ) );
	idArm = idTap * 0.12 + st * ( 1.85 + 0.3 * idH( s + 4.0 ) );
	idSpread = st * 0.55;
	idLift = aIdle.y * ( br * 0.012 + st * 0.05 );
	idSwell = aIdle.w * ( br * 0.03 + st * 0.03 );
}
vec3 idHead( vec3 v ) { return idRY( idRZ( idRX( v, idPitch ), idRoll ), idYaw ); }
vec3 idArmR( vec3 v ) { return idRZ( idRX( v, idArm ), - aIdle.x * idSpread ); }
vec3 idleN( vec3 n ) {
	if ( aIdle.z > 0.5 ) return idHead( n );
	if ( abs( aIdleI.y ) < 0.5 && aIdle.x != 0.0 ) return idArmR( n );
	return n;
}
vec3 idleP( vec3 p ) {
	float m = abs( aIdleI.y ), up = idLift;
#ifdef IDLE_LINES
	// baked world-space lines: back into the instance's frame (a turn about y and a move), then out again
	vec3 d = p - aIdleB.xyz; float bc = cos( aIdleB.w ), bs = sin( aIdleB.w ), by = aIdleB.y;
	vec3 q = vec3( bc * d.x - bs * d.z, d.y, bs * d.x + bc * d.z );
#else
	vec3 q = p;
	#ifdef USE_INSTANCING
	float by = instanceMatrix[ 3 ].y;
	#else
	float by = 1.0;
	#endif
#endif
	vec3 q0 = q;
	if ( aIdle.z > 0.5 ) q = idHead( q );
	else if ( m > 0.5 ) { if ( m < 1.5 ) up += aIdle.x * idTap * 0.03 * step( 0.735, by ); } // a person's forearm and hand tap only while up at the desk (not in the lap)
	else if ( aIdle.x != 0.0 ) { vec3 pv = vec3( aIdle.x * 0.155, 0.875, -0.02 ); q = pv + idArmR( q - pv ); } // a creature's arm, about its shoulder
	else q.xz = ( q.xz - vec2( 0.0, 0.04 ) ) * ( 1.0 + idSwell ) + vec2( 0.0, 0.04 );
#ifdef IDLE_LINES
	d = q - q0; return p + vec3( bc * d.x + bs * d.z, d.y + up, bc * d.z - bs * d.x );
#else
	#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix ); q += ( vec3( 0.0, up, 0.0 ) * im ) / vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) ); // straight up, whatever the instance's turn and scale
	#else
	q.y += up;
	#endif
	return q;
#endif
}
`;
function idleVS(vs,lines){
  return vs.replace("#include <common>","#include <common>\n"+(lines?"#define IDLE_LINES\n":"")+IDLE_GLSL)
    .replace(/void\s+main\s*\(\s*\)\s*\{/,m=>m+"\n\tidleCalc();")
    .replace("#include <beginnormal_vertex>","#include <beginnormal_vertex>\n\tobjectNormal = idleN( objectNormal );")
    .replace("#include <begin_vertex>","#include <begin_vertex>\n\ttransformed = idleP( transformed );");
}
// add the idle motion to a material (once), keeping any shader patch it already has
function idleMat(m,lines){
  if(!IDLE_ON||!m||m===INVIS||m.userData.idle)return m;
  const ob=m.onBeforeCompile,ck=m.customProgramCacheKey,tag="|idle"+(lines?"-l":"");
  m.userData.idle=1;
  m.onBeforeCompile=function(sh,r){ob.call(this,sh,r);sh.uniforms.uIdleT=IDLE_U;sh.vertexShader=idleVS(sh.vertexShader,lines)};
  m.customProgramCacheKey=function(){return ck.call(this)+tag};
  return m;
}
let idleHullM=null,idleHullOf=null,idleDepthM=null;
function idleHull(){if(idleHullOf!==HULL){idleHullOf=HULL;idleHullM=idleMat(HULL.clone())}return idleHullM}
function idleDepth(){return idleDepthM||(idleDepthM=idleMat(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking})))}
const idleSeed=key=>{let h=2166136261;for(let i=0;i<key.length;i++)h=Math.imul(h^key.charCodeAt(i),16777619);return((h>>>0)%8192)/8192};
// a seated body's weights by height: above the seat it rises and swells
function idleBodyW(y,arr,w){const h=y-IDLE_SEAT;if(h>0){arr[w+1]=h;arr[w+3]=Math.min(1,h/.15)}}
// give a geometry its aIdle weights: one value for all of it, or fn(y, array, offset) per vertex
function idleGeo(geo,a,b,c,d){
  if(!geo)return geo;const p=geo.attributes.position,arr=new Float32Array(p.count*4);
  for(let v=0;v<p.count;v++){if(typeof a==="function")a(p.getY(v),arr,v*4);else{arr[v*4]=a;arr[v*4+1]=b;arr[v*4+2]=c;arr[v*4+3]=d}}
  geo.setAttribute("aIdle",new THREE.BufferAttribute(arr,4));return geo;
}
// the plain person: the chest breathes, the head (with its hat and glasses) looks around, forearms and hands type
function idleFigGeos(G){
  const hl=FIG_HEAD.y-IDLE_SEAT;
  idleGeo(G.torso,idleBodyW);idleGeo(G.badge,0,.27,0,1);
  for(const k of["head","eyes","glasses","phones","beanie","cap"])idleGeo(G[k],0,hl,1,0);
  idleGeo(G.arm,(y,arr,w)=>{arr[w]=-y});idleGeo(G.hand,1,0,0,0);
  return G;
}
// switch the motion on for one instanced group: seedOf(i) and flagOf(i) fill aIdleI
function idleIG(g,seedOf,flagOf){
  if(!IDLE_ON||!g||!g.mesh)return;
  const n=g.count,a=new Float32Array(n*2),geo=g.mesh.geometry;
  for(let i=0;i<n;i++){a[2*i]=seedOf(i);a[2*i+1]=flagOf?flagOf(i):0}
  geo.setAttribute("aIdleI",new THREE.InstancedBufferAttribute(a,2));idleMat(g.mesh.material);
  if(g.mesh.castShadow)g.mesh.customDepthMaterial=idleDepth();
  if(g.hull){g.hull.geometry.setAttribute("aIdleI",new THREE.InstancedBufferAttribute(a,2));g.hull.material=idleHull()}
  if(!g.lines)return;
  // edge lines: every line vertex gets its weights (looked up by position), its instance's seed, and its instance's base
  const eb=g.eb,nv=eb.length/3,src=geo.attributes.position.array,w=geo.attributes.aIdle.array,at=new Map(),key=(b,v)=>b[3*v]+","+b[3*v+1]+","+b[3*v+2];
  for(let v=0;v<src.length/3;v++)at.set(key(src,v),v);
  const vw=new Float32Array(nv*n*4),vi=new Float32Array(nv*n*2),vb=new Float32Array(nv*n*4);
  for(let v=0;v<nv;v++){const j=at.get(key(eb,v));if(j!=null)for(let c=0;c<4;c++)vw[4*v+c]=w[4*j+c]}
  for(let i=1;i<n;i++)vw.copyWithin(i*nv*4,0,nv*4);
  for(let i=0;i<n;i++)for(let v=0;v<nv;v++){vi[(i*nv+v)*2]=a[2*i];vi[(i*nv+v)*2+1]=a[2*i+1]}
  const lg=g.lines.geometry,ba=new THREE.BufferAttribute(vb,4);
  lg.setAttribute("aIdle",new THREE.BufferAttribute(vw,4));lg.setAttribute("aIdleI",new THREE.BufferAttribute(vi,2));lg.setAttribute("aIdleB",ba);idleMat(g.lines.material,true);
  const set0=g.set,commit0=g.commit;let lo=1e9,hi=-1;
  g.set=(i,M)=>{set0(i,M);const e=M.elements,an=Math.atan2(e[8],e[0]);for(let k=i*nv*4,end=k+nv*4;k<end;k+=4){vb[k]=e[12];vb[k+1]=e[13];vb[k+2]=e[14];vb[k+3]=an}if(i<lo)lo=i;if(i>hi)hi=i};
  g.commit=()=>{commit0();if(hi>=lo){ba.clearUpdateRanges();if(lo>0||hi<n-1)ba.addUpdateRange(lo*nv*4,(hi-lo+1)*nv*4);ba.needsUpdate=true;lo=1e9;hi=-1}};
}
// the person's groups and the scarves (the creatures' two groups are switched on where they are made)
function idleFigures(){
  if(!IDLE_ON||!figG)return;
  const G=figG,P=i=>FIGP[i].seed,own={glasses:[],phones:[],beanie:[],cap:[]},cs=[];
  for(const f of FIG){if(f.sp)cs[f.si]=f;else{if(f.gl>=0)own.glasses[f.gl]=f;if(f.hat>=0)own[f.look.hat][f.hat]=f}}
  for(const k of["torso","badge","head","eyes"])idleIG(G[k],P);
  for(const k in own)idleIG(G[k],i=>own[k][i].seed);
  idleIG(G.arm,i=>FIGP[i>>2].seed,i=>i&1?(i&2?1:-1):2);   // 4 per person: side * 2 + (0 upper arm, 1 forearm)
  idleIG(G.hand,i=>FIGP[i>>1].seed,i=>i&1?1:-1);
  idleIG(G.scarf,i=>cs[i].seed);
}

function buildFigures(){
  figReset();
  if(WKIND!=="floor"||!root||!WM)return;
  const desks=WM.desks||[],people=WM.people||[];
  for(const c of chairs){
    if(c.desk<0)continue;const d=desks[c.desk];if(!d||d.person<0||!people[d.person])continue;
    const key=WKEY+"|"+d.id,look=PEOPLE.merge(PEOPLE.defaultLook(key,d.arr),LOOKS.get(key));
    const f={ch:c,di:c.desk,d,key,look,seed:idleSeed(key),yaw:0,tyaw:0,n:-1,hat:-1,gl:-1,mug:-1,sp:null,ci:-1,si:-1};FIG.push(f);figByChair.set(c,f);
  }
  const G=idleFigGeos(figGeos()),cnt={phones:0,beanie:0,cap:0,glasses:0,mug:0},bySp=new Map();let nC=0;
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
    scarf:IG(idleGeo(scarfGeo(S.mat!=="basic"),0,CR_NECK[0]-IDLE_SEAT,0,0),"shirt",nC,o({noCast:1})),
  };
  // creatures: two groups per kind on this floor; the coat color rides on the vertex colors (shaded styles only)
  const vc=faces&&S.mat!=="basic";
  for(const [sp,list] of bySp){const g=creatureGeo(sp,S.mat!=="basic");figG["cb_"+sp]=IG(g.b,"figure",list.length,o(vc?{mat:coatMat()}:{}));figG["ch_"+sp]=IG(g.h,"figure",list.length,o(vc?{mat:coatMat()}:{}));
    for(const k of["cb_","ch_"]){if(figG[k+sp].mesh)figPick.set(figG[k+sp].mesh,list);idleIG(figG[k+sp],i=>list[i].seed)}}
  idleFigures();
  // walkers: standing slots per kind (enough that a kind almost never runs out: about 5% of coworkers are up at once), one scarf each
  let nW=0;
  for(const [sp,list] of bySp){
    const n=Math.min(list.length,WALK_POOL+Math.ceil(list.length/6)),wg=walkerGeo(sp,S.mat!=="basic"),g=walkIG(wg,"figure",n,o(vc?{mat:coatMat()}:{}),idleSeed(WKEY+sp));
    if(!g.mesh)continue;figG["wk_"+sp]=g;g.base=nW;g.slots=new Array(n).fill(null);figPick.set(g.mesh,g.slots);nW+=n;
    // which of the edge-line vertices are the head's (walkEdge leaves those in the style's own edge color, as when seated)
    if(g.lines&&wg.userData.head){const src=wg.attributes.position.array,hd=wg.userData.head,key=(b,v)=>b[3*v]+","+b[3*v+1]+","+b[3*v+2],at=new Map();
      for(let v=0;v<src.length/3;v++)at.set(key(src,v),v);const nv=g.eb.length/3;g.ehead=new Uint8Array(nv);for(let v=0;v<nv;v++){const j=at.get(key(g.eb,v));g.ehead[v]=j!=null&&hd[j]?1:0}}
  }
  if(nW){const sg=scarfGeo(S.mat!=="basic");sg.setAttribute("aWalk",new THREE.BufferAttribute(new Float32Array(sg.attributes.position.count*2),2));figG.wscarf=walkIG(sg,"shirt",nW,o({noCast:1}),0)}
  // everything here moves (or hides at the origin when someone gets up): never part of a baked-light layout
  for(const k in figG){const g=figG[k];for(const m of [g.mesh,g.hull])if(m)m.userData.dyn=true}
  walkReset();
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
  if(f.sp&&f.away){figG[f.kb].set(f.ci,WALK_HIDE);figG[f.kh].set(f.ci,WALK_HIDE);figG.scarf.set(f.si,WALK_HIDE);return} // up and about: the chair is empty
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
function figReset(){walkReset();figG=null;FIG=[];FIGP=[];figByChair=new Map();figPick=new Map();figTurned.clear()}
// a look changed: rebuild only the figures (the rest of the floor stays)
function rebuildFigures(){
  if(WKIND!=="floor"||!root)return;
  if(figG){const dead=new Set();for(const k in figG){const g=figG[k];for(const o of [g.mesh,g.hull,g.lines]){if(!o)continue;if(o.parent)o.parent.remove(o);o.geometry.dispose();if(o.material!==HULL){dead.add(o.material);o.material.dispose()}}}lineMats=lineMats.filter(m=>!dead.has(m))}
  buildFigures();
}
// which desk a ray hit on a figure points at (-1 if none)
function figDeskOf(h){if(!figG||!h)return -1;const L=figPick.get(h.object),f=L&&L[h.instanceId];return f?f.di:-1}
// (three caches an instanced mesh's bounding sphere once and rejects rays outside it: walkers move and seated creatures hide,
// so the spheres are recomputed from the current matrices for each pick)
function figMeshes(){if(!figG)return[];const out=[...figPick.keys()];for(const m of out)m.boundingSphere=null;return out}
// heads turn toward you when you drive or walk past (within about 3 m), then drift back to their screens
function figFrame(dt){
  IDLE_U.value=(IDLE_U.value+dt)%3600; // the idle shader's clock: the only per-frame cost of the idle motion
  WALK_U.value=(WALK_U.value+dt)%3600;
  if(!FIG.length||WKIND!=="floor")return;
  walkStep(dt);
  let tx=null,tz=null;
  if(mode==="drive"&&!fly){tx=me.x;tz=me.z}else if(mode==="walk"&&!fly){tx=walker.x;tz=walker.z}
  const want=new Set();
  if(tx!=null&&!REDUCED)for(const c of chairsNear(tx,tz,3.2)){const f=figByChair.get(c);if(!f||f.away)continue;const dx=tx-c.x,dz=tz-c.z,dist=Math.hypot(dx,dz);if(dist>3.2||dist<.08)continue;f.tyaw=clamp(angDiff(c.a,Math.atan2(-dx,-dz)),-1.15,1.15);want.add(f)}
  for(const f of figTurned)if(!want.has(f))f.tyaw=0;
  for(const f of want)figTurned.add(f);
  if(!figTurned.size)return;
  const k=1-Math.exp(-dt*5);
  for(const f of figTurned){
    let ny=f.yaw+(f.tyaw-f.yaw)*k;const done=f.tyaw===0&&Math.abs(ny)<.003;if(done)ny=0;
    if(ny!==f.yaw){f.yaw=ny;if(figG&&!f.away)figHead(f,figBase(f,_FB))}
    if(done)figTurned.delete(f);
  }
}

/* ---------- walks: coworkers get up now and then ----------
   The schedule is PEOPLE.walkTrip / walkAt on the shared wall clock, so every viewer on the floor sees the same creature
   leave, take the same path (NAV, from its chair's home spot to a room or amenity near its desk, or a teammate's desk),
   stay a while facing it and come back the same way. Only creatures walk; the plain seated person stays at the desk.
   Locally a walker steps aside for cars close by and hops when bumped or woofed at: that shifts it for a moment and never
   changes where its walk goes. While up it is a small kinematic body in the physics world (PHYS.track), so it nudges
   loose boxes out of its way. A viewer who arrives mid-walk sees the walker where everyone else does. */
const WALK_POOL=3;           // standing slots per kind on a floor, plus one per 6 of that kind (see buildFigures)
let walkScan=0,walkFresh=true,walkDests=null,walkLastT=0;
const walkers=new Set(),_W={x:0,z:0,a:0},_WS=new THREE.Sphere(new V3(),1);
function walkReset(){for(const f of walkers){if(f.kin)PHYS.untrack(f.kin);f.kin=null;f.away=false;f.slot=-1}walkers.clear();walkScan=0;walkFresh=true;walkDests=null}
// where coworkers go: rooms and amenities (not the exit, and not the elevator pads where players arrive), and the
// standing point at every desk
function walkPlaces(){
  if(walkDests)return walkDests;const desk=new Map(),rooms=[];
  for(const d of (WM&&WM.dests)||[]){if(!isFinite(d.x)||!isFinite(d.z))continue;if(d.kind==="desk")desk.set(d.id,d);else if(d.id!=="exit"&&!String(d.id).startsWith("elev:"))rooms.push(d)}
  return walkDests={desk,rooms};
}
function walkDest(f,tr){
  const P=walkPlaces(),home=P.desk.get("desk:"+f.d.id);if(!home)return null;
  const dist=d=>Math.hypot(d.x-home.x,d.z-home.z);
  if(tr.mate&&f.d.team){
    const mates=[];for(const g of FIG)if(g!==f&&g.d.team===f.d.team){const d=P.desk.get("desk:"+g.d.id);if(d&&dist(d)<18&&dist(d)>1.5)mates.push(d)}
    mates.sort((a,b)=>dist(a)-dist(b)||(a.id<b.id?-1:1));
    if(mates.length)return{home,to:mates[Math.floor(tr.pick*Math.min(4,mates.length))]};
  }
  const near=P.rooms.slice().sort((a,b)=>dist(a)-dist(b)||(a.id<b.id?-1:1)).slice(0,6);
  return near.length?{home,to:near[Math.floor(tr.pick*tr.pick*near.length)]}:null;   // nearer rooms more often
}
// The path: from a step behind the chair (its home spot, the same for everyone) along NAV to a spot of this coworker's own
// on a ring around the destination, so two who go to the same room stand side by side. Only the static NAV grid decides,
// so every viewer gets the same path and length.
function walkPath(f,dd){
  const g=navGrid(WKEY);if(!g)return null;
  const find=(x,z)=>{let r=null;try{r=NAV.findPath(g,dd.home.x,dd.home.z,x,z)}catch(_){}return r&&r.pts&&r.pts.length>=2?r:null};
  let r=null;const j=PEOPLE.hash(f.key+"|spot")%6;
  for(let n=0;n<6&&!r;n++){const an=(dd.to.a||0)+Math.PI/2+((j+n)%6)*Math.PI/3,gx=dd.to.x+Math.sin(an)*.55,gz=dd.to.z+Math.cos(an)*.55,q=find(gx,gz);
    if(q){const e=q.pts[q.pts.length-1];if(Math.hypot(e[0]-gx,e[1]-gz)<.2)r=q}}   // NAV snaps a blocked end elsewhere: only take one that got there
  if(!r)r=find(dd.to.x,dd.to.z);if(!r)return null;
  const c=f.ch,pts=[[c.hx+Math.sin(c.ha)*.5,c.hz+Math.cos(c.ha)*.5],...r.pts],cum=[0];   // behind the seat (a creature faces -z in its chair)
  for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  return{pts,cum,L:cum[cum.length-1],face:dd.to.a};
}
// the point s metres along a path, and the heading of its segment
function pathAt(P,s,out){
  const{pts,cum,L}=P;s=clamp(s,0,L);let lo=0,hi=pts.length-2;
  while(lo<hi){const m=(lo+hi+1)>>1;if(cum[m]<=s)lo=m;else hi=m-1}
  const a=pts[lo],b=pts[lo+1],sl=cum[lo+1]-cum[lo],t=sl>0?(s-cum[lo])/sl:0;
  out.x=a[0]+(b[0]-a[0])*t;out.z=a[1]+(b[1]-a[1])*t;
  let k=lo;while(k<pts.length-2&&cum[k+1]-cum[k]<1e-6)k++;out.a=Math.atan2(-(pts[k+1][0]-pts[k][0]),-(pts[k+1][1]-pts[k][1]));
  return out;
}
// a walker's edge lines in its team color, except the head's (seated, only the body has team edges)
function walkEdge(g,i,hex){
  if(!g.lines)return;const cc=new THREE.Color(hex),b=g.eb.length,a=g.lines.geometry.attributes.color.array;
  for(let v=0;v<b/3;v++){if(g.ehead&&g.ehead[v])continue;const k=i*b+v*3;a[k]=cc.r;a[k+1]=cc.g;a[k+2]=cc.b}g.cd=true;
}
function walkStart(f){
  const g=figG&&figG["wk_"+f.sp];if(!g||!g.slots)return false;const i=g.slots.indexOf(null);if(i<0)return false;
  g.slots[i]=f;f.slot=i;f.away=true;walkers.add(f);figPose(f);
  const neon=!S.faceIsBg&&!S.depthOnly&&S.mat==="basic",coat=crCoat(f),team=teamColorOf(f.d.team),sc=figG.wscarf,j=g.base+i;
  g.paint(i,neon?pal("chair"):coat);if(S.teamEdges)walkEdge(g,i,bright(team));
  if(g.wa){g.wa.array[2*i+1]=0;g.wa.needsUpdate=true}
  if(sc&&sc.mesh){sc.paint(j,neon?pal("chair"):team);if(S.teamEdges)sc.edge(j,bright(team));if(sc.wa&&g.wa){sc.wa.array[2*j]=g.wa.array[2*i];sc.wa.array[2*j+1]=0;sc.wa.needsUpdate=true}}
  pathAt(f.wp,0,_W);f.wh=f.ch.a;f.wg=0;f.wox=f.woz=0;f.hopT=0;f.hopCd=0;f.px=NaN;   // stands up facing the desk, then turns to go
  f.kin={x:_W.x+f.ch.x-f.ch.hx,y:groundY(_W.x,_W.z),z:_W.z+f.ch.z-f.ch.hz,h:f.wh,kind:"dog"};PHYS.track(f.kin);
  return true;
}
function walkEnd(f){
  const g=figG&&figG["wk_"+f.sp],sc=figG&&figG.wscarf;
  if(g&&f.slot>=0){g.set(f.slot,WALK_HIDE);g.slots[f.slot]=null;if(g.wa){g.wa.array[2*f.slot+1]=0;g.wa.needsUpdate=true}
    if(sc&&sc.mesh){sc.set(g.base+f.slot,WALK_HIDE);if(sc.wa){sc.wa.array[2*(g.base+f.slot)+1]=0;sc.wa.needsUpdate=true}}}
  if(f.kin)PHYS.untrack(f.kin);f.kin=null;f.slot=-1;f.away=false;walkers.delete(f);figPose(f);
}
// the cars (and the walking player) a walker makes room for
function walkCars(){
  const out=[];
  if(!fly&&mode==="drive")out.push(me);else if(!fly&&mode==="walk")out.push(walker);
  for(const r of remotes.values())if(r.has&&r.w===WKEY&&r.m!=="o"&&r.car)out.push(r.car);
  if(BOTPATH.length>1)out.push(bot);
  return out;
}
// a woof (or anything loud) nearby: walkers within r hop
function walkStartle(x,z,r){for(const f of walkers)if(f.kin&&Math.hypot(f.kin.x-x,f.kin.z-z)<r&&f.hopCd<=0){f.hopT=.5;f.hopCd=1.2}}
// for HD's shadow gate: only the walkers inside the sun's shadow box count, by where they are (the walker groups' instance
// buffers change whenever anyone anywhere on the floor walks)
function walkShadowSig(fr){
  let h=0,n=0;
  for(const f of walkers){if(!f.kin)continue;_WS.center.set(f.kin.x,.6,f.kin.z);_WS.radius=1.2;if(!fr.intersectsSphere(_WS))continue;n++;h+=(f.kin.x*1.7+f.kin.z*2.3+f.wh*.9+f.hopT*3.1+f.wg*1.3)*(1+n*1e-3)}
  return h+n*977;
}
// how much of a step aside is clear for both a car (spotFree) and someone on foot (walkBlocked: desks and tables too)
function walkClear(x,z,tx,tz){
  let s=1;while(s>.2&&(walkBlocked(x+tx*s,z+tz*s)||!spotFree(x+tx*s,z+tz*s)))s*=.5;
  return s>.2?s:0;
}
function walkStep(dt){
  if(!figG)return;
  const T=Date.now()/1000;
  if((walkScan-=dt)<=0){walkScan=.25;
    // after a gap (a hidden tab, the editor open, a stall) the walks that began meanwhile join where everyone else sees them
    const fresh=walkFresh||T-walkLastT>PEOPLE.WALK.up,due=[];
    for(const f of FIG){
      if(!f.sp||f.away)continue;
      const k=PEOPLE.walkCycle(f.key,T);
      if(f.wk!==k){f.wk=k;f.trip=PEOPLE.walkTrip(f.key,k);f.wp=undefined;f.tm=null}
      const tr=f.trip;if(!tr||T<tr.t0||T>=tr.end||tr.skip)continue;
      if(f.wp===undefined){const dd=walkDest(f,tr);f.wp=dd?walkPath(f,dd):null;f.tm=f.wp?PEOPLE.walkTimes(tr,f.wp.L):null}
      if(!f.tm||T>=tr.t0+f.tm.total){tr.skip=true;continue}
      if(!fresh&&tr.t0<walkLastT){tr.skip=true;continue}   // it was due at the last scan and didn't start (no free slot)
      due.push(f);
    }
    // in schedule order, so in the rare case a kind runs out of slots every viewer leaves the same walk out
    due.sort((a,b)=>a.trip.t0-b.trip.t0||(a.key<b.key?-1:1));
    for(const f of due)if(!walkStart(f))f.trip.skip=true;
    walkFresh=false;walkLastT=T;
  }
  if(!walkers.size)return;
  const cars=walkCars(),ke=1-Math.exp(-dt*8),kg=1-Math.exp(-dt*6),sc=figG.wscarf;
  for(const f of [...walkers]){
    const a=PEOPLE.walkAt(f.trip,f.tm,T);
    if(a.ph==="done"||a.ph==="wait"){walkEnd(f);continue}
    pathAt(f.wp,a.s,_W);let x=_W.x,z=_W.z,h=_W.a;
    if(a.ph==="back")h+=Math.PI;else if(a.ph==="stay"&&f.wp.face!=null)h=f.wp.face;else if(a.ph==="down")h=f.ch.a;
    // a chair pushed away from home: get up from it and sit back down on it, blending into the shared path over the first metre
    {const c=f.ch,ox=c.x-c.hx,oz=c.z-c.hz,od=Math.hypot(ox,oz);if(od>.02){const w=clamp(1-a.s/Math.max(1,od),0,1);x+=ox*w;z+=oz*w}}
    const dh=angDiff(f.wh,h);f.wh=Math.abs(dh)<1e-4?h:f.wh+dh*ke;
    const dg=a.gait-f.wg;f.wg=Math.abs(dg)<.002?a.gait:f.wg+dg*kg;f.hopCd-=dt;
    // step aside for a car close by, across the way it is walking (never into a wall, a desk or a table)
    let tx=0,tz=0;
    if(a.gait)for(const c of cars){const dx=x-c.x,dz=z-c.z,d=Math.hypot(dx,dz);if(d<1.5&&d>1e-3){const rx=Math.cos(f.wh),rz=-Math.sin(f.wh),k=.7*(1-d/1.5)*((dx*rx+dz*rz)>=0?1:-1);tx+=rx*k;tz+=rz*k}}
    {const m=Math.hypot(tx,tz);if(m>.7){tx*=.7/m;tz*=.7/m}}
    if(tx||tz){const k=walkClear(x,z,tx,tz);tx*=k;tz*=k}
    const ex=tx-f.wox,ez=tz-f.woz;if(Math.abs(ex)+Math.abs(ez)<1e-4){f.wox=tx;f.woz=tz}else{f.wox+=ex*kg;f.woz+=ez*kg}x+=f.wox;z+=f.woz;
    // bumped (not by something jumping over its head): the walker hops, the player's car is eased back out of it
    for(const c of cars){const dx=c.x-x,dz=c.z-z,d=Math.hypot(dx,dz);if(d>=.48||(c.y||0)>1)continue;
      if(f.hopCd<=0&&(c!==me||Math.hypot(me.vx||0,me.vz||0)>1)){f.hopT=.5;f.hopCd=1.2;if(c===me)pop(x,1.2,z,"!","#FFB547")}
      if(c===me&&mode==="drive"){const ux=d>1e-3?dx/d:1,uz=d>1e-3?dz/d:0;if(spotFree(x+ux*.48,z+uz*.48)){me.x=x+ux*.48;me.z=z+uz*.48}const vn=(me.vx||0)*ux+(me.vz||0)*uz;if(vn<0){me.vx-=vn*ux;me.vz-=vn*uz}}}
    const gy=groundY(x,z);let y=gy;   // up and over ramps and humps
    if(f.hopT>0){f.hopT=Math.max(0,f.hopT-dt);y+=Math.sin(Math.PI*(1-f.hopT/.5))*.22}
    if(S.edges&&!REDUCED)y+=Math.abs(Math.cos(WALK_U.value*7+(f.slot*.37)*6.2832))*.028*f.wg; // line-art styles bob here, not in the shader
    if(f.kin){f.kin.x=x;f.kin.y=gy;f.kin.z=z;f.kin.h=f.wh}
    const g=figG["wk_"+f.sp];
    if(g.wa&&g.wa.array[2*f.slot+1]!==f.wg&&(Math.abs(g.wa.array[2*f.slot+1]-f.wg)>.005||f.wg===a.gait)){g.wa.array[2*f.slot+1]=f.wg;g.wa.needsUpdate=true;if(sc&&sc.wa){sc.wa.array[2*(g.base+f.slot)+1]=f.wg;sc.wa.needsUpdate=true}}
    // write the matrices only when the walker moved: a still walker must not look like a change to HD's shadow gate
    if(!(Math.abs(x-f.px)+Math.abs(y-f.py)+Math.abs(z-f.pz)+Math.abs(angDiff(f.wh,f.pa))<1e-4)){
      f.px=x;f.py=y;f.pz=z;f.pa=f.wh;_FA.makeRotationY(f.wh);_FA.setPosition(x,y,z);g.set(f.slot,_FA);
      if(sc&&sc.mesh){const nk=CREATURE[f.sp].neck||CR_NECK;_FH.makeTranslation(0,nk[0]+WALK_DY,.02);_FH.scale(_FS.set(nk[1],nk[1],nk[1]));_FM.multiplyMatrices(_FA,_FH);sc.set(g.base+f.slot,_FM)}
    }
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
