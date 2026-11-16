/**
 * Звук компостера без файлів (Web Audio, як дзвіночки стіни наклейок у StickerWallPage/wallSound.ts): металеве
 * клацання (шум крізь смуговий фільтр) і глухий удар. Викликати лише з жесту людини — тоді браузер дає звук.
 */
type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  try {
    const Ctor: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    void ctx.resume?.();
    return ctx;
  } catch {
    return null;
  }
}

function thump(ac: AudioContext, at: number, from: number, to: number, gain: number, length: number) {
  const osc = ac.createOscillator();
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + length);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + length);
  osc.connect(g).connect(ac.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** Клац компостера — у мить, коли щелепа дотискає талон */
export function playPunch(): void {
  const ac = context();
  if (!ac) return;
  try {
    const at = ac.currentTime + 0.01;
    const length = Math.floor(ac.sampleRate * 0.07);
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 5;
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2600;
    band.Q.value = 1.4;
    const g = ac.createGain();
    g.gain.value = 0.55;
    noise.connect(band).connect(g).connect(ac.destination);
    noise.start(at);
    thump(ac, at, 170, 55, 0.5, 0.13);
  } catch {
    /* звук — лише прикраса */
  }
}

/** Глухий штамп «щасливий» */
export function playStamp(): void {
  const ac = context();
  if (!ac) return;
  try {
    thump(ac, ac.currentTime + 0.01, 110, 45, 0.35, 0.16);
  } catch {
    /* звук — лише прикраса */
  }
}
