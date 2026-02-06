// live-toggle.js (currentOnly版)
// fetch('pokemon_master.json') を 'pokemon_master.currentOnly.json' に置換して、
// 直後に loadPokemonMaster() を再実行。POKEDEXもクリアする。
const STORAGE_KEY = "pkm_current_only";
const TARGET = "pokemon_master.json";
const REPLACEMENT = "pokemon_master.currentOnly.json";

let ORIG_FETCH = globalThis.fetch;

function applyPatch(useCurrent) {
  globalThis.fetch = ORIG_FETCH;
  if (typeof window !== "undefined") window.fetch = ORIG_FETCH;
  if (!useCurrent) return;

  const base = ORIG_FETCH;
  function patched(input, init) {
    try {
      const url = (typeof input === "string") ? input : (input && input.url) || "";
      if (url && url.indexOf(TARGET) !== -1) {
        const replaced = url.replace(TARGET, REPLACEMENT);
        if (typeof input === "string") return base.call(this, replaced, init);
        const req = new Request(replaced, input);
        return base.call(this, req, init);
      }
    } catch (_) {}
    return base.call(this, input, init);
  }
  globalThis.fetch = patched;
  if (typeof window !== "undefined") window.fetch = patched;
}

function ensureMount() {
  let mount = document.getElementById("genFilterMount");
  if (!mount) {
    mount = document.createElement("div");
    mount.id = "genFilterMount";
    mount.style.cssText = "position:sticky;top:0;z-index:9999;background:rgba(255,255,255,0.9);padding:8px 12px;border-bottom:1px solid #ddd;display:flex;gap:8px;align-items:center;";
    const first = document.body.firstElementChild;
    document.body.insertBefore(mount, first || null);
  }
  return mount;
}

function buildUI() {
  const mount = ensureMount();
  const label = document.createElement("label");
  label.style.cursor = "pointer";
  label.style.userSelect = "none";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.id = "cbCurrentOnly";
  cb.style.marginRight = "6px";
  label.appendChild(cb);
  label.appendChild(document.createTextNode("現世代のみ"));
  const hint = document.createElement("span");
  hint.style.fontSize = "12px";
  hint.style.opacity = "0.7";
  hint.style.marginLeft = "8px";
  mount.appendChild(label);
  mount.appendChild(hint);

  function refreshHint(on){ hint.textContent = on ? "（現世代データを使用中）" : "（全ポケモン）"; }

  const saved = localStorage.getItem(STORAGE_KEY) === "1";
  cb.checked = saved;
  refreshHint(saved);

  cb.addEventListener("change", async () => {
    const on = cb.checked;
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    refreshHint(on);
    applyPatch(on);
    try { if (typeof POKEDEX !== "undefined") { POKEDEX.length = 0; } } catch(_) {}
    if (typeof window.loadPokemonMaster === "function") {
      await window.loadPokemonMaster();
    }
  });

  applyPatch(saved);
  if (saved) {
    try { if (typeof POKEDEX !== "undefined") { POKEDEX.length = 0; } } catch(_) {}
    if (typeof window.loadPokemonMaster === "function") {
      window.loadPokemonMaster();
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", buildUI);
} else {
  buildUI();
}