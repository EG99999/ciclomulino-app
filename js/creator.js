// Creatore di workout: modello modificabile (step e ripetizioni annidate) <-> formato piano-app.json.
export const TYPES = [['warmup', 'Riscaldamento'], ['interval', 'Work'], ['recovery', 'Recupero'], ['rest', 'Pausa'], ['cooldown', 'Defaticamento']];
const DEF = {   // durate e intensità iniziali: in % della FTP, così non ci sono watt fissi
  warmup: { n: 'Riscaldamento', d: 600, pct: [0.40, 0.50] },
  interval: { n: 'Work', d: 300, pct: [0.90, 1.00] },
  recovery: { n: 'Recupero', d: 180, pct: [0.35, 0.45] },
  rest: { n: 'Pausa', d: 120, pct: null },
  cooldown: { n: 'Defaticamento', d: 300, pct: [0.35, 0.45] }
};
export const newStep = (t = 'interval') => { const d = DEF[t]; return { kind: 'step', t, n: d.n, by: 'time', d: d.d, dist: 1000, pw: d.pct ? 'pct' : 'none', lo: 0, hi: 0, pct: d.pct ? [...d.pct] : [0, 0], cad: null, grade: null, hrCap: null }; };
export const newRep = () => ({ kind: 'rep', rep: 3, steps: [newStep('interval'), newStep('recovery')] });

const clean = o => { for (const k of Object.keys(o)) if (o[k] == null) delete o[k]; return o; };
export function toBlocks(nodes) {
  return nodes.map(n => {
    if (n.kind === 'rep') return { rep: Math.max(1, Math.round(n.rep)), steps: toBlocks(n.steps) };
    const b = { t: n.t, n: n.n || n.t };
    if (n.by === 'dist') b.dist = Math.round(n.dist); else b.d = Math.round(n.d);
    if (n.pw === 'watt') { b.lo = Math.round(n.lo); b.hi = Math.round(n.hi); } else if (n.pw === 'pct') b.pct = [+(+n.pct[0]).toFixed(3), +(+n.pct[1]).toFixed(3)];
    if (n.cad && n.cad[0] > 0 && n.cad[1] >= n.cad[0]) b.cad = [Math.round(n.cad[0]), Math.round(n.cad[1])];
    if (n.grade != null && n.grade !== '' && Number.isFinite(+n.grade)) b.grade = +n.grade;
    if (n.hrCap) b.hrCap = Math.round(n.hrCap);
    return clean(b);
  });
}
export function fromBlocks(blocks) {
  return blocks.map(b => {
    if (Array.isArray(b.steps)) return { kind: 'rep', rep: b.rep || 1, steps: fromBlocks(b.steps) };
    const s = newStep(b.t); s.n = b.n || s.n; if (b.dist) { s.by = 'dist'; s.dist = b.dist; } else s.d = b.d || s.d;
    if (Array.isArray(b.pct)) { s.pw = 'pct'; s.pct = [...b.pct]; } else if (typeof b.lo === 'number') { s.pw = 'watt'; s.lo = b.lo; s.hi = b.hi; } else s.pw = b.t === 'rest' ? 'none' : 'pct';
    s.cad = b.cad ? [...b.cad] : null; s.grade = b.grade ?? null; s.hrCap = b.hrCap ?? null; return s;
  });
}
export function toSession({ id, title, type, notes, nodes }) {
  return { id: id || 'mio-' + Date.now().toString(36), date: null, time: null, title: title || 'Il mio workout', type: type || title || 'Workout', notes: notes || '', blocks: toBlocks(nodes), mine: true };
}
export function totalSeconds(nodes, speedMs = 8) {
  return nodes.reduce((a, n) => a + (n.kind === 'rep' ? Math.max(1, n.rep) * totalSeconds(n.steps, speedMs) : (n.by === 'dist' ? n.dist / speedMs : n.d)), 0);
}
/** controlli leggibili: errori (non salvare) e avvisi */
export function check(nodes, ftp) {
  const errors = [], warnings = []; let steps = 0;
  const walk = (list, path) => list.forEach((n, i) => {
    const at = `${path}${i + 1}`;
    if (n.kind === 'rep') { if (!(n.rep >= 1)) errors.push(`Ripetizione ${at}: servono almeno 1 ripetizioni`); if (!n.steps.length) errors.push(`Ripetizione ${at}: è vuota`); walk(n.steps, at + '.'); return; }
    steps++;
    if (n.by === 'time' && !(n.d > 0)) errors.push(`Step ${at}: durata a zero`); if (n.by === 'dist' && !(n.dist > 0)) errors.push(`Step ${at}: distanza a zero`);
    if (n.pw === 'watt') { if (!(n.lo > 0 && n.hi >= n.lo)) errors.push(`Step ${at}: watt non validi (minimo ≤ massimo)`); else if (n.hi - n.lo < 10) warnings.push(`Step ${at}: range di ${n.hi - n.lo} W, meglio almeno 10 W`); }
    if (n.pw === 'pct') { if (!(n.pct[0] > 0 && n.pct[1] >= n.pct[0])) errors.push(`Step ${at}: % FTP non valida`); else if (ftp && (n.pct[1] - n.pct[0]) * ftp < 10 - 1e-6) warnings.push(`Step ${at}: range di ${Math.round((n.pct[1] - n.pct[0]) * ftp)} W con la tua FTP, meglio almeno 10 W`); }
    if (n.pw === 'none' && n.t !== 'rest') errors.push(`Step ${at}: scegli i watt o la % FTP`);
  });
  walk(nodes, ''); if (!steps) errors.push('Aggiungi almeno uno step');
  return { errors, warnings };
}
