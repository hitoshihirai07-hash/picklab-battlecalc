(() => {
  const AI_STATE_KEY = "PICKLAB_AI_STATE";
  const AI_SCENARIO_KEY = "PICKLAB_AI_SCENARIO";
  const $ = (sel, root=document) => root.querySelector(sel);

  // Keep ID normalization consistent with main page
  function normalize(s){ return (s||"").toLowerCase().replace(/[\s'’\-_.:]/g, ""); }
  function normalizeId(id){ return normalize(id).replace(/[^a-z0-9]/g, ""); }

  // --- type chart (same as main) ---
  const TYPE_JA = {
    Normal: "ノーマル", Fire: "ほのお", Water: "みず", Electric: "でんき", Grass: "くさ", Ice: "こおり",
    Fighting: "かくとう", Poison: "どく", Ground: "じめん", Flying: "ひこう", Psychic: "エスパー", Bug: "むし",
    Rock: "いわ", Ghost: "ゴースト", Dragon: "ドラゴン", Dark: "あく", Steel: "はがね", Fairy: "フェアリー",
  };
  const TYPE_CHART = {
    Normal:   {Rock:.5, Ghost:0, Steel:.5},
    Fire:     {Fire:.5, Water:.5, Grass:2, Ice:2, Bug:2, Rock:.5, Dragon:.5, Steel:2},
    Water:    {Fire:2, Water:.5, Grass:.5, Ground:2, Rock:2, Dragon:.5},
    Electric: {Water:2, Electric:.5, Grass:.5, Ground:0, Flying:2, Dragon:.5},
    Grass:    {Fire:.5, Water:2, Grass:.5, Poison:.5, Ground:2, Flying:.5, Bug:.5, Rock:2, Dragon:.5, Steel:.5},
    Ice:      {Fire:.5, Water:.5, Grass:2, Ice:.5, Ground:2, Flying:2, Dragon:2, Steel:.5},
    Fighting: {Normal:2, Ice:2, Poison:.5, Flying:.5, Psychic:.5, Bug:.5, Rock:2, Ghost:0, Dark:2, Steel:2, Fairy:.5},
    Poison:   {Grass:2, Poison:.5, Ground:.5, Rock:.5, Ghost:.5, Steel:0, Fairy:2},
    Ground:   {Fire:2, Electric:2, Grass:.5, Poison:2, Flying:0, Bug:.5, Rock:2, Steel:2},
    Flying:   {Electric:.5, Grass:2, Fighting:2, Bug:2, Rock:.5, Steel:.5},
    Psychic:  {Fighting:2, Poison:2, Psychic:.5, Dark:0, Steel:.5},
    Bug:      {Fire:.5, Grass:2, Fighting:.5, Poison:.5, Flying:.5, Psychic:2, Ghost:.5, Dark:2, Steel:.5, Fairy:.5},
    Rock:     {Fire:2, Ice:2, Fighting:.5, Ground:.5, Flying:2, Bug:2, Steel:.5},
    Ghost:    {Normal:0, Psychic:2, Ghost:2, Dark:.5},
    Dragon:   {Dragon:2, Steel:.5, Fairy:0},
    Dark:     {Fighting:.5, Psychic:2, Ghost:2, Dark:.5, Fairy:.5},
    Steel:    {Fire:.5, Water:.5, Electric:.5, Ice:2, Rock:2, Fairy:2, Steel:.5},
    Fairy:    {Fire:.5, Fighting:2, Poison:.5, Dragon:2, Dark:2, Steel:.5},
  };

  function typeEffect(attType, defTypes){
    let m = 1;
    for (const dt of (defTypes||[])) {
      const row = TYPE_CHART[attType] || {};
      const v = (dt in row) ? row[dt] : 1;
      m *= v;
    }
    return m;
  }

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
  function int(n, d=0){
    const x = Number(n);
    return Number.isFinite(x) ? x : d;
  }

  function escapeHtml(s){
    return (s ?? "").toString()
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#39;");
  }

  function setStatus(msg, kind="note"){
    const box = $("#aiStatus");
    if (!box) return;
    box.className = kind === "err" ? "err" : (kind === "ok" ? "ok" : "note");
    box.textContent = msg;
  }

  async function fetchJson(url){
    const r = await fetch(url, {cache:"force-cache"});
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return await r.json();
  }

  // Moves that immediately reduce "free setup" risk
  const STOP_SETUP = new Set([
    "taunt", "encore", "roar", "whirlwind", "haze", "clearsmog",
    "dragontail", "circlethrow", "spectralthief",
  ]);

  function fmtType(t){ return TYPE_JA[t] || t || ""; }

  function pctText(x){
    const v = Math.round(clamp(x, 0, 100));
    return `${v}%`;
  }

  function buildOption(label, value){
    const o = document.createElement("option");
    o.value = String(value);
    o.textContent = label;
    return o;
  }

  function uniq(arr){ return Array.from(new Set(arr)); }

  // --- Main ---
  async function main(){
    const raw = localStorage.getItem(AI_STATE_KEY);
    if (!raw){
      setStatus("引き継ぎデータがありません。メインページで『AI提案ページへ』を押してください。", "err");
      return;
    }

    let payload;
    try{ payload = JSON.parse(raw); }
    catch{ setStatus("引き継ぎデータの解析に失敗しました。メインから開き直してください。", "err"); return; }

    const app = payload.app || payload;
    const ui = app.ui || {};
    const teams = app.teams || {left:[], right:[]};

    setStatus("データ読込中…", "note");

    // Load required data
    const [jpList, itemList, pokedex, movesDb, moveEnJa, setupIndex] = await Promise.all([
      fetchJson("./dex/jp/POKEMON_ALL.json"),
      fetchJson("./dex/jp/ITEM_ALL.json").catch(()=>[]),
      fetchJson("./dex/ps/pokedex.json"),
      fetchJson("./dex/ps/moves.json"),
      fetchJson("./dex/jp/move_en_ja.json").catch(()=>({})),
      fetchJson("./dex/ps/setup_index.json").catch(()=>({dragondance:[], swordsdance:[]})),
    ]);

    // Build Japanese name map (Showdown id -> {ja,en})
    const nameById = new Map();
    for (const p of (jpList||[])){
      const sid = p?.pkmn_id_name || p?.pokeapi_pokemon_id_name;
      if (!sid) continue;
      const jaBase = p?.pokeapi_species_name_ja || p?.yakkuncom_name || p?.pokeapi_species_name_en || "";
      const jaForm = p?.pokeapi_form_name_ja || "";
      const ja = (jaForm && jaForm !== "なし") ? `${jaBase}（${jaForm}）` : jaBase;
      const en = p?.pkmn_name || p?.pokeapi_species_name_en || sid;
      nameById.set(normalizeId(sid), {ja, en});
    }


    // Build item Japanese map (English -> Japanese)
    const itemJaByEn = new Map();
    for (const it of (itemList||[])){
      const en = it?.name_en;
      const ja = it?.name_ja;
      if (!en || !ja) continue;
      itemJaByEn.set(String(en).toLowerCase(), ja);
    }
    function itemNameJa(itemEn){
      if (!itemEn) return "";
      const ja = itemJaByEn.get(String(itemEn).toLowerCase());
      return ja || itemEn;
    }

    function monNameJa(speciesId){
      if (!speciesId) return "";
      const sid = normalizeId(speciesId);
      const hit = nameById.get(sid);
      if (hit?.ja) return hit.ja;
      // Fallback: try pokedex name (English) if translation missing
      const px = pokedex?.[speciesId] || pokedex?.[sid];
      return px?.name || speciesId;
    }

    const ddSet = new Set(setupIndex.dragondance || []);
    const sdSet = new Set(setupIndex.swordsdance || []);

    const leftTeam = teams.left || [];
    const rightTeam = teams.right || [];

    const leftPicked = leftTeam.map((m,idx)=>({m,idx})).filter(x => x.m && x.m.speciesId && x.m.pick);
    const rightPicked = rightTeam.map((m,idx)=>({m,idx})).filter(x => x.m && x.m.speciesId && x.m.pick);

    const leftPool = leftPicked.length ? leftPicked : leftTeam.map((m,idx)=>({m,idx})).filter(x => x.m && x.m.speciesId);
    const rightPool = rightPicked.length ? rightPicked : rightTeam.map((m,idx)=>({m,idx})).filter(x => x.m && x.m.speciesId);

    // --- Summary ---
    const summary = [];
    summary.push(`<div><b>保存日時</b>: ${escapeHtml(payload.savedAt || "（不明）")}</div>`);
    summary.push(`<div class="small" style="margin-top:6px">通常ルール: ${ui.normalRules?"ON":"OFF"} / 伝説・幻除外: ${ui.noLegends?"ON":"OFF"} / レギュ適用: ${ui.regEnabled?"ON":"OFF"}</div>`);
    summary.push("<div class=\"hr\"></div>");

    const leftNames = leftPicked.map(x => monNameJa(x.m.speciesId));
    summary.push("<div><b>左（あなた側）選出</b></div>");
    summary.push(leftNames.length ? `<ul style="margin:8px 0 0 18px">${leftNames.map(n=>`<li>${escapeHtml(n)}</li>`).join("")}</ul>` : `<div class="small">（未選出：メインで3体チェックすると精度が上がります）</div>`);

    summary.push("<div style=\"margin-top:10px\"><b>右（相手側）選出</b></div>");
    if (ui.hideRightPicks){
      summary.push(`<div class="small">相手選出は『隠す』設定のため非表示です（チーム情報は保持しています）</div>`);
    }else{
      const rightNames = rightPicked.map(x => monNameJa(x.m.speciesId));
      summary.push(rightNames.length ? `<ul style="margin:8px 0 0 18px">${rightNames.map(n=>`<li>${escapeHtml(n)}</li>`).join("")}</ul>` : `<div class="small">（未選出）</div>`);
    }

    $("#aiSummary").innerHTML = summary.join("");

    // --- Team detail (for checking what you set on the main page) ---
    function evShort(evs){
      if (!evs) return "";
      const H = evs.hp||0, A=evs.atk||0, B=evs.def||0, C=evs.spa||0, D=evs.spd||0, S=evs.spe||0;
      const parts = [];
      if (H) parts.push(`H${H}`);
      if (A) parts.push(`A${A}`);
      if (B) parts.push(`B${B}`);
      if (C) parts.push(`C${C}`);
      if (D) parts.push(`D${D}`);
      if (S) parts.push(`S${S}`);
      return parts.length ? parts.join(" ") : "0";
    }
    function teraJa(t){
      if (!t) return "";
      return TYPE_JA[t] || t;
    }
    function movesShort(moves){
      const arr = (moves||[]).filter(Boolean);
      if (!arr.length) return "";
      return arr.map(moveNameJa).join(" / ");
    }

    function renderTeamTable(team, pickedIdxSet, hideDetails=false){
      const rows = [];
      rows.push(`<table class="tbl" style="width:100%;border-collapse:collapse">`);
      rows.push(`<thead><tr>
        <th style="text-align:left;padding:6px 8px">#</th>
        <th style="text-align:left;padding:6px 8px">ポケモン</th>
        <th style="text-align:left;padding:6px 8px">持ち物</th>
        <th style="text-align:left;padding:6px 8px">テラ</th>
        <th style="text-align:left;padding:6px 8px">EV</th>
        <th style="text-align:left;padding:6px 8px">技</th>
      </tr></thead><tbody>`);
      (team||[]).forEach((m, i) => {
        const picked = pickedIdxSet.has(i);
        const name = monNameJa(m?.speciesId) || "（未設定）";
        const item = hideDetails ? "（非表示）" : (itemNameJa(m?.item) || "");
        const tera = hideDetails ? "（非表示）" : teraJa(m?.teraType);
        const ev = hideDetails ? "（非表示）" : evShort(m?.evs);
        const mv = hideDetails ? "（非表示）" : movesShort(m?.moves);
        rows.push(`<tr>
          <td style="padding:6px 8px;white-space:nowrap">${picked ? "★" : ""}${i+1}</td>
          <td style="padding:6px 8px">${escapeHtml(name)}</td>
          <td style="padding:6px 8px">${escapeHtml(item)}</td>
          <td style="padding:6px 8px">${escapeHtml(tera)}</td>
          <td style="padding:6px 8px">${escapeHtml(ev)}</td>
          <td style="padding:6px 8px">${escapeHtml(mv)}</td>
        </tr>`);
      });
      rows.push(`</tbody></table>`);
      return rows.join("");
    }

    const detailBox = $("#aiTeamDetails");
    if (detailBox){
      const leftPickedIdx = new Set(leftPicked.map(x=>x.idx));
      const rightPickedIdx = new Set(rightPicked.map(x=>x.idx));
      const hideRight = !!ui.hideRightPicks;
      const parts = [];
      parts.push(`<div><b>左（あなた側）6体</b></div>`);
      parts.push(renderTeamTable(teams.left, leftPickedIdx, false));
      parts.push(`<div class="hr"></div>`);
      parts.push(`<div><b>右（相手側）6体</b> ${hideRight ? '<span class="small">（相手選出を隠すONのため詳細は非表示）</span>' : ''}</div>`);
      parts.push(renderTeamTable(teams.right, rightPickedIdx, hideRight));
      detailBox.innerHTML = parts.join("");
    }

    // Buttons
    const reloadBtn = $("#btnReloadAiState");
    if (reloadBtn) reloadBtn.addEventListener("click", () => location.reload());

    async function copyText(text){
      try{
        await navigator.clipboard.writeText(text);
        setStatus("コピーしました。", "ok");
      }catch(e){
        // Fallback
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try{ document.execCommand("copy"); setStatus("コピーしました。", "ok"); }catch(_){ setStatus("コピーに失敗しました。", "err"); }
        document.body.removeChild(ta);
      }
    }

    const copyBtn = $("#btnCopyAiState");
    if (copyBtn) copyBtn.addEventListener("click", () => {
      const text = [$("#aiSummary")?.innerText, $("#aiTeamDetails")?.innerText].filter(Boolean).join("\n\n");
      copyText(text);
    });


    // --- Populate active selectors ---
    const selL = $("#selLeftActive");
    const selR = $("#selRightActive");
    selL.innerHTML = "";
    selR.innerHTML = "";

    for (const {m, idx} of leftPool){
      const nm = monNameJa(m.speciesId);
      selL.appendChild(buildOption(nm, idx));
    }
    for (const {m, idx} of rightPool){
      const nm = monNameJa(m.speciesId);
      selR.appendChild(buildOption(nm, idx));
    }

    // Defaults
    if (selL.options.length) selL.value = String(leftPool[0].idx);
    if (selR.options.length) selR.value = String(rightPool[0].idx);

    // --- Ally HP state for picked 3 ---
    const allyHP = new Map(); // idx -> hp
    for (const {idx} of leftPool.slice(0,3)) allyHP.set(idx, 100);
    // Prefer actual picked (3) if exists
    if (leftPicked.length){
      allyHP.clear();
      for (const {idx} of leftPicked) allyHP.set(idx, 100);
    }

    function getTypes(speciesId){
      const p = pokedex?.[speciesId];
      return (p && p.types) ? p.types : [];
    }

    function moveNameJa(moveId){
      if (!moveId) return "";
      const mv = movesDb?.[moveId];
      const en = mv?.name || moveId;
      return moveEnJa?.[en] || en;
    }

    function moveInfo(moveId){
      const mv = movesDb?.[moveId];
      if (!mv) return null;
      return {
        id: moveId,
        en: mv.name || moveId,
        ja: moveEnJa?.[mv.name] || mv.name || moveId,
        type: mv.type,
        category: mv.category,
        basePower: mv.basePower || 0,
      };
    }

    function isStopMove(moveId){
      return STOP_SETUP.has(moveId);
    }

    function predictDamagePct(attMon, moveId, defMon){
      const mv = moveInfo(moveId);
      if (!mv) return 0;
      if (mv.category === "Status") return 0;
      const bp = mv.basePower || 60;
      const attTypes = getTypes(attMon.speciesId);
      const defTypes = getTypes(defMon.speciesId);
      const stab = attTypes.includes(mv.type) ? 1.5 : 1.0;
      const eff = typeEffect(mv.type, defTypes);
      const raw = bp * stab * eff;
      // rough mapping: 200 raw ≒ 100%
      const dmg = raw / 2;
      return clamp(dmg, 0, 100);
    }

    function bestThreatPct(mon, oppMon){
      const moveIds = (mon.moves||[]).filter(x=>!!x);
      let best = 0;
      let bestMove = "";
      for (const id of moveIds){
        const p = predictDamagePct(mon, id, oppMon);
        if (p > best){ best = p; bestMove = id; }
      }
      return {best, bestMove};
    }

    function hasAntiSetup(allies){
      for (const a of allies){
        if (!a?.speciesId) continue;
        // Unaware
        if ((a.ability||"").toLowerCase() === "unaware") return true;
        for (const mv of (a.moves||[])){
          if (STOP_SETUP.has(mv)) return true;
        }
      }
      return false;
    }

    function defenseWorstMult(defMon, oppTypes){
      const defTypes = getTypes(defMon.speciesId);
      let worst = 1;
      for (const t of oppTypes){
        worst = Math.max(worst, typeEffect(t, defTypes));
      }
      return worst;
    }

    function safeSwitchCount(allies, oppTypes, activeIdx){
      let c = 0;
      for (const {idx, mon, hp} of allies){
        if (idx === activeIdx) continue;
        if (hp <= 0) continue;
        const w = defenseWorstMult(mon, oppTypes);
        if (w <= 1) c++;
      }
      return c;
    }

    function potentialSetup(oppMon){
      const ids = new Set((oppMon.moves||[]).filter(Boolean));
      const canDD = ids.has("dragondance") || ddSet.has(oppMon.speciesId);
      const canSD = ids.has("swordsdance") || sdSet.has(oppMon.speciesId);
      return {canDD, canSD};
    }

    function allyList(){
      // Build list from allyHP map
      const out = [];
      for (const [idx, hp] of allyHP.entries()){
        const mon = leftTeam[idx];
        if (mon && mon.speciesId){
          out.push({idx, mon, hp});
        }
      }
      return out;
    }

    function renderAllyState(){
      const root = $("#allyState");
      root.innerHTML = "";

      const rows = allyList();
      if (!rows.length){
        root.innerHTML = `<div class="small">（左の選出がありません。メインで3体チェックしてください）</div>`;
        return;
      }

      const table = document.createElement("table");
      table.className = "matchTable";
      table.innerHTML = `<thead><tr><th>ポケモン</th><th style="width:120px">HP%</th></tr></thead>`;
      const tb = document.createElement("tbody");
      for (const r of rows){
        const tr = document.createElement("tr");
        const nm = monNameJa(r.mon.speciesId);
        const td1 = document.createElement("td");
        td1.textContent = nm;
        const td2 = document.createElement("td");
        const inp = document.createElement("input");
        inp.type = "number";
        inp.min = "0";
        inp.max = "100";
        inp.step = "1";
        inp.value = String(r.hp);
        inp.addEventListener("input", () => {
          allyHP.set(r.idx, clamp(int(inp.value, 100), 0, 100));
          // if this row is current active, sync the top HP box
          if (String(r.idx) === selL.value) $("#hpLeft").value = String(allyHP.get(r.idx));
        });
        td2.appendChild(inp);
        tr.appendChild(td1);
        tr.appendChild(td2);
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      root.appendChild(table);
    }

    renderAllyState();

    // --- Scenario toggle (A/B) ---
    let scenario = (localStorage.getItem(AI_SCENARIO_KEY) || "B").toUpperCase();
    if (scenario !== "A" && scenario !== "B") scenario = "B";

    function updateScenarioHint(){
      const hint = $("#scenarioHint");
      if (!hint) return;
      hint.textContent = (scenario === "A")
        ? "最大打点寄り（危険度も表示）"
        : "安全寄り（負け筋を優先して回避）";
    }

    const radios = Array.from(document.querySelectorAll('input[name="aiScenario"]'));
    for (const r of radios){
      r.checked = (r.value === scenario);
      r.addEventListener("change", () => {
        const v = (r.value || "B").toUpperCase();
        scenario = (v === "A" ? "A" : "B");
        try{ localStorage.setItem(AI_SCENARIO_KEY, scenario); }catch(_){}
        updateScenarioHint();
        compute();
      });
    }
    updateScenarioHint();

    // Sync HP input with allyHP
    function syncHpFromActive(){
      const idx = int(selL.value, -1);
      if (allyHP.has(idx)) $("#hpLeft").value = String(allyHP.get(idx));
    }

    selL.addEventListener("change", () => { syncHpFromActive(); });
    $("#hpLeft").addEventListener("input", () => {
      const idx = int(selL.value, -1);
      if (allyHP.has(idx)) allyHP.set(idx, clamp(int($("#hpLeft").value, 100), 0, 100));
    });

    // --- Suggestion engine ---
    function compute(){
      const idxL = int(selL.value, -1);
      const idxR = int(selR.value, -1);
      const leftActive = leftTeam[idxL];
      const rightActive = rightTeam[idxR];

      if (!leftActive?.speciesId || !rightActive?.speciesId){
        $("#aiSuggest").innerHTML = "<div class=\"err\">場のポケモンが未設定です。</div>";
        $("#aiRejected").innerHTML = "";
        return;
      }

      const oppTypes = getTypes(rightActive.speciesId);
      const myTypes = getTypes(leftActive.speciesId);

      const hpR = clamp(int($("#hpRight").value, 100), 0, 100);
      const hpL = clamp(int($("#hpLeft").value, 100), 0, 100);

      const considerSetup = !!$("#tgSetup").checked;
      const considerNoSwitch = !!$("#tgNoSwitch").checked;

      const allies = allyList().map(x => ({...x}));
      // ensure active is in allies list for anti-setup detection
      if (!allies.some(x => x.idx === idxL) && leftActive.speciesId){
        allies.push({idx: idxL, mon: leftActive, hp: hpL});
      }

      const antiSetup = hasAntiSetup(allies.map(x => x.mon));

      const setup = potentialSetup(rightActive);
      const setupKinds = [];
      if (setup.canDD) setupKinds.push("りゅうのまい");
      if (setup.canSD) setupKinds.push("つるぎのまい");

      // action candidates
      const actions = [];
      actions.push({kind:"stay"});
      for (const mvId of (leftActive.moves||[])){
        if (!mvId) continue;
        actions.push({kind:"move", moveId: mvId});
      }
      for (const a of allies){
        if (a.idx === idxL) continue;
        if (a.hp <= 0) continue;
        actions.push({kind:"switch", toIdx: a.idx});
      }

      if (!actions.length){
        $("#aiSuggest").innerHTML = "<div class=\"err\">技が未入力で、交代先もありません。</div>";
        $("#aiRejected").innerHTML = "";
        return;
      }

      function evalAction(act){
        let afterMon = leftActive;
        let afterHp = hpL;
        let immediateDmg = 0;
        let stopNow = false;
        let label = "";
        let detail = [];

        if (act.kind === "stay"){
          const nm = monNameJa(leftActive.speciesId);
          label = `居座り：${nm}`;
          const bt = bestThreatPct(leftActive, rightActive);
          if (bt.bestMove){
            detail.push(`最大打点：${moveNameJa(bt.bestMove)} → ${pctText(bt.best)}（ざっくり）`);
          } else {
            detail.push("最大打点：技未入力");
          }
        } else if (act.kind === "move"){
          const mi = moveInfo(act.moveId);
          const dmg = predictDamagePct(leftActive, act.moveId, rightActive);
          immediateDmg = dmg;
          stopNow = isStopMove(act.moveId);
          const eff = mi?.type ? typeEffect(mi.type, getTypes(rightActive.speciesId)) : 1;
          label = `技：${moveNameJa(act.moveId)}`;
          detail.push(`タイプ：${fmtType(mi?.type)} / 相性：x${eff}`);
          if (mi?.category === "Status") detail.push("分類：変化（ダメージなし）");
          else detail.push(`予想削り：${pctText(dmg)}（ざっくり）`);
          if (stopNow) detail.push("積み妨害：あり（ちょうはつ/アンコール等）");
        } else {
          afterMon = leftTeam[act.toIdx];
          afterHp = clamp(int(allyHP.get(act.toIdx) ?? 100, 100), 0, 100);
          const nm = monNameJa(afterMon.speciesId);
          label = `交代：${nm}`;
          const bt = bestThreatPct(afterMon, rightActive);
          if (bt.bestMove){
            detail.push(`最大打点：${moveNameJa(bt.bestMove)} → ${pctText(bt.best)}（ざっくり）`);
          } else {
            detail.push("最大打点：技未入力");
          }
        }

        const ko = (act.kind === "move" && immediateDmg >= hpR && immediateDmg > 0);

        // Threat after action
        const threat = (act.kind === "move")
          ? {best: immediateDmg, bestMove: act.moveId}
          : bestThreatPct(afterMon, rightActive);

        // Setup risk
        let setupRisk = 0.05;
        let setupNote = "";
        if (considerSetup && (setup.canDD || setup.canSD)){
          const freeSetup = !ko && !stopNow && (threat.best < 60);
          if (freeSetup){
            // If we have an anti-setup option somewhere, reduce.
            setupRisk = antiSetup ? 0.35 : 0.7;
            setupNote = antiSetup
              ? `相手が${setupKinds.join("/")}を持つ可能性。こちらに対策（ちょうはつ/アンコール/くろいきり/てんねん等）がある前提でリスク中。`
              : `相手が${setupKinds.join("/")}を持つ可能性。止め手が薄い想定なのでリスク高。`;
          } else {
            setupRisk = 0.12;
            setupNote = `相手の${setupKinds.join("/")}は警戒対象だが、この手は圧力/妨害があるためリスク低〜中。`;
          }
        }

        // No-switch risk (STAB only)
        let noSwitchRisk = 0.05;
        let noSwitchNote = "";
        if (considerNoSwitch && oppTypes.length){
          const safeCnt = safeSwitchCount(allies, oppTypes, act.kind==="switch" ? act.toIdx : idxL);
          if (safeCnt === 0){
            noSwitchRisk = 0.55;
            noSwitchNote = "相手のタイプ（STAB想定）に対して、後投げできる駒が見当たりません。";
          } else {
            noSwitchRisk = 0.18;
            noSwitchNote = `後投げ候補: ${safeCnt}体（STAB想定）`;
          }
        }

        // Exposure risk (current/after)
        const worst = oppTypes.length ? defenseWorstMult(afterMon, oppTypes) : 1;
        let exposureRisk = 0.06;
        let exposureNote = "";
        if (worst >= 2){
          exposureRisk = afterHp <= 50 ? 0.35 : 0.22;
          exposureNote = `相手のSTAB想定に弱め（最大x${worst}）`;
        } else if (worst <= 0.5){
          exposureRisk = 0.03;
          exposureNote = "受け出しは比較的安定（半減以上）";
        } else {
          exposureRisk = 0.08;
          exposureNote = "等倍〜微妙";
        }

        
        // Punish risk: safety-first assumes opponent will punish obvious weaknesses
        let punishRisk = 0.0;
        let punishNote = "";
        if (act.kind === "switch" && oppTypes.length){
          if (worst >= 2){
            punishRisk = 0.45 + (afterHp <= 80 ? 0.15 : 0) + (worst >= 4 ? 0.15 : 0);
            punishRisk = clamp(punishRisk, 0, 0.85);
            punishNote = "弱点に交代は危険（相手のSTABで大きく削られる想定）";
          }
        }
// If we KO, force risk down
        if (ko){
          setupRisk *= 0.2;
          noSwitchRisk *= 0.6;
          exposureRisk *= 0.6;
          punishRisk *= 0.4;
          detail.push("この手で倒せる想定 → いったん安全寄り");
        }

        // Combine
        const loseProb = 1 - (1-setupRisk)*(1-noSwitchRisk)*(1-exposureRisk)*(1-punishRisk);

        // Reject conditions (very rough)
        const rejectReasons = [];
        if (considerSetup && (setup.canDD || setup.canSD)){
          const freeSetup = !ko && !stopNow && (threat.best < 50);
          if (freeSetup && !antiSetup) rejectReasons.push("積みの起点になりやすく、止め手が薄い");
        }
        if (considerNoSwitch && oppTypes.length){
          const safeCnt = safeSwitchCount(allies, oppTypes, act.kind==="switch" ? act.toIdx : idxL);
          if (safeCnt === 0 && worst >= 2) rejectReasons.push("受け先が無くなりやすい");
          if (act.kind === "switch" && worst >= 2 && safeCnt <= 1) rejectReasons.push("弱点に交代しやすく、切り返しが細い");
        }

        const reasons = [];
        if (setupNote) reasons.push(setupNote);
        if (noSwitchNote) reasons.push(noSwitchNote);
        if (exposureNote) reasons.push(exposureNote);
        if (punishNote) reasons.push(punishNote);

        return {
          act,
          label,
          detail,
          loseProb,
          threat: threat.best,
          reject: rejectReasons.length>0,
          rejectReasons,
          reasons,
        };
      }

      const scored = actions.map(evalAction);
      const accepted = scored.filter(x=>!x.reject);
      const rejected = scored.filter(x=>x.reject);

      if (scenario === "A"){
        // A: prioritize immediate threat (damage) first, then safety
        accepted.sort((a,b)=> (b.threat - a.threat) || (a.loseProb - b.loseProb));
        rejected.sort((a,b)=> (b.threat - a.threat) || (a.loseProb - b.loseProb));
      } else {
        // B: safety-first (current default)
        accepted.sort((a,b)=> (a.loseProb - b.loseProb) || (b.threat - a.threat));
        rejected.sort((a,b)=> (a.loseProb - b.loseProb) || (b.threat - a.threat));
      }

      const top = accepted.length ? accepted.slice(0,3) : rejected.slice(0,3);

      // Render suggestions
      const sug = [];
      if (considerSetup && (setup.canDD || setup.canSD)){
        const oppName = monNameJa(rightActive.speciesId);
        sug.push(`<div class="small">相手の場：${escapeHtml(oppName)}（${escapeHtml(setupKinds.join("/"))}の可能性あり）</div>`);
      }
      sug.push("<div class=\"hr\"></div>");

      top.forEach((x,i) => {
        const p = Math.round(clamp(x.loseProb*100, 0, 100));
        const badge = x.reject ? `<span class="badge" style="border-color:#ffd2cf;color:#b42318">危険</span>` : `<span class="badge">推奨</span>`;
        sug.push(`<div style="margin:10px 0">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap">
            <div><b>${i+1}位：</b>${escapeHtml(x.label)} ${badge}</div>
            <div class="small">危険度（負け筋）: <b>${p}%</b></div>
          </div>
          ${x.detail.length?`<ul style="margin:6px 0 0 18px">${x.detail.map(t=>`<li>${escapeHtml(t)}</li>`).join("")}</ul>`:""}
          ${x.reasons.length?`<div class="small" style="margin-top:6px">${escapeHtml(x.reasons.join(" / "))}</div>`:""}
        </div>`);
      });

      if (!accepted.length){
        sug.unshift(`<div class="err">安全寄りの候補が見つからなかったので、危険な手からマシな順に出しています。</div>`);
      }

      $("#aiSuggest").innerHTML = sug.join("");

      // Render rejected list
      const rej = [];
      if (!rejected.length){
        rej.push(`<div class="small">（なし）</div>`);
      } else {
        rej.push(`<ul style="margin:8px 0 0 18px">`);
        for (const x of rejected.slice(0,12)){
          const p = Math.round(clamp(x.loseProb*100, 0, 100));
          const why = x.rejectReasons.length ? `（${x.rejectReasons.join("・")}）` : "";
          rej.push(`<li>${escapeHtml(x.label)}：危険度${p}% ${escapeHtml(why)}</li>`);
        }
        rej.push(`</ul>`);
      }
      $("#aiRejected").innerHTML = rej.join("");

      setStatus("提案を更新しました。", "ok");
    }

    // Wire recalc button
    const btn = $("#btnAiRecalc");
    if (btn) btn.addEventListener("click", compute);

    // Also recalc once initially
    syncHpFromActive();
    compute();

    setStatus("引き継ぎ完了。", "ok");
  }

  main().catch(err => {
    console.error(err);
    setStatus("読み込み中にエラーが発生しました。", "err");
  });
})();
