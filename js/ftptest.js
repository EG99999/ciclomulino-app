// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Test FTP integrati: ramp test e test da 20'. Tutti i watt sono calcolati dalla FTP di riferimento (mai fissi).
export const round5 = v => Math.round(v / 5) * 5;

/** Ramp: parte a ~40% FTP e sale del ~7% FTP ogni minuto, fino a quando non ce la fai. */
export function rampPlan(ftp) {
  const start = round5(ftp * 0.40), step = Math.max(10, round5(ftp * 0.07)), easy = round5(ftp * 0.35);
  const blocks = [{ t: 'warmup', n: 'Riscaldamento', d: 300, lo: easy - 5, hi: easy + 5 }];
  for (let i = 0, p = start; p <= ftp * 2.2; i++, p += step) blocks.push({ t: 'interval', n: `Rampa ${i + 1}`, d: 60, lo: p - 5, hi: p + 5 });
  blocks.push({ t: 'cooldown', n: 'Defaticamento', d: 300, lo: easy - 5, hi: easy + 5 });
  return { id: 'test-ramp', title: 'Ramp test FTP', type: 'Test FTP · ramp', notes: `Parti a ${start} W e sali di ${step} W ogni minuto. Quando non riesci più a tenere i watt (o premi «Fine test») il test finisce: FTP = 75% del miglior minuto.`, blocks, test: { kind: 'ramp', start, step } };
}

/** Test 20': riscaldamento con 3 spunti, poi 20' a watt regolabili con ↑/↓ (±5 W). */
export function ftp20Plan(ftp) {
  const easy = round5(ftp * 0.5), warm = round5(ftp * 0.6), hard = round5(ftp);
  return {
    id: 'test-ftp20', title: 'Test FTP 20 minuti', type: 'Test FTP · 20\'', test: { kind: 'ftp20', testStep: 'TEST 20 minuti' },
    notes: 'Riscaldati, poi tieni il passo più alto che riesci a mantenere per 20 minuti. Con ↑/↓ cambi i watt di 5 alla volta. FTP = 95% della potenza media del test.',
    blocks: [
      { t: 'warmup', n: 'Riscaldamento', d: 420, lo: warm - 5, hi: warm + 5 },
      { rep: 3, steps: [{ t: 'interval', n: 'Spunto', d: 60, lo: hard - 5, hi: hard + 5 }, { t: 'recovery', n: 'Facile', d: 60, lo: easy - 5, hi: easy + 5 }] },
      { t: 'recovery', n: 'Recupero', d: 300, lo: easy - 5, hi: easy + 5 },
      { t: 'interval', n: 'TEST 20 minuti', d: 1200, lo: Math.round(hard * 0.95 - 5), hi: Math.round(hard * 0.95 + 5), adjust: true },
      { t: 'cooldown', n: 'Defaticamento', d: 300, lo: easy - 5, hi: easy + 5 }
    ]
  };
}

/** miglior potenza media su `win` secondi consecutivi dentro l'elenco di record (1 Hz) */
export function bestWindow(powers, win = 60) {
  if (powers.length < win) return 0;
  let sum = 0, best = 0;
  for (let i = 0; i < powers.length; i++) { sum += powers[i]; if (i >= win) sum -= powers[i - win]; if (i >= win - 1) best = Math.max(best, sum / win); }
  return best;
}

/** Risultato del test da un Session finito. Ritorna {kind, ftp, basis, label} oppure {error} */
export function testResult(session) {
  const meta = session.plan.test; if (!meta) return { error: 'Non è un test' };
  const steps = session.steps;
  if (meta.kind === 'ramp') {
    const idx = new Set(steps.map((s, i) => (/^Rampa /.test(s.n) ? i : -1)).filter(i => i >= 0));
    const p = session.records.filter(r => idx.has(r.step)).map(r => r.p);
    if (p.length < 120) return { error: 'Test troppo corto: servono almeno 2 minuti di rampa.' };
    const map = bestWindow(p, 60);
    return { kind: 'ramp', basis: Math.round(map), ftp: Math.round(map * 0.75), label: `Miglior minuto ${Math.round(map)} W × 75%` };
  }
  const ti = steps.findIndex(s => s.n === meta.testStep), p = session.records.filter(r => r.step === ti).map(r => r.p);
  if (p.length < 600) return { error: 'Test troppo corto: servono almeno 10 minuti del blocco da 20\'.' };
  const avg = p.reduce((a, x) => a + x, 0) / p.length;
  return { kind: 'ftp20', basis: Math.round(avg), ftp: Math.round(avg * 0.95), label: `Media ${Math.round(avg)} W su ${Math.round(p.length / 60)} min × 95%` };
}

/** Controlla se nella rampa non ce la fai più: potenza < 80% del carico per 12" consecutivi (dopo i primi 3 minuti di rampa). */
export class RampWatcher {
  constructor() { this.low = 0; }
  feed(dt, power, target, rampMin) { if (rampMin < 3 || target < 60) { this.low = 0; return false; } this.low = power < target * 0.8 ? this.low + dt : 0; return this.low >= 12; }
}
