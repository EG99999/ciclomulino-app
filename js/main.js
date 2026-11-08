import { parsePlan, pickSession, localISODate, DEFAULT_FTP } from './plan.js';
import { Session } from './session.js';
import { ERG_CFG } from './erg.js';
import { speedFor } from './physics.js';
import { BleTrainer, BleHr, bleAvailable } from './ble.js';
import { SimTrainer, SimHr } from './sim.js';
import { buildFit, fitFileName } from './fit.js';
import { Coach } from './coach.js';
import * as Au from './audio.js';
import * as G from './scene.js';
import { Route, routeFromFile } from './route.js';
import { loadSettings, saveSettings } from './settings.js';
import { OneDrive, CloudSync } from './onedrive.js';
import { MS_CLIENT_ID } from './config.js';
import { runWizard, runTutorial } from './onboarding.js';
import { createScreens } from './screens.js';
import { folderSupported, pickFolder, savedFolder, forgetFolder, folderPermission, FolderSync } from './folder.js';
import { rampPlan, ftp20Plan, testResult, RampWatcher, round5 } from './ftptest.js';
import { rideFromSession, addRide, loadHistory, summary } from './history.js';
import { toBlocks } from './creator.js';
import { World3D } from './world3d.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignora */ } }
};

const shim = { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) };
const S = loadSettings(shim); const saveS = () => saveSettings(shim, S);
let scr = null;            // schermate (home, scelta, impostazioni...)
/* ---------- stato applicazione ---------- */
const A = {
  plan: null, ftp: 271, sessIdx: -1, session: null, mode: 'plan',   // 'plan' | 'keys'
  trainer: null, hrDev: null, sim: false, speed: 1,
  inp: { power: 0, cad: 0, hr: null, lastData: 0 }, log: [], gain: 0, doneShown: false,
  route: null, startDist: 0, routes: [], rawPlan: '', cloudSessions: [], od: null, cloud: null,
  screen: 'home', mine: [], folderSync: null, folderHandle: null, watcher: null, simGrade: null, freeTarget: 0, afterDone: '', imported: [], lastPlace: '',
  keys: new Set(), keyPower: 0, pg: [], pgT: 0, lastSave: 0, fps: 0, drawMs: 0
};
const quiet = () => A.speed > 5;           // a ×20/×60 niente suoni né messaggi

/* ---------- utilità UI ---------- */
function logEv(m) { A.log.unshift(fmt(A.session ? A.session.t : 0) + '  ' + m); A.log = A.log.slice(0, 6); $('log').innerHTML = A.log.map(x => '<div>' + esc(x) + '</div>').join(''); }
let toastT; function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }
let coachT; function showCoach(text, tone = 'info') {
  if (quiet() || !S.coachMsgs) return;
  const c = $('coach'); c.textContent = text; c.className = 'coach show ' + tone; clearTimeout(coachT); coachT = setTimeout(() => c.classList.remove('show'), 6000);
  logEv('💬 ' + text);
}
const coach = new Coach(showCoach);
let wake = null, wantWake = false;
async function keepAwake(on) {
  wantWake = on;
  try { if (wake) { const w0 = wake; wake = null; await w0.release(); } if (on && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { if (wake) wake = null; }); } } catch { /* non supportato */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && wantWake && !wake) keepAwake(true); });
const ZONES = [[55, '#8a8aa0'], [76, '#4bc4ff'], [91, '#4be37a'], [106, '#ffd24a'], [121, '#ff9a3a'], [151, '#ff4d6d'], [999, '#c06aff']];
const zoneCol = pct => ZONES.find(z => pct < z[0])[1];

/* ---------- piano ---------- */
function showWarnings(r) {
  const box = $('warnBox'); const lines = [...r.errors.map(e => '✖ ' + e), ...r.warnings.map(w => '⚠ ' + w)];
  box.hidden = !lines.length; box.classList.toggle('err', !r.ok);
  box.innerHTML = lines.map(esc).join('<br>');
}
const planFtp = () => (A.plan && A.plan.ftp) || DEFAULT_FTP;
const refFtp = () => (S.ftpMode === 'personal' && S.ftp > 0) ? S.ftp : planFtp();
const ftpSource = () => (S.ftpMode === 'personal' && S.ftp > 0) ? 'la tua FTP personale' : (A.plan ? 'dal piano del coach' : 'valore di riferimento');
function loadMine() { try { A.mine = JSON.parse(store.get('ciclomulino.mine') || '[]'); } catch { A.mine = []; } }
function mergeCloud(text) {
  const extra = [...A.mine, ...A.cloudSessions]; if (!extra.length) return text;
  try { const o = JSON.parse(text); if (!Array.isArray(o.sessions)) return text; const ids = new Set(o.sessions.map(s => s.id)); o.sessions = o.sessions.concat(extra.filter(s => !ids.has(s.id) && (ids.add(s.id), true))); return JSON.stringify(o); } catch { return text; }
}
/** ricostruisce l'elenco sedute (piano + tuoi workout + cartella/OneDrive) senza toccare una seduta in corso */
const busyRide = () => !!(A.session && A.session.started && !A.session.done) || !$('done').hidden;
function rebuildPlan() {
  if (busyRide()) return;
  const text = A.rawPlan || JSON.stringify({ ftp: refFtp(), sessions: [] });
  const keep = A.rawPlan; if (!keep && !A.mine.length && !A.cloudSessions.length) return;
  loadPlanText(text, false, true); if (!keep) A.rawPlan = '';
}
function loadPlanText(text, persist = true, internal = false) {
  if (!internal && busyRide()) { A.pending = { plan: text, persist }; toast('Seduta in corso: il nuovo piano si applica quando esci'); return false; }
  const r = parsePlan(mergeCloud(text));
  showWarnings(r);
  if (!r.ok && !r.sessions.length) { toast('Piano non valido'); return false; }
  if (!internal) A.rawPlan = text;
  A.plan = r; A.ftp = r.ftp;
  scr && scr.cur === 'select' && scr.show('select');
  const sel = $('sessSel'); sel.disabled = false;
  sel.innerHTML = r.sessions.map((s, i) => `<option value="${i}">${esc((s.date ? s.date.slice(8) + '/' + s.date.slice(5, 7) + ' ' + (s.time || '') + ' · ' : '') + s.title)}</option>`).join('');
  const i = pickSession(r.sessions, localISODate());
  sel.value = String(i); selectSession(i, true);
  if (persist) store.set('ciclomulino.plan', text);
  toast(`Piano caricato: ${r.sessions.length} sedute · FTP ${r.ftp} W`);
  return true;
}
const newSession = (plan, ftp, extra = {}) => new Session(plan, ftp, { autoPauseSec: S.autoPause ? 5 : 1e9, ...extra });
function setSession(sess, p) {
  A.session = sess; G.setProfile(p, A.ftp, speedFor);
  A.gain = 0; A.log = []; $('log').innerHTML = ''; A.doneShown = false; A.pg = []; coach.reset();
  syncTrainerFtp();
}
function selectSession(i, force = false) {
  if (!force && A.session && A.session.started && !A.session.done && !confirm('Seduta in corso: cambiare la perde. Continuare?')) { $('sessSel').value = String(A.sessIdx); return; }
  if (A.mode === 'keys') stopKeys(true);
  A.mode = 'plan'; A.watcher = null;
  A.sessIdx = i;
  const p = A.plan.sessions[i];
  setSession(newSession(p, A.ftp), p);
  $('planInfo').innerHTML = esc(p.notes || 'Nessuna nota.') + ' <span class="mute">· ' + p.steps.length + ' step · ' + fmt(p.total) + '</span>';
  if (p.warnings.length) toast(p.warnings[0]);
  logEv('Seduta pronta: ' + p.title);
}
function syncTrainerFtp() { if (A.trainer && A.trainer.kind === 'sim') A.trainer.ftp = A.ftp; }

/* ---------- percorsi reali (provincia di Brescia + GPX importati) ---------- */
async function loadRoutes() {
  const sel = $('routeSel');
  A.imported = []; try { A.imported = JSON.parse(store.get('ciclomulino.gpx') || '[]'); } catch { A.imported = []; }
  try { const j = await (await fetch('routes/index.json')).json(); A.routes = j.routes; $('routeAttr').textContent = j.attribution; } catch { A.routes = []; }
  const opts = ['<option value="auto">Generato dal workout (pixel)</option>'];
  A.routes.forEach(r => opts.push(`<option value="${r.id}">${esc(r.name)} · ${(r.len / 1000).toFixed(0)} km · +${r.gain} m</option>`));
  A.imported.forEach(r => opts.push(`<option value="gpx:${r.id}">📍 ${esc(r.name)} (importato)</option>`));
  sel.innerHTML = opts.join('');
  const want = store.get('ciclomulino.route') || (A.routes[0] && A.routes[0].id) || 'auto';
  sel.value = [...sel.options].some(o => o.value === want) ? want : 'auto';
  await applyRoute(sel.value, true);
}
async function applyRoute(id, silent) {
  try {
    let route = null;
    if (id.startsWith('gpx:')) { const r = A.imported.find(x => 'gpx:' + x.id === id); if (r) route = new Route(r); }
    else if (id !== 'auto') { const meta = A.routes.find(r => r.id === id); if (meta) route = new Route(await (await fetch(meta.file)).json()); }
    A.route = route; G.setRoute(route); if (w3 && w3.ok) w3.setRoute(route); A.lastPlace = '';
    A.startDist = (route && S.lastPick.route === id && route.places.some(p => p.d === S.lastPick.start)) ? S.lastPick.start : 0;
    const ss = $('startSel'); const seenP = new Set();
    ss.innerHTML = route ? route.places.filter(p => !seenP.has(p.n) && seenP.add(p.n)).map(p => `<option value="${p.d}">${esc(p.n)} · km ${(p.d / 1000).toFixed(1)}</option>`).join('') : '';
    ss.disabled = !route; $('startRow').hidden = !route;
    store.set('ciclomulino.route', id); $('routeSel').value = id;
    $('routeInfo').textContent = route ? `${(route.len / 1000).toFixed(1)} km · +${route.gain} m · ${route.loop ? 'giro ad anello' : 'andata'}` : 'Strada e paesaggi generati dal workout';
    if (A.session && !A.session.started) { A.session.dist = 0; G.V.dist = 0; }
    if (!silent && route) showCoach('Percorso: ' + route.name + '. Pendenze e curve sono quelle vere.', 'info');
  } catch (e) { toast('Percorso non caricato: ' + e.message); }
}
async function importGpx(file) {
  try {
    const route = routeFromFile(await file.text(), file.name), j = route.toJSON();
    if (route.len < 500) throw new Error('Percorso più corto di 500 m');
    A.imported = A.imported.filter(r => r.id !== j.id); A.imported.push(j); if (A.imported.length > 6) A.imported.shift();
    if (!store.set('ciclomulino.gpx', JSON.stringify(A.imported))) toast('Percorso non salvabile nel browser (spazio pieno): resta valido finché non chiudi');
    await loadRoutes(); await applyRoute('gpx:' + j.id);
    toast(`Importato: ${route.name} · ${(route.len / 1000).toFixed(1)} km · +${route.gain} m`);
  } catch (e) { toast('GPX: ' + e.message); }
}

