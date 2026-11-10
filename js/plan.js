// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Lettura e validazione di piano-app.json. I valori (watt, range, durate) vengono sempre dal file del coach.
import { speedFor } from './physics.js';

export const DEFAULT_FTP = 271;      // FTP di riferimento (CLAUDE.md), usata solo se il file non la indica
export const REST_W = 50;            // "rest = carico minimo, circa 50 W" (indicazioni del coach)
export const MIN_RANGE_W = 10;
export const TYPES = ['warmup', 'interval', 'recovery', 'rest', 'cooldown'];

const isNum = v => typeof v === 'number' && Number.isFinite(v);
// Limiti di sicurezza: un file sbagliato (o malevolo) non deve bloccare il browser né mandare watt assurdi al trainer.
export const LIMITS = { rep: 200, steps: 5000, ops: 100000, depth: 6, dur: 86400, dist: 1000000, maxW: 2000, ftpMul: 4, ftpMin: 50, ftpMax: 600, sessions: 200,
  totalOps: 200000, totalSteps: 20000,      // budget sull'intero file (non solo per seduta): 200 sedute da 5000 step non devono sommarsi
  minDur: 1, minDist: 10,                   // step più brevi di 1 s o 10 m sarebbero migliaia di beep al secondo
  msgs: 100,                                // al massimo 100 errori e 100 avvisi: il resto diventa «…e altri N»
  bytes: 2000000, files: 100 };             // dimensione massima di un piano o workout importato e numero di workout letti da cartella/cloud
const str = (v, d, n = 80, nl = false) => (typeof v === 'string' && v.trim() ? v.replace(nl ? /[\u0000-\u0009\u000b-\u001f]/g : /[\u0000-\u001f]/g, '').slice(0, n) : d);
const testMeta = t => (t && typeof t === 'object' ? { kind: t.kind === 'ramp' || t.kind === 'ftp20' ? t.kind : null, testStep: str(t.testStep, '', 60), start: isNum(t.start) ? t.start : 0, step: isNum(t.step) ? t.step : 0 } : null);

/** Pendenza generata dal workout (CLAUDE.md), salvo `grade` forzata dal coach. */
export function gradeOf(s, ftp) {
  if (isNum(s.grade)) return s.grade;
  switch (s.t) {
    case 'warmup': return 1.5;
    case 'interval': return 3 + ((s.mid / ftp) - 0.9) * 12;
    case 'recovery': return -3;
    case 'cooldown': return -1;
    default: return 0;
  }
}

/**
 * Valida il file e restituisce { ok, errors[], warnings[], ftp, sessions[] }.
 * Non lancia: gli errori sono dati per l'interfaccia.
 */
