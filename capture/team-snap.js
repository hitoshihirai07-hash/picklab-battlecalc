/* Pick Lab Capture - Opponent 6 icons snap (v1)
   Flow:
     - Paste/choose screenshot of team select screen
     - Crop fixed 6 ROIs (right side)
     - For each slot: compute dHash -> show top candidates -> user confirms
     - After confirm 6: choose currently shown opponent from the 6

   Notes:
     - Uses local dex: ../dex/jp/POKEMON_ALL.json
     - Builds (once) icon hash DB by fetching PokeAPI sprite icons and caching to localStorage.
*/
(function(){
  const $ = (id)=>document.getElementById(id);

  const elFile = $('teamFile');
  const btnPaste = $('btnPasteTeam');
  const imgPrev = $('teamPreview');
  const slotWrap = $('teamSlots');
  const dbBtn = $('btnBuildIconDb');
  const dbStatus = $('iconDbStatus');
  const dbProg = $('iconDbProgress');
  const candK = $('candK');
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

  if(!elFile || !btnPaste || !imgPrev || !slotWrap || !dbBtn) return; // page not updated

  // ----- LocalStorage keys -----
  const LS_DB = 'picklab_icon_hash_db_v1';
  const LS_TEAM = 'picklab_opp_team_v1';
  const LS_ACTIVE = 'picklab_opp_active_v1';

  // ----- Fixed ROIs (ratio) for 6 icons (based on user's screenshot) -----
  // Each: {x1,y1,x2,y2} as ratios of image width/height.
  // NOTE: Use dx/dy/scale knobs for small adjustments.
  const ROI_RATIOS = [
    {x1:0.634076, y1:0.218534, x2:0.694464, y2:0.334716},
    {x1:0.633357, y1:0.334716, x2:0.693746, y2:0.450899},
    {x1:0.642703, y1:0.442600, x2:0.703091, y2:0.558783},
    {x1:0.635514, y1:0.540802, x2:0.695902, y2:0.656985},
    {x1:0.633357, y1:0.644537, x2:0.693746, y2:0.760719},
    {x1:0.639827, y1:0.762102, x2:0.700216, y2:0.878285},
  ];

  // ----- internal state -----
  let dex = null;               // [{id, name, form, idName}]
  let db = null;                // Map<number, bigint>
  let screenshotImg = null;     // HTMLImageElement
  let slots = [];               // [{hash, candidates, chosenId, chosenName}]

  // ----- helpers -----
  function setDbStatus(t){ if(dbStatus) dbStatus.textContent = t || ''; }
  function setDbProg(t){ if(dbProg) dbProg.textContent = t || ''; }

  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

  function safeJsonParse(s){ try{return JSON.parse(s);}catch(_){return null;} }

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

  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

  function iconUrl(id){
    // Prefer gen8 icons (closest to in-game party icons)
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-viii/icons/${id}.png`;
  }
  function fallbackIconUrl(id){
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
  }

  async function loadDex(){
    if(dex) return dex;
    const r = await fetch('../dex/jp/POKEMON_ALL.json', {cache:'no-store'});
    if(!r.ok) throw new Error('POKEMON_ALL.json が読めません');
    const arr = await r.json();

    const byId = new Map();
    for(const e of (arr||[])){
      const id = Number(e && e.pokeapi_pokemon_id);
      if(!id || !Number.isFinite(id)) continue;

      const base = (e.yakkuncom_name || e.pokeapi_species_name_ja || '').trim();
      if(!base) continue;

      const form = (e.yakkuncom_form_name || e.pokeapi_form_name_ja || '').trim();
      const name = form && form !== base ? `${base}(${form})` : base;
      const idName = (e.pokeapi_pokemon_id_name || e.pkmn_id_name || e.pokeapi_form_id_name || '').trim();

      if(!byId.has(id)) byId.set(id, {id, name, idName});
    }

    dex = Array.from(byId.values()).sort((a,b)=>a.id-b.id);
    return dex;
  }

  function bigintToHex64(x){
    let h = x.toString(16);
    return h.padStart(16,'0');
  }
  function hex64ToBigint(h){
    try{ return BigInt('0x'+String(h)); }catch(_){ return null; }
  }

  function dhashFromImageData(imgData){
    // dHash: resize to 9x8 grayscale, compare adjacent pixels
    const W = 9, H = 8;
    const src = imgData;
    const sw = src.width, sh = src.height;
    const sdata = src.data;

    // sample grayscale grid
    const grid = new Array(W*H);
    for(let y=0;y<H;y++){
      const sy = Math.floor((y + 0.5) * sh / H);
      for(let x=0;x<W;x++){
        const sx = Math.floor((x + 0.5) * sw / W);
        const i = (sy*sw + sx)*4;
        const r = sdata[i], g = sdata[i+1], b = sdata[i+2];
        // perceptual luma
        grid[y*W + x] = (r*299 + g*587 + b*114) / 1000;
      }
    }

    let bits = 0n;
    let bitPos = 0n;
    for(let y=0;y<H;y++){
      for(let x=0;x<W-1;x++){
        const a = grid[y*W + x];
        const b = grid[y*W + x + 1];
        if(a > b) bits |= (1n << bitPos);
        bitPos++;
      }
    }
    return bits; // 64 bits
  }

  function popcountBigint(x){
    // Kernighan
    let c = 0;
    while(x){ x &= (x - 1n); c++; }
    return c;
  }

  function hamming(a,b){
    return popcountBigint(a ^ b);
  }

  async function fetchImageToImageData(url){
    // fetch as blob -> ImageBitmap -> canvas -> ImageData
    const res = await fetch(url, {mode:'cors', cache:'force-cache'});
    if(!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0,0,c.width,c.height);
  }

  function loadDbFromLS(){
    const raw = safeJsonParse(localStorage.getItem(LS_DB) || '');
    if(!raw || !raw.items) return null;
    const m = new Map();
    for(const [k,v] of Object.entries(raw.items)){
      const id = Number(k);
      const bi = hex64ToBigint(v);
      if(!id || bi===null) continue;
      m.set(id, bi);
    }
    return {map:m, meta:raw.meta||{}};
  }

  function saveDbToLS(map, meta){
    const items = {};
    for(const [id,bi] of map.entries()){
      items[id] = bigintToHex64(bi);
    }
    localStorage.setItem(LS_DB, JSON.stringify({meta: meta||{}, items}));
  }

  async function ensureDbLoaded(){
    if(db) return db;
    const loaded = loadDbFromLS();
    if(loaded && loaded.map && loaded.map.size >= 800){
      db = loaded.map;
      setDbStatus(`アイコンDB: あり（${db.size}件）`);
      return db;
    }
    setDbStatus('アイコンDB: まだ（作成が必要）');
    return null;
  }

  async function buildDb(){
    const dexList = await loadDex();
    const uniqIds = dexList.map(x=>x.id);

    const existing = loadDbFromLS();
    const map = existing?.map || new Map();

    setDbStatus(`作成中…（${map.size}/${uniqIds.length}）`);

    const started = Date.now();
    let done = 0;

    // Sequential build: stable and browser-friendly
    for(const id of uniqIds){
      if(map.has(id)){
        done++;
        if(done % 50 === 0){
          setDbProg(`${done}/${uniqIds.length}`);
          await sleep(0);
        }
        continue;
      }
      let imgData = null;
      try{
        imgData = await fetchImageToImageData(iconUrl(id));
      }catch(_){
        try{
          imgData = await fetchImageToImageData(fallbackIconUrl(id));
        }catch(__){
          // skip
          done++;
          if(done % 50 === 0){
            setDbProg(`${done}/${uniqIds.length}`);
            await sleep(0);
          }
          continue;
        }
      }
      const h = dhashFromImageData(imgData);
      map.set(id, h);
      done++;

      if(done % 20 === 0){
        setDbProg(`${done}/${uniqIds.length}`);
        // Save periodically so it's not lost
        saveDbToLS(map, {v:1, updatedAt: new Date().toISOString()});
        await sleep(0);
      }
    }

    saveDbToLS(map, {v:1, updatedAt: new Date().toISOString(), ms: Date.now()-started});
    db = map;
    setDbStatus(`完了（${db.size}件）`);
    setDbProg('');
    return db;
  }

  function getDexEntryById(id){
    if(!dex) return null;
    // dex is sorted by id; small linear scan is fine, but make map lazily
    if(!getDexEntryById._m){
      const m = new Map();
      for(const e of dex){ m.set(e.id, e); }
      getDexEntryById._m = m;
    }
    return getDexEntryById._m.get(id) || null;
  }

  function clearUI(){
    slotWrap.innerHTML = '';
    confWrap.style.display = 'none';
    activeWrap.style.display = 'none';
    slots = [];
  }

  function cropToImageData(img, rect){
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d', {willReadFrequently:true});

    const W = img.naturalWidth, H = img.naturalHeight;
    const x1 = clamp(Math.round(rect.x1 * W), 0, W-1);
    const y1 = clamp(Math.round(rect.y1 * H), 0, H-1);
    const x2 = clamp(Math.round(rect.x2 * W), 0, W);
    const y2 = clamp(Math.round(rect.y2 * H), 0, H);
    const w = Math.max(1, x2-x1);
    const h = Math.max(1, y2-y1);

    c.width = w; c.height = h;
    ctx.drawImage(img, x1, y1, w, h, 0, 0, w, h);
    return ctx.getImageData(0,0,w,h);
  }

  function makeSlotCard(idx, cropData){
    const card = document.createElement('div');
    card.className = 'team-slot';

    const head = document.createElement('div');
    head.className = 'team-slot-head';
    head.innerHTML = `<div><strong>#${idx+1}</strong> <span class="muted" style="font-size:12px">（右側のアイコン）</span></div>`;

    const preview = document.createElement('canvas');
    preview.width = cropData.width;
    preview.height = cropData.height;
    preview.className = 'team-slot-crop';
    const pctx = preview.getContext('2d');
    pctx.putImageData(cropData, 0, 0);

    const chosen = document.createElement('div');
    chosen.className = 'team-chosen';
    chosen.textContent = '未確定';

    const candBox = document.createElement('div');
    candBox.className = 'team-cands';
    candBox.textContent = '候補を計算中…';

    card.appendChild(head);
    card.appendChild(preview);
    card.appendChild(chosen);
    card.appendChild(candBox);

    return {card, chosen, candBox};
  }

  function renderCandidates(idx, candidates, chosenEl){
    const slot = slots[idx];
    slot.candidates = candidates;

    const box = slot.ui.candBox;
    box.innerHTML = '';

    for(const cand of candidates){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'team-cand-btn';
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = cand.name;
      img.src = iconUrl(cand.id);
      img.onerror = ()=>{ img.src = fallbackIconUrl(cand.id); };
      const t = document.createElement('div');
      t.className = 'team-cand-name';
      t.textContent = cand.name;
      const d = document.createElement('div');
      d.className = 'team-cand-dist';
      d.textContent = `距離:${cand.dist}`;
      b.appendChild(img);
      b.appendChild(t);
      b.appendChild(d);

      b.addEventListener('click', ()=>{
        slot.chosenId = cand.id;
        slot.chosenName = cand.name;
        chosenEl.innerHTML = `<strong>確定:</strong> ${cand.name} <span class="muted" style="font-size:12px">(距離:${cand.dist})</span>`;
        chosenEl.classList.add('ok');
        updateConfirmed();
      });

      box.appendChild(b);
    }

    if(!candidates.length){
      box.textContent = '候補が出ませんでした（DB未作成 / スナップがズレてる可能性）';
    }
  }

  function updateConfirmed(){
    const chosen = slots.map(s=>s.chosenId).filter(Boolean);
    if(chosen.length !== 6){
      confWrap.style.display = 'none';
      activeWrap.style.display = 'none';
      return;
    }

    // Confirmed
    confWrap.style.display = '';
    confList.innerHTML = '';

    const team = [];
    const teamNames = [];
    for(const s of slots){
      team.push(s.chosenId);
      teamNames.push(s.chosenName);

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'conf-chip';

      const im = document.createElement('img');
      im.loading = 'lazy';
      im.alt = s.chosenName;
      im.src = iconUrl(s.chosenId);
      im.onerror = ()=>{ im.src = fallbackIconUrl(s.chosenId); };

      const tx = document.createElement('span');
      tx.textContent = s.chosenName;

      chip.appendChild(im);
      chip.appendChild(tx);

      chip.addEventListener('click', ()=>{
        setActive(s.chosenId, s.chosenName);
      });

      confList.appendChild(chip);
    }

    localStorage.setItem(LS_TEAM, JSON.stringify({team, names: teamNames, at: new Date().toISOString()}));

    activeWrap.style.display = '';
    if(!activeName.textContent || activeName.textContent==='—'){
      activeName.textContent = '（6匹からクリックで選択）';
    }
  }

  function setActive(id, name){
    activeName.textContent = name;
    activeName.dataset.id = String(id);
    localStorage.setItem(LS_ACTIVE, JSON.stringify({id, name, at: new Date().toISOString()}));
  }

  async function copyText(t){
    try{
      await navigator.clipboard.writeText(t);
      return true;
    }catch(_){
      // fallback
      const ta = document.createElement('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      try{ document.execCommand('copy'); }catch(__){}
      ta.remove();
      return false;
    }
  }

  async function runMatch(){
    clearUI();

    const d = await loadDex();
    const m = await ensureDbLoaded();
    if(!m){
      setDbStatus('アイコンDBがありません。先に「アイコンDB作成」を押してください。');
      return;
    }

    if(!screenshotImg) return;

    const K = parseInt(candK?.value || '6', 10) || 6;

    // Prepare slots with crops
    for(let i=0;i<6;i++){
      const r0 = applyRoi(ROI_RATIOS[i]);
      const crop = cropToImageData(screenshotImg, r0);
      const h = dhashFromImageData(crop);

      const ui = makeSlotCard(i, crop);
      slotWrap.appendChild(ui.card);

      slots.push({hash:h, candidates:[], chosenId:null, chosenName:'', ui});
    }

    // Compute candidates for each slot
    // For speed: build list of db entries once
    const dbArr = Array.from(m.entries()); // [id, hash]

    for(let i=0;i<slots.length;i++){
      const sh = slots[i].hash;
      const best = [];

      for(const [id, hh] of dbArr){
        const dist = hamming(sh, hh);
        // keep top K
        if(best.length < K){
          best.push({id, dist});
          best.sort((a,b)=>a.dist-b.dist);
        }else if(dist < best[best.length-1].dist){
          best[best.length-1] = {id, dist};
          best.sort((a,b)=>a.dist-b.dist);
        }
      }

      const candidates = best.map(b=>{
        const e = getDexEntryById(b.id);
        return {id:b.id, dist:b.dist, name: e ? e.name : `#${b.id}`};
      });

      renderCandidates(i, candidates, slots[i].ui.chosen);
      await sleep(0);
    }

    setDbStatus(`アイコンDB: ${m.size}件 / 候補:${K}`);
  }

  async function loadScreenshotFromFile(file){
    if(!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{
      screenshotImg = img;
      imgPrev.src = url;
      imgPrev.style.display = '';
      runMatch();
    };
    img.onerror = ()=>{
      URL.revokeObjectURL(url);
      alert('画像の読み込みに失敗しました');
    };
    img.src = url;
  }

  async function loadScreenshotFromClipboard(){
    // Needs HTTPS + permission
    try{
      const items = await navigator.clipboard.read();
      for(const item of items){
        for(const type of item.types){
          if(type.startsWith('image/')){
            const blob = await item.getType(type);
            const file = new File([blob], 'clipboard.png', {type});
            return loadScreenshotFromFile(file);
          }
        }
      }
      alert('クリップボードに画像がありません');
    }catch(e){
      alert('クリップボードの読み取りに失敗しました（権限/ブラウザ設定を確認してください）');
    }
  }

  function wire(){
    // Restore status
    ensureDbLoaded();

    elFile.addEventListener('change', (ev)=>{
      const f = ev.target.files && ev.target.files[0];
      loadScreenshotFromFile(f);
    });

    btnPaste.addEventListener('click', ()=>{
      loadScreenshotFromClipboard();
    });

    dbBtn.addEventListener('click', async ()=>{
      dbBtn.disabled = true;
      try{
        setDbProg('');
        await buildDb();
        // rerun if image already loaded
        if(screenshotImg) runMatch();
      }catch(e){
        console.error(e);
        alert('アイコンDB作成に失敗しました。ネットワーク制限/CORSの可能性があります。');
      }finally{
        dbBtn.disabled = false;
      }
    });

    btnCopyTeam.addEventListener('click', async ()=>{
      const names = slots.map(s=>s.chosenName).filter(Boolean);
      if(names.length !== 6) return;
      await copyText(names.join(' / '));
      btnCopyTeam.textContent = 'コピーしました';
      setTimeout(()=>btnCopyTeam.textContent='6匹をコピー', 900);
    });

    btnResetTeam.addEventListener('click', ()=>{
      clearUI();
      activeName.textContent = '—';
      localStorage.removeItem(LS_TEAM);
      localStorage.removeItem(LS_ACTIVE);
    });

    btnCopyActive.addEventListener('click', async ()=>{
      const name = activeName.textContent;
      if(!name || name==='—' || name.includes('クリック')) return;
      await copyText(name);
      btnCopyActive.textContent = 'コピーしました';
      setTimeout(()=>btnCopyActive.textContent='現在の相手をコピー', 900);
    });

    // Re-run matching when ROI knobs change
    const onKnob = ()=>{ if(screenshotImg && db) runMatch(); };
    dxEl?.addEventListener('change', onKnob);
    dyEl?.addEventListener('change', onKnob);
    scEl?.addEventListener('change', onKnob);
    candK?.addEventListener('change', onKnob);

    // Restore last team if exists
    const last = safeJsonParse(localStorage.getItem(LS_TEAM)||'');
    if(last && Array.isArray(last.team) && last.team.length===6){
      confWrap.style.display = '';
      confList.innerHTML = '';
      for(let i=0;i<6;i++){
        const id = last.team[i];
        const name = last.names && last.names[i] ? last.names[i] : `#${id}`;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'conf-chip';
        const im = document.createElement('img');
        im.alt = name;
        im.src = iconUrl(id);
        im.onerror = ()=>{ im.src = fallbackIconUrl(id); };
        const tx = document.createElement('span');
        tx.textContent = name;
        chip.appendChild(im);
        chip.appendChild(tx);
        chip.addEventListener('click', ()=>setActive(id,name));
        confList.appendChild(chip);
      }
      activeWrap.style.display='';
      const act = safeJsonParse(localStorage.getItem(LS_ACTIVE)||'');
      if(act && act.name){
        activeName.textContent = act.name;
        activeName.dataset.id = String(act.id||'');
      }else{
        activeName.textContent = '（6匹からクリックで選択）';
      }
    }
  }

  // Start
  loadDex().catch(()=>{});
  wire();
})();
