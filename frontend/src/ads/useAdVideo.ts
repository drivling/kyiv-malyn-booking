/**
 * Рекламний ролик на весь екран — спільна механіка ролика-вступу «Доведе» (DovedePage/intro/DovedeIntro.tsx) і
 * міні-тизера перед табло зупинки (StickerAdIntro.tsx):
 * - ролик не закривається й не перемотується (noSeek.ts), без пульта, картинки в картинці й AirPlay;
 * - поля навколо 9:16 продовжують краї кадру (edgeFill.ts), рядок браузера й фон сторінки — у колір верхнього краю;
 * - звук без дотику браузери не вмикають: пробуємо грати одразу, а ні — фірмова крапка «▶ Дивитися» (AdPlayButton);
 *   з `silentStart` (міні-тизер) ролик у такому разі одразу йде без звуку, а звук вмикає кнопка «Увімкнути звук»
 *   (AdSoundButton); «▶ Дивитися» лишається на випадок, коли браузер не дає грати навіть без звуку;
 * - сторінка відкривається колом (`openIris`) — «склейка через крапку», як у ролику.
 * Що показати після ролику (талон, одразу сторінка), вирішує той, хто вбудовує. Тут — стан і помічники; розмітка —
 * AdVideo.tsx.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { startEdgeFill } from './edgeFill';
import { guardNoSeek, type NoSeek } from './noSeek';

export type AdPhase = 'starting' | 'tap' | 'playing' | 'paused' | 'ended' | 'failed';

const WHITE = '#ffffff';

export function reducedMotion(): boolean {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Поки ролик на екрані: без прокрутки, рядок браузера в колір кадру; фон сторінки — доки її не почали відкривати */
export function useAdChrome(paintBackground: boolean, tone: string) {
  useEffect(() => {
    const html = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prev = { overflow: html.style.overflow, theme: meta?.getAttribute('content') ?? null };
    html.style.overflow = 'hidden';
    meta?.setAttribute('content', WHITE);
    return () => {
      html.style.overflow = prev.overflow;
      if (meta && prev.theme != null) meta.setAttribute('content', prev.theme);
    };
  }, []);
  useEffect(() => {
    if (!paintBackground) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.backgroundColor, body.style.backgroundColor];
    html.style.backgroundColor = tone;
    body.style.backgroundColor = tone;
    return () => {
      html.style.backgroundColor = prev[0];
      body.style.backgroundColor = prev[1];
    };
  }, [paintBackground, tone]);
}

export type AdVideoHandlers = {
  /** Почав грати (перший раз і після «Ще раз») */
  onStarted?: () => void;
  /** Досмотрено до кінця */
  onEnded: () => void;
  /** Не завантажився чи не грає — людина не має застрягти */
  onFailed: () => void;
};

export type AdVideoOptions = {
  /** Браузер не дав грати зі звуком без дотику — почати без звуку (не чекати на «▶ Дивитися») */
  silentStart?: boolean;
};

/**
 * Стан ролика й обробники для `<AdVideoLayer>`; `start(true)` — з дотику людини, `replay()` — спочатку,
 * `unmute()` — увімкнути звук ролика, що пішов без нього (лише з дотику людини)
 */
