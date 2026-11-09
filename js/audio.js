// Suoni sintetizzati con Web Audio (nessun file): beep seduta, clacson, vento, uccelli, salto, buca, applausi.
let ctx = null, master = null, windGain = null, windFilter = null, noiseBuf = null;
export const AUDIO = { on: true, vol: 0.7, fast: false, ambient: true };

function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = AUDIO.vol; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    windFilter = ctx.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 500; windFilter.Q.value = 0.6;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    src.connect(windFilter); windFilter.connect(windGain); windGain.connect(master); src.start();
  } catch { ctx = null; }
  return ctx;
}
/** da chiamare al primo gesto dell'utente */
export function unlock() { ensure(); }
export function setVolume(v) { v = Number.isFinite(+v) ? Math.min(1, Math.max(0, +v)) : 0.7; AUDIO.vol = v; if (master) master.gain.value = AUDIO.on ? v : 0; }
export function setOn(on) { AUDIO.on = on; if (master) master.gain.value = on ? AUDIO.vol : 0; if (!on && windGain) windGain.gain.value = 0; }

function tone({ f = 440, f2 = null, d = 0.2, type = 'square', g = 0.05, at = 0, pan = 0 }) {
  if (!AUDIO.on || AUDIO.fast || !ensure()) return;
  const t0 = ctx.currentTime + at, o = ctx.createOscillator(), a = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
  a.gain.setValueAtTime(0.0001, t0); a.gain.exponentialRampToValueAtTime(g, t0 + 0.01); a.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  let node = a;
  if (ctx.createStereoPanner && pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); a.connect(p); node = p; }
  o.connect(a); node.connect(master); o.start(t0); o.stop(t0 + d + 0.02);
}
function noise({ d = 0.2, f = 800, g = 0.1, type = 'lowpass', at = 0 }) {
  if (!AUDIO.on || AUDIO.fast || !ensure()) return;
  const t0 = ctx.currentTime + at, s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; const a = ctx.createGain();
  a.gain.setValueAtTime(g, t0); a.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  s.connect(fl); fl.connect(a); a.connect(master); s.start(t0, Math.random()); s.stop(t0 + d + 0.02);
}

// beep della seduta (stesse frequenze del mockup)
export const beep = (f, d) => tone({ f, d, type: 'square', g: 0.04 });
export const stepBeep = () => beep(880, 0.35);
export const tickBeep = () => beep(660, 0.1);
export const reduceBeep = () => beep(300, 0.3);
export const restoreBeep = () => beep(700, 0.2);
export const finishBeep = () => { beep(900, 0.15); tone({ f: 1200, d: 0.4, at: 0.18, g: 0.04 }); };
/** clacson: due colpi, tono diverso per auto */
export function horn(pan = 0, variant = 0) {
  const base = [380, 440, 330][variant % 3];
  for (let i = 0; i < 2; i++) { tone({ f: base, d: 0.22, type: 'sawtooth', g: 0.05, at: i * 0.3, pan }); tone({ f: base * 1.26, d: 0.22, type: 'sawtooth', g: 0.04, at: i * 0.3, pan }); }
}
export const bell = () => { tone({ f: 2400, d: 0.5, type: 'sine', g: 0.05 }); tone({ f: 3200, d: 0.4, type: 'sine', g: 0.03, at: 0.02 }); };
export const whoosh = () => noise({ d: 0.35, f: 1600, g: 0.12, type: 'bandpass' });
export const thud = () => { tone({ f: 120, f2: 40, d: 0.25, type: 'sine', g: 0.2 }); noise({ d: 0.15, f: 400, g: 0.12 }); };
export const land = () => tone({ f: 160, f2: 70, d: 0.12, type: 'sine', g: 0.1 });
export const chirp = (pan = 0) => { tone({ f: 2600, f2: 3600, d: 0.08, type: 'sine', g: 0.025, pan }); tone({ f: 3400, f2: 2800, d: 0.09, type: 'sine', g: 0.025, at: 0.11, pan }); };
export const cheer = () => { noise({ d: 1.2, f: 1800, g: 0.07, type: 'bandpass' }); };
/** passaggio di un'auto: rumore che sale e scende */
export function passBy(pan = 0) { if (!AUDIO.on || AUDIO.fast || !ensure()) return; noise({ d: 1.0, f: 300, g: 0.06, type: 'lowpass' }); tone({ f: 90, f2: 60, d: 1.0, type: 'sawtooth', g: 0.03, pan }); }
/** vento continuo proporzionale alla velocità (m/s) */
export function wind(speed) {
  if (!ctx || !windGain) return;
  const v = AUDIO.on && AUDIO.ambient && !AUDIO.fast ? Math.min(1, speed / 14) : 0;
  windGain.gain.setTargetAtTime(v * 0.09, ctx.currentTime, 0.3); windFilter.frequency.setTargetAtTime(300 + v * 1500, ctx.currentTime, 0.3);
}
