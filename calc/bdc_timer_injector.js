/*! BDC Timer Injector v3 (ES5, 「ステータス」タブの右に挿入) */
(function(){
  // === 検索対象のセレクタ（タブ候補）===
  var CAND = 'button, a, [role="tab"], .funcTab, .tab, .nav-item';
  var LABEL = 'ステータス'; // ← この文字を含む要素の右に置く

  // === タイマー状態 ===
  var tInt=null, initMs=20*60*1000, remainMs=initMs, running=false, lastTs=0;

  // util
  function byId(id){ return document.getElementById(id); }
  function pad2(n){ return (n<10?'0':'')+n; }

  // 表示
  function render(){
    var d=byId('bdcTimerDisplay'); if(!d) return;
    var ms=remainMs; if(ms<0) ms=0;
    var s=Math.floor(ms/1000), m=Math.floor(s/60); s%=60;
    d.textContent=pad2(m)+':'+pad2(s);
  }

  // 入力
  function onMinutes(){
    var el=byId('bdcTimerMinutes'); if(!el) return;
    var m=parseInt(el.value,10); if(!(m>0)){m=20; el.value='20';}
    initMs=m*60*1000; if(!running){ remainMs=initMs; render(); }
  }

  // tick/操作
  function tick(){ if(!running) return;
    var now=Date.now(), dt=now-(lastTs||now); lastTs=now;
    remainMs-=dt; if(remainMs<=0){ remainMs=0; running=false; if(tInt){clearInterval(tInt); tInt=null;} }
    render();
  }
  function start(){ if(running) return; if(remainMs<=0) remainMs=initMs;
    running=true; lastTs=Date.now(); if(tInt){clearInterval(tInt);} tInt=setInterval(tick,250); }
  function stop(){ running=false; if(tInt){clearInterval(tInt); tInt=null;} }
  function reset(){ stop(); remainMs=initMs; render(); }

  // スタイル（最小限・インライン配置）
  function injectStyles(){
    if(byId('bdcTimerStyles')) return;
    var css=''
      +'.bdcTimerInline{display:inline-flex;gap:8px;align-items:center;margin-left:10px;vertical-align:middle}'
      +'.bdcTimerLabel{opacity:.8;font-size:12px}'
      +'#bdcTimerMinutes{width:64px}'
      +'#bdcTimerDisplay{min-width:64px;display:inline-block;text-align:center}'
      +'.bdcTimerBtn{padding:3px 8px;border:1px solid #334;background:transparent;color:inherit;border-radius:8px;cursor:pointer}';
    var st=document.createElement('style'); st.id='bdcTimerStyles';
    st.appendChild(document.createTextNode(css));
    (document.head||document.documentElement).appendChild(st);
  }

  // UI生成
  function buildUI(){
    var w=document.createElement('span'); w.className='bdcTimerInline'; w.setAttribute('role','group'); w.setAttribute('aria-label','タイマー');
    var label=document.createElement('span'); label.className='bdcTimerLabel'; label.appendChild(document.createTextNode('タイマー'));
    var minutes=document.createElement('input'); minutes.id='bdcTimerMinutes'; minutes.type='number'; minutes.min='1'; minutes.max='600'; minutes.value='20'; minutes.setAttribute('aria-label','分');
    var unit=document.createTextNode('分');
    var disp=document.createElement('span'); disp.id='bdcTimerDisplay'; disp.className='mono'; disp.appendChild(document.createTextNode('20:00'));
    var bS=document.createElement('button'); bS.id='bdcTimerStart'; bS.className='bdcTimerBtn'; bS.appendChild(document.createTextNode('スタート'));
    var bP=document.createElement('button'); bP.id='bdcTimerStop';  bP.className='bdcTimerBtn'; bP.appendChild(document.createTextNode('ストップ'));
    var bR=document.createElement('button'); bR.id='bdcTimerReset'; bR.className='bdcTimerBtn'; bR.appendChild(document.createTextNode('初期化'));

    w.appendChild(label); w.appendChild(minutes); w.appendChild(unit); w.appendChild(disp); w.appendChild(bS); w.appendChild(bP); w.appendChild(bR);

    minutes.addEventListener('change', onMinutes);
    minutes.addEventListener('input',  onMinutes);
    bS.addEventListener('click', start);
    bP.addEventListener('click', stop);
    bR.addEventListener('click', reset);

    return w;
  }

  // 「ステータス」要素の“直後”に差し込む
  function injectNearStatus(){
    if(byId('bdcTimerDisplay')) return true; // 既にあり
    var nodes=document.querySelectorAll(CAND), i, el, text, p;
    for(i=0;i<nodes.length;i++){
      el = nodes[i];
      text = (el.textContent||'').replace(/\s+/g,'');
      if(text.indexOf(LABEL)>=0){
        injectStyles();
        var ui = buildUI();
        // 直後に置く（同じ行に並ぶ前提・inline-flex）
        p = el.parentNode;
        if(p){ p.insertBefore(ui, el.nextSibling); render(); return true; }
      }
    }
    return false;
  }

  // リトライ（最大10秒）
  function waitAndInject(){
    var tries=0, max=40, iv=setInterval(function(){
      if(injectNearStatus()){ clearInterval(iv); }
      else { tries++; if(tries>=max) clearInterval(iv); }
    }, 250);
  }

  // 起動
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', waitAndInject); }
  else { waitAndInject(); }
})();
