// v5: integrate with triple-checkbox-toggle-with-count.js
// - datalist id 'pkmList' for count script
// - expose window.loadPokemonMaster() so the toggle can reload species list

const rows = [
  { key:'hp',  label:'H' },
  { key:'atk', label:'A' },
  { key:'def', label:'B' },
  { key:'spa', label:'C' },
  { key:'spd', label:'D' },
  { key:'spe', label:'S' },
];

const $ = (s,el=document)=>el.querySelector(s);

const natureMap = {
  'いじっぱり': {up:'atk',down:'spa'},
  'ようき': {up:'spe',down:'spa'},
  'ひかえめ': {up:'spa',down:'atk'},
  'おくびょう': {up:'spe',down:'atk'},
  'ずぶとい': {up:'def',down:'atk'},
  'しんちょう': {up:'spd',down:'spa'},
  'のんき': {up:'def',down:'spe'},
  'なまいき': {up:'spd',down:'spe'},
  'ゆうかん': {up:'atk',down:'spe'},
  'れいせい': {up:'spa',down:'spe'},
  'まじめ': {up:'',down:''},
  '': {up:'',down:''},
};

const state = {
  speciesMap: new Map(),
  aliasMap: new Map(),
};

function clamp(n, lo, hi){ n = parseInt(n,10); if (isNaN(n)) n=0; return Math.max(lo, Math.min(hi, n)); }
function metaNature(){ const n = $('#nature').value || ''; return natureMap[n] || natureMap['']; }
function norm(s){ return (s||'').toString().replace(/\s+/g,'').replace(/　/g,'').toLowerCase(); }

function buildTable(){
  const tbody = document.getElementById('tbody');
  tbody.innerHTML='';
  rows.forEach(r => {
    const tr = document.createElement('div');
    tr.className='tr'; tr.setAttribute('role','row');
    tr.innerHTML = `
      <div class="td colStat" role="cell">${r.label}</div>
      <div class="td" role="cell"><input id="base_${r.key}" type="number" min="1" max="255" class="readonly" readonly></div>
      <div class="td" role="cell">
        <div class="flex">
          <input id="iv_${r.key}" type="number" min="0" max="31" value="31">
          <div class="btns">
            <button type="button" data-tgt="iv_${r.key}" data-val="31">31</button>
            <button type="button" data-tgt="iv_${r.key}" data-val="0">0</button>
          </div>
        </div>
      </div>
      <div class="td" role="cell">
        <div class="flex">
          <input id="ev_${r.key}" type="number" min="0" max="252" value="0">
          <div class="btns">
            <button type="button" data-tgt="ev_${r.key}" data-val="252">252</button>
            <button type="button" data-tgt="ev_${r.key}" data-val="0">0</button>
          </div>
        </div>
      </div>
      <div class="td" role="cell"><input id="real_${r.key}" type="number" class="readonly" readonly></div>
    `;
    tbody.appendChild(tr);
  });
}

function calcAll(){
  const L = clamp(document.getElementById('level').value, 1, 100);
  const nat = metaNature();
  let evSum = 0;
  rows.forEach(r => {
    const base = clamp(document.getElementById('base_'+r.key).value, 1, 255);
    const iv   = clamp(document.getElementById('iv_'+r.key).value, 0, 31);
    const ev   = clamp(document.getElementById('ev_'+r.key).value, 0, 252);
    evSum += ev;
    let real;
    if (r.key==='hp'){
      if (base===1){ real = 1; }
      else { real = Math.floor(((2*base + iv + Math.floor(ev/4)) * L) / 100) + L + 10; }
    } else {
      const pre = Math.floor(((2*base + iv + Math.floor(ev/4)) * L) / 100) + 5;
      let mod = 1.0;
      if (nat.up===r.key) mod = 1.1;
      if (nat.down===r.key) mod = 0.9;
      real = Math.floor(pre * mod);
    }
    document.getElementById('real_'+r.key).value = real || 0;
  });
  document.getElementById('evRemain').textContent = `EV合計 ${evSum} / 残り ${Math.max(0, 510-evSum)}`;
}

