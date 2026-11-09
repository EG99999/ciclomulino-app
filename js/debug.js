// Scatola nera di Open Trainer (modalità debug).
// Registra, una riga per evento (formato JSONL), ogni dato che ENTRA (pacchetti Bluetooth, tasti, rete, file) e che ESCE
// (comandi al trainer, file .FIT, salvataggi) più lo stato della seduta ogni secondo. Resta sul PC: non viene inviato a nessuno.
// Regola d'oro: il registratore non lancia mai errori e non rallenta il gioco. Ogni problema qui dentro viene ignorato o contato.
// Segreti: token, codici di accesso e parametri degli indirizzi non entrano mai nel log (vedi redact/redactUrl).

export const SCHEMA = 1;
const pad = (n, l = 2) => String(n).padStart(l, '0');
/** 2026-11-09_203015 (ora locale del PC) */
export function stamp(ms) { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
export const round = (x, n = 2) => (typeof x === 'number' ? (Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : null) : (x === undefined ? null : x));
let runSeq = 0;
const toHex = b => { try { const u = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength); return Array.from(u, x => x.toString(16).padStart(2, '0')).join(' '); } catch { return ''; } };
/** impronta veloce (FNV-1a 32 bit) per riconoscere un file senza salvarne il contenuto */
export function hash32(bytes) { let h = 0x811c9dc5; for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }

