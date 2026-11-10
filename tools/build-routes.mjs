// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Genera i percorsi di partenza da Chiari (provincia di Brescia) con dati aperti:
//  - tracciato: OpenStreetMap via routing.openstreetmap.de (profilo bici)
//  - quota: modello EU-DEM 25 m via api.opentopodata.org
//  - nomi dei paesi: Nominatim
// Uso: node tools/build-routes.mjs   (serve internet; scrive routes/*.json e routes/index.json)
// Dati © OpenStreetMap contributors (ODbL), EU-DEM © Copernicus.
import { mkdir, writeFile } from 'node:fs/promises';

const UA = 'ciclomulino-app/0.1 (progetto personale)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const R = 6371000, rad = x => x * Math.PI / 180;
const hav = (a, b) => { const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

const ROUTES = [
  { id: 'chiari-brescia', name: 'Chiari → Brescia', stops: [['Chiari', 1], ['Castelcovati', 0, 0], ['Ospitaletto', 0, 0], ['Rovato', 1, 0], ['Brescia', 1]] },
  { id: 'giro-iseo', name: "Giro del lago d'Iseo da Chiari", stops: [['Chiari', 1], ['Palazzolo sull\'Oglio', 1], ['Sarnico', 1], ['Predore', 0], ['Tavernola Bergamasca', 0], ['Lovere', 1], ['Pisogne', 1], ['Marone', 0], ['Sulzano', 0], ['Iseo', 1], ['Rovato', 1], ['Chiari', 1]] },
  { id: 'franciacorta', name: 'Franciacorta da Chiari', stops: [['Chiari', 1], ['Coccaglio', 0], ['Erbusco', 1], ['Adro', 0], ['Corte Franca', 0], ['Provaglio d\'Iseo', 0], ['Monticelli Brusati', 0], ['Ome', 0], ['Rovato', 1], ['Chiari', 1]] }
];

const FIXED = { 'Brescia': [45.5398, 10.2208] };   // «Brescia» da sola trova il centro della provincia: uso il centro città
async function geocode(name) {
  if (FIXED[name]) return FIXED[name];
  // ricerca limitata alla zona (provincia di Brescia + sponda bergamasca del lago): evita omonimi in altre province
  const u = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name + ', Italia')}&format=json&limit=1&viewbox=9.6,45.95,10.5,45.4&bounded=1`;
  const r = await (await fetch(u, { headers: { 'User-Agent': UA } })).json();
  if (!r.length) throw new Error('luogo non trovato nella zona: ' + name);
  if (+r[0].lat < 45.4 || +r[0].lat > 45.95 || +r[0].lon < 9.6 || +r[0].lon > 10.5) throw new Error('luogo fuori zona: ' + name);
  await sleep(1100);
  console.log('   ', name, '→', r[0].lat, r[0].lon, '|', r[0].display_name.slice(0, 50));
  return [+r[0].lat, +r[0].lon];
}
async function route(coords) {
  const q = coords.map(c => `${c[1]},${c[0]}`).join(';');
  const j = await (await fetch(`https://routing.openstreetmap.de/routed-bike/route/v1/driving/${q}?overview=full&geometries=geojson&continue_straight=false`, { headers: { 'User-Agent': UA } })).json();
  if (j.code !== 'Ok') throw new Error('routing: ' + j.code);
  return j.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
}
function resample(pts, step) {
  const out = [pts[0]]; let acc = 0, last = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let a = last, b = pts[i], d = hav(a, b);
    while (acc + d >= step) { const t = (step - acc) / d; a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; out.push(a); d = hav(a, b); acc = 0; }
    acc += d; last = b;
  }
  return out;
}
async function elevations(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i += 100) {
    const loc = pts.slice(i, i + 100).map(p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join('|');
    let j; for (let k = 0; k < 4; k++) { try { j = await (await fetch(`https://api.opentopodata.org/v1/eudem25m?locations=${loc}`, { headers: { 'User-Agent': UA } })).json(); if (j.results) break; } catch { /* riprova */ } await sleep(2000); }
    if (!j || !j.results) throw new Error('quota non disponibile');
    out.push(...j.results.map(r => r.elevation ?? (out.length ? out[out.length - 1] : 150)));
    await sleep(1100);
  }
  return out;
}
const smooth = (a, w) => a.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - w); k <= Math.min(a.length - 1, i + w); k++) { s += a[k]; n++; } return s / n; });

