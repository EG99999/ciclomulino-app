// Messaggi del "coach a schermo": testo breve, mai voce (decisione di progetto).
// Funzioni pure + una piccola classe che decide QUANDO parlare. Testabile senza browser.
const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length) % arr.length];
const w = (s) => (s.hi !== s.lo ? `${s.lo}-${s.hi}` : `${s.lo}`);
const mm = sec => { const m = Math.round(sec / 60); return m >= 1 ? `${m}'` : `${Math.round(sec)}"`; };

const POOL = {
  random: ['Respira e resta sciolto.', 'Spalle basse, mani leggere.', 'Pedalata rotonda: spingi e tira.', 'Un colpo di pedale alla volta.', 'Sei più forte di quanto credi.', 'Costanza: è questo che costruisce la forma.', 'Guarda avanti, non il computer.', 'Ottimo ritmo, continua così.'],
  work: ['Tienila, è tua!', 'Testa bassa e gambe veloci.', 'Questo è il lavoro che conta.', 'Cadenza alta, rapporto agile.', 'Non mollare ora.'],
  recovery: ['Recupera: gambe morbide.', 'Respira a fondo, abbassa la FC.', 'Bevi un sorso.', 'Rilassa spalle e mani.'],
  hydrate: ['Bevi qualcosa!', 'Ricordati di idratarti.'],
  reduce: ['Cadenza bassa: carico ridotto. Pedala più agile!', 'Gambe pesanti? Alleggerisco io, tu sali sopra i 75 rpm.'],
  restore: ['Bravo, carico di nuovo al 100%.', 'Ecco, ora sei dentro.'],
  hit: ['Ahi, una buca!', 'Occhio alla strada!'],
  jump: ['Che salto!', 'Schivata perfetta!']
};

/** Messaggio per un cambio di step. */
export function stepMessage(step, next, rnd = Math.random) {
  const dur = step.d != null ? mm(step.d) : `${Math.round(step.dist)} m`;
  const cadHint = step.cad ? ` · cadenza ${step.cad[0]}-${step.cad[1]}` : '';
  switch (step.t) {
    case 'interval': return `${step.n}: ${dur} a ${w(step)} W${cadHint}. ${pick(POOL.work, rnd)}`;
    case 'recovery': return `${step.n}: ${dur} a ${w(step)} W. ${pick(POOL.recovery, rnd)}`;
    case 'rest': return `Pausa di ${dur}. ${pick(POOL.recovery, rnd)}`;
    case 'cooldown': return `Defaticamento: ${dur} a ${w(step)} W. Ottimo lavoro!`;
    default: return `${step.n}: ${dur} a ${w(step)} W${next && next.t === 'interval' ? ` · poi ${next.n} a ${w(next)} W` : ''}`;
  }
}

export class Coach {
  /** say(testo, tono) viene chiamata quando c'è un messaggio ('info' | 'good' | 'warn') */
  constructor(say, rnd = Math.random) {
    this.say = say; this.rnd = rnd; this.reset();
  }
  reset() { this.nextRandom = 70 + this.rnd() * 50; this.hydrate = 600; this.halfDone = false; this.last10 = -1; this.hrWarn = 0; this.stepSeen = -1; this.quiet = 0; }
  /** da chiamare per ogni evento della seduta */
  onEvent(e, s) {
    switch (e.type) {
      case 'start': this.say(stepMessage(s.step, s.next, this.rnd), 'info'); this.stepSeen = 0; break;
      case 'step': this.say(stepMessage(e.step, s.next, this.rnd), e.step.t === 'interval' ? 'warn' : 'good'); this.stepSeen = e.idx; this.last10 = -1; this.quiet = 0; break;
      case 'reduce': this.say(pick(POOL.reduce, this.rnd), 'warn'); break;
      case 'restore': this.say(pick(POOL.restore, this.rnd), 'good'); break;
      case 'pause': this.say(e.reason === 'auto' ? 'Ti sei fermato: pausa automatica. Riparti e riprendo.' : e.reason === 'trainer' ? 'Trainer scollegato: seduta in pausa.' : 'Pausa. Carico minimo.', 'info'); break;
      case 'resume': this.say('Si riparte! Rampa di 8 secondi.', 'good'); break;
      case 'finish': this.say(e.reason === 'stopped' ? 'Seduta terminata. Scarica il .FIT.' : 'Seduta completata! Grande lavoro, Elia.', 'good'); break;
      case 'hit': this.say(pick(POOL.hit, this.rnd), 'warn'); break;
      case 'jump': this.say(pick(POOL.jump, this.rnd), 'good'); break;
    }
  }
  /** da chiamare a ogni tick con dt in secondi; usa solo tempo di seduta attiva */
  tick(dt, s, inp = {}) {
    if (!s || !s.active) return;
    this.quiet += dt;
    // metà seduta
    if (!this.halfDone && s.t >= s.totalEst / 2) { this.halfDone = true; this.say('Metà seduta! Sei già a metà strada.', 'good'); }
    // ultimi 10 secondi di un work
    const rem = s.stepRemaining();
    if (s.step.t === 'interval' && rem <= 10 && rem > 9 && this.last10 !== s.idx) { this.last10 = s.idx; this.say('Ultimi 10 secondi: dai tutto!', 'warn'); }
    // idratazione
    this.hydrate -= dt; if (this.hydrate <= 0) { this.hydrate = 600; this.say(pick(POOL.hydrate, this.rnd), 'info'); }
    // tetto FC (solo informativo)
    this.hrWarn -= dt;
    if (s.step.hrCap && inp.hr && inp.hr > s.step.hrCap + 3 && this.hrWarn <= 0) { this.hrWarn = 60; this.say(`FC ${Math.round(inp.hr)}: sopra il tetto di ${s.step.hrCap}. Alleggerisci la pedalata.`, 'warn'); }
    // incoraggiamento casuale, mai vicino a un cambio step
    this.nextRandom -= dt;
    if (this.nextRandom <= 0) {
      this.nextRandom = 80 + this.rnd() * 70;
      if (rem > 15 && this.quiet > 25) { this.say(pick(s.step.t === 'interval' ? POOL.work : POOL.random, this.rnd), 'info'); }
    }
  }
}
