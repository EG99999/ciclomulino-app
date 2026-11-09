// Sincronizzazione con OneDrive tramite Microsoft Graph, SOLO nella cartella dedicata all'app
// («Apps/Ciclomulino» creata da Microsoft). Accesso OAuth2 con PKCE direttamente dal browser: nessun server nostro,
// nessun segreto nel codice (il Client ID di una app "Single-page" è pubblico per definizione).
export const SCOPES = 'Files.ReadWrite.AppFolder offline_access User.Read';
const AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const TOKEN_KEY = 'ciclomulino.ms', PKCE_KEY = 'ciclomulino.pkce', QUEUE_KEY = 'ciclomulino.cloudq', ETAG_KEY = 'ciclomulino.cloudetag';

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function randomString(n = 48) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a).slice(0, n); }
export async function pkceChallenge(verifier) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))); }
const encPath = p => p.split('/').map(encodeURIComponent).join('/');

function toB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s); }
export class OneDrive {
  /** storage: localStorage-like; session: sessionStorage-like; fetchFn: fetch */
  constructor({ clientId, redirectUri, storage, session, fetchFn = (...a) => fetch(...a), now = () => Date.now() }) {
    Object.assign(this, { clientId, redirectUri, storage, session: session || storage, fetchFn, now });
    this.tok = this._load();
  }
  _load() { try { return JSON.parse(this.storage.getItem(TOKEN_KEY) || 'null'); } catch { return null; } }
  _save() { try { this.tok ? this.storage.setItem(TOKEN_KEY, JSON.stringify(this.tok)) : this.storage.removeItem(TOKEN_KEY); } catch { /* spazio finito */ } }
  get signedIn() { return !!(this.tok && this.tok.refresh); }
  get account() { return this.tok && this.tok.account || ''; }

