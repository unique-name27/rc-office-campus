/* CAMPUS — the sample San Jose campus and the outdoor world (SPEC.md §5).
   demo(LAYOUT?)  -> 8 believable floors of a chip company (2 buildings x 4 floors) with fake, unique people.
   exterior(doc, floorSpecs?) -> the outdoor CampusModel: footprints, loop road, parking lots, plaza, lawn, ramps.
   Pure and deterministic (seeded PRNG), no globals, no side effects, never throws on bad data. */
const CAMPUS=(()=>{
  const PI=Math.PI,HP=PI/2;
  const ARR=["bench","cubes","offices","lab","hot"];
  const ARR_NAMES=Object.freeze({bench:"Open benches",cubes:"Cubicles",offices:"Private offices",lab:"Lab benches",hot:"Hot desks"});
  const ROOM_TYPES=Object.freeze([["conf","Conference room"],["office","Private office"],["phone","Phone booth"],["kitchen","Kitchen"],
    ["lab","Lab"],["restroom","Restroom"],["stairs","Stairs"],["elevator","Elevator"],["lobby","Lobby"],["server","Server room"],
    ["storage","Storage"],["mail","Mail & print"],["wellness","Wellness room"],["open","Open area"]].map(([type,name])=>Object.freeze({type,name})));
  const ROOM_NAMES=Object.freeze(Object.fromEntries(ROOM_TYPES.map(t=>[t.type,t.name])));
  // SPEC §2 guesses (EDITOR keeps a copy of these rules: change both together)
  const ARR_RULES=[[/lab|validation|characteri|reliab|failure|test floor|bring.?up|silicon val/i,"lab"],
    [/financ|legal|exec|ceo|cfo|counsel/i,"offices"],
    [/hr|people|account|payroll|procure|supply|operation|quality|facilit/i,"cubes"],
    [/sales|market|customer|field|support|business dev/i,"hot"]];
  // mid-tone team colors that read on the light floor and on dark themes (the demo teams use these, in this order)
  const PALETTE=["#C2456B","#2F8F9D","#3E7CB1","#5B8C3A","#D9822B","#8E6FBF","#16A085","#B8860B","#C0392B","#6A5ACD","#CC8A00","#1F8AC0",
    "#B5527D","#4C9F50","#A0522D","#2E9C7A","#5D6DBE","#E06C3A","#7E5BA6","#A8742A","#3A9E9E","#B34F3A","#7A9A2E","#D4618C"];
  const SIDES={n:"n",s:"s",e:"e",w:"w",north:"n",south:"s",east:"e",west:"w"};
  const OUT_YAW={s:PI,n:0,e:-HP,w:HP};      // facing out through a wall on that side (same as LAYOUT)
  const OUT_DIR={s:[0,1],n:[0,-1],e:[1,0],w:[-1,0]};
  const FLOOR_H=4.2;                          // storey height outside (matches the renderer)

  /* ---------- small utils ---------- */
  const num=(v,d)=>{const n=typeof v==="number"?v:(typeof v==="string"&&v.trim()!=="")?Number(v):NaN;return Number.isFinite(n)?n:d};
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;
  const r2=v=>(Math.round(v*100)/100)||0;
  const r3=v=>(Math.round(v*1000)/1000)||0;
  const str=v=>v==null?"":(typeof v==="string"?v:(typeof v==="number"&&Number.isFinite(v))?String(v):"").trim();
  const low=v=>str(v).toLowerCase();
  const na=a=>{a=num(a,0)%(2*PI);if(a>PI)a-=2*PI;else if(a<=-PI)a+=2*PI;return a||0};
  function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
  function rng(seed){let s=seed|0;return()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
  const pick=(R,a)=>a[Math.floor(R()*a.length)%a.length];
  function shuffle(R,a){for(let i=a.length-1;i>0;i--){const j=Math.floor(R()*(i+1));const t=a[i];a[i]=a[j];a[j]=t}return a}
  const hit=(a,b)=>a.x0<b.x1&&b.x0<a.x1&&a.z0<b.z1&&b.z0<a.z1;
  const rect=(x0,z0,x1,z1)=>({x0:Math.min(x0,x1),x1:Math.max(x0,x1),z0:Math.min(z0,z1),z1:Math.max(z0,z1)});
  const grow=(b,g)=>({x0:b.x0-g,x1:b.x1+g,z0:b.z0-g,z1:b.z1+g});

  /* ---------- keys, arrangements, colors ---------- */
  // the floor number is after the LAST "-" (like NAV and EDITOR), so ids such as "SJ-1" round-trip through key()
  const KEY_RE=/^([A-Za-z0-9][A-Za-z0-9_.-]{0,15})-(\d{1,3})$/;
  // "B1", 3 -> "B1-3"; "" when the building id or floor is unusable
  function key(b,f){const id=str(b),n=num(f,NaN);return id&&Number.isFinite(n)?id+"-"+Math.round(n):""}
  function parseKey(k){if(typeof k!=="string")return null;const m=KEY_RE.exec(k.trim());return m?{b:m[1],f:Number(m[2])}:null}
  function defaultArr(team){const s=str(team);for(const [re,a] of ARR_RULES)if(re.test(s))return a;return"bench"}
  // i >= 1: the team's position in a list (consecutive i get distinct colors); otherwise a stable color from the name
  function teamColor(team,i){const n=Math.floor(num(i,0));return PALETTE[(n>=1?n:hash(low(team)))%PALETTE.length]}

  /* ================================================================ demo campus ================================================================ */
  const BUILDINGS=[{id:"B1",name:"Building 1",short:"B1",floors:4,x:-36,z:0,w:42,d:30.23},{id:"B2",name:"Building 2",short:"B2",floors:4,x:46,z:0,w:64,d:48}];

  // name, arrangement, color, lead title, manager titles, IC titles (most common first)
  const TEAM_DEFS=[
    ["Sales & Marketing","hot",PALETTE[0],"Vice president, sales & marketing",["Regional sales director","Marketing manager","Sales manager"],
      ["Account manager","Senior account manager","Product marketing manager","Technical marketing engineer","Sales operations analyst","Business development manager",
       "Marketing communications specialist","Inside sales representative","Pricing analyst","Digital marketing specialist","Event marketing manager","Sales engineer"]],
    ["IT","cubes",PALETTE[1],"Director, IT",["IT manager"],
      ["IT support engineer","Systems administrator","Network engineer","Security engineer","EDA infrastructure engineer","Help desk technician","Cloud infrastructure engineer","IT business analyst"]],
    ["Digital Design","bench",PALETTE[2],"Director, digital design",["Digital design manager"],
      ["Digital design engineer","Senior digital design engineer","RTL design engineer","Staff digital design engineer","Logic design engineer","DFT engineer","Senior DFT engineer","Principal design engineer"]],
    ["Physical Design","bench",PALETTE[3],"Director, physical design",["Physical design manager"],
      ["Physical design engineer","Senior physical design engineer","Staff physical design engineer","Timing closure engineer","Static timing analysis engineer","Physical verification engineer","CAD engineer","Power integrity engineer"]],
    ["Design Verification","bench",PALETTE[4],"Director, design verification",["Verification manager"],
      ["Design verification engineer","Senior design verification engineer","Staff verification engineer","Formal verification engineer","Emulation engineer","Principal verification engineer","Verification methodology engineer"]],
    ["Analog & Mixed-Signal","bench",PALETTE[5],"Director, analog & mixed-signal",["Analog design manager","Layout manager"],
      ["Analog design engineer","Senior analog design engineer","Mixed-signal design engineer","Layout engineer","Senior layout engineer","SerDes design engineer","Staff analog design engineer","Power management IC designer","RF design engineer"]],
    ["Firmware & Software","bench",PALETTE[6],"Director, firmware & software",["Software engineering manager","Firmware manager"],
      ["Firmware engineer","Senior firmware engineer","Embedded software engineer","Software engineer","Senior software engineer","Driver developer","Tools engineer","Staff software engineer"]],
    ["Architecture","cubes",PALETTE[7],"Director, SoC architecture",["Architecture manager"],
      ["SoC architect","Senior SoC architect","Performance architect","Performance modeling engineer","Principal architect","Power architect","Memory subsystem architect"]],
    ["Finance","offices",PALETTE[8],"Vice president, finance",["Controller","FP&A manager","Accounting manager"],
      ["FP&A analyst","Senior FP&A analyst","Accountant","Senior accountant","Cost accountant","Revenue accountant","Treasury analyst","Tax manager","Payroll specialist","Accounts payable specialist"]],
    ["Legal","offices",PALETTE[9],"General counsel",["Associate general counsel"],
      ["Corporate counsel","Senior corporate counsel","IP counsel","Patent attorney","Paralegal","Contracts manager","Export compliance manager","Legal operations specialist"]],
    ["People & HR","cubes",PALETTE[10],"Vice president, people",["HR manager","Talent acquisition manager"],
      ["HR business partner","Recruiter","Technical recruiter","Senior HR business partner","Recruiting coordinator","Compensation analyst","Benefits specialist","HR generalist","People operations specialist","Learning & development specialist"]],
    ["Executive","offices",PALETTE[11],"",[],[]],
    ["Failure Analysis","lab",PALETTE[12],"Director, failure analysis",["FA lab manager"],
      ["Failure analysis engineer","Senior failure analysis engineer","FA technician","FIB/SEM engineer","Lab technician","Staff failure analysis engineer"]],
    ["Reliability","lab",PALETTE[13],"Director, reliability",["Reliability manager"],
      ["Reliability engineer","Senior reliability engineer","Qualification engineer","Reliability technician","ESD/latch-up engineer","Staff reliability engineer"]],
    ["Facilities","cubes",PALETTE[14],"Director, facilities",["Facilities manager"],
      ["Facilities coordinator","Facilities technician","Workplace experience specialist","EHS specialist","Space planner","Security coordinator","Lab facilities engineer"]],
    ["Validation","lab",PALETTE[15],"Director, post-silicon validation",["Validation manager"],
      ["Validation engineer","Senior validation engineer","Post-silicon validation engineer","Bring-up engineer","Board design engineer","Lab technician","Signal integrity engineer","Systems validation engineer"]],
    ["Test Engineering","bench",PALETTE[16],"Director, test engineering",["Test engineering manager"],
      ["Test engineer","Senior test engineer","ATE test engineer","Test development engineer","Test program engineer","Probe card engineer","Load board designer"]],
    ["Product Engineering","bench",PALETTE[17],"Director, product engineering",["Product engineering manager"],
      ["Product engineer","Senior product engineer","Yield engineer","Staff product engineer","Yield data analyst","Yield enhancement engineer"]],
    ["Characterization","lab",PALETTE[18],"Director, characterization",["Characterization manager"],
      ["Characterization engineer","Senior characterization engineer","Lab technician","Device modeling engineer","Bench automation engineer"]],
    ["Packaging","bench",PALETTE[19],"Director, packaging",["Packaging manager"],
      ["Packaging engineer","Senior packaging engineer","Package design engineer","Substrate engineer","Thermal engineer","Assembly engineer"]],
    ["Quality","cubes",PALETTE[20],"Director, quality",["Quality manager"],
      ["Quality engineer","Senior quality engineer","Supplier quality engineer","Customer quality engineer","Quality systems specialist","Document control specialist"]],
    ["Operations & Supply Chain","cubes",PALETTE[21],"Vice president, operations",["Supply chain manager","Procurement manager"],
      ["Buyer","Supply chain planner","Senior buyer","Demand planner","Logistics coordinator","Production control analyst","Commodity manager","Materials planner","Foundry operations engineer","Trade compliance analyst"]],
    ["Program Management","bench",PALETTE[22],"Director, program management",["Program management lead"],
      ["Technical program manager","Senior technical program manager","Program manager","Product line manager","Release manager","Project coordinator"]],
    ["Customer Engineering","hot",PALETTE[23],"Director, customer engineering",["Field applications manager"],
      ["Field applications engineer","Senior field applications engineer","Applications engineer","Customer support engineer","Solutions architect","Technical account manager"]],
  ].map(([name,arr,color,lead,mgr,ic])=>({name,arr,color,lead,mgr,ic}));
  const TEAM_BY_NAME=new Map(TEAM_DEFS.map(t=>[t.name,t]));
  // the executive team gets these titles in this order (assistants after the officers)
  const EXEC_TITLES=["Chief executive officer","Chief financial officer","Chief operating officer","Chief technology officer","Executive vice president, engineering",
    "Senior vice president, worldwide sales","Chief people officer","Senior vice president, products","Chief of staff","Vice president, corporate development",
    "Executive assistant to the CEO","Executive business partner","Executive assistant","Executive assistant","Vice president, investor relations","Executive assistant"];

  /* ---------- people names: large, diverse lists; unique across the campus; no famous full names ---------- */
  const FIRST=("Aarav Aditi Ananya Arjun Deepa Divya Harsha Ishaan Kavya Meera Nikhil Pooja Priya Rahul Rohan Sanjay Shreya Sunil Tanvi Vikram Anika Neha "+
    "Kiran Lakshmi Varun Rina Amit Sneha Siddharth Ravi Asha Gaurav Swati Manish Pallavi Wei Jing Mei Hao Yan Lin Xin Ming Hui Jun Ling Tao Qing Yifan "+
    "Zhen Hiroshi Yuki Kenji Aiko Haruto Sakura Takeshi Emi Ryo Minji Jiwoo Seojun Hyun Eunji Jisoo Taeyang Thanh Linh Minh Quang Mai Tuan Bao Ngoc Anh "+
    "Duc Phuong Khoa Alejandro Camila Diego Elena Gabriela Javier Lucia Mateo Rafael Sofia Valeria Carlos Isabel Luis Marisol Andrés José Ximena Fernanda "+
    "Rodrigo Paola Emilio Adriana Joaquín Renata Ade Amara Chidi Kwame Nia Oluwaseun Zainab Kofi Abena Thabo Adaeze Emeka Folake Yaw Ama Tendai Sipho "+
    "Wanjiru Kamau Omar Layla Yusuf Fatima Karim Noor Rami Samira Tariq Leila Hassan Dina Ali Reza Nadia Arash Shirin Darius Mehmet Elif Hamza Farah Bilal "+
    "Ayesha Alice Ben Claire David Emma Ethan Grace Henry Isaac Julia Kate Liam Lucy Maya Noah Olivia Owen Paul Rachel Sam Sarah Tom Zoe Hannah Jack Laura "+
    "Nathan Rebecca Ryan Megan Chris Erin Kevin Molly Sean Tessa Caleb Avery Jordan Morgan Quinn Riley Dylan Abby Brian Colin Dana Evan Fiona Gavin Holly "+
    "Ian Jenna Keith Leah Marcus Nora Peter Ruth Scott Tara Victor Wendy Anya Dmitri Irina Katya Mikhail Natalia Pavel Sergei Tatiana Yuri Oksana Bogdan "+
    "Milena Petra Tomasz Agnieszka Marek Ivana Lars Ingrid Sven Astrid Erik Freya Jonas Anke Matthias Lena Felix Greta Björn Søren Nils Amélie Julien "+
    "Chloé Luca Giulia Marco Francesca Matteo Chiara Pierre Camille Hugo Thiago Beatriz Mateus Kai Leilani Malia Keoni").split(" ");
  const LAST=("Patel Shah Sharma Gupta Iyer Reddy Rao Nair Menon Krishnan Kulkarni Desai Joshi Mehta Bhat Chatterjee Banerjee Mukherjee Pillai Agarwal "+
    "Verma Kapoor Malhotra Srinivasan Subramanian Venkatesh Raman Chandra Bose Das Sethi Naidu Chen Wang Li Zhang Liu Yang Huang Zhao Wu Zhou Xu Sun Ma "+
    "Zhu Hu Guo He Lin Luo Gao Tanaka Suzuki Takahashi Watanabe Ito Yamamoto Nakamura Kobayashi Sato Kim Park Choi Jung Kang Cho Yoon Lim Han Tsai Hsu "+
    "Lai Kuo Chang Wong Leung Chan Ho Yeung Fong Nguyen Tran Le Pham Hoang Phan Vu Dang Bui Do Ngo Duong Truong Vo Santos Reyes Cruz Bautista Ocampo "+
    "Mendoza Villanueva Navarro Garcia Rodriguez Martinez Hernandez Lopez Gonzalez Perez Sanchez Ramirez Torres Flores Rivera Gomez Diaz Morales Ortiz "+
    "Castillo Romero Vargas Herrera Medina Aguilar Castro Ruiz Alvarez Jimenez Moreno Salazar Delgado Vega Rios Fuentes Cabrera Soto Guerrero Okafor "+
    "Adeyemi Mensah Owusu Nwosu Okoro Diallo Kamara Ndlovu Okonkwo Boateng Asante Adebayo Eze Obi Balogun Danso Kariuki Mwangi Otieno Tesfaye Bekele "+
    "Haile Moyo Haddad Khalil Nasser Hakimi Rahimi Karimi Hosseini Ahmadi Mansour Saleh Aziz Hamdan Darwish Yilmaz Demir Kaya Sahin Celik Anderson "+
    "Baker Bennett Brooks Campbell Carter Clarke Collins Cooper Davies Edwards Evans Fisher Foster Graham Gray Hayes Hughes Hunt Kelly Lewis Marshall "+
    "Mitchell Murphy Murray Parker Porter Reed Richardson Russell Shaw Simmons Stewart Sullivan Turner Walsh Ward Watson Webb Wells Wood Young Bishop "+
    "Fleming Hart Lane Price Whitaker Holloway Prescott Donovan Becker Fischer Hoffmann Keller Klein Koch Krause Lang Meyer Richter Schmidt Schneider "+
    "Schulz Vogel Wagner Weber Wolf Zimmermann Larsen Lindqvist Nilsson Andersen Johansson Berg Dahl Holm Strand Ivanov Petrov Novak Kowalski Nowak "+
    "Horvat Popescu Volkov Sokolov Kuznetsov Morozov Pavlov Kovac Dvorak Wojcik Lewandowski Zielinski Rossi Russo Esposito Bianchi Romano Colombo Ricci "+
    "Marino Greco Bruno Gallo Conti Costa Mancini Lombardi Moretti Dubois Martin Bernard Petit Durand Leroy Moreau Laurent Girard Fournier Lefebvre "+
    "Silva Oliveira Pereira Ferreira Almeida Carvalho Ribeiro Rocha O'Brien O'Connor Byrne Doyle Kavanagh MacDonald Fraser Lynch Cohen Levy Katz "+
    "Friedman Goldberg Rosen Shapiro Weiss Adler Kahale Begay Yazzie").split(" ");
  // well-known people (and famous fictional characters) these lists could otherwise produce
  const FAMOUS=new Set(["emma watson","grace kelly","kevin hart","chris evans","chris martin","chris young","david lynch","ryan murphy","arjun kapoor",
    "raj kapoor","deepa mehta","sanjay gupta","kiran desai","amit shah","diego rivera","lucy liu","isaac hayes","owen hart","ben foster","kate walsh",
    "sarah hughes","rachel ward","grace park","ethan hunt","henry cooper","david price","liam gallagher","marco rossi","andrés torres","javier hernandez",
    "diego lopez","lisa su","jensen huang","morris chang","tim cook","paul walker","tom hughes","emma stone","julia stewart","sam cooke","hugo boss",
    "luis suarez","carlos santana","rafael nadal","omar sharif","kofi annan","noah baker","kevin parker","laura dern","claire foy","ryan reynolds",
    "chris brown","sean kelly","paul simon","ian wright","peter parker","scott walsh","victor cruz","brian cox","colin farrell","jack ryan"]);
  function namer(R){
    const used=new Set(FAMOUS);
    return()=>{
      for(let t=0;t<400;t++){const n=pick(R,FIRST)+" "+pick(R,LAST),k=n.toLowerCase();if(!used.has(k)){used.add(k);return n}}
      for(let t=0;;t++){const n=pick(R,FIRST)+" "+String.fromCharCode(65+t%26)+". "+pick(R,LAST),k=n.toLowerCase();if(!used.has(k)){used.add(k);return n}}
    };
  }
  // titles for n people of a team (one lead from 8 people, a manager per ~9, ICs weighted toward the common titles)
  function titlesFor(team,n,R){
    const def=TEAM_BY_NAME.get(team),out=[];
    if(!def)return new Array(n).fill("Engineer");
    if(!def.ic.length){for(let i=0;i<n;i++)out.push(EXEC_TITLES[i]||"Executive assistant");return shuffle(R,out)}
    if(n>=8&&def.lead)out.push(def.lead);
    const mg=n>=4?Math.max(1,Math.round(n/9)):0;
    for(let i=0;i<mg&&out.length<n;i++)out.push(def.mgr[i%def.mgr.length]);
    while(out.length<n)out.push(def.ic[Math.floor(Math.pow(R(),1.8)*def.ic.length)]);
    return shuffle(R,out);
  }

  /* ---------- the 8 floors ----------
     Rooms: [id, type, name, x0, z0, x1, z1, door, seats?]; zones: [id, team, arr|null, x0, z0, x1, z1, dir?] (edges in floor meters).
     Each building has one core (2 elevators, stairs, solid restrooms) at the same place on every floor, elevators opening south:
     Building 1's sits mid-floor with the main east-west aisle in front of it; Building 2's is on the north wall at the head of a
     wide spine that runs south to the lobby. Labs are "lab" rooms whose door opens onto a main aisle, with a lab zone inside that
     leaves an entry strip by the door (ESD smocks, carts). Zones stay off rooms; they may touch each other and the walls. */
  const CORE={
    // Building 1: the core sits west of the middle and its elevators open east onto a
    // corridor; restrooms, IDF and storage beside it; stairs in the south-west (by the lobby) and north-east corners
    B1:[["e1","elevator","Elevator A",-16.2,-1.932,-14.068,0.614,"e"],["e2","elevator","Elevator B",-16.2,0.705,-14.068,3.159,"e"],
        ["st1","stairs","Stairs",-13.705,6.25,-9.614,12.386,null],["st2","stairs","Stairs",17.659,-9.659,20.977,-1.5,null],
        ["rr1","restroom","Restrooms",-10.841,-4.568,-3.94,-0.068,null],["rr2","restroom","Restrooms",-10.841,-0.06,-3.94,4.432,null],
        ["idf","server","IDF",-3.932,-4.568,-1.296,-0.568,null],["sto","storage","Storage",-3.932,-0.56,-1.296,4.432,null],
        ["elec","storage","Electrical",-20.977,-2.841,-16.205,4.432,null]],
    B2:[["e1","elevator","Elevator A",-2.8,-24,0,-18.8,"s"],["e2","elevator","Elevator B",0,-24,2.8,-18.8,"s"],
        ["st1","stairs","Stairs",-8,-24,-2.8,-18.8,null],["rr1","restroom","Restrooms",2.8,-24,8,-18.8,null]],
  };
  // walls every floor of a building shares (Building 1's edge where the plate is not the building: its north-west corner
  // is outside), and structural columns (each a 0.45 m square)
  const SHELL={
    B1:{walls:[[-20.977,-4.568,-15.977,-4.568],[-15.977,-9.523,-15.977,-4.568],[-15.977,-9.523,-9.295,-9.523],[-9.295,-15.114,-9.295,-9.523],[-20.295,6.25,-20.295,15.114]],
        cols:[[5.841,-14.795],[12.977,-14.795],[20.523,-14.795],[5.841,-4.386],[13.023,-4.341],[5.841,4.432],[13.023,4.341],[20.386,4.705],[13.023,14.659]]},
  };
  // Building 1's desks: numbered bench desks in three blocks and temp (hot) desks T1-T18:
  // [id, x, z, facing n/s/e/w, arr]. Every floor repeats the grid; each floor seats its own teams by block:
  // A = desks 26-49 (north-west), B = 50-76 (north-east), C = 1-25 (south-east). Temp desks stay open.
  const B1_DESKS=[
    ["26",1.269,-13.339,"e"],["27",1.269,-11.789,"e"],["28",1.269,-10.239,"e"],["29",1.269,-8.689,"e"],["30",1.269,-7.139,"e"],
    ["37",2.049,-13.339,"w"],["36",2.049,-11.789,"w"],["35",2.049,-10.239,"w"],["34",2.049,-8.689,"w"],["33",2.049,-7.139,"w"],
    ["32",2.049,-5.589,"w"],["38",5.042,-13.339,"e"],["39",5.042,-11.789,"e"],["40",5.042,-10.239,"e"],["41",5.042,-8.689,"e"],
    ["42",5.042,-7.139,"e"],["43",5.042,-5.589,"e"],["49",5.822,-13.339,"w"],["48",5.822,-11.789,"w"],["47",5.822,-10.239,"w"],
    ["46",5.822,-8.689,"w"],["45",5.822,-7.139,"w"],["44",5.822,-5.589,"w"],["50",8.86,-13.339,"e"],["51",8.86,-11.789,"e"],
    ["52",8.86,-10.239,"e"],["53",8.86,-8.689,"e"],["54",8.86,-7.139,"e"],["55",8.86,-5.589,"e"],["56",8.86,-4.039,"e"],
    ["63",9.64,-13.339,"w"],["62",9.64,-11.789,"w"],["61",9.64,-10.239,"w"],["60",9.64,-8.689,"w"],["59",9.64,-7.139,"w"],
    ["58",9.64,-5.589,"w"],["57",9.64,-4.039,"w"],["64",13.178,-13.339,"e"],["65",13.178,-11.789,"e"],["66",13.178,-10.239,"e"],
    ["67",13.178,-8.689,"e"],["68",13.178,-7.139,"e"],["69",13.178,-5.589,"e"],["76",13.958,-13.339,"w"],["75",13.958,-11.789,"w"],
    ["74",13.958,-10.239,"w"],["73",13.958,-8.689,"w"],["72",13.958,-7.139,"w"],["71",13.958,-5.589,"w"],["70",13.958,-4.039,"w"],
    ["1",9.913,5.95,"w"],["2",9.913,7.805,"w"],["3",9.913,9.659,"w"],["4",9.913,11.514,"w"],["5",9.913,13.368,"w"],
    ["6",13.178,5.95,"e"],["7",13.178,7.805,"e"],["8",13.178,9.659,"e"],["9",13.178,11.514,"e"],["10",13.178,13.368,"e"],
    ["11",13.958,5.95,"w"],["12",13.958,7.805,"w"],["13",13.958,9.659,"w"],["14",13.958,11.514,"w"],["15",13.958,13.368,"w"],
    ["16",17.087,5.95,"e"],["17",17.087,7.805,"e"],["18",17.087,9.659,"e"],["19",17.087,11.514,"e"],["20",17.087,13.368,"e"],
    ["21",17.867,5.95,"w"],["22",17.867,7.805,"w"],["23",17.867,9.659,"w"],["24",17.867,11.514,"w"],["25",17.867,13.368,"w"],
    ["T13",17.659,-13.414,"s","hot"],["T14",18.841,-13.414,"s","hot"],["T15",20.023,-13.414,"s","hot"],["T16",17.659,-12.814,"n","hot"],["T17",18.841,-12.814,"n","hot"],
    ["T18",20.023,-12.814,"n","hot"],["T7",18.114,-0.659,"n","hot"],["T10",19.341,-0.659,"n","hot"],["T8",18.114,0.75,"n","hot"],["T11",19.341,0.75,"n","hot"],
    ["T9",18.114,2.159,"n","hot"],["T12",19.341,2.159,"n","hot"],["T1",10.159,2.905,"s","hot"],["T2",10.159,3.505,"n","hot"],["T3",14.25,2.905,"s","hot"],
    ["T4",14.25,3.505,"n","hot"],["T5",16.841,4.523,"s","hot"],["T6",18.159,4.523,"s","hot"]
  ];
  function b1Desks(f,teams){
    return B1_DESKS.map(([id,x,z,face,arr])=>{const n=+id,blk=isNaN(n)?null:n>=26&&n<=49?"A":n>=50?"B":"C";
      return[f===1?id:f+"-"+id,x,z,face,arr||null,blk?teams[blk]:null]});
  }
  const FLOOR_DEFS=[
    // ---- Building 1 (42 x 30.2): design & business ----
    // Floor 1: a lobby in the south-west, a kitchen, four conference rooms and the desk grid (B1_DESKS).
    // Floors 2-4 share its core, columns and desks, with conference rooms over the lobby wing. desks: [id, x, z, facing, arr, team]
    {b:"B1",f:1,door:{side:"s",at:-15.07,w:2.4},rooms:[
      ["lob","lobby","Lobby",-20.295,6.25,-13.71,15.114,"s"],
      ["cafe","kitchen","Fab Caf\u00e9",-9.295,-15.114,-1.25,-6.341,"s"],
      ["c11","conf","Silicon",-9.295,6.341,-3.023,15.114,"n",14],["c12","conf","Gallium",-3.015,6.341,2.886,15.114,"n",12],
      ["c13","conf","Germanium",2.894,6.341,7.341,10.659,"e",6],["c14","conf","Indium",2.894,10.667,7.341,15.114,"e",6],
      ["ent","open","Entry",-15.977,-9.523,-9.3,-4.58,null],
    ],zones:[],desks:b1Desks(1,{A:"IT",B:"Sales & Marketing",C:"Sales & Marketing"})},
    {b:"B1",f:2,rooms:[
      ["k2","kitchen","Kitchen",-9.295,-15.114,-1.25,-6.341,"s"],
      ["c21","conf","Tungsten",-9.295,8.2,-3.6,15.114,"n"],["c22","conf","Copper",-3.59,8.2,2.1,15.114,"n"],["c23","conf","Tapeout War Room",2.11,8.2,7.341,15.114,"n",12],
      ["p21","phone","Phone 2A",-15.8,-9.35,-13.8,-7.35,"s"],["p22","phone","Phone 2B",-13.6,-9.35,-11.6,-7.35,"s"],
      ["m2","mail","Mail & print",-20.1,11.2,-16,15,"e"],
    ],zones:[],desks:b1Desks(2,{A:"Digital Design",B:"Physical Design",C:"Design Verification"})},
    {b:"B1",f:3,rooms:[
      ["k3","kitchen","Kitchen",-9.295,-15.114,-1.25,-6.341,"s"],
      ["c31","conf","Phosphorus",-9.295,8.2,-3.6,15.114,"n"],["c32","conf","Antimony",-3.59,8.2,2.1,15.114,"n"],["c33","conf","Selenium",2.11,8.2,7.341,15.114,"n"],
      ["p31","phone","Phone 3A",-15.8,-9.35,-13.8,-7.35,"s"],["p32","phone","Phone 3B",-13.6,-9.35,-11.6,-7.35,"s"],
      ["w3","wellness","Wellness",-20.1,11.2,-16,15,"e"],
    ],zones:[],desks:b1Desks(3,{A:"Analog & Mixed-Signal",B:"Firmware & Software",C:"Architecture"})},
    {b:"B1",f:4,rooms:[
      ["k4","kitchen","Kitchen",-9.295,-15.114,-1.25,-6.341,"s"],
      ["c41","conf","Boardroom",-9.295,8.2,-3.6,15.114,"n",12],["c42","conf","Platinum",-3.59,8.2,2.1,15.114,"n"],["c43","conf","Hafnium",2.11,8.2,7.341,15.114,"n"],
      ["p41","phone","Phone 4A",-15.8,-9.35,-13.8,-7.35,"s"],["p42","phone","Phone 4B",-13.6,-9.35,-11.6,-7.35,"s"],
      ["m4","mail","Mail & print",-20.1,11.2,-16,15,"e"],
    ],zones:[
      // two window offices for the executives in the south-east corner (desks 11-25 and T3-T6 make way); Legal takes desks 1-10
      ["z1","Executive",null,15,5.2,20.75,14.85,"v"],
    ],desks:b1Desks(4,{A:"People & HR",B:"Finance",C:"Legal"}).filter(d=>{const n=+String(d[0]).split("-")[1];return!(n>=11&&n<=25)&&!/-T[3-6]$/.test(d[0])})},
    // ---- Building 2 (64 x 48): labs & operations. Core on the north wall, a wide spine south to the lobby/kitchen ----
    {b:"B2",f:1,rooms:[
      ["lob","lobby","Lobby",-6,14,6,24,"s"],
      ["fa","lab","Failure Analysis Lab",-32,-24,-8,0,"e"],
      ["rl","lab","Reliability Lab",8,-24,32,0,"w"],
      ["k1","kitchen","Kitchen",8,15.5,18,24,"n"],
      ["c11","conf","Willow Glen",18,17.5,25,24,"n"],["c12","conf","Almaden",25,17.5,32,24,"n",10],
      ["m1","mail","Shipping & receiving",-8,5,-3.5,10,"e"],
      ["p11","phone","Phone 1A",4.5,5,6.5,7,"w"],["p12","phone","Phone 1B",4.5,7.5,6.5,9.5,"w"],
    ],zones:[
      ["z1","Failure Analysis",null,-31.7,-23.7,-12,-0.3],
      ["z2","Reliability",null,12,-23.7,31.7,-0.3],
      ["z3","Failure Analysis","bench",-32,3.5,-8,13.5],
      ["z4","Reliability","bench",8,3.5,32,13.5],
      ["z5","Facilities",null,-32,14,-8,24],
    ]},
    {b:"B2",f:2,rooms:[
      ["vl","lab","Validation Lab",-32,-24,-8,8,"e"],
      ["srv","server","Server room",-32,11,-24,16.5,"e"],
      ["p21","phone","Phone 2A",-23,11,-21,13,"s"],["p22","phone","Phone 2B",-21,11,-19,13,"s"],
      ["c21","conf","Alviso",-32,18,-25,24,"n"],["c22","conf","Berryessa",-25,18,-18,24,"n"],["c23","conf","Evergreen",-18,18,-11,24,"n",10],
      ["k2","kitchen","Kitchen",-7,15,5,24,"n"],
    ],zones:[
      ["z1","Validation",null,-31.7,-23.7,-12,7.7],
      ["z2","Test Engineering",null,8,-24,32,-0.5],
      ["z3","Product Engineering",null,8,3.5,32,24],
    ]},
    {b:"B2",f:3,rooms:[
      ["cl","lab","Characterization Lab",8,-24,32,8,"w"],
      ["k3","kitchen","Kitchen",-7,15,5,24,"n"],
      ["c31","conf","Japantown",8,17.5,15,24,"n"],["c32","conf","Rose Garden",15,17.5,22,24,"n"],["c33","conf","Naglee Park",22,17.5,32,24,"n",12],
      ["w3","wellness","Wellness",8,11,12,15,"s"],["p31","phone","Phone 3A",13,13,15,15,"s"],["p32","phone","Phone 3B",15,13,17,15,"s"],
      ["m3","mail","Mail & print",18,11,23,15,"s"],
    ],zones:[
      ["z1","Characterization",null,12,-23.7,31.7,7.7],
      ["z2","Packaging",null,-32,-24,-8,-0.5],
      ["z3","Quality",null,-32,3.5,-8,24],
    ]},
    {b:"B2",f:4,rooms:[
      ["k4","kitchen","Kitchen",-7,15,5,24,"n"],
      ["c41","conf","Cambrian",-8,-2,-3,4,"e"],["c42","conf","Santa Teresa",-8,5,-3,11,"e"],
      ["c43","conf","Blossom Valley",3,-2,8,4,"w"],["p41","phone","Phone 4A",6,5,8,7,"w"],["p42","phone","Phone 4B",6,7.5,8,9.5,"w"],
    ],zones:[
      ["z1","Operations & Supply Chain",null,-32,-24,-8,-0.5],
      ["z2","Program Management",null,8,-24,32,-0.5],
      ["z3","Operations & Supply Chain",null,-32,3.5,-8,24],
      ["z4","Customer Engineering",null,8,3.5,32,24],
    ]},
  ];

  function floorSpec(fd){
    const B=BUILDINGS.find(b=>b.id===fd.b);
    const rooms=CORE[fd.b].concat(fd.rooms).map(([id,type,name,x0,z0,x1,z1,door,seats])=>{
      const r={id,type,name,x:r3((x0+x1)/2),z:r3((z0+z1)/2),w:r3(x1-x0),d:r3(z1-z0),door:door||null};
      if(seats)r.seats=seats;return r});
    const zones=fd.zones.map(([id,team,arr,x0,z0,x1,z1,dir])=>{
      const z={id,team,arr:arr||null,x:r3((x0+x1)/2),z:r3((z0+z1)/2),w:r3(x1-x0),d:r3(z1-z0)};if(dir)z.dir=dir;return z});
    const sh=SHELL[fd.b]||{walls:[],cols:[]},walls=sh.walls.map(w=>w.slice());
    for(const [x,z] of sh.cols){const h=.225;walls.push([r3(x-h),r3(z-h),r3(x+h),r3(z-h)],[r3(x+h),r3(z-h),r3(x+h),r3(z+h)],[r3(x+h),r3(z+h),r3(x-h),r3(z+h)],[r3(x-h),r3(z+h),r3(x-h),r3(z-h)])}
    const FACE={n:0,s:Math.PI,e:-Math.PI/2,w:Math.PI/2};
    const desks=(fd.desks||[]).map(([id,x,z,f,arr,team])=>{const d={id,x,z,a:FACE[f]};if(arr)d.arr=arr;else d.arr="bench";if(team)d.team=team;return d});
    return{v:1,key:key(fd.b,fd.f),b:fd.b,f:fd.f,w:B.w,d:B.d,door:fd.f===1?Object.assign({side:"s",at:0,w:3},fd.door||{}):null,plan:null,
      walls,glass:[],rooms,zones,desks,ramps:null,updatedAt:0};
  }
  // Desks a zone will roughly hold (used only when LAYOUT isn't passed): LAYOUT's group grids, minus 15% for edge losses.
  // [pitch along, pitch across, group length, group depth, desks per group]; offices and labs are rows, estimated from area.
  const GROUPS={bench:[6.2,5,4.76,2.84,6],cubes:[6.4,6.4,4.98,4.98,4],hot:[5,4.4,3.6,2.26,6]};
  function estimate(z,arr){
    const U=Math.max(z.w,z.d)-2,V=Math.min(z.w,z.d)-2,g=GROUPS[arr];
    if(!(U>0&&V>0))return 0;
    const n=g?(U>=g[2]&&V>=g[3]?(Math.floor((U-g[2])/g[0])+1)*(Math.floor((V-g[3])/g[1])+1)*g[4]:0)
      :arr==="offices"?Math.floor(U/3.2)*(V>=9.2?2*Math.floor((V+1.6)/10.8):V>=3.6?1:0):U*V/10;
    return Math.floor(n*0.85);
  }
  // Seats per zone. With LAYOUT: the exact auto desk ids it will generate (a build with nobody seated), else its capacity.
  function zoneSeats(spec,lay,teams){
    const out=new Map();
    if(lay){
      try{
        const m=lay.build(spec,[],teams,{lite:true});
        if(m&&Array.isArray(m.desks)){
          for(const d of m.desks){if(!d||d.zone==null||typeof d.id!=="string")continue;let s=out.get(d.zone);if(!s)out.set(d.zone,s={ids:[],n:0});s.ids.push(d.id);s.n++}
          return out;
        }
      }catch(e){/* fall through */}
      try{
        const c=typeof lay.capacity==="function"?lay.capacity(spec,teams):null;
        if(c&&c.byZone&&typeof c.byZone==="object"){for(const z of spec.zones)out.set(z.id,{ids:null,n:Math.max(0,Math.floor(num(c.byZone[z.id],0)))});return out}
      }catch(e){/* fall through */}
    }
    for(const z of spec.zones)out.set(z.id,{ids:null,n:estimate(z,z.arr||(teams[z.team]&&teams[z.team].arr)||defaultArr(z.team))});
    return out;
  }
  // a floor's people: each team zone 85-92% full, open desks scattered (seeded), rows in desk order
  function floorRoster(spec,lay,teams,nextName){
    const R=rng(hash("roster|"+spec.key)),seats=zoneSeats(spec,lay,teams),byTeam=new Map();
    for(const z of spec.zones){
      const s=seats.get(z.id);if(!s||!s.n||!z.team)continue;
      const k=Math.min(s.n,Math.round(s.n*(0.85+R()*0.07)));
      let desks;
      if(s.ids){const idx=s.ids.map((_,i)=>i);shuffle(R,idx);desks=idx.slice(0,k).sort((a,b)=>a-b).map(i=>s.ids[i])}
      else desks=new Array(k).fill("");
      if(!byTeam.has(z.team))byTeam.set(z.team,[]);
      byTeam.get(z.team).push(...desks);
    }
    // hand-placed desks with a team (Building 1, floor 1): the same fill, desk by desk
    const hand=new Map();
    for(const d of spec.desks||[]){if(!d||!d.team||d.arr==="hot")continue;if(!hand.has(d.team))hand.set(d.team,[]);hand.get(d.team).push(String(d.id))}
    for(const [team,ids] of hand){
      const k=Math.min(ids.length,Math.round(ids.length*(0.85+R()*0.07))),idx=ids.map((_,i)=>i);shuffle(R,idx);
      if(!byTeam.has(team))byTeam.set(team,[]);
      byTeam.get(team).push(...idx.slice(0,k).sort((a,b)=>a-b).map(i=>ids[i]));
    }
    const rows=[];
    for(const [team,desks] of byTeam){
      const titles=titlesFor(team,desks.length,R);
      desks.forEach((desk,i)=>rows.push({desk,name:nextName(),team,title:titles[i]}));
    }
    return rows;
  }
  function demo(L){
    const lay=L&&(typeof L==="object"||typeof L==="function")&&typeof L.build==="function"?L:null;
    const teams={};TEAM_DEFS.forEach(t=>{teams[t.name]={color:t.color,arr:t.arr}});
    const campus={v:1,name:"San Jose campus",demo:true,buildings:BUILDINGS.map(b=>Object.assign({},b)),teams};
    const floors={},rosters={},nextName=namer(rng(hash("san-jose-people")));
    for(const fd of FLOOR_DEFS){
      const spec=floorSpec(fd);floors[spec.key]=spec;
      const tm={};for(const k in teams)tm[k]=Object.assign({},teams[k]);   // LAYOUT gets its own copy
      rosters[spec.key]=floorRoster(spec,lay,tm,nextName);
    }
    return{campus,floors,rosters};
  }

  /* ================================================================ exterior ================================================================ */
  const CAR_COLORS=["#F2F2EE","#F2F2EE","#1E1F22","#1E1F22","#A9ADB3","#A9ADB3","#6B7078","#22344F","#B3282D","#2F64B1","#2F5D46","#C9B79C","#8C1D2E","#D7D2C8","#3C4048"];
  const WHITE="#F4F1EA",YELLOW="#E8B83A";
  const BAY_W=2.6,BAY_D=5.2,AISLE_W=7,ROAD_HW=3.5;

  function normBuildings(doc,P){
    const out=[],ids=new Set();
    (Array.isArray(doc.buildings)?doc.buildings:[]).forEach((b,i)=>{
      if(!b||typeof b!=="object"){P.push(`Building #${i+1} is not an object: skipped`);return}
      const id=str(b.id);
      if(!id){P.push(`Building #${i+1} has no id: skipped`);return}
      if(ids.has(low(id))){P.push(`Duplicate building id "${id}": skipped`);return}
      ids.add(low(id));
      const w=clamp(Math.abs(num(b.w,70))||70,8,400),d=clamp(Math.abs(num(b.d,44))||44,8,400);
      out.push({id,name:str(b.name)||id,short:str(b.short)||id,floors:clamp(Math.round(num(b.floors,4)),1,40),
        x:clamp(num(b.x,0),-1500,1500),z:clamp(num(b.z,0),-1500,1500),w,d});
    });
    for(let i=0;i<out.length;i++)for(let j=i+1;j<out.length;j++){const a=out[i],c=out[j];
      if(hit(rect(a.x-a.w/2,a.z-a.d/2,a.x+a.w/2,a.z+a.d/2),rect(c.x-c.w/2,c.z-c.d/2,c.x+c.w/2,c.z+c.d/2)))P.push(`Buildings ${a.id} and ${c.id} overlap`)}
    return out;
  }
  // the floor-1 doorway of a building, normalized exactly like LAYOUT does so the two pads line up
  function doorOf(b,fs,P){
    const sp=fs?fs[key(b.id,1)]:null,dr=sp&&typeof sp==="object"&&sp.door&&typeof sp.door==="object"?sp.door:null;
    let side="s",at=0,dw=3;
    const sk=dr?low(dr.side):"";
    if(dr&&Object.prototype.hasOwnProperty.call(SIDES,sk)){side=SIDES[sk];at=num(dr.at,0);dw=num(dr.w,3)}
    else if(sp&&typeof sp==="object")P.push(`${b.name} floor 1 has no exterior door: using the middle of the south wall`);
    const len=side==="n"||side==="s"?b.w:b.d;
    dw=clamp(Math.abs(dw)||3,1.2,Math.max(1.2,len-2));
    at=clamp(at,-len/2+dw/2+0.5,len/2-dw/2-0.5);
    const o=OUT_DIR[side],horiz=side==="n"||side==="s";
    const wx=horiz?b.x+at:b.x+o[0]*b.w/2,wz=horiz?b.z+o[1]*b.d/2:b.z+at;   // middle of the doorway, on the wall line
    return{side,at,w:dw,o,wx,wz,x:wx+o[0]*1.2,z:wz+o[1]*1.2,a:OUT_YAW[side]};
  }

  function exterior(doc,floorSpecs){
    const P=[];
    const D0=doc&&typeof doc==="object"?doc:{};
    const fs=floorSpecs&&typeof floorSpecs==="object"?floorSpecs:null;
    const blds=normBuildings(D0,P);
    if(!blds.length)P.push("No buildings: showing an empty campus");
    const R=rng(hash("campus|"+blds.map(b=>b.id+":"+b.x+","+b.z+","+b.w+","+b.d).join(";")));
    const doors=blds.map(b=>doorOf(b,fs,P));
    const campusName=str(D0.name).slice(0,60)||"San Jose campus";

    // plate: at least 230 x 150 m, and always 27 m around the buildings for the loop road and its verges
    let ex=0,ez=0;for(const b of blds){ex=Math.max(ex,Math.abs(b.x)+b.w/2);ez=Math.max(ez,Math.abs(b.z)+b.d/2)}
    const HW=Math.max(115,Math.ceil(ex+27)),HD=Math.max(75,Math.ceil(ez+27));
    const RX=HW-10,RZ=HD-13;                // loop road centerline (a rectangle)

    const M={key:"campus",w:2*HW,d:2*HD,buildings:[],areas:[],lines:[],items:[],blocks:[],posts:[],ramps:[],signs:[],
      spawn:{x:0,z:0,a:0},dests:[],problems:P};
    const bldKeep=[];   // building footprints + 1.2 m
    const keep=[];      // solid things never go here: buildings, doorway approaches, roads
    const spots=[];     // [x,z,r] circles kept clear: door pads, spawn, dests
    const used=[];      // footprints taken by items (grown by their clearance)
    const lanes=[];     // ramp run-up / run-out lanes: items stay out
    const block=(b,m,tall)=>{if(b.x1>b.x0&&b.z1>b.z0)M.blocks.push({x0:r3(b.x0),x1:r3(b.x1),z0:r3(b.z0),z1:r3(b.z1),m,tall})};
    const post=(x,z,r,m,tall)=>M.posts.push({x:r3(x),z:r3(z),r,m,tall});
    const area=(kind,b)=>{if(b&&b.x1-b.x0>0.05&&b.z1-b.z0>0.05)M.areas.push({kind,x:r3((b.x0+b.x1)/2),z:r3((b.z0+b.z1)/2),w:r3(b.x1-b.x0),d:r3(b.z1-b.z0)})};
    const line=(x1,z1,x2,z2,c)=>M.lines.push({x1:r2(x1),z1:r2(z1),x2:r2(x2),z2:r2(z2),c});
    const inPlate=b=>b.x0>=-HW+0.5&&b.x1<=HW-0.5&&b.z0>=-HD+0.5&&b.z1<=HD-0.5;
    const nearSpot=b=>spots.some(([x,z,r])=>Math.max(b.x0-x,0,x-b.x1)**2+Math.max(b.z0-z,0,z-b.z1)**2<r*r);
    const clearOf=b=>inPlate(b)&&!keep.some(k=>hit(k,b))&&!nearSpot(b)&&!lanes.some(l=>hit(l,b));
    // world AABB of a w x d footprint turned by yaw a; local (u,v) of a thing at (x,z) turned by a -> world
    const foot=(x,z,a,w,d)=>{const c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a)),hx=c*w/2+s*d/2,hz=s*w/2+c*d/2;return{x0:x-hx,x1:x+hx,z0:z-hz,z1:z+hz}};
    const local=(x,z,a,u,v)=>[x+u*Math.cos(a)+v*Math.sin(a),z-u*Math.sin(a)+v*Math.cos(a)];

    /* ---------- buildings: footprint blocks with a recess at the doorway; door pads outside ---------- */
    blds.forEach((b,i)=>{
      const dr=doors[i],fp=rect(b.x-b.w/2,b.z-b.d/2,b.x+b.w/2,b.z+b.d/2),RD=1.0,horiz=dr.side==="n"||dr.side==="s";
      if(horiz){const a=dr.wx-dr.w/2,c=dr.wx+dr.w/2;
        block(rect(fp.x0,fp.z0,a,fp.z1),7,1);block(rect(c,fp.z0,fp.x1,fp.z1),7,1);
        block(dr.side==="s"?rect(a,fp.z0,c,fp.z1-RD):rect(a,fp.z0+RD,c,fp.z1),7,1);
      }else{const a=dr.wz-dr.w/2,c=dr.wz+dr.w/2;
        block(rect(fp.x0,fp.z0,fp.x1,a),7,1);block(rect(fp.x0,c,fp.x1,fp.z1),7,1);
        block(dr.side==="e"?rect(fp.x0,a,fp.x1-RD,c):rect(fp.x0+RD,a,fp.x1,c),7,1);
      }
      M.buildings.push({id:b.id,name:b.name,short:b.short,x:r3(b.x),z:r3(b.z),w:r3(b.w),d:r3(b.d),floors:b.floors,h:r2(b.floors*FLOOR_H),
        door:{x:r3(dr.x),z:r3(dr.z),a:dr.a,r:1.2}});
      bldKeep.push(grow(fp,1.2));
      // the doorway approach stays open: 10 m straight out, door width + 3 m wide
      const hw=dr.w/2+1.5,o=dr.o;
      keep.push(horiz?rect(dr.wx-hw,dr.wz,dr.wx+hw,dr.wz+o[1]*10):rect(dr.wx,dr.wz-hw,dr.wx+o[0]*10,dr.wz+hw));
      spots.push([dr.x,dr.z,2.5]);
    });
    keep.push(...bldKeep);

    /* ---------- layout of the site ---------- */
    const roads=[rect(-RX-ROAD_HW,-RZ-ROAD_HW,RX+ROAD_HW,-RZ+ROAD_HW),rect(-RX-ROAD_HW,RZ-ROAD_HW,RX+ROAD_HW,RZ+ROAD_HW),
      rect(-RX-ROAD_HW,-RZ+ROAD_HW,-RX+ROAD_HW,RZ-ROAD_HW),rect(RX-ROAD_HW,-RZ+ROAD_HW,RX+ROAD_HW,RZ-ROAD_HW)];
    const gapsS=[],gapsW=[],gapsE=[];      // where other roads join the loop (its inner edge lines break there)
    const south=[];blds.forEach((b,i)=>{if(doors[i].side==="s")south.push(doors[i])});
    let bx0=Infinity,bx1=-Infinity,frontZ=-Infinity,backZ=Infinity;
    for(const b of blds){bx0=Math.min(bx0,b.x-b.w/2);bx1=Math.max(bx1,b.x+b.w/2);frontZ=Math.max(frontZ,b.z+b.d/2);backZ=Math.min(backZ,b.z-b.d/2)}
    // plaza: the widest 10-60 m gap between neighbouring buildings (by x) that overlap in z
    let plaza=null;
    {const byX=blds.slice().sort((a,b)=>a.x-b.x);
      for(let i=0;i+1<byX.length;i++){const a=byX[i],c=byX[i+1],gx0=a.x+a.w/2,gx1=c.x-c.w/2,gz0=Math.max(a.z-a.d/2,c.z-c.d/2),gz1=Math.min(a.z+a.d/2,c.z+c.d/2);
        if(gx1-gx0>=10&&gx1-gx0<=60&&gz1-gz0>=10&&(!plaza||gx1-gx0>plaza.x1-plaza.x0))plaza=rect(gx0,gz0,gx1,gz1)}}
    const cx=plaza?(plaza.x0+plaza.x1)/2:(south.length?south.reduce((s,d)=>s+d.x,0)/south.length:0);
    // front (south) of the buildings: a promenade joining the entrances, the entrance drive, a parking lot each side of it
    let prom=null,drive=null;const lots=[];
    if(blds.length){
      const pz0=frontZ+3,pz1=frontZ+9;
      if(pz1<RZ-ROAD_HW-4){
        prom=rect(bx0-4,pz0,bx1+4,pz1);
        drive=rect(cx-ROAD_HW,pz1,cx+ROAD_HW,RZ-ROAD_HW);roads.push(drive);gapsS.push([drive.x0,drive.x1]);
        const lz0=pz1+3,room=RZ-ROAD_HW-2-lz0,rows=room>=2*BAY_D+AISLE_W?2:room>=BAY_D+AISLE_W?1:0;
        if(rows)for(const [x0,x1,tag] of[[-RX+ROAD_HW+3,drive.x0-3,"W"],[drive.x1+3,RX-ROAD_HW-3,"E"]]){
          if(x1-x0<20)continue;
          const r=rect(x0,lz0,x1,lz0+rows*BAY_D+AISLE_W),aisle=rect(x0,lz0+BAY_D,x1,lz0+BAY_D+AISLE_W);
          lots.push({tag,r,aisle,rows});
          // the lot aisle runs on to the loop road and to the entrance drive
          roads.push(tag==="W"?rect(-RX+ROAD_HW,aisle.z0,x0,aisle.z1):rect(x1,aisle.z0,RX-ROAD_HW,aisle.z1));
          roads.push(tag==="W"?rect(x1,aisle.z0,drive.x0,aisle.z1):rect(drive.x1,aisle.z0,x0,aisle.z1));
          (tag==="W"?gapsW:gapsE).push([aisle.z0,aisle.z1]);
        }
      }else P.push("No room in front of the buildings for the promenade and parking");
    }
    // north lawn path behind the buildings
    let path=null;
    if(blds.length&&backZ-14>-RZ+ROAD_HW+6){const pz=Math.max(-RZ+ROAD_HW+8,backZ-16);path=rect(bx0-4,pz-1.25,bx1+4,pz+1.25)}
    // floor finishes, bottom to top
    lots.forEach(l=>area("parking",l.r));
    roads.forEach(r=>area("road",r));
    keep.push(...roads);
    if(plaza)area("plaza",rect(plaza.x0,plaza.z0,plaza.x1,prom?prom.z0:plaza.z1));
    if(prom){area("walk",prom);for(const d of south){const hw=d.w/2+1.5;area("walk",rect(d.wx-hw,d.wz,d.wx+hw,prom.z0))}}
    doors.forEach(d=>{if(d.side==="s"&&prom)return;const hw=d.w/2+1.5,o=d.o;   // other doors: a short apron
      area("walk",d.side==="n"||d.side==="s"?rect(d.wx-hw,d.wz,d.wx+hw,d.wz+o[1]*6):rect(d.wx,d.wz-hw,d.wx+o[0]*6,d.wz+hw))});
    if(path){area("walk",path);if(plaza)area("walk",rect(cx-2,path.z1,cx+2,plaza.z0))}
    if(plaza)area("walk",rect(cx-2,plaza.z0,cx+2,prom?prom.z0:plaza.z1));

    /* ---------- road markings: dashed yellow center lines, white edge lines, a crosswalk at the drive ---------- */
    function dashes(x1,z1,x2,z2){const L=Math.hypot(x2-x1,z2-z1),n=Math.floor((L-1)/6);
      for(let k=0;k<n;k++){const t0=(1+k*6)/L,t1=(4+k*6)/L;line(x1+(x2-x1)*t0,z1+(z2-z1)*t0,x1+(x2-x1)*t1,z1+(z2-z1)*t1,YELLOW)}}
    function edge(c,horiz,a,b,gaps){let s=a;
      const seg=(p,q)=>horiz?line(p,c,q,c,WHITE):line(c,p,c,q,WHITE);
      for(const [g0,g1] of gaps.slice().sort((p,q)=>p[0]-q[0])){if(g0-0.3>s)seg(s,g0-0.3);s=Math.max(s,g1+0.3)}
      if(b>s)seg(s,b)}
    const IN=ROAD_HW-0.3;
    dashes(-RX+ROAD_HW,-RZ,RX-ROAD_HW,-RZ);dashes(-RX+ROAD_HW,RZ,RX-ROAD_HW,RZ);dashes(-RX,-RZ+ROAD_HW,-RX,RZ-ROAD_HW);dashes(RX,-RZ+ROAD_HW,RX,RZ-ROAD_HW);
    edge(-RZ-IN,true,-RX-IN,RX+IN,[]);edge(RZ+IN,true,-RX-IN,RX+IN,[]);edge(-RX-IN,false,-RZ-IN,RZ+IN,[]);edge(RX+IN,false,-RZ-IN,RZ+IN,[]);
    edge(-RZ+IN,true,-RX+IN,RX-IN,[]);edge(RZ-IN,true,-RX+IN,RX-IN,gapsS);edge(-RX+IN,false,-RZ+IN,RZ-IN,gapsW);edge(RX-IN,false,-RZ+IN,RZ-IN,gapsE);
    if(drive){
      dashes(cx,drive.z0+8,cx,drive.z1);
      for(let x=drive.x0+0.6;x<=drive.x1-0.5;x+=0.75)line(x,drive.z0+1,x,drive.z0+4,WHITE);   // zebra crossing
      line(drive.x0+0.3,drive.z0+5,drive.x1-0.3,drive.z0+5,WHITE);                          // stop bar
    }

    /* ---------- spawn and dests first, so everything else keeps clear of them ---------- */
    const main=blds.find(b=>b.id==="B1")||blds[0];
    if(main){const dr=doors[blds.indexOf(main)];M.spawn={x:r3(dr.x+dr.o[0]*4.5),z:r3(dr.z+dr.o[1]*4.5),a:na(dr.a+PI)}}
    spots.push([M.spawn.x,M.spawn.z,3]);
    blds.forEach((b,i)=>{const dr=doors[i];
      M.dests.push({id:"bldg:"+b.id,kind:"amenity",name:b.name+" entrance",sub:`${b.floors} floor${b.floors===1?"":"s"} · front door`,x:r3(dr.x),z:r3(dr.z),a:na(dr.a+PI)})});
    const dest=(id,name,sub,x,z,a)=>{M.dests.push({id,kind:"amenity",name,sub,x:r3(x),z:r3(z),a:na(a)});spots.push([x,z,1.4])};
    const flagZ=plaza?(prom?prom.z0:plaza.z1)-2.2:0;
    if(plaza)dest("plaza","Flagpoles","Plaza",cx,flagZ-2.2,PI);
    for(const l of lots)dest("lot:"+l.tag,l.tag==="W"?"West parking lot":"East parking lot","Parking",(l.r.x0+l.r.x1)/2,(l.aisle.z0+l.aisle.z1)/2,l.tag==="W"?-HP:HP);

    /* ---------- ramps: kick ramps on the plaza, promenade and lawn path; speed humps across the road lanes ---------- */
    const KB=0.28,SH={kick:{len:1.4,w:1.3,h:0.32},hump:{len:1.5,w:1.8,h:0.14}},feet=[];
    function ramp(k,x,z,ax,dir,w){
      const s=SH[k],ww=w||s.w,a0=-s.len/2,a1=s.len/2+(k==="kick"?KB:0);
      const span=(lo,hi,hw)=>{const p=dir>0?[lo,hi]:[-hi,-lo];return ax==="x"?rect(x+p[0],z-hw,x+p[1],z+hw):rect(x-hw,z+p[0],x+hw,z+p[1])};
      const ft=span(a0,a1,ww/2),lane=span(a0-3,a1+3,ww/2+0.3);   // footprint, and the 3 m run-up / run-out lane
      if(!inPlate(lane)||bldKeep.some(q=>hit(q,lane))||used.some(u=>hit(u,lane))||nearSpot(lane)||feet.some(f=>hit(grow(f,0.3),ft)))return false;
      M.ramps.push({k,x:r3(x),z:r3(z),ax,dir,len:s.len,w:ww,h:s.h});feet.push(ft);lanes.push(lane);return true;
    }
    if(plaza)ramp("kick",cx,plaza.z0+(plaza.z1-plaza.z0)*0.45,"z",-1);
    if(prom)ramp("kick",Math.max(prom.x0+8,cx-26),(prom.z0+prom.z1)/2,"x",-1);
    if(path){const pz=(path.z0+path.z1)/2;ramp("kick",Math.min(path.x1-8,cx+34),pz,"x",1);ramp("hump",Math.max(path.x0+8,cx-34),pz,"x",1)}
    for(const x of[-RX*0.55,RX*0.55])for(const s of[-1,1])ramp("hump",x,RZ+s*1.75,"x",1,3.2);
    for(const s of[-1,1])ramp("hump",0,-RZ+s*1.75,"x",1,3.2);
    if(drive&&lots.length){const z=(lots[0].aisle.z0+lots[0].aisle.z1)/2+9;if(z<drive.z1-4)for(const s of[-1,1])ramp("hump",cx+s*1.75,z,"z",1,3.2)}

    /* ---------- items (each one checks the keep-outs, then adds its colliders) ---------- */
    function solid(t,x,z,a,w,d,h,extra,cols,pad){
      const f=foot(x,z,a,w,d),g=grow(f,pad);
      if(!clearOf(g)||used.some(u=>hit(u,f)))return false;
      const it={t,x:r3(x),z:r3(z),a:r3(na(a)),w,d,h};Object.assign(it,extra||{});M.items.push(it);used.push(g);
      cols(f);return true;
    }
    // trees reserve only their trunk (canopies may overhang walks and bays)
    function treeAt(x,z){
      const f=rect(x-0.3,z-0.3,x+0.3,z+0.3);if(!clearOf(grow(f,0.6))||used.some(u=>hit(u,f)))return false;
      const s=R(),w=r2(3.2+s*2.4);M.items.push({t:"tree",x:r3(x),z:r3(z),a:r3(na(R()*2*PI)),w,d:w,h:r2(4.2+s*2.6)});used.push(f);post(x,z,0.22,7,1);return true;
    }
    const lamp=(x,z,a)=>solid("lamp",x,z,a,0.4,0.4,5,null,()=>post(x,z,0.1,7,1),0.2);
    const bollard=(x,z)=>solid("bollard",x,z,0,0.2,0.2,0.9,null,()=>post(x,z,0.1,7,1),0.1);
    const planter=(x,z,a,w,d)=>solid("planter",x,z,a,w,d,0.6,null,f=>block(f,7,0),0.3);
    const flag=(x,z,c)=>solid("flag",x,z,PI,1.5,0.1,8,{c},()=>post(x,z,0.08,7,1),0.2);
    // benches and bike racks: walkers bump the whole thing, the car only the legs (it fits under the seat / the bar)
    const bench=(x,z,a)=>solid("bench",x,z,a,1.8,0.5,0.8,null,f=>{block(f,4,1);
      for(const s of[-1,1]){const p=local(x,z,a,s*0.75,0);block(foot(p[0],p[1],a,0.06,0.4),3,0)}},0.4);
    const bikerack=(x,z,a)=>solid("bikerack",x,z,a,3,0.6,0.45,null,f=>{block(f,4,0);
      for(const s of[-1,1]){const p=local(x,z,a,s*1.4,0);post(p[0],p[1],0.04,3,0)}},0.6);
    // monument sign on the verge by the entrance drive, facing arriving cars, with its dest in front
    if(drive)for(const dx of[9,-9,14,-14]){
      const sx=cx+dx,sz=drive.z1-3.2;
      if(!clearOf(rect(sx-2.6,sz-0.6,sx+2.6,sz+2.6)))continue;
      if(solid("sign",sx,sz,PI,4.5,0.6,1.2,{text:campusName},f=>block(f,7,1),0.3)){dest("sign","Campus sign","Main entrance",sx,sz+1.9,0);break}
    }

    /* ---------- parking lots: bays in runs of 10 between tree islands, ~70% full (busier near the entrance) ---------- */
    for(const l of lots){
      const L=l.r,n=Math.floor((L.x1-L.x0)/BAY_W),span=Math.max(30,L.x1-L.x0);
      for(const [z0,face] of(l.rows===2?[[L.z0,1],[L.z1-BAY_D,-1]]:[[L.z0,1]])){
        const zc=z0+BAY_D/2;let last=null;
        const close=()=>{if(last!=null){line(last,z0,last,z0+BAY_D,WHITE);last=null}};
        for(let i=0;i<n;i++){
          const x=L.x0+(i+0.5)*BAY_W,b=rect(x-BAY_W/2,z0,x+BAY_W/2,z0+BAY_D);
          if(!clearOf(b)){close();continue}
          if(i%11===10){close();if(treeAt(x,zc)&&face>0&&R()<0.5)lamp(x,zc+1.4,R()<0.5?HP:-HP);continue}   // island
          line(x-BAY_W/2,z0,x-BAY_W/2,z0+BAY_D,WHITE);last=x+BAY_W/2;
          if(R()>=0.5+0.4*(1-Math.min(1,Math.abs(x-cx)/span)))continue;
          // parked car, mostly nose-in, a little off-square in its bay
          const a=na((R()<0.75?(face>0?0:PI):(face>0?PI:0))+(R()-0.5)*0.08),px=x+(R()-0.5)*0.3,pz=zc+(R()-0.5)*0.3,c=pick(R,CAR_COLORS);
          const f=foot(px,pz,a,1.8,4.4);if(!clearOf(f)||used.some(u=>hit(u,f)))continue;
          M.items.push({t:"car",x:r3(px),z:r3(pz),a:r3(a),w:1.8,d:4.4,h:1.45,c});used.push(grow(f,0.15));
          block(f,4,1);   // the body stops walkers; the RC car fits underneath, between the tires
          for(const su of[-1,1])for(const sv of[-1,1]){const p=local(px,pz,a,su*0.78,sv*1.41);post(p[0],p[1],0.3,3,0)}
        }
        close();
      }
      for(let x=L.x0+4;x<L.x1-2;x+=11+R()*3)treeAt(x,L.z1+2.2);
      // lot sign + lamp just outside the lot, where the aisle meets the loop road
      const sx=l.tag==="W"?L.x0-1.5:L.x1+1.5,sz=l.aisle.z0-1.2;
      M.signs.push({lines:[l.tag==="W"?"West lot":"East lot","Parking"],x:r3(sx),y:2.6,z:r3(sz),h:0.7,stripe:null});
      lamp(sx,sz,l.tag==="W"?-HP:HP);
      keep.push(L);   // nothing else lands in the lot
    }

    /* ---------- plaza: tree rows, benches facing the walk, planters, lamps, the flagpole trio ---------- */
    if(plaza){
      const z0=plaza.z0+4,z1=(prom?prom.z0:plaza.z1)-3;
      for(let z=z0;z<=z1;z+=7){treeAt(plaza.x0+3.5,z);treeAt(plaza.x1-3.5,z)}
      for(let z=z0+3.5;z<=z1-3;z+=7)for(const s of[-1,1])bench(cx+s*4.2,z,s<0?-HP:HP);
      for(let z=z0+7;z<=z1-6;z+=14)for(const s of[-1,1])planter(cx+s*6.5,z,0,1.2,3);
      for(let z=z0+1;z<=z1;z+=10)for(const s of[-1,1])lamp(cx+s*2.6,z,s<0?-HP:HP);
      [["#2F64B1",-3],["#C2456B",0],["#2E9C7A",3]].forEach(([c,dx])=>flag(cx+dx,flagZ,c));
    }
    for(const d of south)for(const s of[-1,1])bikerack(d.wx+s*(d.w/2+5),d.wz+2.4,0);
    /* ---------- promenade lamps + benches, bollards where the drive meets it, planters along the facades ---------- */
    if(prom){
      for(let x=prom.x0+6;x<prom.x1-3;x+=15)lamp(x,prom.z1-0.4,0);
      for(let x=prom.x0+13;x<prom.x1-3;x+=30)bench(x,prom.z1-1.0,0);
      if(drive)for(let x=drive.x0+0.4;x<=drive.x1-0.3;x+=1.75)bollard(x,prom.z1-0.2);
      for(const b of blds){const fz=b.z+b.d/2;if(prom.z0-fz>=3.4)for(let x=b.x-b.w/2+3;x<b.x+b.w/2-2;x+=8)planter(x,(fz+prom.z0)/2,0,3,1.2)}
    }
    if(drive)for(let z=drive.z0+9;z<drive.z1-4;z+=12)for(const s of[-1,1])lamp(cx+s*(ROAD_HW+0.8),z,s<0?-HP:HP);
    /* ---------- lawn: lamps + benches on the path, tree groves; street trees and lamps along the loop road ---------- */
    if(path){
      const pz=(path.z0+path.z1)/2;
      for(let x=path.x0+5;x<path.x1-3;x+=18)lamp(x,path.z1+0.6,0);
      for(let x=path.x0+14;x<path.x1-3;x+=36)bench(x,path.z0-0.8,PI);
      const g0=-RZ+ROAD_HW+4,g1=backZ-6;
      for(let k=0;k<70;k++){const x=-RX+ROAD_HW+4+R()*(2*RX-2*ROAD_HW-8),z=g0+R()*Math.max(0,g1-g0);if(Math.abs(z-pz)>3.5)treeAt(x,z)}
    }
    for(let x=-RX;x<=RX;x+=13+R()*3){treeAt(x,-RZ-ROAD_HW-3);treeAt(x,RZ+ROAD_HW+3);treeAt(x+5,-RZ+ROAD_HW+3)}
    for(let z=-RZ;z<=RZ;z+=13+R()*3){treeAt(-RX-ROAD_HW-3,z);treeAt(RX+ROAD_HW+3,z);treeAt(-RX+ROAD_HW+3,z+5);treeAt(RX-ROAD_HW-3,z+5)}
    for(let x=-RX+12;x<=RX-12;x+=32){lamp(x,-RZ+ROAD_HW+1,0);lamp(x,RZ-ROAD_HW-1,PI)}
    for(let z=-RZ+16;z<=RZ-16;z+=32){lamp(-RX+ROAD_HW+1,z,HP);lamp(RX-ROAD_HW-1,z,-HP)}
    for(const b of blds)for(const s of[-1,1])for(let z=b.z-b.d/2+5;z<b.z+b.d/2-3;z+=9)treeAt(b.x+s*(b.w/2+4.5),z);
    return M;
  }

  /* sample people on a floor drawn by hand with desks only (no team areas): the sample roster's desk ids don't exist
     there, so seat them at the floor's own assigned desks (not hot desks), one team after another in desk order (left
     to right, top to bottom), leaving about one desk in eight open. Sample mode only: real seating is never moved. */
  function sampleSeat(spec,rows){
    if(!spec||!Array.isArray(spec.desks)||!spec.desks.length||!Array.isArray(rows))return rows||[];
    if(Array.isArray(spec.zones)&&spec.zones.length)return rows;   // zones too: LAYOUT seats people in their team's area
    const cmp=new Intl.Collator("en").compare;   // a fixed locale, so every viewer seats the sample people the same way
    const desks=spec.desks.filter(d=>d&&d.id&&isFinite(d.x)&&isFinite(d.z)&&d.arr!=="hot").slice()
      .sort((a,b)=>Math.round(a.x)-Math.round(b.x)||a.z-b.z||cmp(String(a.id),String(b.id)));
    if(!desks.length)return rows;
    const own=new Set(spec.desks.map(d=>d&&String(d.id)));
    if(rows.length&&rows.every(r=>r&&own.has(String(r.desk))))return rows;   // already seated at this floor's desks
    const open=new Set();desks.forEach((d,i)=>{if(i%8===5)open.add(d)});
    const seats=desks.filter(d=>!open.has(d)),people=rows.slice().sort((a,b)=>cmp(String(a.team),String(b.team))||cmp(String(a.name),String(b.name)));
    return people.slice(0,seats.length).map((p,i)=>({desk:String(seats[i].id),name:p.name,team:p.team,title:p.title}));
  }

  return{ARR,ARR_NAMES,ROOM_TYPES,ROOM_NAMES,key,parseKey,defaultArr,teamColor,demo,exterior,sampleSeat};
})();
