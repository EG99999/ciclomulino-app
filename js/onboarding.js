// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Configurazione iniziale (primo accesso) e tutorial guidato con evidenziazione degli elementi.
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** ctx: { S, save(), bikes:[{id,name}], msReady:boolean, actions:{ loginMs, simulator, testSound, setBike, setSound, startTutorial, onClose } } */
export function runWizard(ctx) {
  const { S, save, bikes, actions } = ctx, root = $('wizard');
  const steps = [
    () => ({
      title: 'BENVENUTO SU OPEN TRAINER',
      body: `<p>Pedali sul ciclomulino e giochi: l'app regola il carico (ERG), conta tutto e a fine seduta ti dà il file .FIT per Garmin.</p>
        <p>Facciamo 4 passi veloci di configurazione. Puoi cambiare tutto dopo dal menu.</p>
        <label class="f">Come ti chiami? (facoltativo)<input id="wzName" type="text" maxlength="24" value="${esc(S.name)}" placeholder="es. Elia"></label>`,
      next: () => { S.name = $('wzName').value.trim(); }
    }),
    () => ({
      title: 'COME RICEVI GLI ALLENAMENTI?',
      body: `<label class="opt"><input type="radio" name="pm" value="onedrive" ${S.planMode === 'onedrive' ? 'checked' : ''}><span><b>OneDrive (automatico)</b><br>L'app legge il piano da una cartella OneDrive e ci salva i .FIT. Serve un account Microsoft.</span></label>
        <label class="opt"><input type="radio" name="pm" value="local" ${S.planMode === 'local' ? 'checked' : ''}><span><b>File sul computer</b><br>Trascini <i>piano-app.json</i> nell'app (come adesso). Tutto resta nel tuo browser.</span></label>
        <label class="opt"><input type="radio" name="pm" value="own" ${S.planMode === 'own' ? 'checked' : ''}><span><b>Li costruisco io</b><br>Crei i tuoi workout e li salvi in locale. <i>Il creatore di workout arriva nella prossima fase: per ora puoi importare file.</i></span></label>
        <div id="wzMs" ${S.planMode === 'onedrive' ? '' : 'hidden'}>
          ${ctx.msReady ? '' : `<label class="f">Client ID Microsoft<input id="wzCid" type="text" value="${esc(S.clientId)}" placeholder="incolla l'ID dell'app (vedi GUIDA-ONEDRIVE.md)"></label>`}
          <button id="wzLogin" class="go">ACCEDI CON MICROSOFT</button>
          <div class="hint" id="wzMsInfo">${S.cloud ? '✓ Account collegato' : "L'app vedrà solo la sua cartella «Apps/Open Trainer», nient'altro del tuo OneDrive."}</div>
        </div>`,
      bind: () => {
        document.querySelectorAll('input[name=pm]').forEach(r => r.onchange = () => { S.planMode = r.value; $('wzMs').hidden = r.value !== 'onedrive'; save(); });
        const lg = $('wzLogin'); if (lg) lg.onclick = () => { if ($('wzCid')) S.clientId = $('wzCid').value.trim(); S.wizStep = 1; save(); actions.loginMs(); };
      },
      next: () => { if ($('wzCid')) S.clientId = $('wzCid').value.trim(); }
    }),
    () => ({
      title: 'LA TUA ATTREZZATURA',
      body: `<p><b>Trainer</b> (Elite Suito-T) e <b>fascia/orologio per la FC</b> si collegano col Bluetooth: serve <b>Edge o Chrome</b> su PC, e il sito aperto in https (o localhost).</p>
        <p>Dal menu in alto: ⚡ TRAINER e ♥ FC. Se l'orologio è in modalità broadcast comparirà nella lista.</p>
        <p>Vuoi solo provare? Il <b>simulatore</b> si comporta come un trainer vero: puoi vedere l'ERG, le pause e il resto senza pedalare.</p>
        <button id="wzSim">ATTIVA IL SIMULATORE</button>`,
      bind: () => { $('wzSim').onclick = () => { actions.simulator(); $('wzSim').textContent = '✓ SIMULATORE ATTIVO'; }; }
    }),
    () => ({
      title: 'BICI E SUONI',
      body: `<label class="f">Bici<select id="wzBike">${bikes.map(b => `<option value="${b.id}" ${b.id === S.bike ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
        <label class="f">Stile grafico<select id="wzStyle">${[['voxel', 'Voxel (blocchi 3D)'], ['ps1', 'Low-poly retrò'], ['iso', 'Diorama isometrico'], ['hd2d', 'HD-2D']].map(([v, t]) => `<option value="${v}" ${v === (S.style || 'voxel') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="opt"><input type="checkbox" id="wzSound" ${S.sound ? 'checked' : ''}><span><b>Suoni attivi</b> (beep, clacson, vento, uccelli)</span></label>
        <button id="wzTest">PROVA UN SUONO</button>
        <p class="hint">Lo stile si cambia quando vuoi dalle Impostazioni (o con i tasti 1-4 mentre pedali).</p>`,
      bind: () => { $('wzBike').onchange = e => { S.bike = e.target.value; actions.setBike(S.bike); save(); }; $('wzStyle').onchange = e => { S.style = e.target.value; save(); actions.onClose && actions.applyNow && actions.applyNow(); }; $('wzSound').onchange = e => { S.sound = e.target.checked; actions.setSound(S.sound); save(); }; $('wzTest').onclick = () => actions.testSound(); }
    }),
    () => ({
      title: S.name ? `PRONTO, ${esc(S.name.toUpperCase())}!` : 'PRONTO!',
      body: `<p>Configurazione salvata. Vuoi un <b>giro guidato</b> dell'interfaccia (1 minuto)? Lo ritrovi sempre nel menu.</p>`,
      last: true
    })
  ];
  let i = Math.min(S.wizStep || 0, steps.length - 1);
  function draw() {
    const st = steps[i]();
    root.hidden = false;
    root.innerHTML = `<div class="box"><div class="dots">${steps.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'done' : ''}"></i>`).join('')}</div>
      <h2>${st.title}</h2><div class="body">${st.body}</div>
      <div class="nav"><button id="wzSkip">SALTA</button><span></span>${i > 0 ? '<button id="wzBack">INDIETRO</button>' : ''}${st.last ? '<button id="wzTut" class="go">INIZIA IL TUTORIAL</button><button id="wzEnd">FINE</button>' : '<button id="wzNext" class="go">AVANTI</button>'}</div></div>`;
    st.bind && st.bind();
    const end = (tut) => { S.setupDone = true; S.wizStep = 0; save(); root.hidden = true; root.innerHTML = ''; actions.onClose && actions.onClose(); if (tut) actions.startTutorial(); };
    $('wzSkip').onclick = () => { st.next && st.next(); end(false); };
    if ($('wzBack')) $('wzBack').onclick = () => { st.next && st.next(); i--; S.wizStep = i; save(); draw(); };
    if ($('wzNext')) $('wzNext').onclick = () => { st.next && st.next(); i++; S.wizStep = i; save(); draw(); };
    if ($('wzTut')) $('wzTut').onclick = () => end(true);
    if ($('wzEnd')) $('wzEnd').onclick = () => end(false);
  }
  draw();
}

/** steps: [{ sel?, title, text, before?() }] ; evidenzia l'elemento, spiega, Avanti/Indietro/Salta */
export function runTutorial(steps, { onEnd } = {}) {
  let i = 0, hole = $('tutHole'), card = $('tutCard'), root = $('tut');
  root.hidden = false;
  function place() {
    const s = steps[i]; s.before && s.before();
    const el = s.sel ? document.querySelector(s.sel) : null; if (el && el.closest('.menu') && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
    if (r && r.width > 0) { const pad = 6; Object.assign(hole.style, { display: 'block', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' }); }
    else Object.assign(hole.style, { display: 'block', left: '50%', top: '50%', width: '0px', height: '0px' });
    card.innerHTML = `<div class="tp">${i + 1} / ${steps.length}</div><h3>${esc(s.title)}</h3><p>${s.text}</p>
      <div class="nav"><button id="tutSkip">ESCI</button><span></span>${i > 0 ? '<button id="tutBack">INDIETRO</button>' : ''}<button id="tutNext" class="go">${i === steps.length - 1 ? 'FINE' : 'AVANTI'}</button></div>`;
    // posizione della scheda: sotto l'elemento se c'è spazio, altrimenti sopra; al centro se non c'è un elemento
    const cw = Math.min(380, innerWidth - 24); card.style.width = cw + 'px';
    let left = r ? Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), innerWidth - cw - 12) : (innerWidth - cw) / 2, top;
    const ch = card.offsetHeight || 190;
    if (!r) top = (innerHeight - ch) / 2; else if (r.bottom + 14 + ch < innerHeight) top = r.bottom + 14; else if (r.top - 14 - ch > 0) top = r.top - 14 - ch; else top = Math.max(12, innerHeight - ch - 12);
    card.style.left = left + 'px'; card.style.top = top + 'px';
    $('tutSkip').onclick = stop; $('tutNext').onclick = () => { if (i === steps.length - 1) stop(); else { i++; place(); } };
    if ($('tutBack')) $('tutBack').onclick = () => { i--; place(); };
  }
  function stop() { root.hidden = true; removeEventListener('resize', place); onEnd && onEnd(); }
  addEventListener('resize', place); place();
}
