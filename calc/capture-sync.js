// Pick Lab: Capture -> Calc sync
// Reads localStorage values saved by /capture and fills ONLY empty fields.

(function(){
  const KEY_ACTIVE = 'PICKLAB_CAPTURE_OPP_ACTIVE_V1';
  const KEY_PARTY  = 'PICKLAB_CAPTURE_OPP_PARTY_V1';

  const $ = (sel) => document.querySelector(sel);
  const fireInput = (el) => {
    try{ el.dispatchEvent(new Event('input', {bubbles:true})); }catch(_){ }
    try{ el.dispatchEvent(new Event('change', {bubbles:true})); }catch(_){ }
  };

  function readJson(key, fallback){
    try{
      const v = localStorage.getItem(key);
      if(!v) return fallback;
      return JSON.parse(v);
    }catch(_){ return fallback; }
  }

  function apply(){
    const active = (localStorage.getItem(KEY_ACTIVE)||'').trim();
    const party = readJson(KEY_PARTY, []);

    // 1v1 defense side
    const def = $('#defName');
    if(def && !def.value && active){
      def.value = active;
      fireInput(def);
    }

    // 6v6 defense team slots (tD_name_1..6)
    if(Array.isArray(party) && party.length){
      for(let i=1;i<=6;i++){
        const inp = document.getElementById(`tD_name_${i}`);
        if(!inp) continue;
        if(inp.value) continue;
        const nm = party[i-1] || '';
        if(nm){
          inp.value = nm;
          fireInput(inp);
        }
      }
    }
  }

  // Apply on load (after app.js builds the grids)
  window.addEventListener('load', ()=>{
    // allow a moment for DOM to render
    setTimeout(apply, 250);
    setTimeout(apply, 900);
  });

  // Cross-tab updates
  window.addEventListener('storage', (e)=>{
    if(e.key === KEY_ACTIVE || e.key === KEY_PARTY) apply();
  });

  // Same-tab updates
  setInterval(apply, 1500);
})();