await mkdir(new URL('../routes/', import.meta.url), { recursive: true });
const index = []; const cache = {};
const only = process.argv.slice(2);   // es.: node tools/build-routes.mjs giro-iseo
for (const r of ROUTES) {
  if (only.length && !only.includes(r.id)) continue;
  console.log('→', r.name, new Date().toLocaleTimeString());
  const stops = [];
  for (const [n, c, via] of r.stops) { cache[n] = cache[n] || await geocode(n); stops.push({ n, c, via, xy: cache[n] }); }
  let line = await route(stops.filter(s => s.via !== 0).map(s => s.xy));
  const pts = resample(line, 25);
  const rawEle = await elevations(pts);
  const ele = smooth(rawEle, 3);
  let dist = [0]; for (let i = 1; i < pts.length; i++) dist.push(dist[i - 1] + hav(pts[i - 1], pts[i]));
  let gain = 0; const se = smooth(ele, 4); for (let i = 1; i < se.length; i++) if (se[i] > se[i - 1]) gain += se[i] - se[i - 1];
  const places = []; const seen = new Set();
  stops.forEach(s => {
    let best = 0, bd = 1e9; pts.forEach((p, i) => { const d = hav(p, s.xy); if (d < bd) { bd = d; best = i; } });
    if (s.via === 0 && bd > 1500) return;   // etichetta troppo lontana dal tracciato: non la mostro
    if (!seen.has(s.n) || s.n === 'Chiari') { seen.add(s.n); places.push({ n: s.n, d: Math.round(dist[best]), c: s.c }); }
  });
  // il primo passaggio di ogni paese al km giusto; Chiari compare anche a fine giro
  if (stops[0].n === stops[stops.length - 1].n) { places.push({ n: stops[0].n, d: Math.round(dist[dist.length - 1]), c: 1 }); }
  const out = { id: r.id, name: r.name, len: Math.round(dist[dist.length - 1]), gain: Math.round(gain), loop: stops[0].n === stops[stops.length - 1].n, places: places.sort((a, b) => a.d - b.d),
    pts: pts.map((p, i) => [+p[0].toFixed(5), +p[1].toFixed(5), +ele[i].toFixed(1)]), src: 'OpenStreetMap contributors (ODbL); EU-DEM Copernicus' };
  await writeFile(new URL(`../routes/${r.id}.json`, import.meta.url), JSON.stringify(out));
  index.push({ id: r.id, name: r.name, len: out.len, gain: out.gain, loop: out.loop, file: `routes/${r.id}.json` });
  console.log(`   ${(out.len / 1000).toFixed(1)} km, +${out.gain} m, ${out.pts.length} punti`);
}
import { readdir, readFile } from 'node:fs/promises';
const all = [];
for (const f of (await readdir(new URL('../routes/', import.meta.url))).filter(f => f.endsWith('.json') && f !== 'index.json')) {
  const j = JSON.parse(await readFile(new URL('../routes/' + f, import.meta.url), 'utf8'));
  all.push({ id: j.id, name: j.name, len: j.len, gain: j.gain, loop: j.loop, file: 'routes/' + f });
}
all.sort((a, b) => a.len - b.len);
await writeFile(new URL('../routes/index.json', import.meta.url), JSON.stringify({ attribution: '© OpenStreetMap contributors · quote EU-DEM © Copernicus', routes: all }, null, 1));
console.log('fatto');
