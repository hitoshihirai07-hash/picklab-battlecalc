/* Pick Lab Capture - Opponent 6 icons snap (AUTO v6)
   Goal: Webサイトとして“自動”で成立させるための現実解：
   - 選出画面（相手6匹の小アイコン）を貼り付け
   - 6枠のアイコンを自動クロップ
   - Pokémon Showdown の pokemonicons-sheet.png を参照して dHash で照合
   - 6匹を自動確定 → 6匹から「今出てる相手」をクリックでコピー

   NOTE:
   - この手法は “同じ系統の小アイコン” に強い（SVの選出UIとShowdownのアイコンが近い前提）。
   - 完全一致が難しい環境では、信頼度が低い枠は「?」にします（誤認識よりマシ）。
*/
(function(){
  const $ = (id)=>document.getElementById(id);

  // UI
  const elFile = $('teamFile');
  const btnPaste = $('btnPasteTeam');
  const imgPrev = $('teamPreview');
  const slotWrap = $('teamSlots');
  const dxEl = $('roiDx');
  const dyEl = $('roiDy');
  const scEl = $('roiScale');
  const btnRun = $('btnTeamRun');
  const btnCopy6 = $('btnCopy6');
  const btnClear = $('btnTeamClear');
  const outBox = $('teamOut');

  const activePick = $('activePick');
  const activeNameEl = $('activeName');
  const btnCopyActive = $('btnCopyActive');
  const btnResetTeam = $('btnResetTeam');
  let activeName = '';

  // Data
  const ICON_W = 40, ICON_H = 30;
  const SHEET_URL = 'https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png';

  let baseImage = null;
  let extracted = []; // {canvas, hashHi, hashLo, bestNum, bestDist, jaName}
  let numToJa = null;
  let maxNational = 1025;

  // reference hashes
  let sheetImg = null;
  let refHashHi = null;
  let refHashLo = null;
  let refReady = false;
  let buildingRef = false;

  function setStatus(msg){
    if (outBox) outBox.textContent = msg || '';
  }

  // ---- Hash helpers ----
  function popcnt32(v){
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
  }
  function hamming64(hi1, lo1, hi2, lo2){
    return popcnt32((hi1 ^ hi2) >>> 0) + popcnt32((lo1 ^ lo2) >>> 0);
  }

  // dHash 8x8 from 9x8 grayscale
  function dHash64FromCanvas(srcCanvas){
    const w = 9, h = 8;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', {willReadFrequently:true});
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(srcCanvas, 0, 0, w, h);
    const imgd = ctx.getImageData(0,0,w,h).data;

    let hi = 0, lo = 0;
    let bit = 0;
    for (let y=0; y<h; y++){
      for (let x=0; x<8; x++){
        const i1 = (y*w + x) * 4;
        const i2 = (y*w + x + 1) * 4;
        const g1 = (imgd[i1] * 0.299 + imgd[i1+1] * 0.587 + imgd[i1+2] * 0.114);
        const g2 = (imgd[i2] * 0.299 + imgd[i2+1] * 0.587 + imgd[i2+2] * 0.114);
        const b = (g1 < g2) ? 1 : 0;
        if (bit < 32){
          hi = (hi << 1) | b;
        } else {
          lo = (lo << 1) | b;
        }
        bit++;
      }
    }
    // ensure unsigned 32-bit
    hi >>>= 0; lo >>>= 0;
    return {hi, lo};
  }

  // ---- Load mapping (JP names) ----
  async function loadNumToJa(){
    if (numToJa) return numToJa;
    const res = await fetch('../dex/jp/POKEMON_ALL.json', {cache:'force-cache'});
    const arr = await res.json();
    const map = {};
    let mx = 0;
    for (const r of arr){
      const n = Number(r.national_pokedex_number || 0);
      if (!n) continue;
      if (n > mx) mx = n;
      // base species name: prefer species_name_ja + no form name
      const isBase = (r.pokeapi_form_name_ja == null && r.pokeapi_form_name == null);
      if (isBase && !map[n]) map[n] = r.pokeapi_species_name_ja || r.yakkuncom_name || r.pkmn_base_species;
    }
    numToJa = map;
    maxNational = mx || 1025;
    return numToJa;
  }

  // ---- Load and build reference hashes from Showdown icon sheet ----
  async function ensureRef(){
    if (refReady) return true;
    if (buildingRef) return false;
    buildingRef = true;
    setStatus('参照アイコン読込中…（初回だけ少し待ちます）');

    await loadNumToJa();

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = SHEET_URL;
    await img.decode().catch(()=>{});
    // Wait for load
    await new Promise((resolve, reject)=>{
      if (img.complete && img.naturalWidth) return resolve();
      img.onload = ()=>resolve();
      img.onerror = ()=>reject(new Error('sheet load failed'));
    });

    sheetImg = img;
    const sheetW = img.naturalWidth, sheetH = img.naturalHeight;
    const cols = Math.floor(sheetW / ICON_W);
    const rows = Math.floor(sheetH / ICON_H);

    // fallback: expected 12 cols
    const COLS = (cols >= 12) ? cols : 12;

    // allocate arrays up to maxNational
    refHashHi = new Uint32Array(maxNational + 1);
    refHashLo = new Uint32Array(maxNational + 1);

    const tileC = document.createElement('canvas');
    tileC.width = ICON_W; tileC.height = ICON_H;
    const tctx = tileC.getContext('2d', {willReadFrequently:true});
    tctx.imageSmoothingEnabled = false;

    // icon index: dex num N is at index N (MissingNo=0), 12 icons per row in Showdown
    // See notes: "12 sprites per row, 0 based index thanks to missingno #0" 
    const perRow = 12;

    for (let n=1; n<=maxNational; n++){
      const idx = n; // MissingNo at 0
      const col = idx % perRow;
      const row = Math.floor(idx / perRow);
      const sx = col * ICON_W;
      const sy = row * ICON_H;
      if (sx + ICON_W > sheetW || sy + ICON_H > sheetH) continue;
      tctx.clearRect(0,0,ICON_W,ICON_H);
      tctx.drawImage(img, sx, sy, ICON_W, ICON_H, 0,0,ICON_W,ICON_H);
      const h = dHash64FromCanvas(tileC);
      refHashHi[n] = h.hi;
      refHashLo[n] = h.lo;
    }

    refReady = true;
    buildingRef = false;
    setStatus('参照アイコン準備OK。画像を貼り付けて「自動判定」してください。');
    return true;
  }

  // ---- Extract 6 icons from right panel crop ----
  function extractSixIconsFromRightPanel(img){
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;

    // If this looks like a full-screen capture, automatically focus on the right-side panel.
    // (右側だけの切り抜きが一番確実。全画面でも一応この自動クロップで拾います)
    let srcX = 0, srcY = 0, srcW = W, srcH = H;
    if (W / H > 1.25) {
      srcX = Math.floor(W * 0.55);
      srcW = W - srcX;
    }

    // scaling knobs (percent)
    const dx = parseFloat(dxEl?.value || '0') / 100;
    const dy = parseFloat(dyEl?.value || '0') / 100;
    const sc = 1 + (parseFloat(scEl?.value || '0') / 100);

    // draw into base canvas (cropped)
    const base = document.createElement('canvas');
    base.width = srcW; base.height = srcH;
    const bctx = base.getContext('2d', {willReadFrequently:true});
    bctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

    const Wc = srcW, Hc = srcH;

    const slots = [];
    const bandH = Hc / 6;

    for (let i=0; i<6; i++){
      const y0 = Math.floor(i * bandH);
      const y1 = Math.floor((i+1) * bandH);
      // search area: left 45% of the image (avoid Lv50 and gender)
      const x0 = 0;
      const x1 = Math.floor(Wc * 0.45);

      // find non-white bounding box
      const id = bctx.getImageData(x0, y0, x1-x0, y1-y0).data;
      let minX=1e9, minY=1e9, maxX=-1, maxY=-1;
      const sw = x1-x0;
      const sh = y1-y0;

      for (let yy=0; yy<sh; yy++){
        for (let xx=0; xx<sw; xx++){
          const p = (yy*sw + xx)*4;
          const r = id[p], g = id[p+1], b = id[p+2], a = id[p+3];
          if (a < 10) continue;
          // treat near-white as background
          if (r > 240 && g > 240 && b > 240) continue;
          // ignore very light gray UI separators
          if (r > 225 && g > 225 && b > 225) continue;
          if (xx < minX) minX = xx;
          if (yy < minY) minY = yy;
          if (xx > maxX) maxX = xx;
          if (yy > maxY) maxY = yy;
        }
      }

      if (maxX < 0){
        // nothing found
        slots.push({canvas:null, bbox:null});
        continue;
      }

      // expand a bit
      const pad = 2;
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(sw-1, maxX + pad);
      maxY = Math.min(sh-1, maxY + pad);

      // apply knobs
      const bw = (maxX - minX + 1);
      const bh = (maxY - minY + 1);
      const cx = x0 + minX + Math.floor(bw*dx);
      const cy = y0 + minY + Math.floor(bh*dy);
      const cw = Math.floor(bw*sc);
      const ch = Math.floor(bh*sc);

      const crop = document.createElement('canvas');
      crop.width = ICON_W; crop.height = ICON_H;
      const cctx = crop.getContext('2d', {willReadFrequently:true});
      cctx.imageSmoothingEnabled = true;
      cctx.clearRect(0,0,ICON_W,ICON_H);
      cctx.drawImage(base, cx, cy, cw, ch, 0, 0, ICON_W, ICON_H);
      slots.push({canvas:crop, bbox:{x:cx,y:cy,w:cw,h:ch}});
    }

    return slots;
  }

  function renderSlots(){
    slotWrap.innerHTML = '';
    extracted.forEach((s, idx)=>{
      const div = document.createElement('div');
      div.className = 'team-slot';
      const cnv = s.canvas;
      const name = s.jaName || '?';
      const dist = (s.bestDist != null) ? `d=${s.bestDist}` : '';
      div.innerHTML = `
        <div class="thumb"></div>
        <div class="meta">
          <div class="name"><b>${idx+1}.</b> ${escapeHtml(name)} <span class="muted" style="font-size:12px">${dist}</span></div>
          <div class="actions"></div>
        </div>`;
      const thumb = div.querySelector('.thumb');
      if (cnv){
        thumb.appendChild(cnv);
      }
      const actions = div.querySelector('.actions');
      div.style.cursor = 'pointer';
      div.onclick = ()=> setActive(name);
      const btn = document.createElement('button');
      btn.className='btn';
      btn.type='button';
      btn.textContent='このポケモンをコピー';
      btn.onclick=()=>copyText(name);
      actions.appendChild(btn);

      slotWrap.appendChild(div);
    });
  }

  function escapeHtml(s){
    return (s||'').replace(/[&<>"']/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  async function runAuto(){
    if (!baseImage){
      setStatus('画像を貼り付けてください。');
      return;
    }
    try{
      await ensureRef();
    }catch(e){
      console.error(e);
      setStatus('参照アイコン（Showdown）を読み込めませんでした。ネットワークまたはCORSの可能性があります。');
      return;
    }

    setStatus('6枠を切り出し→照合中…');

    const slots = extractSixIconsFromRightPanel(baseImage);
    const map = await loadNumToJa();

    extracted = slots.map((s)=>{
      if (!s.canvas) return {canvas:null, bestNum:null, bestDist:null, jaName:'?'};

      const h = dHash64FromCanvas(s.canvas);
      let bestN = null;
      let bestD = 1e9;

      // brute force over dex numbers
      for (let n=1; n<=maxNational; n++){
        const hi = refHashHi[n];
        const lo = refHashLo[n];
        if (!hi && !lo) continue;
        const d = hamming64(h.hi, h.lo, hi, lo);
        if (d < bestD){
          bestD = d; bestN = n;
          if (bestD === 0) break;
        }
      }

      // confidence threshold: if too far, mark unknown
      let ja = (bestN && map[bestN]) ? map[bestN] : '?';
      if (bestD > 22) ja = '?';

      return {
        canvas: s.canvas,
        hashHi: h.hi, hashLo: h.lo,
        bestNum: bestN,
        bestDist: bestD,
        jaName: ja
      };
    });

    renderSlots();

    // set default active to the first non-? slot
    const first = extracted.find(s=>s.jaName && s.jaName !== '?');
    setActive(first ? first.jaName : '');


    const names = extracted.map(s=>s.jaName || '?');
    const okCount = names.filter(n=>n && n !== '?').length;
    setStatus(`完了: ${okCount}/6 枠を確定（? は自信なし）`);

    // store party for later use
    try{
      localStorage.setItem('picklab_capture_opp_party', JSON.stringify(names));
      localStorage.setItem('picklab_capture_opp_party_ts', String(Date.now()));
    }catch(e){}
  }

  function setActive(name){
    activeName = name || '';
    if (activeNameEl) activeNameEl.textContent = activeName || '—';
    if (activePick) activePick.style.display = activeName ? 'block' : 'none';
  }

  function copyText(t){
    navigator.clipboard?.writeText(t).then(()=>{
      setStatus(`コピーしました: ${t}`);
    }).catch(()=>{
      // fallback
      const ta = document.createElement('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      try{ document.execCommand('copy'); setStatus(`コピーしました: ${t}`); }
      catch(e){ setStatus('コピーに失敗しました'); }
      ta.remove();
    });
  }

  function copy6(){
    const names = extracted.map(s=>s.jaName || '?').join('\n');
    copyText(names);
  }

  function clearAll(){
    baseImage = null;
    extracted = [];
    imgPrev.src = '';
    slotWrap.innerHTML = '';
    setStatus('');
    if (elFile) elFile.value = '';
  }

  async function handleImageBlob(blob){
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding='async';
    img.src=url;
    await img.decode().catch(()=>{});
    baseImage = img;
    imgPrev.src = url;
    try{ imgPrev.style.display = "block"; }catch(e){}
    setStatus('画像を読み込みました。「自動判定」を押してください。');
  }

  async function pasteFromClipboard(){
    try{
      const items = await navigator.clipboard.read();
      for (const it of items){
        const types = it.types || [];
        const t = types.find(x=>x.startsWith('image/'));
        if (!t) continue;
        const blob = await it.getType(t);
        await handleImageBlob(blob);
        return;
      }
      setStatus('クリップボードに画像がありません。');
    }catch(e){
      console.error(e);
      setStatus('貼り付けに失敗しました（権限/ブラウザ制限の可能性）。');
    }
  }

  function hook(){
    if (elFile){
      elFile.addEventListener('change', async (e)=>{
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        await handleImageBlob(f);
      });
    }
    if (btnPaste) btnPaste.addEventListener('click', pasteFromClipboard);
    if (btnRun) btnRun.addEventListener('click', runAuto);
    if (btnCopy6) btnCopy6.addEventListener('click', copy6);
    if (btnClear) btnClear.addEventListener('click', clearAll);
    if (btnCopyActive) btnCopyActive.addEventListener('click', ()=>{ if (activeName) copyText(activeName); });
    if (btnResetTeam) btnResetTeam.addEventListener('click', clearAll);

    // warmup ref in background after first interaction
    document.addEventListener('pointerdown', ()=>{
      ensureRef();
    }, {once:true});
  }

  hook();
})();
