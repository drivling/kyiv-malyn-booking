/**
 * Звуки віджета на стіну — синтез Web Audio, без файлів: м'які «дзвіночки» (синус + обертон,
 * швидка атака, довге згасання) з легким відлунням. Браузер дозволяє звук лише після дотику,
 * тому `unlockWallSound()` викликається з кнопки «Почати».
 */
export type WallSound = 'hello' | 'scan' | 'milestone' | 'record';

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

// Ноти пентатоніки соль-мажор — будь-яке поєднання звучить приємно
const N = { G5: 783.99, B5: 987.77, D6: 1174.66, E6: 1318.51, G6: 1567.98, B6: 1975.53, D7: 2349.32 };

const MELODIES: Record<WallSound, Array<[number, number, number?]>> = {
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
};

export function playWallSound(kind: WallSound): void {
  if (!ctx || !master) return;
  resumeWallSound();
  const t0 = ctx.currentTime + 0.03;
  const notes = MELODIES[kind];
  const level = 1 / Math.max(1, Math.sqrt(notes.filter((n) => n[1] === notes[notes.length - 1][1]).length));
  for (const [freq, at, len] of notes) bell(freq, t0 + at, len ?? 1.3, level);
}
