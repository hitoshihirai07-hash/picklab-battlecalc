/* Pick Lab 学習データ（集計） /learn/data.html 用 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // same key as learn/log.js
  const KEY_LOGS = 'picklab_learn_logs_v1';
  const KEY_REG_FILTER = 'picklab_learn_reg_filter_v1_stats';

  function safeText(s){ return (s ?? '').toString(); }
  function normName(s){ return safeText(s).trim(); }
  function normReg(s){ return safeText(s).trim(); }

  function loadLogs(){
    try{
      const raw = localStorage.getItem(KEY_LOGS);
      if(!raw) return [];
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    }catch(e){
      return [];
    }
  }

  function uniqNonEmpty(arr){
    const set = new Set();
    for(const x of (arr || [])){
      const n = normName(x);
      if(n) set.add(n);
    }
    return [...set];
  }

  function buildStats(entries, side){
    // side: 'self' | 'opp'
    const total = entries.length;

    const appear = new Map();   // pokemon -> games count (in team6)
    const pick = new Map();     // pokemon -> games count (in pick1-3)
    const lead = new Map();     // pokemon -> games count (pick1)

    let gamesWithPicks = 0;

    for(const e of entries){
      const team = side === 'self' ? e.selfTeam : e.oppTeam;
      const picks = side === 'self' ? e.selfPick : e.oppPick;

      const teamU = uniqNonEmpty(team);
      for(const n of teamU){
        appear.set(n, (appear.get(n) || 0) + 1);
      }

      const picksU = uniqNonEmpty(picks);
      if(picksU.length){
        gamesWithPicks += 1;
        for(const n of picksU){
          pick.set(n, (pick.get(n) || 0) + 1);
        }
        const leadName = normName((picks || [])[0]);
        if(leadName){
          lead.set(leadName, (lead.get(leadName) || 0) + 1);
        }
      }
    }

    // union keys
    const names = new Set();
    for(const k of appear.keys()) names.add(k);
    for(const k of pick.keys()) names.add(k);
    for(const k of lead.keys()) names.add(k);

    const denomPick = gamesWithPicks || 0;

    const rows = [...names].map(name => {
      const appearCount = appear.get(name) || 0;
      const pickCount = pick.get(name) || 0;
      const leadCount = lead.get(name) || 0;

      const appearRate = total ? (appearCount / total) : 0;
      const pickRate = denomPick ? (pickCount / denomPick) : 0;
      const leadRate = denomPick ? (leadCount / denomPick) : 0;

      return {
        name,
        appearCount, appearRate,
        pickCount, pickRate,
        leadCount, leadRate,
      };
    });

    return { total, gamesWithPicks, rows };
  }

  function fmtPct(x){
    if(!isFinite(x)) return '-';
    return (x * 100).toFixed(1) + '%';
  }

  function compare(a, b, key){
    if(key === 'name') return a.name.localeCompare(b.name, 'ja');
    const va = a[key];
    const vb = b[key];
    if(va === vb) return a.name.localeCompare(b.name, 'ja');
    return vb - va; // desc
  }

  function applyFilters(rows, q){
    const qq = normName(q).toLowerCase();
    if(!qq) return rows;
    return rows.filter(r => r.name.toLowerCase().includes(qq));
  }

  function sliceRows(rows, limit){
    if(limit === 'all') return rows;
    const n = parseInt(limit, 10);
    if(!isFinite(n) || n <= 0) return rows;
    return rows.slice(0, n);
  }

  function renderTable(tbody, rows){
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();

    for(const r of rows){
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      tdName.textContent = r.name;
      tr.appendChild(tdName);

      const tdA = document.createElement('td');
      tdA.className = 'num';
      tdA.textContent = String(r.appearCount);
      tr.appendChild(tdA);

      const tdAr = document.createElement('td');
      tdAr.className = 'num muted';
      tdAr.textContent = fmtPct(r.appearRate);
      tr.appendChild(tdAr);

      const tdP = document.createElement('td');
      tdP.className = 'num';
      tdP.textContent = String(r.pickCount);
      tr.appendChild(tdP);

      const tdPr = document.createElement('td');
      tdPr.className = 'num muted';
      tdPr.textContent = fmtPct(r.pickRate);
      tr.appendChild(tdPr);

      const tdL = document.createElement('td');
      tdL.className = 'num';
      tdL.textContent = String(r.leadCount);
      tr.appendChild(tdL);

      const tdLr = document.createElement('td');
      tdLr.className = 'num muted';
      tdLr.textContent = fmtPct(r.leadRate);
      tr.appendChild(tdLr);

      frag.appendChild(tr);
    }
    tbody.appendChild(frag);
  }

  function getRegLabel(reg){
    const r = normReg(reg);
    return r ? r : '未設定';
  }

  function buildRegOptions(allLogs){
    const set = new Set();
    for(const e of allLogs){
      set.add(getRegLabel(e.reg));
    }
    const regs = [...set].sort((a,b) => a.localeCompare(b,'ja'));
    return ['すべて', ...regs];
  }

  function filterByReg(logs, selected){
    if(selected === 'すべて') return logs;
    if(selected === '未設定') return logs.filter(e => !normReg(e.reg));
    return logs.filter(e => getRegLabel(e.reg) === selected);
  }

  function render(){
    const allLogs = loadLogs();

    const emptyEl = $('empty');
    if(!allLogs.length){
      emptyEl.style.display = '';
      $('selfBody').innerHTML = '';
      $('oppBody').innerHTML = '';
      $('selfMeta').textContent = '-';
      $('oppMeta').textContent = '-';
      return;
    }
    emptyEl.style.display = 'none';

    // regs
    const regSel = $('regFilter');
    const opts = buildRegOptions(allLogs);
    if(regSel.options.length === 0){
      for(const o of opts){
        const op = document.createElement('option');
        op.value = o;
        op.textContent = o;
        regSel.appendChild(op);
      }
      // restore selection
      const saved = localStorage.getItem(KEY_REG_FILTER) || 'すべて';
      if(opts.includes(saved)){
        regSel.value = saved;
      }
    }else{
      // ensure list still contains value; if not, keep as is
      if(!opts.includes(regSel.value)){
        regSel.value = 'すべて';
      }
    }

    const reg = regSel.value;
    localStorage.setItem(KEY_REG_FILTER, reg);

    const filtered = filterByReg(allLogs, reg);

    const sortKey = $('sortKey').value;
    const limit = $('limit').value;
    const q = $('q').value || '';

    const self = buildStats(filtered, 'self');
    const opp = buildStats(filtered, 'opp');

    function formatMeta(st){
      const a = st.total;
      const b = st.gamesWithPicks;
      return `対象 ${a}件 / 選出入力あり ${b}件`;
    }
    $('selfMeta').textContent = formatMeta(self);
    $('oppMeta').textContent = formatMeta(opp);

    const selfRows = sliceRows(applyFilters(self.rows, q).sort((a,b)=>compare(a,b,sortKey)), limit);
    const oppRows = sliceRows(applyFilters(opp.rows, q).sort((a,b)=>compare(a,b,sortKey)), limit);

    renderTable($('selfBody'), selfRows);
    renderTable($('oppBody'), oppRows);
  }

  function init(){
    $('btnRefresh').addEventListener('click', render);
    $('regFilter').addEventListener('change', render);
    $('limit').addEventListener('change', render);
    $('sortKey').addEventListener('change', render);
    $('q').addEventListener('input', () => {
      // light debounce
      window.clearTimeout(init._t);
      init._t = window.setTimeout(render, 120);
    });
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
