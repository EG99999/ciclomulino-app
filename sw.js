// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Service worker: prima la rete (così gli aggiornamenti arrivano subito), se manca internet usa la copia salvata.
// Sicurezza: gestisce SOLO i file di questo sito, senza parametri nell'indirizzo. Mai Microsoft/Graph, mai codici di accesso.
const CACHE = 'open-trainer-v12';
const SHELL = ['./', 'index.html', 'css/fonts.css', 'css/game.css', 'css/screens.css', 'fonts/pressstart2p-latin.woff2', 'fonts/pressstart2p-latin-ext.woff2', 'fonts/vt323-latin.woff2', 'fonts/vt323-latin-ext.woff2', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/main.js', 'js/plan.js', 'js/session.js', 'js/erg.js', 'js/physics.js', 'js/ble.js', 'js/sim.js', 'js/fit.js', 'js/coach.js', 'js/audio.js', 'js/scene.js', 'js/route.js', 'js/onedrive.js', 'js/onboarding.js', 'js/settings.js', 'js/config.js', 'js/screens.js', 'js/vendor/three.min.js', 'js/world3d.js', 'js/models3d.js', 'js/path3d.js', 'js/layout3d.js', 'js/logo.js', 'js/creator.js', 'js/folder.js', 'js/ftptest.js', 'js/history.js', 'js/computer.js', 'js/sync.js', 'js/debug.js', 'js/framebust.js', 'routes/index.json'];
// 'reload': i file si scaricano sempre dalla rete, mai dalla cache HTTP (GitHub Pages la tiene 10 minuti: si rischierebbe un misto di file vecchi e nuovi)
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin || u.search) return;   // il resto passa senza che il service worker lo veda
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })
    .catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
