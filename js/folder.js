// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Cartella dati sul PC (es. la cartella OneDrive «Open Trainer»), con la File System Access API di Edge/Chrome.
// L'utente la sceglie una volta; il client OneDrive del PC fa il resto. Nessun accesso a altre cartelle.
import { mergeHistory } from './history.js';
const DB = 'open-trainer', STORE = 'kv', KEYH = 'folder';
const MAX_PLAN = 2_000_000, MAX_WORKOUT = 500_000, MAX_WORKOUTS = 100, MAX_HISTORY = 1_000_000;      // limiti di lettura: un file enorme nella cartella non deve bloccare l'app a ogni sincronizzazione
export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

function idb() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function kv(mode, fn) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode), q = fn(t.objectStore(STORE)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); }
export async function pickFolder() { const h = await window.showDirectoryPicker({ id: 'open-trainer', mode: 'readwrite', startIn: 'documents' }); await kv('readwrite', s => s.put(h, KEYH)); return h; }
export async function savedFolder() { try { return (await kv('readonly', s => s.get(KEYH))) || null; } catch { return null; } }
export async function forgetFolder() { try { await kv('readwrite', s => s.delete(KEYH)); } catch { /* ignora */ } }
/** true se possiamo leggere/scrivere; con ask=true (dentro un click) chiede il permesso */
export async function folderPermission(h, ask = false) {
  const o = { mode: 'readwrite' };
  try { if ((await h.queryPermission(o)) === 'granted') return true; return ask ? (await h.requestPermission(o)) === 'granted' : false; } catch { return false; }
}

async function dirOf(h, parts, create) { let d = h; for (const p of parts) d = await d.getDirectoryHandle(p, { create }); return d; }
const split = path => { const a = path.split('/').filter(Boolean); return [a.slice(0, -1), a[a.length - 1]]; };
export async function readFile(h, path, max = 0) {
  const [dirs, name] = split(path);
  try {
    const d = await dirOf(h, dirs, false), f = await (await d.getFileHandle(name)).getFile();
    if (max && f.size > max) { const e = new Error(path + ' è troppo grande (max ' + Math.round(max / 1e5) / 10 + ' MB)'); e.tooBig = true; throw e; }      // si controlla PRIMA di leggerlo
    return { text: await f.text(), stamp: f.lastModified + ':' + f.size };
  }
  catch (e) { if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return null; throw e; }
}
export async function listFiles(h, dir, ext = '') {
  try { const d = await dirOf(h, dir.split('/').filter(Boolean), false), out = []; for await (const [name, fh] of d.entries()) if (fh.kind === 'file' && name.toLowerCase().endsWith(ext)) { const f = await fh.getFile(); out.push({ name, size: f.size, stamp: f.lastModified + ':' + f.size }); } return out; }
  catch (e) { if (e && e.name === 'NotFoundError') return []; throw e; }
}
export async function removeFile(h, path) { const [dirs, name] = split(path); try { const d = await dirOf(h, dirs, false); await d.removeEntry(name); return true; } catch (e) { if (e && e.name === 'NotFoundError') return false; throw e; } }
export async function writeFile(h, path, data) {
  const [dirs, name] = split(path), d = await dirOf(h, dirs, true), fh = await d.getFileHandle(name, { create: true }), w = await fh.createWritable();
  await w.write(data); await w.close();
}

/** Aggiunge testo in fondo a un file (lo crea se manca). fresh = ricomincia il file da capo. Serve al registratore di debug. */
export async function appendFile(h, path, text, fresh) {
  const [dirs, name] = split(path), d = await dirOf(h, dirs, true), fh = await d.getFileHandle(name, { create: true });
  let size = 0; if (!fresh) { try { size = (await fh.getFile()).size; } catch { size = 0; } }
  const w = await fh.createWritable({ keepExistingData: !fresh });
  try { if (!fresh) await w.seek(size); await w.write(text); await w.close(); } catch (e) { try { await w.abort(); } catch { /* ignora */ } throw e; }
}

/** nome di file sicuro (stesso criterio per scrivere e cancellare); «.» e «..» non sono nomi */
const safeName = n => { const s = String(n).replace(/[^\w.\- ]+/g, '_'); if (!s || /^\.+$/.test(s)) throw new Error('Nome di file non valido'); return s; };
/** tiene solo gli ultimi `keep` file di una cartella con nome che corrisponde a `re` (log di debug): cancella solo ciò che è nostro e più vecchio */
export async function pruneFiles(h, dir, re, keep) {
  const files = (await listFiles(h, dir)).filter(f => re.test(f.name)).sort((a, b) => (a.name < b.name ? 1 : -1)); let n = 0;
  for (const f of files.slice(keep)) { try { if (await removeFile(h, dir + '/' + f.name)) n++; } catch { /* ignora */ } }
  return n;
}

/** Stessa interfaccia di CloudSync: piano e workout IN, .FIT/storico/test OUT. */
export class FolderSync {
  constructor(handle, { storage, onPlan, onWorkouts, status = () => {} }) { Object.assign(this, { handle, storage, onPlan, onWorkouts, status }); }
  _st() { try { return JSON.parse(this.storage.getItem('ciclomulino.folderstamp') || '{}'); } catch { return {}; } }
  _set(k, v) { const s = this._st(); s[k] = v; try { this.storage.setItem('ciclomulino.folderstamp', JSON.stringify(s)); } catch { /* ignora */ } }
  async pull(force = false) {
    const out = { plan: false, workouts: 0 };
    let p = null, note = '';
    try { p = await readFile(this.handle, 'piano-app.json', MAX_PLAN); } catch (e) { if (!e.tooBig) throw e; note = 'Cartella: ' + e.message + ': lo ignoro'; this.status(note); }
    if (p && (force || this._st().plan !== p.stamp)) { this._set('plan', p.stamp); this.onPlan(p.text); out.plan = true; }
    const files = (await listFiles(this.handle, 'workouts', '.json')).filter(f => !(f.size > MAX_WORKOUT)).slice(0, MAX_WORKOUTS), sig = files.map(f => f.name + f.stamp).join('|');
    if (files.length && (force || this._st().workouts !== sig)) {
      const items = []; for (const f of files) { const r = await readFile(this.handle, 'workouts/' + f.name); if (r) items.push({ name: f.name, text: r.text }); }
      this._set('workouts', sig); this.onWorkouts(items); out.workouts = items.length;
    }
    this.status(note || (out.plan || out.workouts ? 'Cartella: aggiornata' : 'Cartella: già aggiornata')); return out;
  }
  async pushFit(name, bytes) { await writeFile(this.handle, 'fit/' + name, bytes); this.status('Cartella: .FIT salvato'); return true; }
  /** unisce lo storico locale con quello già nel file (altro PC): una seduta non cancella le altre */
  async pushHistory(json) {
    let out = json;
    try { const ex = await readFile(this.handle, 'storico.json', MAX_HISTORY); if (ex) out = JSON.stringify(mergeHistory(JSON.parse(json), JSON.parse(ex.text))); } catch { /* file illeggibile o troppo grande: si scrive lo storico locale */ }
    return writeFile(this.handle, 'storico.json', out);
  }
  pushFtp(json) { return writeFile(this.handle, 'ftp-test.json', json); }
  pushWorkout(name, text) { return writeFile(this.handle, 'workouts/' + safeName(name), text); }
  pushPlan(text) { return writeFile(this.handle, 'piano-app.json', text); }
  removeWorkout(name) { return removeFile(this.handle, 'workouts/' + safeName(name)); }
  flushQueue() { return Promise.resolve(0); }
}