export function useAdVideo(handlers: AdVideoHandlers, options: AdVideoOptions = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fillRef = useRef<HTMLCanvasElement>(null);
  const guard = useRef<NoSeek | null>(null);
  const [phase, setPhase] = useState<AdPhase>('starting');
  const [waiting, setWaiting] = useState(false);
  /** Грає без звуку, бо браузер не дав інакше (silentStart) */
  const [muted, setMuted] = useState(false);
  const silentStart = !!options.silentStart;
  /** Колір верхнього краю кадру (edgeFill.ts) — для theme-color і фону сторінки */
  const [tone, setTone] = useState(WHITE);
  const cb = useRef(handlers);
  cb.current = handlers;
  /** Чи вже повідомили «почав грати» для цього перегляду (пауза й продовження — той самий перегляд) */
  const started = useRef(false);

  const fail = useCallback(() => {
    setWaiting(false);
    setPhase((p) => (p === 'ended' ? p : 'failed'));
    cb.current.onFailed();
  }, []);

  const start = useCallback(
    (fromGesture: boolean) => {
      const video = videoRef.current;
      if (!video) return;
      const play = (): Promise<void> => {
        try {
          return Promise.resolve(video.play());
        } catch (e) {
          return Promise.reject(e);
        }
      };
      const errorName = (e: unknown) => (e as { name?: string } | null)?.name;
      const playing = () => setPhase((p) => (p === 'ended' || p === 'failed' ? p : 'playing'));
      video.muted = false;
      setMuted(false);
      play().then(playing, (e: unknown) => {
        const name = errorName(e);
        if (name === 'AbortError') return; // перервали самі (load/pause) — не помилка
        if (name !== 'NotAllowedError' || fromGesture) return fail();
        if (!silentStart) return setPhase('tap');
        // зі звуком не можна — без звуку браузери грають і без дотику
        video.muted = true;
        play().then(
          () => {
            setMuted(true);
            playing();
          },
          (e2: unknown) => {
            const name2 = errorName(e2);
            if (name2 === 'AbortError') return;
            video.muted = false;
            if (name2 === 'NotAllowedError') setPhase('tap');
            else fail();
          },
        );
      });
    },
    [fail, silentStart],
  );

  /** Увімкнути звук ролика, що пішов без нього; браузер дозволяє це лише в обробнику дотику */
  const unmute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setMuted(false);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // атрибутів, яких React 18 не знає: без картинки в картинці, AirPlay, кнопок системного плеєра
    for (const [name, value] of [
      ['disablepictureinpicture', ''],
      ['disableremoteplayback', ''],
      ['x-webkit-airplay', 'deny'],
      ['webkit-playsinline', ''],
      ['controlslist', 'nodownload nofullscreen noremoteplayback noplaybackrate'],
    ]) {
      video.setAttribute(name, value);
    }
    guard.current = guardNoSeek(video);
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const stopFill = fillRef.current
      ? startEdgeFill(video, fillRef.current, (next) => {
          theme?.setAttribute('content', next);
          setTone(next);
        })
      : () => {};
    start(false);
    return () => {
      stopFill();
      guard.current?.release();
    };
  }, [start]);

  /** «Ще раз»: ролик спочатку; після помилки — ще одна спроба завантажити */
  const replay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (phase === 'failed') video.load();
    started.current = false;
    guard.current?.restart();
    setPhase('playing');
    start(true);
  }, [phase, start]);

  const videoProps: React.VideoHTMLAttributes<HTMLVideoElement> & { ref: React.RefObject<HTMLVideoElement> } = {
    ref: videoRef,
    onPlaying: () => {
      setWaiting(false);
      setPhase((p) => (p === 'ended' || p === 'failed' ? p : 'playing'));
      if (!started.current) {
        started.current = true;
        cb.current.onStarted?.();
      }
    },
    onWaiting: () => setWaiting(true),
    onPause: (e) => {
      if (!e.currentTarget.ended) setPhase((p) => (p === 'playing' ? 'paused' : p));
    },
    onEnded: () => {
      setWaiting(false);
      setPhase('ended');
      cb.current.onEnded();
    },
    onError: () => fail(),
  };

  return { videoRef, fillRef, videoProps, phase, waiting, tone, muted, start, replay, unmute };
}

/** Дірка в оверлеї: крізь неї видно сторінку під ним */
export function setHole(root: HTMLElement | null, x: number, y: number, r: number) {
  if (!root) return;
  const mask = `radial-gradient(circle at ${x}px ${y}px, transparent ${r}px, #000 ${r + 0.75}px)`;
  root.style.setProperty('-webkit-mask-image', mask);
  root.style.setProperty('mask-image', mask);
}

/**
 * Коло, що розкривається з точки (x, y) на весь екран: спершу сторінку видно лише в дірці, потім — усю. Повертає
 * скасування (для розмонтування посеред анімації).
 */
export function openIris(root: HTMLElement | null, x: number, y: number, from: number, ms: number, onDone: () => void): () => void {
  const far = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 2;
  const t0 = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / ms);
    setHole(root, x, y, from + (far - from) * p * p * p);
    if (p < 1) frame = window.requestAnimationFrame(step);
    else onDone();
  };
  frame = window.requestAnimationFrame(step);
  return () => window.cancelAnimationFrame(frame);
}

/** Де на екрані точка кадру (`fx`, `fy` — пікселі кадру) при object-fit: contain на весь екран */
export function framePoint(video: HTMLVideoElement | null, fx: number, fy: number): { x: number; y: number; scale: number } {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const vw = video?.videoWidth || 1080;
  const vh = video?.videoHeight || 1920;
  const scale = Math.min(w / vw, h / vh);
  return { x: (w - vw * scale) / 2 + fx * scale, y: (h - vh * scale) / 2 + fy * scale, scale };
}
