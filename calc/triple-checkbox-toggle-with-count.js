// triple-checkbox-toggle-with-count_v2.js
// 件数カウントを #pkmList の option 数から取得。POKEDEX 依存を排除。

const THEME = {
  accent: "#2563eb",
  badgeBg: "rgba(37,99,235,0.12)",
  badgeText: "#2563eb",
  fontSize: "12px"
};

const FILES = {
  all: "./pokemon_master.json",
  current: "./pokemon_master.currentOnly.json",
  custom: "./pokemon_master.custom.json",
};
const STORAGE_KEY = "pkm_source3"; // "all" | "current" | "custom"
let ORIG_FETCH = globalThis.fetch;

function ensureMount(){
  let mount = document.getElementById("genFilterMount");
  if(!mount){
    mount = document.createElement("div");
    mount.id = "genFilterMount";
    mount.style.cssText = "position:sticky;top:0;z-index:9999;background:rgba(255,255,255,0.92);padding:8px 12px;border-bottom:1px solid #ddd;display:flex;gap:12px;align-items:center;flex-wrap:wrap;";
    const first = document.body.firstElementChild;
    document.body.insertBefore(mount, first || null);
  }
  return mount;
}

function mkCheck(labelText){
  const wrap = document.createElement("label");
  wrap.style.cursor = "pointer";
  wrap.style.userSelect = "none";
  wrap.style.color = THEME.accent;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.style.marginRight = "6px";
  try{ input.style.accentColor = THEME.accent; }catch(_){}
  wrap.appendChild(input);
  wrap.appendChild(document.createTextNode(labelText));
  return { wrap, input };
}

function ensureBadge(container){
  let b = document.getElementById("pkmCountBadge");
  if(!b){
    b = document.createElement("span");
    b.id = "pkmCountBadge";
    b.style.display = "inline-block";
    b.style.marginLeft = "12px";
    b.style.padding = "2px 8px";
    b.style.borderRadius = "9999px";
    b.style.fontSize = THEME.fontSize;
    b.style.lineHeight = "1.6";
    b.style.background = THEME.badgeBg;
    b.style.color = THEME.badgeText;
    container.appendChild(b);
  }else{
    b.style.background = THEME.badgeBg;
    b.style.color = THEME.badgeText;
  }
  return b;
}

function countFromUI(){
  // 最優先: #pkmList の option 数
  const dl = document.getElementById("pkmList");
  if (dl){
    // datalist の子要素（option）の数
    const opts = dl.tagName.toLowerCase()==="datalist" ? dl.querySelectorAll("option") : dl.children;
    return opts ? opts.length : 0;
  }
  // 予備: ページ内の一番大きい datalist の option 数
  const dls = Array.from(document.querySelectorAll("datalist"));
  if (dls.length){
    return Math.max(0, ...dls.map(d=>d.querySelectorAll("option").length));
  }
  return 0;
}

function updateBadge(){
  const mount = ensureMount();
  const b = ensureBadge(mount);
  const n = countFromUI();
  b.textContent = `（${n}件）`;
}

function patchFetchFor(mode){
  // 元に戻す
  globalThis.fetch = ORIG_FETCH;
  if (typeof window !== "undefined") window.fetch = ORIG_FETCH;
  const replacement = FILES[mode] || FILES.all;
  if (mode === "all") return; // 全体は差し替え不要
  const base = ORIG_FETCH;
  function patched(input, init){
    try{
      const url = (typeof input === "string") ? input : (input && input.url) || "";
      if (url && /(^|\/)pokemon_master\.json(\?|$)/.test(url)){
        const rep = replacement;
        if (typeof input === "string") return base.call(this, rep, init);
        const req = new Request(rep, input);
        return base.call(this, req, init);
      }
    }catch(_){}
    return base.call(this, input, init);
  }
  globalThis.fetch = patched;
  if (typeof window !== "undefined") window.fetch = patched;
}

async function applyMode(mode){
  // 404チェック（存在しない選択は all に戻す）
  const file = FILES[mode] || FILES.all;
  try{
    const resp = await ORIG_FETCH(file, { method: "GET", cache: "no-store" });
    if (!resp.ok) throw 0;
  }catch(_){
    mode = "all";
    localStorage.setItem(STORAGE_KEY, mode);
  }

  // 差し替え適用
  patchFetchFor(mode);

  // 再読み込み（POKEDEX クリアは任意：UIカウントは datalist 基準なので不要）
  try { if (typeof POKEDEX !== "undefined") { POKEDEX.length = 0; } } catch(_){}
  if (typeof window.loadPokemonMaster === "function") {
    await window.loadPokemonMaster();
  }

  // 件数更新を段階的に
  updateBadge();
  setTimeout(updateBadge, 0);
  setTimeout(updateBadge, 200);
  setTimeout(updateBadge, 800);
}

function buildUI(){
  const mount = ensureMount();

  const cAll = mkCheck("全て");
  const cCurrent = mkCheck("SV");
  const cCustom = mkCheck("ZA");
  mount.appendChild(cAll.wrap);
  mount.appendChild(cCurrent.wrap);
  mount.appendChild(cCustom.wrap);

  // 件数バッジ
  ensureBadge(mount);

  // 復元（デフォルトは "all"）
  const saved = localStorage.getItem(STORAGE_KEY) || "all";
  setExclusive(saved);

  cAll.input.addEventListener("change", () => setExclusive("all"));
  cCurrent.input.addEventListener("change", () => setExclusive("current"));
  cCustom.input.addEventListener("change", () => setExclusive("custom"));

  async function setExclusive(mode){
    cAll.input.checked = (mode === "all");
    cCurrent.input.checked = (mode === "current");
    cCustom.input.checked = (mode === "custom");
    localStorage.setItem(STORAGE_KEY, mode);
    await applyMode(mode);
  }
}

if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", buildUI);
}else{
  buildUI();
}