/* ---------- salvataggio anti-crash ---------- */
const RUN_KEY = 'ciclomulino.run';
function saveRun() {
  const s = A.session; if (!s || !s.started || A.mode === 'keys' || !s.records.length) return;
  store.set(RUN_KEY, JSON.stringify({ sessId: s.plan.id, plan: s.plan, mode: A.mode, ftp: A.ftp, startDist: A.startDist, routeId: store.get('ciclomulino.route') || 'auto', done: s.done, reason: s.doneReason, snap: s.snapshot() }));
  A.lastSave = performance.now();
}
function checkRecovery() {
  const raw = store.get(RUN_KEY); if (!raw) return;
  let o; try { o = JSON.parse(raw); } catch { store.del(RUN_KEY); return; }
  const p = o.plan || (A.plan && A.plan.sessions.find(s => s.id === o.sessId));
  if (!p || !Array.isArray(p.steps) || !o.snap || !o.snap.rec || o.snap.rec.length < 30) { store.del(RUN_KEY); return; }
  A.rec = { o, p };
  const min = Math.round(o.snap.t / 60), when = new Date(o.snap.savedAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  $('recTitle').textContent = o.done ? 'ULTIMA SEDUTA NON SCARICATA' : 'SEDUTA INTERROTTA';
  $('recInfo').textContent = `${p.title} · ${min} min registrati · salvata ${when}`;
  $('recResume').hidden = !!o.done;
  $('recover').hidden = false;
}
async function restoreRun() {
  const { o, p } = A.rec; A.rec = null; $('recover').hidden = true;
  A.mode = o.mode === 'test' || o.mode === 'free' ? o.mode : 'plan'; A.ftp = o.ftp || A.ftp; G.V.auto = true;
  if (o.routeId && o.routeId !== (A.route ? A.route.id : 'auto')) await applyRoute(o.routeId, true);
  A.startDist = o.startDist || 0;
  const s = newSession(p, A.ftp, { noErg: A.mode !== 'plan' }); s.restore(o.snap);
  A.sessIdx = A.plan ? A.plan.sessions.findIndex(x => x.id === p.id) : -1; if (A.sessIdx >= 0) $('sessSel').value = String(A.sessIdx);
  setSession(s, p); A.watcher = p.test && p.test.kind === 'ramp' ? new RampWatcher() : null; A.doneShown = false; A.simGrade = null; A.freeTarget = round5(A.ftp * 0.45);
  G.V.dist = s.dist + A.startDist; scr.show('ride'); applySettings();
  logEv('Seduta ripristinata a ' + fmt(s.t)); toast('Seduta ripristinata a ' + fmt(s.t) + ': collega il trainer e premi RIPRENDI');
}
function fitFromRecovery() {
  const { o, p } = A.rec; const s = newSession(p, o.ftp || A.ftp); s.restore(o.snap); downloadFit(s); store.del(RUN_KEY); $('recover').hidden = true; A.rec = null;
}

/* ---------- dispositivi ---------- */
const lbl = { trainer: '⚡ TRAINER', hr: '♥ FC' };
function devState(btn, kind) {
  return (s, msg) => {
    const b = $(btn);
    const dev = kind === 'trainer' ? A.trainer : A.hrDev;
    const name = dev && dev.name ? dev.name : '';
    const map = { off: ['off', lbl[kind]], scan: ['scan', '… RICERCA'], on: ['on', '● ' + name.toUpperCase()], lost: ['off', '⚠ SEGNALE PERSO'], retry: ['scan', '… RICONNESSIONE'] };
    const [cls, txt] = map[s] || map.off;
    b.className = 'conn ' + cls; b.textContent = txt;
    if (kind === 'trainer') {
      if (s === 'lost') { const run = A.session && A.session.started && !A.session.done; logEv('Trainer: segnale perso' + (run ? ' → pausa' : '')); toast(run ? 'Trainer scollegato: seduta in pausa' : 'Trainer scollegato'); }
      if (s === 'on' && A.session && A.session.paused && A.session.pauseReason === 'trainer') { logEv('Trainer riconnesso'); showCoach('Trainer riconnesso: premi RIPRENDI quando sei pronto.', 'good'); }
      if (s === 'off' && msg) toast('Trainer: ' + msg);
      if (s === 'retry') logEv('Trainer: ' + (msg || 'riconnessione'));
    }
  };
}
function bindTrainer(t) {
  A.trainer = t;
  const st = devState('btnTrainer', 'trainer');
  t.onState = (x, m) => { if (x === 'lost' || x === 'off') { A.inp.power = 0; A.inp.cad = 0; } if (x === 'on') A.simGrade = null; st(x, m); };
  t.onData = d => { if (d.power != null) A.inp.power = Math.max(0, d.power); if (d.cadence != null) A.inp.cad = d.cadence; if (d.hr) A.inp.hr = d.hr; A.inp.lastData = performance.now(); };
  t.onError = m => { logEv('Trainer: ' + m); };
}
async function connectTrainer() {
  Au.unlock();
  if (A.trainer && A.trainer.connected) { await A.trainer.disconnect(); return; }
  if (A.sim) return;
  if (!bleAvailable()) { toast('Web Bluetooth non disponibile: usa Edge o Chrome su localhost/https'); return; }
  if (A.trainer) { A.trainer.wantConnected = false; try { await A.trainer.disconnect(); } catch { /* ignora */ } A.trainer = null; }
  try { const t = new BleTrainer(); bindTrainer(t); syncTrainerFtp(); await t.connect(); logEv('Connesso: ' + t.name + ' (FTMS)'); }
  catch (e) { A.trainer = null; $('btnTrainer').className = 'conn off'; $('btnTrainer').textContent = lbl.trainer; if (e.name !== 'NotFoundError') toast('Trainer: ' + e.message); }
}
async function connectHr() {
  Au.unlock();
  if (A.hrDev && A.hrDev.connected) { await A.hrDev.disconnect(); A.inp.hr = null; return; }
  if (A.sim) return;
  if (!bleAvailable()) { toast('Web Bluetooth non disponibile'); return; }
  if (A.hrDev) { A.hrDev.wantConnected = false; try { await A.hrDev.disconnect(); } catch { /* ignora */ } A.hrDev = null; }
  try { const h = new BleHr(); A.hrDev = h; h.onState = devState('btnHr', 'hr'); h.onData = bpm => { A.inp.hr = bpm; }; await h.connect(); logEv('Connesso FC: ' + h.name); }
  catch (e) { A.hrDev = null; $('btnHr').className = 'conn off'; $('btnHr').textContent = lbl.hr; if (e.name !== 'NotFoundError') toast('FC: ' + e.message); }
}
async function toggleSim() {
  Au.unlock();
  if (A.sim) {
    if (A.mode === 'keys') stopKeys();
    A.sim = false; A.speed = 1; document.querySelectorAll('[data-sp]').forEach(x => x.classList.toggle('sel', x.dataset.sp === '1'));
    if (A.trainer) await A.trainer.disconnect(); if (A.hrDev) await A.hrDev.disconnect();
    A.trainer = null; A.hrDev = null; A.inp.power = 0; A.inp.cad = 0; A.inp.hr = null;
    $('btnSim').className = 'conn off'; $('simPanel').hidden = true; return;
  }
  if (A.trainer && A.trainer.connected) { toast('Scollega prima il trainer vero'); return; }
  for (const d of [A.trainer, A.hrDev]) if (d) { d.wantConnected = false; try { await d.disconnect(); } catch { /* ignora */ } }
  A.sim = true;
  const t = new SimTrainer(A.ftp); bindTrainer(t); t.name = 'Simulatore';
  const h = new SimHr(t); A.hrDev = h; h.name = 'FC sim'; h.onState = devState('btnHr', 'hr'); h.onData = bpm => { A.inp.hr = bpm; };
  $('btnSim').className = 'conn on'; $('simPanel').hidden = false;
  await t.connect(); await h.connect(); logEv('Simulatore attivo (trainer + FC)');
}

/* ---------- modalità tastiera (giro libero) ---------- */
async function startKeys() {
  Au.unlock();
  if (A.mode === 'keys') { stopKeys(); return false; }
  if (A.session && A.session.started && !A.session.done && !confirm('Seduta in corso: la modalità tastiera la mette da parte. Continuare?')) return false;
  if (A.trainer && A.trainer.connected && !A.sim) { toast('Scollega il trainer vero per giocare con la tastiera'); return false; }
  if (!A.sim) await toggleSim();
  const r = parsePlan({ ftp: A.ftp, sessions: [{ id: 'libero', title: 'Giro libero (tastiera)', type: 'Giro libero', notes: 'Modalità gioco: guidi tu con la tastiera.', blocks: [{ t: 'interval', n: 'Giro libero', d: 7200, lo: 100, hi: 400 }] }] });
  A.mode = 'keys'; A.keyPower = 0; G.V.auto = false;
  setSession(newSession(r.sessions[0], A.ftp, { noErg: true }), r.sessions[0]); A.session.start(); keepAwake(true);
  $('keyhelp').hidden = false; $('menu').hidden = true; $('btnKeys').classList.add('sel'); $('btnKeys').textContent = '⌨ ESCI DAL GIOCO';
  showCoach('Modalità gioco: ↑ pedala, ← → sterza, SPAZIO salta. Schiva buche e lavori!', 'info');
  return true;
}
function stopKeys(silent) {
  A.mode = 'plan'; G.V.auto = true; G.V.latT = 0; if (A.trainer && A.trainer.kind === 'sim') { A.trainer.manual = null; A.trainer.pedaling = true; A.trainer.cadBase = +$('rCad').value || 88; }
  keepAwake(false);
  $('keyhelp').hidden = true; $('btnKeys').classList.remove('sel'); $('btnKeys').textContent = '⌨ MODALITÀ TASTIERA';
  if (silent) return;
  if (A.plan && A.sessIdx >= 0) selectSession(A.sessIdx, true); else A.session = null;
  scr && scr.show('home');
}
function keysStep(dt) {
  const k = A.keys, up = k.has('ArrowUp') || k.has('KeyW'), dn = k.has('ArrowDown') || k.has('KeyS');
  A.keyPower = clamp(A.keyPower + (up ? 190 : dn ? -240 : -30) * dt, 0, 480);
  const t = A.trainer; if (t && t.kind === 'sim') { t.manual = A.keyPower; t.pedaling = A.keyPower > 4; t.cadBase = 55 + A.keyPower * 0.13; }
  G.V.latT = ((k.has('ArrowRight') || k.has('KeyD')) ? 1 : 0) - ((k.has('ArrowLeft') || k.has('KeyA')) ? 1 : 0);
}

/* ---------- controlli ---------- */
function ready() {
  if (!A.session) { toast('Carica prima il piano'); return false; }
  if (!A.trainer || !A.trainer.connected) { toast('Prima connetti il trainer (o il simulatore)'); return false; }
  return true;
}
function toggleGo() {
  Au.unlock();
  const s = A.session; if (!s || s.done) return;
  if (!s.started) { if (!ready()) return; s.start(); keepAwake(true); }
  else if (s.paused) { if (!A.trainer || !A.trainer.connected) { toast('Trainer non connesso'); return; } s.resume(); }
  else s.pause('manual');
}
function endSession() {
  const s = A.session; if (!s || !s.started || s.done) return;
  if (!confirm('Terminare la seduta ora? Potrai comunque scaricare il .FIT.')) return;
  s.finish('stopped');
}
function resetSession() {
  const s = A.session; if (!s) return;
  if (s.started && !s.done && !confirm('Azzerare la seduta in corso?')) return;
  if (A.trainer) A.trainer.setTargetPower && A.trainer.setTargetPower(0);
  s.reset(); A.gain = 0; A.log = []; A.pg = []; $('log').innerHTML = ''; $('done').hidden = true; A.doneShown = false; keepAwake(false); store.del(RUN_KEY); coach.reset();
}
const outputs = () => [A.folderSync, (A.od && A.od.signedIn ? A.cloud : null)].filter(Boolean);
async function sendOut(name, fn) { let ok = 0; for (const o of outputs()) { try { await fn(o); ok++; } catch (e) { toast((o === A.folderSync ? 'Cartella' : 'OneDrive') + ': ' + e.message); } } return ok; }
async function finalizeRide(s) {
  if (!s.records.length || A.mode === 'keys') return;
  const fitName = fitFileName(s, s.plan.title); let bytes = null; try { bytes = buildFit(s); } catch { /* nessun dato */ }
  addRide(shim, rideFromSession(s, { weight: S.weight, ftp: A.ftp, mode: A.mode, fitName }));
  const hist = JSON.stringify(loadHistory(shim));
  if (S.autoFit && bytes && (await sendOut('fit', o => o.pushFit(fitName, bytes))) > 0) store.del(RUN_KEY);
  await sendOut('storico', o => o.pushHistory && o.pushHistory(hist));
}
function showDone() {
  const s = A.session; A.doneShown = true; keepAwake(false); saveRun(); finalizeRide(s);
  $('dTitle').textContent = A.mode === 'test' ? 'TEST FINITO' : s.doneReason === 'stopped' ? 'SEDUTA TERMINATA' : 'SEDUTA COMPLETATA';
  $('dDur').textContent = fmt(s.t); $('dP').textContent = Math.round(s.avgPower) + ' W';
  $('dHR').textContent = s.avgHr ? Math.round(s.avgHr) + ' bpm' : '—'; $('dKJ').textContent = Math.round(s.kj) + ' kJ';
  $('dTest').hidden = true; A.testRes = null;
  if (A.mode === 'test') { const r = testResult(s); A.testRes = r; $('dTest').hidden = false; $('btnUseFtp').hidden = !!r.error; $('dTestTxt').innerHTML = r.error ? esc(r.error) : `FTP stimata: <b>${r.ftp} W</b>${S.weight > 0 ? ` · ${(r.ftp / S.weight).toFixed(2)} W/kg` : ''}<br><span class="hint">${esc(r.label)}${s.doneReason === 'stopped' ? ' · test fermato da te: se non eri al limite la stima è bassa' : ''}</span>`; }
  $('btnFit').disabled = !s.records.length; $('done').hidden = false;
}
function useTestFtp() {
  const r = A.testRes; if (!r || r.error) return;
  S.ftp = r.ftp; S.ftpMode = 'personal'; saveS();
  const rec = JSON.stringify({ date: new Date().toISOString(), test: r.kind, ftp: r.ftp, basis: r.basis, label: r.label, weightKg: S.weight || null, wkg: S.weight > 0 ? +(r.ftp / S.weight).toFixed(2) : null });
  sendOut('ftp', o => o.pushFtp && o.pushFtp(rec)); toast('FTP personale salvata: ' + r.ftp + ' W'); $('btnUseFtp').hidden = true;
}
function downloadFit(sess) {
  const s = sess || A.session;
  try {
    const bytes = buildFit(s); const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fitFileName(s, s.plan.title);
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('File .FIT scaricato (' + Math.round(bytes.length / 1024) + ' kB)');
    if (!sess && s.done) store.del(RUN_KEY);
  } catch (e) { toast('FIT: ' + e.message); }
}
function setBike(id) { const b = G.setBike(id); store.set('ciclomulino.bike', b.id); S.bike = b.id; saveS(); $('bikeSel').value = b.id; $('bikeName').textContent = b.name; }
function toggleSound() { Au.setOn(!Au.AUDIO.on); S.sound = Au.AUDIO.on; saveS(); $('btnSound').textContent = Au.AUDIO.on ? '🔊 SUONI: ON' : '🔇 SUONI: OFF'; }

$('btnMenu').onclick = () => { const mn = $('menu'); mn.hidden = !mn.hidden; $('btnMenu').setAttribute('aria-expanded', String(!mn.hidden)); };
$('btnFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => toast('Schermo intero non disponibile')); };
$('btnCam').onclick = () => { G.V.cam = G.V.cam === 'third' ? 'first' : 'third'; $('btnCam').textContent = G.V.cam === 'first' ? '🎥 PRIMA PERSONA' : '🎥 VISTA'; };
$('btnTrainer').onclick = connectTrainer; $('btnHr').onclick = connectHr; $('btnSim').onclick = toggleSim; $('btnKeys').onclick = startKeys; $('btnSound').onclick = toggleSound;
$('btnGo').onclick = toggleGo; $('btnSkip').onclick = () => A.session && A.session.skip();
$('btnEnd').onclick = endSession; $('btnReset').onclick = resetSession;
$('btnFit').onclick = () => downloadFit(); $('btnCloseDone').onclick = () => { $('done').hidden = true; leaveRide(); };
$('btnUseFtp').onclick = useTestFtp; $('btnHome').onclick = exitToHome;
$('recResume').onclick = restoreRun; $('recFit').onclick = fitFromRecovery; $('recDiscard').onclick = () => { store.del(RUN_KEY); $('recover').hidden = true; A.rec = null; };
$('sessSel').onchange = e => selectSession(+e.target.value);
$('routeSel').onchange = e => applyRoute(e.target.value);
$('startSel').onchange = e => { if (A.session && A.session.started && !A.session.done) { toast('La partenza si sceglie prima di avviare'); e.target.value = String(A.startDist); return; } A.startDist = +e.target.value; G.V.dist = A.startDist; };
$('gpxIn').onchange = async e => { const f = e.target.files[0]; if (f) await importGpx(f); e.target.value = ''; };
$('bikeSel').onchange = e => setBike(e.target.value);
$('vol').oninput = e => { Au.setVolume(+e.target.value); S.vol = +e.target.value; saveS(); };
$('fileIn').onchange = async e => { const f = e.target.files[0]; if (f) loadPlanText(await f.text()); e.target.value = ''; };
$('rCad').oninput = e => { if (A.trainer && A.trainer.kind === 'sim') A.trainer.cadBase = +e.target.value; $('rCadV').textContent = e.target.value; };
$('btnFat').onclick = () => { const t = A.trainer; if (!t || t.kind !== 'sim') return; t.fatigueOn = !t.fatigueOn; $('btnFat').textContent = 'FATICA: ' + (t.fatigueOn ? 'ON' : 'OFF'); $('btnFat').classList.toggle('sel', t.fatigueOn); };
$('btnPed').onclick = () => { const t = A.trainer; if (!t || t.kind !== 'sim') return; t.pedaling = !t.pedaling; $('btnPed').textContent = 'PEDALO: ' + (t.pedaling ? 'SÌ' : 'NO'); $('btnPed').classList.toggle('sel', !t.pedaling); };
$('btnDrop').onclick = async () => { const t = A.trainer; if (!t || t.kind !== 'sim') return; if (t.connected) { t.drop(); $('btnDrop').textContent = 'SEGNALE: PERSO'; $('btnDrop').classList.add('sel'); } else { await t.reconnect(); $('btnDrop').textContent = 'SEGNALE: OK'; $('btnDrop').classList.remove('sel'); } };
document.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { A.speed = A.sim ? +b.dataset.sp : 1; Au.AUDIO.fast = A.speed > 5; document.querySelectorAll('[data-sp]').forEach(x => x.classList.toggle('sel', x === b)); });
document.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { G.V.theme = b.dataset.th; document.querySelectorAll('[data-th]').forEach(x => x.classList.toggle('sel', x === b)); });

const GAMEKEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
addEventListener('keydown', e => {
  if (['SELECT', 'INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  Au.unlock();
  if (e.code === 'KeyF' && A.screen !== 'ride') { $('btnFull').click(); return; }
  if (A.screen !== 'ride') return;
  if ((A.mode === 'test' || A.mode === 'free') && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { e.preventDefault(); const d = e.code === 'ArrowUp' ? 5 : -5; if (A.mode === 'test') { if (A.session.adjust(d)) toast('Carico ' + (A.session.bias >= 0 ? '+' : '') + A.session.bias + ' W'); } else { A.freeTarget = Math.max(30, A.freeTarget + d); toast('Carico fisso ' + A.freeTarget + ' W'); } return; }
  if (A.mode === 'keys') {
    if (GAMEKEYS.includes(e.code)) { e.preventDefault(); A.keys.add(e.code); return; }
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) G.jump(); return; }
    if (e.code === 'KeyP') { A.session && A.session.togglePause(); return; }
    if (e.code === 'Escape') { startKeys(); return; }
  }
  { const sty = { Digit1: 'voxel', Digit2: 'ps1', Digit3: 'iso', Digit4: 'hd2d' }[e.code]; if (sty && A.screen === 'ride') { S.style = sty; saveS(); applySettings(); toast('Stile: ' + sty); return; } }
  if (e.code === 'KeyM') $('btnMenu').click(); if (e.code === 'KeyF') $('btnFull').click(); if (e.code === 'KeyV') $('btnCam').click(); if (e.code === 'KeyN') toggleSound();
  if (A.mode !== 'keys') { if (e.code === 'Space') { e.preventDefault(); toggleGo(); } if (e.code === 'ArrowRight') A.session && A.session.skip(); }
});
addEventListener('keyup', e => A.keys.delete(e.code));
addEventListener('blur', () => A.keys.clear());
addEventListener('pointerdown', () => Au.unlock(), { once: true });
addEventListener('beforeunload', e => { saveRun(); const s = A.session; if (s && s.started && !s.done) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden) saveRun(); });
addEventListener('pagehide', saveRun);

