/* ===================== game part 3a: Banana Brawl art (item shapes and HUD icons) ===================== */
// Everything a kart battle throws around the office: the supply crate you drive through, the banana and its peel,
// a crumpled paper ball, a paper airplane and a takeaway coffee. All of it is built from code (no model files) and
// each item is ONE geometry with its colors baked into the vertices, so a whole floor of them is a few InstancedMesh
// groups. Sizes are real meters; the game scales them up a little so they read from a driving camera.
// Front is -z, as for the car: the airplane's nose and the coffee's logo both face -z.

/* ---------- shapes ---------- */
// sm = smooth (the shaded styles). false = the line-art styles (Neon, Blueprint, Vector): few flat faces, so the
// drawn edges outline the item instead of filling it with wire.
function brawlGeos(sm){
  const q=TOUCH?.7:1,u=n=>Math.max(3,Math.round(n*q)),PI=Math.PI;
  const at=(g,x,y,z,rx,ry,rz)=>{if(rx||ry||rz)g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx||0,ry||0,rz||0)));g.translate(x,y,z);return g};
  const Bx=(w,h,d)=>new THREE.BoxGeometry(w,h,d),Cy=(a,b,h,n,open)=>new THREE.CylinderGeometry(a,b,h,n,1,!!open);
  // a fixed hash (0..1) of three integers: lumps and paper shades must be the same on every machine and every load
  const hash=(a,b,c)=>{let h=Math.imul(a,374761393)^Math.imul(b,668265263)^Math.imul(c,1274126177);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296};
  // straight-line lookup in a small table of [t, value] pairs
  const lerpT=(tab,t)=>{for(let i=1;i<tab.length;i++)if(t<=tab[i][0]){const a=tab[i-1],b=tab[i];return a[1]+(b[1]-a[1])*(t-a[0])/((b[0]-a[0])||1)}return tab[tab.length-1][1]};
  // a tube with an oval cross-section swept along a path, from t0 to t1, closed at both ends.
  // P(t) = point on the path, R(t) = [half width, half thickness], side = the direction "width" runs in.
  function loft(P,R,side,n,m,t0,t1){
    const pos=[],idx=[],S=new THREE.Vector3(...side).normalize(),T=new THREE.Vector3(),N=new THREE.Vector3(),e=1e-3;
    for(let i=0;i<=n;i++){
      const t=t0+(t1-t0)*i/n,p=P(t),a=P(Math.max(0,t-e)),b=P(Math.min(1,t+e)),[rw,rt]=R(t);
      T.set(b[0]-a[0],b[1]-a[1],b[2]-a[2]).normalize();N.crossVectors(T,S).normalize();
      for(let k=0;k<m;k++){const th=k/m*PI*2,c=Math.cos(th)*rw,s=Math.sin(th)*rt;pos.push(p[0]+S.x*c+N.x*s,p[1]+S.y*c+N.y*s,p[2]+S.z*c+N.z*s)}
    }
    for(let i=0;i<n;i++)for(let k=0;k<m;k++){const a=i*m+k,b=i*m+(k+1)%m,c=a+m,d=b+m;idx.push(a,b,c,b,d,c)}
    const c0=pos.length/3;pos.push(...P(t0));const c1=c0+1;pos.push(...P(t1));
    for(let k=0;k<m;k++){idx.push(c0,(k+1)%m,k,c1,n*m+k,n*m+(k+1)%m)}
    let g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);
    // smooth: shared corners give round shading. Line-art: split the corners first, so every face is flat
    if(sm)g.computeVertexNormals();else{const f=g.toNonIndexed();g.dispose();g=f;g.computeVertexNormals()}
    return g;
  }
  // a flat outline (points in a -1..1 square) made into a thin slab of the given size, facing +z
  const slab=(pts,size,depth)=>{const sh=new THREE.Shape(pts.map(([x,y])=>new THREE.Vector2(x*size,y*size)));return new THREE.ExtrudeGeometry(sh,{depth,bevelEnabled:false})};
  const center=g=>{g.computeBoundingBox();const c=g.boundingBox.getCenter(new THREE.Vector3());g.translate(-c.x,-c.y,-c.z);return g};
  const G={};

  // --- supply crate: a taped-up parcel in a chunky frame, a sticker on each side ---
  {
    const p=[],B=(c,g)=>p.push([c,g]),H=.2,bar=.045,o=H-bar/2;
    B("#FFC02E",Bx(.37,.37,.37));
    // the frame: twelve bars along the edges. They sit proud of the faces, so the cube keeps a clean dark outline
    for(const a of[-1,1])for(const b of[-1,1]){B("#E8741C",at(Bx(.4,bar,bar),0,a*o,b*o));B("#E8741C",at(Bx(bar,.4,bar),a*o,0,b*o));B("#E8741C",at(Bx(bar,bar,.4),a*o,b*o,0))}
    // two tape bands that cross on the lid and run down all four sides
    B("#FFF1C4",Bx(.085,.378,.378));B("#FFF1C4",Bx(.378,.378,.085));
    const BOLT=[[.18,1],[-.52,-.08],[-.06,-.08],[-.3,-1],[.56,.2],[.08,.2],[.42,1]];
    const STAR=[];for(let i=0;i<10;i++){const a=PI/2+i*PI/5,r=i%2?.45:1;STAR.push([Math.cos(a)*r,Math.sin(a)*r])}
    for(let k=0;k<4;k++){
      const bolt=k%2===0,ry=k*PI/2;
      B(bolt?"#2B3A8C":"#E23D2E",at(Cy(.105,.105,.012,sm?u(20):8),0,0,.189,PI/2,0,0).applyMatrix4(new THREE.Matrix4().makeRotationY(ry)));
      B(bolt?"#FFE23D":"#FFF6DA",at(slab(bolt?BOLT:STAR,bolt?.078:.074,.006),0,0,.193).applyMatrix4(new THREE.Matrix4().makeRotationY(ry)));
    }
    G.crate=crMerge(p);
  }

  // --- banana peel: a stalk in the middle and four floppy petals draped onto the floor ---
  {
    const p=[],B=(c,g)=>p.push([c,g]),n=sm?u(9):3,m=sm?u(8):4;
    const W=[[0,.016],[.3,.03],[.55,.033],[.8,.024],[1,.006]];
    [[0,.1],[1.45,.088],[3.05,.098],[4.6,.084]].forEach(([ang,len])=>{
      // out from the stalk, down to the floor, then a small curl up at the tip (what makes it read as a peel, not a star)
      const P=t=>[.008+len*t,.009+.056*Math.pow(1-t,2.2)+.3*Math.pow(Math.max(0,t-.7),2),0],R=t=>[lerpT(W,t),.0075];
      B("#FFD21F",at(loft(P,R,[0,0,1],n,m,0,.78),0,0,0,0,ang,0));
      B("#7A4A1C",at(loft(P,R,[0,0,1],sm?u(3):1,m,.78,1),0,0,0,0,ang,0));
    });
    const dome=new THREE.SphereGeometry(1,sm?u(10):5,sm?u(6):3);dome.scale(.032,.024,.032);B("#FFD21F",at(dome,0,.052,0));
    B("#FFD21F",at(Cy(.01,.016,.03,sm?u(8):5),0,.084,0,0,0,.12));
    B("#5A3A1A",at(Cy(.011,.011,.01,sm?u(8):5),-.002,.103,0,0,0,.12));
    G.peel=crMerge(p);G.peel.computeBoundingBox();G.peel.translate(0,-G.peel.boundingBox.min.y,0);   // rest it on the floor
  }

  // --- banana in flight: lies along z, the two ends curl up ---
  {
    const p=[],B=(c,g)=>p.push([c,g]),m=sm?u(10):5,Rr=.15,span=1.6;   // five sides in line-art, like a real banana
    const P=t=>{const a=(t-.5)*span;return[0,Rr*(1-Math.cos(a)),Rr*Math.sin(a)]};
    const W=[[0,.007],[.04,.009],[.1,.019],[.25,.027],[.5,.03],[.75,.026],[.88,.016],[.93,.009],[1,.0075]];
    const R=t=>{const r=lerpT(W,t);return[r*.92,r]};
    B("#4A2E18",loft(P,R,[1,0,0],sm?2:1,m,0,.05));
    B("#FFD21F",loft(P,R,[1,0,0],sm?u(12):4,m,.05,.9));
    B("#8C7A2A",loft(P,R,[1,0,0],sm?2:1,m,.9,1));
    G.banana=center(crMerge(p));
  }

  // --- crumpled paper ball: flat facets, each pushed in or out a little ---
  {
    const base=new THREE.IcosahedronGeometry(1,sm?(TOUCH?1:2):1),src=base.index?base.toNonIndexed():base,a=src.attributes.position,v=new THREE.Vector3();
    const Q=x=>Math.round(x*64);   // copies of one corner must land on the same lump, so hash the rounded position
    for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).normalize();const k=.108*(.8+.3*hash(Q(v.x),Q(v.y),Q(v.z)));a.setXYZ(i,v.x*k,v.y*k,v.z*k)}
    // three paper shades, picked per face, so the creases show even where a style has no shading
    const shade=[[],[],[]],COL=["#F6F4EC","#E4E1D6","#CFCBC0"];
    for(let f=0;f<a.count;f+=3){const c=[0,0,0];for(let j=0;j<3;j++){c[0]+=a.getX(f+j);c[1]+=a.getY(f+j);c[2]+=a.getZ(f+j)}
      const h=hash(Q(c[0]*9),Q(c[1]*9),Q(c[2]*9)),s=shade[h<.5?0:h<.82?1:2];for(let j=0;j<3;j++)s.push(a.getX(f+j),a.getY(f+j),a.getZ(f+j))}
    const parts=[];shade.forEach((s,i)=>{if(!s.length)return;const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(s,3));g.computeVertexNormals();parts.push([COL[i],g])});
    if(src!==base)base.dispose();src.dispose();
    G.paper=crMerge(parts);
  }

  // --- paper airplane: a dart, nose toward -z ---
  {
    // one-sided sheets: the game draws the plane with a double-sided material (a doubled copy would show its seams in line art)
    const sheet=(pts,lift)=>{const pos=[];for(let i=1;i<pts.length-1;i++){const t=[pts[0],pts[i],pts[i+1]];for(const k of[0,1,2])pos.push(...t[k])}
      const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();if(lift)g.translate(0,lift,0);return g};
    const p=[],B=(c,g)=>p.push([c,g]),nose=[0,0,-.15],keel=[0,-.052,.15],mix=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
    for(const k of[-1,1]){
      const fold=[k*.024,0,.15],tip=[k*.125,.02,.15],notch=[k*.07,.01,.12];
      B("#F7F6F0",sheet([nose,fold,notch,tip]));               // wing, with a small notch at the back
      B("#D5DBE8",sheet([nose,keel,fold]));                          // the folded body under it, a shade darker
      // the fold line: a thin blue strip on the wing, just outside the fold
      const a0=mix(nose,fold,.1),a1=fold,b1=mix(fold,tip,.1),b0=mix(nose,mix(fold,tip,.1),.1);
      B("#8DB4EC",sheet([a0,a1,b1,b0],.0015));
    }
    G.plane=center(crMerge(p));
  }

  // --- takeaway coffee: paper cup, cardboard sleeve, lid with a sip spout ---
  {
    const p=[],B=(c,g)=>p.push([c,g]),n=sm?u(16):6,rAt=y=>.033+.012*y/.115;
    B("#F6F2E8",at(Cy(rAt(.115),rAt(0),.115,n),0,.0575,0));
    B("#C47A35",at(Cy(rAt(.088)+.003,rAt(.034)+.003,.054,n,true),0,.061,0));
    B("#5A3622",at(Cy(.05,.05,.012,n),0,.119,0));
    B("#5A3622",at(Cy(.04,.045,.013,n),0,.1315,0));
    B("#3A2216",at(Bx(.018,.004,.01),0,.139,-.026));                                       // sip spout, toward the front
    B("#F6F2E8",at(Cy(.014,.014,.003,sm?u(10):5),0,.061,-(rAt(.061)+.003),PI/2-.104,0,0)); // a round logo on the sleeve, leaning with the cup wall
    G.coffee=crMerge(p);
  }
  return G;
}

