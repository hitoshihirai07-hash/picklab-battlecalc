/* Pick Lab 学習ログ /learn/ 用 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // Storage keys
  const KEY_LOGS = 'picklab_learn_logs_v1';
  const KEY_LAST_REG = 'picklab_learn_last_reg_v1';
  const KEY_REG_FILTER = 'picklab_learn_reg_filter_v1';
  const KEY_ALLOW_ONLY = 'picklab_learn_allow_only_v1';

  const MAX_LOGS = 2000;
  const SHOW_LOGS = 20;

  // DOM
  const el = {
    selfSlots: $('selfSlots'),
    oppSlots: $('oppSlots'),
    selfPicks: $('selfPicks'),
    oppPicks: $('oppPicks'),
    pokemonList: $('pokemonList'),

    regInput: $('regInput'),
    regList: $('regList'),
    regFilter: $('regFilter'),

    toggleReg: $('toggleReg'),
    btnLoadRegDefault: $('btnLoadRegDefault'),
    regInfo: $('regInfo'),

    btnSave: $('btnSave'),
    btnClear: $('btnClear'),
    msg: $('msg'),

    logList: $('logList'),
    logCount: $('logCount'),
    logCountAll: $('logCountAll'),
    lastSaved: $('lastSaved'),
  };

  // Data
  let pokemonAll = [];
  let pokemonAllowed = [];
  let regulationSource = '../regulation.csv';

  function safeText(s) {
    return (s ?? '').toString();
  }

  function uniqKeepOrder(arr) {
    const seen = new Set();
    const out = [];
    for (const v of arr) {
      const k = v.trim();
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  }

  function nowISO() {
    const d = new Date();
    return d.toISOString().replace('T', ' ').replace('Z', '');
  }

  function showMsg(kind, text) {
    if (!el.msg) return;
    el.msg.className = `note ${kind === 'ok' ? 'ok' : kind === 'ng' ? 'ng' : ''}`.trim();
    el.msg.textContent = text || '';
  }

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadLogs() {
    const logs = loadJSON(KEY_LOGS, []);
    if (!Array.isArray(logs)) return [];
    return logs;
  }

  function saveLogs(logs) {
    const trimmed = logs.slice(0, MAX_LOGS);
    saveJSON(KEY_LOGS, trimmed);
  }

  // --- CSV parsing (simple)
  function parseCSV(text) {
    const lines = safeText(text).replace(/\r/g, '').split('\n').filter(l => l.trim().length);
    if (!lines.length) return { header: [], rows: [] };

    const header = lines[0].split(',').map(s => s.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      rows.push(cols.map(s => (s ?? '').trim()));
    }
    return { header, rows };
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
    return await res.text();
  }

  async function loadRegulationCSV(url) {
    const csvText = await fetchText(url);
    const { header, rows } = parseCSV(csvText);

    const idxNo = header.indexOf('No');
    const idxName = header.indexOf('名前');
    const idxAllow = header.indexOf('allow');

    const tmp = [];
    const tmpAllowed = [];

    for (const r of rows) {
      const name = idxName >= 0 ? (r[idxName] || '').trim() : '';
      if (!name) continue;

      const noStr = idxNo >= 0 ? (r[idxNo] || '') : '';
      const no = parseInt(noStr, 10);
      const allow = idxAllow >= 0 ? (r[idxAllow] || '').trim().toUpperCase() : '';

      tmp.push({ no: Number.isFinite(no) ? no : 999999, name, allow });
      if (allow === 'TRUE') tmpAllowed.push({ no: Number.isFinite(no) ? no : 999999, name, allow });
    }

    tmp.sort((a, b) => (a.no - b.no) || a.name.localeCompare(b.name, 'ja'));
    tmpAllowed.sort((a, b) => (a.no - b.no) || a.name.localeCompare(b.name, 'ja'));

    pokemonAll = uniqKeepOrder(tmp.map(x => x.name));
    pokemonAllowed = uniqKeepOrder(tmpAllowed.map(x => x.name));

    regulationSource = url;
    updateRegInfo();
    renderPokemonDatalist();
    refreshPickOptions();
  }

  function updateRegInfo() {
    const allowOnly = !!loadJSON(KEY_ALLOW_ONLY, true);
    const total = pokemonAll.length;
    const allowed = pokemonAllowed.length;
    el.regInfo.textContent = `候補: ${allowOnly ? allowed : total}件（${allowOnly ? 'allow=TRUE' : '全件'}）`;
  }

  function renderPokemonDatalist() {
    const allowOnly = !!loadJSON(KEY_ALLOW_ONLY, true);
    el.toggleReg.checked = allowOnly;

    const list = allowOnly ? pokemonAllowed : pokemonAll;
    el.pokemonList.innerHTML = list.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
    updateRegInfo();
  }

  function escapeHtml(s) {
    return safeText(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // --- UI rendering
  function renderSlots(container, prefix) {
    container.innerHTML = '';
    for (let i = 1; i <= 6; i++) {
      const row = document.createElement('div');
      row.className = 'slotRow';

      const lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.textContent = String(i);

      const input = document.createElement('input');
      input.type = 'text';
      input.id = `${prefix}${i}`;
      input.setAttribute('list', 'pokemonList');
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = 'ポケモン名';

      input.addEventListener('input', () => {
        refreshPickOptions();
      });

      row.appendChild(lbl);
      row.appendChild(input);
      container.appendChild(row);
    }
  }

  function renderPicks(container, prefix) {
    container.innerHTML = '';
    for (let i = 1; i <= 3; i++) {
      const row = document.createElement('div');
      row.className = 'pickRow';

      const lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.textContent = String(i);

      const sel = document.createElement('select');
      sel.id = `${prefix}${i}`;
      row.appendChild(lbl);
      row.appendChild(sel);
      container.appendChild(row);
    }
  }

  function getTeam(prefix) {
    const out = [];
    for (let i = 1; i <= 6; i++) {
      const v = safeText($(prefix + i)?.value).trim();
      out.push(v);
    }
    return out;
  }

  function setTeam(prefix, arr) {
    for (let i = 1; i <= 6; i++) {
      const v = (arr && arr[i - 1]) ? safeText(arr[i - 1]) : '';
      const elInput = $(prefix + i);
      if (elInput) elInput.value = v;
    }
  }

  function getPicks(prefix) {
    const out = [];
    for (let i = 1; i <= 3; i++) {
      out.push(safeText($(prefix + i)?.value).trim());
    }
    return out;
  }

  function setPicks(prefix, arr) {
    for (let i = 1; i <= 3; i++) {
      const sel = $(prefix + i);
      if (!sel) continue;
      sel.value = (arr && arr[i - 1]) ? safeText(arr[i - 1]) : '';
    }
  }

  function refreshPickOptions() {
    const self = uniqKeepOrder(getTeam('self').filter(Boolean));
    const opp = uniqKeepOrder(getTeam('opp').filter(Boolean));

    updatePickOptions('selfPick', self);
    updatePickOptions('oppPick', opp);
  }

  function updatePickOptions(prefix, teamList) {
    for (let i = 1; i <= 3; i++) {
      const sel = $(prefix + i);
      if (!sel) continue;
      const current = safeText(sel.value);

      const opts = [''].concat(teamList);
      sel.innerHTML = opts.map(v => `<option value="${escapeHtml(v)}">${v ? escapeHtml(v) : '未選択'}</option>`).join('');

      // restore if possible
      if (opts.includes(current)) sel.value = current;
    }
  }

  // --- Regulation input/filter
  function normalizeReg(s) {
    return safeText(s).trim();
  }

  function buildRegOptions(logs) {
    const regsUsed = new Set();
    for (const it of logs) {
      const r = normalizeReg(it.reg);
      regsUsed.add(r || '未設定');
    }

    // Add common set (レギュA-H) so user can pick quickly
    const common = ['レギュA','レギュB','レギュC','レギュD','レギュE','レギュF','レギュG','レギュH'];
    for (const c of common) regsUsed.add(c);

    // Sort: put common A-H first (if present), then others, keep 未設定 last
    const list = [];
    for (const c of common) if (regsUsed.has(c)) list.push(c);

    const others = [...regsUsed].filter(r => !common.includes(r) && r !== '未設定');
    others.sort((a, b) => a.localeCompare(b, 'ja'));
    list.push(...others);
    if (regsUsed.has('未設定')) list.push('未設定');

    return list;
  }

  function renderRegDatalistAndFilter() {
    const logs = loadLogs();
    const regs = buildRegOptions(logs);

    // datalist for input autocomplete
    el.regList.innerHTML = regs
      .filter(r => r !== '未設定')
      .map(r => `<option value="${escapeHtml(r)}"></option>`)
      .join('');

    // filter select
    const saved = loadJSON(KEY_REG_FILTER, 'all');
    const options = [{ v: 'all', t: 'すべて' }]
      .concat(regs.map(r => ({ v: r, t: r })));

    el.regFilter.innerHTML = options
      .map(o => `<option value="${escapeHtml(o.v)}">${escapeHtml(o.t)}</option>`)
      .join('');

    el.regFilter.value = options.some(o => o.v === saved) ? saved : 'all';
  }

  function getFilterValue() {
    const v = safeText(el.regFilter.value);
    return v || 'all';
  }

  // --- Logs rendering
  function renderLogs() {
    const logs = loadLogs();
    const filter = getFilterValue();

    const filtered = (filter === 'all')
      ? logs
      : logs.filter(it => (normalizeReg(it.reg) || '未設定') === filter);

    const show = filtered.slice(0, SHOW_LOGS);

    el.logCountAll.textContent = String(logs.length);
    el.logCount.textContent = String(filtered.length);
    el.lastSaved.textContent = logs.length ? safeText(logs[0].iso || '') : '-';

    el.logList.innerHTML = show.length ? show.map(renderLogItem).join('') : '（ログなし）';

    // bind delete
    el.logList.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del');
        deleteLog(id);
      });
    });

    // rebuild reg options (so new regs appear)
    renderRegDatalistAndFilter();
  }

  function renderLogItem(it) {
    const reg = normalizeReg(it.reg) || '未設定';
    const t = safeText(it.iso || '');
    const selfTeam = (it.selfTeam || []).filter(Boolean).join(' / ') || '（自分6未入力）';
    const oppTeam = (it.oppTeam || []).filter(Boolean).join(' / ') || '（相手6未入力）';

    const selfPick = (it.selfPick || []).filter(Boolean).join(', ') || '-';
    const oppPick = (it.oppPick || []).filter(Boolean).join(', ') || '-';

    return `
      <div class="logItem">
        <div class="logLeft">
          <div class="logMeta">
            <span class="pill">${escapeHtml(reg)}</span>
            <span class="pill mono">${escapeHtml(t)}</span>
          </div>
          <div class="small" style="margin-top:6px">
            <b>自分:</b> ${escapeHtml(selfTeam)}
          </div>
          <div class="small" style="margin-top:4px">
            <b>相手:</b> ${escapeHtml(oppTeam)}
          </div>
          <div class="small muted" style="margin-top:6px">
            選出: 自分[${escapeHtml(selfPick)}] / 相手[${escapeHtml(oppPick)}]
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
          <button class="btn danger" type="button" data-del="${escapeHtml(it.id)}">削除</button>
        </div>
      </div>
    `;
  }

  function deleteLog(id) {
    const logs = loadLogs();
    const next = logs.filter(it => safeText(it.id) !== safeText(id));
    saveLogs(next);
    showMsg('ok', '削除しました。');
    renderLogs();
  }

  // --- Save/Clear
  function validateBeforeSave(entry) {
    const hasAny = entry.selfTeam.some(Boolean) || entry.oppTeam.some(Boolean);
    if (!hasAny) return '自分/相手のポケモンが1体も入力されていません。';
    return '';
  }

  function onSave() {
    const reg = normalizeReg(el.regInput.value);
    const entry = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      ts: Date.now(),
      iso: nowISO(),
      reg,
      selfTeam: getTeam('self').map(v => v.trim()),
      oppTeam: getTeam('opp').map(v => v.trim()),
      selfPick: getPicks('selfPick').map(v => v.trim()).filter(Boolean).slice(0, 3),
      oppPick: getPicks('oppPick').map(v => v.trim()).filter(Boolean).slice(0, 3),
    };

    const err = validateBeforeSave(entry);
    if (err) {
      showMsg('ng', err);
      return;
    }

    const logs = loadLogs();
    logs.unshift(entry);
    saveLogs(logs);

    if (reg) localStorage.setItem(KEY_LAST_REG, reg);

    showMsg('ok', '保存しました。');
    renderLogs();
  }

  function onClear() {
    setTeam('self', ['', '', '', '', '', '']);
    setTeam('opp', ['', '', '', '', '', '']);
    refreshPickOptions();
    setPicks('selfPick', ['', '', '']);
    setPicks('oppPick', ['', '', '']);
    showMsg('', '');
  }

  // --- init
  async function init() {
    // base UI
    renderSlots(el.selfSlots, 'self');
    renderSlots(el.oppSlots, 'opp');
    renderPicks(el.selfPicks, 'selfPick');
    renderPicks(el.oppPicks, 'oppPick');

    // load saved settings
    const lastReg = safeText(localStorage.getItem(KEY_LAST_REG)).trim();
    if (lastReg) el.regInput.value = lastReg;

    const allowOnly = loadJSON(KEY_ALLOW_ONLY, true);
    el.toggleReg.checked = !!allowOnly;

    // handlers
    el.btnSave.addEventListener('click', onSave);
    el.btnClear.addEventListener('click', onClear);

    el.regFilter.addEventListener('change', () => {
      saveJSON(KEY_REG_FILTER, el.regFilter.value);
      renderLogs();
    });

    el.toggleReg.addEventListener('change', () => {
      saveJSON(KEY_ALLOW_ONLY, el.toggleReg.checked);
      renderPokemonDatalist();
      // no need to rerender logs
    });

    el.btnLoadRegDefault.addEventListener('click', async () => {
      try {
        await loadRegulationCSV('../regulation.csv');
        showMsg('ok', 'regulation.csv を読み込みました。');
      } catch (e) {
        showMsg('ng', `regulation.csv の読み込みに失敗しました: ${e.message}`);
      }
    });

    // init reg options / logs list
    renderRegDatalistAndFilter();
    renderLogs();

    // Load regulation csv (for datalist)
    try {
      await loadRegulationCSV('../regulation.csv');
    } catch (e) {
      // Fallback: still allow manual input
      pokemonAll = [];
      pokemonAllowed = [];
      renderPokemonDatalist();
      showMsg('ng', `regulation.csv の読み込みに失敗しました。入力候補なしで動作します。 (${e.message})`);
    }

    // initial pick options
    refreshPickOptions();
  }

  init();
})();
