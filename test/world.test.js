// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
import test from 'node:test'; import assert from 'node:assert/strict';
import * as G from '../js/scene.js';

function drive(seconds, speed, { auto = true, jumpAt = null } = {}) {
  const V = G.V; Object.assign(V, { dist: 0, lat: 0, latT: 0, jump: 0, jumpT: -1, hitT: 0, shake: 0, running: true, auto, events: [] });
  const ev = []; const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) { V.dist += speed * dt; G.updateWorld(dt); ev.push(...G.drainEvents()); }
  return ev;
}
const count = (ev, type) => ev.filter(e => e.type === type).length;

test('modalità automatica: nessuna caduta su 3 giri di strada (≈ 8 m/s e 14 m/s)', () => {
  for (const sp of [5, 8, 14]) { const ev = drive(3600 * 1.5 / sp, sp); assert.equal(count(ev, 'hit'), 0, 'colpi a ' + sp + ' m/s'); assert.ok(count(ev, 'hop') > 3, 'salti a ' + sp); }
});
test('modalità tastiera: se non fai nulla colpisci buche e lavori', () => {
  const ev = drive(400, 8, { auto: false }); assert.ok(count(ev, 'hit') >= 3, 'colpi: ' + count(ev, 'hit'));
});

/* ---- traffico: precedenza al ciclista in allenamento, tutto vale nel gioco ---- */
const wrap = d => ((d + 1800) % 3600 + 3600) % 3600 - 1800;
function driveTraffic(seconds, speed, auto, input = null) {
  const V = G.V; Object.assign(V, { dist: 0, lat: 0.5, latT: 0.5, jump: 0, jumpT: -1, hitT: 0, shake: 0, inv: 0, running: true, auto, traffic: true, hazards: true, time: 0, speed, events: [] });
  for (const x of G.crossers) x.hold = 0;
  const out = { overlaps: 0, hits: [] }, dt = 1 / 60, HW = { car: 0.3, bike: 0.12, tractor: 0.36 };
  for (let t = 0; t < seconds; t += dt) {
    V.time += dt; V.dist += speed * dt; if (input != null) V.latT = input; G.updateWorld(dt); out.hits.push(...G.drainEvents().filter(e => e.type === 'hit'));
    const R = V.lat * 0.7;
    for (const x of G.crossers) if (Math.abs(wrap(x.zc - V.dist)) < 1.6 && Math.abs(G.crosserU(x) * 1.2 - R) < 0.33) out.overlaps++;
    for (const m of G.movers) { const hw = HW[m.type]; if (!hw) continue; const rel = G.moverRel(m); if (Math.abs(rel) < 1.8 && Math.abs(G.moverLane(m, rel) - R) < hw + 0.05) out.overlaps++; }
  }
  return out;
}
test('allenamento: auto, ciclisti, trattori e auto agli incroci non toccano mai il ciclista, a nessuna velocità', () => {
  for (const sp of [3, 6, 9, 14]) { const r = driveTraffic(3600 * 1.3 / sp, sp, true); assert.equal(r.hits.length, 0, 'colpi a ' + sp + ' m/s'); assert.equal(r.overlaps, 0, 'sovrapposizioni a ' + sp + ' m/s'); }
});
test('allenamento: il ciclista sta a destra (corsia positiva) quando la strada è libera', () => {
  driveTraffic(20, 8, true); assert.ok(G.V.lat > 0.3 && G.V.lat < 0.7, 'lat ' + G.V.lat);
});
test('allenamento: l\'auto che deve attraversare lascia passare il ciclista (senza la regola ci sarebbe stato lo scontro)', () => {
  const x = G.crossers[0], speed = 8, ph0 = x.ph;
  const run = rule => {
    const V = G.V; Object.assign(V, { dist: x.zc - 90, lat: 0.5, latT: 0.5, jump: 0, jumpT: -1, inv: 0, running: true, auto: true, traffic: true, hazards: false, time: 0, speed, events: [] });
    for (const c of G.crossers) c.hold = 0; x.ph = (((3 - (90 / speed) * x.vx) % 6) + 6) % 6;        // senza regola, l'auto sarebbe a metà strada proprio quando arriva il ciclista
    let overlaps = 0; const dt = 1 / 60;
    for (let t = 0; t < 16; t += dt) { V.time += dt; V.dist += speed * dt; G.updateWorld(dt); if (!rule) for (const c of G.crossers) c.hold = 0; if (Math.abs(x.zc - V.dist) < 1.6 && Math.abs(G.crosserU(x) * 1.2 - V.lat * 0.7) < 0.33) overlaps++; }
    return overlaps;
  };
  const senza = run(false), con = run(true); x.ph = ph0;
  assert.ok(senza > 0, 'controllo: senza la regola l\'auto è sulla traiettoria'); assert.equal(con, 0, 'con la regola l\'auto aspetta o libera la strada');
});
test('gioco: andando sulla corsia opposta o contro i mezzi si viene colpiti (e c\'è un periodo senza colpi dopo ogni urto)', () => {
  const r = driveTraffic(600, 9, false, -1);
  assert.ok(r.hits.length >= 3, 'colpi: ' + r.hits.length); assert.ok(r.hits.some(h => h.what === 'car'), 'almeno un\'auto');
  const times = r.hits.length; assert.ok(times < 600 / 1.2, 'non uno per fotogramma');
});