/* ---------- HUD icons ---------- */
// Inline SVG, 48 x 48, flat fills inside one dark outline so they stay readable at 36 px on any HUD color.
const BRAWL_ICON=(()=>{
  const O='stroke="#2A1E14" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
  const svg=s=>'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">'+s+'</svg>';
  const hang='M19.5 11 C16.5 21 17.5 32 22 40.5 C23.3 42.6 27.4 42 27.2 39.4 C25.8 31 26.6 21 29.5 11 Z';
  return{
    banana:svg('<path d="M8 12 C6 30 20 43 38 40 C42 39.2 43 35.5 40.5 34 C29 34.5 20 26 17.5 11.5 Z" fill="#FFD21F" '+O+'/>'
      +'<path d="M7.5 12.5 L8.5 5.5 L15.5 4.5 L17.5 11.5 Z" fill="#8A6424" '+O+'/>'
      +'<path d="M13 21 C16 30 23 36 32 37.5" fill="none" stroke="#E8A800" stroke-width="2.5" stroke-linecap="round"/>'),
    bunch:svg('<g transform="rotate(34 24.5 9)"><path d="'+hang+'" fill="#F5BE0F" '+O+'/></g>'
      +'<g transform="rotate(-34 24.5 9)"><path d="'+hang+'" fill="#F5BE0F" '+O+'/></g>'
      +'<path d="'+hang+'" fill="#FFD21F" '+O+'/>'
      +'<path d="M19.5 4.5 H29.5 V12 H19.5 Z" fill="#8A6424" '+O+'/>'),
    paper:svg('<path d="M14 11 L25 6 L36 10.5 L42 21 L39 34 L28 42 L15 39 L6.5 28 L7.5 17 Z" fill="#F6F4EC" '+O+'/>'
      +'<path d="M14 11 L22 20 L36 10.5 M22 20 L19.5 30 L6.5 28 M19.5 30 L28 42 M19.5 30 L32 26 L42 21 M32 26 L39 34" fill="none" stroke="#9AA1AE" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'),
    plane:svg('<path d="M44 5 L20 29 L22.5 43 L29 33.5 Z" fill="#B9C6DE" '+O+'/>'
      +'<path d="M44 5 L4 21.5 L20 29 Z" fill="#FFFFFF" '+O+'/>'
      +'<path d="M44 5 L29 33.5 L41 38.5 Z" fill="#F1F4FA" '+O+'/>'
      +'<path d="M36 10.5 L13 22.5" fill="none" stroke="#8DB4EC" stroke-width="2.5" stroke-linecap="round"/>'),
    coffee:svg('<path d="M13 15 H35 L32 44 H16 Z" fill="#FFF8EA" '+O+'/>'
      +'<path d="M14 24 H34 L32.8 36 H15.2 Z" fill="#C47A35" '+O+'/>'
      +'<circle cx="24" cy="30" r="3" fill="#FFF8EA"/>'
      +'<path d="M15 4.5 H33 L34.5 9.5 H13.5 Z" fill="#6B4129" '+O+'/>'
      +'<path d="M10.5 9.5 H37.5 V15.5 H10.5 Z" fill="#6B4129" '+O+'/>'),
    bubble:svg('<circle cx="24" cy="24" r="19.5" fill="#7FD4FF" fill-opacity=".6" stroke="#15405F" stroke-width="3"/>'
      +'<path d="M24 14 L32.5 17 V24.5 C32.5 30 28.5 33.5 24 35.5 C19.5 33.5 15.5 30 15.5 24.5 V17 Z" fill="#FFFFFF" fill-opacity=".85" stroke="#15405F" stroke-width="2.5" stroke-linejoin="round"/>'
      +'<path d="M10.5 20 A14.5 14.5 0 0 1 19.5 10.5" fill="none" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round"/>'),
  };
})();