function applySpecies(rec){
  if (!rec){
    document.getElementById('type1').textContent = '';
    document.getElementById('type2').textContent = '';
    rows.forEach(r => { document.getElementById('base_'+r.key).value = 0; document.getElementById('real_'+r.key).value = 0; });
    return;
  }
  document.getElementById('type1').textContent = rec.タイプ1 || '';
  document.getElementById('type2').textContent = rec.タイプ2 || '';
  const map = { hp:rec.HP, atk:rec.攻撃, def:rec.防御, spa:rec.特攻, spd:rec.特防, spe:rec.素早 };
  rows.forEach(r => { document.getElementById('base_'+r.key).value = map[r.key] ?? 0; });
  calcAll();
}

function resolveSpecies(inputValue){
  const n = norm(inputValue);
  if (!n) return null;
  const exact = state.aliasMap.get(n);
  if (exact) return state.speciesMap.get(exact);
  for (const name of state.speciesMap.keys()){
    const k = norm(name);
    if (k.startsWith(n)) return state.speciesMap.get(name);
  }
  for (const name of state.speciesMap.keys()){
    const k = norm(name);
    if (k.includes(n)) return state.speciesMap.get(name);
  }
  return null;
}

function wire(){
  document.addEventListener('click', e=>{
    const t=e.target;
    if (t.matches('[data-tgt]')){
      e.preventDefault();
      const id=t.getAttribute('data-tgt'), val=t.getAttribute('data-val');
      const inp = document.getElementById(id);
      if (inp){ inp.value = val; inp.dispatchEvent(new Event('input',{bubbles:true})); }
    }
  });
  document.getElementById('level').addEventListener('change', calcAll);
  document.getElementById('nature').addEventListener('change', calcAll);
  rows.forEach(r=>{
    document.getElementById('iv_'+r.key).addEventListener('input', calcAll);
    document.getElementById('ev_'+r.key).addEventListener('input', calcAll);
  });
  const sp = document.getElementById('speciesInput');
  sp.addEventListener('input', ()=>{ const rec = resolveSpecies(sp.value); if (rec) applySpecies(rec); });
  sp.addEventListener('change', ()=>{ const rec = resolveSpecies(sp.value); applySpecies(rec); });
  sp.addEventListener('blur',   ()=>{ const rec = resolveSpecies(sp.value); applySpecies(rec); });
}

async function loadPokemonMaster(){ // exposed for triple-checkbox script
  // ここで pokemon_master.json を fetch（トグルが差し替える）
  const res = await fetch('./pokemon_master.json', { cache:'no-store' });
  const list = await res.json();
  state.speciesMap.clear(); state.aliasMap.clear();
  const dl = document.getElementById('pkmList');
  dl.innerHTML = '';
  (Array.isArray(list)? list : []).forEach(obj=>{
    if (!obj || !obj.名前) return;
    state.speciesMap.set(obj.名前, obj);
    state.aliasMap.set(norm(obj.名前), obj.名前);
    const opt = document.createElement('option'); opt.value = obj.名前; dl.appendChild(opt);
  });
}

window.loadPokemonMaster = loadPokemonMaster;

