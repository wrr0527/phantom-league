// ============================================================
// Simulation validation script — 5 runs × 30 seasons
// Node.js ESM (.mjs)
// ============================================================
// Paste-in of all non-React simulation code from App.jsx

const ROTATION_SIZE = 6;
const ROTATION_SP_MIN = 1;
const ROTATION_SP_MAX = 6;
const ROTATION_RP_MIN = 11;
const ROTATION_RP_MAX = 20;
const ROTATION_CLOSER_MIN = 21;
const ROTATION_CLOSER_MAX = 30;
const ROTATION_CLOSER = 21;
const INTERLEAGUE_RATIO = 0.18;
const JS_WINS = 4;
const GAMES=143, NUM_TEAMS=12, BATTERS_PER_TEAM=20, PITCHERS_PER_TEAM=16, FA_YEARS=8, RETIRE_AGE=36;
const ROSTER_28=28;
const DEFAULT_CONFIG={battersPerTeam:BATTERS_PER_TEAM,pitchersPerTeam:PITCHERS_PER_TEAM,draftBat:3,draftPit:2};

const POSITIONS = ["C","1B","2B","3B","SS","LF","CF","RF","DH"];
const POS_WEIGHT = {
  C:    { bat:0.5, def:1.5 }, SS:   { bat:0.6, def:1.4 }, CF:   { bat:0.7, def:1.3 },
  "2B": { bat:0.8, def:1.2 }, "3B": { bat:0.9, def:1.1 }, RF:   { bat:1.1, def:0.9 },
  LF:   { bat:1.2, def:0.8 }, "1B": { bat:1.3, def:0.7 }, DH:   { bat:1.5, def:0.0 },
};
const DIR_K = {"↓":1.3, "↙":1.15, "↘":1.15, "←":1.0, "→":1.0};

