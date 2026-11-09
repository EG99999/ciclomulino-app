import test from 'node:test'; import assert from 'node:assert/strict';
import { OneDrive, CloudSync, pkceChallenge, randomString, SCOPES } from '../js/onedrive.js';

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
/** finto Microsoft + Graph: endpoint dei token e cartella dell'app in memoria */
function fake() {
  const files = new Map(); let etag = 1, tokens = 0, down = false, expireNext = false; const log = [];
  const json = (status, body) => ({ ok: status < 300, status, statusText: '', json: async () => body, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
  const fetchFn = async (url, opts = {}) => {
    log.push((opts.method || 'GET') + ' ' + url.replace('https://graph.microsoft.com/v1.0', ''));
    if (url.includes('/oauth2/v2.0/token')) { tokens++; return json(200, { access_token: 'A' + tokens, refresh_token: 'R' + tokens, expires_in: 3600 }); }
    if (down) throw new Error('rete assente');
    const auth = opts.headers && opts.headers.Authorization;
    if (expireNext) { expireNext = false; return json(401, { error: { message: 'token scaduto' } }); }
    assert.ok(/^Bearer A\d+$/.test(auth), 'manca il token');
    if (url.endsWith('/me?$select=displayName,userPrincipalName')) return json(200, { displayName: 'Elia' });
    const m = url.match(/approot:\/(.+?)(:\/content|:\/children.*)?$/); const path = m && decodeURIComponent(m[1]);
    if (opts.method === 'PUT') { files.set(path, { data: opts.body, etag: 'e' + ++etag }); return json(201, { name: path }); }
    if (m && m[2] === ':/content') { const f = files.get(path); return f ? json(200, f.data) : json(404, { error: { message: 'no' } }); }
    if (m && m[2] && m[2].startsWith(':/children')) { const list = [...files].filter(([k]) => k.startsWith(path + '/')).map(([k, v]) => ({ name: k.slice(path.length + 1), eTag: v.etag, size: 1 })); return list.length ? json(200, { value: list }) : json(404, {}); }
    if (m) { const f = files.get(path); return f ? json(200, { name: path, eTag: f.etag }) : json(404, {}); }
    return json(404, {});
  };
  return { fetchFn, files, log, setDown: v => { down = v; }, expireNext: () => { expireNext = true; } };
}
const setup = async () => { const f = fake(), st = mem(), now = { t: 1_000_000 }; const od = new OneDrive({ clientId: 'CID', redirectUri: 'http://localhost:8080/', storage: st, session: mem(), fetchFn: f.fetchFn, now: () => now.t }); return { f, st, od, now }; };
async function login(od) { const url = new URL(await od.loginUrl()); const state = url.searchParams.get('state'); return od.handleRedirect(`http://localhost:8080/?code=XYZ&state=${state}`); }

test('PKCE: la sfida è lo SHA-256 del verifier in base64url (vettore ufficiale RFC 7636)', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.ok(randomString(64).length === 64);
});
test('indirizzo di login: scope minimi (solo cartella app), S256, nessun segreto', async () => {
  const { od } = await setup(); const u = new URL(await od.loginUrl());
  assert.equal(u.origin + u.pathname, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  assert.equal(u.searchParams.get('scope'), SCOPES); assert.ok(SCOPES.includes('Files.ReadWrite.AppFolder')); assert.ok(!/Files\.ReadWrite(\s|$)/.test(SCOPES));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256'); assert.equal(u.searchParams.get('client_id'), 'CID'); assert.ok(!u.search.includes('client_secret'));
});
test('senza Client ID l accesso dà un errore chiaro', async () => { const od = new OneDrive({ clientId: '', redirectUri: 'x', storage: mem(), fetchFn: async () => { } }); await assert.rejects(od.loginUrl(), /Client ID/); });
test('ritorno dal login: scambio del codice, nome account, token salvato', async () => {
  const { od, st } = await setup(); assert.equal(await login(od), 'ok'); assert.ok(od.signedIn); assert.equal(od.account, 'Elia');
  assert.ok(JSON.parse(st.getItem('ciclomulino.ms')).refresh);
});
test('state diverso o errore Microsoft → rifiutato', async () => {
  const { od } = await setup(); await od.loginUrl();
  assert.match(await od.handleRedirect('http://localhost:8080/?code=1&state=FALSO'), /errore:.*state/);
  assert.match(await od.handleRedirect('http://localhost:8080/?error=access_denied&error_description=No'), /errore:No/);
  assert.equal(await od.handleRedirect('http://localhost:8080/'), null);
});
test('token scaduto → rinnovato da solo; 401 → un nuovo tentativo', async () => {
  const { od, f, now } = await setup(); await login(od);
  now.t += 4000 * 1000; await od.meta('piano-app.json'); assert.ok(f.log.filter(l => l.includes('/token')).length >= 2, 'rinnovo del token');
  f.expireNext(); await od.meta('piano-app.json');
});
test('sincronizzazione: scarica il piano solo se cambia, legge i workout', async () => {
  const { od, f, st } = await setup(); await login(od); const plans = [], works = [];
  const cs = new CloudSync(od, { storage: st, onPlan: t => plans.push(t), onWorkouts: w => works.push(w) });
  assert.deepEqual(await cs.pull(), { plan: false, workouts: 0 });
  f.files.set('piano-app.json', { data: '{"v":1}', etag: 'a' }); f.files.set('workouts/mio.json', { data: '{"x":1}', etag: 'b' });
  assert.deepEqual(await cs.pull(), { plan: true, workouts: 1 }); assert.deepEqual(plans, ['{"v":1}']); assert.equal(works[0][0].name, 'mio.json');
  assert.deepEqual(await cs.pull(), { plan: false, workouts: 0 }, 'nessuna novità: non riscarica');
  f.files.set('piano-app.json', { data: '{"v":2}', etag: 'c' }); assert.equal((await cs.pull()).plan, true); assert.equal(plans.at(-1), '{"v":2}');
});
test('.FIT in uscita: carica; senza rete lo mette in coda e lo carica dopo', async () => {
  const { od, f, st } = await setup(); await login(od); const cs = new CloudSync(od, { storage: st, onPlan() { }, onWorkouts() { } });
  const bytes = Uint8Array.from([1, 2, 3, 250]);
  f.setDown(true); assert.equal(await cs.pushFit('a.fit', bytes), false); assert.equal(JSON.parse(st.getItem('ciclomulino.cloudq')).length, 1);
  f.setDown(false); assert.equal(await cs.flushQueue(), 1); assert.ok(f.files.has('fit/a.fit')); assert.deepEqual([...f.files.get('fit/a.fit').data], [1, 2, 3, 250]);
  assert.equal(JSON.parse(st.getItem('ciclomulino.cloudq')).length, 0);
  assert.equal(await cs.pushFit('b.fit', bytes), true);
});
test('.FIT grande (300 KB) senza rete: va in coda senza errori e si ricarica identico', async () => {
  const { od, f, st } = await setup(); await login(od); const cs = new CloudSync(od, { storage: st, onPlan() { }, onWorkouts() { } });
  const big = new Uint8Array(300000); for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 255;
  f.setDown(true); assert.equal(await cs.pushFit('big.fit', big), false);
  f.setDown(false); assert.equal(await cs.flushQueue(), 1); const got = f.files.get('fit/big.fit').data; assert.equal(got.length, big.length); assert.ok(got.every((v, i) => v === big[i]));
});
test('login: il codice di ritorno scade dopo 10 minuti e la descrizione errore è solo testo semplice', async () => {
  const { od, now } = await setup(); const url = new URL(await od.loginUrl()), state = url.searchParams.get('state');
  now.t += 11 * 60 * 1000; assert.match(await od.handleRedirect(`http://localhost:8080/?code=1&state=${state}`), /errore:.*scaduto/);
  assert.match(await od.handleRedirect('http://localhost:8080/?error=x&error_description=' + encodeURIComponent('<img src=x onerror=1> chiama il 0000 https://evil.example')), /^errore:[^<>"\/]{0,100}$/);
});
test('uscita: token, coda dei .FIT e dati del login vengono cancellati', async () => {
  const { od, f, st } = await setup(); await login(od); const cs = new CloudSync(od, { storage: st, onPlan() { }, onWorkouts() { } });
  f.setDown(true); await cs.pushFit('a.fit', Uint8Array.from([1, 2, 3])); assert.equal(JSON.parse(st.getItem('ciclomulino.cloudq')).length, 1);
  od.logout(); assert.equal(st.getItem('ciclomulino.ms'), null); assert.equal(st.getItem('ciclomulino.cloudq'), null); assert.equal(st.getItem('ciclomulino.cloudetag'), null);
});
test('uscita: i token vengono cancellati', async () => { const { od, st } = await setup(); await login(od); od.logout(); assert.ok(!od.signedIn); assert.equal(st.getItem('ciclomulino.ms'), null); });
test('JSON sulla cartella dell\'app: scrive, rilegge, manca → null, testo rotto → null, troppo grande → errore', async () => {
  const { od, f, st } = await setup(); await login(od); const cs = new CloudSync(od, { storage: st, onPlan() { }, onWorkouts() { } });
  assert.equal(await cs.readJson('impostazioni.json'), null);
  await cs.writeJson('impostazioni.json', { v: 1, mod: 5, settings: { weight: 72 } }); assert.deepEqual(await cs.readJson('impostazioni.json'), { v: 1, mod: 5, settings: { weight: 72 } });
  f.files.set('rotto.json', { data: '{non json', etag: 'x' }); assert.equal(await cs.readJson('rotto.json'), null);
  const meta = od.meta.bind(od); od.meta = async p => ({ ...(await meta(p)), size: 9e6 }); await assert.rejects(cs.readJson('impostazioni.json'), /troppo grande/);
});
