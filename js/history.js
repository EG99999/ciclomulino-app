// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Storico delle sedute (nel browser, ultime 300) e statistiche di riepilogo.
const KEY = 'ciclomulino.history';
export function normalizedPower(records) {
  const n = records.length; if (!n) return 0;
  if (n < 30) return records.reduce((a, r) => a + r.p, 0) / n;
  let win = 0, acc = 0, cnt = 0;
  for (let i = 0; i < n; i++) { win += records[i].p; if (i >= 30) win -= records[i - 30].p; if (i >= 29) { acc += (win / 30) ** 4; cnt++; } }
  return Math.pow(acc / cnt, 0.25);
}
/** da un Session finito a una riga di storico */
export function rideFromSession(s, { weight = 0, ftp = 0, mode = 'plan', fitName = '', when = Date.now() } = {}) {
  const avgP = s.avgPower, np = normalizedPower(s.records);
  return { id: when + '-' + s.plan.id, when, title: s.plan.title, type: s.plan.type || '', mode, durS: Math.round(s.t), km: +(s.dist / 1000).toFixed(2), avgP: Math.round(avgP), np: Math.round(np), maxP: Math.round(s.maxP), kj: Math.round(s.kj), hr: Math.round(s.avgHr || 0), wkg: weight > 0 ? +(avgP / weight).toFixed(2) : null, ftp, fit: fitName, done: s.doneReason || '' };
}
/* Dati che arrivano dal cloud o da un altro PC non sono fidati: ogni riga dello storico viene ricostruita campo per campo. */
const num = (v, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(0, v)) : 0);
const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>"'`&]/g, '').slice(0, n);
export function cleanRide(r) {
  if (!r || typeof r !== 'object') return null;
  const when = num(r.when, 4e12); if (!when) return null;
  return { id: txt(r.id, 120) || String(when), when, title: txt(r.title, 120), type: txt(r.type, 60), mode: ['plan', 'test', 'free'].includes(r.mode) ? r.mode : 'plan',
    durS: num(r.durS, 1e6), km: num(r.km, 1e5), avgP: num(r.avgP, 5000), np: num(r.np, 5000), maxP: num(r.maxP, 10000), kj: num(r.kj, 1e6), hr: num(r.hr, 300),
    wkg: typeof r.wkg === 'number' && Number.isFinite(r.wkg) ? num(r.wkg, 50) : null, ftp: num(r.ftp, 2000), fit: txt(r.fit, 120), done: txt(r.done, 30) };
}
/** unione di due storici (stessa seduta = stesso id), dalla più recente, al massimo 300 */
export function mergeHistory(a, b) {
  const m = new Map();
  for (const r of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) { const c = cleanRide(r); if (c && !m.has(c.id)) m.set(c.id, c); }
  return [...m.values()].sort((x, y) => y.when - x.when).slice(0, 300);
}
export function saveHistory(storage, list) { try { storage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } }
/** anche lo storico nel localStorage può essere alterato: ogni riga si ricostruisce (numeri veri, testi puliti) e se non è un elenco si riparte da vuoto */
export function loadHistory(storage) { try { const a = JSON.parse(storage.getItem(KEY) || '[]'); return Array.isArray(a) ? mergeHistory(a, []) : []; } catch { return []; } }
export function addRide(storage, ride) {
  const h = loadHistory(storage).filter(r => r.id !== ride.id); h.push(ride); h.sort((a, b) => b.when - a.when);
  try { storage.setItem(KEY, JSON.stringify(h.slice(0, 300))); } catch { /* spazio finito */ }
  return h;
}
export function summary(rides, days, now = Date.now()) {
  const from = now - days * 86400000, r = rides.filter(x => x.when >= from);
  return { n: r.length, durS: r.reduce((a, x) => a + x.durS, 0), km: +r.reduce((a, x) => a + x.km, 0).toFixed(1), kj: r.reduce((a, x) => a + x.kj, 0) };
}
