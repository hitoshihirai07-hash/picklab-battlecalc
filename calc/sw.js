const VERSION = 'bdc-sw-v2';

function scopeUrl(p){
  // p: '' => scope root, or 'offline.html' etc
  const base = self.registration && self.registration.scope ? self.registration.scope : self.location.origin + '/';
  return new URL(p || '.', base).toString();
}

self.addEventListener('install', (e) => {
  const core = [
    scopeUrl(''),                // /calc/
    scopeUrl('offline.html'),
    scopeUrl('opengraph.png'),
    scopeUrl('icons/icon-192.png'),
    scopeUrl('icons/icon-512.png'),
    scopeUrl('icons/favicon-32.png'),
    scopeUrl('icons/favicon-16.png'),
    scopeUrl('icons/apple-touch-icon.png'),
  ];
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(core)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== VERSION ? caches.delete(k) : null)))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() =>
      caches.match(e.request).then(r => r || caches.match(scopeUrl('offline.html')))
    )
  );
});
