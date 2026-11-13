/* ===================== game part 3a: coin and power-up box art (shapes and HUD icons) ===================== */
// Built from code (no model files). Each item is ONE geometry with its colors baked into the vertices, so a whole floor of
// them is one InstancedMesh each. Sizes are real meters.

/* ---------- shapes ---------- */
function funGeos(){
  const q=TOUCH?.7:1,u=n=>Math.max(3,Math.round(n*q)),PI=Math.PI;
  const at=(g,x,y,z,rx,ry,rz)=>{if(rx||ry||rz)g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx||0,ry||0,rz||0)));g.translate(x,y,z);return g};
  const Bx=(w,h,d)=>new THREE.BoxGeometry(w,h,d),Cy=(a,b,h,n)=>new THREE.CylinderGeometry(a,b,h,n);
  // a flat outline (points in a -1..1 square) made into a thin slab of the given size, facing +z
  const slab=(pts,size,depth)=>{const sh=new THREE.Shape(pts.map(([x,y])=>new THREE.Vector2(x*size,y*size)));return new THREE.ExtrudeGeometry(sh,{depth,bevelEnabled:false})};
  const STAR=[];for(let i=0;i<10;i++){const a=PI/2+i*PI/5,r=i%2?.45:1;STAR.push([Math.cos(a)*r,Math.sin(a)*r])}
  const G={};

  // --- power-up box: a taped-up parcel in a chunky frame, a sticker on each side ---
  {
    const p=[],B=(c,g)=>p.push([c,g]),H=.2,bar=.045,o=H-bar/2;
    B("#FFC02E",Bx(.37,.37,.37));
    // the frame: twelve bars along the edges. They sit proud of the faces, so the cube keeps a clean dark outline
    for(const a of[-1,1])for(const b of[-1,1]){B("#E8741C",at(Bx(.4,bar,bar),0,a*o,b*o));B("#E8741C",at(Bx(bar,.4,bar),a*o,0,b*o));B("#E8741C",at(Bx(bar,bar,.4),a*o,b*o,0))}
    // two tape bands that cross on the lid and run down all four sides
    B("#FFF1C4",Bx(.085,.378,.378));B("#FFF1C4",Bx(.378,.378,.085));
    const BOLT=[[.18,1],[-.52,-.08],[-.06,-.08],[-.3,-1],[.56,.2],[.08,.2],[.42,1]];
    for(let k=0;k<4;k++){
      const bolt=k%2===0,ry=k*PI/2;
      B(bolt?"#2B3A8C":"#E23D2E",at(Cy(.105,.105,.012,u(20)),0,0,.189,PI/2,0,0).applyMatrix4(new THREE.Matrix4().makeRotationY(ry)));
      B(bolt?"#FFE23D":"#FFF6DA",at(slab(bolt?BOLT:STAR,bolt?.078:.074,.006),0,0,.193).applyMatrix4(new THREE.Matrix4().makeRotationY(ry)));
    }
    G.crate=crMerge(p);
  }

  // --- coin: a thick gold disc standing on its edge (it spins about y), a raised face and a star on each side ---
  {
    const p=[],B=(c,g)=>p.push([c,g]),n=u(28);
    B("#E59A12",at(Cy(.17,.17,.04,n),0,0,0,PI/2,0,0));
    for(const s of[-1,1]){
      B("#FFCB3A",at(Cy(.138,.138,.008,n),0,0,s*.022,PI/2,0,0));
      const st=slab(STAR,.072,.005);if(s<0)st.applyMatrix4(new THREE.Matrix4().makeRotationY(PI));B("#FFE68A",at(st,0,0,s*.025));
    }
    G.coin=crMerge(p);
  }
  return G;
}

/* ---------- HUD icons ---------- */
// Inline SVG, 48 x 48, flat fills inside one dark outline so they stay readable at 28 px on any HUD color.
const FUN_ICON=(()=>{
  const O='stroke="#2A1E14" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
  const svg=s=>'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">'+s+'</svg>';
  const coin='<circle cx="24" cy="24" r="19" fill="#FFC83D" '+O+'/><circle cx="24" cy="24" r="12.5" fill="none" stroke="#E39B10" stroke-width="3"/>';
  return{
    coin:svg(coin),
    coffee:svg('<path d="M13 15 H35 L32 44 H16 Z" fill="#FFF8EA" '+O+'/>'
      +'<path d="M14 24 H34 L32.8 36 H15.2 Z" fill="#C47A35" '+O+'/>'
      +'<circle cx="24" cy="30" r="3" fill="#FFF8EA"/>'
      +'<path d="M15 4.5 H33 L34.5 9.5 H13.5 Z" fill="#6B4129" '+O+'/>'
      +'<path d="M10.5 9.5 H37.5 V15.5 H10.5 Z" fill="#6B4129" '+O+'/>'),
    moon:svg('<path d="M30 5 A19.5 19.5 0 1 0 43.5 33 A15 15 0 0 1 30 5 Z" fill="#FFE27A" '+O+'/>'
      +'<circle cx="17" cy="28" r="2.6" fill="#E3BB3E"/><circle cx="24.5" cy="36.5" r="1.8" fill="#E3BB3E"/><circle cx="14.5" cy="18" r="1.5" fill="#E3BB3E"/>'),
    magnet:svg('<path d="M13 8 V25 A11 11 0 0 0 35 25 V8" fill="none" stroke="#2A1E14" stroke-width="13"/>'
      +'<path d="M13 8 V25 A11 11 0 0 0 35 25 V8" fill="none" stroke="#E4372E" stroke-width="7.5"/>'
      +'<path d="M7.5 4.5 H18.5 V12.5 H7.5 Z M29.5 4.5 H40.5 V12.5 H29.5 Z" fill="#E6EAF0" '+O+'/>'),
    double:svg(coin+'<text x="24" y="31" text-anchor="middle" font-family="Archivo, sans-serif" font-weight="800" font-size="19" fill="#7A4A00">×2</text>'),
  };
})();
