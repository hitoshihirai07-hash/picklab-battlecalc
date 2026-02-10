


// BDC New Standalone v5e (clean core, single-pass compute)
const RANKS = Array.from({length:13}, (_,i)=>i-6);
function fillRanks(sel){ sel.innerHTML = RANKS.map(v=>`<option value="${v}" ${v===0?'selected':''}>${v}</option>`).join(''); }
function stageMult(n){ return n>=0 ? (2+n)/2 : 2/(2+(-n)); }

// Natures (JP)
const NATURES = [
  {name:'まじめ', up:'', down:''},
  {name:'いじっぱり', up:'攻撃', down:'特攻'},
  {name:'ようき', up:'素早さ', down:'特攻'},
  {name:'ひかえめ', up:'特攻', down:'攻撃'},
  {name:'おくびょう', up:'素早さ', down:'攻撃'},
  {name:'ずぶとい', up:'防御', down:'攻撃'},
  {name:'しんちょう', up:'特防', down:'特攻'},
  {name:'わんぱく', up:'防御', down:'特攻'},
  {name:'おだやか', up:'特防', down:'攻撃'},
  {name:'れいせい', up:'特攻', down:'素早さ'},
  {name:'ゆうかん', up:'攻撃', down:'素早さ'},
  {name:'のんき', up:'防御', down:'素早さ'},
  {name:'なまいき', up:'特防', down:'素早さ'},
  {name:'むじゃき', up:'素早さ', down:'特防'},
  {name:'せっかち', up:'素早さ', down:'防御'},
  {name:'うっかりや', up:'特攻', down:'特防'},
  {name:'おっとり', up:'特攻', down:'防御'},
  {name:'やんちゃ', up:'攻撃', down:'特防'},
  {name:'さみしがり', up:'攻撃', down:'防御'},
  {name:'てれや', up:'', down:''},
  {name:'きまぐれ', up:'', down:''},
  {name:'がんばりや', up:'', down:''},
  {name:'すなお', up:'', down:''},
  {name:'おとなしい', up:'特防', down:'攻撃'}
];
function natureMult(natureName, statJP){
  const n = NATURES.find(n=>n.name===natureName);
  if(!n) return 1.0;
  if(n.up===statJP) return 1.1;
  if(n.down===statJP) return 0.9;
  return 1.0;
}
function statFromEV(base, iv, ev, lvl, natureName, statJP){
  if(statJP==='HP'){
    if(base===1) return 1;
    return Math.floor(((2*base + iv + Math.floor(ev/4)) * lvl)/100) + lvl + 10;
  }else{
    const raw = Math.floor(((2*base + iv + Math.floor(ev/4)) * lvl)/100) + 5;
    return Math.floor(raw * natureMult(natureName, statJP));
  }
}

// Moves / Pokedex
const MOVES = [];
function loadMoves(){
  return fetch('moves.csv').then(r=>r.ok?r.text():Promise.reject()).then(t=>{
    const lines=t.trim().split(/\r?\n/);
    const head = lines.shift().split(',');
    const idx = Object.fromEntries(head.map((h,i)=>[h.trim(), i]));
    lines.forEach(line=>{
      const cols=line.split(',');
      MOVES.push({
        name: cols[idx['name']].trim(),
        type: cols[idx['type']].trim(),
        category: cols[idx['category']].trim(),
        power: Number(cols[idx['power']])||0,
        hits: (cols[idx['hits']]||'1').trim(),
        alwaysCrit: (cols[idx['alwaysCrit']]||'').trim().toUpperCase()==='TRUE'
      });
    
    window.MOVE_NAMES = MOVES.map(x=>x.name);
});
  }).catch(_=>{
    [
      {name:'げきりん',type:'ドラゴン',category:'物理',power:120,hits:'1',alwaysCrit:false},
      {name:'ストーンエッジ',type:'いわ',category:'物理',power:100,hits:'1',alwaysCrit:false},
      {name:'ねずみざん',type:'ノーマル',category:'物理',power:20,hits:'1～10',alwaysCrit:false},
      {name:'すいりゅうれんだ',type:'みず',category:'物理',power:25,hits:'3',alwaysCrit:true},
      {name:'タキオンカッター',type:'はがね',category:'特殊',power:50,hits:'2',alwaysCrit:true},
      {name:'テラバースト',type:'ノーマル',category:'特殊',power:80,hits:'1',alwaysCrit:false}
    ].forEach(m=>MOVES.push(m));
  });
}
function getMoveByNameJP(name){ return MOVES.find(m=>m.name===name) || null; }

const POKEDEX = [];

// --- Regulation (from Simulation) ---
const REG_CSV_KEY = "PICKLAB_REG_CSV";
const REG_ENABLED_KEY = "PICKLAB_REG_ENABLED";
const DEFAULT_REG_URL = "/regulation.csv";

