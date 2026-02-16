(() => {
  const KEY = "picklab_learning_logs_v1";
  const NAME_KEY = "picklab_pokemon_names_v1";
  const LAST_REG_KEY = "picklab_learning_last_reg_v1";

  const REG_ENABLED_KEY = "picklab_reg_allow_enabled_v1";
  const REG_CSV_KEY = "picklab_reg_allow_csv_v1";
  const ALLOW_NAME_KEY = "picklab_pokemon_names_allowed_v1";

  const $ = (id) => document.getElementById(id);

  const msgEl = $("msg");
  const countEl = $("logCount");
  const countAllEl = $("logCountAll");
  const lastEl = $("lastSaved");

  const selfSlotsEl = $("selfSlots");
  const oppSlotsEl  = $("oppSlots");
  const selfPicksEl = $("selfPicks");
  const oppPicksEl  = $("oppPicks");

  const datalist = \$\("pokemonList"\);
  const regToggle = $("toggleReg");
  const regFile = $("fileRegCsv");
  const btnRegDefault = $("btnLoadRegDefault");
  const regInfoEl = $("regInfo");

  const regInput = $("regInput");
  const regList  = $("regList");
  const regFilter = $("regFilter");
  const logListEl = $("logList");

  const PRESET_REGS = ["未設定","レギュA","レギュB","レギュC","レギュD","レギュE","レギュF","レギュG","レギュH"];

  const state = {
    names: [],
    self: Array(6).fill(""),
    opp:  Array(6).fill(""),
  };

  function nowJST() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function safeReg(v) {
    const s = (v || "").trim();
    return s ? s : "未設定";
  }

  function readLogs() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      // migrate: ensure reg exists
      for (const e of arr) {
        if (!e) continue;
        if (!("reg" in e)) e.reg = "未設定";
        e.reg = safeReg(e.reg);
      }
      return arr;
    } catch {
      return [];
    }
  }

  function writeLogs(arr) {
    localStorage.setItem(KEY, JSON.stringify(arr));
  }

  function getFilterReg() {
    const v = (regFilter?.value || "__ALL__").trim();
    return v || "__ALL__";
  }

  function getFiltered(logs) {
    const fr = getFilterReg();
    const out = [];
    for (let i=0;i<logs.length;i++){
      const e = logs[i];
      if (!e) continue;
      const reg = safeReg(e.reg);
      if (fr !== "__ALL__" && reg !== fr) continue;
      out.push({ e, idx: i });
    }
    return out;
  }

  function refreshRegControls(logs) {
    // datalist suggestions (preset + used regs)
    const regs = new Set(PRESET_REGS);
    for (const e of logs) regs.add(safeReg(e?.reg));

    regList.innerHTML = "";
    for (const r of regs) {
      const o = document.createElement("option");
      o.value = r;
      regList.appendChild(o);
    }

    // filter select
    const prev = regFilter.value || "__ALL__";
    regFilter.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "__ALL__";
    optAll.textContent = "すべて";
    regFilter.appendChild(optAll);

    // sort: presets first, then others
    const others = [...regs].filter(r => !PRESET_REGS.includes(r)).sort((a,b)=>a.localeCompare(b,'ja'));
    const ordered = [...PRESET_REGS, ...others].filter((v,i,arr)=>arr.indexOf(v)===i);

    for (const r of ordered) {
      // hide preset "未設定" if never used? no, keep it
      const o = document.createElement("option");
      o.value = r;
      o.textContent = r;
      regFilter.appendChild(o);
    }

    if ([...regFilter.options].some(o => o.value === prev)) regFilter.value = prev;
    else regFilter.value = "__ALL__";
  }

  function refreshCountersAndList() {
    const logs = readLogs();
    const filtered = getFiltered(logs);
    countEl.textContent = String(filtered.length);
    if (countAllEl) countAllEl.textContent = String(logs.length);

    const last = filtered.length ? filtered[filtered.length - 1].e : null;
    lastEl.textContent = last ? (last.savedAt || last.ts || "-") : "-";

    renderLogList(filtered);
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

  
  function clearNameCaches(){
    try { localStorage.removeItem(NAME_KEY); } catch {}
    try { localStorage.removeItem(ALLOW_NAME_KEY); } catch {}
  }

  async function getRegCsvText(){
    // Prefer user-provided CSV (stored in localStorage)
    try {
      const t = localStorage.getItem(REG_CSV_KEY);
      if (t && t.trim().length > 50) return { text: t, source: "custom" };
    } catch {}

    // Default: fetch bundled regulation.csv
    const res = await fetch("../regulation.csv", { cache: "no-store" });
    if (!res.ok) throw new Error("regulation.csv fetch failed");
    const text = await res.text();
    return { text, source: "default" };
  }

  function parseRegCsvNames(text, onlyAllowed){
    const lines = text.split(/\r?\n/).filter(Boolean);
    const names = [];
    const seen = new Set();
    // header: No,名前,allow
    for (let i=1;i<lines.length;i++){
      const cols = lines[i].split(",");
      const name = (cols[1] || "").trim();
      const allow = (cols[2] || "").trim().toUpperCase();
      if (!name) continue;
      if (onlyAllowed && allow !== "TRUE") continue;
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names;
  }

  async function loadNames(onlyAllowed) {
    const cacheKey = onlyAllowed ? ALLOW_NAME_KEY : NAME_KEY;

    // localStorage cache
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const arr = JSON.parse(cached);
        if (Array.isArray(arr) && arr.length > 100) return { names: arr, source: "cache" };
      }
    } catch {}

    const { text, source } = await getRegCsvText();
    const names = parseRegCsvNames(text, !!onlyAllowed);

    try { localStorage.setItem(cacheKey, JSON.stringify(names)); } catch {}
    return { names, source };
  }


