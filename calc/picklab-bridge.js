/* Pick Lab -> BDC bridge (v1)
   Reads PICKLAB_TO_BDC_V1 from localStorage, converts names/moves to BDC JP format,
   and fills Party/6v6 inputs if present.
*/
(function(){
  const KEY = "PICKLAB_TO_BDC_V1";
  const btn = document.getElementById("btnImportFromPickLab");
  const msg = document.getElementById("picklabImportMsg");

  function setMsg(t){ if(msg) msg.textContent = t || ""; }

  function safeJsonParse(s){
    try{ return JSON.parse(s); }catch(_){ return null; }
  }

  function ready(fn){
    if(document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  async function loadJson(url){
    const r = await fetch(url, {cache:"no-store"});
    if(!r.ok) throw new Error(`${url} (${r.status})`);
    return r.json();
  }

  const NATURE_EN_TO_JA = {
    "Hardy":"がんばりや","Lonely":"さみしがり","Brave":"ゆうかん","Adamant":"いじっぱり","Naughty":"やんちゃ",
    "Bold":"ずぶとい","Docile":"すなお","Relaxed":"のんき","Impish":"わんぱく","Lax":"のうてんき",
    "Timid":"おくびょう","Hasty":"せっかち","Serious":"まじめ","Jolly":"ようき","Naive":"むじゃき",
    "Modest":"ひかえめ","Mild":"おっとり","Quiet":"れいせい","Bashful":"てれや","Rash":"うっかりや",
    "Calm":"おだやか","Gentle":"おとなしい","Sassy":"なまいき","Careful":"しんちょう","Quirky":"きまぐれ"
  };

  const FORM_SUFFIX = {
    // Rotom appliances
    "ヒート":"炎","ウォッシュ":"水","フロスト":"氷","スピン":"飛","カット":"草",
    // Genies
    "霊獣":"霊","化身":"化",
    // Urshifu
    "いちげき":"一","れんげき":"連",
    // Regional
    "アローラ":"A","ガラル":"G","ヒスイ":"H"
  };

  function normalizeId(s){
    return (s||"").toLowerCase().replace(/[\s'’\-_:.]/g,"");
  }

  function bestGuessFromSet(name, bdcSet){
    if(!name) return "";
    if(bdcSet.has(name)) return name;

    let s = (name||"").replace(/\s+/g,"").replace(/（/g,"(").replace(/）/g,")");
    if(bdcSet.has(s)) return s;

    // Rotom special (ヒートロトム等 -> ロトム炎 等)
    const rotomMap = {
      "ヒートロトム":"ロトム炎",
      "ウォッシュロトム":"ロトム水",
      "フロストロトム":"ロトム氷",
      "スピンロトム":"ロトム飛",
      "カットロトム":"ロトム草"
    };
    if(rotomMap[s] && bdcSet.has(rotomMap[s])) return rotomMap[s];

    // Regional prefix/suffix cleanup
    const regional = [
      {k:"アローラ", suf:"A"},
      {k:"ガラル", suf:"G"},
      {k:"ヒスイ", suf:"H"},
    ];
    for(const r of regional){
      if(s.startsWith(r.k)){
        const base = s.slice(r.k.length);
        const cand = base + r.suf;
        if(bdcSet.has(cand)) return cand;
      }
      if(s.includes(r.k)){
        // e.g. ライチュウ(アローラのすがた)
        const base = s.replace(/\(.+\)/,"").replace(r.k,"");
        const cand = base + r.suf;
        if(bdcSet.has(cand)) return cand;
      }
    }

    // Genies (ランドロス(霊獣) etc)
    if(s.includes("霊獣") && bdcSet.has(s.replace(/[\(\)]/g,"").replace("霊獣","霊"))) return s.replace(/[\(\)]/g,"").replace("霊獣","霊");
    if(s.includes("化身") && bdcSet.has(s.replace(/[\(\)]/g,"").replace("化身","化"))) return s.replace(/[\(\)]/g,"").replace("化身","化");

    // Urshifu
    if(s.includes("いちげき") && bdcSet.has("ウーラオス一")) return "ウーラオス一";
    if(s.includes("れんげき") && bdcSet.has("ウーラオス連")) return "ウーラオス連";

    // Fallback: prefix match
    let best="", bestScore=-1;
    for(const cand of bdcSet){
      let score=0;
      if(cand===s) score+=100;
      if(cand.startsWith(s)) score+=40;
      if(s.startsWith(cand)) score+=10;
      if(score>bestScore){ bestScore=score; best=cand; }
    }
    return best || name;
  }

  async function buildMaps(){
    const [pkAll, moveEnJa, psMoves, bdcMaster] = await Promise.all([
      loadJson("../dex/jp/POKEMON_ALL.json"),
      loadJson("../dex/jp/move_en_ja.json"),
      loadJson("../dex/ps/moves.json"),
      loadJson("pokemon_master.currentOnly.json"),
    ]);

    const bdcNames = new Set((bdcMaster||[]).map(x=>x && x["名前"]).filter(Boolean));

    const idToEntry = new Map();
    for(const e of (pkAll||[])){
      const keys = [
        e.pkmn_id_name, e.pokeapi_pokemon_id_name, e.pokeapi_form_id_name,
        e.pokeapi_species_id_name, e.pokeapi_form_name, e.pkmn_name
      ].filter(Boolean);
      for(const k of keys){
        idToEntry.set(normalizeId(String(k)), e);
      }
    }

    function idToBdcName(speciesId){
      const e = idToEntry.get(normalizeId(speciesId));
      if(!e){
        // unknown -> try show as-is
        return bestGuessFromSet(speciesId, bdcNames);
      }
      const base = (e.pokeapi_species_name_ja || e.yakkuncom_name || "").trim();
      const form = (e.yakkuncom_form_name || "").trim();

      // direct form-suffix attempt
      if(base){
        if(!form){
          if(bdcNames.has(base)) return base;
        }else{
          const suf = FORM_SUFFIX[form];
          if(suf){
            const cand = base + suf;
            if(bdcNames.has(cand)) return cand;
          }
          // sometimes base itself is used (e.g. ランドロス with form stored separately)
          const cand2 = base + form;
          if(bdcNames.has(cand2)) return cand2;
          // sometimes the "yakkuncom_name" already includes form label, so try that too
          if(e.yakkuncom_name && bdcNames.has(e.yakkuncom_name)) return e.yakkuncom_name;
        }
      }

      // try yakkuncom_name (often already JP and readable)
      const yk = (e.yakkuncom_name || "").trim();
      if(yk && bdcNames.has(yk)) return yk;

      // last resort: guess
      return bestGuessFromSet(yk || base || speciesId, bdcNames);
    }

    function moveIdToJa(moveId){
      if(!moveId) return "";
      const m = psMoves[moveId];
      const enName = m ? m.name : "";
      if(enName && moveEnJa && moveEnJa[enName]) return moveEnJa[enName];
      return (moveEnJa && moveEnJa[enName]) ? moveEnJa[enName] : (enName || moveId);
    }

    return { idToBdcName, moveIdToJa };
  }

  function setVal(id, val){
    const el = document.getElementById(id);
    if(!el) return false;
    el.value = (val ?? "");
    return true;
  }

  async function applyImport(){
    const raw = localStorage.getItem(KEY);
    const payload = safeJsonParse(raw);
    if(!payload || !payload.app || !payload.app.teams){
      setMsg("Pick Labデータが見つかりませんでした。");
      return;
    }

    setMsg("変換中…");
    let maps;
    try{
      maps = await buildMaps();
    }catch(e){
      console.error(e);
      setMsg("変換に失敗しました（図鑑データ取得エラー）。");
      return;
    }

    const left = (payload.app.teams.left || []);
    const right = (payload.app.teams.right || []);

    // Build party array (6)
    const party = Array.from({length:6}, (_,i) => {
      const mon = left[i] || {};
      const name = mon.speciesId ? maps.idToBdcName(mon.speciesId) : "";
      const natureJa = mon.nature ? (NATURE_EN_TO_JA[mon.nature] || "") : "";
      const ev = mon.evs || {};
      const moves = (mon.moves || []).map(maps.moveIdToJa);
      return {
        name,
        nature: natureJa,
        ev: { h:ev.hp||0, a:ev.atk||0, b:ev.def||0, c:ev.spa||0, d:ev.spd||0, s:ev.spe||0 },
        moves
      };
    });

    const defNames = Array.from({length:6}, (_,i) => {
      const mon = right[i] || {};
      return mon.speciesId ? maps.idToBdcName(mon.speciesId) : "";
    });

    // Apply with retry because BDC UI is built progressively
    const maxTry = 40;
    for(let t=0; t<maxTry; t++){
      const anyA = !!document.getElementById("tA_name_1");
      const anyP = !!document.getElementById("p1_name");
      if(anyA || anyP) break;
      await new Promise(r => setTimeout(r, 120));
    }

    // Party tab inputs
    let wroteAny = false;
    for(let i=1;i<=6;i++){
      const p = party[i-1] || {};
      wroteAny = setVal(`p${i}_name`, p.name) || wroteAny;
      setVal(`p${i}_nature`, p.nature);
      if(p.ev){
        setVal(`p${i}_ev_h`, p.ev.h);
        setVal(`p${i}_ev_a`, p.ev.a);
        setVal(`p${i}_ev_b`, p.ev.b);
        setVal(`p${i}_ev_c`, p.ev.c);
        setVal(`p${i}_ev_d`, p.ev.d);
        setVal(`p${i}_ev_s`, p.ev.s);
      }
      (p.moves || []).slice(0,4).forEach((mv, idx) => setVal(`p${i}_m${idx+1}`, mv));
    }

    // 6v6 name grids
    for(let i=1;i<=6;i++){
      setVal(`tA_name_${i}`, party[i-1]?.name || "");
      setVal(`tD_name_${i}`, defNames[i-1] || "");
    }

    // Cleanup: keep the payload (user may want to re-apply), but show done
    setMsg("Pick Labのチームを反映しました。");
  }

  ready(function(){
    const has = !!localStorage.getItem(KEY);
    if(!has){
      setMsg("");
      if(btn) btn.style.display="none";
      return;
    }
    if(btn){
      btn.style.display="";
      btn.addEventListener("click", applyImport);
    }
    // auto-apply when opened from Pick Lab
    const qs = new URLSearchParams(location.search || "");
    if(qs.get("from")==="picklab"){
      applyImport();
    }else{
      setMsg("Pick Labのチームを受信しました（反映ボタンで適用）");
    }
  });
})();