// errori imprevisti: non fermare mai il gioco, avvisare e basta
let lastErr = 0;
function onErr(msg) { console.error(msg); logEv('⚠ ' + msg); if (performance.now() - lastErr > 10000) { lastErr = performance.now(); toast('Errore: ' + msg + ' (la seduta continua)'); } }
addEventListener('error', e => onErr(e.message || 'errore'));
addEventListener('unhandledrejection', e => onErr((e.reason && e.reason.message) || String(e.reason)));

// trascina il file ovunque
let dragN = 0;
addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragN++; $('drop').hidden = false; } });
addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('drop').hidden = true; });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', async e => { e.preventDefault(); dragN = 0; $('drop').hidden = true; const f = e.dataTransfer.files[0]; if (!f) return; if (/\.(gpx|tcx)$/i.test(f.name)) await importGpx(f); else loadPlanText(await f.text()); });

/* ---------- eventi: seduta e mondo -> log, suoni, messaggi ---------- */
function handleEvents(s) {
  for (const e of s.drain()) {
    if (A.mode === 'plan') coach.onEvent(e, s);
    if (quiet()) { if (e.type === 'finish') showDone(); continue; }
    switch (e.type) {
      case 'start': Au.beep(880, 0.2); logEv('Avvio seduta'); break;
      case 'step': if (e.idx > 0 && s.steps[e.idx - 1].t === 'interval') G.gesture('cheer'); Au.stepBeep(); logEv('→ ' + e.step.n + ' ' + e.step.lo + '-' + e.step.hi + ' W'); break;
      case 'tick': Au.tickBeep(); break;
      case 'reduce': G.gesture('shake'); Au.reduceBeep(); logEv('Cadenza <' + ERG_CFG.lowRpm + ' → carico 50%'); break;
      case 'restore': Au.restoreBeep(); logEv('Cadenza >' + ERG_CFG.highRpm + ' → carico ripristinato'); break;
      case 'pause': logEv(e.reason === 'trainer' ? 'Pausa automatica (trainer)' : e.reason === 'auto' ? 'Pausa automatica (fermo)' : 'Pausa manuale'); break;
      case 'resume': logEv('Ripresa'); break;
      case 'finish': G.gesture('cheer'); Au.finishBeep(); Au.cheer(); logEv(e.reason === 'stopped' ? 'Seduta terminata' : 'Seduta completata'); showDone(); break;
    }
  }
  for (const e of G.drainEvents()) {
    switch (e.type) {
      case 'honk': if (!quiet()) Au.horn(e.pan, e.variant); break;
      case 'pass': if (!quiet()) Au.passBy(e.pan); break;
      case 'hop': if (!quiet()) Au.whoosh(); break;
      case 'land': if (!quiet()) Au.land(); break;
      case 'hit': if (!quiet()) Au.thud(); if (A.mode === 'keys') { A.keyPower *= 0.45; if (s.active) coach.onEvent({ type: 'hit' }, s); } break;
      case 'jump': if (s.active && !quiet()) { coach.onEvent({ type: 'jump' }, s); Au.bell(); } break;
    }
  }
}