function _parseBool(v){
  const s = String(v ?? "").trim().toLowerCase();
  return (s === "true" || s === "1" || s === "yes" || s === "y" || s === "on" || s === "〇" || s === "○");
}
function _splitCsvLine(line){
  const out = [];
  let cur = "";
  let q = false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(q){
      if(ch === '"'){
        if(line[i+1] === '"'){ cur += '"'; i++; }
        else q=false;
      }else cur += ch;
    }else{
      if(ch === '"') q=true;
      else if(ch === ','){ out.push(cur); cur=""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}
function _norm(s){ return String(s||"").trim(); }

async function _loadRegCsvText(){
  try{
    const enabled = _parseBool(localStorage.getItem(REG_ENABLED_KEY));
    if(!enabled) return null;
    const raw = localStorage.getItem(REG_CSV_KEY);
    if(raw && raw.trim().length) return raw;
  }catch{}
  try{
    const res = await fetch(DEFAULT_REG_URL, {cache:"no-cache"});
    if(!res.ok) return null;
    return await res.text();
  }catch{
    return null;
  }
}

async function _getAllowedNos(){
  const text = await _loadRegCsvText();
  if(!text) return null; // regulation not enabled / unavailable
  const lines = String(text||"").replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n").filter(l=>l.trim().length);
  if(!lines.length) return null;
  const header = _splitCsvLine(lines[0]).map(h=>_norm(h));
  const headerNorm = header.map(h=>_norm(h).toLowerCase());
  const idx = (name) => headerNorm.indexOf(_norm(name).toLowerCase());
  const idxNo = idx("no")>=0 ? idx("no") : idx("No");
  const idxAllow = (idx("allow")>=0 ? idx("allow") : (idx("採用")>=0 ? idx("採用") : (idx("レギュ")>=0 ? idx("レギュ") : header.length-1)));
  const allowed = new Set();
  for(let i=1;i<lines.length;i++){
    const cols = _splitCsvLine(lines[i]);
    const allow = _parseBool(cols[idxAllow]);
    if(!allow) continue;
    let no = null;
    if(idxNo>=0 && cols[idxNo]){
      const n = parseInt(cols[idxNo],10);
      if(!isNaN(n)) no = n;
    }
    if(no!==null) allowed.add(no);
  }
  return allowed.size ? allowed : new Set(); // if empty allow-list, treat as empty (filter to none)
}

function loadPokemonMaster(){
  return fetch('pokemon_master.json').then(r=>r.json()).then(async arr=>{
    arr.forEach(row=>POKEDEX.push(row));
    let names;
    try{
      const allowedNos = await _getAllowedNos();
      const rows = (allowedNos===null) ? POKEDEX : POKEDEX.filter(p=>allowedNos.has(Number(p.No)));
      names = Array.from(new Set(rows.map(p=>p.名前))).sort((a,b)=>a.localeCompare(b,'ja'));
    }catch{
      names = Array.from(new Set(POKEDEX.map(p=>p.名前))).sort((a,b)=>a.localeCompare(b,'ja'));
    }
    const dl = document.getElementById('pkmList');
    if(dl){ dl.innerHTML = names.map(n=>`<option value="${n}">`).join(''); }
  }).catch(_=>{});
}
function findPokeByNameJP(nm){ return POKEDEX.find(p=>p.名前===nm) || null; }
function getPokemonByNameJP(name){ return findPokeByNameJP(name); }


// Type utilities (TYPES, TYPE_CHART loaded from assets/types.js)
function effTypeMod(moveType, t1, t2){
  let mod = 1;
  const row = TYPE_CHART[moveType];
  if(row){
    if(t1 && (row[t1] !== undefined)) mod *= row[t1];
    if(t2 && (row[t2] !== undefined)) mod *= row[t2];
  }
  return mod;
}
function stabMod(moveType, teraType, atkTypes){
  // 同タイプテラは2.0、片方一致は1.5、どちらも不一致は1.0
  const hasNative = (atkTypes||[]).includes(moveType);
  const hasTera = (!!teraType) && (moveType === teraType);
  if(hasNative && hasTera) return 2.0;
  if(hasNative || hasTera) return 1.5;
  return 1.0;
}

// KO text utilities
function ceilDiv(a,b){ return Math.floor((a + b - 1) / b); }
function koText(dMin, dMax, hp){
  if(dMax<=0) return '（ダメージなし）';
  const best = ceilDiv(hp, dMax); // 最短回数
  if(dMin<=0) return `乱数${best}〜∞発`;
  const worst = ceilDiv(hp, dMin); // 最長回数
  if(best === worst) return `確定${best}発`;
  return `乱数${best}〜${worst}発`;
}

function applyScreens(dmg, isSpecial, screens){
  const wall = isSpecial? screens.lightscreen : screens.reflect;
  return wall ? Math.floor(dmg*2/3) : dmg;
}

// Core calc
function calcOne(att, def, move, opts){
  const lvl = att.level||50;
  let isSpecial = (move.category==='特殊');
  let mType = move.type;
  let power = move.power;
  const isCrit = (opts.forceCrit||false) || move.alwaysCrit;

  // テラバースト
  if(move.name==='テラバースト'){
    if(att.tera){
      const atkEff = Math.floor(att.atk * stageMult(att.atkRank||0));
      const spaEff = Math.floor(att.spa * stageMult(att.spaRank||0));
      mType = att.tera;
      isSpecial = !(atkEff >= spaEff); // 攻撃優勢なら物理
      power = 80;
    }else{
      isSpecial = true;
      power = 80;
    }
  }

  const atkStat = isSpecial ? att.spa : att.atk;
  const defStat = isSpecial ? def.spd : def.def;
  const atkRank = isSpecial ? (att.spaRank||0) : (att.atkRank||0);
  const defRank = isSpecial ? (def.spdRank||0) : (def.defRank||0);

  let A = Math.floor(atkStat * stageMult(atkRank));
  let D = Math.floor(defStat * stageMult(defRank));

  const crit = isCrit ? 1.5 : 1.0;
  const stab = stabMod(mType, att.tera, att.types||[]);
  const typeEff = effTypeMod(mType, def.t1||'', def.t2||'');

  
  // 天候による威力補正
  if(opts.weather==='雨'){ if(mType==='みず') power = Math.floor(power*1.5); if(mType==='ほのお') power = Math.floor(power*0.5); }
  else if(opts.weather==='晴'){ if(mType==='ほのお') power = Math.floor(power*1.5); if(mType==='みず') power = Math.floor(power*0.5); }

  // 持ち物（攻）
  if(!isSpecial && att.item==='こだわりハチマキ') A = Math.floor(A*1.5);
  if(isSpecial  && att.item==='こだわりメガネ')   A = Math.floor(A*1.5);

  // やけど
  if(!isSpecial && opts.burn) A = Math.floor(A*0.5);

  // 天候の耐久補正
  if(opts.weather==='砂' && (def.t1==='いわ' || def.t2==='いわ') && isSpecial) D = Math.floor(D*1.5);
  if(opts.weather==='雪' && (def.t1==='こおり' || def.t2==='こおり') && !isSpecial) D = Math.floor(D*1.5);

  // 持ち物（防）
  if(isSpecial && def.item==='とつげきチョッキ') D = Math.floor(D*1.5);
const base = Math.floor(Math.floor(Math.floor(2*lvl/5+2) * power * A / D) / 50) + 2;
  let min = Math.floor(base * 0.85 * stab * typeEff * crit);
  let max = Math.floor(base * 1.00 * stab * typeEff * crit);
  // 持ち物（ダメージ倍率）
  if(att.item==='いのちのたま'){ min = Math.floor(min*1.3); max = Math.floor(max*1.3); }
  if(att.item==='たつじんのおび' && typeEff>1){ min = Math.floor(min*1.2); max = Math.floor(max*1.2); }
  if(!isSpecial && att.item==='ちからのハチマキ'){ min = Math.floor(min*1.1); max = Math.floor(max*1.1); }
  if(isSpecial  && att.item==='ものしりメガネ'){   min = Math.floor(min*1.1); max = Math.floor(max*1.1); }


  const afterMin = applyScreens(min, isSpecial, opts.screens||{});
  const afterMax = applyScreens(max, isSpecial, opts.screens||{});
  const misc = (opts.misc!=null?Number(opts.misc):1)||1;


  const hits = decideHits(move, opts);
  const sumMin = Math.floor(afterMin * misc) * hits;
  const sumMax = Math.floor(afterMax * misc) * hits;

  const hp = def.hp||1;
  return {
    min: sumMin,
    max: sumMax,
    minPct: Math.floor(sumMin*1000/hp)/10,
    maxPct: Math.floor(sumMax*1000/hp)/10,
    hits
  };
}

// Decide hits (manual selector or auto)
function decideHits(move, opts){
  const sel = (opts && opts.hitsSel) ? String(opts.hitsSel) : '自動';
  if(sel !== '自動'){
    const n = Number(sel); if(n>=1 && n<=10) return n;
  }
    // ネズミざん（Population Bomb）は自動=10回に固定
  if (move && ((move.name||'').includes('ネズミざん') || (move.name||'').includes('ねずみざん') || (move.name||'').toLowerCase().includes('population bomb'))) return 10;
const h = (move.hits||'1').trim();
  if(h.includes('～')){
    const parts = h.split('～');
    const lo = Number(parts[0])||1;
    const hi = Number(parts[1])||1;
    return Math.round((lo+hi)/2);
  }
  const fixed = Number(h)||1;
  return fixed;
}

// Read inputs (EV->stat)
function readSoloInputs(){
  const atkName = document.getElementById('atkName').value.trim();
  const defName = document.getElementById('defName').value.trim();
  const atkP = findPokeByNameJP(atkName)||{};
  const defP = findPokeByNameJP(defName)||{};
  const lvl = Number(document.getElementById('level').value)||50;
  const defLvl = Number(document.getElementById('defLevel').value)||50;
  const atkNat = document.getElementById('atkNature').value || 'まじめ';
  const defNat = document.getElementById('defNature').value || 'まじめ';
  const tera = document.getElementById('teraType').value||null;
  const hitsSel = document.getElementById('hitsSelect').value||'自動';
  const IV = 31;

  const aBase = {
    HP: Number(atkP['HP']||0),
    攻撃: Number(atkP['攻撃']||0),
    防御: Number(atkP['防御']||0),
    特攻: Number(atkP['特攻']||0),
    特防: Number(atkP['特防']||0),
    素早さ: Number(atkP['素早さ']||0)
  };
  const dBase = {
    HP: Number(defP['HP']||0),
    攻撃: Number(defP['攻撃']||0),
    防御: Number(defP['防御']||0),
    特攻: Number(defP['特攻']||0),
    特防: Number(defP['特防']||0),
    素早さ: Number(defP['素早さ']||0)
  };

  const atkEV_atk = Number(document.getElementById('atkEV_atk').value)||0;
  const atkEV_spa = Number(document.getElementById('atkEV_spa').value)||0;
  const defEV_hp  = Number(document.getElementById('defEV_hp').value)||0;
  const defEV_def = Number(document.getElementById('defEV_def').value)||0;
  const defEV_spd = Number(document.getElementById('defEV_spd').value)||0;

  const atkStat = statFromEV(aBase['攻撃']||0, IV, atkEV_atk, lvl, atkNat, '攻撃');
  const spaStat = statFromEV(aBase['特攻']||0, IV, atkEV_spa, lvl, atkNat, '特攻');
  const defHP   = statFromEV(dBase['HP']||0,  IV, defEV_hp,  defLvl, defNat, 'HP');
  const defStat = statFromEV(dBase['防御']||0,IV, defEV_def, defLvl, defNat, '防御');
  const spdStat = statFromEV(dBase['特防']||0,IV, defEV_spd, defLvl, defNat, '特防');

  return {
    att: {
      name: atkName,
      level: lvl,
      atk: atkStat||1,
      spa: spaStat||1,
      atkRank: Number(document.getElementById('atkRank').value)||0,
      spaRank: Number(document.getElementById('spaRank').value)||0,
      types: [
        document.getElementById('atkType1') ? document.getElementById('atkType1').value : (atkP['タイプ1']||''),
        document.getElementById('atkType2') ? document.getElementById('atkType2').value : (atkP['タイプ2']||'')
      ].filter(Boolean),
      tera: tera
    , item: (document.getElementById('atkItem')?document.getElementById('atkItem').value:'なし') },
    def: {
      name: defName,
      hp: defHP||1,
      def: defStat||1,
      spd: spdStat||1,
      defRank: Number(document.getElementById('defRank').value)||0,
      spdRank: Number(document.getElementById('spdRank').value)||0,
      t1: document.getElementById('defType1').value || defP['タイプ1'] || '',
      t2: document.getElementById('defType2').value || defP['タイプ2'] || ''
    , item: (document.getElementById('defItem')?document.getElementById('defItem').value:'なし') },
    opts: {
      screens: {reflect: document.getElementById('reflect').checked, lightscreen: document.getElementById('lightscreen').checked},
      forceCrit: false,
      hitsSel: hitsSel, weather: (document.getElementById('weather')?document.getElementById('weather').value:'なし'), burn: !!(document.getElementById('burn') && document.getElementById('burn').checked)
    
      , misc: (function(){var s=document.getElementById('miscSelect');var b=s?parseFloat(s.value||'1'):1;var c=document.getElementById('miscCustom');var v=c?parseFloat(c.value||''):NaN;return (v>=0.5&&v<=2)?v:b;})()},
    moves: [1,2,3,4].map(i=>document.getElementById('move'+i).value.trim()).filter(Boolean)
  };
}

function fmtLine(mvName, r){
  return `技: ${mvName}${r.hits>1?`（${r.hits}回）`:''}：${r.min}-${r.max} (${r.minPct}%-${r.maxPct}%)`;
}

function renderSolo(){
  const out = document.getElementById('soloResult');
  out.textContent = '';
  const {att, def, opts, moves} = readSoloInputs();
  const showAll = (document.getElementById('showAllMoves')?.checked)||false;
  const list = showAll ? moves : moves.slice(0,1);
  const lines = [];
  for(const name of list){
    const mv = getMoveByNameJP(name);
    if(!mv) continue;
    const res = calcOne(att, def, mv, opts);
    const ko = koText(res.min, res.max, def.hp||1);
    lines.push(`技: ${name}${res.hits>1?`（${res.hits}回）`:''}：${res.min}-${res.max} (${res.minPct}%-${res.maxPct}%) / ${ko}`);
  }
  out.textContent = lines.join('\\n');
}

// UI
function setupEVButtons(){
  document.querySelectorAll('button[data-fill]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      const id = btn.getAttribute('data-fill');
      const val = btn.getAttribute('data-val');
      const el = document.getElementById(id);
      if(el){ el.value = val; el.dispatchEvent(new Event('input',{bubbles:true})); refreshStatDisplays(); }
    });
  });
}
function setupTabs(){
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(t=>{
    t.addEventListener('click', ()=>{
      tabs.forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('view-'+t.dataset.tab).classList.add('active');
    });
  });
}
function fillNatureSelect(sel){
  sel.innerHTML = NATURES.map(n=>`<option value="${n.name}">${n.name}</option>`).join('');
}
function fillHitsSelect(sel){
  sel.innerHTML = ['自動',1,2,3,4,5,6,7,8,9,10].map(v=>`<option value="${v}">${v}</option>`).join('');
}

