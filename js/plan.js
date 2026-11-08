// Lettura e validazione di piano-app.json. I valori (watt, range, durate) vengono sempre dal file del coach.
import { speedFor } from './physics.js';

export const DEFAULT_FTP = 271;      // FTP di riferimento (CLAUDE.md), usata solo se il file non la indica
export const REST_W = 50;            // "rest = carico minimo, circa 50 W" (indicazioni del coach)
export const MIN_RANGE_W = 10;
export const TYPES = ['warmup', 'interval', 'recovery', 'rest', 'cooldown'];

const isNum = v => typeof v === 'number' && Number.isFinite(v);

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
  if (!(isNum(ftp) && ftp > 0)) { warnings.push(`FTP non indicata nel file: uso ${DEFAULT_FTP} W`); ftp = DEFAULT_FTP; }

  const sessions = [];
  data.sessions.forEach((raw, si) => {
    const label = raw && (raw.title || raw.id) || `seduta ${si + 1}`;
    const sErr = [], sWarn = [];
    if (!raw || !Array.isArray(raw.blocks) || !raw.blocks.length) { errors.push(`${label}: nessun blocco`); return; }
    const steps = [];
    const walk = (blocks, repStack, top, path) => {
      blocks.forEach((b, i) => {
        const p = `${label} › ${path}${i + 1}`;
        const t = top == null ? i : top;
        if (b && Array.isArray(b.steps)) {
          const n = Number.isInteger(b.rep) && b.rep > 0 ? b.rep : 0;
          if (!n) { sErr.push(`${p}: "rep" deve essere un intero > 0`); return; }
          for (let r = 1; r <= n; r++) walk(b.steps, [...repStack, { rep: r, reps: n }], t, `${path}${i + 1}.`);
          return;
        }
        const s = normalizeStep(b, p, ftp, sErr, sWarn);
        if (!s) return;
        const inner = repStack[repStack.length - 1];
        s.bi = t;
        s.rep = inner ? inner.rep : 0;
        s.reps = inner ? inner.reps : 0;
        steps.push(s);
      });
    };
    walk(raw.blocks, [], null, '');
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
      id: raw.id || `s${si}`, date: raw.date || null, time: raw.time || null,
      title: raw.title || raw.type || `Seduta ${si + 1}`, type: raw.type || raw.title || '',
      notes: raw.notes || '', steps, total: acc, blocks: raw.blocks.length, test: raw.test || null, free: !!raw.free,
      warnings: sWarn
    });
  });
  return { ok: errors.length === 0 && sessions.length > 0, errors, warnings, ftp, sessions };
}

function normalizeStep(b, p, ftp, errs, warns) {
  if (!b || typeof b !== 'object') { errs.push(`${p}: blocco non valido`); return null; }
  if (!TYPES.includes(b.t)) { errs.push(`${p}: tipo "${b.t}" sconosciuto (ammessi: ${TYPES.join(', ')})`); return null; }
  const hasD = isNum(b.d) && b.d > 0, hasDist = isNum(b.dist) && b.dist > 0;
  if (!hasD && !hasDist) { errs.push(`${p}: serve una durata "d" (secondi) o una distanza "dist" (metri)`); return null; }
  let lo, hi;
  if (Array.isArray(b.pct) && b.pct.length === 2 && b.pct.every(isNum)) { lo = Math.round(b.pct[0] * ftp); hi = Math.round(b.pct[1] * ftp); }
  else if (isNum(b.lo) && isNum(b.hi)) { lo = b.lo; hi = b.hi; }
  else if (b.t === 'rest') { lo = hi = REST_W; }
  else { errs.push(`${p}: mancano i watt ("lo"/"hi" oppure "pct")`); return null; }
  if (lo > hi) { [lo, hi] = [hi, lo]; }
  if (b.t !== 'rest' && hi - lo < MIN_RANGE_W) warns.push(`${p} (${b.n || b.t}): range ${lo}-${hi} W di soli ${hi - lo} W, sotto il minimo di ${MIN_RANGE_W} W`);
  const cad = Array.isArray(b.cad) && b.cad.length === 2 && b.cad.every(isNum) ? b.cad : null;
  return {
    t: b.t, n: b.n || b.t, d: hasD ? b.d : null, dist: hasDist ? b.dist : null,
    lo, hi, mid: (lo + hi) / 2, cad,
    grade: isNum(b.grade) ? b.grade : null, hrCap: isNum(b.hrCap) ? b.hrCap : null, adjust: !!b.adjust
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
