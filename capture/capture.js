/* Pick Lab - Capture Assist (fixed ROI, no scanning)
   - Fixed ROI (right-top name area) based on 1920x1080 layout
   - No orange lines / no auto-moving UI
   - Keep last stable result (never snap back to 0)
   - Save to localStorage: picklab_capture_last + picklab_capture_opponents
*/
(function(){
  const $ = (id) => document.getElementById(id);

  const elDevice = $("capDevice");
  const btnStart = $("btnStart");
  const btnStop  = $("btnStop");
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
  const OCR_INTERVAL_MS = 350;    // light + responsive
  const HASH_STEP = 6;            // sampling step for hash (performance)
  const STABLE_NEED = 2;          // consecutive same => accept

  // localStorage keys
  const LS_LAST = "picklab_capture_last";
  const LS_OPP  = "picklab_capture_opponents";

  let stream = null;

  // OCR Worker
  let ocrWorker = null;
  let ocrReady = false;
  let ocrLoading = false;

  // Dex cache
  let dexNames = []; // [{ja, norm}]
  let dexReady = false;

  // Stability
  let stableName = "";
  let stableConf = 0;
  let pendingName = "";
  let pendingCount = 0;

  // Loop state
  let loopTimer = null;
  let lastOcrAt = 0;
  let lastHash = 0;
  let busy = false;

  // -------- helpers --------
  function setCapStatus(s){ capStatus.textContent = s; }
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
    const cand = extractKatakana(raw) || normalizeName(raw);
    const cn = normalizeName(cand);
    if(!cn || !dexReady) return "";
    if(dexSet.has(cn)) return cn;

    // narrow by first char to keep it fast
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
    // accept only if close enough
    if(best && bestD <= 2) return best;
    return "";
  }

  function loadOppList(){
    try{
      const raw = localStorage.getItem(LS_OPP);
      const arr = raw ? JSON.parse(raw) : [];
      if(Array.isArray(arr)) return arr.filter(Boolean);
    }catch(e){}
    return [];
  }

  function saveOppList(arr){
    try{ localStorage.setItem(LS_OPP, JSON.stringify(arr)); }catch(e){}
  }

  function renderOppList(){
    const arr = loadOppList();
    oppListEl.innerHTML = "";
    for(const name of arr){
      const span = document.createElement("span");
      span.className = "chip";
      span.textContent = name;
      oppListEl.appendChild(span);
    }
    btnClear.disabled = arr.length === 0;
  }

  function saveLast(name, conf){
    try{
      localStorage.setItem(LS_LAST, JSON.stringify({ name, conf, t: Date.now() }));
    }catch(e){}
  }

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
    stableConf = typeof conf === "number" ? conf : 0;
    detName.textContent = stableName || "—";
    detConf.textContent = stableName ? String(Math.round(stableConf)) : "—";
    btnCopy.disabled = !stableName;
    if(stableName){
      saveLast(stableName, stableConf);
      // auto add to list (unique)
      const arr = loadOppList();
      if(!arr.includes(stableName)){
        arr.push(stableName);
        saveOppList(arr);
        renderOppList();
      }
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
    try{
      // Use same dex JSON already in Pick Lab repo
      const res = await fetch("../dex/jp/POKEMON_ALL.json", { cache: "force-cache" });
      const arr = await res.json();
      dexNames = [];
      for(const it of arr){
        const ja = it.yakkuncom_name || it.pokeapi_species_name_ja || it.pokeapi_form_name_ja || "";
        if(!ja) continue;
        const norm = normalizeName(ja);
        if(!norm) continue;
        dexNames.push({ ja, norm });
      }
      // create set
      dexSet = new Set(dexNames.map(x=>x.norm));
      dexReady = true;
    }catch(e){
      // keep dexReady false; OCR will still run but matching will be weaker
      dexReady = false;
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

    try{
      await ensureTesseract();
      await ensureDex();

      const langPaths = [
        "https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn@1.0.0/4.0.0_best_int/",
        "https://unpkg.com/@tesseract.js-data/jpn@1.0.0/4.0.0_best_int/",
      ];

      const makeWorker = async (langPath) => {
        const logger = (m) => {
          if(m && m.status && typeof m.progress === "number"){
            const pct = Math.round(m.progress * 100);
            setOcrStatus(`${m.status} ${pct}%`);
          }
        };
        // createWorker(lang, numWorkers, { langPath, logger })
        const p = window.Tesseract.createWorker("jpn", 1, { langPath, logger });
        // avoid infinite wait if blocked
        const timeoutMs = 25000;
        const timeout = new Promise((_,rej)=>setTimeout(()=>rej(new Error("OCR download timeout")), timeoutMs));
        return await Promise.race([p, timeout]);
      };

      let lastErr = null;
      for(const p of langPaths){
        try{
          ocrWorker = await makeWorker(p);
          ocrReady = true;
          setOcrStatus("OK");
          break;
        }catch(e){
          lastErr = e;
        }
      }
      if(!ocrReady) throw lastErr || new Error("OCR init failed");

    }catch(e){
      setOcrStatus("NG");
      console.error(e);
      alert("OCRが準備できませんでした。ネットワーク制限 or ブロックの可能性があります。");
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

      startLoop();

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
    setCapStatus("停止");
    busy = false;
  }

  function startLoop(){
    if(loopTimer) clearInterval(loopTimer);
    lastHash = 0;
    busy = false;
    loopTimer = setInterval(tick, 120); // quick check; OCR is throttled by OCR_INTERVAL_MS
  }

  async function tick(){
    if(!stream || !ocrReady || !ocrWorker) return;
    if(busy) return;

    const now = performance.now();
    if(now - lastOcrAt < OCR_INTERVAL_MS) return;

    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
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

      // if not matched, do nothing (keep stable)
      if(matched){
        if(matched === stableName){
          pendingName = "";
          pendingCount = 0;
          // refresh conf lightly
          stableConf = Math.max(stableConf, conf);
          detConf.textContent = String(Math.round(stableConf));
          saveLast(stableName, stableConf);
        }else{
          if(matched !== pendingName){
            pendingName = matched;
            pendingCount = 1;
          }else{
            pendingCount++;
          }
          if(pendingCount >= STABLE_NEED){
            pendingName = "";
            pendingCount = 0;
            setStable(matched, conf);
          }
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

  // -------- UI wiring --------
  btnStart.addEventListener("click", startCapture);
  btnStop.addEventListener("click", stopCapture);

  btnCopy.addEventListener("click", async () => {
    if(!stableName) return;
    try{
      await navigator.clipboard.writeText(stableName);
    }catch(e){
      // fallback
      const ta = document.createElement("textarea");
      ta.value = stableName;
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