function setupSelectors(){
  fillRanks(document.getElementById('atkRank'));
  fillRanks(document.getElementById('defRank'));
  fillRanks(document.getElementById('spaRank'));
  fillRanks(document.getElementById('spdRank'));
  refreshStatDisplays();
  fillNatureSelect(document.getElementById('atkNature'));
  fillNatureSelect(document.getElementById('defNature'));
  fillHitsSelect(document.getElementById('hitsSelect'));
  const typeOpts = TYPES.map(t=>`<option value="${t}">${t}</option>`).join('');
  document.getElementById('defType1').innerHTML = typeOpts;
  document.getElementById('defType2').innerHTML = typeOpts;
  if(document.getElementById('atkType1')) document.getElementById('atkType1').innerHTML = typeOpts;
  if(document.getElementById('atkType2')) document.getElementById('atkType2').innerHTML = typeOpts;
  document.getElementById('teraType').innerHTML = '<option value=\"\">しない</option>' + TYPES.slice(1).map(t=>`<option value="${t}">${t}</option>`).join('');
  // items/weather (keep null-safe)
  const ai = document.getElementById('atkItem'); if(ai) ai.innerHTML = ['なし','いのちのたま','こだわりハチマキ','こだわりメガネ','たつじんのおび','ちからのハチマキ','ものしりメガネ'].map(x=>`<option value="${x}">${x}</option>`).join('');
  const di = document.getElementById('defItem'); if(di) di.innerHTML = ['なし','とつげきチョッキ'].map(x=>`<option value="${x}">${x}</option>`).join('');
  const we = document.getElementById('weather'); if(we) we.innerHTML = ['なし','雨','晴','砂','雪'].map(x=>`<option value="${x}">${x}</option>`).join('');

}

