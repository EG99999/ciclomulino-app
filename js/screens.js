// Schermate di Open Trainer: home, scelta attività, collegamento, impostazioni, storico, creatore di workout.
import { drawLogo } from './logo.js';
import { TYPES, newStep, newRep, toSession, fromBlocks, totalSeconds, check } from './creator.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };
const getPath = (o, p) => p.split('.').reduce((a, k) => a && a[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[last] = v; };
export const KINDS = [
  ['plan', '📅', 'ALLENAMENTO DEL PIANO', 'Una seduta del tuo piano (o un tuo workout), con ERG.'],
  ['create', '🛠', 'CREA UN EVENTO', 'Costruisci un workout: step, ripetizioni, watt o % FTP.'],
  ['free', '🚴', 'PEDALATA LIBERA', 'Pedali e basta: il trainer segue la pendenza del percorso.'],
  ['ramp', '📈', 'TEST FTP · RAMP', 'La rampa: sali di un gradino al minuto fino al limite.'],
  ['ftp20', '⏱', 'TEST FTP · 20 MINUTI', 'Riscaldamento e 20 minuti a tutta, con watt regolabili.'],
  ['keys', '⌨', 'GIOCO CON LA TASTIERA', 'Niente trainer: guidi tu con le frecce.']
];

export function createScreens(api) {
  const root = $('scr'); let onResize = null; let cur = 'home', tab = 'profilo', selKind = null, edit = null;
  const park = () => { for (const [id, home] of [['cloudBox', 'cloudHome'], ['folderBox', 'folderHome']]) { const n = $(id), h = $(home); if (n && h && n.parentNode !== h) h.appendChild(n); } };

  function show(name, arg) {
    park(); if (onResize && name !== 'home') { removeEventListener('resize', onResize); onResize = null; } cur = name; document.body.dataset.screen = name; root.hidden = name === 'ride'; if (name === 'ride') { root.innerHTML = ''; api.onScreen && api.onScreen(name); return; }
    root.innerHTML = ''; views[name](arg); api.onScreen && api.onScreen(name);
  }
  const back = (to, label = '← INDIETRO') => `<button class="mc" data-go="${to}">${label}</button>`;
  const wire = () => root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));

  /* ---------------- HOME ---------------- */
  function home() {
    root.innerHTML = `<div class="home">
      <div class="logowrap"><canvas id="logoCv" aria-label="Open Trainer"></canvas><div class="splash">Pedala. Gioca. Migliora!</div></div>
      <div class="homeRow"><button class="mc big" id="hGo">VAI</button><button class="mc sq" id="hSet" title="Impostazioni" aria-label="Impostazioni">⚙</button></div>
      <div class="homeSub"><button class="mc small" data-go="history">STORICO</button><button class="mc small" id="hTut">TUTORIAL</button></div>
      <div class="ver">Open Trainer · versione di prova${api.S.name ? ' · ciao ' + esc(api.S.name) : ''}</div></div>`;
    const draw = () => { const cv = $('logoCv'); if (cv) drawLogo(cv, Math.min(14, Math.max(5, Math.floor(Math.min(innerWidth * 0.82, 880) / 44)))); };
    draw(); if (onResize) removeEventListener('resize', onResize); onResize = draw; addEventListener('resize', onResize);
    $('hGo').onclick = () => show('select'); $('hSet').onclick = () => show('settings'); $('hTut').onclick = () => api.startTutorial(); wire();
  }

  /* ---------------- SCELTA ---------------- */
  function select() {
    const P = api.S.lastPick; selKind = selKind || P.kind || 'plan';
    root.innerHTML = `<div class="panel wide"><h1>COSA PEDALIAMO?</h1><div class="split">
      <div class="kinds">${KINDS.map(k => `<button class="mc kind ${k[0] === selKind ? 'sel' : ''}" data-k="${k[0]}"><span>${k[1]}</span><b>${k[2]}</b><i>${k[3]}</i></button>`).join('')}</div>
      <div class="detail" id="selDetail"></div></div>
      <div class="nav">${back('home')}<span></span><button class="mc go" id="selNext">AVANTI → COLLEGA</button></div></div>`;
    root.querySelectorAll('.kind').forEach(b => b.onclick = () => { selKind = b.dataset.k; select(); });
    detail(); wire();
  }
  const routeOptions = (cur) => ['<option value="auto">Generato dal workout (pixel)</option>', ...api.routes().map(r => `<option value="${esc(r.id)}" ${r.id === cur ? 'selected' : ''}>${esc(r.name)} · ${(r.len / 1000).toFixed(0)} km · +${r.gain} m</option>`)].join('');
  function routeBlock(P) {
    const pl = api.places();
    return `<label class="f">Percorso<select id="rtSel">${routeOptions(api.currentRoute())}</select></label>
      <label class="f" id="stRow" ${pl.length ? '' : 'hidden'}>Partenza<select id="stSel">${pl.map(p => `<option value="${Number(p.d)}" ${+P.start === p.d ? 'selected' : ''}>${esc(p.n)} · km ${(p.d / 1000).toFixed(1)}</option>`).join('')}</select></label>`;
  }
  function bindRoute(P) {
    const rs = $('rtSel'); if (!rs) return;
    rs.onchange = async () => { P.start = 0; await api.applyRoute(rs.value); P.route = rs.value; api.saveS(); detail(); };
    const ss = $('stSel'); if (ss) ss.onchange = () => { P.start = +ss.value; api.setStart(+ss.value); api.saveS(); };
  }
  function detail() {
    const P = api.S.lastPick, box = $('selDetail'), ftp = api.ftp(), next = $('selNext'); P.kind = selKind; api.saveS();
    const nx = (label, fn, ok = true) => { next.hidden = false; next.textContent = label; next.disabled = !ok; next.onclick = fn; };
    if (selKind === 'plan') {
      const list = api.sessions();
      box.innerHTML = list.length ? `<h2>Scegli la seduta</h2><label class="f">Seduta<select id="plSel">${list.map(s => `<option value="${esc(s.id)}" ${s.id === P.sessId ? 'selected' : ''}>${esc((s.date ? s.date.slice(8) + '/' + s.date.slice(5, 7) + ' ' + (s.time || '') + ' · ' : '') + s.title + (s.mine ? ' ✎' : ''))}</option>`).join('')}</select></label>
        <div class="note" id="plNote"></div>${routeBlock(P)}<div class="rowb"><label class="mc small" for="plFile">📂 CARICA piano-app.json</label><input type="file" id="plFile" accept=".json" hidden></div>`
        : `<h2>Nessun piano caricato</h2><p>Trascina <b>piano-app.json</b> in questa pagina, oppure scegli il file. Se hai collegato la cartella dati, il piano viene letto da lì.</p><div class="rowb"><label class="mc" for="plFile">📂 CARICA piano-app.json</label><input type="file" id="plFile" accept=".json" hidden></div><p class="hint">Oppure crea tu un workout: «CREA UN EVENTO».</p>`;
      const sel = $('plSel'); const upd = () => { const s = list.find(x => x.id === sel.value); P.sessId = s ? s.id : ''; api.saveS(); $('plNote').textContent = s ? `${s.notes || 'Nessuna nota.'} · ${s.steps} step · ${fmt(s.total)}` : ''; if (s) api.chooseSession(s.id); };
      if (sel) { if (!list.some(x => x.id === P.sessId)) sel.selectedIndex = api.defaultSessionIndex(); sel.onchange = upd; upd(); }
      const f = $('plFile'); if (f) f.onchange = async e => { if (e.target.files[0]) { await api.loadPlanFile(e.target.files[0]); select(); } };
      bindRoute(P); nx('AVANTI → COLLEGA', () => show('connect'), !!list.length);
    } else if (selKind === 'create') {
      const mine = api.myWorkouts();
      box.innerHTML = `<h2>I tuoi workout</h2>${mine.length ? mine.map(w => `<div class="wk"><b>${esc(w.title)}</b><span>${w.steps} step · ${fmt(w.total)}</span><button class="mc small" data-edit="${esc(w.id)}">MODIFICA</button><button class="mc small" data-del="${esc(w.id)}">ELIMINA</button></div>`).join('') : '<p>Ancora nessun workout.</p>'}<button class="mc big2" id="newWk">+ NUOVO WORKOUT</button>`;
      $('newWk').onclick = () => show('creator', null);
      box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => show('creator', b.dataset.edit));
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (confirm('Eliminare questo workout?')) { api.deleteWorkout(b.dataset.del); select(); } });
      next.hidden = true;
    } else if (selKind === 'free') {
      box.innerHTML = `<h2>Pedalata libera</h2><p>Il trainer simula la pendenza del percorso (come in Zwift): in salita senti più resistenza, in discesa meno. Nessun obiettivo, nessun limite di tempo: premi «Termina» quando hai finito.</p>${routeBlock(P)}<p class="hint">Se il tuo trainer non accetta la modalità a pendenza, l'app passa a un carico fisso che regoli con ↑/↓.</p>`;
      bindRoute(P); nx('AVANTI → COLLEGA', () => show('connect'));
    } else if (selKind === 'ramp' || selKind === 'ftp20') {
      const info = api.testInfo(selKind);
      box.innerHTML = `<h2>${selKind === 'ramp' ? 'Ramp test' : 'Test FTP 20 minuti'}</h2><p>${info.text}</p><div class="note">FTP di riferimento: <b>${ftp} W</b> (${api.ftpSource()}).</div><p class="hint">Alla fine ti propongo di salvare la nuova FTP nelle impostazioni; il piano del coach non viene toccato.</p>`;
      nx('AVANTI → COLLEGA', () => show('connect'));
    } else {
      box.innerHTML = `<h2>Gioco con la tastiera</h2><p>↑ pedala, ↓ frena, ← → sterza, Spazio salta, P pausa, Esc esci. Schiva buche e lavori in corso. Non serve il trainer: usa il simulatore.</p>`;
      nx('GIOCA', () => api.launch('keys'));
    }
  }

  /* ---------------- COLLEGA ---------------- */
  function connect() {
    const d = api.devices(), kind = api.S.lastPick.kind, needs = kind !== 'keys', ok = !needs || d.trainer.connected;
    const row = (icon, name, st, btn, id) => `<div class="devrow ${st.connected ? 'ok' : ''}"><span class="ic">${icon}</span><div><b>${name}</b><i>${st.connected ? '✓ ' + esc(st.name || 'collegato') : 'non collegato'}</i></div>${btn ? `<button class="mc small" id="${id}">${st.connected ? 'SCOLLEGA' : 'COLLEGA'}</button>` : ''}</div>`;
    root.innerHTML = `<div class="panel"><h1>COLLEGA LE TUE COSE</h1>
      ${needs ? row('⚡', 'Trainer (Elite Suito-T)', d.trainer, !d.sim, 'cTr') + row('♥', 'Frequenza cardiaca (Fenix 7 broadcast / fascia)', d.hr, !d.sim, 'cHr') : '<p>Per il gioco con la tastiera non serve niente.</p>'}
      ${needs ? `<label class="opt"><input type="checkbox" id="cSim" ${d.sim ? 'checked' : ''}><span><b>Usa il simulatore</b><br>Trainer e cardio finti, per provare tutto senza pedalare.</span></label>` : ''}
      ${needs && !d.ble ? '<div class="note warn">Il Bluetooth non è disponibile in questo browser: usa Edge o Chrome. Puoi comunque provare col simulatore.</div>' : ''}
      <div class="nav">${back('select')}<span></span><button class="mc go big2" id="cGo" ${ok ? '' : 'disabled'}>PEDALA!</button></div></div>`;
    const tr = $('cTr'); if (tr) tr.onclick = async () => { await api.connectTrainer(); connect(); };
    const hr = $('cHr'); if (hr) hr.onclick = async () => { await api.connectHr(); connect(); };
    const sm = $('cSim'); if (sm) sm.onchange = async () => { await api.toggleSim(); connect(); };
    $('cGo').onclick = () => api.launch(kind); wire();
  }

  /* ---------------- IMPOSTAZIONI ---------------- */
  const TABS = [['profilo', 'PROFILO'], ['bici', 'BICI'], ['ciclista', 'CICLISTA'], ['gioco', 'GIOCO'], ['audio', 'AUDIO'], ['grafica', 'GRAFICA'], ['dati', 'DATI'], ['aiuto', 'AIUTO']];
  const fld = {
    num: (k, label, o = {}) => `<label class="f">${label}<input type="number" data-k="${k}" data-t="n" value="${esc(getPath(api.S, k) || '')}" ${o.min != null ? `min="${o.min}"` : ''} ${o.max != null ? `max="${o.max}"` : ''} step="${Number(o.step) || 1}" placeholder="${esc(o.ph || '')}">${o.hint ? `<i class="hint">${o.hint}</i>` : ''}</label>`,
    txt: (k, label, o = {}) => `<label class="f">${label}<input type="text" data-k="${k}" value="${esc(getPath(api.S, k))}" maxlength="${Number(o.max) || 30}" placeholder="${esc(o.ph || '')}"></label>`,
    col: (k, label) => `<label class="f row">${label}<input type="color" data-k="${k}" value="${esc(getPath(api.S, k) || '#ffffff')}"></label>`,
    chk: (k, label, hint) => `<label class="opt"><input type="checkbox" data-k="${k}" data-t="b" ${getPath(api.S, k) ? 'checked' : ''}><span><b>${label}</b>${hint ? '<br>' + hint : ''}</span></label>`,
    sel: (k, label, opts) => `<label class="f">${label}<select data-k="${k}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(getPath(api.S, k)) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`,
    rng: (k, label, min, max, step) => `<label class="f">${label} <b id="v_${k.replace('.', '_')}">${esc(getPath(api.S, k))}</b><input type="range" data-k="${k}" data-t="n" min="${min}" max="${max}" step="${step}" value="${esc(getPath(api.S, k))}"></label>`,
    sw: (k, label, vals) => `<div class="f">${label}<div class="swrow">${vals.map(v => `<button class="sw ${getPath(api.S, k) === v ? 'sel' : ''}" data-sw="${k}" data-v="${esc(v)}" style="background:${esc(v)}" aria-label="${esc(v)}"></button>`).join('')}</div></div>`
  };
  function settings() {
    park();
    const S = api.S, bikes = api.bikes(), brands = [...new Set(bikes.map(b => b.name.split(' ')[0]))];
    const cur = bikes.find(b => b.id === S.bike) || bikes[0], brand = cur.name.split(' ')[0];
    const bc = S.bikeColor;
    const body = {
      profilo: () => `<h2>Profilo</h2>${fld.txt('name', 'Nome', { ph: 'es. Elia', max: 24 })}${fld.num('weight', 'Peso (kg)', { min: 30, max: 200, step: 0.1, ph: 'es. 72', hint: 'Serve per i watt per chilo (W/kg).' })}${fld.num('height', 'Altezza (cm) — facoltativa', { min: 120, max: 230 })}${fld.num('hrMax', 'FC massima (bpm) — facoltativa', { min: 100, max: 230 })}
        <h2>FTP</h2><div class="note">Dal piano del coach: <b>${api.planFtp()} W</b>.</div>${fld.sel('ftpMode', 'Quale FTP usare per i test e il gioco libero', [['plan', 'Quella del piano del coach'], ['personal', 'La mia FTP personale (sotto)']])}${fld.num('ftp', 'La mia FTP personale (W)', { min: 50, max: 600, hint: 'Si aggiorna da sola quando salvi il risultato di un test.' })}
        <div class="note" id="wkgNote"></div>`,
      bici: () => `<h2>Bici</h2><div class="split2"><div>${fld.sel('__brand', 'Marca', brands.map(b => [b, b]))}${`<label class="f">Modello<select id="bkModel" data-k="bike">${bikes.filter(b => b.name.split(' ')[0] === brand).map(b => `<option value="${b.id}" ${b.id === S.bike ? 'selected' : ''}>${esc(b.name.slice(brand.length + 1))}</option>`).join('')}</select></label>`}
        ${fld.col('bikeColor.frame', 'Colore telaio')}${fld.col('bikeColor.accent', 'Colore dettagli e ruote')}${fld.sel('bikeColor.deep', 'Ruote', [[-1, 'Quelle originali'], [0, 'Profilo basso'], [1, 'Profilo alto'], [2, 'Lenticolare']])}
        <button class="mc small" data-act="bikeReset">COLORI ORIGINALI</button><p class="hint">Marche e modelli indicano solo la forma e i colori tipici della livrea: nessun logo ufficiale.</p></div>
        <div class="pv"><canvas id="pvRider" width="56" height="72"></canvas></div></div>`,
      ciclista: () => `<h2>Il tuo ciclista</h2><div class="split2"><div>${fld.col('kit.jersey', 'Maglia · colore principale')}${fld.col('kit.jersey2', 'Maglia · secondo colore')}${fld.sel('kit.pattern', 'Motivo', Object.entries(api.patterns()))}${fld.col('kit.shorts', 'Pantaloncini')}${fld.col('kit.helmet', 'Casco')}${fld.sw('kit.skin', 'Pelle', ['#f6d5b8', '#f0b890', '#c68b5b', '#8d5a3b', '#5a3a28'])}
        <h2>Logo</h2>${fld.sel('kit.emblem', 'Emblema', [['', 'Nessuno'], ...Object.keys(api.emblems()).map(k => [k, ({ bolt: 'Fulmine', star: 'Stella', heart: 'Cuore', mountain: 'Montagna', flame: 'Fiamma', wheel: 'Ruota', sun: 'Sole', crown: 'Corona' })[k] || k])])}${fld.col('kit.emblemColor', 'Colore emblema e scritta')}${fld.txt('kit.text', 'Scritta (max 3 caratteri)', { max: 3, ph: 'es. ELI' })}
        <div class="rowb"><label class="mc small" for="imgIn">📷 LA TUA IMMAGINE</label><input type="file" id="imgIn" accept="image/*" hidden><button class="mc small" data-act="imgDel">TOGLI IMMAGINE</button></div><p class="hint">L'immagine viene ridotta a 10×10 pixel e resta solo sul tuo computer.${S.kit.img ? ' (caricata)' : ''}</p></div>
        <div class="pv"><canvas id="pvRider" width="56" height="72"></canvas></div></div>`,
      gioco: () => `<h2>Gioco</h2>${fld.chk('traffic', 'Traffico e persone', 'Auto, ciclisti, pedoni e animali lungo la strada.')}${fld.chk('hazards', 'Buche e lavori in corso', 'Nelle sedute con ERG le schiva il ciclista da solo.')}${fld.chk('gestures', 'Gesti del ciclista', 'Saluta, beve, esulta…')}${fld.chk('coachMsgs', 'Messaggi motivazionali', 'Testo a schermo ai cambi di step e ogni tanto.')}${fld.chk('autoPause', 'Pausa automatica quando ti fermi', 'Riparte da sola appena pedali.')}${fld.chk('showFps', 'Mostra FPS e prestazioni')}`,
      audio: () => `<h2>Audio</h2>${fld.chk('sound', 'Suoni attivi')}${fld.rng('vol', 'Volume', 0, 1, 0.05)}${fld.chk('ambient', 'Ambiente', 'Vento, uccelli e auto che passano.')}<button class="mc small" data-act="testSound">PROVA UN SUONO</button>`,
      grafica: () => `<h2>Grafica</h2>${fld.sel('style', 'Stile', [['voxel', 'Voxel (blocchi 3D)'], ['ps1', 'Low-poly retrò (PlayStation 1)'], ['iso', 'Diorama isometrico'], ['hd2d', 'HD-2D (sprite in 3D)']])}${fld.sel('quality', 'Qualità', [[3, 'Alta (consigliata)'], [2, 'Media'], [1, 'Veloce (PC lenti)']])}<div class="note">Se il PC fa fatica abbassa la qualità o scegli «Pixel 2D». Se il browser non supporta il 3D (WebGL) l'app usa da sola il Pixel 2D.</div>`,
      dati: () => `<h2>Dati e sincronizzazione</h2><p>Il piano entra e i .FIT, lo storico e i test escono dalla cartella che scegli (la tua cartella OneDrive «Open Trainer»: ci pensa OneDrive a sincronizzare).</p><div id="folderSlot"></div><div id="cloudSlot"></div>
        <h2>Impostazioni</h2><div class="rowb"><button class="mc small" data-act="expSet">ESPORTA</button><label class="mc small" for="impSet">IMPORTA</label><input type="file" id="impSet" accept=".json" hidden><button class="mc small danger" data-act="wipe">CANCELLA I DATI LOCALI</button></div>`,
      aiuto: () => `<h2>Aiuto</h2><div class="rowb"><button class="mc small" data-act="tut">TUTORIAL</button><button class="mc small" data-act="wiz">CONFIGURAZIONE INIZIALE</button></div><p class="hint">Tasti in gara: Spazio avvia/pausa · V vista · M menu · F schermo intero · N suoni.</p>`
    };
    root.innerHTML = `<div class="panel wide"><h1>IMPOSTAZIONI</h1><div class="split set"><div class="tabs">${TABS.map(t => `<button class="mc tab ${t[0] === tab ? 'sel' : ''}" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div><div class="pane" id="setPane">${body[tab]()}</div></div>
      <div class="nav">${back('home', '← FATTO')}<span></span></div></div>`;
    root.querySelectorAll('.tab').forEach(b => b.onclick = () => { tab = b.dataset.tab; settings(); });
    bindSettings(); wire();
    if (tab === 'dati') { $('folderSlot').appendChild($('folderBox')); $('cloudSlot').appendChild($('cloudBox')); api.cloudUi && api.cloudUi(); api.folderUi && api.folderUi(); }
    preview(); wkg();
  }
  const wkg = () => { const n = $('wkgNote'); if (!n) return; const w = +api.S.weight, f = api.ftp(); n.innerHTML = w > 0 ? `Con la FTP di riferimento (${f} W): <b>${(f / w).toFixed(2)} W/kg</b>.` : 'Inserisci il peso per vedere i W/kg.'; };
  const preview = () => { const c = $('pvRider'); if (c) api.previewRider(c); };
  function bindSettings() {
    const pane = $('setPane'); if (!pane) return;
    pane.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k; if (k === '__brand') { el.onchange = () => { const first = api.bikes().find(b => b.name.split(' ')[0] === el.value); if (first) { api.S.bike = first.id; apply('bike'); settings(); } }; return; }
      const h = () => { let v = el.type === 'checkbox' ? el.checked : el.dataset.t === 'n' ? (el.value === '' ? 0 : +el.value) : el.value; if (k === 'bikeColor.deep' || k === 'quality') v = +v; setPath(api.S, k, v); const lab = $('v_' + k.replace('.', '_')); if (lab) lab.textContent = v; apply(k); preview(); wkg(); };
      el.addEventListener(el.type === 'range' || el.type === 'color' || el.type === 'text' || el.type === 'number' ? 'input' : 'change', h);
    });
    pane.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => { setPath(api.S, b.dataset.sw, b.dataset.v); apply(b.dataset.sw); settings(); });
    pane.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act));
    const im = $('imgIn'); if (im) im.onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 10; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 10, 10); api.S.kit.img = c.toDataURL('image/png'); apply('kit.img'); settings(); }; img.src = r.result; }; r.readAsDataURL(f); };
    const si = $('impSet'); if (si) si.onchange = async e => { if (e.target.files[0]) { await api.importSettings(e.target.files[0]); settings(); } };
  }
  function apply(k) { api.saveS(); api.applySettings(k); }
  function act(a) {
    if (a === 'bikeReset') { Object.assign(api.S.bikeColor, { frame: '', accent: '', deep: -1 }); apply('bikeColor'); settings(); }
    else if (a === 'imgDel') { api.S.kit.img = null; apply('kit.img'); settings(); }
    else if (a === 'testSound') api.testSound(); else if (a === 'tut') api.startTutorial(); else if (a === 'wiz') api.openWizard();
    else if (a === 'expSet') api.exportSettings(); else if (a === 'wipe') api.wipe();
  }

  /* ---------------- STORICO ---------------- */
  function history() {
    const rides = api.history(), sum = d => api.summary(d), s7 = sum(7), s30 = sum(30);
    root.innerHTML = `<div class="panel wide"><h1>STORICO</h1>
      <div class="stats3"><div class="t"><i>ULTIMI 7 GIORNI</i><b>${s7.n} sedute</b><span>${fmt(s7.durS)} · ${s7.km} km</span></div><div class="t"><i>ULTIMI 30 GIORNI</i><b>${s30.n} sedute</b><span>${fmt(s30.durS)} · ${s30.km} km</span></div><div class="t"><i>ENERGIA 30 GG</i><b>${s30.kj} kJ</b><span>${rides.length} in archivio</span></div></div>
      <div class="tbl">${rides.length ? `<table><thead><tr><th>Data</th><th>Seduta</th><th>Durata</th><th>km</th><th>W medi</th><th>NP</th><th>W/kg</th><th>kJ</th></tr></thead><tbody>${rides.map(r => `<tr><td>${new Date(r.when).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td><td>${esc(r.title)}</td><td>${fmt(r.durS)}</td><td>${r.km}</td><td>${r.avgP}</td><td>${r.np}</td><td>${r.wkg ?? '—'}</td><td>${r.kj}</td></tr>`).join('')}</tbody></table>` : '<p>Ancora nessuna seduta. Appena ne finisci una compare qui.</p>'}</div>
      <div class="nav">${back('home')}<span></span><button class="mc small" id="hCsv" ${rides.length ? '' : 'disabled'}>ESPORTA CSV</button></div></div>`;
    $('hCsv').onclick = () => api.exportCsv(); wire();
  }

  /* ---------------- CREATORE ---------------- */
  function creator(id) {
    const ex = id ? api.getWorkout(id) : null; const ftp = api.ftp();
    edit = edit && edit.id === (id || null) ? edit : { id: id || null, title: ex ? ex.title : '', notes: ex ? ex.notes : '', nodes: ex ? fromBlocks(ex.blocks) : [newStep('warmup'), newRep(), newStep('cooldown')] };
    const E = edit;
    const find = path => { const parts = path.split('.').map(Number); let list = E.nodes, node = null; for (let i = 0; i < parts.length; i++) { node = list[parts[i]]; if (i < parts.length - 1) list = node.steps; } return { list, idx: parts[parts.length - 1], node }; };
    const nn = v => (v === '' || v == null || !Number.isFinite(+v)) ? '' : +v, mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`, parseT = v => { const m = String(v).match(/^(\d+):(\d{1,2})$/); return m ? +m[1] * 60 + +m[2] : (+v || 0) * 60; };
    const nodeHtml = (n, path, depth) => {
      if (n.kind === 'rep') return `<div class="rep" style="margin-left:${depth * 14}px"><div class="rephead"><b>RIPETI</b><input type="number" min="1" max="50" value="${nn(n.rep)}" data-p="${path}" data-f="rep" class="sm"><b>VOLTE</b><span></span>${rowBtns(path)}</div>${n.steps.map((c, i) => nodeHtml(c, path + '.' + i, depth + 1)).join('')}<div class="rowb sub"><button class="mc small" data-add="${path}:step">+ STEP</button><button class="mc small" data-add="${path}:rep">+ RIPETIZIONE</button></div></div>`;
      const pw = n.pw === 'watt' ? `<input class="sm" type="number" data-p="${path}" data-f="lo" value="${nn(n.lo)}" aria-label="W min"> – <input class="sm" type="number" data-p="${path}" data-f="hi" value="${nn(n.hi)}" aria-label="W max"> W` : n.pw === 'pct' ? `<input class="sm" type="number" step="1" data-p="${path}" data-f="plo" value="${Math.round(n.pct[0] * 100)}" aria-label="% min"> – <input class="sm" type="number" step="1" data-p="${path}" data-f="phi" value="${Math.round(n.pct[1] * 100)}" aria-label="% max"> % FTP${ftp ? ` <i class="hint">(${Math.round(n.pct[0] * ftp)}–${Math.round(n.pct[1] * ftp)} W)</i>` : ''}` : '<i class="hint">carico minimo</i>';
      return `<div class="step" style="margin-left:${depth * 14}px"><select data-p="${path}" data-f="t">${TYPES.map(t => `<option value="${t[0]}" ${t[0] === n.t ? 'selected' : ''}>${t[1]}</option>`).join('')}</select><input type="text" data-p="${path}" data-f="n" value="${esc(n.n)}" class="nm" aria-label="Nome">
        <span class="g"><select data-p="${path}" data-f="by"><option value="time" ${n.by === 'time' ? 'selected' : ''}>tempo</option><option value="dist" ${n.by === 'dist' ? 'selected' : ''}>distanza</option></select>${n.by === 'time' ? `<input class="md" type="text" data-p="${path}" data-f="d" value="${mmss(n.d)}" aria-label="mm:ss">` : `<input class="md" type="number" data-p="${path}" data-f="dist" value="${nn(n.dist)}" aria-label="m"> m`}</span>
        <span class="g"><select data-p="${path}" data-f="pw"><option value="pct" ${n.pw === 'pct' ? 'selected' : ''}>% FTP</option><option value="watt" ${n.pw === 'watt' ? 'selected' : ''}>watt</option><option value="none" ${n.pw === 'none' ? 'selected' : ''}>senza</option></select>${pw}</span>
        <span class="g">cad <input class="sm" type="number" data-p="${path}" data-f="cadlo" value="${n.cad ? nn(n.cad[0]) : ''}" placeholder="–"> – <input class="sm" type="number" data-p="${path}" data-f="cadhi" value="${n.cad ? nn(n.cad[1]) : ''}" placeholder="–"> pend. <input class="sm" type="number" step="0.5" data-p="${path}" data-f="grade" value="${nn(n.grade)}" placeholder="auto"> FC max <input class="sm" type="number" data-p="${path}" data-f="hrCap" value="${nn(n.hrCap)}" placeholder="–"></span>${rowBtns(path)}</div>`;
    };
    const rowBtns = path => `<span class="rb"><button class="mc xs" data-op="up:${path}" title="Su">↑</button><button class="mc xs" data-op="down:${path}" title="Giù">↓</button><button class="mc xs" data-op="dup:${path}" title="Duplica">⧉</button><button class="mc xs danger" data-op="del:${path}" title="Elimina">✕</button></span>`;
    const draw = () => {
      const c = check(E.nodes, ftp);
      root.innerHTML = `<div class="panel wide"><h1>${id ? 'MODIFICA WORKOUT' : 'NUOVO WORKOUT'}</h1>
        <div class="split3"><label class="f">Nome<input type="text" id="wkTitle" value="${esc(E.title)}" maxlength="40" placeholder="es. 4×8' sweet spot"></label><label class="f">Note (facoltative)<input type="text" id="wkNotes" value="${esc(E.notes)}" maxlength="120"></label></div>
        <div class="steps" id="steps">${E.nodes.map((n, i) => nodeHtml(n, String(i), 0)).join('')}</div>
        <div class="rowb"><span class="lbl">AGGIUNGI:</span>${TYPES.map(t => `<button class="mc small" data-add="root:${t[0]}">${t[1].toUpperCase()}</button>`).join('')}<button class="mc small" data-add="root:rep">+ RIPETIZIONE</button></div>
        <canvas id="wkPrev" width="720" height="70"></canvas>
        <div class="info">Durata: <b>${fmt(totalSeconds(E.nodes))}</b> · FTP di riferimento ${ftp} W</div>
        ${c.errors.map(e => `<div class="note warn">✖ ${esc(e)}</div>`).join('')}${c.warnings.map(e => `<div class="note">⚠ ${esc(e)}</div>`).join('')}
        <div class="nav"><button class="mc" id="wkCancel">← ANNULLA</button><span></span><button class="mc small" id="wkExp">ESPORTA .JSON</button><label class="mc small" for="wkImp">IMPORTA</label><input type="file" id="wkImp" accept=".json" hidden><button class="mc go" id="wkSave" ${c.errors.length || !E.title.trim() ? 'disabled' : ''}>SALVA</button></div></div>`;
      bind(); api.drawPreview && api.drawPreview($('wkPrev'), E.nodes);
    };
    const bind = () => {
      $('wkTitle').oninput = e => { E.title = e.target.value; $('wkSave').disabled = !E.title.trim() || !!check(E.nodes, ftp).errors.length; }; $('wkNotes').oninput = e => { E.notes = e.target.value; };
      root.querySelectorAll('[data-f]').forEach(el => el.onchange = () => {
        const { node } = find(el.dataset.p), f = el.dataset.f, v = el.value; if (!node) return;
        if (f === 'rep') node.rep = Math.max(1, +v || 1); else if (f === 't') { const d = newStep(v), isDefault = /^(Riscaldamento|Work|Recupero|Pausa|Defaticamento)$/.test(node.n); node.t = v; if (isDefault) node.n = d.n; if (v === 'rest') node.pw = 'none'; else if (node.pw === 'none') { node.pw = 'pct'; node.pct = [...d.pct]; } }
        else if (f === 'n') node.n = v; else if (f === 'by') node.by = v; else if (f === 'd') node.d = parseT(v); else if (f === 'dist') node.dist = +v; else if (f === 'pw') { node.pw = v; if (v === 'pct' && !(node.pct[1] > 0)) node.pct = [0.9, 1]; if (v === 'watt' && !(node.hi > 0)) { node.lo = Math.round(node.pct[0] * ftp) || 100; node.hi = Math.round(node.pct[1] * ftp) || 110; } }
        else if (f === 'lo') node.lo = +v; else if (f === 'hi') node.hi = +v; else if (f === 'plo') node.pct[0] = +v / 100; else if (f === 'phi') node.pct[1] = +v / 100;
        else if (f === 'cadlo' || f === 'cadhi') { const lo = f === 'cadlo' ? +v : (node.cad ? node.cad[0] : 0), hi = f === 'cadhi' ? +v : (node.cad ? node.cad[1] : 0); node.cad = lo || hi ? [lo, hi] : null; }
        else if (f === 'grade') node.grade = v === '' ? null : +v; else if (f === 'hrCap') node.hrCap = v === '' ? null : +v;
        draw();
      });
      root.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const [p, w] = b.dataset.add.split(':'), list = p === 'root' ? E.nodes : find(p).node.steps; list.push(w === 'rep' ? newRep() : w === 'step' ? newStep('interval') : newStep(w)); draw(); });
      root.querySelectorAll('[data-op]').forEach(b => b.onclick = () => { const [op, p] = b.dataset.op.split(':'), { list, idx } = find(p); if (op === 'del') list.splice(idx, 1); else if (op === 'dup') list.splice(idx + 1, 0, JSON.parse(JSON.stringify(list[idx]))); else if (op === 'up' && idx > 0) [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]; else if (op === 'down' && idx < list.length - 1) [list[idx + 1], list[idx]] = [list[idx], list[idx + 1]]; draw(); });
      $('wkCancel').onclick = () => { edit = null; show('select'); };
      $('wkSave').onclick = () => { const raw = toSession({ id: E.id || undefined, title: E.title.trim(), notes: E.notes, nodes: E.nodes }); api.saveWorkout(raw); edit = null; selKind = 'plan'; api.S.lastPick.sessId = raw.id; api.saveS(); show('select'); };
      $('wkExp').onclick = () => api.exportWorkout(toSession({ id: E.id || undefined, title: E.title || 'workout', notes: E.notes, nodes: E.nodes }));
      $('wkImp').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const o = JSON.parse(await f.text()), s = Array.isArray(o.sessions) ? o.sessions[0] : o; E.nodes = fromBlocks(s.blocks); E.title = s.title || E.title; E.notes = s.notes || ''; draw(); } catch (x) { api.toast('File non valido: ' + x.message); } };
    };
    draw();
  }

  const views = { home, select, connect, settings, history, creator };
  return { show, get cur() { return cur; }, refreshConnect: () => { if (cur === 'connect') connect(); }, park };
}
