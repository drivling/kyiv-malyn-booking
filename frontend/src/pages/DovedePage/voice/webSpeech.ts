/**
 * «Доведе» · голос: Web Speech API браузера (Docs/dovede-voice-roadmap.md, Ф1·1 і Ф1·2). Безкоштовний, але слухає
 * лише живий мікрофон — готовий запис не приймає; Chrome шле звук до Google, Safari — до Apple, у Firefox його немає.
 * Спільний для лабораторії в адмінці й для мікрофона в полі питання.
 */

interface SpeechAlternativeLike {
  transcript: string;
}
interface SpeechResultLike {
  isFinal: boolean;
  0: SpeechAlternativeLike;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<SpeechResultLike> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function webSpeechSupported(): boolean {
  return recognitionCtor() !== null;
}

export interface WebSpeechResult {
  text: string;
  /** код помилки браузера (`not-allowed`, `no-speech`, `network`…) */
  error?: string;
}

export interface WebSpeechSession {
  /** зупиняє слухання; результат приходить у `result` */
  stop(): void;
  result: Promise<WebSpeechResult>;
}

export interface WebSpeechOptions {
  lang?: string;
  /** false — слухання саме завершується паузою (поле питання); true — до `stop()` (лабораторія) */
  continuous?: boolean;
  /** мікрофон справді слухає: тепер можна говорити (до цього початок фрази губиться) */
  onReady?: () => void;
  /** проміжний текст, поки людина ще говорить */
  onInterim?: (text: string) => void;
}

/** Починає слухати; текст — те, що браузер визнав остаточним (або останнє проміжне, якщо остаточного не було) */
export function startWebSpeech(opts: WebSpeechOptions = {}): WebSpeechSession {
  const { lang = 'uk-UA', continuous = true, onReady, onInterim } = opts;
  const Ctor = recognitionCtor();
  if (!Ctor) {
    return { stop: () => undefined, result: Promise.resolve({ text: '', error: 'unsupported' }) };
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = continuous;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finals: string[] = [];
  let interim = '';
  let error: string | undefined;
  const result = new Promise<WebSpeechResult>((resolve) => {
    rec.onresult = (e) => {
      const done: string[] = [];
      let live = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) done.push(r[0].transcript);
        else live = r[0].transcript;
      }
      finals = done;
      interim = live;
      if (onInterim) onInterim([...done, live].join(' ').replace(/\s+/g, ' ').trim());
    };
    let ready = false;
    const markReady = () => {
      if (ready) return;
      ready = true;
      onReady?.();
    };
    rec.onaudiostart = markReady;
    rec.onstart = markReady;
    rec.onerror = (e) => {
      error = e.error ?? 'error';
    };
    rec.onend = () => {
      const text = [...finals, finals.length ? '' : interim].join(' ').replace(/\s+/g, ' ').trim();
      resolve({ text, error: text ? undefined : error });
    };
  });
  try {
    rec.start();
  } catch {
    return { stop: () => undefined, result: Promise.resolve({ text: '', error: 'start-failed' }) };
  }
  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* вже зупинено */
      }
    },
    result,
  };
}
