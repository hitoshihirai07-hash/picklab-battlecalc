/* Pick Lab Capture - Opponent 6 icons snap (auto guess v6)
   Goal:
   - Paste/choose screenshot of team select screen (full screen or opponent panel)
   - Crop 6 icon ROIs (auto detect + tiny manual tweak knobs)
   - Auto identify each icon by perceptual-hash (dHash) against PokéSprite Gen8 spritesheet
   - When confidence is high, auto-lock; otherwise show top candidates to pick from

   Notes:
   - First run downloads PokéSprite spritesheet (~5MB) and builds a small hash DB in localStorage.
   - After that, matching is instant and fully client-side.
*/
(function(){
  'use strict';
  const $ = (id)=>document.getElementById(id);

  const elFile = $('teamFile');
  const btnPaste = $('btnPasteTeam');
  const btnAuto = $('btnAutoDetectTeam');
  const elStatus = $('autoStatus');

  const imgPrev = $('teamPreview');
  const slotWrap = $('teamSlots');

  const dxEl = $('roiDx');
  const dyEl = $('roiDy');
  const scEl = $('roiScale');

  const confWrap = $('teamConfirmed');
  const confList = $('confList');
  const btnCopyTeam = $('btnCopyTeam');
  const btnResetTeam = $('btnResetTeam');

  const activeWrap = $('activePick');
  const activeName = $('activeName');
  const btnCopyActive = $('btnCopyActive');

  if(!elFile || !btnPaste || !imgPrev || !slotWrap) return;

  // ---- Config (PokéSprite Gen8) ----
  const SPRITE = {
    version: 'pokesprite_gen8_v2',
    // We'll resolve a working mirror at runtime (CORS + availability)
    fileCss: 'pokesprite-pokemon-gen8.css',
    fileImg: 'pokesprite-pokemon-gen8.png',
    bases: [
      'https://msikma.github.io/pokesprite-spritesheet/',
      'https://raw.githubusercontent.com/msikma/pokesprite-spritesheet/master/docs/',
      'https://raw.githubusercontent.com/msikma/pokesprite-spritesheet/master/',
      'https://cdn.jsdelivr.net/npm/pokesprite-spritesheet@0.1.0/',
      'https://unpkg.com/pokesprite-spritesheet@0.1.0/',
      './',                // if you add the files locally later
      './pokesprite/',     // optional local folder
    ],
    // resolved at runtime
    cssUrl: '',
    imgUrl: '',
    tileW: 68,
    tileH: 56,
  };

  // LocalStorage keys
  const LS_TEAM = 'picklab_opp_team_v6_auto';
  const LS_ACTIVE = 'picklab_opp_active_v6_auto';
  const LS_HASHDB = 'picklab_pokesprite_hashdb_' + SPRITE.version; // [{slug,h}]
  const LS_HASHDB_META = 'picklab_pokesprite_hashdb_meta_' + SPRITE.version;

  // Confidence heuristics
  const CONF_MAX_DIST = 6;     // smaller = more strict
  const CONF_GAP_DIST = 3;     // top2 distance gap

  // ROI ratios based on the user's full screenshot sample (ratios)
  const ROI_RATIOS = [
    {x1:0.634076, y1:0.218534, x2:0.694464, y2:0.334716},
    {x1:0.633357, y1:0.334716, x2:0.693746, y2:0.450899},
    {x1:0.642703, y1:0.442600, x2:0.703091, y2:0.558783},
    {x1:0.635514, y1:0.540802, x2:0.695902, y2:0.656985},
    {x1:0.633357, y1:0.644537, x2:0.693746, y2:0.760719},
    {x1:0.639827, y1:0.762102, x2:0.700216, y2:0.878285},
  ];

  // Panel-only fallback ratios
  const PANEL_ROI_FALLBACK = [
    {x1:0.02, y1:0.02,  x2:0.27, y2:0.17},
    {x1:0.02, y1:0.19,  x2:0.27, y2:0.33},
    {x1:0.02, y1:0.35,  x2:0.27, y2:0.49},
    {x1:0.02, y1:0.52,  x2:0.27, y2:0.66},
    {x1:0.02, y1:0.68,  x2:0.27, y2:0.82},
    {x1:0.02, y1:0.85,  x2:0.27, y2:0.99},
  ];

  let screenshotImg = null;
  let slots = []; // [{dataUrl, hash(BigInt), candidates:[{slug,dist}], chosenSlug, chosenName, locked}]
  let slugToJP = null; // Map slug->jpName
  let hashDB = null; // [{slug, h:BigInt}]

  // ---- tiny helpers ----
  function setStatus(msg, isError=false){
    if(elStatus){
      elStatus.textContent = msg || '';
      elStatus.style.color = isError ? 'var(--danger, #c62828)' : '';
    }
  }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }


  // ---- sprite assets resolver (avoid CORS/404 issues) ----
  let spriteReady = null; // {cssText, sheet, cssUrl, imgUrl}
  async function ensureSpriteReady(){
    if(spriteReady) return spriteReady;

    const errs = [];
    for(const base of (SPRITE.bases || [])){
      const cssUrl = base + SPRITE.fileCss;
      const imgUrl = base + SPRITE.fileImg;
      try{
        const cssRes = await fetch(cssUrl, {cache:'force-cache'});
        if(!cssRes.ok) throw new Error('CSS HTTP ' + cssRes.status);
        const cssText = await cssRes.text();

        // Try to load sheet (also validates CORS)
        const sheet = await imageFromSrc(imgUrl);

        // Record resolved urls for later (CSS injection replaces relative url(...) using SPRITE.imgUrl)
        SPRITE.cssUrl = cssUrl;
        SPRITE.imgUrl = imgUrl;

        injectPokeSpriteCSS(cssText);
        spriteReady = {cssText, sheet, cssUrl, imgUrl};
        return spriteReady;
      }catch(e){
        errs.push(`${cssUrl} -> ${e?.message || e}`);
      }
    }
    throw new Error('参照スプライト取得に失敗しました（ブロック/404の可能性）\n' + errs.slice(0,4).join('\n'));
  }

  function roiParams(){
    const dx = parseFloat(dxEl?.value || '0') || 0; // percent
    const dy = parseFloat(dyEl?.value || '0') || 0;
    const sc = parseFloat(scEl?.value || '100') || 100;
    return {dx:dx/100, dy:dy/100, sc:sc/100};
  }
  function applyRoi(r){
    const {dx,dy,sc} = roiParams();
    const cx = (r.x1 + r.x2)/2 + dx;
    const cy = (r.y1 + r.y2)/2 + dy;
    const w = (r.x2 - r.x1) * sc;
    const h = (r.y2 - r.y1) * sc;
    return {x1: cx - w/2, y1: cy - h/2, x2: cx + w/2, y2: cy + h/2};
  }

  function imageToImageData(img){
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d', {willReadFrequently:true});
    const W = img.naturalWidth, H = img.naturalHeight;
    c.width = W; c.height = H;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, W, H);
  }

  function detectPanelRois(imageData, W, H){
    // Find 6 dense horizontal bands on the left side.
    const data = imageData.data;
    const thr = 245;
    const leftMaxX = Math.max(18, Math.floor(W * 0.35));
    const iconMaxX = Math.max(18, Math.floor(W * 0.28));
    const rowSums = new Array(H).fill(0);

    for(let y=0;y<H;y++){
      let cnt = 0;
      const row = y * W * 4;
      for(let x=0;x<leftMaxX;x++){
        const i = row + x*4;
        const r = data[i], g = data[i+1], b = data[i+2];
        if(r < thr || g < thr || b < thr) cnt++;
      }
      rowSums[y] = cnt;
    }

    const minCnt = Math.max(2, Math.floor(iconMaxX * 0.06));
    const segs = [];
    let inSeg=false, s=0;
    for(let y=0;y<H;y++){
      if(rowSums[y] > minCnt && !inSeg){ inSeg=true; s=y; }
      if(inSeg && rowSums[y] <= minCnt){
        const e=y-1;
        if(e-s > 8) segs.push([s,e]);
        inSeg=false;
      }
    }
    if(inSeg) segs.push([s,H-1]);

    // Merge close segments then pick top 6 by height
    const merged = [];
    for(const seg of segs){
      if(!merged.length){ merged.push(seg); continue; }
      const last = merged[merged.length-1];
      if(seg[0] - last[1] <= 6){
        last[1] = seg[1];
      }else merged.push(seg);
    }

    // If we got too many, keep the most "likely" 6 by height
    const cand = merged
      .map(([a,b])=>({a,b,h:b-a}))
      .filter(o=>o.h > 14)
      .sort((p,q)=>q.h - p.h)
      .slice(0, 6)
      .sort((p,q)=>p.a - q.a);

    if(cand.length !== 6) return null;

    // Build ROI boxes for icon area (left side only)
    const rois = cand.map(o=>{
      const y1 = o.a / H;
      const y2 = (o.b+1) / H;
      return {x1:0.01, y1:y1+0.01, x2:0.26, y2:y2-0.01};
    });
    return rois;
  }

  function cropToDataURL(img, roi){
    const W = img.naturalWidth, H = img.naturalHeight;
    const r = applyRoi(roi);
    const x1 = clamp(Math.floor(r.x1 * W), 0, W-1);
    const y1 = clamp(Math.floor(r.y1 * H), 0, H-1);
    const x2 = clamp(Math.ceil (r.x2 * W), 1, W);
    const y2 = clamp(Math.ceil (r.y2 * H), 1, H);

    const cw = Math.max(2, x2 - x1);
    const ch = Math.max(2, y2 - y1);

    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(img, x1, y1, cw, ch, 0, 0, cw, ch);
    return c.toDataURL('image/png');
  }

  async function loadDexMap(){
    if(slugToJP) return slugToJP;
    const r = await fetch('../dex/jp/POKEMON_ALL.json', {cache:'no-store'});
    if(!r.ok) throw new Error('POKEMON_ALL.json が読めません');
    const arr = await r.json();

    const map = new Map();
    for(const e of (arr||[])){
      const jp = (e.yakkuncom_name || e.pokeapi_species_name_ja || '').trim();
      if(!jp) continue;
      const keys = [
        e.pokeapi_form_id_name,
        e.pokeapi_pokemon_id_name,
        e.pokeapi_species_id_name,
      ].filter(Boolean).map(s=>String(s).trim());
      for(const k of keys){
        if(!k) continue;
        if(!map.has(k)) map.set(k, jp);
      }
    }
    slugToJP = map;
    return map;
  }

  function jpName(slug){
    if(!slug) return '';
    return (slugToJP && slugToJP.get(slug)) || slug;
  }

  // ---- Perceptual hash (dHash 8x8 => 64bit) ----
  function dhashFromImageData(imgData){
    // imgData is 9x8 RGBA
    const d = imgData.data;
    let h = 0n;
    let bit = 0n;
    for(let y=0;y<8;y++){
      for(let x=0;x<8;x++){
        const i1 = (y*9 + x)*4;
        const i2 = (y*9 + (x+1))*4;
        const g1 = (d[i1]*3 + d[i1+1]*6 + d[i1+2]) / 10;
        const g2 = (d[i2]*3 + d[i2+1]*6 + d[i2+2]) / 10;
        if(g1 > g2) h |= (1n << bit);
        bit++;
      }
    }
    return h;
  }

  function popcount64(x){
    // BigInt popcount
    let c = 0;
    while(x){
      x &= (x - 1n);
      c++;
    }
    return c;
  }

  function hamming(a,b){
    return popcount64(a ^ b);
  }

  async function imageFromSrc(src){
    return await new Promise((resolve,reject)=>{
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = ()=>resolve(im);
      im.onerror = ()=>reject(new Error('image load failed'));
      im.src = src;
    });
  }

  function injectPokeSpriteCSS(cssText){
    const id = 'pokespriteCssInjected';
    if(document.getElementById(id)) return;

    // Replace relative url(...) with absolute PNG URL
    const absPng = SPRITE.imgUrl;
    const patched = cssText.replace(/url\((?!['"]?https?:)([^)]+)\)/g, (m, p1)=>{
      // Normalize
      const v = String(p1).replace(/['"]/g,'').trim();
      // Most likely pokesprite-pokemon-gen8.png
      return `url('${absPng}')`;
    });

    const st = document.createElement('style');
    st.id = id;
    st.textContent = patched;
    document.head.appendChild(st);
  }

  function parseCSSPositions(cssText){
    // returns Map(slug -> {sx,sy})
    const map = new Map();
    const re = /\.pokesprite\.pokemon\.([a-z0-9-]+)\s*\{[^}]*background-position\s*:\s*([-0-9]+)px\s*([-0-9]+)px/gi;
    let m;
    while((m = re.exec(cssText))){
      const slug = m[1];
      const bx = parseInt(m[2],10);
      const by = parseInt(m[3],10);
      if(!Number.isFinite(bx) || !Number.isFinite(by)) continue;
      // background-position is negative offsets
      const sx = -bx;
      const sy = -by;
      if(!map.has(slug)) map.set(slug, {sx,sy});
    }
    return map;
  }

  async function buildHashDB(force=false){
    if(hashDB && !force) return hashDB;

    // Try cache first
    try{
      const meta = JSON.parse(localStorage.getItem(LS_HASHDB_META) || 'null');
      const raw = JSON.parse(localStorage.getItem(LS_HASHDB) || 'null');
      if(!force && meta && meta.version === SPRITE.version && Array.isArray(raw) && raw.length > 200){
        hashDB = raw.map(o=>({slug:o.slug, h: BigInt('0x' + o.h)}));
        // For UI previews only (non-fatal if blocked)
        ensureSpriteReady().catch(()=>{});
        return hashDB;
      }
    }catch(e){ /* ignore */ }

    setStatus('参照スプライト読込中…（初回のみ）');
    const assets = await ensureSpriteReady();
    const cssText = assets.cssText;
    const posMap = parseCSSPositions(cssText);
    if(posMap.size < 200) throw new Error('CSS解析に失敗しました（positionsが少ない）');

    const sheet = assets.sheet;

    setStatus('参照DB作成中…（初回のみ）');
    const tiny = document.createElement('canvas');
    tiny.width = 9; tiny.height = 8;
    const tctx = tiny.getContext('2d', {willReadFrequently:true});

    const entries = Array.from(posMap.entries());
    const out = [];
    // Chunk loop to keep UI responsive
    const chunk = 120;
    for(let i=0;i<entries.length;i++){
      const [slug, p] = entries[i];
      tctx.clearRect(0,0,9,8);
      tctx.drawImage(sheet, p.sx, p.sy, SPRITE.tileW, SPRITE.tileH, 0, 0, 9, 8);
      const id = tctx.getImageData(0,0,9,8);
      const h = dhashFromImageData(id);
      out.push({slug, h});
      if(i % chunk === 0){
        setStatus(`参照DB作成中… ${Math.floor(i/entries.length*100)}%（初回のみ）`);
        await new Promise(r=>requestAnimationFrame(r));
      }
    }

    // Save cache
    try{
      localStorage.setItem(LS_HASHDB_META, JSON.stringify({version:SPRITE.version, count:out.length, t:Date.now()}));
      localStorage.setItem(LS_HASHDB, JSON.stringify(out.map(o=>({slug:o.slug, h:o.h.toString(16)}))));
    }catch(e){ /* localStorage full etc */ }

    hashDB = out;
    setStatus('参照DB準備OK');
    return hashDB;
  }

  async function computeHashFromDataURL(dataUrl){
    const im = await imageFromSrc(dataUrl);
    const c = document.createElement('canvas');
    c.width = 9; c.height = 8;
    const ctx = c.getContext('2d', {willReadFrequently:true});
    ctx.clearRect(0,0,9,8);
    // Stretch to 9x8 for dHash; no need to preserve aspect
    ctx.drawImage(im, 0, 0, 9, 8);
    const id = ctx.getImageData(0,0,9,8);
    return dhashFromImageData(id);
  }

  function topMatches(hash, db, topN=6){
    const best = [];
    for(const o of db){
      const dist = hamming(hash, o.h);
      if(best.length < topN){
        best.push({slug:o.slug, dist});
        best.sort((a,b)=>a.dist-b.dist);
      }else if(dist < best[best.length-1].dist){
        best[best.length-1] = {slug:o.slug, dist};
        best.sort((a,b)=>a.dist-b.dist);
      }
    }
    return best;
  }

  function decideConfidence(cands){
    if(!cands || !cands.length) return false;
    const a = cands[0];
    const b = cands[1];
    if(a.dist > CONF_MAX_DIST) return false;
    if(!b) return true;
    return (b.dist - a.dist) >= CONF_GAP_DIST;
  }

  function allChosen(){
    return slots.length === 6 && slots.every(s=>!!s.chosenSlug);
  }

  function copyText(text){
    if(!text) return;
    navigator.clipboard?.writeText(text).catch(()=>{});
  }

  function refreshConfirmed(){
    if(!confWrap || !confList) return;
    if(!allChosen()){
      confWrap.style.display = 'none';
      return;
    }
    confWrap.style.display = '';
    confList.innerHTML = '';
    const frag = document.createDocumentFragment();
    const uniq = [];
    const seen = new Set();
    for(const s of slots){
      const name = jpName(s.chosenSlug);
      if(!seen.has(name)){
        seen.add(name);
        uniq.push({slug:s.chosenSlug, name});
      }
    }
    uniq.forEach((p)=>{
      const b = document.createElement('button');
      b.className = 'pill';
      b.type = 'button';
      b.textContent = p.name;
      b.addEventListener('click', ()=>{
        localStorage.setItem(LS_ACTIVE, p.name);
        activeName.textContent = p.name;
        activeWrap.style.display = '';
      });
      frag.appendChild(b);
    });
    confList.appendChild(frag);

    // Save
    try{
      localStorage.setItem(LS_TEAM, JSON.stringify(uniq.map(x=>x.name)));
    }catch(e){}

    activeName.textContent = localStorage.getItem(LS_ACTIVE) || '—';
    activeWrap.style.display = (activeName.textContent && activeName.textContent !== '—') ? '' : 'none';
  }

  function renderSlots(){
    slotWrap.innerHTML = '';
    const frag = document.createDocumentFragment();

    slots.forEach((s, idx)=>{
      const card = document.createElement('div');
      card.className = 'team-slot';

      const head = document.createElement('div');
      head.className = 'team-slot-head';
      const lockTxt = s.locked ? '（自動確定）' : '（候補から選択可）';
      head.innerHTML = `<div style="font-weight:800">枠 ${idx+1}</div><div class="muted" style="font-size:12px">${lockTxt}</div>`;

      const row = document.createElement('div');
      row.className = 'row';
      row.style.alignItems = 'center';

      const img = document.createElement('img');
      img.className = 'team-slot-crop';
      img.src = s.dataUrl;
      img.alt = `slot${idx+1}`;

      const box = document.createElement('div');
      box.style.flex = '1';
      box.style.minWidth = '220px';

      const pickRow = document.createElement('div');
      pickRow.className = 'row';
      pickRow.style.gap = '8px';

      const select = document.createElement('select');
      select.style.flex = '1';
      select.style.padding = '10px 12px';
      select.style.borderRadius = '12px';
      select.style.border = '1px solid var(--border)';
      select.style.background = 'var(--card)';

      const cands = s.candidates || [];
      if(!cands.length){
        const op = document.createElement('option');
        op.value = '';
        op.textContent = '候補がありません（スクショが違うかも）';
        select.appendChild(op);
      }else{
        cands.slice(0,6).forEach((c)=>{
          const op = document.createElement('option');
          op.value = c.slug;
          const name = jpName(c.slug);
          op.textContent = `${name}（距離${c.dist}）`;
          select.appendChild(op);
        });
      }

      select.value = s.chosenSlug || '';
      select.addEventListener('change', ()=>{
        s.locked = false;
        s.chosenSlug = select.value || '';
        s.chosenName = jpName(s.chosenSlug);
        head.querySelector('.muted').textContent = '（手動修正）';
        refreshConfirmed();
        renderSlots(); // refresh preview sprite
      });

      const preview = document.createElement('span');
      preview.style.width = '68px';
      preview.style.height = '56px';
      preview.style.display = 'inline-block';
      preview.style.borderRadius = '10px';
      preview.style.background = 'var(--bg)';
      preview.style.border = '1px solid var(--border)';
      preview.style.overflow = 'hidden';
      preview.style.flex = '0 0 auto';

      if(s.chosenSlug){
        const sp = document.createElement('span');
        sp.className = `pokesprite pokemon ${s.chosenSlug}`;
        sp.style.transform = 'scale(0.9)';
        sp.style.transformOrigin = 'top left';
        preview.appendChild(sp);
      }else{
        preview.textContent = '—';
        preview.style.display = 'flex';
        preview.style.alignItems = 'center';
        preview.style.justifyContent = 'center';
        preview.classList.add('muted');
      }

      const hint = document.createElement('div');
      hint.className = 'muted';
      hint.style.fontSize = '12px';
      hint.style.marginTop = '6px';
      hint.textContent = s.hash ? `推定: ${jpName(s.chosenSlug)} / 上位候補${Math.min(6, cands.length)}件` : '未解析';

      pickRow.appendChild(select);
      pickRow.appendChild(preview);
      box.appendChild(pickRow);
      box.appendChild(hint);

      row.appendChild(img);
      row.appendChild(box);

      card.appendChild(head);
      card.appendChild(row);
      frag.appendChild(card);
    });

    slotWrap.appendChild(frag);
    refreshConfirmed();
  }

  async function analyzeSlots(){
    if(!screenshotImg){
      setStatus('先にスクショを貼り付けてください', true);
      return;
    }
    try{
      setStatus('辞書読込中…');
      await loadDexMap();
      const db = await buildHashDB(false);

      setStatus('アイコン解析中…');
      for(const s of slots){
        s.hash = await computeHashFromDataURL(s.dataUrl);
        s.candidates = topMatches(s.hash, db, 6);
        s.chosenSlug = s.candidates[0]?.slug || '';
        s.chosenName = jpName(s.chosenSlug);
        s.locked = decideConfidence(s.candidates);
      }
      setStatus('解析完了（必要なら候補で修正）');
      renderSlots();
    }catch(err){
      console.error(err);
      setStatus('自動判定に失敗：' + (err?.message || err), true);
    }
  }

  function resetAll(){
    slots = [];
    screenshotImg = null;
    imgPrev.style.display = 'none';
    slotWrap.innerHTML = '';
    confWrap && (confWrap.style.display='none');
    activeWrap && (activeWrap.style.display='none');
    localStorage.removeItem(LS_TEAM);
    localStorage.removeItem(LS_ACTIVE);
    setStatus('');
  }

  async function handleScreenshot(img){
    screenshotImg = img;
    imgPrev.src = img.src;
    imgPrev.style.display = '';
    setStatus('切り出し中…');

    // Build 6 ROIs
    const W = img.naturalWidth, H = img.naturalHeight;
    let rois = null;

    // Heuristic: if looks like full screenshot, use fixed ratios; else try detect
    if(W >= 800 && H >= 450){
      rois = ROI_RATIOS;
    }

    if(!rois){
      const id = imageToImageData(img);
      rois = detectPanelRois(id, W, H);
    }
    if(!rois){
      rois = PANEL_ROI_FALLBACK;
      setStatus('自動検出が難しいため、簡易切り出しで進めます（ズレ補正で調整可）');
    }

    slots = rois.map((r)=>({
      dataUrl: cropToDataURL(img, r),
      hash: null,
      candidates: [],
      chosenSlug: '',
      chosenName: '',
      locked: false,
    }));
    renderSlots();

    // Auto analyze (most users want it)
    await analyzeSlots();
  }

  async function loadFromFile(file){
    const url = URL.createObjectURL(file);
    const img = await imageFromSrc(url);
    await handleScreenshot(img);
  }

  btnPaste.addEventListener('click', async ()=>{
    try{
      const items = await navigator.clipboard.read();
      for(const it of items){
        const type = it.types.find(t=>t.startsWith('image/'));
        if(!type) continue;
        const blob = await it.getType(type);
        await loadFromFile(new File([blob], 'clipboard.png', {type: blob.type}));
        return;
      }
      setStatus('画像がクリップボードに見つかりません', true);
    }catch(e){
      setStatus('貼り付けに失敗（ブラウザ権限を確認）', true);
    }
  });

  elFile.addEventListener('change', async ()=>{
    const f = elFile.files?.[0];
    if(!f) return;
    await loadFromFile(f);
  });

  (btnAuto || btnPaste).addEventListener('click', ()=>{
    // No-op: auto analyze already runs, but keep button for re-run
  });

  if(btnAuto){
    btnAuto.addEventListener('click', async ()=>{
      // Re-run analysis with current knobs
      if(!screenshotImg){ setStatus('先にスクショを貼り付けてください', true); return; }
      // Re-crop and analyze
      await handleScreenshot(screenshotImg);
    });
  }

  // knobs change -> re-crop only (fast), then analyze
  [dxEl,dyEl,scEl].forEach(el=>{
    if(!el) return;
    el.addEventListener('change', async ()=>{
      if(!screenshotImg || !slots.length) return;
      await handleScreenshot(screenshotImg);
    });
  });

  btnCopyTeam && btnCopyTeam.addEventListener('click', ()=>{
    if(!allChosen()) return;
    const names = slots.map(s=>jpName(s.chosenSlug));
    copyText(names.join('\n'));
    setStatus('6匹をコピーしました');
  });

  btnCopyActive && btnCopyActive.addEventListener('click', ()=>{
    const t = activeName?.textContent || '';
    if(t && t !== '—'){
      copyText(t);
      setStatus('現在の相手をコピーしました');
    }
  });

  btnResetTeam && btnResetTeam.addEventListener('click', resetAll);

  // Restore if exists
  try{
    const saved = JSON.parse(localStorage.getItem(LS_TEAM) || 'null');
    const cur = localStorage.getItem(LS_ACTIVE);
    if(Array.isArray(saved) && saved.length){
      // just show saved state (no crops)
      setStatus('前回の確定チームを復元しました');
      confWrap && (confWrap.style.display='');
      confList && (confList.innerHTML = saved.map(n=>`<span class="pill">${n}</span>`).join(''));
      if(cur){
        activeName.textContent = cur;
        activeWrap.style.display='';
      }
    }
  }catch(e){}

})();