/* ---------- UI ---------- */
function drawBars(g, W, H, steps, tot, ftp, idx, pos) {
  const max = Math.max(1.3, ...steps.map(x => x.hi / ftp)) * 1.05;
  g.fillStyle = 'rgba(10,8,28,.6)'; g.fillRect(0, 0, W, H);
  for (const [i, st] of steps.entries()) {
    const x = st.start / tot * W, w = Math.max(1, st.dEst / tot * W - 1), h = (st.mid / ftp) / max * (H - 8);
    g.globalAlpha = idx < 0 ? 0.9 : i < idx ? 0.35 : i === idx ? 1 : 0.8; g.fillStyle = zoneCol(st.mid / ftp * 100); g.fillRect(x, H - h, w, h);
  }
  g.globalAlpha = 1; g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([3, 3]); const fy = H - (1 / max) * (H - 8); g.beginPath(); g.moveTo(0, fy); g.lineTo(W, fy); g.stroke(); g.setLineDash([]);
  if (pos >= 0) { const px = clamp(pos / tot, 0, 1) * W; g.fillStyle = '#fff'; g.fillRect(px - 1, 0, 2, H); g.beginPath(); g.moveTo(px - 5, 0); g.lineTo(px + 5, 0); g.lineTo(px, 6); g.fill(); }
}
function drawRibbon(s) {
  const cv = $('ribbon'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  if (!s || A.mode === 'keys' || A.mode === 'free') { cv.hidden = true; return; } cv.hidden = false;
  drawBars(g, W, H, s.steps, Math.max(1, s.totalEst), A.ftp, s.idx, s.planPos);
}
function drawPreview(cv, nodes) {
  const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height);
  const r = parsePlan({ ftp: refFtp(), sessions: [{ id: 'p', blocks: toBlocks(nodes) }] }); if (!r.sessions.length) return;
  drawBars(g, cv.width, cv.height, r.sessions[0].steps, Math.max(1, r.sessions[0].total), refFtp(), -1, -1);
}
function drawPowerGraph(s) {
  const cv = $('pgraph'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(10,8,28,.5)'; g.fillRect(0, 0, W, H);
  const max = Math.max(1.4 * A.ftp, ...A.pg) * 1.05, n = A.pg.length, bw = W / 120;
  if (s && s.step) { const y1 = H - s.step.lo / max * H, y2 = H - s.step.hi / max * H; g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, y2, W, y1 - y2); }
  for (let i = 0; i < n; i++) { const v = A.pg[i], h = v / max * H; g.fillStyle = zoneCol(v / A.ftp * 100); g.fillRect(W - (n - i) * bw, H - h, bw + .5, h); }
}
function ui() {
  const s = A.session, tr = A.trainer;
  const d = new Date();
  $('clock').textContent = d.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' }).toUpperCase() + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  $('tFtp').textContent = 'FTP ' + A.ftp + ' W';
  const connected = !!(tr && tr.connected);
  const b = $('banner'); b.className = 'banner'; let m = '';
  if (!s) { m = 'CARICA piano-app.json'; }
  else if (!connected && !(s.paused && s.pauseReason === 'trainer')) { m = 'COLLEGA IL TRAINER O ATTIVA IL SIMULATORE'; b.classList.add('red'); }
  else if (s.done) m = '';
  else if (!s.started) m = 'PRONTO · PREMI AVVIA';
  else if (s.paused) {
    if (s.pauseReason === 'trainer') { m = connected ? 'TRAINER RICONNESSO · PREMI RIPRENDI' : 'TRAINER SCOLLEGATO · PAUSA'; b.classList.add('red'); }
    else if (s.pauseReason === 'auto') m = 'FERMO · PAUSA AUTOMATICA · RIPARTI A PEDALARE';
    else m = 'PAUSA · CARICO MINIMO';
  }
  else if (s.erg.reduced && A.mode !== 'keys') { m = 'CARICO RIDOTTO 50% · PEDALA >' + ERG_CFG.highRpm + ' RPM PER RIPRENDERE'; b.classList.add('red'); }
  else if (s.rampT < ERG_CFG.stepRampSec && s.idx > 0 && A.mode !== 'keys') { m = 'TRANSIZIONE…'; b.classList.add('grn'); }
  b.hidden = !m; b.textContent = m;
  $('fps').textContent = 'FPS ' + A.fps + ' · disegno ' + A.drawMs.toFixed(1) + ' ms';
  if (!s) { $('btnGo').textContent = '▶ AVVIA'; $('btnGo').disabled = true; return; }
  $('btnGo').disabled = s.done || A.mode === 'keys';
  $('btnHome').hidden = false;
  const st = s.step, keys = A.mode === 'keys', open = keys || A.mode === 'free';
  $('wkType').textContent = s.plan.type || s.plan.title; $('tTotMax').textContent = open ? '∞' : fmt(s.totalEst); $('tTot').textContent = fmt(s.t);
  const w = Math.round(A.inp.power * (s.started || connected ? 1 : 0));
  $('hudW').textContent = w; $('tW').textContent = w;
  const zc = zoneCol(w / A.ftp * 100); $('tileW').style.borderColor = zc; $('tW').style.color = zc;
  const lowFactor = s.erg.L < 0.99 && !keys ? ' ×' + Math.round(s.erg.L * 100) + '%' : '';
  const tg = keys ? 'GIOCO' : A.mode === 'free' ? 'LIBERA' : st.lo + (st.hi !== st.lo ? '-' + st.hi : '');
  $('hudTgt').textContent = tg + lowFactor; $('tTgt').textContent = keys ? 'tastiera' : A.mode === 'free' ? 'libera' : tg + ' W';
  $('tA3').textContent = Math.round(s.avg3); $('tAS').textContent = Math.round(s.avgStep);
  const cad = Math.round(A.inp.cad); $('tCad').textContent = cad; $('hudCad').textContent = cad || '--';
  const hr = A.inp.hr ? Math.round(A.inp.hr) : '--'; $('tHR').textContent = hr; $('hudHR').textContent = hr;
  $('tPct').textContent = Math.round(A.inp.power / A.ftp * 100);
  if (S.weight > 0) { $('tWkg').textContent = (A.inp.power / S.weight).toFixed(2); $('tWkgAvg').textContent = 'media ' + (s.avg3 / S.weight).toFixed(2); } else { $('tWkg').textContent = '—'; $('tWkgAvg').textContent = 'peso nelle impostazioni'; }
  $('tKmh').textContent = (s.speed * 3.6).toFixed(1); $('tKm').textContent = (s.dist / 1000).toFixed(2) + ' km';
  $('tGr').textContent = s.grade.toFixed(1) + '%'; $('tDp').textContent = 'D+ ' + Math.round(A.gain) + ' m';
  $('tL').textContent = open ? '—' : Math.round(s.erg.L * 100);
  $('stName').textContent = s.done ? 'FINE' : G.typeLbl[st.t] + ' · ' + st.n.toUpperCase();
  $('stT').textContent = open ? fmt(s.t) : st.d != null ? fmt(st.d - s.stepT) + ' / ' + fmt(st.d) : Math.max(0, Math.round(st.dist - s.stepDist)) + ' m / ' + st.dist + ' m';
  $('stBar').style.width = (keys ? 0 : s.stepFrac() * 100) + '%';
  $('serie').textContent = st.reps ? (st.reps - st.rep) + ' (su ' + st.reps + ')' : '—';
  $('blocchi').textContent = keys ? '—' : s.blocksLeft + ' (su ' + s.plan.blocks + ')';
  const n = s.next; $('next').textContent = n ? n.n + ' ' + n.lo + (n.hi !== n.lo ? '-' + n.hi : '') + ' W' : 'fine';
  const ex = []; if (st.cad && !keys) ex.push('Cadenza target ' + st.cad[0] + '-' + st.cad[1] + ' rpm'); if (st.hrCap) ex.push('FC max ' + st.hrCap + ' bpm');
  $('stExtra').innerHTML = ex.map(x => '<span>' + esc(x) + '</span>').join('');
  $('stBar').style.background = { warmup: '#ffcc33', interval: '#ff5a5f', recovery: '#4be37a', cooldown: '#4bc4ff', rest: '#9a93c9' }[st.t];
  $('geo').textContent = (s.dist / 1000).toFixed(1) + ' km · ' + s.grade.toFixed(1) + '%';
  $('btnGo').textContent = !s.started ? '▶ AVVIA' : s.paused ? '▶ RIPRENDI' : '⏸ PAUSA';
  $('btnGo').className = s.started && !s.paused ? 'stop' : 'go';
  // prossimi step (come l'elenco allenamento di Zwift)
  const nx = keys ? [] : s.steps.slice(s.idx + 1, s.idx + 4);
  $('nextList').innerHTML = nx.length ? nx.map(x => `<div><i style="background:${zoneCol(x.mid / A.ftp * 100)}"></i><span>${esc(x.n)}</span><b>${x.d != null ? fmt(x.d) : x.dist + ' m'}</b><em>${x.lo}${x.hi !== x.lo ? '-' + x.hi : ''} W</em></div>`).join('') : '<div class="mute">' + (keys ? 'Schiva le buche con SPAZIO' : 'Ultimo step') + '</div>';
  drawRibbon(s); drawPowerGraph(s);
}

/* ---------- ciclo principale ---------- */
// La logica gira su un timer (continua anche con la scheda in secondo piano, dove il browser
// rallenta i timer a ~1 Hz: il dt reale viene recuperato a sottopassi). Il disegno usa requestAnimationFrame a 60 FPS.
const SUB = 0.25;
let last = performance.now(), chirpT = 6;
function logicTick() {
  try {
    const now = performance.now();
    const real = Math.min((now - last) / 1000, 10); last = now;
    const s = A.session; if (!s) return;
    const dt = real * (A.sim ? A.speed : 1);
    const n = Math.max(1, Math.ceil(dt / SUB)), h = dt / n;
    for (let i = 0; i < n; i++) {
      const tr = A.trainer;
      if (A.mode === 'keys') keysStep(h);
      if (A.sim && tr) { tr.tick(h); if (A.hrDev && A.hrDev.tick) A.hrDev.tick(); }
      if (tr && tr.kind === 'ble' && s.started && performance.now() - A.inp.lastData > 4000) { A.inp.power = 0; A.inp.cad = 0; }
      const target = s.update(h, { power: A.inp.power, cad: A.inp.cad, hr: A.inp.hr, connected: !!(tr && tr.connected), grade: A.route ? A.route.gradeAt(A.startDist + s.dist) : null });
      if (tr && tr.connected && s.started && !s.done && A.mode !== 'keys' && A.mode !== 'free') tr.setTargetPower(target);
      if (A.mode === 'free' && tr && tr.connected && s.started && !s.done) {
        if (tr.simUnsupported || !tr.setSimulation) tr.setTargetPower(s.paused ? 50 : A.freeTarget);
        else if (s.paused) { if (A.simGrade !== 0) { A.simGrade = 0; tr.setSimulation(0); } } else if (Math.abs(s.grade - (A.simGrade ?? 99)) >= 0.3) { A.simGrade = s.grade; tr.setSimulation(s.grade); }
      }
      if (A.watcher && s.active && /^Rampa /.test(s.step.n) && A.watcher.feed(h, A.inp.power, s.targetW, s.idx - 1 + s.stepT / 60)) { s.finish('test'); }
      if (s.active && s.grade > 0) A.gain += s.speed * h * s.grade / 100;
      if (s.done && !A.doneShown && tr && tr.connected) tr.setTargetPower(tr.kind === 'sim' ? 0 : ERG_CFG.minLoadW);
      if (A.mode === 'plan') coach.tick(h, s, A.inp);
      if (s.active) { A.pgT += h; while (A.pgT >= 1) { A.pgT -= 1; A.pg.push(A.inp.power); if (A.pg.length > 120) A.pg.shift(); } }
    }
    handleEvents(s);
    if (s.active && !quiet() && S.ambient) { Au.wind(s.speed); chirpT -= real; if (chirpT <= 0) { chirpT = 6 + Math.random() * 14; if (G.V.env !== 'city') Au.chirp(Math.random() * 2 - 1); } } else Au.wind(0);
    if (s.started && !s.done && A.mode !== 'keys' && performance.now() - A.lastSave > 5000) saveRun();
  } catch (e) { onErr(e.message); }
}
setInterval(logicTick, 100);
setInterval(ui, 500); // aggiorna testi/banner anche se la scheda è in secondo piano

