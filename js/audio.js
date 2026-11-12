// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Gatti Elia
// Suoni: registrazioni reali CC0 (cartella sounds/, crediti in sounds/CREDITI.md), caricate con fetch e decodeAudioData.
// Se un file non si carica (prima volta senza internet, file mancante) per quel suono resta il vecchio suono sintetico.
let ctx = null, master = null, windGain = null, windFilter = null, noiseBuf = null, synthWind = null, realWind = null;
export const AUDIO = { on: true, vol: 0.7, fast: false, ambient: true };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- registrazioni ---------- */
const FILES = ['beep-1', 'beep-2', 'beep-fine', 'clacson-1', 'clacson-2', 'clacson-3', 'campanello', 'whoosh', 'colpo-1', 'colpo-2', 'atterraggio', 'uccello-1', 'uccello-2', 'uccello-3', 'applauso', 'auto-passa', 'vento'];
const buf = {}, peak = {};
let loading = null, lastTry = 0;
function peakOf(b) { let p = 0; for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > p) p = a; } } return p || 1; }
/** vento senza stacco: gli ultimi `fadeS` secondi si sfumano sull'inizio, così la fine si attacca all'inizio senza che si senta il giro */
function loopOf(b, fadeS = 2) {
  const sr = b.sampleRate, N = b.length, C = Math.min(Math.floor(fadeS * sr), Math.floor(N / 3)), M = N - C;
  if (!ctx || M <= C) return b;
  const o = ctx.createBuffer(b.numberOfChannels, M, sr);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const s = b.getChannelData(c), d = o.getChannelData(c);
    for (let i = 0; i < M; i++) d[i] = i < C ? s[i] * (i / C) + s[M + i] * (1 - i / C) : s[i];
  }
  return o;
}
async function loadAll() {
  if (loading || !ctx || Date.now() - lastTry < 30000) return loading;
  lastTry = Date.now();
  loading = (async () => {
    for (const n of FILES) {
      if (buf[n]) continue;
      try {
        const r = await fetch('sounds/' + n + '.ogg'); if (!r.ok) continue;
        const b = await ctx.decodeAudioData(await r.arrayBuffer()); peak[n] = peakOf(b); buf[n] = n === 'vento' ? loopOf(b) : b;
        if (n === 'vento') startRealWind();
      } catch { /* quel suono resta sintetico; si riprova al prossimo gesto, non prima di 30 secondi */ }
    }
  })().finally(() => { loading = null; });
  return loading;
}
function startRealWind() {
  if (realWind || !ctx || !buf.vento) return;
  const src = ctx.createBufferSource(); src.buffer = buf.vento; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800; f.Q.value = 0.4;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f); f.connect(g); g.connect(master); src.start(0, Math.random() * buf.vento.duration);
  realWind = { gain: g, filter: f };
}
/** suona una registrazione; false se non è (ancora) caricata o l'audio è spento, così il chiamante usa il suono sintetico */
function play(n, { g = 1, rate = 1, pan = 0, at = 0, off = 0, dur = 0, fade = 0.03 } = {}) {
  const b = buf[n]; if (!b || !AUDIO.on || AUDIO.fast || !ensure()) return false;
  const t0 = ctx.currentTime + at, s = ctx.createBufferSource(), a = ctx.createGain(), o = clamp(off, 0, Math.max(0, b.duration - 0.05));
  const len = Math.max(0.05, Math.min(dur || b.duration - o, b.duration - o)) / rate, v = g / (peak[n] || 1), f = Math.min(fade, len / 2);
  s.buffer = b; s.playbackRate.value = rate;
  a.gain.setValueAtTime(0.0001, t0); a.gain.linearRampToValueAtTime(v, t0 + f); a.gain.setValueAtTime(v, t0 + len - f); a.gain.linearRampToValueAtTime(0.0001, t0 + len);
  let node = a;
  if (ctx.createStereoPanner && pan) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); a.connect(p); node = p; }
  s.connect(a); node.connect(master); s.start(t0, o, len * rate); return true;
}

function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = AUDIO.on ? AUDIO.vol : 0; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    windFilter = ctx.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 500; windFilter.Q.value = 0.6;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    src.connect(windFilter); windFilter.connect(windGain); windGain.connect(master); src.start(); synthWind = true;
  } catch { ctx = null; }
  if (ctx) loadAll();
  return ctx;
}
/** da chiamare al primo gesto dell'utente (e ai successivi: ritenta i file che non si erano caricati) */
export function unlock() { if (ensure()) loadAll(); }
export function setVolume(v) { v = Number.isFinite(+v) ? clamp(+v, 0, 1) : 0.7; AUDIO.vol = v; if (master) master.gain.value = AUDIO.on ? v : 0; }
export function setOn(on) { AUDIO.on = on; if (master) master.gain.value = on ? AUDIO.vol : 0; if (!on) { if (windGain) windGain.gain.value = 0; if (realWind) realWind.gain.gain.value = 0; } }
/** quali registrazioni sono pronte (per i test nel browser) */
export const loaded = () => Object.keys(buf);

/* ---------- suoni sintetici: solo di riserva ---------- */
function tone({ f = 440, f2 = null, d = 0.2, type = 'square', g = 0.05, at = 0, pan = 0 }) {
  if (!AUDIO.on || AUDIO.fast || !ensure()) return;
  const t0 = ctx.currentTime + at, o = ctx.createOscillator(), a = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
  a.gain.setValueAtTime(0.0001, t0); a.gain.exponentialRampToValueAtTime(g, t0 + 0.01); a.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  let node = a;
  if (ctx.createStereoPanner && pan) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); a.connect(p); node = p; }
  o.connect(a); node.connect(master); o.start(t0); o.stop(t0 + d + 0.02);
}
function noise({ d = 0.2, f = 800, g = 0.1, type = 'lowpass', at = 0 }) {
  if (!AUDIO.on || AUDIO.fast || !ensure()) return;
  const t0 = ctx.currentTime + at, s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; const a = ctx.createGain();
  a.gain.setValueAtTime(g, t0); a.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  s.connect(fl); fl.connect(a); a.connect(master); s.start(t0, Math.random()); s.stop(t0 + d + 0.02);
}

