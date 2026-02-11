/* Pick Lab - Capture Assist (browser-only)
   - Capture a video input (USB capture device or OBS Virtual Camera)
   - Detect opponent name area from typical battle HUD (HP bar)
   - OCR Japanese text (optional) -> guess Pokémon name
   - Save to localStorage and sync to /calc and /sim
*/

(function(){
  const $ = (id) => document.getElementById(id);
  const elDevice = $("capDevice");
  const btnStart = $("capStart");
  const btnStop = $("capStop");
  const chkAuto = $("capAuto");
  const chkOcr = $("capUseOcr");
  const btnScanOnce = $("capScanOnce");
  const btnAddParty = $("capAddParty");
  const btnClear = $("capClear");
  const video = $("capVideo");
  const overlay = $("capOverlay");
  const nameEl = $("capName");
  const confEl = $("capConf");
  const rawEl = $("capRaw");
  const partyEl = $("capParty");

  const STORAGE_ACTIVE = "PICKLAB_CAPTURE_OPP_ACTIVE_V1";
  const STORAGE_PARTY  = "PICKLAB_CAPTURE_OPP_PARTY_V1";
  const STORAGE_WRAP   = "PICKLAB_CAPTURE_V1";

  let stream = null;
  let tickTimer = null;
  let lastName = "";
  let lastRaw = "";
  let lastConf = 0;

  // OCR
  let ocrReady = false;
  let ocrWorker = null;
  let ocrLoading = false;
  let ocrErrorMsg = "";

  // Dex names
  let dexReady = false;
  let dexNames = [];          // {ja, jaNorm}
  let dexNameSet = new Set();

  function now(){ return Date.now(); }
  function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

  function normalizeJa(s){
    return (s||"").normalize('NFKC')
      .replace(/\s+/g,"")
      .replace(/[\u2000-\u206F\u2E00-\u2E7F'"`^~_\-–—\.,:;!\?\(\)\[\]\{\}<>\\\/|]/g, "")
      .replace(/[（【\[]/g, "(")
      .replace(/[）】\]]/g, ")")
      .replace(/Lv\.?\s*\d+/gi, "")
      .trim();
  }

  function levenshtein(a,b){
    a = a||""; b=b||"";
    const n=a.length, m=b.length;
    if(!n) return m;
    if(!m) return n;
    const dp = new Array(m+1);
    for(let j=0;j<=m;j++) dp[j]=j;
    for(let i=1;i<=n;i++){
      let prev = dp[0];
      dp[0]=i;
      for(let j=1;j<=m;j++){
        const tmp = dp[j];
        const cost = (a[i-1]===b[j-1])?0:1;
        dp[j] = Math.min(
          dp[j] + 1,
          dp[j-1] + 1,
          prev + cost
        );
        prev = tmp;
      }
    }
    return dp[m];
  }

  async function loadDex(){
    if(dexReady) return;
    try{
      const res = await fetch('/dex/jp/POKEMON_ALL.json', {cache:'force-cache'});
      const list = await res.json();
      dexNames = [];
      dexNameSet = new Set();
      for(const p of list||[]){
        const jaBase = p.pokeapi_species_name_ja || p.yakkuncom_name || p.pokeapi_species_name_en || "";
        const jaForm = p.pokeapi_form_name_ja || "";
        const ja = (jaForm && jaForm !== "なし") ? `${jaBase}（${jaForm}）` : jaBase;
        if(!ja) continue;
        const jaNorm = normalizeJa(ja);
        if(!jaNorm) continue;
        if(dexNameSet.has(jaNorm)) continue;
        dexNameSet.add(jaNorm);
        dexNames.push({ja, jaNorm});
      }
      dexReady = true;
    }catch(err){
      console.error(err);
      dexReady = false;
    }
  }

  function bestMatchName(raw){
    const q = normalizeJa(raw);
    if(!q) return {name:"", score:0};
    if(dexNameSet.has(q)){
      const hit = dexNames.find(x=>x.jaNorm===q);
      return {name: hit?hit.ja:q, score:1};
    }
    // fuzzy match (cheap): compare only candidates with same first char
    const first = q[0];
    let best = null;
    let bestScore = 0;
    let bestDist = 999;
    for(const x of dexNames){
      if(x.jaNorm[0] !== first) continue;
      const d = levenshtein(q, x.jaNorm);
      const maxLen = Math.max(q.length, x.jaNorm.length) || 1;
      const score = 1 - (d / maxLen);
      if(score > bestScore){
        bestScore = score;
        bestDist = d;
        best = x.ja;
      }else if(score === bestScore && d < bestDist){
        bestDist = d;
        best = x.ja;
      }
    }
    // fallback: global search if nothing
    if(!best){
      for(const x of dexNames){
        const d = levenshtein(q, x.jaNorm);
        const maxLen = Math.max(q.length, x.jaNorm.length) || 1;
        const score = 1 - (d / maxLen);
        if(score > bestScore){ bestScore=score; best=x.ja; }
      }
    }
    return {name: best||"", score: clamp(bestScore,0,1)};
  }

  function drawOverlay(rects){
    const ctx = overlay.getContext('2d');
    overlay.width = video.videoWidth || 1280;
    overlay.height = video.videoHeight || 720;
    ctx.clearRect(0,0,overlay.width,overlay.height);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,138,0,.95)';
    for(const r of (rects||[])){
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }

  function getParty(){
    try{
      const arr = JSON.parse(localStorage.getItem(STORAGE_PARTY)||'[]');
      return Array.isArray(arr) ? arr : [];
    }catch(_){ return []; }
  }
  function saveParty(arr){
    localStorage.setItem(STORAGE_PARTY, JSON.stringify(arr));
    // wrapper (debug / future)
    localStorage.setItem(STORAGE_WRAP, JSON.stringify({
      updatedAt: now(),
      active: localStorage.getItem(STORAGE_ACTIVE)||"",
      party: arr
    }));
  }
  function setActive(nm){
    localStorage.setItem(STORAGE_ACTIVE, nm||"");
    localStorage.setItem(STORAGE_WRAP, JSON.stringify({
      updatedAt: now(),
      active: nm||"",
      party: getParty()
    }));
  }

  function renderParty(){
    const party = getParty();
    partyEl.innerHTML = '';
    if(!party.length){
      const d = document.createElement('div');
      d.className='small';
      d.style.opacity = .75;
      d.textContent = '（まだありません）';
      partyEl.appendChild(d);
      return;
    }
    party.forEach((nm, idx)=>{
      const row = document.createElement('div');
      row.className='capPartyItem';
      const left = document.createElement('div');
      left.innerHTML = `<div class="name">${nm}</div><div class="meta">#${idx+1}</div>`;
      const right = document.createElement('div');
      const del = document.createElement('button');
      del.className='btn-danger small';
      del.type='button';
      del.textContent='削除';
      del.addEventListener('click', ()=>{
        const a = getParty().filter((_,i)=>i!==idx);
        saveParty(a);
        renderParty();
      });
      right.appendChild(del);
      row.appendChild(left);
      row.appendChild(right);
      partyEl.appendChild(row);
    });
  }

  async function ensureOcr(){
    if(ocrReady) return;
    if(ocrLoading) return;
    ocrLoading = true;
    ocrErrorMsg = "";
    nameEl.textContent = 'OCR準備中…';
    confEl.textContent = '';
    try{
      await new Promise((resolve, reject)=>{
        if(window.Tesseract) return resolve();
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('tesseract load failed'));
        document.head.appendChild(s);
      });
      ocrWorker = await window.Tesseract.createWorker('jpn', 1, {
        // best effort: host lang data via jsdelivr package
        langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/jpn/4.0.0_best/',
        logger: m => {
          if(m && m.status && typeof m.progress === 'number'){
            const pct = Math.round(m.progress*100);
            confEl.textContent = `${m.status} ${pct}%`;
          }
        }
      });
      await ocrWorker.setParameters({
        // name is usually one line
        tessedit_pageseg_mode: '7',
        preserve_interword_spaces: '1',
        user_defined_dpi: '300'
      });
      ocrReady = true;
    }catch(err){
      console.error(err);
      ocrErrorMsg = 'OCRの準備に失敗しました（ネットワーク / ブロック設定 / 拡張機能の影響の可能性）。';
      chkOcr.checked = false;
      ocrReady = false;
    }finally{
      ocrLoading = false;
    }
  }

  function isGreen(r,g,b){
    return (g > 110 && g > r + 28 && g > b + 28);
  }

  function findHpBarRect(img, w, h){
    // returns {x,y,w,h} in this downscaled image coordinates
    // Heuristic: find the longest horizontal run of green pixels.
    let best = null;
    let bestLen = 0;
    for(let y=0;y<h;y++){
      let runStart = -1;
      for(let x=0;x<w;x++){
        const i = (y*w + x) * 4;
        const r = img.data[i], g = img.data[i+1], b = img.data[i+2];
        const ok = isGreen(r,g,b);
        if(ok){
          if(runStart<0) runStart = x;
        }else{
          if(runStart>=0){
            const len = x - runStart;
            if(len > bestLen){ bestLen = len; best = {x:runStart, y, w:len, h:1}; }
            runStart = -1;
          }
        }
      }
      if(runStart>=0){
        const len = w - runStart;
        if(len > bestLen){ bestLen = len; best = {x:runStart, y, w:len, h:1}; }
      }
    }
    if(!best || bestLen < Math.max(40, Math.floor(w*0.08))) return null;

    // Expand height: include nearby green pixels to approximate bar thickness
    let top = best.y, bot = best.y;
    for(let y=best.y-8;y<=best.y+8;y++){
      if(y<0||y>=h) continue;
      let cnt=0;
      for(let x=best.x; x<best.x+best.w; x++){
        const i=(y*w+x)*4;
        if(isGreen(img.data[i],img.data[i+1],img.data[i+2])) cnt++;
      }
      if(cnt > best.w*0.35){
        top = Math.min(top, y);
        bot = Math.max(bot, y);
      }
    }
    return {x:best.x, y:top, w:best.w, h:Math.max(1, bot-top+1)};
  }

  
  function detectGameRectFromFrame(frameCanvas){
    // Detect the active game picture area inside an OBS canvas (letterbox / borders tolerant).
    // Returns {x,y,w,h} in full-frame coords. Falls back to full frame if unsure.
    try{
      const W = frameCanvas.width, H = frameCanvas.height;
      const targetW = 480;
      const targetH = Math.max(1, Math.round(targetW * (H/W)));
      const small = document.createElement('canvas');
      small.width = targetW; small.height = targetH;
      const sctx = small.getContext('2d', {willReadFrequently:true});
      sctx.drawImage(frameCanvas, 0, 0, W, H, 0, 0, targetW, targetH);
      const img = sctx.getImageData(0,0,targetW,targetH);
      const d = img.data;

      // Consider pixels "active" if not near-black (sum > threshold) OR if they have enough chroma.
      const sumThr = 50;
      let minX = targetW, minY = targetH, maxX = -1, maxY = -1;
      const stride = 2; // faster
      for(let y=0;y<targetH;y+=stride){
        for(let x=0;x<targetW;x+=stride){
          const i = (y*targetW + x) * 4;
          const r=d[i], g=d[i+1], b=d[i+2];
          const sum = r+g+b;
          const chroma = Math.max(r,g,b) - Math.min(r,g,b);
          if(sum > sumThr || chroma > 18){
            if(x<minX) minX=x;
            if(y<minY) minY=y;
            if(x>maxX) maxX=x;
            if(y>maxY) maxY=y;
          }
        }
      }
      if(maxX<=minX || maxY<=minY){
        return {x:0,y:0,w:W,h:H};
      }
      // Expand a little margin
      const padX = Math.round((maxX-minX) * 0.03);
      const padY = Math.round((maxY-minY) * 0.03);
      minX = clamp(minX - padX, 0, targetW-1);
      maxX = clamp(maxX + padX, 0, targetW-1);
      minY = clamp(minY - padY, 0, targetH-1);
      maxY = clamp(maxY + padY, 0, targetH-1);

      const scaleX = W / targetW;
      const scaleY = H / targetH;
      const gx = Math.floor(minX * scaleX);
      const gy = Math.floor(minY * scaleY);
      const gw = Math.max(1, Math.floor((maxX-minX+1) * scaleX));
      const gh = Math.max(1, Math.floor((maxY-minY+1) * scaleY));

      // Sanity: if too small, ignore.
      if(gw < W*0.35 || gh < H*0.35){
        return {x:0,y:0,w:W,h:H};
      }
      return {x:gx, y:gy, w:gw, h:gh};
    }catch(e){
      return {x:0,y:0,w:frameCanvas.width,h:frameCanvas.height};
    }
  }

  function findHpBarOnCanvas(frameCanvas, searchRect){
    // Multi-scale search for HP green bar within a given rect of the full frame.
    const W = frameCanvas.width, H = frameCanvas.height;
    const r = searchRect || {x:0,y:0,w:W,h:H};
    const smallW = 520;
    const smallH = Math.max(1, Math.round(smallW * (r.h/r.w)));
    const small = document.createElement('canvas');
    small.width = smallW; small.height = smallH;
    const sctx = small.getContext('2d', {willReadFrequently:true});
    sctx.drawImage(frameCanvas, r.x, r.y, r.w, r.h, 0, 0, smallW, smallH);
    const img = sctx.getImageData(0,0,smallW,smallH);
    const hp = findHpBarRect(img, smallW, smallH);
    if(!hp) return null;
    const scaleX = r.w / smallW;
    const scaleY = r.h / smallH;
    return {
      x: r.x + Math.floor(hp.x * scaleX),
      y: r.y + Math.floor(hp.y * scaleY),
      w: Math.floor(hp.w * scaleX),
      h: Math.floor(hp.h * scaleY)
    };
  }

function preprocessForOcr(srcCanvas){
    // OCR向け前処理：グレースケール → コントラスト強調 → Otsu二値化（白背景/黒文字に寄せる）
    const c = document.createElement('canvas');
    c.width = srcCanvas.width;
    c.height = srcCanvas.height;
    const ctx = c.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(srcCanvas,0,0);

    const img = ctx.getImageData(0,0,c.width,c.height);
    const d = img.data;
    const hist = new Uint32Array(256);

    // 1) grayscale + contrast
    let sum = 0;
    const contrast = 1.35; // 1.0〜1.6くらいが効きやすい
    const mid = 128;
    for(let i=0;i<d.length;i+=4){
      const r=d[i], g=d[i+1], b=d[i+2];
      let y = (r*0.299 + g*0.587 + b*0.114);
      y = (y - mid) * contrast + mid;
      y = clamp(Math.round(y), 0, 255);
      d[i]=d[i+1]=d[i+2]=y;
      d[i+3]=255;
      hist[y]++;
      sum += y;
    }
    const total = (d.length/4) || 1;
    const mean = sum / total;

    // 2) Otsu threshold
    let sumAll = 0;
    for(let t=0;t<256;t++) sumAll += t * hist[t];
    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let varMax = 0;
    let thr = 160;
    for(let t=0;t<256;t++){
      wB += hist[t];
      if(wB === 0) continue;
      wF = total - wB;
      if(wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sumAll - sumB) / wF;
      const varBetween = wB * wF * (mB - mF) * (mB - mF);
      if(varBetween > varMax){
        varMax = varBetween;
        thr = t;
      }
    }

    // 3) binarize
    // 画面は暗背景＋白文字が多いので、平均が暗ければ「明るい方＝文字」とみなす
    const brightText = mean < 145;
    for(let i=0;i<d.length;i+=4){
      const y = d[i];
      const isText = brightText ? (y > thr) : (y < thr);
      const v = isText ? 0 : 255; // 黒文字 / 白背景
      d[i]=d[i+1]=d[i+2]=v;
    }

    ctx.putImageData(img,0,0);
    return c;
  }

  async function detectOnce(){
    if(!video.videoWidth || !video.videoHeight) return;
    await loadDex();

    // Capture current frame
    const W = video.videoWidth, H = video.videoHeight;
    const frame = document.createElement('canvas');
    frame.width = W; frame.height = H;
    const fctx = frame.getContext('2d', {willReadFrequently:true});
    fctx.drawImage(video, 0, 0, W, H);

    // Detect active game picture area (letterbox / borders tolerant)
const gameRect = detectGameRectFromFrame(frame);

// Search rect (primary): top-right inside the detected game area
let roi = {
  x: Math.floor(gameRect.x + gameRect.w * 0.55),
  y: Math.floor(gameRect.y + gameRect.h * 0.03),
  w: Math.floor(gameRect.w * 0.44),
  h: Math.floor(gameRect.h * 0.32)
};
roi.x = clamp(roi.x, 0, W-1);
roi.y = clamp(roi.y, 0, H-1);
roi.w = clamp(roi.w, 60, W);
roi.h = clamp(roi.h, 60, H);
if(roi.x + roi.w > W) roi.w = W - roi.x;
if(roi.y + roi.h > H) roi.h = H - roi.y;

function searchHpIn(rect, sw){
  const smallW = sw || 360;
  const smallH = Math.max(1, Math.round(smallW * (rect.h/rect.w)));
  const small = document.createElement('canvas');
  small.width = smallW; small.height = smallH;
  const sctx = small.getContext('2d', {willReadFrequently:true});
  sctx.drawImage(frame, rect.x, rect.y, rect.w, rect.h, 0, 0, smallW, smallH);
  const img = sctx.getImageData(0,0,smallW,smallH);
  const hp = findHpBarRect(img, smallW, smallH);
  if(!hp) return null;
  const scaleX = rect.w / smallW;
  const scaleY = rect.h / smallH;
  return {
    x: rect.x + Math.floor(hp.x * scaleX),
    y: rect.y + Math.floor(hp.y * scaleY),
    w: Math.floor(hp.w * scaleX),
    h: Math.floor(hp.h * scaleY)
  };
}

let hpFull = searchHpIn(roi, 360);
let usedRoi = roi;

// Fallback: search wider area (top portion of the detected game area)
if(!hpFull){
  const wide = {
    x: gameRect.x,
    y: gameRect.y,
    w: gameRect.w,
    h: Math.max(1, Math.floor(gameRect.h * 0.58))
  };
  hpFull = searchHpIn(wide, 520);
  usedRoi = wide;
}


    if(!hpFull){
      drawOverlay([]);
      nameEl.textContent = '-';
      confEl.textContent = 'HPバー検出なし（画面右上にHPが出る場面で試してください）';
      rawEl.textContent = '';
      btnAddParty.disabled = true;
      return;
    }

    // Name crop: expand around bar to include the name text (usually above/left of bar)
    const crop = {
      x: clamp(Math.floor(hpFull.x - hpFull.w*0.65), 0, W-1),
      y: clamp(Math.floor(hpFull.y - hpFull.h*7.5), 0, H-1),
      w: clamp(Math.floor(hpFull.w*1.75), 40, W),
      h: clamp(Math.floor(hpFull.h*9.5), 32, H)
    };
    if(crop.x + crop.w > W) crop.w = W - crop.x;
    if(crop.y + crop.h > H) crop.h = H - crop.y;

    drawOverlay([
      {x: usedRoi.x, y: usedRoi.y, w: usedRoi.w, h: usedRoi.h},
      {x: hpFull.x, y: hpFull.y, w: hpFull.w, h: Math.max(8,hpFull.h)},
      {x: crop.x, y: crop.y, w: crop.w, h: crop.h}
    ]);

    async function ocrFromCrop(scaleUp){
      const o = document.createElement('canvas');
      o.width = Math.floor(crop.w * scaleUp);
      o.height = Math.floor(crop.h * scaleUp);
      const octx = o.getContext('2d', {willReadFrequently:true});
      octx.imageSmoothingEnabled = false;
      octx.drawImage(frame, crop.x, crop.y, crop.w, crop.h, 0, 0, o.width, o.height);
      const pre = preprocessForOcr(o);
      const r = await ocrWorker.recognize(pre);
      return (r && r.data && r.data.text) ? r.data.text : "";
    }

    let raw = "";
    if(chkOcr.checked){
      await ensureOcr();
      if(ocrReady){
        // 1st try: x3
        raw = await ocrFromCrop(3);
        // 2nd try: x4（小さい文字対策）
        if(!normalizeJa(raw)){
          raw = await ocrFromCrop(4);
        }
      }
    }

    // If OCR off, try a simple heuristic by reading pixels of the name region? (not reliable)
    if(!raw){
      raw = '';
    }

    lastRaw = raw;
    if(ocrErrorMsg){
      rawEl.textContent = ocrErrorMsg;
    }else if(!chkOcr.checked){
      rawEl.textContent = '（OCR OFF）';
    }else if(!normalizeJa(raw)){
      rawEl.textContent = '（OCR結果なし）';
    }else{
      rawEl.textContent = `OCR: ${raw.replace(/\n+/g,' / ')}`;
    }

    const extracted = extractNameCandidate(raw);
    const {name, score} = bestMatchName(extracted || raw);
    lastName = name;
    lastConf = score;

    if(name){
      nameEl.textContent = name;
      confEl.textContent = `一致度: ${Math.round(score*100)}%`;
      setActive(name);
      btnAddParty.disabled = false;
    }else{
      nameEl.textContent = '-';
      confEl.textContent = ocrErrorMsg
        ? ocrErrorMsg
        : chkOcr.checked
          ? '判定できません（相手名の文字が読み取れません。右上に相手名が出ている場面で試してください）'
          : '判定できません（OCRをONにしてください）';
      btnAddParty.disabled = true;
    }
  }

  function extractNameCandidate(text){
    const t = (text||"")
      .replace(/Lv\.?\s*\d+/gi,'')
      .replace(/[0-9]/g,'')
      .replace(/\s+/g,'');
    // pick longest JP chunk
    const m = t.match(/[\u3040-\u30FF\u4E00-\u9FFFー]{2,}/g);
    if(!m || !m.length) return '';
    m.sort((a,b)=>b.length-a.length);
    return m[0];
  }

  function addToParty(name){
    const nm = (name||"").trim();
    if(!nm) return;
    const party = getParty();
    if(party.includes(nm)) return;
    if(party.length >= 6) party.shift();
    party.push(nm);
    saveParty(party);
    renderParty();
  }

  async function refreshDevices(){
    try{
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d=>d.kind==='videoinput');
      elDevice.innerHTML = '';
      cams.forEach((d, idx)=>{
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `カメラ${idx+1}`;
        elDevice.appendChild(opt);
      });
      if(!cams.length){
        const opt = document.createElement('option');
        opt.value='';
        opt.textContent='（ビデオ入力が見つかりません）';
        elDevice.appendChild(opt);
      }
    }catch(err){
      console.error(err);
    }
  }

  async function start(){
    confEl.textContent = '';
    rawEl.textContent = '';
    try{
      if(stream) stop();

      // Refresh device list (helps when OBS Virtual Camera starts after page load)
      await refreshDevices();

      const selectedId = elDevice.value || '';
      const oneOpt = elDevice.options && elDevice.options.length === 1 ? (elDevice.options[0].textContent||'') : '';
      const noDevice = (!selectedId) && oneOpt.includes('見つかりません');
      if(noDevice){
        confEl.textContent = 'ビデオ入力が見つかりません。キャプチャがPCに認識されているか（Windowsの「カメラ」アプリで映るか）、USB3.0直挿し、またはOBSの「仮想カメラ開始」を確認してください。';
        return;
      }

      const tries = [];
      if(selectedId){
        // Use ideal (not exact) so it doesn't fail easily when deviceId changes
        tries.push({ video: { deviceId: { ideal: selectedId } }, audio: false });
      }
      // Fallback: any camera
      tries.push({ video: true, audio: false });

      let lastErr = null;
      for(const c of tries){
        try{
          stream = await navigator.mediaDevices.getUserMedia(c);
          break;
        }catch(e){
          lastErr = e;
        }
      }
      if(!stream) throw lastErr || new Error('getUserMedia failed');

      video.srcObject = stream;
      await video.play();
      btnStop.disabled = false;
      btnStart.disabled = true;
      setTimeout(()=>drawOverlay([]), 200);
      if(chkAuto.checked){
        tickTimer = setInterval(()=>detectOnce().catch(console.error), 2000);
      }
    }catch(err){
      console.error(err);
      const name = (err && err.name) ? err.name : 'Error';
      const msg  = (err && err.message) ? err.message : String(err);
      let hint = '';
      if(name === 'NotAllowedError' || name === 'SecurityError'){
        hint = 'カメラ許可がブロックされています。ブラウザのアドレスバー左(鍵)→サイト設定→カメラを「許可」、Windows設定→プライバシー→カメラも確認してください。';
      }else if(name === 'NotFoundError' || name === 'OverconstrainedError'){
        hint = '選んだデバイスが見つかりません。OBS Virtual Cameraを開始してから選び直す、または別デバイスを選んでください。';
      }else if(name === 'NotReadableError'){
        hint = '別アプリがカメラを掴んでいる可能性があります。Zoom/Teams/Discord/別タブのカメラ使用を閉じて再試行してください。';
      }else if(name === 'TypeError'){
        hint = 'HTTPSで開いているか確認してください（Cloudflare Pages上ならOK）。';
      }
      confEl.textContent = `開始できません: ${name} / ${msg}${hint ? '。' + hint : ''}`;
    }
  }
  function stop(){
    if(tickTimer){ clearInterval(tickTimer); tickTimer=null; }
    if(stream){
      stream.getTracks().forEach(t=>t.stop());
      stream = null;
    }
    btnStop.disabled = true;
    btnStart.disabled = false;
    try{ video.pause(); }catch(_){ }
  }

  // Events
  btnStart.addEventListener('click', start);
  btnStop.addEventListener('click', stop);
  btnScanOnce.addEventListener('click', ()=>detectOnce().catch(console.error));
  btnAddParty.addEventListener('click', ()=>addToParty(lastName));
  btnClear.addEventListener('click', ()=>{
    localStorage.removeItem(STORAGE_ACTIVE);
    localStorage.removeItem(STORAGE_PARTY);
    localStorage.removeItem(STORAGE_WRAP);
    lastName=''; lastRaw=''; lastConf=0;
    nameEl.textContent='-';
    confEl.textContent='';
    rawEl.textContent='';
    btnAddParty.disabled=true;
    renderParty();
  });
  chkAuto.addEventListener('change', ()=>{
    if(chkAuto.checked){
      if(stream && !tickTimer) tickTimer = setInterval(()=>detectOnce().catch(console.error), 2000);
    }else{
      if(tickTimer){ clearInterval(tickTimer); tickTimer=null; }
    }
  });
  chkOcr.addEventListener('change', async ()=>{
    if(chkOcr.checked) await ensureOcr();
  });

  // When party updated in other tab
  window.addEventListener('storage', (e)=>{
    if(e.key===STORAGE_PARTY) renderParty();
  });

  // Boot
  (async ()=>{
    renderParty();
    try{
      await refreshDevices();
      // Request a dummy permission to get device labels (optional)
      // Some browsers hide labels until permission is granted.
    }catch(_){ }
    if(navigator.mediaDevices && navigator.mediaDevices.addEventListener){
      navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    }
  })();

})();
