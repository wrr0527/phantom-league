import React, { useState, useMemo, useEffect } from "react";

// ============================================================
// 架空野球リーグ シミュレーター v6 — "妄想選手名鑑"
// 球種(チェック→能力反映) / 起用優先度＋ゆらぎ(基本オーダーは決めるが毎日動く)
// パワプロS〜Gランク / かんたんモード / 一括IO / マルコフ得点
// 年齢成長 / 通算・殿堂 / 初期通算 / 成績準拠クビ / NPB寄せ / 永続化
// ============================================================

const STORAGE_KEY = "phantom-league-v7"; // 互換のため据え置き（データ構造は同じ）
const SHEET_URL_KEY = "phantom-league-sheet-url"; // GAS Web AppのURL保存先
const SCHEMA_VERSION = 10; // 保存データのスキーマ版（改修時のマイグレーション用）
const ROTATION_SIZE = 6;   // 先発ローテーション人数（中6日想定）
const LEAGUE_NAMES = { central: "セントラル", pacific: "パシフィック" };
const INTERLEAGUE_RATIO = 0.18; // 交流戦の割合
const JS_WINS = 4; // 日本シリーズは先に4勝
const GAMES=143, NUM_TEAMS=12, BATTERS_PER_TEAM=20, PITCHERS_PER_TEAM=16, FA_YEARS=8, RETIRE_AGE=36;
// NPB準拠の枠
const ROSTER_28=28;       // 一軍登録上限（NPB準拠 固定）
const BENCH_25=25;        // ベンチ入り
const FOREIGN_ON_FIELD=4; // 外国人同時出場上限
// ユーザーが変更できるリーグ設定のデフォルト値
const DEFAULT_CONFIG={battersPerTeam:BATTERS_PER_TEAM,pitchersPerTeam:PITCHERS_PER_TEAM,draftBat:3,draftPit:2,leagueNameC:"セントラル",leagueNameP:"パシフィック"};

const SURNAMES=["佐藤","鈴木","高橋","田中","伊藤","渡辺","山本","中村","小林","加藤","吉田","山田","佐々木","松本","井上","清水","林","斎藤","森","池田","橋本","阿部","石川","山口","岡田"];
const GIVEN=["翔","大輔","拓也","健太","直樹","誠","亮","隼人","蓮","駿","陽介","和也","海斗","悠真","颯","大和","健斗","翔太","拓海","結翔"];
const PITCH_TYPES=["直球","スライダー","カーブ","フォーク","シュート","シンカー","カット","チェンジ"];
const BREAKING_K=["フォーク","シンカー"]; // 三振奪取に効く落ちる球

