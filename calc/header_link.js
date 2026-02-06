/*! bdc header link injector: adds a "ステータス" tab linking to stats.html */
(function(){
  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function(){
    // already present?
    if (document.querySelector('a[href$="stats.html"]')) return;
    // find the tab nav
    var nav = document.querySelector('nav.tabs') || document.querySelector('.tabs') || document.querySelector('header nav');
    if (!nav) return;
    // pick a tab-like element to copy class
    var sample = nav.querySelector('.tab') || nav.querySelector('a') || nav.firstElementChild;
    var a = document.createElement('a');
    a.href = './stats.html';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'ステータス';
    // copy classes to match existing style
    if (sample && sample.className){
      a.className = sample.className + ((' '+sample.className).includes(' tab') ? '' : ' tab');
    } else {
      a.className = 'tab';
    }
    // avoid duplicate insertions by this script
    a.setAttribute('data-bdc-link','stats');
    nav.appendChild(a);
  });
})();