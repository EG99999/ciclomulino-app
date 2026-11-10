// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Riassume un log di debug di Open Trainer (file .jsonl): dispositivi, flusso dei pacchetti, comandi, ERG, prestazioni, errori, punti segnati.
// Uso: node tools/analizza-log.mjs <file.jsonl> [--raw tipo]     (--raw stampa le righe grezze di quel tipo, es. --raw ble.gatt.read)
import { readFileSync } from 'node:fs';

const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const q = (a, p) => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : null; };
const mean = a => { const s = a.filter(x => x != null); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
const r1 = x => (x == null ? '-' : (Math.round(x * 10) / 10).toString());
const r2 = x => (x == null ? '-' : (Math.round(x * 100) / 100).toString());
const mmss = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

export function parse(text) { return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }

export function analyze(L) {
  const out = [], P = (...a) => out.push(a.join(' ')), H = t => P('\n== ' + t + ' ==');
  const of = k => L.filter(l => l.k === k), re = r => L.filter(l => r.test(l.k)), d = l => l.d || {};
  const head = L.find(l => l.k === 'run.start'), end = L.find(l => l.k === 'run.end');
  H('Registrazione');
  if (head) { const h = d(head); P('build', h.build, '· run', h.runId, '· durata', mmss(L.at(-1).t), end ? '(chiuso: ' + d(end).reason + ')' : '(NON chiuso: pagina chiusa male o log ancora in corso)'); P('browser', (h.env && h.env.ua || '').replace(/^Mozilla\/5.0 /, '').slice(0, 110)); if (h.env) P('GPU', h.env.gpu ? (h.env.gpu.renderer || '') : 'nessuna', '· core', h.env.cores, '· RAM', h.env.ramGb, 'GB · bluetooth', h.env.api && h.env.api.bluetooth); P('impostazioni', JSON.stringify(h.settings)); }
  P('righe', L.length, '· scartate', (end && d(end).dropped) || 0);

  H('Dispositivi Bluetooth');
  for (const l of re(/^ble\.(availability|request|device|csc|status|trainingStatus|connect\.fail|open\.fail)$/)) P(mmss(l.t), l.k, JSON.stringify(d(l)));
  for (const l of of('ble.gatt.map')) P(mmss(l.t), 'servizi', d(l).who, (d(l).services || []).map(s => s.s + '[' + s.chars.map(c => c.c + ':' + c.p).join(' ') + ']').join(' | ') || JSON.stringify(d(l)));
  for (const l of of('ble.gatt.read')) { const x = d(l); P(mmss(l.t), 'lettura', x.who, x.label, x.hex || '', x.text ? '«' + x.text + '»' : '', x.pct != null ? x.pct + '%' : '', x.dec ? 'machine=' + x.dec.machine.join(',') + ' target=' + x.dec.target.join(',') : '', x.range ? JSON.stringify(x.range) : '', x.err ? 'ERRORE ' + x.err : ''); }

  H('Pacchetti in entrata');
  const rx = of('ble.rx'), groups = {};
  for (const l of rx) { const k = d(l).who + ' ' + d(l).c; (groups[k] ||= []).push(l); }
  for (const [k, a] of Object.entries(groups)) {
    const gaps = a.map(l => num(d(l).gap)), span = (a.at(-1).t - a[0].t) / 1000 || 1;
    let dup = 0; for (let i = 1; i < a.length; i++) if (d(a[i]).hex === d(a[i - 1]).hex && (num(d(a[i]).gap) ?? 1e9) < 30) dup++;
    P(k.padEnd(14), 'n=' + a.length, 'rate=' + r1(a.length / span) + '/s', 'gap p50/p95/max=' + [q(gaps, .5), q(gaps, .95), q(gaps, 1)].map(x => x == null ? '-' : Math.round(x)).join('/') + ' ms', 'lacune>2s=' + gaps.filter(g => g > 2000).length, dup ? 'DOPPIONI=' + dup : '');
  }
  const st = rx.filter(l => d(l).c === '2ada'); if (st.length) { P('stato dal trainer (2ada):'); for (const l of st) P('  ', mmss(l.t), JSON.stringify(d(l).st)); }
  const flags = [...new Set(rx.filter(l => d(l).c === '2ad2').map(l => d(l).fl))]; if (flags.length) P('flag Indoor Bike Data viste:', flags.map(f => '0x' + f.toString(16)).join(' '));

  H('Comandi in uscita');
  const tx = of('ble.tx'), tg = of('ble.target');
  if (tx.length || tg.length) {
    const ok = tx.filter(l => !d(l).err), bad = tx.filter(l => d(l).err);
    P('scritture', tx.length, '· riuscite', ok.length, '· errori', bad.length, '· durata ms p50/p95/max', [q(ok.map(l => d(l).ms), .5), q(ok.map(l => d(l).ms), .95), q(ok.map(l => d(l).ms), 1)].map(x => x ?? '-').join('/'), '· attesa in coda p95', q(ok.map(l => d(l).q), .95) ?? '-');
    for (const l of bad.slice(0, 8)) P('  ERRORE', mmss(l.t), d(l).hex, d(l).err);
    const mins = Math.max(1, (tg.at(-1) ? tg.at(-1).t - tg[0].t : 60000) / 60000);
    P('decisioni sul carico', tg.length, '(~' + r1(tg.length / mins) + '/min) · valori richiesti min/max', Math.min(...tg.map(l => d(l).w)), Math.max(...tg.map(l => d(l).w)), '· non inviati perché uguali (ultimo)', tg.length ? d(tg.at(-1)).supp : 0);
    const cp = rx.filter(l => d(l).c === '2ad9' && d(l).cp), tally = {}; for (const l of cp) { const c = d(l).cp, k = (c.resp || c.op) + ':' + (c.result || ''); tally[k] = (tally[k] || 0) + 1; }
    P('risposte del trainer ai comandi', JSON.stringify(tally), '· latenza ms p50/p95/max', [q(cp.map(l => num(d(l).lat)), .5), q(cp.map(l => num(d(l).lat)), .95), q(cp.map(l => num(d(l).lat)), 1)].map(x => x ?? '-').join('/'));
    for (const l of of('ble.sim')) P('  pendenza richiesta', mmss(l.t), JSON.stringify(d(l)));
  } else P('nessun comando (simulatore o nessun trainer vero)');

  H('Collegamenti e perdite di segnale');
  for (const l of re(/^(ble\.state|dev\.state|ble\.gatt\.disconnected|ble\.gatt\.retry|ble\.disconnect|sink\.dead)$/)) P(mmss(l.t), l.k, JSON.stringify(d(l)));

  H('Allenamento e ERG');
  const plan = of('session.plan').at(-1); if (plan) P('seduta', d(plan).title, '· FTP', d(plan).ftp, '· modo', d(plan).mode, '· cfg', JSON.stringify(d(plan).cfg));
  for (const l of re(/^sess\.(start|reduce|restore|pause|resume|finish|step|bias)$/)) { const x = d(l); P(mmss(l.t), l.k, x.step ? x.step.n + ' ' + x.step.lo + '-' + x.step.hi + ' W' : '', x.reason || '', x.t != null ? '(seduta ' + x.t + ' s)' : ''); }
  const ticks = of('tick'), run = ticks.filter(l => d(l).s && d(l).s.on && !d(l).s.pau && !d(l).s.done);
  if (run.length) {
    P('\nPrecisione del carico per step (watt fatti − watt richiesti, dopo i primi 12 s dello step):');
    const byStep = {}; for (const l of run) (byStep[d(l).s.i] ||= []).push(l);
    for (const [i, a] of Object.entries(byStep)) {
      const steady = a.filter(l => d(l).s.st > 12 && d(l).s.red === 0), nm = (plan && d(plan).steps[i] || [])[0] || '';
      const errs = steady.map(l => d(l).in.p - d(l).s.tgt), within = steady.filter(l => Math.abs(d(l).in.p - d(l).s.tgt) <= Math.max(10, d(l).s.tgt * 0.05)).length;
      const first = a[0], settle = a.find(l => Math.abs(d(l).in.p - d(l).s.tgt) <= Math.max(10, d(l).s.tgt * 0.05));
      P(' step', i, nm.padEnd(16), 'richiesti ' + r1(mean(steady.map(l => d(l).s.tgt))) + ' W', 'fatti ' + r1(mean(steady.map(l => d(l).in.p))) + ' W', 'errore medio ' + r1(mean(errs)) + ' W', 'dentro ±5%/10W ' + (steady.length ? Math.round(within / steady.length * 100) : '-') + '%', 'cadenza ' + r1(mean(a.map(l => d(l).in.cad))), 'tempo per entrare nel range ' + (settle ? r1(d(settle).s.st - d(first).s.st) + ' s' : 'mai'));
    }
    P('\nCadenza/potenza/FC sull\'intera seduta: watt medi', r1(mean(run.map(l => d(l).in.p))), '· cadenza media', r1(mean(run.map(l => d(l).in.cad))), '· FC media', r1(mean(run.map(l => d(l).in.hr))), '· ritardo dati p95', q(run.map(l => num(d(l).in.age)), .95), 'ms');
    for (const e of re(/^sess\.(reduce|restore)$/)) { const b = ticks.filter(l => l.t <= e.t).at(-1), af = ticks.filter(l => l.t >= e.t + 9000)[0]; if (b) P(' ', e.k, mmss(e.t), 'prima: cadenza', d(b).in.cad, 'cad bassa', d(b).s && d(b).s.lowT, 's alta', d(b).s && d(b).s.highT, 's · fattore', r2(d(b).s && d(b).s.L), '→ dopo 9 s fattore', r2(af && af.d.s && af.d.s.L), 'richiesti', af && af.d.s && af.d.s.tgt); }
    const sentOff = run.filter(l => d(l).tr && d(l).tr.on && d(l).tr.lastW != null && Math.abs(d(l).tr.lastW - d(l).s.tgt) > 5).length; if (d(run[0]).tr && d(run[0]).tr.k === 'ble') P('secondi in cui l\'ultimo watt inviato al trainer differisce > 5 W da quello richiesto:', sentOff, 'su', run.length);
  } else P('nessun secondo di seduta in corso nel log');

  H('Prestazioni');
  const ride = ticks.filter(l => d(l).scr === 'ride');
  if (ride.length) P('FPS p5/p50/min', [q(ride.map(l => num(d(l).fps)), .05), q(ride.map(l => num(d(l).fps)), .5), q(ride.map(l => num(d(l).fps)), 0)].join('/'), '· disegno ms p50/p95/max', [q(ride.map(l => num(d(l).ms)), .5), q(ride.map(l => num(d(l).ms)), .95), q(ride.map(l => num(d(l).ms)), 1)].join('/'), '· 3D', d(ride[0]).w3);
  const heap = ticks.map(l => num(d(l).heap)).filter(x => x != null); if (heap.length) P('memoria JS MB: inizio', heap[0], '· fine', heap.at(-1), '· max', Math.max(...heap));
  const lt = of('longtask'); P('blocchi > 100 ms:', lt.length, lt.length ? '· max ' + Math.max(...lt.map(l => d(l).ms)) + ' ms' : '');
  const sv = of('save.run'); if (sv.length) P('salvataggio anti-crash: n=' + sv.length, 'ms p95/max', q(sv.map(l => d(l).ms), .95), '/', q(sv.map(l => d(l).ms), 1), '· byte ultimo', d(sv.at(-1)).bytes);
  const hid = of('vis').filter(l => d(l).s === 'hidden'); if (hid.length) P('scheda in secondo piano:', hid.length, 'volte (il browser rallenta i timer)');
  for (const l of re(/^(webgl|net\.state|fullscreen)$/)) P(mmss(l.t), l.k, JSON.stringify(d(l)));

  H('Errori');
  const errs = re(/^(error|error\.res|rejection|csp|console\.(warn|error)|app\.error)$/); if (!errs.length) P('nessuno');
  const seen = new Map(); for (const l of errs) { const k = l.k + ' ' + JSON.stringify(d(l)).slice(0, 220); seen.set(k, (seen.get(k) || 0) + 1); }
  for (const [k, n] of seen) P(n > 1 ? 'x' + n : '  ', k);
  const net = of('net').filter(l => d(l).err || d(l).st >= 400); for (const l of net) P('rete', mmss(l.t), JSON.stringify(d(l)));

  H('File e salvataggi');
  for (const l of re(/^(fit\.build|fit\.send|fit\.download|ride\.saved|ride\.done|out|folder\.history|sync\..*|gpx\.import|plan\.load|route)$/)) P(mmss(l.t), l.k, JSON.stringify(d(l)).slice(0, 260));

  H('Punti segnati (B) e note');
  const marks = re(/^(mark|note)$/); if (!marks.length) P('nessuno');
  for (const m of marks) {
    P(mmss(m.t), m.k, JSON.stringify(d(m)));
    for (const t of ticks.filter(l => Math.abs(l.t - m.t) <= 6000)) { const x = d(t); if (x.s) P('     ', mmss(t.t), 'W', x.in.p, 'rpm', x.in.cad, 'FC', x.in.hr, 'richiesti', x.s.tgt, 'fattore', x.s.L, x.s.pau ? 'pausa ' + x.s.pau : '', x.tr && x.tr.k === 'ble' ? 'pk/s ' + x.tr.rx : ''); }
  }
  H('Uso del gioco');
  const keys = of('key').filter(l => d(l).d === 1), cnt = {}; for (const l of keys) cnt[d(l).code] = (cnt[d(l).code] || 0) + 1; P('tasti premuti', JSON.stringify(cnt));
  for (const l of re(/^game\./)) P(mmss(l.t), l.k, JSON.stringify(d(l)));
  return out.join('\n');
}

if (process.argv[1] && /analizza-log\.mjs$/.test(process.argv[1])) {
  const f = process.argv[2]; if (!f) { console.error('Uso: node tools/analizza-log.mjs <file.jsonl> [--raw tipo]'); process.exit(1); }
  const L = parse(readFileSync(f, 'utf8')), i = process.argv.indexOf('--raw');
  if (i > 0) for (const l of L.filter(x => x.k === process.argv[i + 1])) console.log(JSON.stringify(l)); else console.log(analyze(L));
}