function stripBOM(s){ return s && s.charCodeAt(0)===0xFEFF ? s.slice(1) : s; }
function guessDelimiter(firstLine){
  const cands=[',',';','\t','|'];
  let best=',', bestCount=-1;
  for (const d of cands){
    const cnt = (firstLine.split(d).length-1);
    if (cnt>bestCount){ bestCount=cnt; best=d; }
  }
  return best;
}
function parseCSV(text, delim=','){
  const rows=[]; let row=[]; let i=0; let cur=''; let q=false;
  while(i<text.length){
    const c=text[i++];
    if (q){
      if (c==='\"'){
        if (text[i]==='\"'){ cur+='\"'; i++; } else { q=false; }
      } else { cur+=c; }
    } else {
      if (c==='\"'){ q=true; }
      else if (c===delim){ row.push(cur); cur=''; }
      else if (c==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; }
      else if (c==='\r'){ /* skip */ }
      else { cur+=c; }
    }
  }
  if (cur!=='' || row.length){ row.push(cur); rows.push(row); }
  return rows;
}
function pickMoveNameIndex(cols){
  const lowers = cols.map(c=> (c||'').toString().toLowerCase().replace(/^\ufeff/,''));
  const keys = ['技名','わざ名','わざ','技','name_ja','move_ja','move-ja','ja','日本語名','name','move','move_name'];
  for (const k of keys){
    const idx = lowers.findIndex(h => h === k);
    if (idx>=0) return idx;
  }
  let idx = lowers.findIndex(h => /(技名|わざ|move|name)/.test(h));
  return idx>=0 ? idx : 0;
}
async function loadMoves(){
  try{
    const res = await fetch('./moves.csv', {cache:'no-store'});
    let text = await res.text();
    text = stripBOM(text);
    const firstLine = text.split(/\r?\n/)[0] || '';
    const delim = guessDelimiter(firstLine);
    const arr = parseCSV(text, delim).filter(r=>r && r.length>0);
    if (!arr.length) return;
    const head = arr[0];
    const idx = pickMoveNameIndex(head);
    const set = new Set();
    for (let i=1;i<arr.length;i++){
      const name = (arr[i][idx]||'').trim();
      if (name) set.add(name);
    }
    const dl = document.getElementById('movesList');
    dl.innerHTML='';
    Array.from(set).forEach(n=>{
      const opt = document.createElement('option'); opt.value = n; dl.appendChild(opt);
    });
  }catch(e){ /* ignore */ }
}

async function init(){
  buildTable();
  wire();
  await loadPokemonMaster(); // 初期読込。トグルスクリプトが後から fetch を差し替えたら、向こうから再実行される。
  loadMoves();
  calcAll();
}

document.addEventListener('DOMContentLoaded', init);


// ===== BDC Save/Load bridge (localStorage) =====
function collectState(){
  const data = {
    species: document.getElementById('speciesInput').value || '',
    level: document.getElementById('level').value || '50',
    nature: document.getElementById('nature').value || '',
    base: {}, iv: {}, ev: {}, real: {},
    moves: [document.getElementById('move1')?.value||'',
            document.getElementById('move2')?.value||'',
            document.getElementById('move3')?.value||'',
            document.getElementById('move4')?.value||'']
  };
  rows.forEach(r=>{
    data.base[r.key] = document.getElementById('base_'+r.key).value || '0';
    data.iv[r.key]   = document.getElementById('iv_'+r.key).value || '0';
    data.ev[r.key]   = document.getElementById('ev_'+r.key).value || '0';
    data.real[r.key] = document.getElementById('real_'+r.key).value || '0';
  });
  return data;
}
function applyStateData(d){
  if (!d) return;
  if (typeof d.species==='string'){ document.getElementById('speciesInput').value = d.species; const rec = resolveSpecies(d.species); if (rec) applySpecies(rec); }
  if (d.level) document.getElementById('level').value = String(d.level);
  if (d.nature) document.getElementById('nature').value = d.nature;
  if (d.base){ rows.forEach(r=>{ const v=d.base[r.key]; if (v!=null) document.getElementById('base_'+r.key).value = v; }); }
  if (d.iv){ rows.forEach(r=>{ const v=d.iv[r.key]; if (v!=null) document.getElementById('iv_'+r.key).value = v; }); }
  if (d.ev){ rows.forEach(r=>{ const v=d.ev[r.key]; if (v!=null) document.getElementById('ev_'+r.key).value = v; }); }
  if (d.moves){ const arr=d.moves; ['move1','move2','move3','move4'].forEach((id,i)=>{ if (arr[i]!=null) document.getElementById(id).value = arr[i]; }); }
  calcAll();
}
function syncCurrent(){
  try{
    localStorage.setItem('BDC_CURRENT', JSON.stringify(collectState()));
    localStorage.setItem('BDC_UPDATED', String(Date.now()));
  }catch(e){ /* ignore */ }
}
window.addEventListener('storage', (e)=>{
  if (e.key==='BDC_APPLY'){
    try{
      const d = JSON.parse(localStorage.getItem('BDC_CURRENT')||'{}');
      applyStateData(d);
    }catch(_){}
  }
});
function hookSync(){
  const ids = ['speciesInput','level','nature','move1','move2','move3','move4'];
  ids.forEach(id=>{ const el=document.getElementById(id); if (el){ el.addEventListener('input', syncCurrent); el.addEventListener('change', syncCurrent); } });
  rows.forEach(r=>{
    ['iv_','ev_'].forEach(p=>{ const el=document.getElementById(p+r.key); if (el){ el.addEventListener('input', syncCurrent); } });
  });
  try{
    const d = JSON.parse(localStorage.getItem('BDC_CURRENT')||'null');
    if (d) applyStateData(d);
  }catch(_){}
  syncCurrent();
}

