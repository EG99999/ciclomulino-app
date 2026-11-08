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
export function loadHistory(storage) { try { return JSON.parse(storage.getItem(KEY) || '[]'); } catch { return []; } }
export function addRide(storage, ride) {
  const h = loadHistory(storage).filter(r => r.id !== ride.id); h.push(ride); h.sort((a, b) => b.when - a.when);
  try { storage.setItem(KEY, JSON.stringify(h.slice(0, 300))); } catch { /* spazio finito */ }
  return h;
}
export function summary(rides, days, now = Date.now()) {
  const from = now - days * 86400000, r = rides.filter(x => x.when >= from);
  return { n: r.length, durS: r.reduce((a, x) => a + x.durS, 0), km: +r.reduce((a, x) => a + x.km, 0).toFixed(1), kj: r.reduce((a, x) => a + x.kj, 0) };
}