let UID=0; const newId=()=>`p${UID++}`;
const rnd=()=>Math.random();
const randn=()=>{let u=0,v=0;while(u===0)u=Math.random();while(v===0)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const norm=(v)=>clamp(v,1,99)/99;
const _mkPicker=arr=>{let t=0;const c=arr.map(([n,w])=>(t+=w,[t,n]));return()=>{const r=rnd()*t;for(const[s,n]of c)if(r<s)return n;return c[c.length-1][1];};};

const SURNAMES_W=[["佐藤",15],["鈴木",14],["高橋",13],["田中",12],["伊藤",11],["渡辺",10],["山本",10],["中村",9],["小林",9],["加藤",9]];
const GIVEN_W=[["翔",8],["蓮",8],["颯",7],["湊",7],["律",6],["蒼",6],["陽",5],["悠",5],["健太",5],["隼人",5]];
const _pickSurname=_mkPicker(SURNAMES_W);
const _pickGiven=_mkPicker(GIVEN_W);
const randName=()=>_pickSurname()+_pickGiven();
const AGE_W=[[18,3],[19,5],[20,7],[21,9],[22,10],[23,10],[24,9],[25,8],[26,7],[27,6],[28,5],[29,4],[30,4],[31,3],[32,2],[33,2],[34,1],[35,1],[36,1]];
const _pickAge=_mkPicker(AGE_W);

const RANK_VAL={S:92,A:83,B:73,C:63,D:53,E:43,F:33,G:20};
const rankToVal=(r)=>clamp((RANK_VAL[r]??63)+Math.round(randn()*3),1,99);
const valToRank=(v)=>{if(v>=89)return"S";if(v>=79)return"A";if(v>=69)return"B";if(v>=59)return"C";if(v>=49)return"D";if(v>=39)return"E";if(v>=29)return"F";return"G";};

const emptyCareerBat=()=>({seasons:0,PA:0,AB:0,H:0,_2B:0,_3B:0,HR:0,BB:0,HBP:0,SO:0,RBI:0,R:0,SB:0,games:0});
const emptyCareerPit=()=>({seasons:0,IP:0,H:0,HR:0,BB:0,SO:0,ER:0,W:0,L:0,SV:0,G:0});

const E_BASE=43;
function eVal(){return clamp(E_BASE+Math.round(randn()*4),1,99);}
const OFFSPEED_DIRS=["↘","↓","↙","←"];
function randPitches(){const d=OFFSPEED_DIRS[Math.floor(rnd()*OFFSPEED_DIRS.length)];const rv=()=>2+Math.floor(rnd()*4);return [{dir:"→",henka:3,kire:3},{dir:d,henka:rv(),kire:rv()}];}
function makeBatter(age,order=0){if(age===undefined)age=_pickAge();return {id:newId(),name:randName(),age,kind:"bat",contact:eVal(),power:eVal(),eye:eVal(),speed:eVal(),order,bats:rnd()<0.54?"R":rnd()<0.97?"L":"S",position:"LF",defense:eVal(),foreign:false,farm:false,status:"active",teamId:null,yearsOnTeam:0,overseasReturn:0,init:emptyCareerBat()};}
function makePitcher(age,role,rotation=0){if(age===undefined)age=_pickAge();return {id:newId(),name:randName(),age,kind:"pit",stuff:eVal(),control:eVal(),stamina:eVal(),role:role||(rnd()<0.5?"SP":"RP"),rotation,throws:rnd()<0.75?"R":"L",pitches:randPitches(),foreign:false,farm:false,status:"active",teamId:null,yearsOnTeam:0,overseasReturn:0,init:emptyCareerPit()};}

function pitchBonus(p){const adj=(p.pitches||[]).reduce((sum,x)=>{const dk=DIR_K[x.dir]||1.0;return sum+(x.henka||3)/7*(x.kire||3)/7*dk*5.5;},0);return {stuffAdj:clamp(Math.round(adj),0,20)};}
function effStuff(p){ return clamp(p.stuff+pitchBonus(p).stuffAdj,1,99); }

function initLeague(){
  UID=0;const teams=[];const pool={};
  for(let t=0;t<NUM_TEAMS;t++){const league=t<NUM_TEAMS/2?"central":"pacific";const tm={id:t,name:`Team ${String.fromCharCode(65+t)}`,league,batterIds:[],pitcherIds:[]};
    for(let i=0;i<BATTERS_PER_TEAM;i++){const b=makeBatter(undefined, i<9?i+1:0);b.teamId=t;b.yearsOnTeam=Math.max(0,Math.min(b.age-18,Math.floor(rnd()*8)));pool[b.id]=b;tm.batterIds.push(b.id);}
    for(let i=0;i<PITCHERS_PER_TEAM;i++){const role=i<ROTATION_SIZE?"SP":"RP";let rotation;if(i<ROTATION_SIZE){rotation=i+1;}else if(i===ROTATION_SIZE+5){rotation=ROTATION_CLOSER_MIN;}else if(i>ROTATION_SIZE+5){rotation=0;}else{rotation=ROTATION_RP_MIN+(i-ROTATION_SIZE);}const p=makePitcher(undefined,role,rotation);p.teamId=t;p.yearsOnTeam=Math.max(0,Math.min(p.age-18,Math.floor(rnd()*8)));pool[p.id]=p;tm.pitcherIds.push(p.id);}
    teams.push(tm);}
  const starterVal=()=>clamp(58+Math.round(randn()*12),35,92);
  teams.forEach(tm=>{
    tm.batterIds.map(id=>pool[id]).filter(b=>b.order>=1&&b.order<=9).forEach(b=>{["contact","power","eye","speed"].forEach(f=>b[f]=starterVal());});
    tm.pitcherIds.map(id=>pool[id]).filter(p=>(p.rotation>=1&&p.rotation<=ROTATION_SIZE)||(p.rotation>=ROTATION_CLOSER_MIN&&p.rotation<=ROTATION_CLOSER_MAX)).forEach(p=>{["stuff","control","stamina"].forEach(f=>p[f]=starterVal());});
  });
  const POS_ORDER = ["C","1B","2B","3B","SS","LF","CF","RF","DH"];
  teams.forEach(tm=>{
    const starters=tm.batterIds.map(id=>pool[id]).filter(b=>b.order>=1&&b.order<=9).sort((a,b)=>a.order-b.order);
    starters.forEach((b,i)=>{ b.position=POS_ORDER[i%POS_ORDER.length]; });
    tm.batterIds.map(id=>pool[id]).filter(b=>b.order===0||b.order>9).forEach(b=>{ b.position=POS_ORDER[Math.floor(rnd()*POS_ORDER.length)]; });
  });
  teams.forEach(tm=>{
    tm.batterIds.slice(0,3).forEach(id=>{pool[id].foreign=true;pool[id].power=clamp(pool[id].power+8,1,99);});
    tm.pitcherIds.filter(id=>pool[id].role==="RP").slice(0,2).forEach(id=>{pool[id].foreign=true;pool[id].stuff=clamp(pool[id].stuff+6,1,99);});
  });
  assignFarm(teams,pool);
  return {teams,pool,career:{bat:{},pit:{}},hall:[]};}

function assignFarm(teams,pool){
  teams.forEach(tm=>{
    const members=[...tm.batterIds,...tm.pitcherIds].map(id=>pool[id]).filter(Boolean);
    const score=(p)=>{ let s=p.kind==="bat"?(p.contact+p.power+p.eye+p.speed)/4:(p.stuff+p.control+p.stamina)/3;
      if(p.kind==="bat"&&p.order>=1&&p.order<=9)s+=20;
      if(p.kind==="pit"&&((p.rotation>=1&&p.rotation<=ROTATION_SIZE)||(p.rotation>=ROTATION_CLOSER_MIN&&p.rotation<=ROTATION_CLOSER_MAX)))s+=18;
      if(p.kind==="pit"&&p.role==="RP"&&p.rotation>=ROTATION_RP_MIN&&p.rotation<=ROTATION_RP_MAX)s+=8;
      return s; };
    members.sort((a,b)=>score(b)-score(a));
    members.forEach((p,i)=>{ p.farm = i>=ROSTER_28; });
  });
}

function batterEventProbs(b,factor,form){const c=norm(b.contact),p=norm(b.power),e=norm(b.eye);
  const fm=form||1.0;
  const historic=fm>=1.40;
  const fhit=clamp(factor,0.70,1.30)*fm;
  const fk=clamp(2-factor,0.75,1.35)/Math.sqrt(fm);
  let bb=clamp(0.030+e*0.065,0.018,0.115)*Math.sqrt(clamp(factor,0.7,1.3)*fm);
  let hbp=0.007;
  let k=clamp(0.21-c*0.12,0.085,0.27)*clamp(fk,0.6,1.5);
  const hitCap=historic?1.16:1.11;
  const hitBase=clamp(0.160+c*0.138,0.130,0.340)*clamp(fhit,0.6,hitCap);
  const hrBase=historic? (0.007+p*0.044) : (0.004+p*0.035);
  let hr=clamp(hrBase,0.003,historic?0.075:0.065)*clamp(fhit,0.55,historic?1.90:1.78);
  let triple=0.0025*clamp(fhit,0.6,1.5);
  let dbl=hitBase*0.185;
  let sgl=Math.max(0,hitBase-hr-triple-dbl);
  let out=Math.max(0,1-(bb+hbp+k+hr+triple+dbl+sgl));
  return {bb,hbp,k,sgl,dbl,triple,hr,out};}

function pushWalk(bases){if(bases[0]&&bases[1]&&bases[2])return 1;if(bases[0]&&bases[1]){bases[2]=true;return 0;}if(bases[0]){bases[1]=true;return 0;}bases[0]=true;return 0;}

function simInning(ls,batStat,getProbs){let outs=0,bases=[false,false,false],runs=0,safety=0;
  while(outs<3&&safety<60){safety++;const b=ls.next();const st=batStat[b.id];const pr=getProbs(b);const x=rnd();let cum=0;if(st)st.PA++;
    cum+=pr.k;if(x<cum){if(st){st.AB++;st.SO++;}outs++;continue;}
    cum+=pr.out;if(x<cum){if(st)st.AB++;if(bases[0]&&outs<2&&rnd()<0.12){outs+=2;bases[0]=false;}else{outs++;if(bases[2]&&outs<3&&rnd()<0.25){runs++;bases[2]=false;if(st)st.RBI++;}}continue;}
    cum+=pr.bb;if(x<cum){if(st)st.BB++;const r=pushWalk(bases);runs+=r;if(st)st.RBI+=r;continue;}
    cum+=pr.hbp;if(x<cum){if(st)st.HBP++;const r=pushWalk(bases);runs+=r;if(st)st.RBI+=r;continue;}
    cum+=pr.hr;if(x<cum){const r=1+(bases[0]?1:0)+(bases[1]?1:0)+(bases[2]?1:0);bases=[false,false,false];runs+=r;if(st){st.AB++;st.H++;st.HR++;st.RBI+=r;st.R++;}continue;}
    cum+=pr.triple;if(x<cum){const r=(bases[0]?1:0)+(bases[1]?1:0)+(bases[2]?1:0);bases=[false,false,true];runs+=r;if(st){st.AB++;st.H++;st._3B++;st.RBI+=r;}continue;}
    cum+=pr.dbl;if(x<cum){let r=(bases[1]?1:0)+(bases[2]?1:0);let third=false;if(bases[0]){if(rnd()<0.45)r++;else third=true;}bases=[false,true,third];runs+=r;if(st){st.AB++;st.H++;st._2B++;st.RBI+=r;}continue;}
    {let r=bases[2]?1:0;let third=bases[1];if(bases[1]&&rnd()<0.55){r++;third=false;}bases=[true,bases[0],third];runs+=r;if(st){st.AB++;st.H++;st.RBI+=r;if(norm(b.speed)>0.55&&rnd()<norm(b.speed)*0.10)st.SB++;}}
  }return runs;}

function pitcherFactor(p){return clamp(1.30-norm(effStuff(p))*0.40-norm(p.control)*0.20,0.65,1.35);}

function starterScore(b){
  const w=POS_WEIGHT[b.position]||{bat:1.0,def:1.0};
  const batScore=(b.contact+b.power+b.eye+b.speed)/4;
  return batScore*w.bat + (b.defense||50)*w.def;
}

function pickLineup(off,pool,batStat){
  let oneArmy=off.batterIds.map(id=>pool[id]).filter(b=>!b.farm).filter(b=>{const st=batStat[b.id];return !(st&&st.games>st.maxGames&&st.games>0);});
  if(oneArmy.length<9){ oneArmy=off.batterIds.map(id=>pool[id]).filter(b=>{const st=batStat[b.id];return !(st&&st.games>st.maxGames&&st.games>0);}); }
  if(oneArmy.length<9){ oneArmy=off.batterIds.map(id=>pool[id]).filter(Boolean); }
  const starters=oneArmy.filter(b=>b.order>=1&&b.order<=9).sort((a,b)=>a.order-b.order);
  const bench=oneArmy.filter(b=>!(b.order>=1&&b.order<=9));
  const lineup=[];
  starters.forEach(s=>{
    if(rnd()<0.07 && bench.length){
      const benchSorted=bench.slice().sort((a,b)=>starterScore(b)-starterScore(a));
      const picked=benchSorted[0];
      bench.splice(bench.indexOf(picked),1);
      lineup.push(picked);
    }
    else lineup.push(s);
  });
  while(lineup.length<9 && bench.length) lineup.push(bench.shift());
  while(lineup.length<9 && oneArmy.length) lineup.push(oneArmy[lineup.length%oneArmy.length]);
  const finalLineup=enforceForeign(lineup, oneArmy, 4);
  return { lineup: finalLineup, bench };
}

function enforceForeign(lineup, all, maxForeignBatters){
  const foreigners=lineup.filter(b=>b.foreign);
  if(foreigners.length<=maxForeignBatters) return lineup;
  const domesticBench=all.filter(b=>!b.foreign && !lineup.includes(b));
  let over=foreigners.length-maxForeignBatters;
  const result=[...lineup];
  for(let i=result.length-1;i>=0 && over>0;i--){
    if(result[i].foreign && domesticBench.length){ result[i]=domesticBench.shift(); over--; }
  }
  return result;
}

function pickStarter(def,pool,gameNo){
  const oneArmy=def.pitcherIds.map(id=>pool[id]).filter(p=>!p.farm);
  let sp=oneArmy.filter(p=>p.role==="SP").sort((a,b)=>(a.rotation||9)-(b.rotation||9));
  if(sp.length<ROTATION_SIZE){
    const extra=oneArmy.filter(p=>p.role!=="SP"&&!(p.rotation>=ROTATION_CLOSER_MIN&&p.rotation<=ROTATION_CLOSER_MAX)).sort((a,b)=>(b.stuff+b.control+b.stamina)-(a.stuff+a.control+a.stamina));
    sp=[...sp,...extra].slice(0,ROTATION_SIZE);
  } else {
    sp=sp.slice(0,ROTATION_SIZE);
  }
  if(!sp.length)return oneArmy[0]||def.pitcherIds.map(id=>pool[id])[0];
  let idx=(gameNo-1)%sp.length;
  if(rnd()<0.12) idx=(idx+1)%sp.length;
  return sp[idx];
}

function teamGame(off,def,pool,batStat,pitStat,gameNo){
  let closerPitched=null;
  const usedSP=pickStarter(def,pool,gameNo);
  const rp=def.pitcherIds.map(id=>pool[id]).filter(p=>!p.farm&&p.role==="RP");
  const spForm=pitStat[usedSP.id]?.form||1.0;
  const factor=pitcherFactor(usedSP)*(0.85+rnd()*0.3)/Math.sqrt(spForm);
  const cache={};const getProbs=(b)=>cache[b.id]||(cache[b.id]=batterEventProbs(b,factor,batStat[b.id]?.form));
  let idx=0;const {lineup,bench}=pickLineup(off,pool,batStat);const ls={next:()=>lineup[idx++%lineup.length]};
  let runs=0;for(let i=0;i<9;i++)runs+=simInning(ls,batStat,getProbs);
  lineup.forEach(b=>{if(batStat[b.id])batStat[b.id].games++;});
  const subCount=Math.min(bench.length, 1+Math.floor(rnd()*3));
  const shuffledBench=[...bench].sort(()=>rnd()-0.5).slice(0,subCount);
  shuffledBench.forEach(b=>{ const st=batStat[b.id]; if(!st)return;
    st.games++;
    const role=rnd();
    if(role<0.55){
      st.PA++; const pr=batterEventProbs(b,1.0,st.form); const x=rnd();
      if(x<pr.k){st.AB++;st.SO++;}
      else if(x<pr.k+pr.bb){st.BB++;}
      else if(x<pr.k+pr.bb+pr.hr){st.AB++;st.H++;st.HR++;st.RBI++;st.R++;}
      else if(x<pr.k+pr.bb+pr.hr+pr.dbl){st.AB++;st.H++;st._2B++;}
      else if(x<pr.k+pr.bb+pr.hr+pr.dbl+pr.sgl){st.AB++;st.H++;}
      else {st.AB++;}
    } else if(role<0.75){
      if(norm(b.speed)>0.5&&rnd()<0.15)st.SB++;
    }
  });
  if(usedSP&&pitStat[usedSP.id]){const ps=pitStat[usedSP.id];const f=ps.injuryFactor;const spIP=clamp(6.0*f*(0.80+norm(usedSP.stamina)*0.30),3.5,8);
    ps.IP+=spIP;ps.G++;ps.ER+=runs*(spIP/9);ps.SO+=Math.round(spIP*(0.50+norm(effStuff(usedSP))*0.45)*clamp(spForm,0.8,1.5));ps.BB+=Math.max(0,Math.round(spIP*(0.34-norm(usedSP.control)*0.20)));ps.H+=Math.round(runs*0.75+spIP*0.70);if(rnd()<0.18)ps.HR++;
    const remain=9-spIP;
    const notExhausted=p=>!pitStat[p.id]||pitStat[p.id].G<(pitStat[p.id].maxG??99);
    const closer=rp.find(p=>p.rotation>=ROTATION_CLOSER_MIN&&p.rotation<=ROTATION_CLOSER_MAX&&notExhausted(p));
    const mid=rp.filter(p=>!(p.rotation>=ROTATION_CLOSER_MIN&&p.rotation<=ROTATION_CLOSER_MAX)&&notExhausted(p));
    const setup=mid.filter(p=>p.rotation<=ROTATION_RP_MIN+1).sort((a,b)=>a.rotation-b.rotation);
    const longR=mid.filter(p=>p.rotation>ROTATION_RP_MIN+1).sort((a,b)=>a.rotation-b.rotation);
    const targetN=remain<=2?1+(rnd()<0.50?1:0):remain<=4?2+(rnd()<0.50?1:0):3+(rnd()<0.40?1:0);
    const relievers=[];
    if(runs<=3){
      const src=setup.length?setup:mid;
      for(let i=0;i<Math.min(targetN,src.length);i++){
        if(i===0||rnd()<(i===1?0.65:0.45))relievers.push(src[i]);
      }
      if(closer&&rnd()<0.72){relievers.push(closer);closerPitched=closer;}
    }else{
      const src=longR.length?longR:mid;
      const sh=[...src].sort(()=>rnd()-0.5);
      relievers.push(...sh.slice(0,Math.min(targetN,sh.length)));
    }
    if(!relievers.length&&mid.length)relievers.push(mid[Math.floor(rnd()*mid.length)]);
    relievers.forEach(p=>{if(!pitStat[p.id])return;const seg=remain/Math.max(1,relievers.length);const rs=pitStat[p.id];rs.IP+=seg;rs.G++;rs.ER+=(runs/9)*seg;rs.SO+=Math.round(seg*(0.60+norm(effStuff(p))*0.50));rs.BB+=Math.max(0,Math.round(seg*(0.33-norm(p.control)*0.16)));rs.H+=Math.round(seg*0.92);});}
  return {runs, sp:usedSP, closer:closerPitched};
}

function rollInjury(){const r=rnd();if(r<0.50)return GAMES;if(r<0.78)return Math.floor(GAMES*(0.7+rnd()*0.25));if(r<0.94)return Math.floor(GAMES*(0.4+rnd()*0.3));return Math.floor(GAMES*(0.05+rnd()*0.3));}

function buildSchedule(teams){
  const central=teams.filter(t=>t.league==="central").map(t=>t.id);
  const pacific=teams.filter(t=>t.league==="pacific").map(t=>t.id);
  const schedule=[];
  const interGames=Math.round(GAMES*INTERLEAGUE_RATIO);
  const intraGames=GAMES-interGames;
  const pairUp=(ids,gameNo)=>{const o=[...ids];for(let i=o.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[o[i],o[j]]=[o[j],o[i]];}const res=[];for(let i=0;i+1<o.length;i+=2)res.push({home:o[i],away:o[i+1],gameNo,inter:false});return res;};
  for(let g=0;g<intraGames;g++){ schedule.push(...pairUp(central,g+1)); schedule.push(...pairUp(pacific,g+1)); }
  for(let g=0;g<interGames;g++){
    const offset=g%pacific.length;
    for(let i=0;i<central.length;i++){
      const c=central[i]; const p=pacific[(i+offset)%pacific.length];
      schedule.push({home:rnd()<0.5?c:p,away:rnd()<0.5?p:c,gameNo:intraGames+g+1,inter:true});
    }
  }
  return schedule;
}

function midSeasonSwap(teams,pool,batStat,pitStat){
  teams.forEach(tm=>{
    const batAbil=b=>(b.contact+b.power+b.eye+b.speed)/4;
    const batThresh=b=>{const a=batAbil(b);return a>=80?.170:a>=65?.200:a>=50?.225:.250;};
    const batDScore=b=>{const st=batStat[b.id];if(!st||st.PA<50)return -1;const avg=st.H/Math.max(1,st.AB);const paW=Math.min(1,(st.PA-50)/80);return paW*(batThresh(b)-avg);};
    const bat1=tm.batterIds.map(id=>pool[id]).filter(p=>p&&!p.farm&&p.status==="active");
    const batF=tm.batterIds.map(id=>pool[id]).filter(p=>p&&p.farm&&p.status==="active");
    const batDown=[
      ...bat1.filter(b=>b.order===0&&batDScore(b)>0),
      ...bat1.filter(b=>b.order>=1&&b.order<=9&&batDScore(b)>0.07),
    ].sort((a,b)=>batDScore(b)-batDScore(a));
    const batUp=batF.slice().sort((a,b)=>batAbil(b)-batAbil(a));
    const batN=Math.min(batDown.length,batUp.length,2);
    for(let i=0;i<batN;i++){
      const down=batDown[i],up=batUp[i];if(!down||!up)break;
      const gap=batAbil(down)-batAbil(up);
      const prob=gap>25?0.20:gap>10?0.45:0.65;
      if(rnd()<prob){down.farm=true;up.farm=false;}
    }
    const pitAbil=p=>(p.stuff+p.control+p.stamina)/3;
    const pitThresh=p=>{const a=pitAbil(p);return a>=80?5.50:a>=65?4.80:a>=50?4.20:3.80;};
    const pitMinIP=p=>p.role==="SP"?40:20;
    const pitDScore=p=>{const st=pitStat[p.id];if(!st||st.IP<pitMinIP(p))return -1;return (st.ER*9/Math.max(1,st.IP))-pitThresh(p);};
    const pit1=tm.pitcherIds.map(id=>pool[id]).filter(p=>p&&!p.farm&&p.status==="active");
    const pitF=tm.pitcherIds.map(id=>pool[id]).filter(p=>p&&p.farm&&p.status==="active");
    const pitDown=pit1.filter(p=>pitDScore(p)>0).sort((a,b)=>pitDScore(b)-pitDScore(a));
    const pitUp=pitF.slice().sort((a,b)=>pitAbil(b)-pitAbil(a));
    const pitN=Math.min(pitDown.length,pitUp.length,2);
    for(let i=0;i<pitN;i++){
      const down=pitDown[i],up=pitUp[i];if(!down||!up)break;
      const gap=pitAbil(down)-pitAbil(up);
      const prob=gap>25?0.20:gap>10?0.45:0.65;
      if(rnd()<prob){down.farm=true;if(down.rotation>=1&&down.rotation<=ROTATION_SIZE)down.rotation=0;up.farm=false;if(up.rotation===0)up.rotation=ROTATION_RP_MIN;}
    }
  });
}

function rollForm(){
  const r=rnd();
  if(r<0.007) return 1.40+rnd()*0.10;
  if(r<0.037) return 1.20+rnd()*0.12;
  if(r<0.107) return 1.08+rnd()*0.08;
  if(r<0.857) return 0.95+rnd()*0.13;
  if(r<0.977) return 0.85+rnd()*0.10;
  return 0.72+rnd()*0.13;
}

function simulateSeason(teams,pool){
  const batStat={},pitStat={};
  // シーズン開始時のfarm・orderを記録（移籍等でオフシーズンに変わっても追跡できるよう）
  const initFarm={};const initOrder={};
  teams.forEach(tm=>{
    tm.batterIds.forEach(id=>{const b=pool[id];initFarm[id]=b.farm;initOrder[id]=b.order||0;batStat[id]={id,name:b.name,team:tm.name,teamId:tm.id,age:b.age,games:0,maxGames:rollInjury(),form:rollForm(),PA:0,AB:0,H:0,_2B:0,_3B:0,HR:0,BB:0,HBP:0,SO:0,RBI:0,R:0,SB:0};});
    tm.pitcherIds.forEach(id=>{const p=pool[id];initFarm[id]=p.farm;initOrder[id]=0;let inj=1;const r=rnd();if(r<0.12)inj=0.5;else if(r<0.2)inj=0.75;const baseMaxG=p.role==="SP"?30:50+Math.floor(rnd()*25);pitStat[id]={id,name:p.name,team:tm.name,teamId:tm.id,age:p.age,role:p.role,IP:0,H:0,HR:0,BB:0,SO:0,ER:0,W:0,L:0,SV:0,G:0,maxG:Math.floor(baseMaxG*inj),injuryFactor:inj,form:rollForm()};});
  });
  const record={};teams.forEach(tm=>record[tm.id]={name:tm.name,league:tm.league,W:0,L:0,D:0,RS:0,RA:0,id:tm.id});
  const schedule=buildSchedule(teams);
  let lastSwapGame=0;
  let totalDraws=0, totalGames=0, swapCount=0;
  const gameLog=[];
  const _origMidSwap=midSeasonSwap;
  schedule.forEach(m=>{
    if(m.gameNo>lastSwapGame+7){
      // 昇格人数を計測するため前後のfarm状態を比較
      const before={};Object.values(pool).forEach(p=>{before[p.id]=p.farm;});
      midSeasonSwap(teams,pool,batStat,pitStat);
      Object.values(pool).forEach(p=>{if(before[p.id]===true&&p.farm===false)swapCount++;});
      lastSwapGame=m.gameNo;
    }
    const home=teams.find(t=>t.id===m.home),away=teams.find(t=>t.id===m.away);
    const hRes=teamGame(home,away,pool,batStat,pitStat,m.gameNo),aRes=teamGame(away,home,pool,batStat,pitStat,m.gameNo);
    let hR=hRes.runs,aR=aRes.runs;
    if(hR===aR){
      const avgH=home.batterIds.filter(id=>pool[id]&&!pool[id].farm).reduce((s,id)=>{const b=pool[id];return s+(b.contact+b.power+b.eye)/3;},0)/Math.max(1,home.batterIds.filter(id=>pool[id]&&!pool[id].farm).length);
      const avgA=away.batterIds.filter(id=>pool[id]&&!pool[id].farm).reduce((s,id)=>{const b=pool[id];return s+(b.contact+b.power+b.eye)/3;},0)/Math.max(1,away.batterIds.filter(id=>pool[id]&&!pool[id].farm).length);
      const ph=0.13+norm(avgH)*0.06,pa=0.13+norm(avgA)*0.06;
      for(let ex=0;ex<3&&hR===aR;ex++){if(rnd()<ph)hR++;if(rnd()<pa)aR++;}
    }
    totalGames++;
    const isDraw=hR===aR;
    if(isDraw){totalDraws++;record[home.id].D++;record[away.id].D++;}
    else if(hR>aR){record[home.id].W++;record[away.id].L++;}
    else{record[away.id].W++;record[home.id].L++;}
    record[home.id].RS+=hR;record[home.id].RA+=aR;record[away.id].RS+=aR;record[away.id].RA+=hR;
    gameLog.push({isDraw});
  });
  // デバッグ：スタメンの maxGames vs 実際 games を収集
  const _dbg={maxGArr:[],gamesArr:[],farmDemotions:0};
  Object.entries(batStat).forEach(([id,s])=>{
    if(!initFarm[id]&&initOrder[id]>=1&&initOrder[id]<=9){
      _dbg.maxGArr.push(s.maxGames);_dbg.gamesArr.push(s.games);_dbg.farmDemotions++;
    }
  });
  return {batStat,pitStat,record,gameLog,totalDraws,totalGames,initFarm,initOrder,swapCount,_dbg};}

function ageMul(age){return age<=27?clamp(0.78+(age-18)*0.0244,0.78,1.0):clamp(1.0-(age-27)*0.022,0.5,1.0);}
function agePlayer(p){p.age++;const fs=p.kind==="bat"?["contact","power","eye","speed"]:["stuff","control","stamina"];const m=ageMul(p.age)/ageMul(p.age-1);
  const farmBoost=(p.farm&&p.age<=27)?1.03:1.0;
  fs.forEach(f=>{p[f]=Math.round(clamp(p[f]*m*farmBoost*(1+randn()*0.015),1,99));});}

const Wt={bb:0.69,hbp:0.72,_1B:0.89,_2B:1.27,_3B:1.62,hr:2.10},SCALE=1.25,lgRPA=0.118,FIP_C=3.10;
function battingMetrics(s,lg){const _1B=s.H-s._2B-s._3B-s.HR;const AVG=s.H/Math.max(1,s.AB);const OBP=(s.H+s.BB+s.HBP)/Math.max(1,s.AB+s.BB+s.HBP);const TB=_1B+2*s._2B+3*s._3B+4*s.HR;const SLG=TB/Math.max(1,s.AB);const wOBA=(Wt.bb*s.BB+Wt.hbp*s.HBP+Wt._1B*_1B+Wt._2B*s._2B+Wt._3B*s._3B+Wt.hr*s.HR)/Math.max(1,s.AB+s.BB+s.HBP);const wRCp=Math.round((((wOBA-lg)/SCALE+lgRPA)/lgRPA)*100);return {...s,AVG,OBP,SLG,OPS:OBP+SLG,wOBA,wRCp,ISO:SLG-AVG};}
function computeBatting(stats){const arr=stats.filter(s=>s.PA>0);let tW=0,tD=0;arr.forEach(s=>{const _1B=s.H-s._2B-s._3B-s.HR;tW+=Wt.bb*s.BB+Wt.hbp*s.HBP+Wt._1B*_1B+Wt._2B*s._2B+Wt._3B*s._3B+Wt.hr*s.HR;tD+=s.AB+s.BB+s.HBP;});const lg=tW/Math.max(1,tD);return arr.map(s=>battingMetrics(s,lg));}
function pitchingMetrics(s){return {...s,ERA:(s.ER*9)/Math.max(1,s.IP),WHIP:(s.BB+s.H)/Math.max(1,s.IP),K9:(s.SO*9)/Math.max(1,s.IP),BB9:(s.BB*9)/Math.max(1,s.IP),FIP:(13*s.HR+3*s.BB-2*s.SO)/Math.max(1,s.IP)+FIP_C};}
function computePitching(stats){return stats.filter(s=>s.IP>0).map(pitchingMetrics);}

function removeFromTeam(teams,p){const tm=teams.find(t=>t.id===p.teamId);if(!tm)return;tm.batterIds=tm.batterIds.filter(id=>id!==p.id);tm.pitcherIds=tm.pitcherIds.filter(id=>id!==p.id);p.teamId=null;}
function addToTeam(tm,p){if(p.kind==="bat")tm.batterIds.push(p.id);else tm.pitcherIds.push(p.id);}
const emptyMerge=(p)=>p.kind==="bat"?emptyCareerBat():emptyCareerPit();

function processOffseason(state,season){
  const {teams,pool,career,hall}=state;const cfg=DEFAULT_CONFIG;
  const batM={};computeBatting(Object.values(season.batStat)).forEach(s=>batM[s.id]=s);
  const pitM={};computePitching(Object.values(season.pitStat)).forEach(s=>pitM[s.id]=s);
  const perfBat=(id)=>batM[id]?batM[id].wRCp:0;
  const perfPit=(id)=>pitM[id]?(pitM[id].IP>20?200-pitM[id].FIP*20:60):40;

  // 外国人入れ替え
  teams.forEach(tm=>{
    [...tm.batterIds,...tm.pitcherIds].slice().forEach(id=>{const p=pool[id];if(!p||!p.foreign||p.status!=="active")return;
      const perf=p.kind==="bat"?perfBat(id):perfPit(id);
      const good=p.kind==="bat"?perf>=105:perf>=110;
      const great=p.kind==="bat"?perf>=120:perf>=140;
      if(!good&&rnd()<0.70){p.status="released_foreign";removeFromTeam(teams,p);}
      else if(great){const leave=0.25+Math.min(0.25,p.yearsOnTeam*0.08);if(rnd()<leave){p.status="released_foreign";removeFromTeam(teams,p);}}
      else if(good){const leave=0.08+Math.min(0.18,p.yearsOnTeam*0.04);if(rnd()<leave){p.status="released_foreign";removeFromTeam(teams,p);}}
    });
  });
  Object.keys(pool).forEach(id=>{ if(pool[id].status==="released_foreign") delete pool[id]; });
  teams.forEach(tm=>{
    while(tm.batterIds.filter(id=>pool[id]?.foreign).length<3){
      const b=makeBatter(24+Math.floor(rnd()*6));b.foreign=true;["contact","power","eye","speed"].forEach(f=>b[f]=clamp(55+Math.round(randn()*14),35,95));b.power=clamp(b.power+8,1,99);b.teamId=tm.id;pool[b.id]=b;tm.batterIds.push(b.id);}
    while(tm.pitcherIds.filter(id=>pool[id]?.foreign).length<2){
      const p=makePitcher(24+Math.floor(rnd()*6),rnd()<0.6?"SP":"RP");p.foreign=true;["stuff","control","stamina"].forEach(f=>p[f]=clamp(55+Math.round(randn()*14),35,95));p.stuff=clamp(p.stuff+6,1,99);p.teamId=tm.id;pool[p.id]=p;tm.pitcherIds.push(p.id);}
  });

  // 引退
  Object.values(pool).forEach(p=>{if(p.status!=="active"&&p.status!=="overseas")return;const perf=p.kind==="bat"?perfBat(p.id):perfPit(p.id);let prob=0;if(p.age>=RETIRE_AGE)prob=0.18+(p.age-RETIRE_AGE)*0.10;if(p.age>=33&&perf<(p.kind==="bat"?80:90))prob+=0.18;if(p.age>=43)prob=1;if(rnd()<prob){p.status="retired";hall.push({id:p.id,name:p.name,kind:p.kind,age:p.age});removeFromTeam(teams,p);}});

  // 海外挑戦
  const oc=Object.values(pool).filter(p=>p.status==="active"&&p.age>=25&&p.age<=31&&((p.kind==="bat"&&perfBat(p.id)>125)||(p.kind==="pit"&&perfPit(p.id)>150)));
  oc.forEach(p=>{if(rnd()<0.35){p.status="overseas";p.overseasReturn=2+Math.floor(rnd()*3);removeFromTeam(teams,p);}});
  Object.values(pool).forEach(p=>{if(p.status!=="overseas")return;p.overseasReturn--;if(p.overseasReturn<=0){p.status="fa";}});

  // 戦力外
  teams.forEach(tm=>{const judge=(ids,kind)=>{ids.slice().forEach(id=>{const p=pool[id];if(!p||p.status!=="active")return;const perf=kind==="bat"?perfBat(id):perfPit(id);const played=kind==="bat"?(season.batStat[id]?.PA||0):(season.pitStat[id]?.IP||0);const lowPerf=kind==="bat"?perf<70:perf<55;const thinPlay=kind==="bat"?played<150:played<25;if(p.age>=25&&lowPerf&&thinPlay&&rnd()<0.5){p.status="fa";removeFromTeam(teams,p);}else if(p.age>=30&&lowPerf&&rnd()<0.3){p.status="fa";removeFromTeam(teams,p);}});};judge(tm.batterIds,"bat");judge(tm.pitcherIds,"pit");});

  // FA
  const faEligible=Object.values(pool).filter(p=>p.status==="active"&&p.yearsOnTeam>=FA_YEARS);
  let faDeclared=0;
  faEligible.forEach(p=>{if(faDeclared>=9)return;const perf=p.kind==="bat"?perfBat(p.id):perfPit(p.id);const good=p.kind==="bat"?perf>=95:perf>=105;const rate=good?0.35:0.10;if(rnd()<rate){p.status="fa";removeFromTeam(teams,p);faDeclared++;}});

  const teamStrength={};teams.forEach(tm=>{const rec=Object.values(season.record||{}).find(r=>r.id===tm.id);teamStrength[tm.id]=rec?(rec.W/Math.max(1,rec.W+rec.L)):0.5;});
  const fas=Object.values(pool).filter(p=>p.status==="fa");
  fas.sort((a,b)=>{const ra=a.kind==="bat"?perfBat(a.id):perfPit(a.id);const rb=b.kind==="bat"?perfBat(b.id):perfPit(b.id);return rb-ra;});
  fas.forEach(p=>{
    const perf=p.kind==="bat"?perfBat(p.id):perfPit(p.id);
    const cands=teams.filter(tm=>p.kind==="bat"?tm.batterIds.length<cfg.battersPerTeam+2:tm.pitcherIds.length<cfg.pitchersPerTeam+2);
    if(!cands.length)return;
    const desirable=p.kind==="bat"?perf>=85:perf>=95;
    if(!desirable&&rnd()<0.45){if(p.age>=32||p.wandered){p.status="retired";hall.push({id:p.id,name:p.name,kind:p.kind,age:p.age});}else{p.wandered=true;}return;}
    p.wandered=false;
    let pool2;
    if(desirable){pool2=cands.map(tm=>({tm,w:Math.pow(teamStrength[tm.id]+0.3,2)}));}
    else{pool2=cands.map(tm=>({tm,w:Math.pow(1.3-teamStrength[tm.id],2)}));}
    const total=pool2.reduce((a,b)=>a+b.w,0);let r=rnd()*total;let dest=pool2[0].tm;
    for(const c of pool2){r-=c.w;if(r<=0){dest=c.tm;break;}}
    addToTeam(dest,p);p.status="active";p.teamId=dest.id;p.yearsOnTeam=0;p.order=0;
    if(p.kind==="pit"&&p.role==="SP")p.rotation=Math.min(6,dest.pitcherIds.filter(id=>pool[id]?.role==="SP").length);
  });

  // 年齢増加
  Object.values(pool).forEach(p=>{if(p.status==="active"){agePlayer(p);p.yearsOnTeam++;}else if(p.status==="overseas"){agePlayer(p);}});
  assignFarm(teams,pool);

  // 抑え確保
  teams.forEach(tm=>{const rps=tm.pitcherIds.map(id=>pool[id]).filter(p=>p&&!p.farm&&p.role==="RP"&&p.status==="active");const hasCloser=rps.some(p=>p.rotation>=ROTATION_CLOSER_MIN&&p.rotation<=ROTATION_CLOSER_MAX);if(!hasCloser&&rps.length){rps.slice().sort((a,b)=>(b.stuff+b.control+b.stamina)-(a.stuff+a.control+a.stamina))[0].rotation=ROTATION_CLOSER_MIN;}});

  // ドラフト補充
  teams.forEach(tm=>{
    while(tm.batterIds.length<cfg.battersPerTeam){const b=makeBatter(18+Math.floor(rnd()*3),0);b.teamId=tm.id;pool[b.id]=b;tm.batterIds.push(b.id);}
    while(tm.pitcherIds.length<cfg.pitchersPerTeam){const p=makePitcher(18+Math.floor(rnd()*3),tm.pitcherIds.length<ROTATION_SIZE?"SP":"RP");p.teamId=tm.id;pool[p.id]=p;tm.pitcherIds.push(p.id);}
  });
}

// ============================================================
// 検証ロジック
// ============================================================
function avg(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;}
function pct(v,total){return total?((v/total)*100).toFixed(1)+"%":"-";}
function fmt(v,d=3){return v.toFixed(d);}

function runValidation(numRuns=5, seasonsPerRun=30){
  const allSeasonStats=[];

  for(let run=0;run<numRuns;run++){
    process.stdout.write(`Run ${run+1}/${numRuns}: `);
    const state=initLeague();
    state.career={bat:{},pit:{}};state.hall=[];

    for(let yr=0;yr<seasonsPerRun;yr++){
      if(yr%10===9)process.stdout.write(`${yr+1} `);
      const season=simulateSeason(state.teams,state.pool);

      // 打撃成績集計（規定以上）
      const batArr=computeBatting(Object.values(season.batStat));
      const qualified=batArr.filter(s=>s.PA>=400);
      const lgAVG=avg(qualified.map(s=>s.AVG));
      const lgOPS=avg(qualified.map(s=>s.OPS));
      const totalHR=batArr.reduce((a,s)=>a+s.HR,0);
      const totalGames=batArr.reduce((a,s)=>a+s.games,0)/9; // rough team-games
      const hrPerTeam=totalHR/NUM_TEAMS;

      // 投手成績集計
      const pitArr=computePitching(Object.values(season.pitStat));
      const spArr=pitArr.filter(s=>s.role==="SP"&&s.IP>=50);
      const rpArr=pitArr.filter(s=>s.role==="RP"&&s.IP>=10);
      const lgERA=avg(pitArr.filter(s=>s.IP>0).map(s=>s.ERA));
      const spERA=avg(spArr.map(s=>s.ERA));
      const rpERA=avg(rpArr.map(s=>s.ERA));
      const spIPperG=avg(spArr.map(s=>s.IP/Math.max(1,s.G)));
      const rpGperPit=avg(rpArr.map(s=>s.G));
      const lgWHIP=avg(pitArr.filter(s=>s.IP>0).map(s=>s.WHIP));

      // 出場試合数の分布 — initFarm/initOrder（シーズン開始時の状態）で正確分類
      const allBatStats=Object.values(season.batStat);
      const allPitStats=Object.values(season.pitStat);
      // 開幕1軍打者：スタメン(開幕時order 1-9)
      const starterGames=allBatStats.filter(s=>!season.initFarm[s.id]&&season.initOrder[s.id]>=1&&season.initOrder[s.id]<=9).map(s=>s.games);
      // 開幕1軍打者：控え(開幕時order=0, farm=false)
      const benchGames=allBatStats.filter(s=>!season.initFarm[s.id]&&season.initOrder[s.id]===0).map(s=>s.games);
      // 開幕2軍打者で昇格して出場した
      const farmCalledUp=allBatStats.filter(s=>season.initFarm[s.id]&&s.games>0).map(s=>s.games);
      // 開幕2軍打者で一度も出場なし
      const farmNeverUp=allBatStats.filter(s=>season.initFarm[s.id]&&s.games===0).length;
      const farmBatTotal=allBatStats.filter(s=>season.initFarm[s.id]).length;
      // 開幕2軍投手
      const farmPitCalledUp=allPitStats.filter(s=>season.initFarm[s.id]&&s.G>0).map(s=>s.G);
      const farmPitNeverUp=allPitStats.filter(s=>season.initFarm[s.id]&&s.G===0).length;
      const farmPitTotal=allPitStats.filter(s=>season.initFarm[s.id]).length;

      // 中継ぎ出場数（開幕1軍のみ）
      const rpGames=allPitStats.filter(s=>!season.initFarm[s.id]&&s.role==="RP"&&s.IP>0).map(s=>s.G);

      // 引き分け率
      const drawRate=season.totalDraws/Math.max(1,season.totalGames);

      allSeasonStats.push({
        yr:run*seasonsPerRun+yr+1,
        lgAVG,lgOPS,totalHR,hrPerTeam,
        lgERA,spERA,rpERA,spIPperG,rpGperPit,lgWHIP,
        starterAvgG:avg(starterGames),
        benchAvgG:avg(benchGames),
        benchMin:Math.min(...benchGames.length?benchGames:[0]),
        benchMax:Math.max(...benchGames.length?benchGames:[0]),
        farmCalledUpN:farmCalledUp.length,
        farmCalledUpAvgG:avg(farmCalledUp.length?farmCalledUp:[0]),
        farmNeverUpN:farmNeverUp,
        farmBatTotal,
        farmPitCalledUpN:farmPitCalledUp.length,
        farmPitCalledUpAvgG:avg(farmPitCalledUp.length?farmPitCalledUp:[0]),
        farmPitNeverUpN:farmPitNeverUp,
        farmPitTotal,
        swapCount:season.swapCount,
        rpAvgG:avg(rpGames),rpMaxG:Math.max(...rpGames.length?rpGames:[0]),
        drawRate,totalDraws:season.totalDraws,
        totalGamesInSeason:season.totalGames,
        _dbgMaxG:avg(season._dbg.maxGArr),
        _dbgActualG:avg(season._dbg.gamesArr),
        _dbgCount:season._dbg.farmDemotions,
      });

      processOffseason(state,season);
      // テスト用：引退で空いた打順1-9を自動補充（アプリではユーザーが手動設定）
      state.teams.forEach(tm=>{
        const abil=b=>(b.contact+b.power+b.eye+b.speed)/4;
        const usedOrders=new Set(tm.batterIds.map(id=>state.pool[id]).filter(b=>b&&!b.farm&&b.order>=1&&b.order<=9).map(b=>b.order));
        const bench=tm.batterIds.map(id=>state.pool[id]).filter(b=>b&&!b.farm&&b.order===0).sort((a,b2)=>abil(b2)-abil(a));
        for(let o=1;o<=9;o++){
          if(!usedOrders.has(o)&&bench.length){const p=bench.shift();p.order=o;}
        }
        // ローテ補充
        const usedRot=new Set(tm.pitcherIds.map(id=>state.pool[id]).filter(p=>p&&!p.farm&&p.rotation>=1&&p.rotation<=ROTATION_SIZE).map(p=>p.rotation));
        const rpAbil=p=>(p.stuff+p.control+p.stamina)/3;
        const farmSP=tm.pitcherIds.map(id=>state.pool[id]).filter(p=>p&&p.role==="SP"&&(p.farm||p.rotation===0)).sort((a,b2)=>rpAbil(b2)-rpAbil(a));
        for(let r=1;r<=ROTATION_SIZE;r++){
          if(!usedRot.has(r)&&farmSP.length){const p=farmSP.shift();p.rotation=r;p.farm=false;}
        }
      });
    }
    console.log("done");
  }

  // ============================================================
  // 集計・レポート
  // ============================================================
  console.log("\n====================================================");
  console.log(`  検証レポート: ${numRuns}run × ${seasonsPerRun}season = ${allSeasonStats.length}シーズン`);
  console.log("====================================================\n");

  // 打撃
  console.log("【打撃成績（規定打席400以上の平均）】");
  console.log("  指標        平均       NPB目安       判定");
  const lgAVGs=allSeasonStats.map(s=>s.lgAVG);
  const lgOPSs=allSeasonStats.map(s=>s.lgOPS);
  const hrPerTeams=allSeasonStats.map(s=>s.hrPerTeam);
  const printRow=(label,vals,npbLo,npbHi,flip=false)=>{
    const m=avg(vals);const lo=Math.min(...vals),hi=Math.max(...vals);
    const ok=m>=npbLo&&m<=npbHi;
    const sym=ok?"✓":(flip?m<npbLo?"△低":"△高":m<npbLo?"△低":"△高");
    console.log(`  ${label.padEnd(12)}${fmt(m).padEnd(11)}${(npbLo+"-"+npbHi).padEnd(14)}${ok?"✓ OK":`△ (range ${fmt(lo)}-${fmt(hi)})`}`);
  };
  printRow("リーグ打率",lgAVGs,0.240,0.270);
  printRow("リーグOPS",lgOPSs,0.680,0.760);
  printRow("HR/チーム",hrPerTeams,80,170,false);

  console.log("\n【投手成績】");
  const eras=allSeasonStats.map(s=>s.lgERA);
  const spEras=allSeasonStats.map(s=>s.spERA);
  const rpEras=allSeasonStats.map(s=>s.rpERA);
  const whips=allSeasonStats.map(s=>s.lgWHIP);
  const spIPs=allSeasonStats.map(s=>s.spIPperG);
  const rpGs=allSeasonStats.map(s=>s.rpAvgG);
  const rpMaxGs=allSeasonStats.map(s=>s.rpMaxG);
  printRow("リーグERA",eras,3.20,4.20);
  printRow("先発ERA",spEras,3.00,4.50);
  printRow("救援ERA",rpEras,2.80,4.00);
  printRow("リーグWHIP",whips,1.15,1.50);
  printRow("先発IP/G",spIPs,5.50,7.00);
  console.log(`  中継ぎG/人    avg=${fmt(avg(rpGs),1).padEnd(10)}NPB目安30-60G    range ${fmt(Math.min(...rpGs),1)}-${fmt(Math.max(...rpGs),1)}`);
  console.log(`  中継ぎ最多G   avg=${fmt(avg(rpMaxGs),1).padEnd(10)}NPB目安60-80G   range ${fmt(Math.min(...rpMaxGs),1)}-${fmt(Math.max(...rpMaxGs),1)}`);

  console.log("\n【出場試合数（開幕時の状態で正確分類）】");
  const starterGs=allSeasonStats.map(s=>s.starterAvgG);
  const benchGs=allSeasonStats.map(s=>s.benchAvgG);
  const benchMins=allSeasonStats.map(s=>s.benchMin);
  const benchMaxs=allSeasonStats.map(s=>s.benchMax);
  const dbgMaxG=avg(allSeasonStats.map(s=>s._dbgMaxG).filter(x=>!isNaN(x)));
  const dbgActualG=avg(allSeasonStats.map(s=>s._dbgActualG).filter(x=>!isNaN(x)));
  const dbgCounts=allSeasonStats.map(s=>s._dbgCount||0);
  console.log(`  [DEBUG] スタメン maxGames平均: ${fmt(dbgMaxG,1)}  実際games平均: ${fmt(dbgActualG,1)}  差: ${fmt(dbgMaxG-dbgActualG,1)}`);
  console.log(`  [DEBUG] スタメン平均人数/season: ${fmt(avg(dbgCounts),1)}  最小: ${Math.min(...dbgCounts)}  最大: ${Math.max(...dbgCounts)}`);
  console.log(`  開幕スタメン平均G    ${fmt(avg(starterGs),1).padEnd(8)}NPB目安100-143G`);
  console.log(`  開幕控え平均G        ${fmt(avg(benchGs),1).padEnd(8)}NPB目安30-80G`);
  console.log(`  開幕控え最少/最多G   ${fmt(avg(benchMins),1)} / ${fmt(avg(benchMaxs),1)}`);
  console.log("");
  console.log("【2軍→1軍昇格の実態】");
  const swaps=allSeasonStats.map(s=>s.swapCount);
  const fcUpN=allSeasonStats.map(s=>s.farmCalledUpN);
  const fcUpG=allSeasonStats.map(s=>s.farmCalledUpAvgG);
  const fnUp=allSeasonStats.map(s=>s.farmNeverUpN);
  const fbT=allSeasonStats.map(s=>s.farmBatTotal);
  const fpUpN=allSeasonStats.map(s=>s.farmPitCalledUpN);
  const fpUpG=allSeasonStats.map(s=>s.farmPitCalledUpAvgG);
  const fpnUp=allSeasonStats.map(s=>s.farmPitNeverUpN);
  const fpT=allSeasonStats.map(s=>s.farmPitTotal);
  console.log(`  シーズン中昇格イベント数  avg=${fmt(avg(swaps),1)}/season  (全${NUM_TEAMS}チーム合計)`);
  console.log(`  1チームあたり昇格回数      avg=${fmt(avg(swaps)/NUM_TEAMS,1)}/season`);
  console.log("");
  console.log("  ─ 野手 ─");
  console.log(`  開幕2軍打者総数            avg=${fmt(avg(fbT),1)}人/season`);
  console.log(`  うち昇格して出場した選手   avg=${fmt(avg(fcUpN),1)}人/season (${fmt(avg(fcUpN)/Math.max(0.01,avg(fbT))*100,1)}%)`);
  console.log(`  昇格選手の平均出場G        avg=${fmt(avg(fcUpG),1)}G`);
  console.log(`  一度も昇格しなかった選手   avg=${fmt(avg(fnUp),1)}人/season`);
  console.log("");
  console.log("  ─ 投手 ─");
  console.log(`  開幕2軍投手総数            avg=${fmt(avg(fpT),1)}人/season`);
  console.log(`  うち昇格して登板した投手   avg=${fmt(avg(fpUpN),1)}人/season (${fmt(avg(fpUpN)/Math.max(0.01,avg(fpT))*100,1)}%)`);
  console.log(`  昇格投手の平均登板G        avg=${fmt(avg(fpUpG),1)}G`);
  console.log(`  一度も昇格しなかった投手   avg=${fmt(avg(fpnUp),1)}人/season`);

  console.log("\n【引き分け率】");
  const drawRates=allSeasonStats.map(s=>s.drawRate);
  const drPct=avg(drawRates)*100;
  console.log(`  引き分け率     ${drPct.toFixed(2)}%    NPB目安2-6%    ${drPct>=2&&drPct<=6?"✓ OK":"△ 範囲外"}`);
  console.log(`  引き分け数/S   ${fmt(avg(allSeasonStats.map(s=>s.totalDraws)),1)}    NPB目安6-18試合/シーズン全体`);
  console.log(`  (1チームあたり ${fmt(avg(allSeasonStats.map(s=>s.totalDraws))/NUM_TEAMS*2,1)}試合/シーズン)`);

  // 最後に問題点サマリー
  console.log("\n【総評】");
  const issues=[];
  if(avg(lgAVGs)<0.235||avg(lgAVGs)>0.275)issues.push(`打率 ${fmt(avg(lgAVGs))} — NPB .240-.270`);
  if(avg(eras)<3.0||avg(eras)>4.5)issues.push(`ERA ${fmt(avg(eras))} — NPB 3.20-4.20`);
  if(avg(whips)<1.10||avg(whips)>1.55)issues.push(`WHIP ${fmt(avg(whips))} — NPB 1.15-1.50`);
  if(avg(spIPs)<5.0||avg(spIPs)>7.5)issues.push(`先発IP/G ${fmt(avg(spIPs))} — NPB 5.5-7.0`);
  if(avg(benchGs)<20||avg(benchGs)>90)issues.push(`控え出場G ${fmt(avg(benchGs),1)} — NPB 30-80`);
  const fcUpPct=avg(allSeasonStats.map(s=>s.farmCalledUpN))/Math.max(0.01,avg(allSeasonStats.map(s=>s.farmBatTotal)))*100;
  if(fcUpPct<10)issues.push(`2軍野手の昇格率 ${fcUpPct.toFixed(1)}% — 低すぎ（NPB目安20-40%）`);
  if(drPct<1.5||drPct>8)issues.push(`引き分け率 ${drPct.toFixed(2)}% — NPB 2-6%`);
  if(issues.length===0){console.log("  すべての指標がNPB目安の範囲内 ✓");}
  else{console.log("  要確認:"); issues.forEach(i=>console.log("  ✗ "+i));}
}

// 実行
runValidation(5, 30);