// ===== Inline Save/Load UI =====
const SAVE_KEY = 'BDC_SAVES';
function savesLoad(){ try{return JSON.parse(localStorage.getItem(SAVE_KEY)||'[]')}catch(_){return []} }
function savesSave(arr){ localStorage.setItem(SAVE_KEY, JSON.stringify(arr)); }
function savesUUID(){ return 'xxxx-4xxx-yxxx'.replace(/[xy]/g, c => { const r=Math.random()*16|0; const v=c==='x'?r:(r&0x3|0x8); return v.toString(16); }); }
function savesRender(){
  const listEl = document.getElementById('saveList'); if (!listEl) return;
  listEl.innerHTML='';
  const arr = savesLoad().sort((a,b)=> (b.updated||0)-(a.updated||0));
  arr.forEach(rec=>{
    const opt = document.createElement('option');
    const t = new Date(rec.updated||0).toLocaleString();
    opt.value = rec.id; opt.textContent = `${rec.name}  (${t})`;
    listEl.appendChild(opt);
  });
}
function openPanel(){ document.getElementById('savePanel').classList.remove('hidden'); savesRender(); }
function closePanel(){ document.getElementById('savePanel').classList.add('hidden'); }
document.addEventListener('click', (e)=>{
  if (e.target?.id==='openSave') openPanel();
  if (e.target?.id==='closeSave') closePanel();
});
document.addEventListener('DOMContentLoaded', ()=>{
  const btnSave = document.getElementById('btnSave');
  const btnLoad = document.getElementById('btnLoad');
  const btnDel  = document.getElementById('btnDelete');
  const btnExp  = document.getElementById('btnExport');
  const btnImp  = document.getElementById('btnImport');
  if (btnSave) btnSave.addEventListener('click', ()=>{
    const name = document.getElementById('saveName').value.trim() || '未命名';
    const data = collectState();
    const arr = savesLoad();
    arr.push({id:savesUUID(), name, data, updated: Date.now()});
    savesSave(arr); document.getElementById('saveName').value=''; savesRender();
  });
  if (btnLoad) btnLoad.addEventListener('click', ()=>{
    const id = document.getElementById('saveList').value;
    if (!id) return;
    const rec = savesLoad().find(x=>x.id===id);
    if (rec){ applyStateData(rec.data); syncCurrent(); }
  });
  if (btnDel) btnDel.addEventListener('click', ()=>{
    const id = document.getElementById('saveList').value;
    if (!id) return;
    const arr = savesLoad().filter(x=>x.id!==id);
    savesSave(arr); savesRender();
  });
  if (btnExp) btnExp.addEventListener('click', ()=>{
    const blob = new Blob([localStorage.getItem(SAVE_KEY)||'[]'], {type:'application/json'});
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='bdc_saves.json'; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  });
  if (btnImp) btnImp.addEventListener('click', async ()=>{
    const input = document.getElementById('fileImport');
    if (!input.files || !input.files[0]) return;
    const text = await input.files[0].text();
    let arr = []; try{ arr = JSON.parse(text)||[]; }catch(e){ alert('JSONが不正です'); return; }
    if (!Array.isArray(arr)){ alert('配列JSONではありません'); return; }
    const cur = savesLoad(); const map = new Map(cur.map(r=>[r.id,r]));
    arr.forEach(r=>{ if (r && r.id && r.name && r.data){ map.set(r.id, r); } });
    savesSave(Array.from(map.values())); savesRender();
  });
  savesRender();
});
// ensure current state sync
document.addEventListener('DOMContentLoaded', ()=>{ setTimeout(hookSync, 0); });



