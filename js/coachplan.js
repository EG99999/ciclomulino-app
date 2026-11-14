// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Dal piano del coach (get_plan: sedute con `struttura`) al piano di Open Trainer (blocchi con watt). Usato dall'app (legge direttamente il piano del coach
// che la chat di Claude carica su OneDrive) e dallo strumento da riga di comando tools/coach-to-piano.mjs.
// I watt restano sempre quelli del coach (target `power` o `power_zone`); una seduta indoor con la sola FC si converte solo con `hrFallback`
// (la stessa zona, in watt, dalle zone di potenza del coach).
import { parsePlan } from './plan.js';

export const SOURCE = 'coach-sync';
const KIND = { warmup: 'warmup', interval: 'interval', recovery: 'recovery', rest: 'rest', cooldown: 'cooldown' };
const NAME = { warmup: 'Riscaldamento', interval: 'Lavoro', recovery: 'Recupero', rest: 'Pausa', cooldown: 'Defaticamento' };
const INDOOR = /ciclomulino|indoor|rullo|trainer/i;
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/** limiti in watt di ogni zona di potenza 1-7: dai «floor» del coach, oppure % classiche della FTP (Coggan) */
export function zoneBounds(ftp, floors) {
  const f = Array.isArray(floors) && floors.length === 7 && floors.every(isNum) ? floors : [0, 0.56, 0.76, 0.91, 1.06, 1.21, 1.51].map(p => Math.round(p * ftp));
  const top = Math.round(ftp * 1.75);
  return f.map((lo, i) => ({ lo: i === 0 ? Math.max(lo, 30) : lo, hi: i < 6 ? f[i + 1] - 1 : top }));
}
/** zona FC (1-5) in cui cade un valore di bpm, dai «floor» delle zone FC del coach */
export function hrZoneOf(bpm, hrFloors) { let z = 1; hrFloors.forEach((fl, i) => { if (bpm >= fl) z = i + 1; }); return z; }

function stepToBlock(step, ctx, where) {
  if (!step || typeof step !== 'object') throw new Error(where + ': passo non valido');
  if (step.kind === 'repeat') {
    if (!Number.isInteger(step.repeat) || step.repeat < 1 || step.repeat > 200 || !Array.isArray(step.steps) || !step.steps.length) throw new Error(where + ': ripetizione non valida');
    return { rep: step.repeat, steps: step.steps.map((s, i) => stepToBlock(s, ctx, where + '.' + (i + 1))) };
  }
  const t = KIND[step.kind]; if (!t) throw new Error(where + ': tipo «' + step.kind + '» sconosciuto');
  const b = { t, n: String(step.note || NAME[t]).replace(/[\u0000-\u001f]/g, ' ').slice(0, 40) };
  if (step.end === 'time' && isNum(step.value) && step.value > 0) b.d = Math.round(step.value);
  else if (step.end === 'distance' && isNum(step.value) && step.value > 0) b.dist = Math.round(step.value);
  else throw new Error(where + ': durata non convertibile (end=' + step.end + '): serve «time» o «distance»');
  const cap = /FC[^0-9]{0,12}(\d{2,3})/i.exec(String(step.note || '')); if (cap && +cap[1] >= 60 && +cap[1] <= 230) b.hrCap = +cap[1];
  if (t === 'rest' && step.target !== 'power' && step.target !== 'power_zone') return b;              // la pausa non ha watt: ci pensa l'app (carico minimo)
  let lo, hi;
  if (step.target === 'power' && isNum(step.low)) { lo = Math.round(step.low); hi = Math.round(isNum(step.high) ? step.high : step.low); }
  else if (step.target === 'power_zone' && Number.isInteger(step.low) && step.low >= 1 && step.low <= 7) {
    const z1 = step.low, z2 = Number.isInteger(step.high) && step.high >= z1 && step.high <= 7 ? step.high : z1; lo = ctx.zones[z1 - 1].lo; hi = ctx.zones[z2 - 1].hi;
  } else if (ctx.hrFallback && (step.target === 'heart_rate' || step.target === 'heart_rate_zone')) {
    let z;
    if (step.target === 'heart_rate_zone' && Number.isInteger(step.low)) z = Math.min(5, Math.max(1, step.low));
    else if (step.target === 'heart_rate' && isNum(step.high)) { z = hrZoneOf(step.high - 1, ctx.hrFloors); if (!b.hrCap) b.hrCap = Math.round(step.high); }
    if (!z) throw new Error(where + ': FC senza zona riconoscibile');
    lo = ctx.zones[z - 1].lo; hi = ctx.zones[z - 1].hi; ctx.warnings.push(where + ': watt ricavati dalla zona ' + z + ' (FC ' + (step.low ?? '') + (isNum(step.high) ? '–' + step.high : '') + ')');
  } else throw new Error(where + ': nessun target in watt (target «' + (step.target || 'none') + '»)');
  if (!(lo >= 0 && hi >= lo)) throw new Error(where + ': watt non validi');
  if (hi - lo < 10) { const mid = (lo + hi) / 2; lo = Math.max(0, Math.round(mid - 5)); hi = lo + 10; ctx.warnings.push(where + ': range allargato a 10 W'); }
  b.lo = lo; b.hi = hi; return b;
}