let UID=0; const newId=()=>`p${UID++}`;
const rnd=()=>Math.random();
const randn=()=>{let u=0,v=0;while(u===0)u=Math.random();while(v===0)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const norm=(v)=>clamp(v,1,99)/99;
const randName=()=>SURNAMES[Math.floor(rnd()*SURNAMES.length)]+GIVEN[Math.floor(rnd()*GIVEN.length)];

const RANKS=["S","A","B","C","D","E","F","G"];
const RANK_VAL={S:92,A:83,B:73,C:63,D:53,E:43,F:33,G:20};
const rankToVal=(r)=>clamp((RANK_VAL[r]??63)+Math.round(randn()*3),1,99);
const valToRank=(v)=>{if(v>=89)return"S";if(v>=79)return"A";if(v>=69)return"B";if(v>=59)return"C";if(v>=49)return"D";if(v>=39)return"E";if(v>=29)return"F";return"G";};
const parseAbility=(s)=>{if(s==null)return 63;const t=String(s).trim().toUpperCase();if(RANK_VAL[t]!=null)return rankToVal(t);const n=Number(t);return isNaN(n)?63:clamp(n,1,99);};

const emptyCareerBat=()=>({seasons:0,PA:0,AB:0,H:0,_2B:0,_3B:0,HR:0,BB:0,HBP:0,SO:0,RBI:0,R:0,SB:0,games:0});
const emptyCareerPit=()=>({seasons:0,IP:0,H:0,HR:0,BB:0,SO:0,ER:0,W:0,L:0,SV:0,G:0});

// デフォルトはオールE(=43前後)の控え級。主力だけ後から査定する想定で初期設定の手間を減らす
const E_BASE=43;
function eVal(){return clamp(E_BASE+Math.round(randn()*4),1,99);}
function makeBatter(age=22,order=0){return {id:newId(),name:randName(),age,kind:"bat",contact:eVal(),power:eVal(),eye:eVal(),speed:eVal(),order,foreign:false,farm:false,status:"active",teamId:null,yearsOnTeam:0,overseasReturn:0,init:emptyCareerBat()};}
function makePitcher(age=22,role,rotation=0){return {id:newId(),name:randName(),age,kind:"pit",stuff:eVal(),control:eVal(),stamina:eVal(),role:role||(rnd()<0.5?"SP":"RP"),rotation,pitches:["直球","スライダー"],foreign:false,farm:false,status:"active",teamId:null,yearsOnTeam:0,overseasReturn:0,init:emptyCareerPit()};}

// 球種→投手能力の実効補正。多彩さ＋落ちる球で三振増・被安打減
function pitchBonus(p){
  const n=(p.pitches||[]).length;
  const variety=clamp((n-2)*2.2,0,11);                 // 球種数ボーナス（最大+11相当）
  const kball=(p.pitches||[]).some(x=>BREAKING_K.includes(x))?4:0; // 決め球
  return { stuffAdj: variety+kball };
}
function effStuff(p){ return clamp(p.stuff+pitchBonus(p).stuffAdj,1,99); }

function batterFromOverall(name,age,rank,order){const base=RANK_VAL[rank]??63;const b=makeBatter(age,order);b.name=name;["contact","power","eye","speed"].forEach(f=>b[f]=clamp(base+Math.round(randn()*8),1,99));return b;}
function pitcherFromOverall(name,age,rank,role){const base=RANK_VAL[rank]??63;const p=makePitcher(age,role);p.name=name;["stuff","control","stamina"].forEach(f=>p[f]=clamp(base+Math.round(randn()*8),1,99));return p;}

function initLeague(){
  UID=0;const teams=[];const pool={};
  for(let t=0;t<NUM_TEAMS;t++){const league=t<NUM_TEAMS/2?"central":"pacific";const tm={id:t,name:`Team ${String.fromCharCode(65+t)}`,league,batterIds:[],pitcherIds:[]};
    for(let i=0;i<BATTERS_PER_TEAM;i++){const b=makeBatter(22+Math.floor(rnd()*10), i<9?i+1:0);b.teamId=t;b.yearsOnTeam=Math.min(b.age-21,Math.floor(rnd()*6));pool[b.id]=b;tm.batterIds.push(b.id);}
    for(let i=0;i<PITCHERS_PER_TEAM;i++){const role=i<ROTATION_SIZE?"SP":"RP";const p=makePitcher(22+Math.floor(rnd()*10),role,i<ROTATION_SIZE?i+1:0);if(i===PITCHERS_PER_TEAM-1)p.rotation=99;/*抑え*/ p.teamId=t;p.yearsOnTeam=Math.min(p.age-21,Math.floor(rnd()*6));pool[p.id]=p;tm.pitcherIds.push(p.id);}
    teams.push(tm);}
  // 初期だけ：主力(スタメン9・先発6・抑え)をC〜A相当に底上げ。控え/2軍候補はEのまま残す
  const starterVal=()=>clamp(58+Math.round(randn()*12),35,92); // 中心63(C)前後、上はA級まで
  teams.forEach(tm=>{
    tm.batterIds.map(id=>pool[id]).filter(b=>b.order>=1&&b.order<=9).forEach(b=>{["contact","power","eye","speed"].forEach(f=>b[f]=starterVal());});
    tm.pitcherIds.map(id=>pool[id]).filter(p=>(p.rotation>=1&&p.rotation<=ROTATION_SIZE)||p.rotation===99).forEach(p=>{["stuff","control","stamina"].forEach(f=>p[f]=starterVal());});
  });
  // 各球団に外国人を野手2・投手2配置（パワー/球威を少し高めに）
  teams.forEach(tm=>{
    tm.batterIds.slice(0,2).forEach(id=>{pool[id].foreign=true;pool[id].power=clamp(pool[id].power+8,1,99);});
    tm.pitcherIds.filter(id=>pool[id].role==="RP").slice(0,2).forEach(id=>{pool[id].foreign=true;pool[id].stuff=clamp(pool[id].stuff+6,1,99);});
  });
  assignFarm(teams,pool);
  return {teams,pool};
}
// 1軍登録上限(ROSTER_28)を超えた選手を2軍(farm)に回す。能力下位＆若手から2軍へ
function assignFarm(teams,pool){
  teams.forEach(tm=>{
    const members=[...tm.batterIds,...tm.pitcherIds].map(id=>pool[id]).filter(Boolean);
    const score=(p)=>{ let s=p.kind==="bat"?(p.contact+p.power+p.eye+p.speed)/4:(p.stuff+p.control+p.stamina)/3;
      if(p.kind==="bat"&&p.order>=1&&p.order<=9)s+=20;                       // スタメン
      if(p.kind==="pit"&&((p.rotation>=1&&p.rotation<=ROTATION_SIZE)||p.rotation===99))s+=18; // ローテ・抑え
      if(p.kind==="pit"&&p.role==="RP"&&p.rotation!==99)s+=8;                // 中継ぎにも1軍枠ボーナス
      return s; };
    members.sort((a,b)=>score(b)-score(a));
    members.forEach((p,i)=>{ p.farm = i>=ROSTER_28; });
  });
}

// ============================================================
// マルコフ連鎖
// ============================================================
function batterEventProbs(b,factor,form){const c=norm(b.contact),p=norm(b.power),e=norm(b.eye);
  const fm=form||1.0;
  const historic=fm>=1.40; // 歴史的シーズン：上限のフタを緩める
  const fhit=clamp(factor,0.70,1.30)*fm;
  const fk=clamp(2-factor,0.75,1.35)/Math.sqrt(fm);
  let bb=clamp(0.030+e*0.065,0.018,0.115)*Math.sqrt(clamp(factor,0.7,1.3)*fm);
  let hbp=0.007;
  let k=clamp(0.21-c*0.12,0.085,0.27)*clamp(fk,0.6,1.5);
  const hitCap=historic?1.36:1.235; // 通常.389未満、歴史的のみ稀に4割（50年に一度級）
  const hitBase=clamp(0.160+c*0.138,0.130,0.340)*clamp(fhit,0.6,hitCap);
  // HRは歴史的シーズンならベース率を底上げ（57-59本級のギリギリ更新に）
  const hrBase=historic? (0.014+p*0.060) : (0.007+p*0.050);
  let hr=clamp(hrBase,0.004,historic?0.098:0.082)*clamp(fhit,0.55,historic?2.15:1.78);
  let triple=0.0025*clamp(fhit,0.6,1.5);                               // 三塁打は稀
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

// ============================================================
// 起用：優先度＋ゆらぎ
// 野手：order(1-9)が基本スタメン。毎試合 休養/不調で控えと入れ替わる
// 投手先発：rotation番手を巡回。中継ぎ/抑えは別枠
// ============================================================
function pickLineup(off,pool,batStat){
  // 1軍かつ出場可能な野手
  let oneArmy=off.batterIds.map(id=>pool[id]).filter(b=>!b.farm).filter(b=>{const st=batStat[b.id];return !(st&&st.games>st.maxGames&&st.games>0);});
  if(oneArmy.length<9){ oneArmy=off.batterIds.map(id=>pool[id]).filter(b=>{const st=batStat[b.id];return !(st&&st.games>st.maxGames&&st.games>0);}); }
  if(oneArmy.length<9){ oneArmy=off.batterIds.map(id=>pool[id]).filter(Boolean); }
  const starters=oneArmy.filter(b=>b.order>=1&&b.order<=9).sort((a,b)=>a.order-b.order);
  const bench=oneArmy.filter(b=>!(b.order>=1&&b.order<=9));
  const lineup=[];
  starters.forEach(s=>{
    // スタメンの休養は7%程度（規定到達を1チーム5-6人=リーグ60前後に）
    if(rnd()<0.07 && bench.length){ const idx=Math.floor(rnd()*bench.length); lineup.push(bench.splice(idx,1)[0]); }
    else lineup.push(s);
  });
  while(lineup.length<9 && bench.length) lineup.push(bench.shift());
  while(lineup.length<9 && oneArmy.length) lineup.push(oneArmy[lineup.length%oneArmy.length]);
  const finalLineup=enforceForeign(lineup, oneArmy, FOREIGN_ON_FIELD-1);
  return { lineup: finalLineup, bench };
}
// 出場野手の外国人数が上限を超えたら、超過分を国内のベンチ選手で置換
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
  // 1軍投手から先発候補を作る：SP優先、足りなければ能力上位の投手で6人を埋める
  const oneArmy=def.pitcherIds.map(id=>pool[id]).filter(p=>!p.farm);
  let sp=oneArmy.filter(p=>p.role==="SP").sort((a,b)=>(a.rotation||9)-(b.rotation||9));
  if(sp.length<ROTATION_SIZE){
    // SP不足分を、抑え以外の投手から能力順で補う
    const extra=oneArmy.filter(p=>p.role!=="SP"&&p.rotation!==99).sort((a,b)=>(b.stuff+b.control+b.stamina)-(a.stuff+a.control+a.stamina));
    sp=[...sp,...extra].slice(0,ROTATION_SIZE);
  } else {
    sp=sp.slice(0,ROTATION_SIZE);
  }
  if(!sp.length)return oneArmy[0]||def.pitcherIds.map(id=>pool[id])[0];
  // ローテを巡回しつつ、たまに前後（ゆらぎ）
  let idx=(gameNo-1)%sp.length;
  if(rnd()<0.12) idx=(idx+1)%sp.length; // 中5日ずれ等
  return sp[idx];
}

function teamGame(off,def,pool,batStat,pitStat,gameNo){
  const usedSP=pickStarter(def,pool,gameNo);
  const rp=def.pitcherIds.map(id=>pool[id]).filter(p=>!p.farm&&p.role==="RP");
  const spForm=pitStat[usedSP.id]?.form||1.0;
  const factor=pitcherFactor(usedSP)*(0.85+rnd()*0.3)/Math.sqrt(spForm); // 好調(form>1)ほどfactor低下＝抑える
  const cache={};const getProbs=(b)=>cache[b.id]||(cache[b.id]=batterEventProbs(b,factor,batStat[b.id]?.form));
  let idx=0;const {lineup,bench}=pickLineup(off,pool,batStat);const ls={next:()=>lineup[idx++%lineup.length]};
  let runs=0;for(let i=0;i<9;i++)runs+=simInning(ls,batStat,getProbs);
  lineup.forEach(b=>{if(batStat[b.id])batStat[b.id].games++;});
  // 控えの部分出場（代打・代走・守備固め）：毎試合1〜3人が1打席前後だけ出る
  const subCount=Math.min(bench.length, 1+Math.floor(rnd()*3));
  const shuffledBench=[...bench].sort(()=>rnd()-0.5).slice(0,subCount);
  shuffledBench.forEach(b=>{ const st=batStat[b.id]; if(!st)return;
    st.games++;
    const role=rnd();
    if(role<0.55){ // 代打：1打席。簡易に確率処理
      st.PA++; const pr=batterEventProbs(b,1.0,st.form); const x=rnd();
      if(x<pr.k){st.AB++;st.SO++;}
      else if(x<pr.k+pr.bb){st.BB++;}
      else if(x<pr.k+pr.bb+pr.hr){st.AB++;st.H++;st.HR++;st.RBI++;st.R++;}
      else if(x<pr.k+pr.bb+pr.hr+pr.dbl){st.AB++;st.H++;st._2B++;}
      else if(x<pr.k+pr.bb+pr.hr+pr.dbl+pr.sgl){st.AB++;st.H++;}
      else {st.AB++;}
    } else if(role<0.75){ // 代走：打席なし、稀に盗塁
      if(norm(b.speed)>0.5&&rnd()<0.15)st.SB++;
    }
    // 残りは守備固め：出場のみ（games++済み）、打席なし
  });
  if(usedSP&&pitStat[usedSP.id]){const ps=pitStat[usedSP.id];const f=ps.injuryFactor;const spIP=clamp(6.0*f*(0.80+norm(usedSP.stamina)*0.30),3.5,8);
    ps.IP+=spIP;ps.G++;ps.ER+=runs*(spIP/9);ps.SO+=Math.round(spIP*(0.50+norm(effStuff(usedSP))*0.45)*clamp(spForm,0.8,1.5));ps.BB+=Math.max(0,Math.round(spIP*(0.34-norm(usedSP.control)*0.20)));ps.H+=Math.round(runs*0.75+spIP*0.70);if(rnd()<0.18)ps.HR++;
    const remain=9-spIP;
    // 抑え優先で最後を締める
    const closer=rp.find(p=>p.rotation===99);const mid=rp.filter(p=>p.rotation!==99);
    // その日投げる中継ぎは2〜3人だけ（ランダム選出）。残り全員は登板しない＝年間登板が現実的に
    const shuffledMid=[...mid].sort(()=>rnd()-0.5);
    const todayMid=shuffledMid.slice(0, 1+Math.floor(rnd()*2)); // 1〜2人
    const relievers=[...todayMid];
    // 僅差(3点差以内)のリードまたは接戦なら抑えが登板
    if(closer && Math.abs(runs-4)<=3 && rnd()<0.6) relievers.push(closer);
    if(!relievers.length && mid.length) relievers.push(shuffledMid[0]);
    relievers.forEach(p=>{if(!pitStat[p.id])return;const seg=remain/Math.max(1,relievers.length);const rs=pitStat[p.id];rs.IP+=seg;rs.G++;rs.ER+=(runs/9)*seg;rs.SO+=Math.round(seg*(0.60+norm(effStuff(p))*0.50));rs.BB+=Math.max(0,Math.round(seg*(0.33-norm(p.control)*0.16)));rs.H+=Math.round(seg*0.92);});}
  return {runs, sp:usedSP, closer:rp.find(p=>p.rotation===99)};
}

function rollInjury(){const r=rnd();if(r<0.50)return GAMES;if(r<0.78)return Math.floor(GAMES*(0.7+rnd()*0.25));if(r<0.94)return Math.floor(GAMES*(0.4+rnd()*0.3));return Math.floor(GAMES*(0.05+rnd()*0.3));}

// リーグ内中心＋交流戦のスケジュール。各球団おおむねGAMES試合になるよう生成
function buildSchedule(teams){
  const central=teams.filter(t=>t.league==="central").map(t=>t.id);
  const pacific=teams.filter(t=>t.league==="pacific").map(t=>t.id);
  const schedule=[];
  const interGames=Math.round(GAMES*INTERLEAGUE_RATIO);
  const intraGames=GAMES-interGames;
  // リーグ内総当たり：各日リーグごとにペアを作る
  const pairUp=(ids,gameNo)=>{const o=[...ids];for(let i=o.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[o[i],o[j]]=[o[j],o[i]];}const res=[];for(let i=0;i+1<o.length;i+=2)res.push({home:o[i],away:o[i+1],gameNo,inter:false});return res;};
  for(let g=0;g<intraGames;g++){ schedule.push(...pairUp(central,g+1)); schedule.push(...pairUp(pacific,g+1)); }
  // 交流戦：セ×パを1対1で総当たり風に均等に組む（各チームの試合数を揃える）
  for(let g=0;g<interGames;g++){
    const offset=g%pacific.length;
    for(let i=0;i<central.length;i++){
      const c=central[i]; const p=pacific[(i+offset)%pacific.length];
      schedule.push({home:rnd()<0.5?c:p,away:rnd()<0.5?p:c,gameNo:intraGames+g+1,inter:true});
    }
  }
  return schedule;
}
// 日本シリーズ：両リーグ優勝チームで先にJS_WINS勝
function playJapanSeries(champC,champP,teams,pool){
  const tC=teams.find(t=>t.id===champC.id), tP=teams.find(t=>t.id===champP.id);
  let wC=0,wP=0;const log=[];let g=1;
  while(wC<JS_WINS&&wP<JS_WINS){
    const dummyB={},dummyP={}; // 個人成績には加算しない（短期シリーズ）
    [tC,tP].forEach(tm=>{tm.batterIds.forEach(id=>dummyB[id]={id,games:0,maxGames:GAMES,PA:0,AB:0,H:0,_2B:0,_3B:0,HR:0,BB:0,HBP:0,SO:0,RBI:0,R:0,SB:0});tm.pitcherIds.forEach(id=>dummyP[id]={id,IP:0,H:0,HR:0,BB:0,SO:0,ER:0,W:0,L:0,SV:0,G:0,injuryFactor:1});});
    let rC=teamGame(tC,tP,pool,dummyB,dummyP,g).runs, rP=teamGame(tP,tC,pool,dummyB,dummyP,g).runs;
    if(rC===rP){if(rnd()<0.5)rC++;else rP++;}
    if(rC>rP)wC++;else wP++;
    log.push(`第${g}戦 ${tC.name} ${rC}-${rP} ${tP.name}`);g++;
  }
  const champ=wC>wP?tC:tP;
  return {champion:champ.name,wC,wP,log};
}

// シーズン中の1軍2軍入れ替え：不振の1軍と好調な2軍を入れ替える（NPBの昇降格を再現）
function midSeasonSwap(teams,pool,batStat,pitStat){
  teams.forEach(tm=>{
    const oneBench=tm.batterIds.map(id=>pool[id]).filter(b=>!b.farm&&!(b.order>=1&&b.order<=9));
    const farmBat=tm.batterIds.map(id=>pool[id]).filter(b=>b.farm);
    if(oneBench.length&&farmBat.length){
      const worst=oneBench.map(b=>({b,avg:batStat[b.id]?batStat[b.id].H/Math.max(1,batStat[b.id].AB):0,pa:batStat[b.id]?.PA||0})).filter(x=>x.pa>20).sort((a,b)=>a.avg-b.avg)[0];
      const best=farmBat.map(b=>({b,score:(b.contact+b.power+b.eye+b.speed)/4})).sort((a,b)=>b.score-a.score)[0];
      if(worst&&best&&rnd()<0.5){ worst.b.farm=true; best.b.farm=false; }
    }
    const onePit=tm.pitcherIds.map(id=>pool[id]).filter(p=>!p.farm);
    const farmPit=tm.pitcherIds.map(id=>pool[id]).filter(p=>p.farm);
    if(onePit.length&&farmPit.length){
      const worst=onePit.map(p=>({p,era:pitStat[p.id]&&pitStat[p.id].IP>10?pitStat[p.id].ER*9/pitStat[p.id].IP:0,ip:pitStat[p.id]?.IP||0})).filter(x=>x.ip>15).sort((a,b)=>b.era-a.era)[0];
      const best=farmPit.map(p=>({p,score:(p.stuff+p.control+p.stamina)/3})).sort((a,b)=>b.score-a.score)[0];
      if(worst&&best&&worst.era>5.0&&rnd()<0.4){ worst.p.farm=true; best.p.farm=false; worst.p.rotation=0; }
    }
  });
}

// シーズンの調子係数。大半は±5%、稀に当たり年(+20〜30%)/不振年(-15〜25%)
// 規格外の素質：低確率で能力上限を超える怪物。長期で「世代の怪物」を生む
function maybeProdigy(p){
  if(rnd()<0.004){ // 0.4%で怪物化（数年に1人ペース）
    const fields=p.kind==="bat"?["contact","power","eye","speed"]:["stuff","control","stamina"];
    // 1〜2項目を超高水準(90-99)に、他も底上げ
    const boostN=1+Math.floor(rnd()*2);
    const shuffled=[...fields].sort(()=>rnd()-0.5);
    shuffled.forEach((f,i)=>{ p[f]= i<boostN ? clamp(90+Math.floor(rnd()*10),90,99) : clamp(p[f]+15,1,99); });
    p.prodigy=true;
  }
  return p;
}

function rollForm(){
  const r=rnd();
  if(r<0.007) return 1.40+rnd()*0.10; // 0.7% 歴史的シーズン（フタが外れNPB記録更新を狙える）
  if(r<0.037) return 1.20+rnd()*0.12; // 3% 当たり年（覚醒）
  if(r<0.107) return 1.08+rnd()*0.08; // 7% 好調
  if(r<0.857) return 0.95+rnd()*0.13; // 75% 平常
  if(r<0.977) return 0.85+rnd()*0.10; // 12% 不調
  return 0.72+rnd()*0.13;             // 3% 大不振
}

function simulateSeason(teams,pool){const batStat={},pitStat={};
  teams.forEach(tm=>{tm.batterIds.forEach(id=>{const b=pool[id];batStat[id]={id,name:b.name,team:tm.name,teamId:tm.id,age:b.age,games:0,maxGames:rollInjury(),form:rollForm(),PA:0,AB:0,H:0,_2B:0,_3B:0,HR:0,BB:0,HBP:0,SO:0,RBI:0,R:0,SB:0};});
    tm.pitcherIds.forEach(id=>{const p=pool[id];let inj=1;const r=rnd();if(r<0.12)inj=0.5;else if(r<0.2)inj=0.75;pitStat[id]={id,name:p.name,team:tm.name,teamId:tm.id,age:p.age,role:p.role,IP:0,H:0,HR:0,BB:0,SO:0,ER:0,W:0,L:0,SV:0,G:0,injuryFactor:inj,form:rollForm()};});});
  const record={};teams.forEach(tm=>record[tm.id]={name:tm.name,league:tm.league,W:0,L:0,RS:0,RA:0,id:tm.id});
  const schedule=buildSchedule(teams);
  const gameLog=[];schedule.forEach(m=>{
    // 約30試合ごとに1軍2軍入れ替え（シーズン中の昇降格）
    if(m.gameNo>1 && m.gameNo%30===0 && m.home===teams[0].id) midSeasonSwap(teams,pool,batStat,pitStat);
    const home=teams.find(t=>t.id===m.home),away=teams.find(t=>t.id===m.away);
    const hRes=teamGame(home,away,pool,batStat,pitStat,m.gameNo),aRes=teamGame(away,home,pool,batStat,pitStat,m.gameNo);
    let hR=hRes.runs,aR=aRes.runs;if(hR===aR){if(rnd()<0.5)hR++;else aR++;}
    // 先発に勝敗 or ノーデシジョン。NPB同様、約35%は先発に勝敗が付かない（中継ぎが勝利等）
    const decideSP=(spRes,won)=>{ if(!spRes.sp||!pitStat[spRes.sp.id])return; if(rnd()<0.35)return; won?pitStat[spRes.sp.id].W++:pitStat[spRes.sp.id].L++; };
    decideSP(hRes,hR>aR); decideSP(aRes,aR>hR);
    const winCloser=hR>aR?hRes.closer:aRes.closer;if(winCloser&&pitStat[winCloser.id]&&Math.abs(hR-aR)<=3)pitStat[winCloser.id].SV++;
    record[home.id].RS+=hR;record[home.id].RA+=aR;record[away.id].RS+=aR;record[away.id].RA+=hR;
    if(hR>aR){record[home.id].W++;record[away.id].L++;}else{record[away.id].W++;record[home.id].L++;}
    gameLog.push({gameNo:m.gameNo,home:home.name,away:away.name,homeRuns:hR,awayRuns:aR,winner:hR>aR?home.name:away.name});});
  // 両リーグ優勝決定→日本シリーズ
  const cl=Object.values(record).filter(r=>r.league==="central").sort((a,b)=>(b.W/Math.max(1,b.W+b.L))-(a.W/Math.max(1,a.W+a.L)));
  const pl=Object.values(record).filter(r=>r.league==="pacific").sort((a,b)=>(b.W/Math.max(1,b.W+b.L))-(a.W/Math.max(1,a.W+a.L)));
  let japanSeries=null;
  if(cl.length&&pl.length){ japanSeries=playJapanSeries(cl[0],pl[0],teams,pool); japanSeries.centralChamp=cl[0].name; japanSeries.pacificChamp=pl[0].name; }
  return {batStat,pitStat,record,gameLog,japanSeries};}

function ageMul(age){return age<=27?clamp(0.78+(age-18)*0.0244,0.78,1.0):clamp(1.0-(age-27)*0.022,0.5,1.0);}
function agePlayer(p){p.age++;const fs=p.kind==="bat"?["contact","power","eye","speed"]:["stuff","control","stamina"];const m=ageMul(p.age)/ageMul(p.age-1);
  // 2軍の若手は育成補正で伸びやすい（27歳以下、farm滞在）
  const farmBoost=(p.farm&&p.age<=27)?1.03:1.0;
  fs.forEach(f=>{p[f]=Math.round(clamp(p[f]*m*farmBoost*(1+randn()*0.015),1,99));});}

const Wt={bb:0.69,hbp:0.72,_1B:0.89,_2B:1.27,_3B:1.62,hr:2.10},SCALE=1.25,lgRPA=0.118,FIP_C=3.10;
function battingMetrics(s,lg){const _1B=s.H-s._2B-s._3B-s.HR;const AVG=s.H/Math.max(1,s.AB);const OBP=(s.H+s.BB+s.HBP)/Math.max(1,s.AB+s.BB+s.HBP);const TB=_1B+2*s._2B+3*s._3B+4*s.HR;const SLG=TB/Math.max(1,s.AB);const wOBA=(Wt.bb*s.BB+Wt.hbp*s.HBP+Wt._1B*_1B+Wt._2B*s._2B+Wt._3B*s._3B+Wt.hr*s.HR)/Math.max(1,s.AB+s.BB+s.HBP);const wRCp=Math.round((((wOBA-lg)/SCALE+lgRPA)/lgRPA)*100);return {...s,AVG,OBP,SLG,OPS:OBP+SLG,wOBA,wRCp,ISO:SLG-AVG};}
function computeBatting(stats){const arr=stats.filter(s=>s.PA>0);let tW=0,tD=0;arr.forEach(s=>{const _1B=s.H-s._2B-s._3B-s.HR;tW+=Wt.bb*s.BB+Wt.hbp*s.HBP+Wt._1B*_1B+Wt._2B*s._2B+Wt._3B*s._3B+Wt.hr*s.HR;tD+=s.AB+s.BB+s.HBP;});const lg=tW/Math.max(1,tD);return arr.map(s=>battingMetrics(s,lg));}
function pitchingMetrics(s){return {...s,ERA:(s.ER*9)/Math.max(1,s.IP),WHIP:(s.BB+s.H)/Math.max(1,s.IP),K9:(s.SO*9)/Math.max(1,s.IP),BB9:(s.BB*9)/Math.max(1,s.IP),FIP:(13*s.HR+3*s.BB-2*s.SO)/Math.max(1,s.IP)+FIP_C};}
function computePitching(stats){return stats.filter(s=>s.IP>0).map(pitchingMetrics);}

// ============================================================
// オフシーズン
// ============================================================
function accumulate(career,season){const bk=["PA","AB","H","_2B","_3B","HR","BB","HBP","SO","RBI","R","SB","games"];const pk=["IP","H","HR","BB","SO","ER","W","L","SV","G"];
  Object.values(season.batStat).forEach(s=>{if(s.PA===0)return;if(!career.bat[s.id])career.bat[s.id]={id:s.id,name:s.name,seasons:0,...emptyCareerBat()};const c=career.bat[s.id];c.seasons++;c.name=s.name;bk.forEach(k=>c[k]+=s[k]);});
  Object.values(season.pitStat).forEach(s=>{if(s.IP===0)return;if(!career.pit[s.id])career.pit[s.id]={id:s.id,name:s.name,role:s.role,seasons:0,...emptyCareerPit()};const c=career.pit[s.id];c.seasons++;pk.forEach(k=>c[k]+=s[k]);});}
function processOffseason(state,season,draftPicks){const {teams,pool,career,hall}=state;const cfg=state.config||DEFAULT_CONFIG;const news={retire:[],overseas:[],return:[],release:[],trade:[],fa:[],draft:[]};
  const batM={};computeBatting(Object.values(season.batStat)).forEach(s=>batM[s.id]=s);const pitM={};computePitching(Object.values(season.pitStat)).forEach(s=>pitM[s.id]=s);
  const perfBat=(id)=>batM[id]?batM[id].wRCp:0;const perfPit=(id)=>pitM[id]?(pitM[id].IP>20?200-pitM[id].FIP*20:60):40;
  // 0. 外国人選手の入れ替え（NPB助っ人は回転が速い：不振なら即解雇、活躍するほどMLB/好条件で流出）
  teams.forEach(tm=>{
    [...tm.batterIds,...tm.pitcherIds].slice().forEach(id=>{const p=pool[id];if(!p||!p.foreign||p.status!=="active")return;
      const perf=p.kind==="bat"?perfBat(id):perfPit(id);
      const good=p.kind==="bat"?perf>=105:perf>=110;
      const great=p.kind==="bat"?perf>=120:perf>=140;
      if(!good && rnd()<0.70){ // 不振：解雇
        p.status="released_foreign"; removeFromTeam(teams,p); news.release.push(`${tm.name} ${p.name}（助っ人）退団`);
      } else if(great){ // 大活躍：MLB復帰/好条件流出（在籍が長いほど抜けやすい）
        const leave=0.25+Math.min(0.25,p.yearsOnTeam*0.08);
        if(rnd()<leave){ p.status="released_foreign"; removeFromTeam(teams,p); news.overseas.push(`${p.name}（助っ人）大活躍でMLB/好条件移籍`); }
      } else if(good){ // 並の活躍：在籍年数が増えるほど流出（控えめ）
        const leave=0.08+Math.min(0.18,p.yearsOnTeam*0.04);
        if(rnd()<leave){ p.status="released_foreign"; removeFromTeam(teams,p); news.overseas.push(`${p.name}（助っ人）好条件で他球団・MLBへ`); }
      }
    });
  });
  // 解雇外国人は名簿から消す（プールから除去）＆空いた枠に新助っ人を補充
  Object.keys(pool).forEach(id=>{ if(pool[id].status==="released_foreign") delete pool[id]; });
  teams.forEach(tm=>{
    // 各球団おおむね外国人野手2・投手2を維持するよう新助っ人を補充
    while(tm.batterIds.filter(id=>pool[id]?.foreign).length<2){
      const b=makeBatter(24+Math.floor(rnd()*6));b.foreign=true;["contact","power","eye","speed"].forEach(f=>b[f]=clamp(55+Math.round(randn()*14),35,95));b.power=clamp(b.power+8,1,99);b.teamId=tm.id;pool[b.id]=b;tm.batterIds.push(b.id);news.draft.push(`${tm.name} 新助っ人野手 ${b.name}`);
    }
    while(tm.pitcherIds.filter(id=>pool[id]?.foreign).length<2){
      const p=makePitcher(24+Math.floor(rnd()*6),rnd()<0.6?"SP":"RP");p.foreign=true;["stuff","control","stamina"].forEach(f=>p[f]=clamp(55+Math.round(randn()*14),35,95));p.stuff=clamp(p.stuff+6,1,99);p.teamId=tm.id;pool[p.id]=p;tm.pitcherIds.push(p.id);news.draft.push(`${tm.name} 新助っ人投手 ${p.name}`);
    }
  });
  Object.values(pool).forEach(p=>{if(p.status!=="active"&&p.status!=="overseas")return;const perf=p.kind==="bat"?perfBat(p.id):perfPit(p.id);let prob=0;if(p.age>=RETIRE_AGE)prob=0.18+(p.age-RETIRE_AGE)*0.10;if(p.age>=33&&perf<(p.kind==="bat"?80:90))prob+=0.18;if(p.age>=43)prob=1;
    if(rnd()<prob){p.status="retired";const base=p.kind==="bat"?career.bat[p.id]:career.pit[p.id];const merged=mergeInit(p,base);hall.push({id:p.id,name:p.name,kind:p.kind,role:p.role,age:p.age,career:merged});news.retire.push(`${p.name}（${p.age}歳）引退 ${summ(p,merged)}`);removeFromTeam(teams,p);}});
  const oc=Object.values(pool).filter(p=>p.status==="active"&&p.age>=25&&p.age<=31&&((p.kind==="bat"&&perfBat(p.id)>125)||(p.kind==="pit"&&perfPit(p.id)>150)));
  oc.forEach(p=>{if(news.overseas.length<3&&rnd()<0.35){p.status="overseas";p.overseasReturn=2+Math.floor(rnd()*3);removeFromTeam(teams,p);news.overseas.push(`${p.name} 海外挑戦（${p.overseasReturn}年予定）`);}});
  Object.values(pool).forEach(p=>{if(p.status!=="overseas")return;p.overseasReturn--;if(p.overseasReturn<=0){p.status="fa";news.return.push(`${p.name} 国内復帰`);}});
  teams.forEach(tm=>{const judge=(ids,kind)=>{ids.slice().forEach(id=>{const p=pool[id];if(!p||p.status!=="active")return;const perf=kind==="bat"?perfBat(id):perfPit(id);const played=kind==="bat"?(season.batStat[id]?.PA||0):(season.pitStat[id]?.IP||0);const lowPerf=kind==="bat"?perf<70:perf<55;const thinPlay=kind==="bat"?played<150:played<25;
    if(p.age>=25&&lowPerf&&thinPlay&&rnd()<0.5){p.status="fa";removeFromTeam(teams,p);news.release.push(`${tm.name} ${p.name}（${p.age}歳）戦力外`);}else if(p.age>=30&&lowPerf&&rnd()<0.3){p.status="fa";removeFromTeam(teams,p);news.release.push(`${tm.name} ${p.name}（${p.age}歳）戦力外`);}});};
    judge(tm.batterIds,"bat");judge(tm.pitcherIds,"pit");});
  // FA宣言：有資格者(8年在籍)のうち、好成績の選手が中心に低確率で宣言。年9人前後に制限
  const faEligible=Object.values(pool).filter(p=>p.status==="active"&&p.yearsOnTeam>=FA_YEARS);
  let faDeclared=0;
  faEligible.forEach(p=>{
    if(faDeclared>=9)return;
    const perf=p.kind==="bat"?perfBat(p.id):perfPit(p.id);
    const good=p.kind==="bat"?perf>=95:perf>=105;
    // 好成績者は35%、並の選手は10%で宣言（資格者が少なめなので率を上げて年9人前後に）
    const rate=good?0.35:0.10;
    if(rnd()<rate){p.status="fa";removeFromTeam(teams,p);news.fa.push(`${p.name} FA宣言`);faDeclared++;}
  });
  // FA・自由契約選手の再契約（争奪戦）。好成績選手ほど強豪が獲得、不振選手は浪人もありうる
  // チームの「魅力度」=前年の勝率（強いチームが有力FAを引き寄せる）
  const teamStrength={};
  teams.forEach(tm=>{const rec=Object.values(season.record||{}).find(r=>r.id===tm.id);teamStrength[tm.id]=rec?(rec.W/Math.max(1,rec.W+rec.L)):0.5;});
  const fas=Object.values(pool).filter(p=>p.status==="fa");
  // 良い選手から順に契約を決める（FA市場の目玉から動く）
  fas.sort((a,b)=>{const ra=a.kind==="bat"?perfBat(a.id):perfPit(a.id);const rb=b.kind==="bat"?perfBat(b.id):perfPit(b.id);return rb-ra;});
  fas.forEach(p=>{
    const perf=p.kind==="bat"?perfBat(p.id):perfPit(p.id);
    const cands=teams.filter(tm=>p.kind==="bat"?tm.batterIds.length<cfg.battersPerTeam+2:tm.pitcherIds.length<cfg.pitchersPerTeam+2);
    if(!cands.length)return;
    // 成績不振(平均以下)の選手は買い手がつきにくい→浪人(翌年も無所属)の可能性
    const desirable = p.kind==="bat"? perf>=85 : perf>=95;
    if(!desirable && rnd()<0.45){
      // 高齢 or すでに浪人経験ありなら引退、若手のみ来季持ち越し（1回だけ）
      if(p.age>=32 || p.wandered){
        p.status="retired";const base=p.kind==="bat"?career.bat[p.id]:career.pit[p.id];const merged=mergeInit(p,base);hall.push({id:p.id,name:p.name,kind:p.kind,role:p.role,age:p.age,career:merged});
        news.retire.push(`${p.name}（${p.age}歳）契約決まらず引退`);
      } else {
        p.wandered=true; news.fa.push(`${p.name} 契約決まらず（来季持ち越し）`);
      }
      return;
    }
    p.wandered=false;
    // 好成績選手ほど強豪が競り勝つ：魅力度(勝率)で重み付け抽選。不振選手は弱いチーム優先
    let pool2;
    if(desirable){
      pool2=cands.map(tm=>({tm,w:Math.pow(teamStrength[tm.id]+0.3, 2)})); // 強豪ほど重い
    } else {
      pool2=cands.map(tm=>({tm,w:Math.pow(1.3-teamStrength[tm.id], 2)})); // 弱いチームが拾う
    }
    const total=pool2.reduce((a,b)=>a+b.w,0);let r=rnd()*total;let dest=pool2[0].tm;
    for(const c of pool2){ r-=c.w; if(r<=0){dest=c.tm;break;} }
    addToTeam(dest,p);p.status="active";p.teamId=dest.id;p.yearsOnTeam=0;p.order=0;
    if(p.kind==="pit"&&p.role==="SP")p.rotation=Math.min(6,dest.pitcherIds.filter(id=>pool[id]?.role==="SP").length);
    if(news.fa.length<50)news.fa.push(`→ ${p.name}（${p.kind==="bat"?"野手":"投手"}）${dest.name}と契約${desirable?" ★目玉":""}`);
  });

  // トレード：球団間で選手を交換（NPB年15-30件）。控え〜準主力を1対1で交換
  const tradePerf=(p)=>{const m=p.kind==="bat"?perfBat(p.id):perfPit(p.id);return m;};
  let tradeCount=0; const tradeTarget=15+Math.floor(rnd()*12); // 年15-26件
  let tradeGuard=0;
  while(tradeCount<tradeTarget && tradeGuard<200){
    tradeGuard++;
    const t1=teams[Math.floor(rnd()*teams.length)], t2=teams[Math.floor(rnd()*teams.length)];
    if(t1.id===t2.id)continue;
    const kind=rnd()<0.5?"bat":"pit";
    const list1=(kind==="bat"?t1.batterIds:t1.pitcherIds).map(id=>pool[id]).filter(p=>p&&p.status==="active"&&!p.foreign&&p.yearsOnTeam>=1);
    const list2=(kind==="bat"?t2.batterIds:t2.pitcherIds).map(id=>pool[id]).filter(p=>p&&p.status==="active"&&!p.foreign&&p.yearsOnTeam>=1);
    if(list1.length<12||list2.length<12)continue; // 枠に余裕がある時だけ
    // 控え〜準主力（perf中位以下）を対象に、同程度の選手を交換
    const pick=(list)=>{const sorted=list.slice().sort((a,b)=>tradePerf(a)-tradePerf(b));const poolC=sorted.slice(0,Math.max(1,Math.floor(sorted.length*0.6)));return poolC[Math.floor(rnd()*poolC.length)];};
    const p1=pick(list1), p2=pick(list2);
    if(!p1||!p2)continue;
    if(Math.abs(tradePerf(p1)-tradePerf(p2))>40)continue; // 同程度の力量のみ
    // 交換実行
    removeFromTeam(teams,p1);removeFromTeam(teams,p2);
    addToTeam(t2,p1);p1.teamId=t2.id;p1.yearsOnTeam=0;p1.order=0;if(p1.kind==="pit"&&p1.role==="SP")p1.rotation=Math.min(6,t2.pitcherIds.filter(id=>pool[id]?.role==="SP").length);
    addToTeam(t1,p2);p2.teamId=t1.id;p2.yearsOnTeam=0;p2.order=0;if(p2.kind==="pit"&&p2.role==="SP")p2.rotation=Math.min(6,t1.pitcherIds.filter(id=>pool[id]?.role==="SP").length);
    if(news.trade.length<40)news.trade.push(`${p1.name}（${t1.name}）⇔ ${p2.name}（${t2.name}）`);
    tradeCount++;
  }
  teams.forEach((tm,ti)=>{
    (draftPicks?.bat?.[ti]||[]).forEach(pk=>{const b={...makeBatter(18+Math.floor(rnd()*3),0),name:pk.name,contact:pk.contact,power:pk.power,eye:pk.eye,speed:pk.speed};b.teamId=tm.id;pool[b.id]=b;tm.batterIds.push(b.id);news.draft.push(`${tm.name} 野手 ${b.name}`);});
    (draftPicks?.pit?.[ti]||[]).forEach(pk=>{const p={...makePitcher(18+Math.floor(rnd()*3),pk.role),name:pk.name,stuff:pk.stuff,control:pk.control,stamina:pk.stamina,pitches:pk.pitches||["直球","スライダー"]};p.teamId=tm.id;pool[p.id]=p;tm.pitcherIds.push(p.id);news.draft.push(`${tm.name} 投手 ${p.name}`);});
  });
  Object.values(pool).forEach(p=>{if(p.status==="active"){agePlayer(p);p.yearsOnTeam++;}else if(p.status==="overseas"){agePlayer(p);}});
  assignFarm(teams,pool); // 能力・起用に応じて1軍/2軍を再編成
  return news;}
function mergeInit(p,career){const init=p.init||{};if(p.kind==="bat"){const c=career||emptyCareerBat();const m={};Object.keys(emptyCareerBat()).forEach(k=>m[k]=(c[k]||0)+(init[k]||0));m.name=p.name;m.id=p.id;return m;}const c=career||emptyCareerPit();const m={};Object.keys(emptyCareerPit()).forEach(k=>m[k]=(c[k]||0)+(init[k]||0));m.name=p.name;m.id=p.id;m.role=p.role;return m;}
function summ(p,m){return p.kind==="bat"?`通算${m.HR}本`:`通算${m.W}勝`;}
function removeFromTeam(teams,p){const tm=teams.find(t=>t.id===p.teamId);if(!tm)return;tm.batterIds=tm.batterIds.filter(id=>id!==p.id);tm.pitcherIds=tm.pitcherIds.filter(id=>id!==p.id);p.teamId=null;}
function addToTeam(tm,p){if(p.kind==="bat")tm.batterIds.push(p.id);else tm.pitcherIds.push(p.id);}
function genDraftProspects(batPer=3,pitPer=2,numTeams=NUM_TEAMS){const bat=[],pit=[];for(let t=0;t<numTeams;t++){bat.push([]);pit.push([]);}
  const prospectVal=()=>clamp(50+Math.round(randn()*13),28,85); // 新人は素質ばらつき。育成で伸びる
  for(let t=0;t<numTeams;t++){
    for(let i=0;i<batPer;i++){const b=makeBatter(18);["contact","power","eye","speed"].forEach(f=>b[f]=prospectVal());bat[t].push({name:b.name,contact:b.contact,power:b.power,eye:b.eye,speed:b.speed});}
    for(let i=0;i<pitPer;i++){const p=makePitcher(18);["stuff","control","stamina"].forEach(f=>p[f]=prospectVal());pit[t].push({name:p.name,stuff:p.stuff,control:p.control,stamina:p.stamina,role:p.role,pitches:p.pitches});}
  }return {bat,pit};}

const f3=(x)=>isFinite(x)?x.toFixed(3).replace(/^0/,""):".000";
const f2=(x)=>isFinite(x)?x.toFixed(2):"0.00";

// ============================================================
// IO（球種・打順・ローテも保存）
//  T,チーム名
//  B,名前,年齢,ミート,パワー,選球眼,走力,打順(0-9),初期HR,初期安打,初期年数
//  P,名前,年齢,球威,制球,スタミナ,先発/救援,ローテ番手(1-5/99=抑),球種|区切り,初期勝,初期K,初期年数
// ============================================================
function exportLeague(state){const lines=[];state.teams.forEach(tm=>{lines.push(`T,${tm.name},${tm.league==="pacific"?"P":"C"}`);
  tm.batterIds.map(id=>state.pool[id]).forEach(b=>{const i=b.init||{};lines.push(`B,${b.name},${b.age},${valToRank(b.contact)},${valToRank(b.power)},${valToRank(b.eye)},${valToRank(b.speed)},${b.order||0},${i.HR||0},${i.H||0},${i.seasons||0},${b.foreign?"F":"J"},${b.farm?"2":"1"}`);});
  tm.pitcherIds.map(id=>state.pool[id]).forEach(p=>{const i=p.init||{};lines.push(`P,${p.name},${p.age},${valToRank(p.stuff)},${valToRank(p.control)},${valToRank(p.stamina)},${p.role==="SP"?"先発":"救援"},${p.rotation||0},${(p.pitches||[]).join("|")},${i.W||0},${i.SO||0},${i.seasons||0},${p.foreign?"F":"J"},${p.farm?"2":"1"}`);});});
  return lines.join("\n");}
function importLeague(text){UID=0;const teams=[];const pool={};let cur=null;const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  lines.forEach(line=>{const c=line.split(",").map(s=>s.trim());const tag=c[0]?.toUpperCase();
    if(tag==="T"){const lg=(c[2]||"").toUpperCase()==="P"?"pacific":(((c[2]||"").toUpperCase()==="C")?"central":null);cur={id:teams.length,name:c[1]||`Team ${teams.length+1}`,league:lg,batterIds:[],pitcherIds:[]};teams.push(cur);}
    else if(tag==="B"&&cur){const b=makeBatter(Number(c[2])||25,Number(c[7])||0);b.name=c[1]||randName();b.contact=parseAbility(c[3]);b.power=parseAbility(c[4]);b.eye=parseAbility(c[5]);b.speed=parseAbility(c[6]);b.init={...emptyCareerBat(),HR:Number(c[8])||0,H:Number(c[9])||0,seasons:Number(c[10])||0,games:(Number(c[10])||0)*120,AB:(Number(c[9])||0)*3,PA:Math.round((Number(c[9])||0)*3.4),RBI:Math.round((Number(c[8])||0)*2.5)};b.foreign=(c[11]||"").toUpperCase()==="F";b.farm=(c[12]||"")==="2";b.teamId=cur.id;b.yearsOnTeam=Math.min(b.age-21,Number(c[10])||0);pool[b.id]=b;cur.batterIds.push(b.id);}
    else if(tag==="P"&&cur){const role=(c[6]||"").includes("救")||((c[6]||"").toUpperCase()==="RP")?"RP":"SP";const p=makePitcher(Number(c[2])||25,role,Number(c[7])||0);p.name=c[1]||randName();p.stuff=parseAbility(c[3]);p.control=parseAbility(c[4]);p.stamina=parseAbility(c[5]);const pt=(c[8]||"").split("|").map(s=>s.trim()).filter(Boolean);if(pt.length)p.pitches=pt;p.init={...emptyCareerPit(),W:Number(c[9])||0,SO:Number(c[10])||0,seasons:Number(c[11])||0,G:(Number(c[11])||0)*25,IP:(Number(c[10])||0)*1.1};p.foreign=(c[12]||"").toUpperCase()==="F";p.farm=(c[13]||"")==="2";p.teamId=cur.id;p.yearsOnTeam=Math.min(p.age-21,Number(c[11])||0);pool[p.id]=p;cur.pitcherIds.push(p.id);}});
  teams.forEach(tm=>{while(tm.batterIds.length<BATTERS_PER_TEAM){const b=makeBatter(22,0);b.teamId=tm.id;pool[b.id]=b;tm.batterIds.push(b.id);}while(tm.pitcherIds.length<PITCHERS_PER_TEAM){const p=makePitcher(22,tm.pitcherIds.length<5?"SP":"RP");p.teamId=tm.id;pool[p.id]=p;tm.pitcherIds.push(p.id);}});
  // リーグ未指定なら前半セ・後半パ。farm未指定があればassignFarmで再編
  teams.forEach((tm,i)=>{if(!tm.league)tm.league=i<teams.length/2?"central":"pacific";});
  const anyFarmSet=Object.values(pool).some(p=>p.farm);
  if(!anyFarmSet) assignFarm(teams,pool);
  return {teams,pool,career:{bat:{},pit:{}},hall:[]};}

function saveState(state,year){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({v:SCHEMA_VERSION,state,year,UID}));}catch(e){}}
// 読込時マイグレーション：欠けたフィールドを補完し、旧データでも壊れないようにする
function migrate(d){
  if(!d||!d.state)return null;
  const st=d.state;
  // pool内の各選手に新フィールドを補完
  if(st.pool){
    Object.values(st.pool).forEach(p=>{
      if(p.foreign===undefined) p.foreign=false;
      if(p.farm===undefined) p.farm=false;
      if(p.kind==="pit"&&!Array.isArray(p.pitches)) p.pitches=["直球","スライダー"];
      if(p.kind==="bat"&&p.order===undefined) p.order=0;
      if(p.kind==="pit"&&p.rotation===undefined) p.rotation=0;
      if(!p.init) p.init = p.kind==="bat"?emptyCareerBat():emptyCareerPit();
      if(p.status===undefined) p.status="active";
    });
  }
  if(!st.career) st.career={bat:{},pit:{}};
  if(!st.hall) st.hall=[];
  if(!st.config) st.config={...DEFAULT_CONFIG};
  // 旧データにleagueが無ければ前半セ・後半パで割り当て、farm未設定なら再編
  if(st.teams){ let needFarm=false; st.teams.forEach((tm,i)=>{ if(!tm.league) tm.league=i<st.teams.length/2?"central":"pacific"; });
    Object.values(st.pool||{}).forEach(p=>{ if(p.farm===undefined) needFarm=true; });
    if(needFarm) assignFarm(st.teams,st.pool); }
  return d;
}
function loadState(){try{const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return null;let d=JSON.parse(raw);d=migrate(d);if(!d)return null;UID=d.UID||0;return d;}catch(e){return null;}}