function setupTabs(){
  const tabS=document.getElementById('tabStats');
  const tabC=document.getElementById('tabCalc');
  const panS=document.getElementById('panelStats');
  const panC=document.getElementById('panelCalc');
  if(!tabS||!tabC||!panS||!panC) return;
  const showStats=()=>{ tabS.classList.add('active'); tabC.classList.remove('active'); panS.classList.remove('hidden'); panC.classList.add('hidden'); panS.style.display='block'; panC.style.display='none'; };
  const showCalc =()=>{ tabC.classList.add('active'); tabS.classList.remove('active'); panC.classList.remove('hidden'); panS.classList.add('hidden'); panC.style.display='block'; panS.style.display='none'; try{ updateDamageFromUI(); }catch(e){} };
  tabS.addEventListener('click', showStats);
  tabC.addEventListener('click', showCalc);
  showStats();
}
function stageMul(s){ s=parseInt(s,10)||0; return s>=0 ? (2+s)/2 : 2/(2-s); }
function calcBaseDamage(L,P,A,D){ const t1=Math.floor((2*L)/5)+2; const t2=Math.floor(t1*P*A/Math.max(1,D)); return Math.floor(t2/50)+2; }

// Mini real stat calculator
function miniClamp(v, lo, hi){ v=parseInt(v,10); if(isNaN(v)) v=0; return Math.max(lo, Math.min(hi, v)); }
function miniLevel(){ var r=document.querySelector('input[name="dmgLevel"]:checked'); return r? parseInt(r.value,10):50; }
function miniRealHP(base, ev, L){ base=miniClamp(base,1,255); ev=miniClamp(ev,0,252); L=miniClamp(L,1,100); if(base===1) return 1; var pre=Math.floor(((2*base+31+Math.floor(ev/4))*L)/100); return pre + L + 10; }
function miniRealOther(base, ev, L, mult){ base=miniClamp(base,1,255); ev=miniClamp(ev,0,252); L=miniClamp(L,1,100); mult=parseFloat(mult)||1; var pre=Math.floor(((2*base+31+Math.floor(ev/4))*L)/100)+5; return Math.floor(pre*mult); }
function miniCalcAll(){
  var L=miniLevel();
  [['hp',1],['atk',0],['def',0],['spa',0],['spd',0],['spe',0]].forEach(function(pair){
    var k=pair[0];
    var base=document.getElementById('mini_base_'+k)?.value||0;
    var ev=document.getElementById('mini_ev_'+k)?.value||0;
    var mult=(k==='hp')?1:(document.getElementById('mini_nat_'+k)?.value||1);
    var real=(k==='hp')? miniRealHP(base,ev,L): miniRealOther(base,ev,L,mult);
    var out=document.getElementById('mini_real_'+k); if(out) out.value=real||0;
  });
}
function wireMiniStats(){
  document.querySelectorAll('.evbtn').forEach(function(b){
    b.addEventListener('click', function(){
      var sel=b.getAttribute('data-mini-ev'); var tgt=document.querySelector(sel);
      var val=parseInt(b.getAttribute('data-val'),10)||0;
      if(tgt){ tgt.value=val; miniCalcAll(); }
    });
  });
  ['hp','atk','def','spa','spd','spe'].forEach(function(k){
    ['mini_base_','mini_ev_','mini_nat_'].forEach(function(prefix){
      var el=document.getElementById(prefix+k);
      if(el){ el.addEventListener('input', miniCalcAll); el.addEventListener('change', miniCalcAll); }
    });
  });
  document.querySelectorAll('input[name="dmgLevel"]').forEach(function(r){ r.addEventListener('change', miniCalcAll); });
  miniCalcAll();
}

