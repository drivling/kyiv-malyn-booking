/**
 * Звуки віджета на стіну — синтез Web Audio, без файлів: м'які «дзвіночки» (синус + обертон,
 * швидка атака, довге згасання) з легким відлунням. Браузер дозволяє звук лише після дотику,
 * тому `unlockWallSound()` викликається з кнопки «Почати».
 */
/**
 * `newcomer` — відлуння тизера «Крапка»: три «тук» (крапка підскакує) і «дзинь»;
 * `ticket` — компостер, як на /dovede (DovedePage/intro/punchSound.ts): «клац», штамп «тук», тоді «дзинь»;
 * `countdown` — новенький № 981–1000: «тук» на табло-лічильнику, «клац» пластинки (1,13 с), «дзинь»;
 * `thousand` — тисячний: «тук», чотири «клац» переносу (WallFlapCounter.tsx), тоді мелодія рубежу
 */
export type WallSound = 'hello' | 'scan' | 'milestone' | 'record' | 'newcomer' | 'ticket' | 'countdown' | 'thousand';

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let master: GainNode | null = null;

function audioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { webkitAudioContext?: new () => AudioContext };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Створює (або будить) AudioContext — лише з обробника дотику. false — звуку на пристрої немає */
export function unlockWallSound(): boolean {
  const Ctor = audioContextCtor();
  if (!Ctor) return false;
  try {
    if (!ctx) {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.32;
      // відлуння: затримка з тихим зворотним зв'язком через фільтр — «повітря» навколо дзвіночків
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.19;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.28;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 3200;
      master.connect(ctx.destination);
      master.connect(delay);
      delay.connect(tone);
      tone.connect(feedback);
      feedback.connect(delay);
      tone.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

/** Після повернення вкладки браузер міг призупинити звук */
export function resumeWallSound(): void {
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
}

function bell(freq: number, start: number, length = 1.4, level = 1) {
  if (!ctx || !master) return;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, start);
  out.gain.exponentialRampToValueAtTime(0.5 * level, start + 0.012);
  out.gain.exponentialRampToValueAtTime(0.0001, start + length);
  out.connect(master);
  // основний тон + тихий обертон на октаву вище і «скляний» на 2,76 — звучить як маленький дзвін
  for (const [mult, gain, type] of [
    [1, 1, 'sine'],
    [2, 0.28, 'sine'],
    [2.76, 0.08, 'triangle'],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * mult, start);
    const g = ctx.createGain();
    g.gain.value = gain;
    osc.connect(g);
    g.connect(out);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }
}

/** Глухий удар: тон, що швидко падає (штамп, дно компостера) */
function thump(start: number, from: number, to: number, level: number, length: number) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + length);
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, start);
  g.gain.exponentialRampToValueAtTime(0.001, start + length);
  osc.connect(g);
  g.connect(master);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/** Металеве «клац» компостера: короткий шум крізь смуговий фільтр і удар */
function clack(start: number) {
  if (!ctx || !master) return;
  const length = Math.floor(ctx.sampleRate * 0.07);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 5;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2600;
  band.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.value = 1.4;
  noise.connect(band);
  band.connect(g);
  g.connect(master);
  noise.start(start);
  thump(start, 170, 55, 1.2, 0.13);
}

/** Удари без висоти — у такт із талоном на екрані (WallTalon, StickerWall.css): щелепа на 1,04 с, штамп на 1,27 с */
const HITS: Partial<Record<WallSound, Array<[(start: number) => void, number]>>> = {
  ticket: [
    [clack, 1.04],
    [(at) => thump(at, 110, 45, 0.9, 0.16), 1.27],
  ],
  // пластинки табло-лічильника: третє приземлення крапки — 1,13 с, перенос — кожні 0,13 с (WallFlapCounter.tsx)
  countdown: [[clack, 1.13]],
  thousand: [
    [clack, 1.13],
    [clack, 1.26],
    [clack, 1.39],
    [clack, 1.52],
  ],
};

// Ноти пентатоніки соль-мажор — будь-яке поєднання звучить приємно
const N = { D5: 587.33, G5: 783.99, B5: 987.77, D6: 1174.66, E6: 1318.51, G6: 1567.98, B6: 1975.53, D7: 2349.32 };

/** [частота, коли (с), довжина (с), гучність відносно інших нот] */
const MELODIES: Record<WallSound, Array<[number, number, number?, number?]>> = {
  hello: [
    [N.D6, 0],
    [N.G6, 0.16],
  ],
  scan: [
    [N.G5, 0],
    [N.B5, 0.11],
    [N.D6, 0.22],
    [N.G6, 0.36, 1.8],
  ],
  milestone: [
    [N.G5, 0],
    [N.B5, 0.1],
    [N.D6, 0.2],
    [N.G6, 0.3],
    [N.B6, 0.42],
    [N.D6, 0.62, 2.2],
    [N.G6, 0.62, 2.2],
    [N.B6, 0.62, 2.2],
  ],
  record: [
    [N.D6, 0],
    [N.E6, 0.1],
    [N.G6, 0.2],
    [N.B6, 0.32],
    [N.D7, 0.46],
    [N.G6, 0.7],
    [N.B6, 0.8],
    [N.D7, 0.92, 2.4],
    [N.G6, 0.92, 2.4],
  ],
  // підскоки — у такт із крапкою на екрані (WallCelebration, .wall-cele-dot): 0,45 / 0,84 / 1,13 с, далі «дзинь»
  newcomer: [
    [N.D5, 0.45, 0.32, 0.7],
    [N.D5, 0.84, 0.28, 0.55],
    [N.D5, 1.13, 0.24, 0.4],
    [N.G6, 1.4, 2.6],
    [N.B6, 1.4, 2.6],
    [N.D7, 1.4, 2.6],
  ],
  countdown: [
    [N.D5, 0.45, 0.32, 0.7],
    [N.D5, 0.84, 0.28, 0.55],
    [N.D5, 1.13, 0.24, 0.4],
    [N.G6, 1.45, 2.6],
    [N.B6, 1.45, 2.6],
    [N.D7, 1.45, 2.6],
  ],
  // тисячний: підскоки, перенос, і мелодія рубежу, коли табло синіє
  thousand: [
    [N.D5, 0.45, 0.32, 0.7],
    [N.D5, 0.84, 0.28, 0.55],
    [N.D5, 1.13, 0.24, 0.4],
    [N.G5, 1.8],
    [N.B5, 1.9],
    [N.D6, 2.0],
    [N.G6, 2.1],
    [N.B6, 2.22],
    [N.D6, 2.42, 2.6],
    [N.G6, 2.42, 2.6],
    [N.B6, 2.42, 2.6],
    [N.D7, 2.42, 2.6],
  ],
  // «дзинь» після штампа
  ticket: [
    [N.G6, 1.5, 2.6],
    [N.B6, 1.5, 2.6],
    [N.D7, 1.5, 2.6],
  ],
};

export function playWallSound(kind: WallSound): void {
  if (!ctx || !master) return;
  resumeWallSound();
  const t0 = ctx.currentTime + 0.03;
  const notes = MELODIES[kind];
  const level = 1 / Math.max(1, Math.sqrt(notes.filter((n) => n[1] === notes[notes.length - 1][1]).length));
  for (const [freq, at, len, gain] of notes) bell(freq, t0 + at, len ?? 1.3, level * (gain ?? 1));
  try {
    for (const [hit, at] of HITS[kind] ?? []) hit(t0 + at);
  } catch {
    /* удари — лише прикраса */
  }
}
