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

/* ---- incroci: semafori, stop, precedenze, auto che aspettano in coda ---- */
const J = k => G.junctions.find(j => j.kind === k), carsOf = jn => G.crossers.filter(c => c.jn === jn);
const saveCars = () => G.crossers.map(c => ({ c, u: c.u, wait: c.wait, stopped: c.stopped, sw: c.sw }));
const restoreCars = saved => { for (const q of saved) Object.assign(q.c, { u: q.u, wait: q.wait, stopped: q.stopped, sw: q.sw }); };
test('allenamento: l\'auto che deve attraversare lascia passare il ciclista (senza la regola ci sarebbe stato lo scontro)', () => {
  const jn = J('yield'), x = carsOf(jn).find(c => c.d === 1 && !c.lead), speed = 8, saved = saveCars();
  const run = auto => {
    for (const c of G.crossers) Object.assign(c, { wait: 999, stopped: true, sw: 0 });
    Object.assign(x, { wait: 0, vx: 1.3, u: 0.25 - 1.3 * 3.75 });                  // senza regola arriverebbe in mezzo alla strada proprio quando passa il ciclista
    const V = G.V; Object.assign(V, { dist: jn.zc - 30, lat: 0.5, latT: 0.5, jump: 0, jumpT: -1, inv: 0, running: true, auto, traffic: true, hazards: false, time: 0, speed, events: [] }); V._ld = null;
    let overlaps = 0; const dt = 1 / 60;
    for (let t = 0; t < 8; t += dt) { V.time += dt; V.dist += speed * dt; G.updateWorld(dt); G.drainEvents(); if (Math.abs(jn.zc - V.dist) < 1.6 && Math.abs(x.u * 1.2 - V.lat * 0.7) < 0.33) overlaps++; }
    return overlaps;
  };
  const senza = run(false), con = run(true); restoreCars(saved);
  assert.ok(senza > 0, 'controllo: senza la regola l\'auto è sulla traiettoria'); assert.equal(con, 0, 'con la regola l\'auto aspetta alla linea e il ciclista passa');
});
test('allenamento: il semaforo si fa trovare verde e nessuna auto laterale è in mezzo alla strada quando passi', () => {
  const jn = J('light'), saved = saveCars(), V = G.V, speed = 8;
  for (const c of carsOf(jn)) Object.assign(c, { wait: 0, stopped: false, sw: 0 });
  Object.assign(V, { dist: jn.zc - 215, lat: 0.5, latT: 0.5, jump: 0, jumpT: -1, inv: 0, running: true, auto: true, traffic: true, hazards: false, time: 0, speed, events: [] }); V._ld = null;
  let redAtArrival = 0, onRoadWhileRider = 0; const dt = 1 / 60;
  while (jn.zc - V.dist > -3) {
    V.time += dt; V.dist += speed * dt; G.updateWorld(dt); G.drainEvents(); const rel = jn.zc - V.dist;
    if (rel < 40 && rel > -3) { if (G.lightOf(jn).main !== 'green') redAtArrival++; if (carsOf(jn).some(c => Math.abs(c.u * 1.2) < 1.1)) onRoadWhileRider++; }
  }
  restoreCars(saved);
  assert.equal(redAtArrival, 0, 'verde per tutto l\'arrivo'); assert.equal(onRoadWhileRider, 0, 'nessuna auto in mezzo alla strada mentre passi');
});
test('semaforo rosso per le auto laterali: si accodano ferme alla linea, al verde ripartono', () => {
  const jn = J('light'), saved = saveCars(), V = G.V, LINE = -1.55, dt = 1 / 30;
  for (const c of G.crossers) Object.assign(c, { wait: 999 });
  for (const c of carsOf(jn)) Object.assign(c, { wait: 0, stopped: false, sw: 0, u: -c.d * (c.lead ? 8 : 5.5) });
  Object.assign(V, { dist: jn.zc - 400, lat: 0.5, latT: 0.5, jump: 0, jumpT: -1, inv: 0, running: false, auto: false, traffic: true, hazards: false, time: 0, speed: 0, events: [] }); V._ld = null;
  jn.lo = 3;                                             // tra 3 e 22 s la strada principale ha verde e le auto laterali rosso
  for (let t = 0; t < 12; t += dt) { V.time += dt; G.updateWorld(dt); }
  const lead = carsOf(jn).filter(c => !c.lead), fol = carsOf(jn).filter(c => c.lead);
  for (const c of lead) assert.ok(Math.abs(c.u * c.d - LINE) < 0.02, 'prima auto ferma alla linea: ' + c.u * c.d);
  for (const c of fol) assert.ok(Math.abs(c.u * c.d - (LINE - 1.2)) < 0.05, 'seconda auto in coda dietro la prima: ' + c.u * c.d);
  jn.lo = 27 - V.time;                                   // ora il verde è delle auto laterali
  for (let t = 0; t < 3; t += dt) { V.time += dt; G.updateWorld(dt); }
  for (const c of lead) assert.ok(c.u * c.d > LINE + 1, 'la prima auto è ripartita: ' + c.u * c.d);
  restoreCars(saved);
});
test('gioco: semaforo rosso ignorato = investito; verde no', () => {
  const jn = J('light'), saved = saveCars();
  for (const [lo, atteso] of [[22, true], [2, false]]) {           // rosso / verde all'arrivo (≈ 8 s dopo la partenza)
    for (const c of G.crossers) Object.assign(c, { wait: 999 });
    startAt(jn.zc - 70, { lat: 0 }); jn.lo = lo; jn.prev = 999;
    const n = runFrames(10).filter(e => e.type === 'hit' && e.what === 'semaforo').length;
    assert.equal(n > 0, atteso, (atteso ? 'rosso: penalità' : 'verde: nessuna penalità') + ' (' + n + ')');
  }
  restoreCars(saved);
});
test('gioco: lo stop va rispettato: a velocità si viene investiti, rallentando a meno di 2 m/s no', () => {
  const jn = J('stop'), saved = saveCars();
  for (const [sp, atteso] of [[8, true], [1.5, false]]) {
    for (const c of G.crossers) Object.assign(c, { wait: 999 });
    startAt(jn.zc - 70, { lat: 0 }); G.V.speed = sp; jn.prev = 999;
    const n = runFrames(70 / sp + 4, sp).filter(e => e.type === 'hit' && e.what === 'stop').length;
    assert.equal(n > 0, atteso, 'a ' + sp + ' m/s (' + n + ')');
  }
  restoreCars(saved);
});
test('incroci: due auto della stessa strada non si sovrappongono mai e nessuna sparisce a metà strada', () => {
  const V = G.V; Object.assign(V, { dist: 0, lat: 0.5, latT: 0.5, jump: 0, jumpT: -1, inv: 0, running: true, auto: false, traffic: true, hazards: false, time: 0, speed: 0, events: [] }); V._ld = null;
  let minGap = 99, vanish = 0; const prev = new Map(); const dt = 1 / 30;
  for (let t = 0; t < 300; t += dt) {
    V.time += dt; G.updateWorld(dt); G.drainEvents();
    for (const c of G.crossers) { const p = c.u * c.d; if (c.lead) minGap = Math.min(minGap, Math.abs(c.lead.u * c.d - p)); const q = prev.get(c); if (q != null && Math.abs(p - q) > 1 && !(q > 9 && p < -9)) vanish++; prev.set(c, p); }
  }
  assert.ok(minGap > 1.15, 'distanza minima rispettata (' + minGap + ')'); assert.equal(vanish, 0, 'nessun salto di posizione');
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
  const saved = saveCars();
  for (const jn of G.junctions) {
    const x = carsOf(jn).find(c => c.d === 1 && !c.lead);
    for (const zone of [false, true]) {
      for (const c of G.crossers) Object.assign(c, { wait: 999, stopped: true, sw: 0 });
      startAt(jn.zc - 5, { lat: 0, zone }); Object.assign(x, { wait: 0, vx: 1.3, u: -1.3 * 0.625 }); jn.prev = 0;      // l'auto arriva in mezzo alla strada proprio mentre si passa
      const n = runFrames(1.5).filter(e => e.type === 'hit').length;
      if (!zone) assert.ok(n >= 1, 'controllo: senza zona libera l\'auto a ' + jn.zc + ' investe'); else assert.equal(n, 0, 'con la zona libera nessuno scontro a ' + jn.zc);
    }
  }
  restoreCars(saved);
  for (const m of G.movers) {
    if (m.type === 'ped') continue;
    for (const zone of [false, true]) {
      startAt(m.z0 - 0.5, { lat: m.lane / 0.7, zone }); G.V.time = 0.001;
      const n = runFrames(0.3, 0).filter(e => e.type === 'hit').length;
      if (!zone) assert.ok(n >= 1, 'controllo: senza zona libera ' + m.type + ' a ' + m.z0 + ' colpisce'); else assert.equal(n, 0, m.type + ' a ' + m.z0 + ' non colpisce se si parte lì');
    }
  }
});