// Damage inputs
function gatherDamageInputs(){
  const isPhys = document.getElementById('catPhysical')?.checked ?? true;
  const L  = parseInt((document.querySelector('input[name="dmgLevel"]:checked')||{value:50}).value,10);
  const P  = parseInt(document.getElementById('dmgPower')?.value || 100, 10);
  const A0 = parseInt(document.getElementById('dmgAtk')?.value   || 200, 10);
  const D0 = parseInt(document.getElementById('dmgDef')?.value   || 150, 10);
  const A = Math.floor(A0 * stageMul(document.getElementById('atkStage')?.value || 0));
  const D = Math.floor(D0 * stageMul(document.getElementById('defStage')?.value || 0));
  const stab = parseFloat(document.getElementById('stab')?.value || 1) || 1;
  const eff  = parseFloat(document.getElementById('dmgEffect')?.value || 1) || 1;
  const crit = parseFloat(document.getElementById('crit')?.value || 1) || 1;
  let burn   = parseFloat(document.getElementById('burn')?.value || 1) || 1;
  if (!isPhys) burn = 1;
  const other= parseFloat(document.getElementById('otherMod')?.value || 1) || 1;
  const hpInput = parseInt(document.getElementById('dmgHP')?.value || 0, 10);
  const hits = parseInt((document.getElementById('hitCount')?.value||'1'),10)||1;
  return {L, P, A, D, stab, eff, crit, burn, other, hpInput, isPhys, hits};
}
function calcDamageAllRolls(){
  const i = gatherDamageInputs();
  const base = calcBaseDamage(i.L, i.P, i.A, i.D);
  const perRolls = [];
  for (let r=85; r<=100; r++){
    let mod = i.stab * i.eff * i.crit * i.other * (r/100);
    if (i.isPhys) mod *= i.burn;
    const dmg = Math.max(1, Math.floor(base * mod));
    perRolls.push(dmg);
  }
  const perMin = Math.min(...perRolls);
  const perMax = Math.max(...perRolls);
  const perAvg = perRolls.reduce((a,b)=>a+b,0)/perRolls.length;
  const hits = Math.max(1, Math.min(10, i.hits||1));
  const totalMin = perMin * hits;
  const totalMax = perMax * hits;
  const hp = i.hpInput || null;
  return {hp, base, perRolls, perMin, perMax, perAvg, hits, min: totalMin, max: totalMax, avg: perAvg*hits};
}
function updateDamageFromUI(){
  const i = calcDamageAllRolls();
  const sum = document.getElementById('dmgSummary');
  if (sum){
    const hp = i.hp||0;
    const pctMinT = (hp? (Math.floor(i.min*1000/hp)/10)+'%' : '—');
    const pctMaxT = (hp? (Math.floor(i.max*1000/hp)/10)+'%' : '—');
    const ko = (function(){
      if(!hp) return '';
      const ceil=(a,b)=>Math.floor((a+b-1)/b);
      const nBest=ceil(hp,i.max);
      const nWorst=ceil(hp,i.min);
      return (nBest===nWorst)? '｜KO: 確定'+nBest+'発' : '｜KO: 乱数'+nBest+'〜'+nWorst+'発';
    })();
    const perLine = (function(){
      const p1 = (hp? (Math.floor(i.perMin*1000/hp)/10)+'%' : '—');
      const p2 = (hp? (Math.floor(i.perMax*1000/hp)/10)+'%' : '—');
      return '単発: 最小'+i.perMin+' ～ 最大'+i.perMax+'（'+p1+'～'+p2+'）';
    })();
    sum.innerHTML = '合計'+i.hits+'発: 最小'+i.min+' ～ 最大'+i.max+'（'+pctMinT+'～'+pctMaxT+'）' + (ko? ' '+ko:'') + '<br><span class=\"mono small\">'+perLine+'</span>';
  }
  const rolls = document.getElementById('dmgRolls');
  if (rolls){
    rolls.innerHTML = i.perRolls.map(function(x){
      const pct = (i.hp && i.hp>0) ? '（'+(Math.floor(x*1000/i.hp)/10)+'%）' : '';
      return '<div class=\"row\"><div>乱数</div><div>'+x+pct+'</div></div>';
    }).join('');
  }
}
function wireDamageCalcInputs(){
  ['catPhysical','catSpecial','lvl50','lvl100','dmgPower','dmgAtk','dmgDef','dmgHP','atkStage','defStage','stab','dmgEffect','crit','burn','otherMod','hitCount']
  .forEach(function(id){ var el=document.getElementById(id); if(el){ el.addEventListener('input', updateDamageFromUI); el.addEventListener('change', updateDamageFromUI);} });
  updateDamageFromUI();
}
function copyAtoAtk(){
  var v=parseInt(document.getElementById('mini_real_atk')?.value||'0',10)||0;
  var el=document.getElementById('dmgAtk'); if(el){ el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); }
}
function copyDtoDef(){
  var isSpecial=document.getElementById('catSpecial')?.checked;
  var srcId=isSpecial?'mini_real_spd':'mini_real_def';
  var v=parseInt(document.getElementById(srcId)?.value||'0',10)||0;
  var el=document.getElementById('dmgDef'); if(el){ el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); }
}
document.addEventListener('DOMContentLoaded', function(){
  try{ setupTabs(); }catch(e){}
  try{ wireMiniStats(); }catch(e){}
  try{ wireDamageCalcInputs(); }catch(e){}
  var ca=document.getElementById('copyAtoAtk'); if(ca) ca.addEventListener('click', copyAtoAtk);
  var cd=document.getElementById('copyDtoDef'); if(cd) cd.addEventListener('click', copyDtoDef);
});



