/* Pick Lab - Capture Assist (snapshot, fixed ROI)
   - Fixed ROI (right-top name area) based on 1920x1080 layout
   - No orange lines / no auto-moving UI
   - Manual snapshot OCR (no continuous scanning)
   - Keep last stable result (never snap back to 0)
   - Save to localStorage: picklab_capture_last + picklab_capture_opponents
*/
(function(){
  const $ = (id) => document.getElementById(id);

  const elDevice = $("capDevice");
  const btnStart = $("btnStart");
  const btnStop  = $("btnStop");
  const btnSnap  = $("btnSnap");
  const capStatus = $("capStatus");
  const ocrStatus = $("ocrStatus");

  const video = $("capVideo");
  const fullCanvas = $("fullCanvas");
  const fullCtx = fullCanvas.getContext("2d", { willReadFrequently: true });

  const roiCanvas = $("roiCanvas");
  const roiCtx = roiCanvas.getContext("2d", { willReadFrequently: true });

  const detName = $("detName");
  const detConf = $("detConf");
  const btnCopy = $("btnCopy");

  const rawTextEl = $("rawText");
  const oppListEl = $("oppList");
  const btnClear = $("btnClear");

  // ---- Config (fixed ROI) ----
  // Right-top area where Pokémon name is shown near HP bar.
  // Using ratios instead of absolute px -> still "fixed" (not scanning),
  // but works even if input is 1280x720 etc.
  const ROI = {
    x: 0.54,  // start from 54% width
    y: 0.00,  // top
    w: 0.46,  // to right edge
    h: 0.22,  // top 22%
  };

  // OCR pacing
  const OCR_INTERVAL_MS = 260;    // responsive
  const HASH_STEP = 6;            // sampling step for hash (performance)

  // Stability (anti-flicker)
  // - Initial detect: require STABLE_NEED consecutive same matches
  // - Switching to another name: require SWITCH_NEED consecutive same matches
  // This avoids flicker even when OCR confidence is unstable.
  const STABLE_NEED = 2;
  const SWITCH_NEED = 3;
  const HOLD_MS = 900;            // keep current stable for a short time

  // localStorage keys
  const LS_LAST = "picklab_capture_last";
  const LS_OPP  = "picklab_capture_opponents";

  let stream = null;

  
let obsStream = null;
let plSrcMode = 'cam';
// OCR Worker
  let ocrWorker = null;
  let ocrReady = false;
  let ocrLoading = false;

  // Dex cache
  let dexNames = []; // [{ja, norm}]
  let dexEnNames = []; // [{en, ja}]
  let dexEnMap = new Map();
  let dexEnIndex = new Map();
  let dexDisplay = new Map(); // norm -> display (ja)
  let dexReady = false;

  // Stability
  let stableName = "";
  let stableConf = 0;
  let stableHoldUntil = 0;

  let pendingName = "";
  let pendingCount = 0;

  // Loop state
  let loopTimer = null;
  let lastOcrAt = 0;
  let lastHash = 0;
  let busy = false;

  
function hideLogUI(){
  try{
    if(oppListEl){
      // hide whole list area
      const box = oppListEl.parentElement;
      if(box) box.style.display = "none";
      else oppListEl.style.display = "none";
    }
    if(btnClear){ btnClear.style.display='none'; btnClear.disabled=true; }
    if(rawTextEl){
      const pill = rawTextEl.closest(".pill");
      if(pill) pill.style.display = "none";
      else rawTextEl.style.display = "none";
    }
  }catch(e){}
}

// -------- helpers --------
function setCapStatus(s){ capStatus.textContent = s; }

  function displayOf(norm){
    if(!norm) return "";
    return dexDisplay.get(norm) || norm;
  }

  function consumeMatch(name, conf, now){
    if(!name) return;

    // Same as current stable -> refresh hold
    if(stableName && name === stableName){
      stableHoldUntil = now + HOLD_MS;
      if(typeof conf === "number" && conf > 0) stableConf = conf;
      detName.textContent = displayOf(stableName) || "—";
      detConf.textContent = stableName ? String(Math.round(stableConf||0)) : "—";
      pendingName = "";
      pendingCount = 0;
      return;
    }

    // Hold current stable name briefly to avoid flicker
    if(stableName && now < stableHoldUntil){
      if(name === pendingName) pendingCount++;
      else { pendingName = name; pendingCount = 1; }
      return;
    }

    if(name === pendingName) pendingCount++;
    else { pendingName = name; pendingCount = 1; }

    const need = stableName ? SWITCH_NEED : STABLE_NEED;
    if(pendingCount >= need){
      setStable(pendingName, conf);
      pendingName = "";
      pendingCount = 0;
    }
  }


  function setOcrStatus(s){ ocrStatus.textContent = s; }

  function normalizeName(s){
    if(!s) return "";
    // remove spaces + common symbols
    s = String(s).trim()
      .replace(/\s+/g, "")
      .replace(/[｜|]/g, "")
      .replace(/[【】\[\]{}]/g, "")
      .replace(/[（(]/g, "(").replace(/[）)]/g, ")")
      .replace(/　/g, "");
    // fullwidth -> halfwidth (ASCII range)
    s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    // unify X/Y letters
    s = s.replace(/[ｘＸ]/g, "X").replace(/[ｙＹ]/g, "Y");
    return s;
  }

  function normalizeEn(s){
    if(!s) return "";
    s = String(s).trim().toLowerCase();
    // common symbols -> ascii
    s = s.replace(/♀/g, "f").replace(/♂/g, "m");
    // remove accents (best-effort)
    try{ s = s.normalize('NFKD').replace(/\p{Diacritic}/gu, ''); }catch(e){}
    // keep only [a-z0-9]
    s = s.replace(/[^a-z0-9]/g, "");
    return s;
  }

  function extractEnglish(text){
    const t = String(text || "");
    // longest latin chunk
    const m = t.match(/[A-Za-z][A-Za-z'\.\-\s]{2,}/g);
    if(!m) return "";
    m.sort((a,b)=>b.length-a.length);
    return m[0] || "";
  }

  function extractKatakana(text){
    const t = normalizeName(text);
    const matches = t.match(/[ァ-ヴー]{2,}/g);
    if(!matches) return "";
    // choose the longest chunk
    matches.sort((a,b)=>b.length-a.length);
    return matches[0] || "";
  }

  function editDistance(a,b){
    a = a || ""; b = b || "";
    const al=a.length, bl=b.length;
    if(al===0) return bl;
    if(bl===0) return al;
    const dp = new Array(bl+1);
    for(let j=0;j<=bl;j++) dp[j]=j;
    for(let i=1;i<=al;i++){
      let prev = dp[0];
      dp[0]=i;
      for(let j=1;j<=bl;j++){
        const tmp = dp[j];
        const cost = a[i-1]===b[j-1] ? 0 : 1;
        dp[j] = Math.min(dp[j]+1, dp[j-1]+1, prev+cost);
        prev = tmp;
      }
    }
    return dp[bl];
  }

  function bestMatchName(raw){
    if(!dexReady) return "";

    // 1) Japanese (Katakana)
    const jaChunk = extractKatakana(raw);
    if(jaChunk){
      const cn = normalizeName(jaChunk);
      if(cn){
        if(dexSet.has(cn)) return cn;
        const first = cn[0];
        let best = "";
        let bestD = 999;
        for(const it of dexNames){
          if(it.norm[0] !== first) continue;
          const d = editDistance(cn, it.norm);
          if(d < bestD){
            bestD = d;
            best = it.norm;
            if(bestD === 0) break;
          }
        }
        if(best && bestD <= 2) return best;
      }
    }

    // 2) English
    const enChunk = extractEnglish(raw) || raw;
    const en = normalizeEn(enChunk);
    if(en){
      const direct = dexEnMap.get(en);
      if(direct) return direct;
      const first = en[0];
      const pool = dexEnIndex.get(first) || dexEnNames;
      let best = null;
      let bestD = 999;
      for(const it of pool){
        if(!it || !it.en) continue;
        const d = editDistance(en, it.en);
        if(d < bestD){
          bestD = d;
          best = it;
          if(bestD === 0) break;
        }
      }
      if(best && bestD <= 2) return best.ja;
    }

    // fallback: try raw as Japanese (if OCR missed katakana extraction)
    const cn2 = normalizeName(raw);
    if(cn2 && dexSet && dexSet.has(cn2)) return cn2;
    return "";
  }

  function loadOppList(){ return []; }

  function saveOppList(){ /* disabled */ }

  function renderOppList(){ /* disabled */ }
    btnClear.disabled = arr.length === 0;
  }

  function saveLast(){ /* disabled */ }

  function loadLast(){
    try{
      const raw = localStorage.getItem(LS_LAST);
      if(!raw) return null;
      const obj = JSON.parse(raw);
      if(obj && obj.name) return obj;
    }catch(e){}
    return null;
  }

  function setStable(name, conf){
    stableName = name || "";
    if(typeof conf === "number" && conf > 0) stableConf = conf;
    else if(!stableName) stableConf = 0;
    stableHoldUntil = Date.now() + HOLD_MS;

    detName.textContent = displayOf(stableName) || "—";
    detConf.textContent = stableName ? String(Math.round(stableConf||0)) : "—";
    btnCopy.disabled = !stableName;

    // 固定表示（次を押すまで変えない）
    try{
      if(stableName){
        setLockedName(displayOf(stableName) || stableName);
      }
    }catch(e){}
  }


  }

  // simple image hash (sampling)
  function hashImageData(imgData){
    const d = imgData.data;
    let h = 0;
    for(let i=0;i<d.length;i+=4*HASH_STEP){
      h = (h + d[i] + (d[i+1]<<1) + (d[i+2]<<2)) >>> 0;
    }
    return h;
  }

  async function ensureDex(){
    if(dexReady) return;

    const candidates = [
      "../dex/jp/POKEMON_ALL.json",
      "../../dex/jp/POKEMON_ALL.json",
      "/dex/jp/POKEMON_ALL.json",
      "dex/jp/POKEMON_ALL.json",
    ];

    async function tryLoad(url){
      try{
        const res = await fetch(url, { cache: "no-store" });
        if(!res.ok) return null;
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        const txt = await res.text();
        const s = (txt || "").trim();
        // avoid HTML fallback (index.html etc)
        if(s.startsWith("<")) return null;
        if(!s.startsWith("[") && ct.indexOf("json") === -1) return null;
        const arr = JSON.parse(s);
        if(Array.isArray(arr) && arr.length) return arr;
      }catch(e){}
      return null;
    }

    try{
      let arr = null;
      for(const u of candidates){
        arr = await tryLoad(u);
        if(arr) break;
      }
      if(!arr) throw new Error("dex json not found");

      dexNames = [];
      dexEnNames = [];
      dexEnMap = new Map();
      dexEnIndex = new Map();
      dexDisplay = new Map();

      for(const it of arr){
        const ja = it.yakkuncom_form_name || it.yakkuncom_name || it.pokeapi_form_name_ja || it.pokeapi_species_name_ja || it.pokeapi_form_name_ja || "";
        if(ja){
          const jaNorm = normalizeName(ja);
          if(jaNorm){
            dexNames.push({ ja, norm: jaNorm });
            if(!dexDisplay.has(jaNorm)) dexDisplay.set(jaNorm, ja);
          }
        }
        // English (best-effort): if present, map to Japanese
        const enRaw = it.pokeapi_species_name_en || it.pokeapi_form_name_en || it.yakkuncom_name_en || it.yakkuncom_form_name_en || it.showdown_name_en || "";
        if(enRaw && ja){
          const enNorm = normalizeEn(enRaw);
          const jaNorm = normalizeName(ja);
          if(enNorm && jaNorm){
            if(!dexEnMap.has(enNorm)) dexEnMap.set(enNorm, jaNorm);
            dexEnNames.push({ en: enNorm, ja: jaNorm });
          }
        }
      }

      dexSet = new Set(dexNames.map(x=>x.norm));
      for(const it of dexEnNames){
        const c = it.en[0];
        if(!c) continue;
        if(!dexEnIndex.has(c)) dexEnIndex.set(c, []);
        dexEnIndex.get(c).push(it);
      }

      dexReady = true;
      // update badge
      if(ocrReady) setOcrStatus("OK / DEX OK");
    }catch(e){
      dexReady = false;
      if(ocrReady) setOcrStatus("OK / DEX NG");
    }
  }

  // dynamic load tesseract.js
  async function ensureTesseract(){
    if(window.Tesseract) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("tesseract.js load failed"));
      document.head.appendChild(s);
    });
  }

  async function ensureOCR(){
    if(ocrReady || ocrLoading) return;
    ocrLoading = true;
    setOcrStatus("準備中…");

    const logger = (m) => {
      if(m && m.status && typeof m.progress === "number"){
        const pct = Math.round(m.progress * 100);
        setOcrStatus(`${m.status} ${pct}%`);
      }
    };

    const makeWorker = async (lang, langPath) => {
      const p = window.Tesseract.createWorker(lang, 1, { langPath, logger });
      const timeoutMs = 25000;
      const timeout = new Promise((_, rej) => setTimeout(()=>rej(new Error("OCR init timeout")), timeoutMs));
      return await Promise.race([p, timeout]);
    };

    try{
      await ensureTesseract();
      await ensureDex();

      // Prefer local tessdata (works for static sites / Electron)
      const localLangPath = new URL("./tespdata/", location.href).toString();

      try{
        ocrWorker = await makeWorker("jpn+eng", localLangPath);
        ocrReady = true;
        setOcrStatus("OK" + (dexReady ? " / DEX OK" : " / DEX NG"));
      }catch(eLocal){
        // Fallback: remote Japanese only (English requires eng.traineddata locally)
        const remotePaths = [
          "https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn@1.0.0/4.0.0_best_int/",
          "https://unpkg.com/@tesseract.js-data/jpn@1.0.0/4.0.0_best_int/",
        ];
        let lastErr = eLocal;
        for(const p of remotePaths){
          try{
            ocrWorker = await makeWorker("jpn", p);
            ocrReady = true;
            setOcrStatus("OK" + (dexReady ? " / DEX OK" : " / DEX NG"));
            lastErr = null;
            break;
          }catch(e2){
            lastErr = e2;
          }
        }
        if(!ocrReady) throw lastErr;
      }
    }catch(e){
      console.error(e);
      setOcrStatus("NG");
      alert(
        "OCRが準備できませんでした。\n" +
        "※ページを再読み込みし、ブラウザの拡張/広告ブロック等も確認してください。\n" +
        "（静的ホストの場合は /capture/tespdata/ に traineddata が必要です）"
      );
    }finally{
      ocrLoading = false;
    }
  }

  async function listDevices(){
    try{
      // Trigger permission once so labels become visible
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tmp.getTracks().forEach(t=>t.stop());
    }catch(e){
      // still can list, but labels might be empty
    }

    const devices = await navigator.mediaDevices.enumerateDevices();

// Auto-select OBS Virtual Camera if available
try { await tryAutoSelectObsVirtualCam(deviceSelect || selDevice || document.getElementById('deviceSelect') || document.getElementById('selDevice')); } catch(e) {}
    const vids = devices.filter(d => d.kind === "videoinput");

    elDevice.innerHTML = "";
    for(const d of vids){
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Video device (${d.deviceId.slice(0,6)}…)`;
      elDevice.appendChild(opt);
    }
    if(vids.length === 0){
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "ビデオ入力が見つかりません";
      elDevice.appendChild(opt);
    }
  }

  async function startCapture(){
    await ensureOCR();

    const deviceId = elDevice.value;
    if(!deviceId){
      alert("入力デバイスを選んでください。");
      return;
    }

    stopCapture();

    try{
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 } },
        audio: false,
      });
      video.srcObject = stream;

      setCapStatus("開始");
      btnStart.disabled = true;
      btnStop.disabled = false;

      // restore last stable
      const last = loadLast();
      if(last && last.name){
        setStable(last.name, last.conf || 0);
      }else{
        detName.textContent = "—";
        detConf.textContent = "—";
      }
      renderOppList();

      // Snapshot mode: do not start auto OCR loop
      btnSnap.disabled = false;

    }catch(e){
      console.error(e);
      setCapStatus("NG");
      if(String(e && e.name) === "NotReadableError"){
        alert("Device in use（他のアプリが使用中）です。OBS/他タブのプレビューを閉じてから再実行してください。");
      }else{
        alert("開始できませんでした。ブラウザのカメラ許可・入力デバイスを確認してください。");
      }
    }
  }

  function stopCapture(){
    if(loopTimer){
      clearInterval(loopTimer);
      loopTimer = null;
    }
    if(stream){
      try{ stream.getTracks().forEach(t=>t.stop()); }catch(e){}
      stream = null;
    }
    video.srcObject = null;
    btnStart.disabled = false;
    btnStop.disabled = true;
    if(btnSnap) btnSnap.disabled = true;
    setCapStatus("停止");
    busy = false;
  }

  function startLoop(){
    if(loopTimer) clearInterval(loopTimer);
    lastHash = 0;
    busy = false;
    loopTimer = // (disabled) auto interval removed for stability
// quick check; OCR is throttled by OCR_INTERVAL_MS
  }

  async function tick(){
    if(!stream || !ocrReady || !ocrWorker) return;
    if(busy) return;

    const now = performance.now();
    if(now - lastOcrAt < OCR_INTERVAL_MS) return;

    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    try{ updateRoiInfo(); }catch(e){}
    if(vw < 320 || vh < 240) return;

    // draw full frame
    fullCanvas.width = vw;
    fullCanvas.height = vh;
    fullCtx.drawImage(video, 0, 0, vw, vh);

    const rx = Math.floor(vw * ROI.x);
    const ry = Math.floor(vh * ROI.y);
    const rw = Math.floor(vw * ROI.w);
    const rh = Math.floor(vh * ROI.h);

    // copy ROI to roiCanvas
    roiCanvas.width = rw;
    roiCanvas.height = rh;
    roiCtx.drawImage(fullCanvas, rx, ry, rw, rh, 0, 0, rw, rh);

    // compute hash -> skip OCR if unchanged
    const imgData = roiCtx.getImageData(0, 0, rw, rh);
    const h = hashImageData(imgData);
    if(h === lastHash) return;
    lastHash = h;

    // OCR
    busy = true;
    lastOcrAt = now;

    try{
      const res = await ocrWorker.recognize(roiCanvas);
      const text = (res && res.data && res.data.text) ? res.data.text : "";
      const conf = (res && res.data && typeof res.data.confidence === "number") ? res.data.confidence : 0;

      rawTextEl.textContent = normalizeName(text).slice(0, 80) || "—";

      const matched = bestMatchName(text);
      const now = Date.now();

      if(matched){
        // Feed stability voter
        consumeMatch(matched, conf, now);
      }else{
        // No match this frame: do NOT clear stable (avoid annoying flicker)
        if(!stableName){
          detName.textContent = "—";
          detConf.textContent = "—";
          btnCopy.disabled = true;
        }
      }
    }catch(e){
      console.error(e);
      // keep stable; just show NG once
      setOcrStatus("NG");
    }finally{
      busy = false;
    }
  }

  
  // Snapshot OCR (manual trigger)
  async function snapshotOnce(){
    if(!stream){
      alert("先に「開始」を押してください。");
      return;
    }
    if(!ocrReady || !ocrWorker){
      await ensureOCR();
    }
    if(!ocrReady || !ocrWorker) return;
    if(busy) return;

    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if(vw < 320 || vh < 240){
      alert("映像の解像度が取得できません。少し待ってから再実行してください。");
      return;
    }

    // draw full frame
    fullCanvas.width = vw;
    fullCanvas.height = vh;
    fullCtx.drawImage(video, 0, 0, vw, vh);

    const rx = Math.floor(vw * ROI.x);
    const ry = Math.floor(vh * ROI.y);
    const rw = Math.floor(vw * ROI.w);
    const rh = Math.floor(vh * ROI.h);

    roiCanvas.width = rw;
    roiCanvas.height = rh;
    roiCtx.drawImage(fullCanvas, rx, ry, rw, rh, 0, 0, rw, rh);

    busy = true;
    try{
      setOcrStatus("認識中…");
      const res = await ocrWorker.recognize(roiCanvas);
      const text = (res && res.data && res.data.text) ? res.data.text : "";
      const conf = (res && res.data && typeof res.data.confidence === "number") ? res.data.confidence : 0;

      rawTextEl.textContent = normalizeName(text).slice(0, 80) || "—";

      const matched = bestMatchName(text);
      if(matched){
        // Directly set stable (manual snapshot -> no flicker)
        setStable(matched, conf || stableConf || 0);
        setOcrStatus("OK" + (dexReady ? " / DEX OK" : " / DEX NG"));
      }else{
        // Keep previous stable; just show hint
        setOcrStatus("未検出" + (dexReady ? " / DEX OK" : " / DEX NG"));
      }
    }catch(e){
      console.error(e);
      setOcrStatus("NG");
    }finally{
      busy = false;
    }
  }

// -------- UI wiring --------
try{ hideLogUI(); }catch(e){}
try{ hookLockButtons(); }catch(e){}
try{ hookRoiButton(); }catch(e){}

  btnStart.addEventListener("click", startCapture);
  btnStop.addEventListener("click", stopCapture);
  

// Source mode controls (Camera / OBS Screen Share)
if (srcModeCam && srcModeObs) {
  srcModeCam.addEventListener('change', () => { if (srcModeCam.checked) setSrcMode('cam'); });
  srcModeObs.addEventListener('change', () => { if (srcModeObs.checked) setSrcMode('obs'); });
}
if (btnStartObs) {
  btnStartObs.addEventListener('click', async () => {
    try {
      // video element variable name varies; try common ones
      const v = video || videoEl || document.querySelector('video');
      if (!v) return;
      await startObsShare(v);
    } catch(e) {}
  });
}

if(btnSnap) btnSnap.addEventListener("click", snapshotOnce);

  btnCopy.addEventListener("click", async () => {
    if(!stableName) return;
    try{
      await navigator.clipboard.writeText(displayOf(stableName) || stableName);
    }catch(e){
      // fallback
      const ta = document.createElement("textarea");
      ta.value = displayOf(stableName) || stableName;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  });

  btnClear.addEventListener("click", () => {
    if(!confirm("相手リストを消去しますか？")) return;
    saveOppList([]);
    renderOppList();
  });

  // init
  let dexSet = new Set();
  (async function init(){
    setCapStatus("未開始");
    await listDevices();
    renderOppList();

    // Try preload OCR (but don't block UI)
    ensureOCR().catch(()=>{});
  })();

})();

async function startObsShare(videoEl) {
  // Use Screen Share (getDisplayMedia) to capture OBS preview window.
  // This avoids capture-card device conflicts with OBS.
  try {
    // Stop camera stream if running
    if (stream) {
      try { stream.getTracks().forEach(t => t.stop()); } catch(e) {}
      stream = null;
    }
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false
    });
    obsStream = s;
    // When user stops sharing, reset state
    const [track] = s.getVideoTracks();
    if (track) {
      track.addEventListener('ended', () => {
        try { videoEl.srcObject = null; } catch(e) {}
        stopObsShare();
      });
    }
    videoEl.srcObject = s;
    await videoEl.play();
    setStatus && setStatus("画面共有: OK（OBSプレビューを選んでください）");
  } catch (err) {
    console.error(err);
    setStatus && setStatus("画面共有: NG（キャンセル/権限/選択ミス）");
    throw err;
  }
}

function stopObsShare() {
  if (obsStream) {
    try { obsStream.getTracks().forEach(t => t.stop()); } catch(e) {}
    obsStream = null;
  }
}

async function tryAutoSelectObsVirtualCam(selectEl) {
  // If OBS Virtual Camera exists, auto-select it for camera mode.
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const vids = devices.filter(d => d.kind === "videoinput");
    const obs = vids.find(d => /obs|virtual/i.test(d.label));
    if (obs && selectEl) {
      for (const opt of Array.from(selectEl.options)) {
        if (opt.value === obs.deviceId) {
          selectEl.value = obs.deviceId;
          break;
        }
      }
    }
  } catch (e) {}
}

function setSrcMode(mode) {
  plSrcMode = mode;
  if (mode === 'obs') {
    // Stop camera stream; wait for user to click "画面共有を開始"
    if (stream) {
      try { stream.getTracks().forEach(t => t.stop()); } catch(e) {}
      stream = null;
    }
    setStatus && setStatus("入力: OBSプレビュー（画面共有）");
  } else {
    // Stop screen share stream
    stopObsShare();
    setStatus && setStatus("入力: キャプチャーボード（カメラ）");
  }
}


// ===== Lock detected name (no auto-reset) =====
let lockedNameValue = "";

function setLockedName(name) {
  lockedNameValue = (name || "").toString().trim();
  const el = document.getElementById("lockedName");
  if (el) el.textContent = lockedNameValue ? lockedNameValue : "（未検出）";
}

async function copyLockedName() {
  const txt = (lockedNameValue || "").trim();
  if (!txt) return;
  try {
    await navigator.clipboard.writeText(txt);
    setStatus && setStatus("確定名をコピーしました");
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    setStatus && setStatus("確定名をコピーしました");
  }
}

function hookLockButtons() {
  const btnCopy = document.getElementById("btnCopyLocked");
  const btnClear = document.getElementById("btnClearLocked");
  btnCopy && btnCopy.addEventListener("click", copyLockedName);
  btnClear && btnClear.addEventListener("click", () => setLockedName(""));
}
// ===== End lock =====


function getRoiPixels(){
  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  if(!vw || !vh) return null;
  const rx = Math.floor(vw * ROI.x);
  const ry = Math.floor(vh * ROI.y);
  const rw = Math.floor(vw * ROI.w);
  const rh = Math.floor(vh * ROI.h);
  return { vw, vh, rx, ry, rw, rh, roi: ROI };
}
function updateRoiInfo(){
  const el = document.getElementById("roiInfo");
  if(!el) return;
  const p = getRoiPixels();
  if(!p){ el.textContent = ""; return; }
  el.textContent = `vw:${p.vw} vh:${p.vh} / x:${p.rx} y:${p.ry} w:${p.rw} h:${p.rh}`;
}
async function copyRoiInfo(){
  const p = getRoiPixels();
  if(!p) return;
  const text = JSON.stringify(p, null, 2);
  try{
    await navigator.clipboard.writeText(text);
    setStatus && setStatus("範囲情報をコピーしました");
  }catch(e){
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    setStatus && setStatus("範囲情報をコピーしました");
  }
}
function hookRoiButton(){
  const btn = document.getElementById("btnCopyROI");
  btn && btn.addEventListener("click", copyRoiInfo);
}