/* ---------- beep della seduta: cicalino di un orologio digitale ---------- */
export const beep = (f = 880, d = 0.2) => play('beep-1', { g: 0.25 }) || tone({ f, d, type: 'square', g: 0.04 });
export const stepBeep = () => { if (!(play('beep-1', { g: 0.25 }) && play('beep-1', { g: 0.25, at: 0.2 }))) tone({ f: 880, d: 0.35, type: 'square', g: 0.04 }); };
export const tickBeep = () => play('beep-2', { g: 0.2 }) || tone({ f: 660, d: 0.1, type: 'square', g: 0.04 });
export const reduceBeep = () => { if (!(play('beep-1', { g: 0.25, rate: 0.62 }) && play('beep-1', { g: 0.25, rate: 0.62, at: 0.25 }))) tone({ f: 300, d: 0.3, type: 'square', g: 0.04 }); };
export const restoreBeep = () => { if (!(play('beep-1', { g: 0.25, rate: 1.2 }) && play('beep-1', { g: 0.25, rate: 1.5, at: 0.2 }))) tone({ f: 700, d: 0.2, type: 'square', g: 0.04 }); };
export const finishBeep = () => play('beep-fine', { g: 0.25 }) || (tone({ f: 900, d: 0.15, type: 'square', g: 0.04 }), tone({ f: 1200, d: 0.4, at: 0.18, g: 0.04 }));

/* ---------- strada ---------- */
/** clacson: tre auto diverse; i primi e gli ultimi suonano due colpi, il secondo uno lungo */
export function horn(pan = 0, variant = 0) {
  const v = Math.abs(Math.floor(variant)) % 3, n = 'clacson-' + (v + 1);
  const hit = v === 1 ? play(n, { g: 0.4, pan, dur: 1.2, fade: 0.05 }) : play(n, { g: 0.4, pan, dur: v === 0 ? 0.32 : 0.2, fade: 0.02 }) && play(n, { g: 0.4, pan, dur: v === 0 ? 0.32 : 0.2, at: v === 0 ? 0.42 : 0.3, fade: 0.02 });
  if (hit) return;
  const base = [380, 440, 330][v];
  for (let i = 0; i < 2; i++) { tone({ f: base, d: 0.22, type: 'sawtooth', g: 0.05, at: i * 0.3, pan }); tone({ f: base * 1.26, d: 0.22, type: 'sawtooth', g: 0.04, at: i * 0.3, pan }); }
}
export const bell = () => play('campanello', { g: 0.35, dur: 1.1, fade: 0.04 }) || (tone({ f: 2400, d: 0.5, type: 'sine', g: 0.05 }), tone({ f: 3200, d: 0.4, type: 'sine', g: 0.03, at: 0.02 }));
export const whoosh = () => play('whoosh', { g: 0.35, fade: 0.02 }) || noise({ d: 0.35, f: 1600, g: 0.12, type: 'bandpass' });
export const thud = () => play(Math.random() < 0.5 ? 'colpo-1' : 'colpo-2', { g: 0.5, dur: 1.1, fade: 0.04 }) || (tone({ f: 120, f2: 40, d: 0.25, type: 'sine', g: 0.2 }), noise({ d: 0.15, f: 400, g: 0.12 }));
export const land = () => play('atterraggio', { g: 0.35, off: 0.3, dur: 0.5, fade: 0.02 }) || tone({ f: 160, f2: 70, d: 0.12, type: 'sine', g: 0.1 });
export const chirp = (pan = 0) => play('uccello-' + (1 + Math.floor(Math.random() * 3)), { g: 0.3, pan, fade: 0.08 }) || (tone({ f: 2600, f2: 3600, d: 0.08, type: 'sine', g: 0.025, pan }), tone({ f: 3400, f2: 2800, d: 0.09, type: 'sine', g: 0.025, at: 0.11, pan }));
export const cheer = () => play('applauso', { g: 0.45, dur: 6.5, fade: 0.6 }) || noise({ d: 1.2, f: 1800, g: 0.07, type: 'bandpass' });
/** un'auto ti supera: parte poco prima del suo punto più rumoroso e si allontana */
export function passBy(pan = 0) {
  if (play('auto-passa', { g: 0.45, pan, off: 5.2, dur: 4.5, fade: 0.5 })) return;
  noise({ d: 1.0, f: 300, g: 0.06, type: 'lowpass' }); tone({ f: 90, f2: 60, d: 1.0, type: 'sawtooth', g: 0.03, pan });
}
/** vento continuo proporzionale alla velocità (m/s): registrazione vera se caricata, altrimenti rumore filtrato */
export function wind(speed) {
  if (!ctx || !windGain) return;
  const v = AUDIO.on && AUDIO.ambient && !AUDIO.fast ? Math.min(1, speed / 14) : 0, t = ctx.currentTime;
  if (realWind) {
    windGain.gain.setTargetAtTime(0, t, 0.2);
    realWind.gain.gain.setTargetAtTime(v * 0.9 / (peak.vento || 1), t, 0.4); realWind.filter.frequency.setTargetAtTime(500 + v * 7500, t, 0.4);
  } else { windGain.gain.setTargetAtTime(v * 0.09, t, 0.3); windFilter.frequency.setTargetAtTime(300 + v * 1500, t, 0.3); }
}