// ============================================================
// Google スプレッドシート同期（GAS Web App へPOST）
// 表シート(見る用) ＋ _backup(復元用JSON) を1回の送信で書く
// ============================================================
function getSheetUrl(){try{return localStorage.getItem(SHEET_URL_KEY)||"";}catch(e){return"";}}
function setSheetUrl(u){try{localStorage.setItem(SHEET_URL_KEY,u);}catch(e){}}

// 表シート用の2次元配列を組み立てる（先頭行ヘッダ）
function buildViewTables(state,result){
  const tables={};
  // 順位表（resultがあるときのみ）
  if(result){
    const allR=Object.values(result.record).map(r=>({...r,PCT:r.W/Math.max(1,r.W+r.L),DIFF:r.RS-r.RA}));
    const mk=(lg)=>allR.filter(r=>r.league===lg).sort((a,b)=>b.PCT-a.PCT).map((r,i)=>[i+1,r.name,r.W,r.L,Number(f3(r.PCT)),r.RS,r.RA,r.DIFF]);
    const lnC=state.config?.leagueNameC||LEAGUE_NAMES.central;const lnP=state.config?.leagueNameP||LEAGUE_NAMES.pacific;
    tables.standings=[["リーグ","順位","チーム","勝","敗","勝率","得点","失点","得失"],
      ...mk("central").map(row=>[lnC,...row]),
      ...mk("pacific").map(row=>[lnP,...row])];
    if(result.japanSeries){ tables.standings.push(["","","","","","","","",""]); tables.standings.push(["日本一",result.japanSeries.champion,`${result.japanSeries.centralChamp} ${result.japanSeries.wC}-${result.japanSeries.wP} ${result.japanSeries.pacificChamp}`,"","","","","",""]); }
    const bat=computeBatting(Object.values(result.batStat)).sort((a,b)=>b.HR-a.HR);
    tables.batting=[["選手","チーム","G","PA","AB","H","2B","3B","HR","RBI","SB","BB","SO","AVG","OBP","SLG","OPS","ISO","wOBA","wRC+"],...bat.map(s=>[s.name,s.team,s.games,s.PA,s.AB,s.H,s._2B,s._3B,s.HR,s.RBI,s.SB,s.BB,s.SO,Number(f3(s.AVG)),Number(f3(s.OBP)),Number(f3(s.SLG)),Number(f3(s.OPS)),Number(f3(s.ISO)),Number(f3(s.wOBA)),s.wRCp])];
    const pit=computePitching(Object.values(result.pitStat)).sort((a,b)=>b.W-a.W);
    tables.pitching=[["選手","チーム","役割","G","W","L","SV","IP","SO","BB","ERA","FIP","WHIP","K/9","BB/9"],...pit.map(s=>[s.name,s.team,s.role==="SP"?"先発":"救援",s.G,s.W,s.L,s.SV,Number(s.IP.toFixed(1)),s.SO,s.BB,Number(f2(s.ERA)),Number(f2(s.FIP)),Number(f2(s.WHIP)),Number(f2(s.K9)),Number(f2(s.BB9))])];
  }
  // 通算（initマージ込み）
  const cbRows=Object.values(state.career.bat).map(c=>{const p=state.pool[c.id];const init=p?.init||emptyCareerBat();const m={...c};Object.keys(emptyCareerBat()).forEach(k=>{if(k!=="seasons")m[k]=(c[k]||0)+(init[k]||0);});m.seasons=c.seasons+(init.seasons||0);return m;});
  const cb=computeBatting(cbRows).sort((a,b)=>b.HR-a.HR);
  tables.careerBat=[["選手","年数","G","PA","AB","H","HR","RBI","SB","AVG","OPS","wOBA","wRC+"],...cb.map(s=>[s.name,s.seasons,s.games,s.PA,s.AB,s.H,s.HR,s.RBI,s.SB,Number(f3(s.AVG)),Number(f3(s.OPS)),Number(f3(s.wOBA)),s.wRCp])];
  const cpRows=Object.values(state.career.pit).map(c=>{const p=state.pool[c.id];const init=p?.init||emptyCareerPit();const m={...c};Object.keys(emptyCareerPit()).forEach(k=>{if(k!=="seasons")m[k]=(c[k]||0)+(init[k]||0);});m.seasons=c.seasons+(init.seasons||0);return m;});
  const cp=computePitching(cpRows).sort((a,b)=>b.W-a.W);
  tables.careerPit=[["選手","年数","G","W","L","SV","IP","SO","ERA","FIP","WHIP"],...cp.map(s=>[s.name,s.seasons,s.G,s.W,s.L,s.SV,Number(s.IP.toFixed(1)),s.SO,Number(f2(s.ERA)),Number(f2(s.FIP)),Number(f2(s.WHIP))])];
  // 殿堂
  const hb=computeBatting(state.hall.filter(h=>h.kind==="bat"&&h.career).map(h=>({...h.career,name:h.name,retireAge:h.age}))).sort((a,b)=>b.HR-a.HR);
  tables.hallBat=[["選手","引退年齢","G","H","HR","RBI","SB","AVG","OPS","wRC+"],...hb.map(s=>[s.name,s.retireAge,s.games,s.H,s.HR,s.RBI,s.SB,Number(f3(s.AVG)),Number(f3(s.OPS)),s.wRCp])];
  const hp=computePitching(state.hall.filter(h=>h.kind==="pit"&&h.career).map(h=>({...h.career,name:h.name,retireAge:h.age,role:h.role}))).sort((a,b)=>b.W-a.W);
  tables.hallPit=[["選手","引退年齢","G","W","L","SV","IP","SO","ERA","FIP"],...hp.map(s=>[s.name,s.retireAge,s.G,s.W,s.L,s.SV,Number(s.IP.toFixed(1)),s.SO,Number(f2(s.ERA)),Number(f2(s.FIP))])];
  return tables;
}

