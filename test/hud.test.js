// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Schermo di pedalata: ogni elemento che la funzione ui() aggiorna deve esistere in index.html (un id perso = schermo che non si aggiorna più).
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'), main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

test('ui(): tutti gli id che aggiorna esistono nella pagina', () => {
  const a = main.indexOf('function ui() {'), e = main.slice(a).search(/\r?\n\}\r?\n/), b = e < 0 ? -1 : a + e; assert.ok(a > 0 && b > a, 'funzione ui() trovata');
  const used = new Set([...main.slice(a, b).matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map(m => m[1]));
  assert.ok(used.size > 30, 'id usati: ' + used.size);
  for (const id of used) assert.ok(ids.has(id), 'manca #' + id + ' in index.html');
});
test('layout C: le zone dello schermo ci sono tutte e i collegamenti stanno nel menu', () => {
  for (const c of ['hudl', 'wkp', 'side', 'cluster', 'rbn']) assert.ok(html.includes('class="' + c) || html.includes(' ' + c + '"') || html.includes(' ' + c + ' '), 'zona ' + c);
  const menu = html.slice(html.indexOf('<aside class="menu"'), html.indexOf('</aside>'));
  for (const id of ['btnHome', 'btnTrainer', 'btnHr', 'btnCam', 'btnPauseMenu']) assert.ok(menu.includes('id="' + id + '"'), id + ' dentro il menu');
  const top = html.slice(html.indexOf('<div class="topbar">'), html.indexOf('<div hidden>')); assert.ok(top.includes('id="btnMenu"') && !top.includes('id="btnTrainer"'), 'in alto resta solo il pulsante menu');
});
test('AVVIA/RIPRENDI compare solo da fermi: la regola è nel codice', () => { assert.ok(/\$\('btnGo'\)\.parentElement\.hidden = \(s\.started && !s\.paused && !s\.done\)/.test(main)); });