// --------- Accumulator (加算) ---------
var ACCU = [];
function renderAccu(){
  var list = document.getElementById('accuList');
  var total= document.getElementById('accuTotal');
  if(!list || !total) return;
  if(ACCU.length===0){
    list.innerHTML = '（なし）';
    total.innerHTML = '—';
    return;
  }
  var sumMin=0, sumMax=0;
  var rows = ACCU.map(function(e,idx){
    sumMin += e.min; sumMax += e.max;
    return '<div class="accuRow"><span class="idx">#'+(idx+1)+'</span><span>'+e.label+'</span><span>'+e.min+'～'+e.max+'</span></div>';
  }).join('');
  list.innerHTML = rows;
  var hp = parseInt(document.getElementById('dmgHP')?.value||'0',10)||0;
  var pctMin = hp? (Math.floor(sumMin*1000/hp)/10)+'%' : '—';
  var pctMax = hp? (Math.floor(sumMax*1000/hp)/10)+'%' : '—';
  var ko = '';
  if (hp){
    var ceil=function(a,b){ return Math.floor((a+b-1)/b); };
    var nBest=ceil(hp,sumMax), nWorst=ceil(hp,sumMin);
    ko = (nBest===nWorst)? ' ｜KO: 確定'+nBest+'発' : ' ｜KO: 乱数'+nBest+'〜'+nWorst+'発';
  }
  total.innerHTML = '合計: 最小'+sumMin+' ～ 最大'+sumMax+'（'+pctMin+'～'+pctMax+'）'+ko;
}
function accuAddCurrent(){
  var i = calcDamageAllRolls();
  var pow = document.getElementById('dmgPower')?.value || '?';
  var lab = '威力'+pow+' × '+i.hits+'発';
  ACCU.push({label: lab, min: i.min, max: i.max});
  renderAccu();
}
function accuUndo(){ if(ACCU.length>0){ ACCU.pop(); renderAccu(); } }
function accuClear(){ ACCU = []; renderAccu(); }
document.addEventListener('DOMContentLoaded', function(){
  var add=document.getElementById('accuAdd'); if(add) add.addEventListener('click', accuAddCurrent);
  var und=document.getElementById('accuUndo'); if(und) und.addEventListener('click', accuUndo);
  var clr=document.getElementById('accuClear'); if(clr) clr.addEventListener('click', accuClear);
  var hp=document.getElementById('dmgHP'); if(hp){ hp.addEventListener('input', renderAccu); hp.addEventListener('change', renderAccu); }
});

