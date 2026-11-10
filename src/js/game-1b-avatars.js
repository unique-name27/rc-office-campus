/* ===================== game part 1b: avatars (RC car, dog, cat) ===================== */
// Each avatar returns the same shape as makeCar's: {g, tilt, cup, under, ...}. Animals add legs/tail/head for animation.
const AVATARS=[["car","RC car"],["dog","Dog"],["cat","Cat"]];
// coat colors for the animals (the car keeps its paint swatches)
const COATS={
  dog:[["#C8924E","Golden"],["#6B4226","Chocolate"],["#2B2622","Black"],["#EFE8DC","Cream"],["#8C8F94","Gray"],["#B5541E","Red"],["#D9C29A","Biscuit"]],
  cat:[["#E08A3C","Orange tabby"],["#2A2724","Black"],["#F2EEE6","White"],["#9AA0A6","Gray"],["#C9B79A","Siamese"],["#7A5A3A","Brown"],["#5E6670","Blue"]]
};
const AV_KINDS=new Set(["car","dog","cat"]);
function makeAvatar(kind,paint){return kind==="dog"||kind==="cat"?makeAnimal(kind,paint):makeCar(paint)}
function makeAnimal(kind,coat){CAR_BUILD=true;try{return buildAnimal(kind,coat)}finally{CAR_BUILD=false}}
function buildAnimal(kind,coat){
  const g=new THREE.Group(),tilt=new THREE.Group();g.add(tilt);root.add(g);
  const dog=kind==="dog",face=S.carFace?pal("car"):coat,oc={car:true,paint:coat,color:face};
  const shade=(c,t,to)=>S.carFace||S.faceIsBg?face:mix(c,to,t).getStyle();
  const light=Object.assign({},oc,{color:shade(coat,.5,"#FFFFFF")}),dark=Object.assign({},oc,{color:shade(coat,.45,"#1A1410")});
  // proportions: a medium dog and a smaller, longer-tailed cat (meters; the RC car is about .5 m long)
  const B=dog?{bw:.24,bh:.2,bd:.42,by:.27,hw:.19,hh:.18,hd:.19,hy:.42,hz:-.27,leg:.2,lx:.08,lz:.15,lr:.034}
             :{bw:.16,bh:.15,bd:.34,by:.21,hw:.16,hh:.14,hd:.14,hy:.32,hz:-.21,leg:.16,lx:.055,lz:.12,lr:.026};
  part(bx(B.bw,B.bh,B.bd),"fur",0,B.by,0,tilt,oc);
  if(dog)part(bx(B.bw*.8,B.bh*.5,B.bd*.5),"fur",0,B.by-B.bh*.3,-.02,tilt,light); // pale belly/chest
  const head=new THREE.Group();head.position.set(0,B.hy,B.hz);tilt.add(head);
  part(bx(B.hw,B.hh,B.hd),"fur",0,0,0,head,oc);
  const eye=(s,y,z,col)=>part(new THREE.BoxGeometry(.026,.03,.012),col?"screen":"tire",s*(dog?.052:.042),y,z,head,col?Object.assign({},oc,{color:S.carFace?col:col}):oc);
  if(dog){
    part(bx(.11,.085,.12),"fur",0,-.035,-.135,head,light);                       // muzzle
    part(new THREE.BoxGeometry(.05,.035,.03),"tire",0,-.008,-.2,head,oc);        // nose
    [-1,1].forEach(s=>{const e=part(bx(.035,.13,.085),"fur",s*.108,-.03,.01,head,dark);e.rotation.z=s*.22});  // floppy ears
    eye(-1,.035,-B.hd/2-.004);eye(1,.035,-B.hd/2-.004);
    part(new THREE.BoxGeometry(B.bw*.82,.035,.06),"ramp",0,B.hy-.1,B.hz+.08,tilt,{car:true,paint:coat,color:S.faceIsBg?null:S.acc}); // collar
  }else{
    part(bx(.075,.05,.045),"fur",0,-.04,-.08,head,light);                        // muzzle
    part(new THREE.BoxGeometry(.024,.018,.012),"tail",0,-.02,-.105,head,Object.assign({},oc,{color:"#E58C9A"})); // pink nose
    [-1,1].forEach(s=>{const cg=new THREE.ConeGeometry(.042,.08,4);cg.rotateY(Math.PI/4);part(cg,"fur",s*.052,.1,.005,head,oc)}); // pointed ears
    eye(-1,.025,-B.hd/2-.004,"#9BD84A");eye(1,.025,-B.hd/2-.004,"#9BD84A");
  }
  // legs on pivots at the hips/shoulders so they can swing
  const legs=[];
  [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sz])=>{
    const pv=new THREE.Group();pv.position.set(sx*B.lx,B.leg+.005,sz*B.lz);tilt.add(pv);
    part(cyl(B.lr,B.lr*.85,B.leg,10),"fur",0,-B.leg/2,0,pv,oc);
    part(bx(B.lr*2.2,.03,B.lr*2.6),"fur",0,-B.leg+.012,-.008,pv,dog?light:oc);
    legs.push(pv);
  });
  // tail: the dog's points up and back, the cat's is long and curls upward
  const tail=new THREE.Group();tail.position.set(0,B.by+B.bh*.25,B.bd/2-.01);tilt.add(tail);
  if(dog){const tg=cyl(.022,.014,.2,8);tg.translate(0,.1,0);const t=part(tg,"fur",0,0,0,tail,oc);t.rotation.x=.7}
  else{const t1=new THREE.Group();tail.add(t1);t1.rotation.x=.55;const a=cyl(.016,.014,.17,8);a.translate(0,.085,0);part(a,"fur",0,0,0,t1,oc);
       const t2=new THREE.Group();t2.position.y=.17;t1.add(t2);t2.rotation.x=-.5;const b=cyl(.014,.011,.13,8);b.translate(0,.065,0);part(b,"fur",0,0,0,t2,dark)}
  const cup=new THREE.Group();cup.position.set(0,B.by+B.bh/2+.005,.03);tilt.add(cup);cup.visible=false;
  part(cyl(.03,.026,.075,12),"cup",0,.04,0,cup,oc);part(cyl(.032,.032,.012,12),"lid",0,.082,0,cup,oc);
  let under=null;
  if(S.glow){const pg=new THREE.PlaneGeometry(.34,.56);pg.rotateX(-Math.PI/2);const gm=new THREE.MeshBasicMaterial({map:RADIAL,color:bright(coat),transparent:true,opacity:.8,blending:THREE.AdditiveBlending,depthWrite:false});glowMats.push(gm);under=new THREE.Mesh(pg,gm);under.position.y=.03;g.add(under)}
  if(S.blob||S.ao){const pg=new THREE.PlaneGeometry(dog?.36:.28,dog?.56:.44);pg.rotateX(-Math.PI/2);under=new THREE.Mesh(pg,new THREE.MeshBasicMaterial({map:RADIAL,color:0x000000,transparent:true,opacity:S.ao?.35:.5,depthWrite:false,toneMapped:false}));under.position.y=.028;g.add(under)}
  return{g,tilt,head,legs,tail,cup,under,kind,wheels:[],ap:null,flame:null,beam:null};
}
// trot cycle, tail wag, head bob; legs tuck while airborne
function animateAnimal(c,v,dt){
  const sp=Math.hypot(c.vx,c.vz),dog=v.kind==="dog";
  c.phase=(c.phase||0)+dt*(3+sp*(dog?3.4:4));
  const amp=Math.min(.8,sp*.16);
  v.legs.forEach((L,i)=>{const ph=(i===0||i===3)?0:Math.PI;L.rotation.x=c.air?(i<2?-.75:.65):Math.sin(c.phase+ph)*amp});
  v.tail.rotation.y=Math.sin(T*(dog?13:3.5)+(dog?0:c.x))*(dog?.55:.3);
  if(!dog)v.tail.rotation.z=Math.sin(T*2.1)*.12;
  v.head.rotation.x=c.air?-.2:Math.sin(c.phase*2)*.04*Math.min(1,sp/2);
  v.tilt.position.y=-c.squash*.03+(c.air?0:Math.abs(Math.sin(c.phase))*.014*Math.min(1,sp/3));
}