// GASへ送信。CORS回避のため text/plain で投げる
async function syncToSheet(url,state,year,result){
  const raw=JSON.stringify({v:SCHEMA_VERSION,state,year,UID});
  const view=buildViewTables(state,result);
  const body=JSON.stringify({raw,view});
  const res=await fetch(url,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body});
  return res.json();
}
// GASから復元用JSONを取得
async function fetchFromSheet(url){
  const res=await fetch(url,{method:"GET"});
  const data=await res.json();
  if(!data.ok||!data.raw) throw new Error(data.error||"バックアップが空です");
  let d=JSON.parse(data.raw); d=migrate(d); if(!d)throw new Error("データ形式が不正");
  UID=d.UID||0; return d;
}

// ============================================================
// UI
// ============================================================
export default function App(){
  const [state,setState]=useState(()=>{const l=loadState();if(l)return l.state;const {teams,pool}=initLeague();return {teams,pool,career:{bat:{},pit:{}},hall:[],config:{...DEFAULT_CONFIG}};});
  const [year,setYear]=useState(()=>{const l=loadState();return l?l.year:1;});
  const [result,setResult]=useState(null);
  const [news,setNews]=useState(null);
  const [tab,setTab]=useState("setup");
  const [statTab,setStatTab]=useState("standings");
  const [editTeam,setEditTeam]=useState(0);
  const [logFilter,setLogFilter]=useState("");
  const [draft,setDraft]=useState(null);
  const [pendingSeason,setPendingSeason]=useState(null);
  const [showInit,setShowInit]=useState(false);
  const [useRank,setUseRank]=useState(true);
  const [ioOpen,setIoOpen]=useState(false);
  const [ioText,setIoText]=useState("");
  const [pitchEdit,setPitchEdit]=useState(null); // 球種編集中の投手id
  const [sheetUrl,setSheetUrlState]=useState(()=>getSheetUrl());
  const [sheetOpen,setSheetOpen]=useState(false);
  const [syncMsg,setSyncMsg]=useState("");
  const [syncing,setSyncing]=useState(false);

  useEffect(()=>{saveState(state,year);},[state,year]);
  const cloneState=(s)=>JSON.parse(JSON.stringify(s));

  // シーズン実行：年は進めない。結果を表示し、何度でも再実行できる
  const runOne=()=>{const r=simulateSeason(state.teams,state.pool);setResult(r);setPendingSeason(r);setNews(null);setTab("results");setStatTab("standings");};
  // 結果に納得→ドラフト画面へ進む
  const proceedToDraft=()=>{if(!pendingSeason){alert("先にシーズンを実行してください");return;}const cfg=state.config||DEFAULT_CONFIG;setDraft(genDraftProspects(cfg.draftBat,cfg.draftPit,state.teams.length));setTab("draft");};
  // ドラフト確定→ここで初めて年が進む
  const confirmDraft=()=>{const s=cloneState(state);accumulate(s.career,pendingSeason);const n=processOffseason(s,pendingSeason,draft);setState(s);setNews(n);setYear(y=>y+1);setDraft(null);setPendingSeason(null);setTab("results");setStatTab("news");};
  const updateProspect=(kind,ti,pi,field,val)=>setDraft(d=>{const nd={bat:d.bat.map(a=>a.map(o=>({...o}))),pit:d.pit.map(a=>a.map(o=>({...o})))};nd[kind][ti][pi][field]=field==="name"||field==="role"?val:(useRank?rankToVal(val):Number(val));return nd;});
  const resetAll=()=>{if(!confirm("世界をリセットします。よろしいですか？"))return;const {teams,pool}=initLeague();setState({teams,pool,career:{bat:{},pit:{}},hall:[]});setResult(null);setNews(null);setYear(1);setDraft(null);setPendingSeason(null);setTab("setup");};

  const updatePlayer=(id,field,val)=>setState(s=>{const pool={...s.pool};pool[id]={...pool[id],[field]:(field==="name"||field==="role")?val:Number(val)};return{...s,pool};});
  const updateAbility=(id,field,rankOrNum)=>setState(s=>{const pool={...s.pool};pool[id]={...pool[id],[field]:useRank?rankToVal(rankOrNum):clamp(Number(rankOrNum),1,99)};return{...s,pool};});
  const updateInit=(id,field,val)=>setState(s=>{const pool={...s.pool};const p={...pool[id]};p.init={...p.init,[field]:Number(val)};pool[id]=p;return{...s,pool};});
  const updateTeamName=(id,name)=>setState(s=>({...s,teams:s.teams.map(t=>t.id===id?{...t,name}:t)}));
  const applyOverall=(id,rank)=>setState(s=>{const pool={...s.pool};const p={...pool[id]};const base=RANK_VAL[rank]??63;(p.kind==="bat"?["contact","power","eye","speed"]:["stuff","control","stamina"]).forEach(f=>p[f]=clamp(base+Math.round(randn()*8),1,99));pool[id]=p;return{...s,pool};});
  const togglePitch=(id,pt)=>setState(s=>{const pool={...s.pool};const p={...pool[id]};const set=new Set(p.pitches||[]);set.has(pt)?set.delete(pt):set.add(pt);p.pitches=PITCH_TYPES.filter(x=>set.has(x));pool[id]=p;return{...s,pool};});

  const addBatter=(teamId)=>setState(s=>{const b=makeBatter(22,0);b.teamId=teamId;const pool={...s.pool,[b.id]:b};const teams=s.teams.map(t=>t.id===teamId?{...t,batterIds:[...t.batterIds,b.id]}:t);return{...s,pool,teams};});
  const removeBatter=(teamId,bid)=>setState(s=>{const pool={...s.pool};delete pool[bid];const teams=s.teams.map(t=>t.id===teamId?{...t,batterIds:t.batterIds.filter(x=>x!==bid)}:t);return{...s,pool,teams};});
  const addPitcher=(teamId)=>setState(s=>{const p=makePitcher(22,"RP",0);p.teamId=teamId;const pool={...s.pool,[p.id]:p};const teams=s.teams.map(t=>t.id===teamId?{...t,pitcherIds:[...t.pitcherIds,p.id]}:t);return{...s,pool,teams};});
  const removePitcher=(teamId,pid)=>setState(s=>{const pool={...s.pool};delete pool[pid];const teams=s.teams.map(t=>t.id===teamId?{...t,pitcherIds:t.pitcherIds.filter(x=>x!==pid)}:t);return{...s,pool,teams};});
  const updateConfig=(field,val)=>setState(s=>({...s,config:{...(s.config||DEFAULT_CONFIG),[field]:field==="leagueNameC"||field==="leagueNameP"?val:Number(val)}}));

  const doImport=()=>{if(!ioText.trim()){alert("テキストが空です");return;}if(!confirm("現在の世界を上書きしてインポートします。よろしいですか？"))return;const ns=importLeague(ioText);setState(ns);setYear(1);setResult(null);setNews(null);setIoOpen(false);setTab("setup");};
  const doExport=()=>{setIoText(exportLeague(state));setIoOpen(true);};

  const saveSheetUrl=(u)=>{setSheetUrlState(u);setSheetUrl(u);};
  const doSheetBackup=async()=>{
    if(!sheetUrl){setSyncMsg("先にGAS WebアプリURLを設定してください");return;}
    setSyncing(true);setSyncMsg("バックアップ中…");
    try{const r=await syncToSheet(sheetUrl,state,year,result);
      setSyncMsg(r.ok?`✓ 保存しました（${new Date().toLocaleTimeString()}）`:`失敗：${r.error||"不明なエラー"}`);
    }catch(e){setSyncMsg("失敗："+String(e.message||e));}
    setSyncing(false);
  };
  const doSheetRestore=async()=>{
    if(!sheetUrl){setSyncMsg("先にGAS WebアプリURLを設定してください");return;}
    if(!confirm("シートのバックアップで現在の世界を上書きします。よろしいですか？"))return;
    setSyncing(true);setSyncMsg("復元中…");
    try{const d=await fetchFromSheet(sheetUrl);setState(d.state);setYear(d.year||1);setResult(null);setNews(null);setPendingSeason(null);
      setSyncMsg("✓ 復元しました");setTab("setup");
    }catch(e){setSyncMsg("失敗："+String(e.message||e));}
    setSyncing(false);
  };

  const battingStats=useMemo(()=>result?computeBatting(Object.values(result.batStat)):[],[result]);
  const pitchingStats=useMemo(()=>result?computePitching(Object.values(result.pitStat)):[],[result]);
  const careerBatRows=useMemo(()=>{const rows=Object.values(state.career.bat).map(c=>{const p=state.pool[c.id];const init=p?.init||emptyCareerBat();const m={...c};Object.keys(emptyCareerBat()).forEach(k=>{if(k!=="seasons")m[k]=(c[k]||0)+(init[k]||0);});m.seasons=c.seasons+(init.seasons||0);return m;});return computeBatting(rows);},[state]);
  const careerPitRows=useMemo(()=>{const rows=Object.values(state.career.pit).map(c=>{const p=state.pool[c.id];const init=p?.init||emptyCareerPit();const m={...c};Object.keys(emptyCareerPit()).forEach(k=>{if(k!=="seasons")m[k]=(c[k]||0)+(init[k]||0);});m.seasons=c.seasons+(init.seasons||0);return m;});return computePitching(rows);},[state]);
  const standings=useMemo(()=>{if(!result)return{central:[],pacific:[]};const all=Object.values(result.record).map(r=>({...r,PCT:r.W/Math.max(1,r.W+r.L),DIFF:r.RS-r.RA}));return{central:all.filter(r=>r.league==="central").sort((a,b)=>b.PCT-a.PCT),pacific:all.filter(r=>r.league==="pacific").sort((a,b)=>b.PCT-a.PCT)};},[result]);
  const hallBat=useMemo(()=>computeBatting(state.hall.filter(h=>h.kind==="bat"&&h.career).map(h=>({...h.career,name:h.name,retireAge:h.age}))),[state]);
  const hallPit=useMemo(()=>computePitching(state.hall.filter(h=>h.kind==="pit"&&h.career).map(h=>({...h.career,name:h.name,retireAge:h.age,role:h.role}))),[state]);

  const AbilityInput=({id,field,value})=>useRank?<select style={S.rankIn} value={valToRank(value)} onChange={e=>updateAbility(id,field,e.target.value)}>{RANKS.map(r=><option key={r} value={r}>{r}</option>)}</select>:<input style={S.numIn} type="number" value={value} onChange={e=>updateAbility(id,field,e.target.value)} />;

  return (
    <div style={S.page}>
      <style>{CSS}</style>
      <header style={S.header}><div style={S.logo}>◆ PHANTOM LEAGUE</div><div style={S.sub}>妄想選手名鑑 · {GAMES}試合 · {state.teams.length}球団 · {year-1>=1?`第${year-1}シーズン終了`:"開幕前"}</div></header>
      <nav style={S.nav}>
        <button style={tab==="setup"?S.navBtnA:S.navBtn} onClick={()=>setTab("setup")}>SETUP</button>
        <button style={tab==="results"?S.navBtnA:S.navBtn} onClick={()=>result&&setTab("results")} disabled={!result}>RESULTS</button>
        <button style={S.runBtn} onClick={runOne}>{pendingSeason?"↻ 同じ年を再実行":"▶ シーズン実行"}</button>
        {pendingSeason && <button style={S.proceedBtn} onClick={proceedToDraft}>オフへ進む ▶</button>}
        <button style={S.ioBtn} onClick={()=>{setIoOpen(true);setIoText("");}}>⇩ 取込</button>
        <button style={S.ioBtn} onClick={doExport}>⇧ 書出</button>
        <button style={S.sheetBtn} onClick={()=>setSheetOpen(o=>!o)}>📊 シート</button>
        <button style={S.resetBtn} onClick={resetAll}>RESET</button>
      </nav>

      {ioOpen && (<div style={S.ioWrap}>
        <div style={S.note}>1行1選手。能力はA〜Gでも1〜99でもOK。球種は<code style={S.code}>|</code>区切り。<br/>
          <code style={S.code}>T,チーム名</code><br/>
          <code style={S.code}>B,名前,年齢,ミート,パワー,選球眼,走力,打順(0-9),初期HR,初期安打,初期年数,F/J(外国人)</code><br/>
          <code style={S.code}>P,名前,年齢,球威,制球,スタミナ,先発/救援,ローテ番手(1-5/99=抑),球種|区切り,初期勝,初期K,初期年数,F/J</code>
        </div>
        <textarea style={S.ioText} value={ioText} onChange={e=>setIoText(e.target.value)} placeholder={`T,東京ファントムズ\nB,山田太郎,28,A,S,B,C,4,210,1450,7,J\nP,スミス,31,S,B,B,先発,1,直球|フォーク|スライダー,98,1320,9,F`} />
        <div style={{display:"flex",gap:8,marginTop:8}}><button style={S.confirmBtnSm} onClick={doImport}>この内容で取込（上書き）</button><button style={S.resetBtn} onClick={()=>setIoOpen(false)}>閉じる</button></div>
      </div>)}

      {sheetOpen && (<div style={S.ioWrap}>
        <div style={S.note}>Googleスプレッドシートにバックアップ。GASを「ウェブアプリ」としてデプロイし、その<b style={{color:accent}}>Web App URL</b>を貼ってください（手順は配布の .gs ファイル参照）。表シート(見る用)と _backup(復元用JSON)が書き込まれます。</div>
        <input style={S.urlIn} value={sheetUrl} onChange={e=>saveSheetUrl(e.target.value.trim())} placeholder="https://script.google.com/macros/s/XXXX/exec" />
        <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap",alignItems:"center"}}>
          <button style={S.confirmBtnSm} disabled={syncing} onClick={doSheetBackup}>⇧ シートへバックアップ</button>
          <button style={S.ioBtn} disabled={syncing} onClick={doSheetRestore}>⇩ シートから復元</button>
          <button style={S.resetBtn} onClick={()=>setSheetOpen(false)}>閉じる</button>
          {syncMsg && <span style={S.syncMsg}>{syncMsg}</span>}
        </div>
      </div>)}

      {tab==="setup" && (<div style={S.panel}>
        <div style={S.controls}>
          <label style={S.toggle}><input type="checkbox" checked={useRank} onChange={e=>setUseRank(e.target.checked)} /> ランク表示(S〜G)</label>
          <label style={S.toggle}><input type="checkbox" checked={showInit} onChange={e=>setShowInit(e.target.checked)} /> 初期通算成績を編集</label>
        </div>
        <div style={S.settingsBox}>
          <div style={S.settRow}>
            <span style={S.settLabel}>リーグ名：</span>
            <input style={S.settIn} value={state.config?.leagueNameC||DEFAULT_CONFIG.leagueNameC} onChange={e=>updateConfig("leagueNameC",e.target.value)} placeholder="セントラル" />
            <input style={S.settIn} value={state.config?.leagueNameP||DEFAULT_CONFIG.leagueNameP} onChange={e=>updateConfig("leagueNameP",e.target.value)} placeholder="パシフィック" />
          </div>
          <div style={S.settRow}>
            <span style={S.settLabel}>選手枠（野手/投手）：</span>
            <input style={S.settNumIn} type="number" min={9} max={50} value={state.config?.battersPerTeam||DEFAULT_CONFIG.battersPerTeam} onChange={e=>updateConfig("battersPerTeam",e.target.value)} />
            <input style={S.settNumIn} type="number" min={6} max={40} value={state.config?.pitchersPerTeam||DEFAULT_CONFIG.pitchersPerTeam} onChange={e=>updateConfig("pitchersPerTeam",e.target.value)} />
            <span style={S.settHint}>1軍上限: {ROSTER_28}人（NPB準拠）</span>
          </div>
          <div style={S.settRow}>
            <span style={S.settLabel}>ドラフト指名数（野手/投手）：</span>
            <input style={S.settNumIn} type="number" min={0} max={10} value={state.config?.draftBat||DEFAULT_CONFIG.draftBat} onChange={e=>updateConfig("draftBat",e.target.value)} />
            <input style={S.settNumIn} type="number" min={0} max={10} value={state.config?.draftPit||DEFAULT_CONFIG.draftPit} onChange={e=>updateConfig("draftPit",e.target.value)} />
            <span style={S.settHint}>球団ごとの指名人数。選手枠を下回った分は自動補充</span>
          </div>
        </div>
        <div style={S.note}><b style={{color:accent}}>打順</b>=1〜9が基本スタメン(0は控え)。<b style={{color:accent}}>ローテ</b>=1〜5が先発順、99が抑え。毎試合ゆらぎで多少入れ替わります。<b style={{color:green}}>外</b>=外国人(同時出場{FOREIGN_ON_FIELD}人まで)。<b style={{color:green}}>2軍</b>=ファーム(試合に出ないが若手は能力が伸びやすい/オフに自動入替)。投手名の「球種」ボタンで持ち球をチェック。チーム名の右でリーグを選べます。</div>
        <div style={S.teamTabs}>{state.teams.map(t=><button key={t.id} onClick={()=>setEditTeam(t.id)} style={editTeam===t.id?S.teamTabA:S.teamTab}>{t.name}</button>)}</div>
        {state.teams.filter(t=>t.id===editTeam).map(t=>(<div key={t.id}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <input style={S.teamName} value={t.name} onChange={e=>updateTeamName(t.id,e.target.value)} />
            <select style={S.leagueSel} value={t.league||"central"} onChange={e=>setState(s=>({...s,teams:s.teams.map(x=>x.id===t.id?{...x,league:e.target.value}:x)}))}>
              <option value="central">{state.config?.leagueNameC||LEAGUE_NAMES.central}</option><option value="pacific">{state.config?.leagueNameP||LEAGUE_NAMES.pacific}</option>
            </select>
          </div>
          <div style={S.sectionLabel}>野手 — 打順 / 年齢 / ミート / パワー / 選球眼 / 走力 / 総合{showInit?" ｜ HR/安/年":""}</div>
          <div style={S.scrollX}><table style={S.editTable}><tbody>
            <tr style={S.editHead}><td>打順</td><td>名前</td><td>外</td><td>2軍</td><td>年</td><td>ミート</td><td>パワー</td><td>選球</td><td>走力</td><td>総合</td>{showInit&&<><td>HR</td><td>安</td><td>年</td></>}<td></td></tr>
            {t.batterIds.map(id=>state.pool[id]).filter(Boolean).slice().sort((a,b)=>(a.order||99)-(b.order||99)).map(b=>(<tr key={b.id}>
              <td><input style={S.ageIn} type="number" min={0} max={9} value={b.order||0} onChange={e=>updatePlayer(b.id,"order",e.target.value)} /></td>
              <td><input style={S.nameIn} value={b.name} onChange={e=>updatePlayer(b.id,"name",e.target.value)} /></td>
              <td><input type="checkbox" checked={!!b.foreign} onChange={e=>setState(s=>{const pool={...s.pool};pool[b.id]={...pool[b.id],foreign:e.target.checked};return{...s,pool};})} /></td>
              <td><input type="checkbox" checked={!!b.farm} onChange={e=>setState(s=>{const pool={...s.pool};pool[b.id]={...pool[b.id],farm:e.target.checked};return{...s,pool};})} /></td>
              <td><input style={S.ageIn} type="number" value={b.age} onChange={e=>updatePlayer(b.id,"age",e.target.value)} /></td>
              <td><AbilityInput id={b.id} field="contact" value={b.contact} /></td><td><AbilityInput id={b.id} field="power" value={b.power} /></td><td><AbilityInput id={b.id} field="eye" value={b.eye} /></td><td><AbilityInput id={b.id} field="speed" value={b.speed} /></td>
              <td><select style={S.overallIn} value="" onChange={e=>e.target.value&&applyOverall(b.id,e.target.value)}><option value="">一括</option>{RANKS.map(r=><option key={r} value={r}>{r}</option>)}</select></td>
              {showInit&&[["HR"],["H"],["seasons"]].map(([f])=><td key={f}><input style={S.initIn} type="number" value={b.init?.[f]||0} onChange={e=>updateInit(b.id,f,e.target.value)} /></td>)}
              <td><button style={S.delBtn} onClick={()=>removeBatter(t.id,b.id)} title="削除">×</button></td>
            </tr>))}
          </tbody></table></div>
          <button style={S.addBtn} onClick={()=>addBatter(t.id)}>＋ 野手追加</button>
          <div style={S.sectionLabel}>投手 — ローテ / 年齢 / 球威 / 制球 / スタミナ / 役割 / 球種 / 総合{showInit?" ｜ 勝/K/年":""}</div>
          <div style={S.scrollX}><table style={S.editTable}><tbody>
            <tr style={S.editHead}><td>ロ</td><td>名前</td><td>外</td><td>2軍</td><td>年</td><td>球威</td><td>制球</td><td>スタ</td><td>役</td><td>球種</td><td>総合</td>{showInit&&<><td>勝</td><td>K</td><td>年</td></>}<td></td></tr>
            {t.pitcherIds.map(id=>state.pool[id]).filter(Boolean).slice().sort((a,b)=>(a.rotation||999)-(b.rotation||999)).map(p=>(<tr key={p.id}>
              <td><input style={S.ageIn} type="number" value={p.rotation||0} onChange={e=>updatePlayer(p.id,"rotation",e.target.value)} /></td>
              <td><input style={S.nameIn} value={p.name} onChange={e=>updatePlayer(p.id,"name",e.target.value)} /></td>
              <td><input type="checkbox" checked={!!p.foreign} onChange={e=>setState(s=>{const pool={...s.pool};pool[p.id]={...pool[p.id],foreign:e.target.checked};return{...s,pool};})} /></td>
              <td><input type="checkbox" checked={!!p.farm} onChange={e=>setState(s=>{const pool={...s.pool};pool[p.id]={...pool[p.id],farm:e.target.checked};return{...s,pool};})} /></td>
              <td><input style={S.ageIn} type="number" value={p.age} onChange={e=>updatePlayer(p.id,"age",e.target.value)} /></td>
              <td><AbilityInput id={p.id} field="stuff" value={p.stuff} /></td><td><AbilityInput id={p.id} field="control" value={p.control} /></td><td><AbilityInput id={p.id} field="stamina" value={p.stamina} /></td>
              <td><select style={S.numIn} value={p.role} onChange={e=>updatePlayer(p.id,"role",e.target.value)}><option value="SP">先</option><option value="RP">救</option></select></td>
              <td><button style={S.pitchBtn} onClick={()=>setPitchEdit(pitchEdit===p.id?null:p.id)}>{(p.pitches||[]).length}球種▾</button></td>
              <td><select style={S.overallIn} value="" onChange={e=>e.target.value&&applyOverall(p.id,e.target.value)}><option value="">一括</option>{RANKS.map(r=><option key={r} value={r}>{r}</option>)}</select></td>
              {showInit&&[["W"],["SO"],["seasons"]].map(([f])=><td key={f}><input style={S.initIn} type="number" value={p.init?.[f]||0} onChange={e=>updateInit(p.id,f,e.target.value)} /></td>)}
              <td><button style={S.delBtn} onClick={()=>removePitcher(t.id,p.id)} title="削除">×</button></td>
            </tr>))}
          </tbody></table></div>
          <button style={S.addBtn} onClick={()=>addPitcher(t.id)}>＋ 投手追加</button>
          {pitchEdit && state.pool[pitchEdit] && (<div style={S.pitchPanel}>
            <div style={S.pitchTitle}>{state.pool[pitchEdit].name} の持ち球（多いほど・落ちる球があるほど抑え力UP）</div>
            <div style={S.pitchGrid}>{PITCH_TYPES.map(pt=>{const on=(state.pool[pitchEdit].pitches||[]).includes(pt);return <label key={pt} style={on?S.pitchChipOn:S.pitchChip}><input type="checkbox" checked={on} onChange={()=>togglePitch(pitchEdit,pt)} style={{display:"none"}} />{pt}{BREAKING_K.includes(pt)?"◎":""}</label>;})}</div>
            <button style={S.resetBtn} onClick={()=>setPitchEdit(null)}>閉じる</button>
          </div>)}
        </div>))}
      </div>)}

      {tab==="draft" && draft && (<div style={S.panel}>
        <div style={S.draftHead}>第{year}シーズン ドラフト候補</div>
        <div style={S.note}>空き枠に上から入団。{useRank?"ランク":"数値"}で編集。新人の打順/ローテ/球種は入団後にSETUPで調整できます。</div>
        {state.teams.map((t,ti)=>(<div key={t.id} style={S.draftTeam}><div style={S.draftTeamName}>{t.name}</div><div style={S.scrollX}><table style={S.editTable}><tbody>
          <tr style={S.editHead}><td>新人野手</td><td>ミート</td><td>パワー</td><td>選球</td><td>走力</td></tr>
          {draft.bat[ti].map((b,pi)=>(<tr key={pi}><td><input style={S.nameIn} value={b.name} onChange={e=>updateProspect("bat",ti,pi,"name",e.target.value)} /></td>{["contact","power","eye","speed"].map(f=><td key={f}>{useRank?<select style={S.rankIn} value={valToRank(b[f])} onChange={e=>updateProspect("bat",ti,pi,f,e.target.value)}>{RANKS.map(r=><option key={r} value={r}>{r}</option>)}</select>:<input style={S.numIn} type="number" value={b[f]} onChange={e=>updateProspect("bat",ti,pi,f,e.target.value)} />}</td>)}</tr>))}
          <tr style={S.editHead}><td>新人投手</td><td>球威</td><td>制球</td><td>スタ</td><td>役</td></tr>
          {draft.pit[ti].map((p,pi)=>(<tr key={pi}><td><input style={S.nameIn} value={p.name} onChange={e=>updateProspect("pit",ti,pi,"name",e.target.value)} /></td>{["stuff","control","stamina"].map(f=><td key={f}>{useRank?<select style={S.rankIn} value={valToRank(p[f])} onChange={e=>updateProspect("pit",ti,pi,f,e.target.value)}>{RANKS.map(r=><option key={r} value={r}>{r}</option>)}</select>:<input style={S.numIn} type="number" value={p[f]} onChange={e=>updateProspect("pit",ti,pi,f,e.target.value)} />}</td>)}<td><select style={S.numIn} value={p.role} onChange={e=>updateProspect("pit",ti,pi,"role",e.target.value)}><option value="SP">先</option><option value="RP">救</option></select></td></tr>))}
        </tbody></table></div></div>))}
        <button style={S.confirmBtn} onClick={confirmDraft}>✓ ドラフト確定 → オフシーズン処理</button>
      </div>)}

      {tab==="results" && result && (<div style={S.panel}>
        {pendingSeason && <div style={S.rerunBar}>
          <span>第{year}シーズンの結果です。納得いくまで<b style={{color:accent}}>「同じ年を再実行」</b>でやり直せます。確定するには<b style={{color:green}}>「オフへ進む」</b>。</span>
          <span style={{display:"flex",gap:8}}><button style={S.rerunBtnSm} onClick={runOne}>↻ 再実行</button><button style={S.proceedBtnSm} onClick={proceedToDraft}>オフへ進む ▶</button></span>
        </div>}
        <div style={S.statTabs}>{[["standings","順位表"],["batting","打撃(今季)"],["pitching","投手(今季)"],["careerBat","通算打撃"],["careerPit","通算投手"],["hallBat","殿堂(打者)"],["hallPit","殿堂(投手)"],["news","オフ移籍"],["log","全試合"]].map(([k,l])=>(<button key={k} onClick={()=>setStatTab(k)} style={statTab===k?S.statTabA:S.statTab}>{l}</button>))}</div>
        {statTab==="standings" && (<div>
          {result.japanSeries && <div style={S.jsBox}>
            <div style={S.jsTitle}>🏆 日本シリーズ</div>
            <div style={S.jsChamp}>{result.japanSeries.champion} 日本一！</div>
            <div style={S.jsSub}>{result.japanSeries.centralChamp}（セ）{result.japanSeries.wC} − {result.japanSeries.wP} {result.japanSeries.pacificChamp}（パ）</div>
            <div style={S.jsLog}>{result.japanSeries.log.map((l,i)=><span key={i} style={S.jsLogRow}>{l}</span>)}</div>
          </div>}
          {[["central",state.config?.leagueNameC||LEAGUE_NAMES.central],["pacific",state.config?.leagueNameP||LEAGUE_NAMES.pacific]].map(([lg,label])=>(
            <div key={lg} style={{marginBottom:18}}>
              <div style={S.leagueLabel}>{label}・リーグ</div>
              <table style={S.statTable}><tbody><tr style={S.th}><td>順位</td><td style={S.tl}>チーム</td><td>勝</td><td>敗</td><td>勝率</td><td>得点</td><td>失点</td><td>得失</td></tr>
              {standings[lg].map((r,i)=>(<tr key={r.id} style={i%2?S.tr2:S.tr}><td>{i+1}{i===0?" ◆":""}</td><td style={S.tl}>{r.name}</td><td>{r.W}</td><td>{r.L}</td><td>{f3(r.PCT)}</td><td>{r.RS}</td><td>{r.RA}</td><td style={{color:r.DIFF>=0?green:"#e06666"}}>{r.DIFF>=0?"+":""}{r.DIFF}</td></tr>))}
              </tbody></table>
            </div>
          ))}
        </div>)}
        {(statTab==="batting"||statTab==="careerBat"||statTab==="hallBat") && (<div style={S.scrollX}><table style={S.statTable}><tbody><tr style={S.th}>{["選手",statTab==="batting"?"チーム":(statTab==="hallBat"?"引退":"年数"),"G","PA","AB","H","2B","3B","HR","RBI","SB","BB","SO","AVG","OBP","SLG","OPS","ISO","wOBA","wRC+"].map((h,i)=><td key={h} style={i<2?S.tl:{}}>{h}</td>)}</tr>{(statTab==="batting"?battingStats:(statTab==="hallBat"?hallBat:careerBatRows)).sort((a,b)=>b.HR-a.HR).map((s,i)=>(<tr key={(s.id||s.name)+i} style={i%2?S.tr2:S.tr}><td style={S.tl}>{s.name}</td><td style={S.tl}>{statTab==="batting"?s.team:(statTab==="hallBat"?`${s.retireAge}歳`:`${s.seasons}年`)}</td><td>{s.games}</td><td>{s.PA}</td><td>{s.AB}</td><td>{s.H}</td><td>{s._2B}</td><td>{s._3B}</td><td style={S.hl}>{s.HR}</td><td>{s.RBI}</td><td>{s.SB}</td><td>{s.BB}</td><td>{s.SO}</td><td>{f3(s.AVG)}</td><td>{f3(s.OBP)}</td><td>{f3(s.SLG)}</td><td style={S.hl}>{f3(s.OPS)}</td><td>{f3(s.ISO)}</td><td>{f3(s.wOBA)}</td><td style={S.hl}>{s.wRCp}</td></tr>))}</tbody></table></div>)}
        {(statTab==="pitching"||statTab==="careerPit"||statTab==="hallPit") && (<div style={S.scrollX}><table style={S.statTable}><tbody><tr style={S.th}>{["選手",statTab==="pitching"?"チーム":(statTab==="hallPit"?"引退":"年数"),"役割","G","W","L","SV","IP","SO","BB","ERA","FIP","WHIP","K/9","BB/9"].map((h,i)=><td key={h} style={i<2?S.tl:{}}>{h}</td>)}</tr>{(statTab==="pitching"?pitchingStats:(statTab==="hallPit"?hallPit:careerPitRows)).sort((a,b)=>b.W-a.W).map((s,i)=>(<tr key={(s.id||s.name)+i} style={i%2?S.tr2:S.tr}><td style={S.tl}>{s.name}</td><td style={S.tl}>{statTab==="pitching"?s.team:(statTab==="hallPit"?`${s.retireAge}歳`:`${s.seasons}年`)}</td><td>{s.role==="SP"?"先発":"救援"}</td><td>{s.G}</td><td style={S.hl}>{s.W}</td><td>{s.L}</td><td>{s.SV}</td><td>{s.IP.toFixed(1)}</td><td>{s.SO}</td><td>{s.BB}</td><td style={S.hl}>{f2(s.ERA)}</td><td style={S.hl}>{f2(s.FIP)}</td><td>{f2(s.WHIP)}</td><td>{f2(s.K9)}</td><td>{f2(s.BB9)}</td></tr>))}</tbody></table></div>)}
        {statTab==="news" && news && (<div style={S.newsWrap}>{[["retire","◆ 引退"],["overseas","◆ 海外挑戦"],["return","◆ 国内復帰"],["release","◆ 戦力外（成績準拠）"],["trade","◆ トレード"],["fa","◆ FA・契約"],["draft","◆ ドラフト入団"]].map(([k,l])=>(<div key={k}><div style={S.newsHead}>{l}（{news[k].length}）</div>{news[k].length?news[k].map((t,i)=><div key={i} style={S.newsRow}>{t}</div>):<div style={S.newsRowDim}>なし</div>}</div>))}</div>)}
        {statTab==="news" && !news && <div style={S.note}>まだオフシーズンを消化していません。</div>}
        {statTab==="log" && (<div><input style={S.filterIn} placeholder="チーム名でフィルタ…" value={logFilter} onChange={e=>setLogFilter(e.target.value)} /><div style={S.logWrap}>{result.gameLog.filter(g=>!logFilter||g.home.includes(logFilter)||g.away.includes(logFilter)).map((g,i)=>(<div key={i} style={S.logRow}><span style={S.logNo}>#{g.gameNo}</span><span style={{...S.logTeam,fontWeight:g.winner===g.away?700:400,color:g.winner===g.away?accent:"#aaa"}}>{g.away}</span><span style={S.logScore}>{g.awayRuns} - {g.homeRuns}</span><span style={{...S.logTeam,fontWeight:g.winner===g.home?700:400,color:g.winner===g.home?accent:"#aaa"}}>{g.home}</span></div>))}</div></div>)}
      </div>)}
    </div>
  );
}

const CSS=`@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Oswald:wght@300;400;600&family=Roboto+Mono:wght@400;500&display=swap');
*{box-sizing:border-box}body{margin:0}input,select,button,textarea{font-family:'Roboto Mono',monospace}
::-webkit-scrollbar{height:8px;width:8px}::-webkit-scrollbar-thumb{background:#3a4a3a;border-radius:4px}`;
const ink="#0d1410",panel="#13201a",line="#26382c",accent="#f5d76e",green="#5fd35f";
const S={
  page:{minHeight:"100vh",background:`radial-gradient(circle at 30% 0%, #1a2a20 0%, ${ink} 70%)`,color:"#d8e0d8",fontFamily:"'Oswald',sans-serif",paddingBottom:60},
  header:{padding:"28px 20px 16px",textAlign:"center",borderBottom:`2px solid ${line}`},
  logo:{fontFamily:"'Bebas Neue',sans-serif",fontSize:46,letterSpacing:4,color:accent,lineHeight:1,textShadow:"0 0 18px rgba(245,215,110,.3)"},
  sub:{fontSize:13,letterSpacing:2,color:"#7a8a7a",marginTop:6,textTransform:"uppercase"},
  nav:{display:"flex",gap:8,padding:"14px 20px",alignItems:"center",flexWrap:"wrap",justifyContent:"center"},
  navBtn:{background:"transparent",color:"#8a9a8a",border:`1px solid ${line}`,padding:"8px 18px",letterSpacing:2,cursor:"pointer",fontSize:13},
  navBtnA:{background:accent,color:ink,border:`1px solid ${accent}`,padding:"8px 18px",letterSpacing:2,cursor:"pointer",fontWeight:700,fontSize:13},
  runBtn:{background:green,color:ink,border:"none",padding:"8px 20px",letterSpacing:1,cursor:"pointer",fontWeight:700,fontSize:13,borderRadius:2},
  proceedBtn:{background:"#6ec6e0",color:ink,border:"none",padding:"8px 16px",letterSpacing:1,cursor:"pointer",fontWeight:700,fontSize:13,borderRadius:2},
  rerunBar:{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",background:"#1a2a20",border:`1px solid ${line}`,borderRadius:4,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#c0c8c0"},
  rerunBtnSm:{background:"transparent",color:accent,border:`1px solid ${accent}`,padding:"6px 14px",cursor:"pointer",fontSize:12,whiteSpace:"nowrap"},
  proceedBtnSm:{background:"#6ec6e0",color:ink,border:"none",padding:"6px 14px",cursor:"pointer",fontWeight:700,fontSize:12,whiteSpace:"nowrap"},
  ioBtn:{background:"#2a3a30",color:"#a8d8b0",border:`1px solid ${line}`,padding:"8px 12px",cursor:"pointer",fontSize:12},
  sheetBtn:{background:"#2a3340",color:"#a8c8e0",border:`1px solid #3a4a5a`,padding:"8px 12px",cursor:"pointer",fontSize:12},
  urlIn:{width:"100%",background:"#0f1a14",border:`1px solid ${line}`,color:"#d8e0d8",padding:"8px 10px",fontSize:12,fontFamily:"'Roboto Mono',monospace"},
  syncMsg:{fontSize:12,color:"#a8d8b0"},
  leagueSel:{background:panel,border:`1px solid ${accent}`,color:accent,padding:"6px 8px",fontSize:13,fontWeight:600},
  leagueLabel:{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:accent,letterSpacing:2,margin:"4px 0 6px",borderBottom:`1px solid ${line}`,paddingBottom:4},
  jsBox:{background:"linear-gradient(135deg,#1a2a20,#13201a)",border:`2px solid ${accent}`,borderRadius:6,padding:"16px 18px",marginBottom:18,textAlign:"center"},
  jsTitle:{fontSize:13,color:"#a8d8b0",letterSpacing:2},
  jsChamp:{fontFamily:"'Bebas Neue',sans-serif",fontSize:34,color:accent,letterSpacing:2,margin:"4px 0",textShadow:"0 0 18px rgba(245,215,110,.4)"},
  jsSub:{fontSize:14,color:"#d8e0d8",marginBottom:8},
  jsLog:{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center"},
  jsLogRow:{fontSize:11,color:"#8a9a8a",fontFamily:"'Roboto Mono',monospace"},
  resetBtn:{background:"transparent",color:"#a06666",border:`1px solid #5a3a3a`,padding:"8px 14px",cursor:"pointer",fontSize:12},
  ioWrap:{maxWidth:1150,margin:"0 auto 10px",padding:"14px 16px",background:panel,border:`1px solid ${line}`,borderRadius:4},
  code:{color:"#a8d8b0",fontSize:11,fontFamily:"'Roboto Mono',monospace"},
  ioText:{width:"100%",minHeight:160,background:"#0f1a14",border:`1px solid ${line}`,color:"#d8e0d8",padding:10,fontSize:12,fontFamily:"'Roboto Mono',monospace",lineHeight:1.5},
  confirmBtnSm:{background:green,color:ink,border:"none",padding:"8px 18px",fontWeight:700,fontSize:13,cursor:"pointer",borderRadius:3},
  panel:{maxWidth:1150,margin:"10px auto",padding:"0 16px"},
  controls:{display:"flex",gap:18,marginBottom:6,flexWrap:"wrap"},
  note:{fontSize:12,color:"#7a8a7a",margin:"6px 0 12px",lineHeight:1.7},
  toggle:{fontSize:12,color:"#a8d8b0",display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer"},
  teamTabs:{display:"flex",flexWrap:"wrap",gap:4,marginBottom:14},
  teamTab:{background:panel,color:"#8a9a8a",border:`1px solid ${line}`,padding:"5px 12px",cursor:"pointer",fontSize:12},
  teamTabA:{background:line,color:accent,border:`1px solid ${accent}`,padding:"5px 12px",cursor:"pointer",fontSize:12,fontWeight:600},
  teamName:{background:"transparent",border:"none",borderBottom:`2px solid ${accent}`,color:accent,fontSize:28,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:2,padding:"4px 0",marginBottom:10,width:"100%"},
  sectionLabel:{fontSize:12,color:"#7a8a7a",letterSpacing:1,margin:"16px 0 6px"},
  editTable:{borderCollapse:"collapse",fontSize:13,whiteSpace:"nowrap"},
  editHead:{color:"#7a8a7a",fontSize:11,letterSpacing:1},
  nameIn:{background:panel,border:`1px solid ${line}`,color:"#d8e0d8",padding:"5px 8px",width:96},
  ageIn:{background:panel,border:`1px solid ${line}`,color:"#d8e0d8",padding:"5px 4px",width:40,textAlign:"center"},
  numIn:{background:panel,border:`1px solid ${line}`,color:"#d8e0d8",padding:"5px 4px",width:48,textAlign:"center"},
  rankIn:{background:panel,border:`1px solid ${line}`,color:accent,padding:"5px 4px",width:48,textAlign:"center",fontWeight:600},
  overallIn:{background:"#1a2a20",border:`1px solid #3a5a40`,color:green,padding:"5px 2px",width:48,textAlign:"center",fontSize:11},
  initIn:{background:"#0f1a14",border:`1px solid #2a3a30`,color:"#a8d8b0",padding:"5px 3px",width:50,textAlign:"center"},
  pitchBtn:{background:"#1a2a20",border:`1px solid #3a5a40`,color:green,padding:"5px 6px",fontSize:11,cursor:"pointer",whiteSpace:"nowrap"},
  pitchPanel:{marginTop:12,padding:14,background:panel,border:`1px solid ${green}`,borderRadius:4},
  pitchTitle:{color:"#a8d8b0",fontSize:13,marginBottom:10},
  pitchGrid:{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12},
  pitchChip:{background:"#0f1a14",border:`1px solid ${line}`,color:"#8a9a8a",padding:"6px 12px",fontSize:12,cursor:"pointer",borderRadius:20},
  pitchChipOn:{background:green,border:`1px solid ${green}`,color:ink,padding:"6px 12px",fontSize:12,cursor:"pointer",borderRadius:20,fontWeight:700},
  draftHead:{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:accent,letterSpacing:2,marginTop:8},
  draftTeam:{borderTop:`1px solid ${line}`,paddingTop:10,marginTop:10},
  draftTeamName:{color:"#a8d8b0",fontSize:15,letterSpacing:1,marginBottom:4},
  confirmBtn:{marginTop:20,background:green,color:ink,border:"none",padding:"12px 28px",fontWeight:700,fontSize:15,letterSpacing:1,cursor:"pointer",borderRadius:3,width:"100%"},
  statTabs:{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"},
  statTab:{background:panel,color:"#8a9a8a",border:`1px solid ${line}`,padding:"7px 12px",cursor:"pointer",fontSize:12,letterSpacing:1},
  statTabA:{background:line,color:accent,border:`1px solid ${accent}`,padding:"7px 12px",cursor:"pointer",fontSize:12,letterSpacing:1,fontWeight:600},
  scrollX:{overflowX:"auto"},
  statTable:{width:"100%",borderCollapse:"collapse",fontSize:13,fontFamily:"'Roboto Mono',monospace",whiteSpace:"nowrap"},
  th:{background:"#1c2c22",color:accent,fontSize:11,letterSpacing:1,textAlign:"center",fontFamily:"'Oswald',sans-serif"},
  tl:{textAlign:"left",paddingLeft:8},tr:{textAlign:"center"},tr2:{textAlign:"center",background:"rgba(255,255,255,.025)"},
  hl:{color:accent,fontWeight:500},
  filterIn:{background:panel,border:`1px solid ${line}`,color:"#d8e0d8",padding:"8px 12px",width:"100%",maxWidth:280,marginBottom:12},
  logWrap:{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:6},
  logRow:{display:"flex",alignItems:"center",gap:8,background:panel,border:`1px solid ${line}`,padding:"8px 10px",fontSize:13,fontFamily:"'Roboto Mono',monospace"},
  logNo:{color:"#5a6a5a",fontSize:11,width:34},logTeam:{flex:1,fontSize:12},logScore:{color:"#fff",fontWeight:600},
  newsWrap:{fontSize:14,columns:2,columnGap:24},
  newsHead:{color:accent,fontSize:15,letterSpacing:1,margin:"14px 0 6px",breakAfter:"avoid"},
  newsRow:{padding:"5px 8px",borderBottom:`1px solid ${line}`,color:"#c0c8c0",fontSize:12,fontFamily:"'Roboto Mono',monospace",breakInside:"avoid"},
  newsRowDim:{padding:"5px 8px",color:"#5a6a5a",fontSize:12},
  settingsBox:{background:"#0f1a14",border:`1px solid ${line}`,borderRadius:4,padding:"10px 14px",marginBottom:10,display:"flex",flexDirection:"column",gap:8},
  settRow:{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"},
  settLabel:{fontSize:12,color:"#7a8a7a",whiteSpace:"nowrap"},
  settIn:{background:panel,border:`1px solid ${line}`,color:accent,padding:"5px 8px",fontSize:13,width:120},
  settNumIn:{background:panel,border:`1px solid ${line}`,color:"#d8e0d8",padding:"5px 6px",fontSize:13,width:56,textAlign:"center"},
  settHint:{fontSize:11,color:"#5a7a5a"},
  addBtn:{marginTop:6,background:"#1a2a20",border:`1px solid ${green}`,color:green,padding:"5px 14px",fontSize:12,cursor:"pointer",borderRadius:2},
  delBtn:{background:"transparent",border:`1px solid #5a3a3a`,color:"#a06060",padding:"3px 7px",fontSize:11,cursor:"pointer",lineHeight:1},
};