/* ---- partenza libera: mai dentro un cantiere, una buca o davanti a un'auto ---- */
function startAt(dist, { auto = false, lat = 0, time = 0, zone = true } = {}) {
  const V = G.V; Object.assign(V, { dist, lat, latT: lat, jump: 0, jumpT: -1, hitT: 0, shake: 0, inv: 0, running: true, auto, traffic: true, hazards: true, time, speed: 8, events: [] });
  for (const h of G.hazards) h.prev = 999;
  for (const c of G.crossers) c.hold = 0;
  if (zone) { V._ld = null; V.clearAt = null; } else { V._ld = dist; V.clearAt = null; }     // senza zona libera = il comportamento di prima (controllo)
}
function runFrames(seconds, speed = 8) { const V = G.V, dt = 1 / 60, ev = []; for (let t = 0; t < seconds; t += dt) { V.time += dt; V.dist += speed * dt; G.updateWorld(dt); ev.push(...G.drainEvents()); } return ev; }

test('partenza libera: da 20 m dietro a 50 m davanti al punto di partenza non c\'è nulla, anche al giro dopo; poi la zona sparisce da sola', () => {
  startAt(1234); G.updateWorld(1 / 60);
  assert.equal(G.V.clearAt, 1234, 'la prima posizione apre la zona');
  for (const z of [1234, 1234 - 20, 1234 + 50, 1234 + 3600, 1234 - 3600 + 10]) assert.ok(G.hiddenAt(z), 'nascosto a ' + z);
  for (const z of [1234 - 21, 1234 + 51, 1234 + 1800]) assert.ok(!G.hiddenAt(z), 'visibile a ' + z);
  runFrames(3, 8); assert.equal(G.V.clearAt, 1234, 'ancora dentro la zona (24 m dopo)');
  runFrames(6, 8); assert.equal(G.V.clearAt, null, 'il ciclista l\'ha lasciata: tutto torna normale');
  assert.ok(!G.hiddenAt(1234 + 10));
});
test('partenza libera: un salto di posizione (ripartenza, nuovo percorso) apre una zona nuova, la pedalata normale no', () => {
  startAt(500); G.updateWorld(1 / 60); const first = G.V.clearAt;
  runFrames(2, 14); assert.equal(G.V.clearAt, first, 'andando avanti la zona resta quella');
  G.V.dist = 2000; G.updateWorld(1 / 60); assert.equal(G.V.clearAt, 2000, 'salto: nuova zona');
  G.V.dist = 40; G.updateWorld(1 / 60); assert.equal(G.V.clearAt, 40, 'salto indietro (checkpoint): nuova zona');
});
test('partenza libera, gioco: partendo SOPRA una buca o un cantiere non si viene colpiti (prima sì)', () => {
  for (const h of G.hazards) {
    startAt(h.z - 5, { lat: h.lane / 0.7, zone: false }); const prima = runFrames(1.5).filter(e => e.type === 'hit').length;
    startAt(h.z - 5, { lat: h.lane / 0.7 }); const dopo = runFrames(1.5).filter(e => e.type === 'hit').length;
    assert.ok(prima >= 1, 'controllo: senza la zona libera ' + h.type + ' a ' + h.z + ' colpisce'); assert.equal(dopo, 0, 'con la zona libera niente colpo a ' + h.z);
  }
});
test('partenza libera, allenamento: partendo davanti a una buca la bici non salta e non sterza per un ostacolo che non si vede', () => {
  const h = G.hazards.find(q => q.type === 'pothole');
  startAt(h.z - 4, { auto: true, lat: h.lane / 0.7, zone: false }); const prima = runFrames(1).filter(e => e.type === 'hop').length;
  startAt(h.z - 4, { auto: true, lat: h.lane / 0.7 }); const dopo = runFrames(1).filter(e => e.type === 'hop').length;
  assert.ok(prima >= 1, 'controllo: senza zona libera salta'); assert.equal(dopo, 0);
});
test('partenza libera, gioco: partendo in mezzo a un incrocio o addosso a un\'auto non si viene investiti', () => {
  for (const x of G.crossers) {
    const ph0 = x.ph;
    for (const zone of [false, true]) {
      startAt(x.zc - 5, { lat: 0, zone }); x.ph = (((3 - (5 / 8) * x.vx) % 6) + 6) % 6;
      const n = runFrames(1.5).filter(e => e.type === 'hit').length;
      if (!zone) assert.ok(n >= 1, 'controllo: senza zona libera l\'auto a ' + x.zc + ' investe'); else assert.equal(n, 0, 'con la zona libera nessuno scontro a ' + x.zc);
    }
    x.ph = ph0;
  }
  for (const m of G.movers) {
    if (m.type === 'ped') continue;
    for (const zone of [false, true]) {
      startAt(m.z0 - 0.5, { lat: m.lane / 0.7, zone }); G.V.time = 0.001;
      const n = runFrames(0.3, 0).filter(e => e.type === 'hit').length;
      if (!zone) assert.ok(n >= 1, 'controllo: senza zona libera ' + m.type + ' a ' + m.z0 + ' colpisce'); else assert.equal(n, 0, m.type + ' a ' + m.z0 + ' non colpisce se si parte lì');
    }
  }
});