/**
 * coach: array di sedute (get_plan) oppure { sessions: [...] }.
 * opts: { ftp, today, days, zones, hrZones, hrFallback, all }
 * Restituisce { plan, report: { converted: [{id, data}], skipped: [{id, data, motivo}], warnings } }
 */
export function convertPlan(coach, opts = {}) {
  const list = Array.isArray(coach) ? coach : Array.isArray(coach && coach.sessions) ? coach.sessions : [];
  const ftp = isNum(opts.ftp) && opts.ftp >= 50 && opts.ftp <= 600 ? Math.round(opts.ftp) : 271;
  const today = opts.today || new Date().toISOString().slice(0, 10), days = isNum(opts.days) ? opts.days : 45;
  const end = new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  const ctx = { zones: zoneBounds(ftp, opts.zones), hrFloors: Array.isArray(opts.hrZones) && opts.hrZones.length === 5 ? opts.hrZones : [97, 116, 135, 154, 174], hrFallback: !!opts.hrFallback, warnings: [] };
  const sessions = [], converted = [], skipped = [];
  for (const s of list) {
    if (!s || s.tipo !== 'bici' || typeof s.data !== 'string' || s.data < today || s.data > end) continue;
    if (!opts.all && !INDOOR.test([s.id, s.titolo, s.descrizione].join(' '))) continue;
    const id = String(s.id || s.data), skip = motivo => skipped.push({ id, data: s.data, motivo });
    if (!s.struttura || !Array.isArray(s.struttura.steps) || !s.struttura.steps.length) { skip('senza struttura dei passi'); continue; }
    const before = ctx.warnings.length;
    try {
      const blocks = s.struttura.steps.map((x, i) => stepToBlock(x, ctx, id + ' › ' + (i + 1)));
      const sess = { id, date: s.data, time: /^\d{1,2}:\d{2}$/.test(s.orario || '') ? s.orario : null, title: String(s.titolo || id).slice(0, 60), type: String(s.titolo || '').slice(0, 60), notes: String(s.descrizione || '').slice(0, 600), blocks };
      const r = parsePlan({ ftp, sessions: [sess] }); if (!r.ok) { ctx.warnings.length = before; skip('rifiutata da Open Trainer: ' + r.errors[0]); continue; }
      sessions.push(sess); converted.push({ id, data: s.data });
    } catch (e) { ctx.warnings.length = before; skip(e.message); }
  }
  sessions.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  return { plan: { version: 1, source: SOURCE, generated: today, ftp, sessions }, report: { converted, skipped, warnings: ctx.warnings, ftp } };
}

/** true se i due piani sono diversi (la data di generazione non conta) */
export function planChanged(a, b) { const strip = p => JSON.stringify({ ...p, generated: undefined }); return strip(a) !== strip(b); }

/** cosa fare col file di destinazione: 'scrivi' | 'invariato' | 'vuoto' (niente da scrivere) | 'non-mio' (c'è un piano non scritto da questo strumento) */
export function decideWrite(plan, existingText, { overwrite = false } = {}) {
  if (!plan.sessions.length) return 'vuoto';
  if (existingText) {
    let old = null; try { old = JSON.parse(existingText); } catch { /* file rovinato: lo si può rifare */ }
    // è «mio» anche il file con le sedute del coach caricato dalla chat (formato { ftp, zones, sessions }, senza `source`)
    if (old && old.source !== SOURCE && !isCoachPlan(old) && !overwrite) return 'non-mio';
    if (old && old.source === SOURCE && !planChanged(plan, old)) return 'invariato';
  }
  return 'scrivi';
}

/** il testo è un piano del coach (sedute con struttura/tipo) e non già un piano di Open Trainer (blocchi)? */
export function isCoachPlan(data) {
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? data.sessions : null;
  return Array.isArray(list) && list.length > 0 && list.some(s => s && typeof s === 'object' && !Array.isArray(s.blocks) && (s.struttura || s.tipo));
}
/**
 * Testo di un file piano (JSON): se è già un piano di Open Trainer lo restituisce uguale; se è il piano del coach lo converte.
 * Il file del coach può essere un elenco di sedute oppure { ftp, zones, hrZones, hrFallback, sessions: [...] }.
 * opts: { today, ftp (se il file non la indica), days }
 * Restituisce { text, coach, report }.
 */
export function coachTextToPlanText(text, opts = {}) {
  let data; try { data = JSON.parse(text); } catch { return { text, coach: false }; }
  if (!isCoachPlan(data)) return { text, coach: false };
  const d = Array.isArray(data) ? { sessions: data } : data;
  const { plan, report } = convertPlan(d, { ftp: isNum(d.ftp) ? d.ftp : opts.ftp, zones: d.zones, hrZones: d.hrZones, hrFallback: d.hrFallback !== false, today: opts.today, days: opts.days || 60, all: !!d.all });
  return { text: JSON.stringify(plan), coach: true, report, count: plan.sessions.length };
}