function bindNameAutoFill(){
  const defName = document.getElementById('defName');
  if(defName){
    defName.addEventListener('change', ()=>{
      const p = findPokeByNameJP(defName.value.trim());
      if(p){
        const t1Sel = document.getElementById('defType1');
        const t2Sel = document.getElementById('defType2');
        if(t1Sel){ t1Sel.value = p['タイプ1'] || ''; }
        if(t2Sel){ t2Sel.value = p['タイプ2'] || ''; }
      }
    });
  }
  const atkName = document.getElementById('atkName');
  if(atkName){
    atkName.addEventListener('change', ()=>{
      const p = findPokeByNameJP(atkName.value.trim());
      if(p){
        const t1 = document.getElementById('atkType1');
        const t2 = document.getElementById('atkType2');
        if(t1){ t1.value = p['タイプ1'] || ''; }
        if(t2){ t2.value = p['タイプ2'] || ''; }
      }
    });
  }
  const grid = document.getElementById('partyGrid');
  if(grid){
    grid.querySelectorAll('input[id$=\"name\"]').forEach(inp=>inp.setAttribute('list','pkmList'));
  }
}

function init(){
  setupTabs();
  setupEVButtons();
  setupSelectors();
  refreshStatDisplays();
  loadMoves().then(()=>{
    const dl = document.getElementById('moveList');
    if(dl){ dl.innerHTML = MOVES.map(m=>`<option value="${m.name}">`).join(''); }
    const dl2 = document.getElementById('movList');
    if(dl2){ dl2.innerHTML = MOVES.map(m=>`<option value="${m.name}">`).join(''); }
  });
  loadPokemonMaster().then(bindNameAutoFill);
  document.getElementById('calcBtn').addEventListener('click', renderSolo);

// Auto recalculation (no need to press the button)
const _soloRoot = document.getElementById('view-solo');
let _soloRaf = 0;
function _scheduleSolo(){
  if(_soloRaf) return;
  _soloRaf = requestAnimationFrame(() => {
    _soloRaf = 0;
    try{ renderSolo(); }catch(_){}
    try{ if(typeof refreshStatDisplays === 'function') refreshStatDisplays(); }catch(_){}
  });
}
if(_soloRoot){
  _soloRoot.addEventListener('input', _scheduleSolo, {passive:true});
  _soloRoot.addEventListener('change', _scheduleSolo, {passive:true});
}
// Keep the button as "manual refresh" (optional)
try{
  const cb=document.getElementById('calcBtn');
  if(cb){
    cb.textContent = '再計算';
    cb.title = '入力は自動で反映されます（手動更新も可能）';
  }
}catch(_){}

// EV sliders (sync with number inputs)
function _attachEvSlider(inputId, step=4){
  const inp = document.getElementById(inputId);
  if(!inp || inp.dataset.hasSlider) return;
  inp.dataset.hasSlider = '1';
  const wrap = document.createElement('div');
  wrap.className = 'ev-slider-wrap';
  const range = document.createElement('input');
  range.type = 'range';
  range.min = inp.min || '0';
  range.max = inp.max || '252';
  range.step = String(step);
  range.value = String(inp.value || 0);
  range.className = 'ev-slider';
  range.addEventListener('input', () => {
    inp.value = String(range.value);
    inp.dispatchEvent(new Event('input', {bubbles:true}));
  });
  inp.addEventListener('input', () => {
    range.value = String(inp.value || 0);
  });
  wrap.appendChild(range);
  // Insert slider right after the number input
  inp.insertAdjacentElement('afterend', wrap);
}
['atkEV_atk','atkEV_spa','defEV_hp','defEV_def','defEV_spd'].forEach(id => _attachEvSlider(id, 4));

// Log (snapshot + restore) inspired by shadowtag
const LOG_KEY = 'PICKLAB_BDC_LOG_V1';
function _collectSoloInputs(){
  const root = document.getElementById('view-solo');
  if(!root) return {};
  const data = {};
  root.querySelectorAll('input,select,textarea').forEach(el=>{
    if(!el.id) return;
    if(el.type === 'checkbox') data[el.id] = !!el.checked;
    else data[el.id] = el.value;
  });
  return data;
}
function _applySoloInputs(data){
  const root = document.getElementById('view-solo');
  if(!root) return;
  root.querySelectorAll('input,select,textarea').forEach(el=>{
    if(!el.id) return;
    if(!(el.id in data)) return;
    if(el.type === 'checkbox') el.checked = !!data[el.id];
    else el.value = String(data[el.id] ?? '');
  });
  _scheduleSolo();
}
function _readLogs(){
  try{
    const raw = localStorage.getItem(LOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch{ return []; }
}
function _writeLogs(arr){
  try{ localStorage.setItem(LOG_KEY, JSON.stringify(arr.slice(0, 100))); }catch{}
}
function _formatLogTitle(entry){
  const a = (entry?.inputs?.atkName || '').trim();
  const d = (entry?.inputs?.defName || '').trim();
  const m1 = (entry?.inputs?.move1 || '').trim();
  return [a,'→',d,(m1?(' / '+m1):'')].join(' ');
}
function _ensureLogUI(){
  const res = document.getElementById('soloResult');
  if(!res) return null;
  let box = document.getElementById('soloLogBox');
  if(box) return box;
  const controls = document.querySelector('#view-solo .inline-btns');
  if(controls){
    const saveBtn = document.createElement('button');
    saveBtn.id = 'saveLogBtn';
    saveBtn.className = 'btn-green';
    saveBtn.textContent = 'ログ保存';
    saveBtn.addEventListener('click', () => {
      const logs=_readLogs();
      logs.unshift({ts: Date.now(), inputs: _collectSoloInputs()});
      _writeLogs(logs);
      _renderLogList();
    });
    controls.appendChild(saveBtn);
  }
  box = document.createElement('div');
  box.id = 'soloLogBox';
  box.className = 'log-box';
  box.innerHTML = `
    <div class="log-head">
      <div class="log-title">ログ</div>
      <button class="btn-danger" id="clearLogBtn">全削除</button>
    </div>
    <div id="soloLogList" class="log-list"></div>
  `;
  res.insertAdjacentElement('afterend', box);
  box.querySelector('#clearLogBtn')?.addEventListener('click', () => {
    _writeLogs([]);
    _renderLogList();
  });
  return box;
}
function _renderLogList(){
  const box = _ensureLogUI();
  if(!box) return;
  const list = box.querySelector('#soloLogList');
  const logs = _readLogs();
  if(!logs.length){
    list.innerHTML = '<div class="log-empty">ログはまだありません（ログ保存でスナップショット）</div>';
    return;
  }
  list.innerHTML = logs.map((e,idx)=>{
    const dt = new Date(e.ts||Date.now());
    const t = dt.toLocaleString('ja-JP');
    const title = _formatLogTitle(e);
    return `<div class="log-row" data-idx="${idx}">
      <div class="log-main">
        <div class="log-row-title">${title || '(無題)'}</div>
        <div class="log-row-sub">${t}</div>
      </div>
      <div class="log-actions">
        <button class="btn-accent" data-act="restore">復元</button>
        <button class="btn-danger" data-act="del">削除</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.log-row').forEach(row=>{
    row.addEventListener('click', (ev)=>{
      const idx = Number(row.dataset.idx);
      const act = ev.target?.dataset?.act;
      const logs=_readLogs();
      const entry=logs[idx];
      if(!entry) return;
      if(act==='del'){
        logs.splice(idx,1); _writeLogs(logs); _renderLogList(); 
      }else if(act==='restore'){
        _applySoloInputs(entry.inputs||{});
      }
    });
  });
}
// Create log UI now (collapsed list will show)
_renderLogList();


  mountTeamGrids();
  const tcb=document.getElementById('teamCalcBtn'); if(tcb) tcb.addEventListener('click', teamCalc);

  ;['atkName','defName','atkNature','defNature','level','defLevel','atkEV_atk','atkEV_spa','defEV_hp','defEV_def','defEV_spd'].forEach(id=>{
    const el = document.getElementById(id); if(el){
      const evt = (el.tagName==='SELECT')?'change':'input';
      el.addEventListener(evt, refreshStatDisplays);
      el.addEventListener('change', refreshStatDisplays);
    }
  });

  const sb=document.getElementById('sumBtn'); if(sb) sb.addEventListener('click', calcSumOnce);
  const teamBtn = document.getElementById('teamCalcBtn');
  if(teamBtn){
    teamBtn.addEventListener('click', ()=>{
      (() => { const tr = document.getElementById('teamResult'); if(tr){ tr.textContent = (document.getElementById('soloResult')?.textContent || ''); } })();
    });
  }
}
document.addEventListener('DOMContentLoaded', init);


function calcSumOnce(){
  const out = document.getElementById('sumText');
  if(!out) return;
  out.textContent = '';
  const {att, def, opts, moves} = readSoloInputs();
  const picks = [];
  const uses = [1,2,3,4].map(i=>document.getElementById('sumUse'+i)?.checked);
  const counts = [1,2,3,4].map(i=>Number(document.getElementById('sumCount'+i)?.value||1));
  for(let i=0;i<4;i++){
    const name = moves[i];
    if(!name) continue;
    if(uses[i]){
      const mv = getMoveByNameJP(name);
      if(!mv) continue;
      opts.crit = !!mv.alwaysCrit; const r = calcOne(att, def, mv, opts);
        const eff = (r && r.eff) ? r.eff : quickTypeMultiplier(mv.type, def.types);
        const _eff = (typeof eff==='number' && eff>0)? eff : 1;
      picks.push({name, r, count: Math.max(1, counts[i]||1)});
    }
  }
  if(picks.length===0){
    out.textContent = '加算対象の技が選択されていません。';
    const best = document.getElementById('hpFillBest'); if(best) best.style.width = '100%';
    const worst = document.getElementById('hpFillWorst'); if(worst) worst.style.width = '100%';
    return;
  }
  let sumMin=0, sumMax=0, lines=[];
  for(const p of picks){
    const min = p.r.min * p.count;
    const max = p.r.max * p.count;
    sumMin += min;
    sumMax += max;
    lines.push(`${p.name}${p.r.hits>1?`（${p.r.hits}回）`:''} ×${p.count}：${min}-${max}`);
  }
  const hp = def.hp||1;
  const remBest = Math.max(0, hp - sumMax); // 最悪（最大被ダメ）
  const remWorst = Math.max(0, hp - sumMin); // 最良（最小被ダメ）
  const bestPct = Math.round(remWorst*1000/hp)/10;
  const worstPct = Math.round(remBest*1000/hp)/10;

  const bestBar = document.getElementById('hpFillBest');
  const worstBar = document.getElementById('hpFillWorst');
  if(bestBar) bestBar.style.width = `${bestPct}%`;
  if(worstBar) worstBar.style.width = `${worstPct}%`;

  out.textContent = `合計ダメージ：${sumMin}-${sumMax} （残りHP：${remWorst}-${remBest} / ${bestPct}%-${worstPct}%）\n` + lines.join('\n');
}



function refreshStatDisplays(){
  try{
    const s = readSoloInputs();
    const map = [
      ['atkStatVal', s.att && s.att.atk],
      ['spaStatVal', s.att && s.att.spa],
      ['hpStatVal',  s.def && s.def.hp],
      ['defStatVal', s.def && s.def.def],
      ['spdStatVal', s.def && s.def.spd]
    ];
    map.forEach(([id,val])=>{
      const el = document.getElementById(id);
      if(el){ el.textContent = (typeof val==='number' && !isNaN(val)) ? `実: ${val}` : ''; }
    });
  }catch(_){ /* noop */ }
}



// ===== 6v6 =====

function teamDefaultAtkRow(i){
  return `
  <div class="team-row">
    <input id="tA_name_${i}" type="text" list="pkmList" placeholder="ポケモン名">
    <select id="tA_nat_${i}">
      <option value="none">補正なし</option>
      <option value="atk">A↑</option>
      <option value="spa">C↑</option>
    </select>
    <select id="tA_ev_${i}">
      <option value="A252">A252</option>
      <option value="C252">C252</option>
      <option value="0">0</option>
    </select>
    <div class="team-moves">
      <input id="tA_m1_${i}" type="text" list="movList" placeholder="技1">
      <input id="tA_m2_${i}" type="text" list="movList" placeholder="技2">
      <input id="tA_m3_${i}" type="text" list="movList" placeholder="技3">
      <input id="tA_m4_${i}" type="text" list="movList" placeholder="技4">
    </div>
  </div>`;
}
function teamDefaultDefRow(i){
  return `<div class="team-def-row">
    <input id="tD_name_${i}" type="text" list="pkmList" placeholder="ポケモン名">
    <select id="tD_nat_${i}"><option value="none">補正なし</option><option value="b">B↑</option><option value="d">D↑</option></select>
    <select id="tD_ev_${i}"><option value="HB252">HB252</option><option value="HD252">HD252</option><option value="H252">H252</option><option value="B252">B252</option><option value="D252">D252</option><option value="0">0</option></select>
  </div>`;
}

function mountTeamGrids(){
  const A = document.getElementById('teamAtkGrid');
  const D = document.getElementById('teamDefGrid');
  if(!A||!D) return;
  A.innerHTML = Array.from({length:6}, (_,i)=>teamDefaultAtkRow(i+1)).join('');
  D.innerHTML = Array.from({length:6}, (_,i)=>teamDefaultDefRow(i+1)).join('');
  try{ wireMoveCombos('teamAtkGrid'); }catch(_){ }
}
function parseAtkRow(i){
  const name = document.getElementById(`tA_name_${i}`).value.trim();
  if(!name) return null;
  const nat = document.getElementById(`tA_nat_${i}`).value;
  const ev = document.getElementById(`tA_ev_${i}`).value;
  const poke = getPokemonByNameJP(name); if(!poke) return null;
  const lvl = Number(document.getElementById('level')?.value||50);
  const base = poke;
  const iv = 31;
  function calcNonHP(baseStat, evVal, isPlus){ const n = Math.floor(((2*baseStat+iv+Math.floor(evVal/4))*lvl)/100)+5; return Math.floor(n * (isPlus?1.1:1)); }
  const atkEv = ev==='A252'?252:0;
  const spaEv = ev==='C252'?252:0;
  const atk = calcNonHP(base.攻撃, atkEv, nat==='atk');
  const spa = calcNonHP(base.特攻, spaEv, nat==='spa');
  return {name, atk, spa, level:lvl, type1:base.タイプ1, type2:base.タイプ2, moves:[1,2,3,4].map(k=>document.getElementById(`tA_m${k}_${i}`).value.trim()).filter(Boolean)};
}
function parseDefRow(i){
  const name = document.getElementById(`tD_name_${i}`).value.trim();
  if(!name) return null;
  const nat = document.getElementById(`tD_nat_${i}`).value;
  const ev = document.getElementById(`tD_ev_${i}`).value;
  const poke = getPokemonByNameJP(name); if(!poke) return null;
  const lvl = Number(document.getElementById('defLevel')?.value||50);
  const iv = 31;
  function calcHP(baseStat, evVal){ const n = Math.floor(((2*baseStat+iv+Math.floor(evVal/4))*lvl)/100) + lvl + 10; return n; }
  function calcNonHP(baseStat, evVal, mult){ const n = Math.floor(((2*baseStat+iv+Math.floor(evVal/4))*lvl)/100)+5; return Math.floor(n * mult); }
  const map = {HB252:[252,252,0], HD252:[252,0,252], H252:[252,0,0], B252:[0,252,0], D252:[0,0,252], "0":[0,0,0]};
  const [hpEV, bEV, dEV] = map[ev] || [0,0,0];
  const hp = calcHP(poke.HP, hpEV);
  const def = calcNonHP(poke.防御, bEV, nat==='b'?1.1:1.0);
  const spd = calcNonHP(poke.特防, dEV, nat==='d'?1.1:1.0);
  return {name, hp, def, spd, type1:poke.タイプ1, type2:poke.タイプ2};
}
function inferHits(move){
  if(!move || !move.hits) return 1;
  const h = move.hits.trim();
  if(h==='1' || h==='') return 1;
  if(h.includes('2～5')) return 4; // fixed for dice meta
  if(h.includes('1～10') || move.name==='ネズミざん') return 10;
  const num = Number(h); return isNaN(num)?1:num;
}
function teamCalc(){
  const showAll = (document.getElementById('teamShowAll')?.checked ?? document.getElementById('showAllMoves')?.checked) || false;
  const atks = []; const defs = [];
  for(let i=1;i<=6;i++){ const a=parseAtkRow(i); if(a) atks.push(a); }
  for(let i=1;i<=6;i++){ const d=parseDefRow(i); if(d) defs.push(d); }
  if(defs.length===0 || atks.length===0){
    document.getElementById('teamTableWrap').innerHTML = '<div class="small">攻撃側／防御側の入力が不足しています。</div>'; return;
  }
  const table = document.createElement('table'); table.className='team-table';
  const thead = document.createElement('thead'); const trh = document.createElement('tr');
  trh.appendChild(document.createElement('th')).textContent='攻防';
  defs.forEach(d=>{ const th=document.createElement('th'); th.textContent=d.name; trh.appendChild(th); });
  thead.appendChild(trh); table.appendChild(thead);
  const tbody = document.createElement('tbody');
  atks.forEach(a=>{
    const tr=document.createElement('tr'); const nameCell=document.createElement('th'); nameCell.textContent=a.name; tr.appendChild(nameCell);
    defs.forEach(d=>{
      const td=document.createElement('td');
      const att={atk:a.atk, spa:a.spa, level:a.level, types:[a.type1,a.type2]};
      const def={hp:d.hp, def:d.def, spd:d.spd, t1:d.type1, t2:d.type2, types:[d.type1,d.type2]};
      let opts={crit:false, screens:{}, burn:false, miscMult:1, hits:1, tera:null, stabOverride:null};
      const names = a.moves.length? a.moves : [''];
      let lines=[], best=null;
      names.forEach(nm=>{
        if(!nm) return;
        const mv=getMoveByNameJP(nm); if(!mv) return;
        opts.crit = !!mv.alwaysCrit; opts.hits=undefined; const r = calcOne(att, def, mv, opts);
// use calcOne results directly (already includes type/STAB/crit/multi/walls)
const hits = (r && r.hits) ? r.hits : inferHits(mv);
const min = r.min, max = r.max;
const pctMin = r.minPct, pctMax = r.maxPct;
const label = `${mv.name}${hits>1?`（${hits}回）`:''}: ${min}-${max} (${pctMin}%-${pctMax}%) `;
        if(showAll){ lines.push(label); }
        const score = max/def.hp;
        if(!best || score>best.score){ best={label, score}; }
      });
      td.textContent = showAll? (lines.join('\n')||'-') : (best?best.label:'-');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const wrap=document.getElementById('teamTableWrap');
  wrap.innerHTML=''; wrap.appendChild(table);
}



function quickTypeMultiplier(moveType, defTypes){
  try{
    if(!TYPE_CHART || !moveType) return 1;
    const t1 = defTypes && defTypes[0]; const t2 = defTypes && defTypes[1];
    const m1 = (TYPE_CHART[moveType] && TYPE_CHART[moveType][t1]) || 1;
    const m2 = (t2 && t2!==t1)? ((TYPE_CHART[moveType] && TYPE_CHART[moveType][t2]) || 1) : 1;
    return m1 * m2;
  }catch(_){ return 1; }
}



// ---- combobox for moves (always-visible drop-down button) ----
function wireMoveCombos(rootId){
  const root = document.getElementById(rootId||'teamAtkGrid');
  if(!root) return;
  const inputs = Array.from(root.querySelectorAll('input.move-input, input[placeholder^="技"]'));
  inputs.forEach(inp=>{
    if(inp.closest('.combo-wrap')) return; // already wired
    const wrap = document.createElement('div');
    wrap.className = 'combo-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'combo-btn';
    btn.innerHTML = '';
    btn.style.display = 'none';
    wrap.appendChild(btn);
    const menu = document.createElement('div');
    menu.className = 'combo-menu';
    wrap.appendChild(menu);
    const list = document.createElement('div');
    list.className = 'combo-list';
    menu.appendChild(list);

    function fill(filter){
      const names = (window.MOVE_NAMES||[]);
      list.innerHTML='';
      const q = (filter||'').trim();
      let count = 0;
      for(const nm of names){
        if(q && nm.indexOf(q)===-1) continue;
        const item = document.createElement('div');
        item.className='combo-item';
        item.textContent = nm;
        item.onclick = ()=>{ inp.value = nm; menu.classList.remove('open'); };
        list.appendChild(item);
        if(++count>=300) break;
      }
      if(count===0){
        const empty=document.createElement('div');
        empty.className='combo-empty'; empty.textContent='候補なし';
        list.appendChild(empty);
      }
    }
    fill('');
    let open=false;
    function toggle(v){ open=v!==undefined? v:!menu.classList.contains('open'); menu.classList.toggle('open',open); if(open){ fill(inp.value); inp.focus(); } }
    btn.addEventListener('click', ()=>toggle());
    inp.addEventListener('focus', ()=>{ /* keep closed until click */ });
    inp.addEventListener('input', ()=>{ if(menu.classList.contains('open')) fill(inp.value); });
    document.addEventListener('click', (e)=>{ if(!wrap.contains(e.target)) menu.classList.remove('open'); });
  });
}


function normalizeHits(h){
  if(!h) return 1;
  if(typeof h==='number') return h;
  if(typeof h==='string'){
    if(h.includes('1～10')) return 10;
    if(h.includes('2～5')) return 4;
    const m = h.match(/(\d+)/); if(m) return parseInt(m[1],10)||1;
  }
  return 1;
}


/* === Party Tab (save/load/apply) v1 === */
(function(){
  const PARTY_KEY='bdc_parties_v1';
  function getStore(){ try{ return JSON.parse(localStorage.getItem(PARTY_KEY)||'{}'); }catch(e){ return {}; } }
  function putStore(obj){ localStorage.setItem(PARTY_KEY, JSON.stringify(obj)); }

  function buildPartyGrid(){
  const host=document.getElementById('partyGrid');
  if(!host || host.dataset.built) return;
  let html='';
  for(let i=1;i<=6;i++){
    html += `<div class="card"><div class="party-row">
      <input id="p${i}_name" class="text" placeholder="ポケモン名" list="pokemon_list">
      <input id="p${i}_nature" class="text" placeholder="性格（任意）">
      <div class="evs" id="p${i}_evs">
        ${['h','a','b','c','d','s'].map(st=>`
          <div class="evcell">
            <input id="p${i}_ev_${st}" type="number" min="0" max="252" placeholder="${st.toUpperCase()}" />
            <div class="quick">
              <button type="button" class="evbtn ev252" data-for="p${i}_ev_${st}" data-val="252">252</button>
              <button type="button" class="evbtn ev0" data-for="p${i}_ev_${st}" data-val="0">0</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="evtotal" id="p${i}_ev_total">合計: 0/510</div>
      <div class="party-moves">
        ${[1,2,3,4].map(k=>`
          <div class="combo-wrap">
            <input id="p${i}_m${k}" placeholder="技${k}" list="movList">
            
          </div>`).join('')}
      </div>
    </div></div>`;
  }
  host.innerHTML = html;
  host.dataset.built='1';
  setupPartyEVHandlers();
}
function readParty(){
    const arr=[]; for(let i=1;i<=6;i++){
      arr.push({
        name: (document.getElementById(`p${i}_name`)?.value||'').trim(),
        nature: (document.getElementById(`p${i}_nature`)?.value||'').trim(),
        ev:{h:+(document.getElementById(`p${i}_ev_h`)?.value||0),a:+(document.getElementById(`p${i}_ev_a`)?.value||0),b:+(document.getElementById(`p${i}_ev_b`)?.value||0),c:+(document.getElementById(`p${i}_ev_c`)?.value||0),d:+(document.getElementById(`p${i}_ev_d`)?.value||0),s:+(document.getElementById(`p${i}_ev_s`)?.value||0)},
        moves:[1,2,3,4].map(k=>(document.getElementById(`p${i}_m${k}`)?.value||'').trim())
      });
    }
    return arr;
  }
  function writeParty(arr){ for(let i=1;i<=6;i++){ const p=arr[i-1]||{}; 
    const S=(id,val)=>{ const el=document.getElementById(id); if(el) el.value=val??''; };
    S(`p${i}_name`,p.name); S(`p${i}_nature`,p.nature);
    if(p.ev){ S(`p${i}_ev_h`,p.ev.h); S(`p${i}_ev_a`,p.ev.a); S(`p${i}_ev_b`,p.ev.b); S(`p${i}_ev_c`,p.ev.c); S(`p${i}_ev_d`,p.ev.d); S(`p${i}_ev_s`,p.ev.s); }
    (p.moves||[]).forEach((m,idx)=>S(`p${i}_m${idx+1}`,m));
  } }

  function refreshSavedList(){ const dd=document.getElementById('savedList'); if(!dd) return; const store=getStore();
    const names=Object.keys(store).sort(); dd.innerHTML = names.map(n=>`<option value="${n}">${n}</option>`).join(''); }

  // === EV helpers for party ===
function _getEV(id){ const el=document.getElementById(id); const v=+((el&&el.value)||0); return isFinite(v)?Math.max(0, Math.min(252, v|0)):0; }
function computeEVSumForRow(i){
  const sum = _getEV(`p${i}_ev_h`)+_getEV(`p${i}_ev_a`)+_getEV(`p${i}_ev_b`)+_getEV(`p${i}_ev_c`)+_getEV(`p${i}_ev_d`)+_getEV(`p${i}_ev_s`);
  const lab = document.getElementById(`p${i}_ev_total`); if(lab){ lab.textContent=`合計: ${sum}/510`; lab.classList.toggle('over', sum>510); }
  return sum;
}
function setupPartyEVHandlers(){
  const host=document.getElementById('partyGrid'); if(!host) return;
  for(let i=1;i<=6;i++){
    ['h','a','b','c','d','s'].forEach(st=>{
      const id=`p${i}_ev_${st}`; const el=document.getElementById(id);
      if(el){ el.addEventListener('input', ()=>{ 
        let v=el.value===''?0:parseInt(el.value,10)||0; 
        if(v<0) v=0; if(v>252) v=252; el.value=v; 
        computeEVSumForRow(i);
      }); }
    });
    computeEVSumForRow(i);
  }
  host.addEventListener('click', (e)=>{
    const t=e.target; if(!t.classList || !t.classList.contains('evbtn')) return;
    const id=t.dataset.for, val=+t.dataset.val||0; const el=document.getElementById(id);
    if(el){ el.value = (val<0?0:val>252?252:val); const m=id.match(/^p(\d+)_/); if(m) computeEVSumForRow(parseInt(m[1],10)); }
  });
}
function onSave(){
  const name=(document.getElementById('partyName')?.value||'').trim();
  if(!name) return alert('名前を入力');
  for(let i=1;i<=6;i++){
    const sum = computeEVSumForRow(i);
    if(sum>510){ alert(`ポケモン${i} の努力値合計が ${sum} です（510まで）。修正してください。`); return; }
  }
  const store=getStore(); store[name]=readParty(); putStore(store); refreshSavedList(); alert('保存しました');
}
  function onLoad(){ const name=document.getElementById('savedList')?.value; if(!name) return; const store=getStore(); writeParty(store[name]||[]); }
  function onDelete(){ const name=document.getElementById('savedList')?.value; if(!name) return; const store=getStore(); delete store[name]; putStore(store); refreshSavedList(); alert('削除しました'); }

  function applyAttack(){ const party=readParty(); for(let i=1;i<=6;i++){ const p=party[i-1]||{}; const N=(id,val)=>{const el=document.getElementById(id); if(el) el.value=val||'';};
      N(`tA_name_${i}`, p.name||''); N(`tA_m1_${i}`, p.moves?.[0]||''); N(`tA_m2_${i}`, p.moves?.[1]||''); N(`tA_m3_${i}`, p.moves?.[2]||''); N(`tA_m4_${i}`, p.moves?.[3]||''); }
    wireMoveCombos('teamAtkGrid'); alert('攻撃側に反映しました'); }
  function applyDefense(){ const party=readParty(); for(let i=1;i<=6;i++){ const p=party[i-1]||{}; const N=(id,val)=>{const el=document.getElementById(id); if(el) el.value=val||'';}; N(`tD_name_${i}`, p.name||''); }
    alert('防御側に反映しました'); }

  function bindPartyControls(){ buildPartyGrid(); refreshSavedList();
    const b1=document.getElementById('saveParty'); if(b1) b1.addEventListener('click', onSave);
    const b2=document.getElementById('loadParty'); if(b2) b2.addEventListener('click', onLoad);
    const b3=document.getElementById('deleteParty'); if(b3) b3.addEventListener('click', onDelete);
    const ba=document.getElementById('applyAtkAll'); if(ba) ba.addEventListener('click', applyAttack);
    const bd=document.getElementById('applyDefAll'); if(bd) bd.addEventListener('click', applyDefense);
  }

  // Hook into tab shown
  document.addEventListener('DOMContentLoaded', ()=>{ bindPartyControls(); });
})();