  /** costruisce l'indirizzo di login Microsoft e lo restituisce (la pagina poi ci va con location.assign) */
  async loginUrl() {
    if (!this.clientId) throw new Error('Manca il Client ID Microsoft (vedi GUIDA-ONEDRIVE.md)');
    const verifier = randomString(64), state = randomString(24);
    this.session.setItem(PKCE_KEY, JSON.stringify({ verifier, state, ts: this.now() }));
    const q = new URLSearchParams({ client_id: this.clientId, response_type: 'code', redirect_uri: this.redirectUri, response_mode: 'query', scope: SCOPES, state, code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256', prompt: 'select_account' });
    return `${AUTH}/authorize?${q}`;
  }
  /** da chiamare all'avvio: se l'indirizzo contiene ?code=… completa l'accesso. Ritorna 'ok' | 'errore:…' | null (nulla da fare) */
  async handleRedirect(href) {
    const u = new URL(href), code = u.searchParams.get('code'), err = u.searchParams.get('error');
    if (!code && !err) return null;
    let saved = null; try { saved = JSON.parse(this.session.getItem(PKCE_KEY) || 'null'); } catch { /* ignora */ }
    this.session.removeItem(PKCE_KEY);
    if (err) return 'errore:' + String(u.searchParams.get('error_description') || err).replace(/[^\p{L}\p{N} .,:;()_'-]/gu, '').slice(0, 100);   // solo testo semplice: l'indirizzo può essere stato confezionato da altri
    if (!saved || saved.state !== u.searchParams.get('state')) return 'errore:risposta di accesso non valida (state diverso)';
    if (saved.ts && this.now() - saved.ts > 600000) return 'errore:accesso scaduto (più di 10 minuti): riprova';
    await this._token({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: saved.verifier, scope: SCOPES });
    try { const me = await this.api('/me?$select=displayName,userPrincipalName'); this.tok.account = me.displayName || me.userPrincipalName || ''; this._save(); } catch { /* il nome è solo estetico */ }
    return 'ok';
  }
  async _token(body) {
    const r = await this.fetchFn(`${AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.clientId, ...body }).toString() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) { if (j.error === 'invalid_grant') { this.tok = null; this._save(); } throw new Error('Microsoft: ' + (j.error_description || j.error || r.status).toString().split('\r')[0].slice(0, 160)); }
    this.tok = { access: j.access_token, exp: this.now() + (j.expires_in - 60) * 1000, refresh: j.refresh_token || (this.tok && this.tok.refresh), account: this.tok && this.tok.account };
    this._save(); return this.tok.access;
  }
  async accessToken() {
    if (!this.signedIn) throw new Error('Non hai fatto l\'accesso a OneDrive');
    if (this.tok.access && this.now() < this.tok.exp) return this.tok.access;
    return this._token({ grant_type: 'refresh_token', refresh_token: this.tok.refresh, scope: SCOPES });
  }
  logout() { this.tok = null; this._save(); for (const k of [ETAG_KEY, QUEUE_KEY, PKCE_KEY]) { try { this.storage.removeItem(k); this.session.removeItem(k); } catch { /* ignora */ } } }

  /** chiamata a Graph (path relativo a /v1.0); riprova una volta se il token è scaduto */
  async api(path, { method = 'GET', body, headers = {}, raw = false, okStatuses = [] } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken();
      const r = await this.fetchFn(GRAPH + path, { method, body, headers: { Authorization: 'Bearer ' + token, ...headers } });
      if (r.status === 401 && attempt === 0) { this.tok.exp = 0; continue; }
      if (okStatuses.includes(r.status)) return null;
      if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error('OneDrive ' + r.status + ': ' + ((j.error && j.error.message) || r.statusText || '')); e.status = r.status; throw e; }
      return raw ? r : (r.status === 204 ? null : r.json());
    }
  }
  /* --- cartella dell'app --- */
  meta(path) { return this.api(`/me/drive/special/approot:/${encPath(path)}`, { okStatuses: [404] }); }
  async readText(path) { const r = await this.api(`/me/drive/special/approot:/${encPath(path)}:/content`, { raw: true }); return r.text(); }
  async list(folder) { const j = await this.api(`/me/drive/special/approot:/${encPath(folder)}:/children?$select=name,eTag,size,lastModifiedDateTime`, { okStatuses: [404] }); return j ? j.value : []; }
  write(path, data, contentType = 'application/octet-stream') {
    if (data && data.length > 4 * 1024 * 1024) throw new Error('File troppo grande per il caricamento semplice (>4 MB)');
    return this.api(`/me/drive/special/approot:/${encPath(path)}:/content`, { method: 'PUT', body: data, headers: { 'Content-Type': contentType } });
  }
}

/** Logica di sincronizzazione: piano IN, workout IN, .FIT OUT (con coda se sei offline). */
export class CloudSync {
  constructor(od, { storage, onPlan, onWorkouts, status = () => {} }) { Object.assign(this, { od, storage, onPlan, onWorkouts, status }); }
  _etags() { try { return JSON.parse(this.storage.getItem(ETAG_KEY) || '{}'); } catch { return {}; } }
  _setEtag(k, v) { const e = this._etags(); e[k] = v; try { this.storage.setItem(ETAG_KEY, JSON.stringify(e)); } catch { /* ignora */ } }
  /** scarica ciò che è cambiato; ritorna un riepilogo */
  async pull(force = false) {
    const out = { plan: false, workouts: 0 };
    this.status('Sincronizzo con OneDrive…');
    const m = await this.od.meta('piano-app.json');
    if (m) { if (force || this._etags().plan !== m.eTag) { const text = await this.od.readText('piano-app.json'); this._setEtag('plan', m.eTag); this.onPlan(text, m); out.plan = true; } }
    const files = (await this.od.list('workouts')).filter(f => /\.json$/i.test(f.name));
    if (files.length && (force || files.map(f => f.name + f.eTag).join('|') !== this._etags().workouts)) {
      const items = []; for (const f of files) { try { items.push({ name: f.name, text: await this.od.readText('workouts/' + f.name) }); } catch { /* file illeggibile: lo salto */ } }
      this._setEtag('workouts', files.map(f => f.name + f.eTag).join('|')); this.onWorkouts && this.onWorkouts(items); out.workouts = items.length;
    }
    this.status(out.plan || out.workouts ? 'OneDrive: aggiornato' : 'OneDrive: già aggiornato');
    return out;
  }
  _queue() { try { return JSON.parse(this.storage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
  _setQueue(q) { try { this.storage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* ignora */ } }
  /** carica un .FIT (Uint8Array); se non riesce lo mette in coda e riprova alla prossima sincronizzazione */
  async pushFit(name, bytes) {
    try { await this.od.write('fit/' + name, bytes, 'application/octet-stream'); this.status('OneDrive: .FIT caricato'); return true; }
    catch (e) { const q = this._queue(); if (!q.some(x => x.name === name)) q.push({ name, b64: toB64(bytes) }); this._setQueue(q.slice(-4)); this.status('OneDrive: caricamento rimandato (' + e.message + ')'); return false; }
  }
  async flushQueue() {
    const q = this._queue(), rest = [];
    for (const it of q) { try { await this.od.write('fit/' + it.name, Uint8Array.from(atob(it.b64), c => c.charCodeAt(0)), 'application/octet-stream'); } catch { rest.push(it); } }
    this._setQueue(rest); return q.length - rest.length;
  }
  /** salva sul cloud un workout creato/caricato in locale */
  pushWorkout(name, text) { return this.od.write('workouts/' + name.replace(/[^\w.\- ]+/g, '_'), text, 'application/json'); }
  pushPlan(text) { return this.od.write('piano-app.json', text, 'application/json'); }
  pushHistory(json) { return this.od.write('storico.json', json, 'application/json'); }
  pushFtp(json) { return this.od.write('ftp-test.json', json, 'application/json'); }
  removeWorkout(name) { return this.od.api(`/me/drive/special/approot:/workouts/${encodeURIComponent(name)}`, { method: 'DELETE', okStatuses: [404] }); }
}