let lastDraw = performance.now(), uiAcc = 0, lastEnv = '', fpsN = 0, fpsT = 0, msAcc = 0, msN = 0;
function frame(now) {
  const real = Math.min((now - lastDraw) / 1000, 0.1); lastDraw = now;
  const s = A.session, V = G.V;
  V.time += real;
  if (A.screen !== 'ride') {   // sfondo: il ciclista che pedala, sfocato dietro i menu
    V.running = true; V.reduced = false; V.speed = 8.6; V.slope = 0; V.cad = 88; V.dist += 8.6 * real; V.phase += 88 / 60 * Math.PI * 2 * real;
    const cv = d => A.route ? A.route.curveAt(d) : 60 * Math.sin(d * 0.0045) * Math.sin(d * 0.0013 + 1) * (V.env === 'city' ? 0.35 : 1);
    V.curve = cv(V.dist); V.lean += (clamp((cv(V.dist + 12) - cv(V.dist)) / 6, -1, 1) - V.lean) * Math.min(1, real * 3); V.Hc += (74 - V.Hc) * Math.min(1, real * 0.6);
    G.updateGestures(real, V); G.updateWorld(real); G.drainEvents();
  } else if (s) {
    const st = s.step, vs = real * (A.sim ? A.speed : 1);
    V.dist += (s.active ? s.speed * vs : 0); V.dist += (s.dist + A.startDist - V.dist) * Math.min(1, real * 6);   // distanza fluida a 60 FPS
    V.running = s.active; V.reduced = s.erg.reduced && A.mode !== 'keys'; V.prog = s.planPos / Math.max(1, s.totalEst);
    V.speed = s.speed; V.slope = s.grade; V.cad = A.inp.cad; V.power = A.inp.power; V.hard = st.t === 'interval';
    V.phase += A.inp.cad / 60 * Math.PI * 2 * real * (s.active ? 1 : 0);
    const curveAt = d => A.route ? A.route.curveAt(d) : 60 * Math.sin(d * 0.0045) * Math.sin(d * 0.0013 + 1) * (V.env === 'city' ? 0.35 : 1);
    V.curve = curveAt(V.dist);
    const leanT = clamp((curveAt(V.dist + 12) - curveAt(V.dist)) / 6, -1, 1) * clamp(s.speed / 6, 0, 1) + V.latT * clamp(s.speed / 8, 0, 1) * 0.5;
    V.lean += (leanT - V.lean) * Math.min(1, real * 3);
    V.Hc += ((74 - s.grade * 1.8) - V.Hc) * Math.min(1, real * 0.6);
    G.updateGestures(real, V); G.updateWorld(real);
    if (A.route) { const pl = A.route.placeAt(V.dist); const nm = pl ? pl.n : ''; if (nm && nm !== A.lastPlace) { A.lastPlace = nm; const en = $('envName'); en.textContent = '📍 ' + nm.toUpperCase(); en.classList.add('show'); setTimeout(() => en.classList.remove('show'), 3500); } else if (!nm) A.lastPlace = ''; }
    if (V.env !== lastEnv && !(A.route && A.lastPlace)) { lastEnv = V.env; const en = $('envName'); en.textContent = G.ENV_NAME[V.env]; en.classList.add('show'); setTimeout(() => en.classList.remove('show'), 3500); }
  }
  const t0 = performance.now();
  try { G.drawScene(); G.drawSide(); } catch (e) { if (!A.drawErr) { A.drawErr = e; onErr('grafica: ' + e.message + ' @ ' + String(e.stack || '').split(/\r?\n/).slice(1, 3).join(' <- ').replace(/https?:\/\/[^/]+/g, '')); } }
  msAcc += performance.now() - t0; msN++;
  fpsN++; fpsT += real; if (fpsT >= 1) { A.fps = Math.round(fpsN / fpsT); A.drawMs = msAcc / Math.max(1, msN); fpsN = 0; fpsT = 0; msAcc = 0; msN = 0; }
  uiAcc += real; if (uiAcc > 0.1) { uiAcc = 0; ui(); }
  if (S.showFps) $('fpsBadge').textContent = 'FPS ' + A.fps + ' · ' + A.drawMs.toFixed(1) + ' ms';
  requestAnimationFrame(frame);
}

/* ---------- OneDrive ---------- */
const clientId = () => MS_CLIENT_ID || S.clientId;
function cloudUi() {
  const on = !!(A.od && A.od.signedIn), cid = !!clientId();
  $('cloudStatus').textContent = on ? '✓ Collegato come ' + (A.od.account || 'account Microsoft') + ' · cartella «Apps/Ciclomulino»' : 'Non collegato. Senza OneDrive l\'app funziona lo stesso: i file restano sul tuo computer.';
  $('msClientRow').hidden = !!MS_CLIENT_ID || on; $('msClient').value = S.clientId;
  $('btnMsLogin').hidden = on; $('btnMsSync').hidden = !on; $('btnMsPush').hidden = !on; $('btnMsLogout').hidden = !on;
  $('chkAutoSync').checked = S.autoSync; $('chkAutoFit').checked = S.autoFit; $('btnMsLogin').disabled = false; void cid;
}
function applyPending() { if (busyRide()) return; if (A.pending) { const p = A.pending; A.pending = null; loadPlanText(p.plan, p.persist); } else rebuildPlan(); }
function planFromSync(text) {
  if (busyRide()) { A.pending = { plan: text, persist: true }; toast('Piano aggiornato: lo applico quando esci dalla seduta'); return; }
  loadPlanText(text, true); showCoach('Piano aggiornato dalla cartella.', 'good');
}
function workoutsFromSync(items) {
  A.cloudSessions = [];
  for (const it of items) { try { const o = JSON.parse(it.text); if (Array.isArray(o.sessions)) A.cloudSessions.push(...o.sessions); else if (Array.isArray(o.blocks)) A.cloudSessions.push({ id: o.id || 'ws-' + it.name, title: o.title || it.name.replace(/\.json$/i, ''), ...o }); } catch { /* file non valido: lo salto */ } }
  rebuildPlan();
}
function makeCloud() {
  A.od = new OneDrive({ clientId: clientId(), redirectUri: location.origin + location.pathname, storage: localStorage, session: sessionStorage });
  A.cloud = new CloudSync(A.od, { storage: localStorage, status: t => { $('cloudStatus').textContent = t; },
    onPlan: planFromSync, onWorkouts: workoutsFromSync });
}
async function msLogin() {
  S.clientId = ($('msClient').value || S.clientId || '').trim(); saveS(); makeCloud();
  try { location.assign(await A.od.loginUrl()); } catch (e) { toast(e.message); }
}
async function syncNow(manual) {
  if (A.folderSync) { try { await A.folderSync.pull(manual); if (manual) toast('Cartella: controllata'); } catch (e) { $('folderStatus').textContent = 'Cartella: ' + e.message; if (manual) toast('Cartella: ' + e.message); } }
  if (!A.od || !A.od.signedIn) return;
  try { await A.cloud.flushQueue(); const r = await A.cloud.pull(manual); if (manual) toast(r.plan || r.workouts ? 'OneDrive: aggiornato' : 'OneDrive: nessuna novità'); }
  catch (e) { $('cloudStatus').textContent = 'OneDrive: ' + e.message; if (manual) toast('OneDrive: ' + e.message); if (e.status === 401 || /Microsoft:/.test(e.message)) cloudUi(); }
}
$('btnMsLogin').onclick = msLogin;
$('btnMsSync').onclick = () => syncNow(true);
$('btnMsPush').onclick = async () => { if (!A.rawPlan) { toast('Nessun piano caricato'); return; } try { await A.cloud.pushPlan(A.rawPlan); toast('Piano caricato su OneDrive'); } catch (e) { toast('OneDrive: ' + e.message); } };
$('btnMsLogout').onclick = () => { A.od.logout(); S.cloud = false; saveS(); cloudUi(); toast('Scollegato da OneDrive'); };
$('chkAutoSync').onchange = e => { S.autoSync = e.target.checked; saveS(); }; $('chkAutoFit').onchange = e => { S.autoFit = e.target.checked; saveS(); };
$('msClient').onchange = e => { S.clientId = e.target.value.trim(); saveS(); };
async function cloudStart() {
  makeCloud();
  let res = null; try { res = await A.od.handleRedirect(location.href); } catch (e) { res = 'errore:' + e.message; }
  if (res) history.replaceState(null, '', location.pathname);
  if (res === 'ok') { S.cloud = true; S.planMode = 'onedrive'; saveS(); toast('Collegato a OneDrive'); }
  else if (res) toast('Accesso Microsoft: ' + res.replace(/^errore:/, ''));
  cloudUi();
  { syncNow(false); setInterval(() => { if (S.autoSync && !document.hidden) syncNow(false); }, 10 * 60 * 1000); document.addEventListener('visibilitychange', () => { if (!document.hidden && S.autoSync) syncNow(false); }); }
}