function renderDatalist\(names\) {
    datalist\.innerHTML = "";
    const frag = document\.createDocumentFragment\(\);
    for \(const n of names\) frag\.appendChild\(optionEl\(n\)\);
    datalist\.appendChild\(frag\);
  }

  async function rebuildCandidates(){
    const onlyAllowed = !!(regToggle && regToggle.checked);
    try {
      setMsg("候補データを読み込み中…", "note");
      const { names, source } = await loadNames(onlyAllowed);
      state.names = names;
      renderDatalist(state.names);

      if (regInfoEl) {
        const mode = onlyAllowed ? "allowのみ" : "全件";
        const src = (source === "custom") ? "カスタムCSV" : (source === "default" ? "デフォルトCSV" : "キャッシュ");
        regInfoEl.textContent = `候補: ${names.length}（${mode} / ${src}）`;
      }
      validate();
    } catch (e) {
      console.error(e);
      if (regInfoEl) regInfoEl.textContent = "候補: -（読み込み失敗）";
      setMsg("⚠️ 候補データの読み込みに失敗しました（regulation.csv）。<br>ただし、手入力で保存はできます。", "ng");
    }
  }

  function renderLogList(filtered) {
    // show latest 20 (newest last in storage)
    const last20 = filtered.slice(Math.max(0, filtered.length - 20));
    logListEl.innerHTML = "";

    if (!last20.length) {
      logListEl.innerHTML = "（該当ログなし）";
      return;
    }

    for (let i=last20.length-1;i>=0;i--){
      const { e, idx } = last20[i];
      const div = document.createElement("div");
      div.className = "logItem";
      const left = document.createElement("div");
      left.className = "logLeft";

      const meta = document.createElement("div");
      meta.className = "logMeta";
      const t = document.createElement("span");
      t.className = "pill mono";
      t.textContent = e.savedAt || (e.ts ? String(e.ts).replace("T"," ").slice(0,19) : "-");

      const r = document.createElement("span");
      r.className = "pill";
      r.textContent = safeReg(e.reg);

      meta.append(t, r);

      const line1 = document.createElement("div");
      line1.className = "small";
      const selfPick = (e.selfPick || []).filter(Boolean).join(" / ");
      const oppPick = (e.oppPick || []).filter(Boolean).join(" / ");
      line1.innerHTML = `<b>自分選出</b>: ${selfPick || "（未）"} <span class="muted">/</span> <b>相手選出</b>: ${oppPick || "（未）"}`;

      const line2 = document.createElement("div");
      line2.className = "small muted";
      const selfTeam = (e.selfTeam || []).filter(Boolean).join(" / ");
      const oppTeam  = (e.oppTeam  || []).filter(Boolean).join(" / ");
      line2.innerHTML = `<b>自</b>: ${selfTeam || "-"}<br><b>相</b>: ${oppTeam || "-"}`;

      left.append(meta, line1, line2);

      const btn = document.createElement("button");
      btn.className = "btn danger";
      btn.type = "button";
      btn.textContent = "削除";
      btn.addEventListener("click", () => deleteLog(idx));

      div.append(left, btn);
      logListEl.appendChild(div);
    }
  }

  function deleteLog(idx) {
    const logs = readLogs();
    if (idx < 0 || idx >= logs.length) return;
    logs.splice(idx, 1);
    writeLogs(logs);
    refreshRegControls(logs);
    refreshCountersAndList();
    setMsg("削除しました。", "ok");
  }

  function saveLog() {
    const selfTeam = state.self.map(v => (v||"").trim()).filter(Boolean);
    const oppTeam  = state.opp.map(v => (v||"").trim()).filter(Boolean);

    if (selfTeam.length === 0 && oppTeam.length === 0) {
      setMsg("⚠️ 自分/相手のどちらかに、1体以上入力してください。", "ng");
      return;
    }

    const reg = safeReg(regInput?.value);

    const entry = {
      ts: new Date().toISOString(),
      savedAt: nowJST(),
      reg,
      selfTeam: state.self.map(v => (v||"").trim()),
      oppTeam:  state.opp.map(v => (v||"").trim()),
      selfPick: [1,2,3].map(n => (document.getElementById(`selfPick${n}`)?.value || "").trim()),
      oppPick:  [1,2,3].map(n => (document.getElementById(`oppPick${n}`)?.value || "").trim()),
      version: 2,
    };

    const logs = readLogs();
    logs.push(entry);
    writeLogs(logs);
    try { localStorage.setItem(LAST_REG_KEY, reg); } catch {}

    refreshRegControls(logs);
    refreshCountersAndList();

    setMsg(`✅ 保存しました（全${logs.length}件）。<br><span class="small">※このデータはこのブラウザ内にのみ保存されます。</span>`, "ok");
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
    const first = document.querySelector("#selfSlots input");
    if (first) first.focus();
  }

  async function init() {
    buildInputs();
    rebuildPickOptions();

    const logs = readLogs();
    // last used reg
    try {
      const last = localStorage.getItem(LAST_REG_KEY);
      if (last) regInput.value = safeReg(last);
    } catch {}

    refreshRegControls(logs);
    refreshCountersAndList();

    // --- Candidate filter (regulation allow-list) ---
    try {
      // default: ON if not set
      if (regToggle) {
        let v = null;
        try { v = localStorage.getItem(REG_ENABLED_KEY); } catch {}
        regToggle.checked = (v === null) ? true : (v === "1" || v === "true");
        regToggle.addEventListener("change", async () => {
          try { localStorage.setItem(REG_ENABLED_KEY, regToggle.checked ? "1" : "0"); } catch {}
          await rebuildCandidates();
        });
      }

      if (regFile) {
        regFile.addEventListener("change", async () => {
          const f = regFile.files && regFile.files[0];
          if (!f) return;
          try {
            const text = await f.text();
            try { localStorage.setItem(REG_CSV_KEY, text); } catch {}
            clearNameCaches();
            await rebuildCandidates();
            setMsg("CSVを読み込みました。候補が更新されました。", "ok");
          } catch (e) {
            console.error(e);
            setMsg("⚠️ CSVの読み込みに失敗しました。", "ng");
          } finally {
            try { regFile.value = ""; } catch {}
          }
        });
      }

      if (btnRegDefault) {
        btnRegDefault.addEventListener("click", async () => {
          try { localStorage.removeItem(REG_CSV_KEY); } catch {}
          clearNameCaches();
          await rebuildCandidates();
          setMsg("デフォルトCSVを適用しました。", "ok");
        });
      }
    } catch {}
    await rebuildCandidates();

    $("btnSave").addEventListener("click", saveLog);
    $("btnClear").addEventListener("click", clearAll);
    regFilter.addEventListener("change", () => refreshCountersAndList());
  }

  init();
})();