export function parsePlan(json) {
  const errors = [], warnings = [];
  let data = json;
  if (typeof json === 'string') {
    try { data = JSON.parse(json); } catch (e) { return { ok: false, errors: ['File non valido (JSON): ' + e.message], warnings, ftp: DEFAULT_FTP, sessions: [] }; }
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.sessions)) {
    return { ok: false, errors: ['Manca l\'elenco "sessions" nel file'], warnings, ftp: DEFAULT_FTP, sessions: [] };
  }
  let ftp = data.ftp;
  if (!(isNum(ftp) && ftp >= LIMITS.ftpMin && ftp <= LIMITS.ftpMax)) { warnings.push(`FTP non indicata nel file (o fuori da ${LIMITS.ftpMin}-${LIMITS.ftpMax} W): uso ${DEFAULT_FTP} W`); ftp = DEFAULT_FTP; }

  const sessions = []; let totalOps = 0, totalSteps = 0, budgetHit = false;
  if (data.sessions.length > LIMITS.sessions) warnings.push(`Troppe sedute: leggo solo le prime ${LIMITS.sessions}`);
  data.sessions.slice(0, LIMITS.sessions).forEach((raw, si) => {
    if (budgetHit) return;
    const label = str(raw && (raw.title || raw.id), `seduta ${si + 1}`, 60);
    const sErr = [], sWarn = [];
    if (!raw || !Array.isArray(raw.blocks) || !raw.blocks.length) { errors.push(`${label}: nessun blocco`); return; }
    const steps = []; let ops = 0, over = '';
    const walk = (blocks, repStack, top, path) => {
      if (repStack.length > LIMITS.depth) { over = over || 'ripetizioni annidate troppo in profondità'; return; }
      blocks.forEach((b, i) => {
        if (over) return;
        if (++ops > LIMITS.ops || ++totalOps > LIMITS.totalOps) { over = 'troppe ripetizioni'; return; }
        if (steps.length >= LIMITS.steps || totalSteps >= LIMITS.totalSteps) { over = `troppi step (max ${LIMITS.steps} per seduta, ${LIMITS.totalSteps} nel file)`; return; }
        const p = `${label} › ${path}${i + 1}`;
        const t = top == null ? i : top;
        if (b && Array.isArray(b.steps)) {
          const n = Number.isInteger(b.rep) && b.rep > 0 && b.rep <= LIMITS.rep ? b.rep : 0;
          if (!n) { sErr.push(`${p}: "rep" deve essere un intero tra 1 e ${LIMITS.rep}`); return; }
          if (!b.steps.length) { sErr.push(`${p}: ripetizione senza step`); return; }
          ops += n; totalOps += n;                      // ogni giro conta, anche se dentro non c'è nulla: altrimenti 200×200×200 giri a vuoto bloccano il browser
          if (ops > LIMITS.ops || totalOps > LIMITS.totalOps) { over = 'troppe ripetizioni'; return; }
          for (let r = 1; r <= n && !over; r++) walk(b.steps, [...repStack, { rep: r, reps: n }], t, `${path}${i + 1}.`);
          return;
        }
        const s = normalizeStep(b, p, ftp, sErr, sWarn);
        if (!s) return;
        const inner = repStack[repStack.length - 1];
        s.bi = t;
        s.rep = inner ? inner.rep : 0;
        s.reps = inner ? inner.reps : 0;
        steps.push(s); totalSteps++;
      });
    };
    walk(raw.blocks, [], null, '');
    if (over) {
      errors.push(`${label}: ${over}: seduta ignorata`);
      if (totalOps > LIMITS.totalOps || totalSteps >= LIMITS.totalSteps) { budgetHit = true; warnings.push('File troppo grande: le sedute successive non sono state lette'); }
      return;
    }
    if (!steps.length) { errors.push(`${label}: nessuno step valido`); sErr.forEach(e => errors.push(e)); return; }

    // tempi (le durate a distanza sono stimate con la fisica)
    let acc = 0, accDist = 0;
    steps.forEach(s => {
      s.slope = gradeOf(s, ftp);
      if (s.d == null) s.dEst = s.dist / Math.max(0.5, speedFor(s.mid, s.slope));
      else s.dEst = s.d;
      s.start = acc; acc += s.dEst;
      s.startDist = accDist; accDist += s.dist != null ? s.dist : s.dEst * speedFor(s.mid, s.slope);
    });
    sErr.forEach(e => errors.push(e));
    sWarn.forEach(w => warnings.push(w));
    sessions.push({
      id: str(raw.id, `s${si}`, 60), date: typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null, time: typeof raw.time === 'string' && /^\d{1,2}:\d{2}$/.test(raw.time) ? raw.time : null,
      title: str(raw.title, str(raw.type, `Seduta ${si + 1}`, 60), 60), type: str(raw.type, str(raw.title, '', 60), 60),
      notes: str(raw.notes, '', 600, true), steps, total: acc, blocks: raw.blocks.length, test: testMeta(raw.test), free: !!raw.free,
      warnings: capMsgs(sWarn)
    });
  });
  return { ok: errors.length === 0 && sessions.length > 0, errors: capMsgs(errors), warnings: capMsgs(warnings), ftp, sessions };
}

/** controlla una seduta già elaborata (es. quella ripristinata dal localStorage, dove può essere stata alterata) con gli stessi limiti di parsePlan */
export function validSession(p, ftp = DEFAULT_FTP) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.steps) || !p.steps.length || p.steps.length > LIMITS.steps) return false;
  if (typeof p.id !== 'string' || typeof p.title !== 'string' || !isNum(p.total)) return false;
  const maxW = Math.min(LIMITS.maxW, ftp * LIMITS.ftpMul);
  return p.steps.every(s => s && typeof s === 'object' && TYPES.includes(s.t) && typeof s.n === 'string' && s.n.length <= 80
    && isNum(s.lo) && isNum(s.hi) && s.lo >= 0 && s.lo <= s.hi && s.hi <= maxW && isNum(s.mid) && isNum(s.start) && isNum(s.dEst) && isNum(s.bi) && isNum(s.rep) && isNum(s.reps)
    && (s.d == null ? isNum(s.dist) && s.dist >= LIMITS.minDist && s.dist <= LIMITS.dist : isNum(s.d) && s.d >= LIMITS.minDur && s.d <= LIMITS.dur)
    && (s.dist == null || (isNum(s.dist) && s.dist >= LIMITS.minDist && s.dist <= LIMITS.dist)));
}