/* ---------- cartella dati sul PC (OneDrive «Open Trainer») ---------- */
function folderUi() {
  const st = $('folderStatus'); if (!st) return;
  const sup = folderSupported(), on = !!A.folderSync, has = !!A.folderHandle;
  st.textContent = !sup ? 'Il tuo browser non permette di scegliere una cartella: usa Edge o Chrome.' : on ? '✓ Cartella collegata: «' + A.folderHandle.name + '»' : has ? 'Cartella «' + A.folderHandle.name + '» da riautorizzare (basta un click).' : 'Nessuna cartella scelta. Scegli «Open Trainer» dentro il tuo OneDrive.';
  $('btnFolderPick').hidden = !sup || on || has; $('btnFolderRe').hidden = !(has && !on); $('btnFolderSync').hidden = !on; $('btnFolderOff').hidden = !has && !on;
}
async function folderAttach(h, ask) {
  A.folderHandle = h;
  if (!(await folderPermission(h, ask))) { A.folderSync = null; folderUi(); return false; }
  A.folderSync = new FolderSync(h, { storage: localStorage, status: t => { const st = $('folderStatus'); if (st) st.textContent = t; }, onPlan: planFromSync, onWorkouts: workoutsFromSync });
  S.folder = true; saveS(); folderUi();
  try { await A.folderSync.pull(true); } catch (e) { toast('Cartella: ' + e.message); }
  return true;
}
async function folderPick() { try { await folderAttach(await pickFolder(), true); } catch (e) { if (e.name !== 'AbortError') toast('Cartella: ' + e.message); } }
async function folderStart() { if (!folderSupported() || !S.folder) { folderUi(); return; } const h = await savedFolder(); if (h) await folderAttach(h, false); folderUi(); }
$('btnFolderPick').onclick = folderPick; $('btnFolderRe').onclick = () => folderAttach(A.folderHandle, true);
$('btnFolderSync').onclick = () => syncNow(true);
$('btnFolderOff').onclick = async () => { await forgetFolder(); A.folderHandle = null; A.folderSync = null; S.folder = false; saveS(); folderUi(); toast('Cartella scollegata'); };

/* ---------- workout tuoi (creatore) ---------- */
function persistMine() { store.set('ciclomulino.mine', JSON.stringify(A.mine)); }
function saveWorkout(raw) {
  const i = A.mine.findIndex(w => w.id === raw.id); if (i >= 0) A.mine[i] = raw; else A.mine.push(raw); persistMine();
  sendOut('wk', o => o.pushWorkout && o.pushWorkout(raw.id + '.json', JSON.stringify(raw, null, 1)));
  A.cloudSessions = A.cloudSessions.filter(s => s.id !== raw.id); rebuildPlan(); toast('Workout salvato: ' + raw.title);
}
function deleteWorkout(id) {
  A.mine = A.mine.filter(w => w.id !== id); A.cloudSessions = A.cloudSessions.filter(s => s.id !== id); persistMine();
  sendOut('rm', o => o.removeWorkout && o.removeWorkout(id + '.json')); rebuildPlan(); toast('Workout eliminato');
}

/* ---------- impostazioni applicate al gioco ---------- */
let w3 = null, styleApplied = '', qualityApplied = 0;
/** stile grafico: 3D (WebGL) oppure Pixel 2D; se il 3D non è disponibile ripiega sul 2D */
function applyStyle() {
  if (!w3) return; const want = ['voxel', 'ps1', 'iso', 'hd2d'].includes(S.style) ? S.style : 'voxel', use3d = w3.ok;
  if (!w3.ok && !A.no3dNote) { A.no3dNote = true; toast('Il 3D non è disponibile in questo browser: uso il Pixel 2D'); }
  if (use3d) { if (styleApplied !== want) { w3.setStyle(want); styleApplied = want; } if (qualityApplied !== S.quality) { w3.setQuality(S.quality); qualityApplied = S.quality; } w3.setOn(true); $('scene').hidden = true; }
  else { w3.setOn(false); $('scene').hidden = false; styleApplied = ''; }
}
function applySettings() {
  const V = G.V, b = S.bikeColor; V.kit = { ...S.kit };
  V.bikeC = (b.frame || b.accent || b.deep >= 0) ? { ...(b.frame ? { frame: b.frame } : {}), ...(b.accent ? { accent: b.accent } : {}), ...(b.deep >= 0 ? { deep: b.deep } : {}) } : null;
  const bk = G.setBike(S.bike); $('bikeName').textContent = bk.name; $('bikeSel').value = bk.id; store.set('ciclomulino.bike', bk.id);
  if ((V.traffic !== S.traffic || V.hazards !== S.hazards) && w3 && w3.ok) w3.clearWorld();
  V.traffic = S.traffic; V.hazards = S.hazards; V.gestures = S.gestures;
  Au.setOn(S.sound); Au.setVolume(S.vol); Au.AUDIO.ambient = S.ambient; $('vol').value = S.vol; $('btnSound').textContent = S.sound ? '🔊 SUONI: ON' : '🔇 SUONI: OFF';
  G.setQuality(S.quality); applyStyle(); if (A.session) A.session.cfg.autoPauseSec = S.autoPause ? 5 : 1e9;
  $('fpsBadge').hidden = !S.showFps;
}

/* ---------- avvio di una seduta dalle schermate ---------- */
async function launch(kind) {
  Au.unlock();
  if (kind !== 'keys' && !(A.trainer && A.trainer.connected)) { toast('Collega il trainer o attiva il simulatore'); return; }
  if (A.mode === 'keys') stopKeys(true);
  A.mode = 'plan'; A.watcher = null; A.testRes = null; A.simGrade = null; G.V.auto = true; $('btnKeys').classList.remove('sel');
  if (kind === 'keys') { if (!(await startKeys())) return; A.afterDone = 'home'; scr.show('ride'); $('btnHome').hidden = false; return; }
  if (kind === 'plan') {
    const idx = A.plan ? A.plan.sessions.findIndex(s => s.id === S.lastPick.sessId) : -1; if (idx < 0) { toast('Scegli una seduta'); return; }
    A.ftp = A.plan.ftp; selectSession(idx, true);
  } else {
    A.ftp = refFtp(); let raw;
    if (kind === 'free') { A.mode = 'free'; A.freeTarget = round5(A.ftp * 0.45); raw = { id: 'libera', title: 'Pedalata libera', type: 'Pedalata libera', free: true, notes: 'Pedala quanto vuoi.', blocks: [{ t: 'interval', n: 'Pedalata libera', d: 86400, lo: 100, hi: 110 }] }; }
    else { A.mode = 'test'; raw = kind === 'ramp' ? rampPlan(A.ftp) : ftp20Plan(A.ftp); if (kind === 'ramp') A.watcher = new RampWatcher(); }
    const r = parsePlan({ ftp: A.ftp, sessions: [raw] }), p = r.sessions[0];
    setSession(newSession(p, A.ftp, { noErg: true }), p); syncTrainerFtp();
  }
  A.session.start(); keepAwake(true); G.V.dist = A.startDist; G.V.lat = 0; scr.show('ride'); applySettings();
  showCoach(A.mode === 'test' ? (kind === 'ramp' ? 'Ramp test: pedala fino al limite, io alzo il carico ogni minuto.' : 'Test 20 minuti: ↑/↓ cambiano i watt di 5.') : A.mode === 'free' ? 'Pedalata libera: il trainer segue la pendenza.' : 'Si parte!', 'info');
}
function leaveRide() {
  if (A.mode === 'keys') stopKeys(true);
  A.mode = 'plan'; A.watcher = null; keepAwake(false); scr.show('home'); applyPending();
}
function exitToHome() {
  const s = A.session; if (s && s.started && !s.done) { if (!confirm('Uscire? La seduta viene terminata e potrai scaricare il .FIT.')) return; s.finish('stopped'); return; }
  leaveRide();
}