/* ---------- segreti ---------- */
const SECRET = /((?:access|refresh|id)_token|client_secret|authorization|bearer|code_verifier|code|password|passwd|secret|signature)(["']?\s*[:=]\s*["']?|\s+)([A-Za-z0-9._~+/=-]{6,})/gi;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const BLOB = /[A-Za-z0-9+/=_-]{80,}/g;
/** toglie dai testi tutto ciò che somiglia a un token, a un codice di accesso o a un blocco di dati codificati */
export const redact = s => String(s).replace(JWT, '[jwt]').replace(/\b(bearer|basic)(\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1$2[nascosto]').replace(SECRET, '$1$2[nascosto]').replace(BLOB, m => `[dati ${m.length}]`);
/** indirizzo senza parametri né frammento (lì dentro possono esserci i codici di accesso) */
export function redactUrl(u, base) {
  try { const x = new URL(String(u), base || 'http://localhost/'); return x.origin + x.pathname + (x.search ? '?…' : ''); } catch { return redact(String(u).split(/[?#]/)[0]).slice(0, 200); }
}
const stackTop = st => (st ? String(st).split(/\r?\n/).slice(0, 4).join(' | ').replace(/https?:\/\/[^/\s)]+/g, '').slice(0, 400) : '');

/** serializzatore sicuro: niente riferimenti circolari, errori e byte leggibili, testi lunghi tagliati, segreti nascosti */
function replacer(maxStr) {
  const stack = [];                                           // catena degli oggetti che contengono quello corrente: circolare = un oggetto che contiene sé stesso (lo stesso oggetto usato in due punti diversi va bene)
  return function (key, v) {
    if (v && typeof v === 'object' && stack.includes(this)) { while (stack[stack.length - 1] !== this) stack.pop(); }
    if (typeof v === 'string') return v.length > maxStr ? redact(v.slice(0, maxStr)) + `…(+${v.length - maxStr})` : redact(v);
    if (typeof v === 'bigint') return String(v);
    if (typeof v === 'function' || typeof v === 'symbol') return undefined;
    if (v instanceof Error) return { name: v.name, message: redact(String(v.message).slice(0, maxStr)), stack: stackTop(v.stack) };
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return toHex(v);
    if (v && typeof v === 'object') { if (stack.includes(v)) return '[circolare]'; stack.push(v); }
    return v;
  };
}

/* ---------- registratore ---------- */
export class Recorder {
  constructor(o = {}) {
    this.now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.epoch = o.epoch || (() => Date.now());
    this.maxLines = o.maxLines || 250000;       // ~40 MB: oltre si ferma (una seduta di 3 ore ne usa circa 130 mila)
    this.maxStr = o.maxStr || 400;
    this.perSec = o.perSec || 600;              // protezione dal diluvio: oltre questo numero di righe al secondo scarta e conta
    this.sinks = []; this.on = false; this.reset();
  }
  reset() {
    this.lines = []; this.bytes = 0; this.kinds = {}; this.dropped = 0; this.capped = false; this.marks = 0;
    this.runId = ''; this.t0 = 0; this.epoch0 = 0; this.sec = -1; this.secN = 0;
  }
  /** una destinazione dove copiare le righe: {name, every (ms tra una scrittura e l'altra), write(righe, info) -> Promise; restituisce false se non è pronta} */
  addSink(s) { s.idx = 0; s.seq = 0; s.fails = 0; s.err = ''; s.lastTry = -1e9; s.busy = false; s.okAt = 0; this.sinks.push(s); return s; }
  rearm(name) { for (const s of this.sinks) if (!name || s.name === name) { s.fails = 0; s.err = ''; } }
  start(meta = {}) {
    this.reset();
    this.t0 = this.now(); this.epoch0 = this.epoch();
    this.runId = stamp(this.epoch0) + '-' + (++runSeq).toString(36) + Math.random().toString(36).slice(2, 4);      // il numero progressivo garantisce nomi diversi anche nello stesso secondo
    for (const s of this.sinks) { s.idx = 0; s.seq = 0; s.fails = 0; s.err = ''; s.lastTry = -1e9; }
    this.on = true;
    const d = new Date(this.epoch0);
    this.log('run.start', { schema: SCHEMA, runId: this.runId, epoch: this.epoch0, iso: d.toISOString(), tzOffsetMin: d.getTimezoneOffset(), ...meta });
    return this.runId;
  }
  log(kind, data) {
    if (!this.on) return;
    try {
      const t = Math.round(this.now() - this.t0), sec = Math.floor(t / 1000);
      if (sec !== this.sec) { if (this.secN > this.perSec) this._push('flood', JSON.stringify({ t, k: 'flood', d: { dropped: this.secN - this.perSec } })); this.sec = sec; this.secN = 0; }
      if (++this.secN > this.perSec) { this.dropped++; return; }
      if (this.lines.length >= this.maxLines) {
        if (!this.capped) { this.capped = true; this._push('run.cap', JSON.stringify({ t, k: 'run.cap', d: { maxLines: this.maxLines } })); }
        this.dropped++; return;
      }
      let line = JSON.stringify(data === undefined ? { t, k: kind } : { t, k: kind, d: data }, replacer(this.maxStr));
      if (line.length > 12000) line = JSON.stringify({ t, k: kind, d: { troncato: line.length, inizio: line.slice(0, 300) } });
      this._push(kind, line);
    } catch (e) { this.dropped++; }
  }
  _push(kind, line) { this.lines.push(line); this.bytes += line.length + 1; this.kinds[kind] = (this.kinds[kind] || 0) + 1; }
  mark(note) { this.marks++; this.log('mark', { n: this.marks, note: note || null }); return this.marks; }
  /** copia le righe nuove su ogni destinazione. force = ignora l'attesa tra una scrittura e l'altra e svuota tutto (chiusura, scarico) */
  async flush(force = false) {
    for (let round = 0; round < 60; round++) {
      const now = this.now(), jobs = []; let moved = 0, waited = false;
      for (const s of this.sinks) {
        if (s.busy) { if (force && s.job) { jobs.push(s.job); waited = true; } continue; }        // una scrittura è già in corso: in chiusura la aspetto, poi riprovo con le righe rimaste
        if (s.fails >= 5 || s.idx >= this.lines.length) continue;
        if (!force && s.every && now - s.lastTry < s.every) continue;
        s.lastTry = now; s.busy = true;
        const batch = this.lines.slice(s.idx, s.idx + 4000), rid = this.runId;
        const info = { runId: rid, start: this.epoch0, first: s.idx === 0, total: s.idx + batch.length, seq: s.seq };
        let p; try { p = Promise.resolve(s.write(batch, info)); } catch (e) { p = Promise.reject(e); }
        s.job = p.then(r => { if (r === false || rid !== this.runId) return; s.idx += batch.length; s.seq++; s.fails = 0; s.err = ''; s.okAt = this.epoch(); moved++; },      // se nel frattempo è partita un'altra registrazione, questo esito non la riguarda
          e => { if (rid !== this.runId) return; s.fails++; s.err = String((e && e.message) || e).slice(0, 120); if (s.fails === 5) this.log('sink.dead', { sink: s.name, err: s.err }); })
          .then(() => { s.busy = false; s.job = null; });
        jobs.push(s.job);
      }
      if (!jobs.length) break;
      await Promise.all(jobs);
      if (!force || (!moved && !waited)) break;
    }
  }
  summary() { return { lines: this.lines.length, bytes: this.bytes, dropped: this.dropped, marks: this.marks, durMs: Math.round(this.now() - this.t0), kinds: this.kinds }; }
  /** chiude la registrazione: ultima riga con i totali, poi svuota le destinazioni */
  async stop(reason = 'stop') {
    if (!this.on) return;
    this.log('run.end', { reason, ...this.summary() });
    this.on = false;
    await this.flush(true);
  }
  text() { return this.lines.length ? this.lines.join('\n') + '\n' : ''; }
  stats() {
    return { on: this.on, runId: this.runId, lines: this.lines.length, bytes: this.bytes, dropped: this.dropped, capped: this.capped, marks: this.marks, kinds: this.kinds,
      sinks: this.sinks.map(s => ({ name: s.name, sent: s.idx, err: s.err, dead: s.fails >= 5, okAt: s.okAt })) };
  }
}
export const rec = new Recorder();
export const log = (k, d) => rec.log(k, d);
/** funzione per i dispositivi Bluetooth: tracer('trainer') → rec.log('ble.<tipo>', {who:'trainer', ...}) */
export const tracer = who => (k, d) => rec.log('ble.' + k, { who, ...d });

/* ---------- impostazioni e ambiente (senza nome, accessi, cartelle) ---------- */
const KEEP = ['wheelMm', 'bike', 'style', 'quality', 'traffic', 'hazards', 'gestures', 'coachMsgs', 'autoPause', 'ambient', 'sound', 'vol', 'showFps', 'weight', 'height', 'ftp', 'ftpMode', 'hrMax', 'ccCorner', 'ccBar', 'ccPages', 'autoSync', 'autoFit', 'planMode', 'folder', 'cloud', 'debug'];
export function settingsSnapshot(S) { const o = {}; if (S) for (const k of KEEP) if (k in S) o[k] = S[k]; return o; }
export function diffSnapshot(a, b) { const o = {}; for (const k of Object.keys(b)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) o[k] = b[k]; return o; }

export function envInfo(win = globalThis) {
  const n = win.navigator || {}, s = win.screen || {}, o = {};
  try {
    o.ua = n.userAgent; o.lang = n.language; o.platform = (n.userAgentData && n.userAgentData.platform) || n.platform; o.cores = n.hardwareConcurrency; o.ramGb = n.deviceMemory || null; o.touch = n.maxTouchPoints;
    o.screen = [s.width, s.height, win.devicePixelRatio]; o.win = [win.innerWidth, win.innerHeight];
    o.tz = Intl.DateTimeFormat().resolvedOptions().timeZone; o.secure = win.isSecureContext; o.online = n.onLine;
    o.api = { bluetooth: !!n.bluetooth, wakeLock: !!n.wakeLock, sw: !!n.serviceWorker, folder: 'showDirectoryPicker' in win, longtask: typeof win.PerformanceObserver !== 'undefined' };
    o.page = win.location ? win.location.origin + win.location.pathname : '';
    if (n.connection) o.net = { type: n.connection.effectiveType, rtt: n.connection.rtt, down: n.connection.downlink };
    if (win.document) {                                                // scheda video: dice se il 3D gira sulla GPU o in software
      const c = win.document.createElement('canvas'), gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (gl) { const e = gl.getExtension('WEBGL_debug_renderer_info'); o.gpu = e ? { vendor: gl.getParameter(e.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(e.UNMASKED_RENDERER_WEBGL) } : { renderer: gl.getParameter(gl.RENDERER) }; o.gpu.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE); const lc = gl.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext(); } else o.gpu = null;
    }
  } catch (e) { o.err = String(e && e.message || e); }
  return o;
}

/* ---------- ganci sul browser (si installano una volta; quando non si registra non fanno nulla) ---------- */
function describe(el) {
  const t = el && el.closest ? el.closest('button, a, label, input, select, textarea, summary, canvas, [data-act], [data-tab], [id]') : null;
  if (!t) return { tag: el && el.tagName ? el.tagName.toLowerCase() : '?' };
  const o = { tag: t.tagName.toLowerCase() };
  if (t.id) o.id = t.id;
  for (const a of ['act', 'tab', 'k', 'sw', 'cc', 'th', 'sp', 'ccadd', 'ccrem', 'ccdel']) if (t.dataset && t.dataset[a] != null) o[a] = String(t.dataset[a]).slice(0, 40);
  if (!/^(input|textarea|select)$/.test(o.tag)) { const tx = String(t.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30); if (tx) o.text = tx; }   // il contenuto dei campi non si legge
  return o;
}
export function installHooks(r = rec, win = window, doc = document) {
  const safeOn = (target, ev, fn, cap) => { try { target.addEventListener(ev, e => { if (!r.on) return; try { fn(e); } catch { /* il debug non disturba */ } }, cap); } catch { /* ignora */ } };
  // errori, promesse rifiutate, risorse che non si caricano, divieti della politica di sicurezza
  safeOn(win, 'error', e => {
    if (e.target && e.target !== win && e.target.tagName) r.log('error.res', { tag: e.target.tagName, src: redactUrl(e.target.src || e.target.href || '', win.location && win.location.href) });
    else r.log('error', { m: e.message, f: redactUrl(e.filename || '', win.location && win.location.href), l: e.lineno, c: e.colno, stack: stackTop(e.error && e.error.stack) });
  }, true);
  safeOn(win, 'unhandledrejection', e => r.log('rejection', { m: String((e.reason && e.reason.message) || e.reason).slice(0, 300), stack: stackTop(e.reason && e.reason.stack) }));
  safeOn(doc, 'securitypolicyviolation', e => r.log('csp', { dir: e.violatedDirective, blocked: redactUrl(e.blockedURI || '', win.location && win.location.href), src: redactUrl(e.sourceFile || '', win.location && win.location.href), l: e.lineNumber }));
  // console.warn / console.error (con un tetto)
  try {
    let n = 0;
    for (const lvl of ['warn', 'error']) {
      const orig = win.console[lvl];
      win.console[lvl] = function (...a) {
        try { if (r.on && ++n <= 200) r.log('console.' + lvl, { m: a.map(x => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ').slice(0, 400) }); } catch { /* ignora */ }
        return orig.apply(this, a);
      };
    }
  } catch { /* ignora */ }
  // rete: solo indirizzo senza parametri, esito e tempo (mai intestazioni né contenuti)
  try {
    const f0 = win.fetch;
    if (typeof f0 === 'function' && !f0.__dbg) {
      const f = function (input, init) {
        const t0 = performance.now(); let url = '', m = 'GET';
        try { url = typeof input === 'string' ? input : (input && input.url) || String(input); m = (init && init.method) || (input && input.method) || 'GET'; } catch { /* ignora */ }
        const u = redactUrl(url, win.location && win.location.href);
        return f0.apply(win, arguments).then(res => { r.log('net', { m, u, st: res.status, ms: Math.round(performance.now() - t0), type: res.type }); return res; },
          err => { r.log('net', { m, u, err: (err && err.name) + ': ' + (err && err.message), ms: Math.round(performance.now() - t0) }); throw err; });
      };
      f.__dbg = true; win.fetch = f;
    }
  } catch { /* ignora */ }
  // blocchi del thread principale > 100 ms (scatti)
  try { let c = 0; new win.PerformanceObserver(l => { if (!r.on) return; for (const en of l.getEntries()) if (en.duration >= 100 && c++ < 150) r.log('longtask', { ms: Math.round(en.duration), at: Math.round(en.startTime) }); }).observe({ type: 'longtask' }); } catch { /* non supportato */ }
  // ambiente
  safeOn(doc, 'visibilitychange', () => r.log('vis', { s: doc.visibilityState }));
  safeOn(win, 'online', () => r.log('net.state', { online: true })); safeOn(win, 'offline', () => r.log('net.state', { online: false }));
  safeOn(doc, 'fullscreenchange', () => r.log('fullscreen', { on: !!doc.fullscreenElement }));
  let rz = 0; safeOn(win, 'resize', () => { clearTimeout(rz); rz = setTimeout(() => r.log('resize', { w: win.innerWidth, h: win.innerHeight, dpr: win.devicePixelRatio }), 400); });
  safeOn(win, 'focus', () => r.log('focus', { on: true })); safeOn(win, 'blur', () => r.log('focus', { on: false }));
  safeOn(win, 'pagehide', () => { r.log('pagehide'); r.flush(true); });
  // tasti e clic (mai il contenuto dei campi di testo)
  const down = new Map();
  safeOn(win, 'keydown', e => { if (e.repeat || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return; down.set(e.code, performance.now()); r.log('key', { code: e.code, d: 1 }); }, true);
  safeOn(win, 'keyup', e => { const t0 = down.get(e.code); if (t0 == null) return; down.delete(e.code); r.log('key', { code: e.code, d: 0, ms: Math.round(performance.now() - t0) }); }, true);
  safeOn(win, 'click', e => r.log('click', describe(e.target)), true);
  safeOn(win, 'change', e => {
    const t = e.target; if (!t || !t.tagName) return; const o = describe(t), ty = t.type;
    if (ty === 'checkbox' || ty === 'radio') o.v = !!t.checked; else if (t.tagName === 'SELECT' || ty === 'range' || ty === 'number' || ty === 'color') o.v = String(t.value).slice(0, 40); else o.len = String(t.value || '').length;
    r.log('change', o);
  }, true);
}

/* ---------- destinazioni ---------- */
// 1) il browser stesso (IndexedDB): se la scheda si chiude male il log si recupera dall'elenco in Impostazioni → Debug
const DB = 'open-trainer-debug', ST = 'kv';
const idbOpen = () => new Promise((res, rej) => { const q = indexedDB.open(DB, 1); q.onupgradeneeded = () => q.result.createObjectStore(ST); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
const idbTx = (db, mode, fn) => new Promise((res, rej) => { const t = db.transaction(ST, mode); let out; try { out = fn(t.objectStore(ST)); } catch (e) { rej(e); return; } t.oncomplete = () => res(out && 'result' in out ? out.result : undefined); t.onerror = t.onabort = () => rej(t.error); });
const range = id => (typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.bound(id + '/', id + '/￿') : null);
export async function idbRuns() {
  try { const db = await idbOpen(), all = await idbTx(db, 'readonly', s => s.getAll(IDBKeyRange.bound('meta/', 'meta/￿'))); db.close(); return (all || []).sort((a, b) => b.start - a.start); } catch { return []; }
}
export async function idbRead(runId) {
  try { const db = await idbOpen(), all = await idbTx(db, 'readonly', s => s.getAll(range(runId))); db.close(); return (all || []).join(''); } catch { return ''; }
}
export async function idbDelete(runId) {
  try { const db = await idbOpen(); await idbTx(db, 'readwrite', s => { s.delete(range(runId)); return s.delete('meta/' + runId); }); db.close(); return true; } catch { return false; }
}
export async function idbClear() { let n = 0; for (const r of await idbRuns()) if (await idbDelete(r.runId)) n++; return n; }
export function idbSink(keep = 6) {
  return {
    name: 'browser', every: 3000,
    async write(batch, info) {
      if (typeof indexedDB === 'undefined') return false;
      const db = await idbOpen();
      try {
        await idbTx(db, 'readwrite', s => { s.put(batch.join('\n') + '\n', `${info.runId}/${String(info.seq).padStart(6, '0')}`); return s.put({ runId: info.runId, start: info.start, lines: info.total, updated: Date.now() }, 'meta/' + info.runId); });
      } finally { db.close(); }
      if (info.first) {                                  // pulizia: tengo i 2 log più recenti e gli ultimi 6 «veri» (le semplici aperture della pagina, poche righe, non fanno perdere una seduta)
        const all = await idbRuns(), ids = new Set([...all.slice(0, 2), ...all.filter(r => r.lines >= 300).slice(0, keep)].map(r => r.runId));
        for (const r of all) if (!ids.has(r.runId)) await idbDelete(r.runId);
      }
    }
  };
}
// 2) la cartella dati (se collegata): file debug/ot-<data>.jsonl, aggiornato di continuo
export function folderSink(getHandle, ready, append) {
  return {
    name: 'cartella', every: 30000,
    async write(batch, info) {
      const h = getHandle(); if (!h || !(await ready(h))) return false;                       // niente cartella (o permesso): riprova al prossimo giro
      await append(h, `debug/ot-${info.runId}.jsonl`, batch.join('\n') + '\n', info.first);
    }
  };
}