/** al massimo LIMITS.msgs messaggi: un file sbagliato non deve produrre milioni di righe di errore */
function capMsgs(a) { if (a.length > LIMITS.msgs) { const n = a.length - LIMITS.msgs; a.length = LIMITS.msgs; a.push(`…e altri ${n} messaggi`); } return a; }

function normalizeStep(b, p, ftp, errs, warns) {
  if (!b || typeof b !== 'object') { errs.push(`${p}: blocco non valido`); return null; }
  if (!TYPES.includes(b.t)) { errs.push(`${p}: tipo "${b.t}" sconosciuto (ammessi: ${TYPES.join(', ')})`); return null; }
  if ((isNum(b.d) && b.d > LIMITS.dur) || (isNum(b.dist) && b.dist > LIMITS.dist)) { errs.push(`${p}: durata o distanza fuori limite (max ${LIMITS.dur / 3600} ore / ${LIMITS.dist / 1000} km)`); return null; }
  const hasD = isNum(b.d) && b.d > 0, hasDist = isNum(b.dist) && b.dist > 0;
  if (!hasD && !hasDist) { errs.push(`${p}: serve una durata "d" (secondi) o una distanza "dist" (metri)`); return null; }
  if ((hasD && b.d < LIMITS.minDur) || (!hasD && b.dist < LIMITS.minDist)) { errs.push(`${p}: step troppo breve (minimo ${LIMITS.minDur} s o ${LIMITS.minDist} m)`); return null; }
  let lo, hi;
  if (Array.isArray(b.pct) && b.pct.length === 2 && b.pct.every(isNum)) { lo = Math.round(b.pct[0] * ftp); hi = Math.round(b.pct[1] * ftp); }
  else if (isNum(b.lo) && isNum(b.hi)) { lo = b.lo; hi = b.hi; }
  else if (b.t === 'rest') { lo = hi = REST_W; }
  else { errs.push(`${p}: mancano i watt ("lo"/"hi" oppure "pct")`); return null; }
  if (lo > hi) { [lo, hi] = [hi, lo]; }
  const maxW = Math.min(LIMITS.maxW, ftp * LIMITS.ftpMul);
  if (!(lo >= 0 && hi <= maxW)) { errs.push(`${p}: watt fuori limite (${lo}-${hi} W; ammessi 0-${Math.round(maxW)} W): è un refuso?`); return null; }
  if (b.t !== 'rest' && hi > 2.5 * ftp && ((hasD && b.d > 30) || (!hasD && b.dist > 300))) warns.push(`${p} (${b.n || b.t}): ${lo}-${hi} W sono più di 2,5 volte la FTP (${ftp} W) per più di 30 s: è un refuso?`);   // la rampa del test FTP arriva a ~2,3 volte, quindi non scatta
  if (b.t !== 'rest' && hi - lo < MIN_RANGE_W) warns.push(`${p} (${b.n || b.t}): range ${lo}-${hi} W di soli ${hi - lo} W, sotto il minimo di ${MIN_RANGE_W} W`);
  const cad = Array.isArray(b.cad) && b.cad.length === 2 && b.cad.every(v => isNum(v) && v >= 0 && v <= 250) ? b.cad : null;
  return {
    t: b.t, n: str(b.n, b.t, 60), d: hasD ? b.d : null, dist: hasDist ? b.dist : null,
    lo, hi, mid: (lo + hi) / 2, cad,
    grade: isNum(b.grade) && b.grade >= -30 && b.grade <= 30 ? b.grade : null, hrCap: isNum(b.hrCap) && b.hrCap >= 30 && b.hrCap <= 250 ? b.hrCap : null, adjust: !!b.adjust
  };
}

/** Indice della seduta da preselezionare: oggi; altrimenti la prossima futura; altrimenti la prima. */
export function pickSession(sessions, todayISO) {
  if (!sessions.length) return -1;
  const exact = sessions.findIndex(s => s.date === todayISO);
  if (exact >= 0) return exact;
  let best = -1;
  sessions.forEach((s, i) => { if (s.date && s.date > todayISO && (best < 0 || s.date < sessions[best].date)) best = i; });
  return best >= 0 ? best : 0;
}

export function localISODate(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
