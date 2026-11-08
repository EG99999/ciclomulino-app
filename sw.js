// Service worker: prima la rete (così gli aggiornamenti arrivano subito), se manca internet usa la copia salvata.
const CACHE = 'open-trainer-v6';
const SHELL = ['./', 'index.html', 'css/game.css', 'css/screens.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/main.js', 'js/plan.js', 'js/session.js', 'js/erg.js', 'js/physics.js', 'js/ble.js', 'js/sim.js', 'js/fit.js', 'js/coach.js', 'js/audio.js', 'js/scene.js', 'js/route.js', 'js/onedrive.js', 'js/onboarding.js', 'js/settings.js', 'js/config.js', 'js/screens.js', 'js/vendor/three.min.js', 'js/world3d.js', 'js/models3d.js', 'js/path3d.js', 'js/layout3d.js', 'js/logo.js', 'js/creator.js', 'js/folder.js', 'js/ftptest.js', 'js/history.js', 'routes/index.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