/* ---------- configurazione iniziale e tutorial ---------- */
const menuOpen = o => { $('menu').hidden = !o; $('btnMenu').setAttribute('aria-expanded', String(o)); };
function startTutorial() {
  menuOpen(false); scr && scr.park(); document.body.dataset.screen = 'tut';
  const T = [
    { title: 'Il gioco in 1 minuto', text: 'La strada è al centro, i numeri ti stanno intorno. Ti mostro i pezzi uno alla volta: con AVANTI proseguire, con ESCI chiudi.' },
    { sel: '.stats.left', title: 'I tuoi watt', text: 'Watt in grande, <b>colorati per zona</b>: grigio facile, blu, verde, giallo, arancio, rosso, viola al massimo. Sotto: media degli ultimi 3", media dello step e % della tua FTP.' },
    { sel: '.stats.right', title: 'Cadenza, FC, velocità', text: 'Cadenza (rpm), frequenza cardiaca, km/h, pendenza e <b>carico ERG</b>: se pedali sotto 60 rpm per 5" il carico scende al 50%, sopra 75 rpm per 3" torna al 100%.' },
    { sel: '#ribbon', title: 'La barra dell\'allenamento', text: 'Ogni colonna è uno step: altezza = watt, colore = zona. La linea bianca sei tu. Si vede quando hai caricato un piano.' },
    { sel: '.stepbar', title: 'Lo step in corso', text: 'Nome, tempo rimasto, serie e blocchi che mancano e il prossimo step. Un beep suona al cambio e negli ultimi 3 secondi.' },
    { sel: '.side', title: 'Altimetria e percorso', text: 'A sinistra il profilo del percorso (colore = pendenza), a destra la mappa con il tuo punto e i paesi.' },
    { sel: '#btnTrainer', title: 'Collega il trainer', text: 'Il Suito-T si collega col Bluetooth (serve Edge o Chrome). Se si scollega l\'allenamento va in pausa da solo.' },
    { sel: '#btnHr', title: 'Frequenza cardiaca', text: 'L\'orologio in modalità broadcast o una fascia cardio compaiono nell\'elenco.' },
    { sel: '#btnMenu', title: 'Il menu', text: 'Qui trovi piano, percorsi, simulatore, bici, suoni, OneDrive e questo tutorial. Scorciatoia: tasto <b>M</b>.' },
    { sel: '#planBox', before: () => menuOpen(true), title: 'Il piano', text: 'Trascina <i>piano-app.json</i> ovunque nell\'app, oppure usa il pulsante. Se hai più sedute, scegli dall\'elenco: quella di oggi è già selezionata.' },
    { sel: '#routeSel', before: () => menuOpen(true), title: 'Percorsi reali', text: 'Scegli un percorso della provincia di Brescia o importa un file GPX/TCX da Garmin Connect: pendenze e curve diventano quelle vere.' },
    { sel: '#btnSim', before: () => menuOpen(true), title: 'Simulatore', text: 'Fa finta di essere trainer e cardio: perfetto per provare tutto senza pedalare. Puoi anche simulare fatica e perdita di segnale.' },
    { sel: '#btnKeys', before: () => menuOpen(true), title: 'Modalità tastiera', text: 'Una modalità gioco: ↑ pedala, ← → sterza, Spazio salta le buche e i lavori in corso.' },
    { sel: '#cloudBox', before: () => menuOpen(true), title: 'OneDrive (facoltativo)', text: 'Se vuoi, il piano arriva da OneDrive e i .FIT ci vengono salvati da soli. L\'app vede solo la sua cartella «Apps/Ciclomulino».' },
    { sel: '#btnGo', before: () => menuOpen(false), title: 'Avvia, pausa, auto-pausa', text: 'Avvia la seduta (o Spazio). Se ti fermi sui pedali per 5" va in pausa da sola e riparte appena pedali.' },
    { sel: '#btnCam', before: () => menuOpen(false), title: 'Vista', text: 'Cambia tra vista da dietro e prima persona (tasto <b>V</b>). <b>F</b> schermo intero, <b>N</b> suoni.' },
    { title: 'Non perdi niente', text: 'La seduta si salva ogni 5": se il browser si chiude ti propone di riprendere o di scaricare il .FIT. A fine seduta scarichi il file da importare su Garmin Connect.' }
  ];
  runTutorial(T, { onEnd: () => { menuOpen(false); document.body.dataset.screen = A.screen; S.tutorialDone = true; saveS(); } });
}
function openWizard() {
  runWizard({ S, save: saveS, bikes: G.BIKES.map(b => ({ id: b.id, name: b.name })), msReady: !!MS_CLIENT_ID,
    actions: { loginMs: async () => { S.clientId = (document.getElementById('wzCid') ? document.getElementById('wzCid').value.trim() : S.clientId); saveS(); await msLogin(); },
      simulator: () => { if (!A.sim) toggleSim(); }, testSound: () => { Au.unlock(); Au.horn(0, 1); setTimeout(() => Au.chirp(0), 900); },
      setBike, setSound: on => { S.sound = on; Au.setOn(on); $('btnSound').textContent = on ? '🔊 SUONI: ON' : '🔇 SUONI: OFF'; }, startTutorial, applyNow: () => applySettings(), onClose: () => { applySettings(); } } });
}
$('btnTut').onclick = () => startTutorial(); $('btnWiz').onclick = () => { S.wizStep = 0; menuOpen(false); openWizard(); };

G.initCanvas();
w3 = new World3D($('scene3d')); w3.onFail = () => toast('Il 3D ha avuto un problema: passo al Pixel 2D'); G.setRenderer3D(w3); addEventListener('resize', () => { if (w3.active()) w3.resize(); });
loadRoutes();
// sito installabile e utilizzabile offline (solo su https o localhost)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { /* senza SW l'app funziona lo stesso */ });
setBike(store.get('ciclomulino.bike') || S.bike || 'propel');
$('bikeSel').innerHTML = G.BIKES.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join(''); $('bikeSel').value = G.BIKES[G.V.bike].id;
loadMine();
{ const saved = store.get('ciclomulino.plan'); if (saved) loadPlanText(saved, false); else rebuildPlan(); }
if (!A.plan) logEv('Carica piano-app.json per iniziare');
if (!bleAvailable()) logEv('Web Bluetooth assente: usa Edge/Chrome. Il simulatore funziona comunque.');
checkRecovery();
const api = {
  A, S, saveS, toast, applySettings, startTutorial, openWizard, ftp: refFtp, planFtp, ftpSource,
  onScreen: n => { A.screen = n; document.body.dataset.screen = n; },
  bikes: () => G.BIKES.map(b => ({ id: b.id, name: b.name })), patterns: () => G.PATTERNS, emblems: () => G.EMBLEMS, previewRider: c => G.previewRider(c),
  routes: () => A.routes, currentRoute: () => (A.route ? A.route.id : 'auto'), applyRoute: id => applyRoute(id, true),
  places: () => { if (!A.route) return []; const seen = new Set(); return A.route.places.filter(p => !seen.has(p.n) && seen.add(p.n)); },
  setStart: d => { A.startDist = d; G.V.dist = d; },
  sessions: () => (A.plan ? A.plan.sessions.map(s => ({ id: s.id, title: s.title, notes: s.notes, steps: s.steps.length, total: s.total, date: s.date, time: s.time, mine: A.mine.some(w => w.id === s.id) })) : []),
  defaultSessionIndex: () => (A.plan ? Math.max(0, pickSession(A.plan.sessions, localISODate())) : 0),
  chooseSession: id => { const i = A.plan ? A.plan.sessions.findIndex(s => s.id === id) : -1; if (i >= 0 && i !== A.sessIdx) selectSession(i, true); },
  loadPlanFile: async f => { loadPlanText(await f.text()); },
  testInfo: kind => { const f = refFtp(), p = kind === 'ramp' ? rampPlan(f) : ftp20Plan(f); return { text: kind === 'ramp' ? `Parti a ${p.test.start} W e sali di ${p.test.step} W ogni minuto, fino a quando non riesci più a tenere i watt (o premi «Termina»). FTP = 75% del miglior minuto.` : 'Riscaldamento con tre spunti, poi 20 minuti al massimo che riesci a tenere. Con ↑/↓ cambi i watt di 5 alla volta. FTP = 95% della potenza media.' }; },
  devices: () => ({ trainer: { connected: !!(A.trainer && A.trainer.connected), name: A.trainer && A.trainer.name }, hr: { connected: !!(A.hrDev && A.hrDev.connected), name: A.hrDev && A.hrDev.name }, sim: A.sim, ble: bleAvailable() }),
  connectTrainer, connectHr, toggleSim, launch,
  myWorkouts: () => A.mine.map(w => { const r = parsePlan({ ftp: refFtp(), sessions: [w] }).sessions[0]; return { id: w.id, title: w.title, steps: r ? r.steps.length : 0, total: r ? r.total : 0 }; }),
  getWorkout: id => A.mine.find(w => w.id === id), saveWorkout, deleteWorkout, drawPreview,
  exportWorkout: raw => download(raw.title.replace(/[^\w\- ]+/g, '_') + '.json', JSON.stringify(raw, null, 1), 'application/json'),
  history: () => loadHistory(shim), summary: d => summary(loadHistory(shim), d),
  exportCsv: () => { const rows = loadHistory(shim); const head = 'data;seduta;durata_s;km;w_medi;np;w_kg;kj;fc_media\n'; download('open-trainer-storico.csv', head + rows.map(r => [new Date(r.when).toISOString().slice(0, 16).replace('T', ' '), '"' + r.title.replace(/"/g, '""') + '"', r.durS, r.km, r.avgP, r.np, r.wkg ?? '', r.kj, r.hr].join(';')).join('\n'), 'text/csv'); },
  exportSettings: () => download('open-trainer-impostazioni.json', JSON.stringify({ ...S, clientId: '' }, null, 1), 'application/json'),
  importSettings: async f => { try { const o = JSON.parse(await f.text()); Object.assign(S, o, { clientId: o.clientId || S.clientId, kit: { ...S.kit, ...(o.kit || {}) }, bikeColor: { ...S.bikeColor, ...(o.bikeColor || {}) }, lastPick: { ...S.lastPick, ...(o.lastPick || {}) } }); saveS(); applySettings(); toast('Impostazioni importate'); } catch (e) { toast('File non valido: ' + e.message); } },
  wipe: () => { if (confirm('Cancellare impostazioni, storico, workout e piano salvati su questo computer? (I file nella cartella OneDrive non vengono toccati)')) { for (const k of Object.keys(localStorage)) if (k.startsWith('ciclomulino.')) localStorage.removeItem(k); location.reload(); } },
  testSound: () => { Au.unlock(); Au.horn(0, 1); setTimeout(() => Au.chirp(0), 900); },
  cloudUi, folderUi
};
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
scr = createScreens(api); scr.show('home');
applySettings();
ui();
requestAnimationFrame(frame);
Au.setOn(S.sound); Au.setVolume(S.vol); $('vol').value = S.vol; $('btnSound').textContent = S.sound ? '🔊 SUONI: ON' : '🔇 SUONI: OFF';
cloudStart().then(async () => { await folderStart(); if (!S.setupDone && $('recover').hidden) openWizard(); });
let devSig = ''; setInterval(() => { if (scr && scr.cur === 'connect') { const sg = JSON.stringify(api.devices()); if (sg !== devSig) { devSig = sg; scr.refreshConnect(); } } else devSig = ''; }, 800);
