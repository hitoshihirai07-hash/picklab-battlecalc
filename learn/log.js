(() => {
  const KEY = "picklab_learning_logs_v1";
  const NAME_KEY = "picklab_pokemon_names_v1";

  const $ = (id) => document.getElementById(id);

  const msgEl = $("msg");
  const countEl = $("logCount");
  const lastEl = $("lastSaved");

  const selfSlotsEl = $("selfSlots");
  const oppSlotsEl  = $("oppSlots");
  const selfPicksEl = $("selfPicks");
  const oppPicksEl  = $("oppPicks");

  const datalist = $("pokemonList");

  const state = {
    names: [],
    self: Array(6).fill(""),
    opp:  Array(6).fill(""),
  };

  function nowJST() {
    // 表示用（ローカル）
    const d = new Date();
    const pad = (n) => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function readLogs() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function writeLogs(arr) {
    localStorage.setItem(KEY, JSON.stringify(arr));
  }

  function refreshCounters() {
    const logs = readLogs();
    countEl.textContent = String(logs.length);
    const last = logs[logs.length - 1];
    lastEl.textContent = last ? (last.savedAt || last.ts || "-") : "-";
  }

  function setMsg(html, kind="note") {
    msgEl.className = kind === "ok" ? "ok" : kind === "ng" ? "ng" : "note";
    msgEl.innerHTML = html || "";
  }

  function uniq(arr) {
    const out = [];
    const seen = new Set();
    for (const v of arr) {
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  function buildInputs() {
    const makeSlot = (side, idx) => {
      const row = document.createElement("div");
      row.className = "slotRow";
      const lbl = document.createElement("div");
      lbl.className = "lbl";
      lbl.textContent = String(idx + 1);
      const inp = document.createElement("input");
      inp.type = "text";
      inp.setAttribute("list", "pokemonList");
      inp.placeholder = "例：カイリュー";
      inp.autocomplete = "off";
      inp.spellcheck = false;
      inp.value = state[side][idx] || "";
      inp.addEventListener("input", () => {
        state[side][idx] = (inp.value || "").trim();
        rebuildPickOptions();
      });
      row.append(lbl, inp);
      return row;
    };

    selfSlotsEl.innerHTML = "";
    oppSlotsEl.innerHTML = "";
    for (let i=0;i<6;i++){
      selfSlotsEl.appendChild(makeSlot("self", i));
      oppSlotsEl.appendChild(makeSlot("opp", i));
    }

    const makePick = (side, idx) => {
      const row = document.createElement("div");
      row.className = "pickRow";
      const lbl = document.createElement("div");
      lbl.className = "lbl";
      lbl.textContent = String(idx + 1);
      const sel = document.createElement("select");
      sel.id = `${side}Pick${idx+1}`;
      sel.addEventListener("change", () => validate());
      row.append(lbl, sel);
      return row;
    };

    selfPicksEl.innerHTML = "";
    oppPicksEl.innerHTML = "";
    for (let i=0;i<3;i++){
      selfPicksEl.appendChild(makePick("self", i));
      oppPicksEl.appendChild(makePick("opp", i));
    }
  }

  function optionEl(value, label=value) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  }

  function rebuildPickOptions() {
    const fill = (side) => {
      const team = uniq(state[side].map(v => (v||"").trim()).filter(Boolean));
      for (let i=0;i<3;i++){
        const sel = document.getElementById(`${side}Pick${i+1}`);
        if (!sel) continue;
        const prev = sel.value;
        sel.innerHTML = "";
        sel.appendChild(optionEl("", "（未選択）"));
        for (const name of team) sel.appendChild(optionEl(name));
        // restore if still present
        if (team.includes(prev)) sel.value = prev;
        else sel.value = "";
      }
    };
    fill("self");
    fill("opp");
    validate();
  }

  function getPicks(side) {
    return [1,2,3].map(n => (document.getElementById(`${side}Pick${n}`)?.value || "").trim()).filter(Boolean);
  }

  function validate() {
    const selfP = getPicks("self");
    const oppP  = getPicks("opp");

    // duplicates check (within picks)
    const dup = (arr) => new Set(arr).size !== arr.length;
    const warns = [];
    if (dup(selfP)) warns.push("自分の選出に重複があります。");
    if (dup(oppP)) warns.push("相手の選出に重複があります。");

    if (warns.length) {
      setMsg(warns.map(w => `⚠️ ${w}`).join("<br>"), "ng");
    } else {
      setMsg("入力できたら「ログ収集（保存）」を押してください。", "note");
    }
  }

  async function loadNames() {
    // localStorage cache
    try {
      const cached = localStorage.getItem(NAME_KEY);
      if (cached) {
        const arr = JSON.parse(cached);
        if (Array.isArray(arr) && arr.length > 100) return arr;
      }
    } catch {}

    // fetch regulation.csv (same origin)
    const res = await fetch("../regulation.csv", { cache: "no-store" });
    if (!res.ok) throw new Error("regulation.csv fetch failed");
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    // header: No,名前,allow
    const names = [];
    const seen = new Set();
    for (let i=1;i<lines.length;i++){
      const cols = lines[i].split(",");
      const name = (cols[1] || "").trim();
      const allow = (cols[2] || "").trim().toUpperCase();
      // allowがTRUE以外もいるが、候補としては広めに（ただし空は除外）
      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
      // TRUE優先で並べたい場合は後で改善
    }
    // store cache
    try { localStorage.setItem(NAME_KEY, JSON.stringify(names)); } catch {}
    return names;
  }

  function renderDatalist(names) {
    datalist.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const n of names) frag.appendChild(optionEl(n));
    datalist.appendChild(frag);
  }

  function saveLog() {
    const selfTeam = state.self.map(v => (v||"").trim()).filter(Boolean);
    const oppTeam  = state.opp.map(v => (v||"").trim()).filter(Boolean);

    if (selfTeam.length === 0 && oppTeam.length === 0) {
      setMsg("⚠️ 自分/相手のどちらかに、1体以上入力してください。", "ng");
      return;
    }

    const entry = {
      ts: new Date().toISOString(),
      savedAt: nowJST(),
      selfTeam: state.self.map(v => (v||"").trim()),
      oppTeam:  state.opp.map(v => (v||"").trim()),
      selfPick: [1,2,3].map(n => (document.getElementById(`selfPick${n}`)?.value || "").trim()),
      oppPick:  [1,2,3].map(n => (document.getElementById(`oppPick${n}`)?.value || "").trim()),
      version: 1,
    };

    const logs = readLogs();
    logs.push(entry);
    writeLogs(logs);
    refreshCounters();

    setMsg(`✅ 保存しました（${logs.length}件目）。<br><span class="small">※このデータはこのブラウザ内にのみ保存されます。</span>`, "ok");
  }

  function clearAll() {
    state.self = Array(6).fill("");
    state.opp  = Array(6).fill("");
    // inputs
    const inputs = document.querySelectorAll("#selfSlots input, #oppSlots input");
    inputs.forEach(i => i.value = "");
    // picks
    [1,2,3].forEach(n => {
      const a = document.getElementById(`selfPick${n}`);
      const b = document.getElementById(`oppPick${n}`);
      if (a) a.value = "";
      if (b) b.value = "";
    });
    rebuildPickOptions();
    setMsg("クリアしました。次の試合を入力してください。", "note");
    // focus
    const first = document.querySelector("#selfSlots input");
    if (first) first.focus();
  }

  async function init() {
    buildInputs();
    rebuildPickOptions();
    refreshCounters();

    try {
      setMsg("候補データを読み込み中…", "note");
      state.names = await loadNames();
      renderDatalist(state.names);
      setMsg("入力できたら「ログ収集（保存）」を押してください。", "note");
    } catch (e) {
      console.error(e);
      setMsg("⚠️ 候補データの読み込みに失敗しました（regulation.csv）。<br>ただし、手入力で保存はできます。", "ng");
    }

    $("btnSave").addEventListener("click", saveLog);
    $("btnClear").addEventListener("click", clearAll);
  }

  init();
})();
