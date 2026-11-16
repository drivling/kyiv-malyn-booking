/**
 * Ролик-вступ «Доведе» (Docs/dovede-roadmap.md, «Ролик-вступ»): хто вперше відкриває /dovede, спершу дивиться
 * тизер — ще до рядка пароля. Ролик не закривається й не перемотується (noSeek.ts). Фон — білий, як основний фон
 * останнього кадру, а смуги навколо 9:16 щокадру продовжують краї кадру (edgeFill.ts) — «вставленого відео» не видно;
 * рядок браузера (theme-color) — у колір верхнього краю.
 *
 * Звук без дотику браузери не вмикають: пробуємо грати одразу, а ні — фірмова крапка «▶ Дивитися». Ролик
 * закінчується білим кадром, на ньому — талон: компостер пробиває його, і крізь одну з дірок відкривається сама
 * сторінка (та сама «склейка через крапку», що в ролику). «Ще раз» — ролик спочатку.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { startEdgeFill } from './edgeFill';
import { INTRO_POSTER, INTRO_SECONDS, INTRO_VIDEO } from './introMedia';
import { markIntroSeen } from './introState';
import { guardNoSeek, type NoSeek } from './noSeek';
import { playPunch, playStamp } from './punchSound';
import { luckyTicketNumber, punchCells } from './ticket';
import './DovedeIntro.css';

type Phase = 'starting' | 'tap' | 'playing' | 'paused' | 'ticket' | 'punching' | 'opening';

const WHITE = '#ffffff';
/** Радіус пробитої дірки — як `.dv-talon__hole` у CSS */
const HOLE_R = 7;
const STRIKE_MS = 90;
const STAMP_MS = 260;
const IRIS_DELAY_MS = 560;
const IRIS_MS = 820;
const FADE_MS = 220;

const ENDED: Phase[] = ['ticket', 'punching', 'opening'];

function reducedMotion(): boolean {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Поки вступ на екрані: білий рядок браузера й без прокрутки; білий фон сторінки — доки не почали входити */
function useWhiteChrome(whiteBackground: boolean) {
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
    if (!whiteBackground) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.backgroundColor, body.style.backgroundColor];
    html.style.backgroundColor = WHITE;
    body.style.backgroundColor = WHITE;
    return () => {
      html.style.backgroundColor = prev[0];
      body.style.backgroundColor = prev[1];
    };
  }, [whiteBackground]);
}

const ReplayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M4 4.5v4.2h4.2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function DovedeIntro({ onTicket, onDone }: { onTicket: () => void; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fillRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const holeRef = useRef<HTMLSpanElement>(null);
  const ticketRef = useRef<HTMLButtonElement>(null);
  const guard = useRef<NoSeek | null>(null);
  const timers = useRef<number[]>([]);
  const frame = useRef(0);
  const [phase, setPhase] = useState<Phase>('starting');
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [talon] = useState(() => ({ no: luckyTicketNumber(), holes: punchCells() }));
  const callbacks = useRef({ onTicket, onDone });
  callbacks.current = { onTicket, onDone };

  useWhiteChrome(phase !== 'punching' && phase !== 'opening');

  const showTicket = useCallback((error: boolean) => {
    setFailed(error);
    setWaiting(false);
    setPhase((p) => (p === 'punching' || p === 'opening' ? p : 'ticket'));
    callbacks.current.onTicket();
  }, []);

  /** Грати зі звуком; без жесту браузер може відмовити — тоді кнопка «Дивитися» */
  const start = useCallback(
    (fromGesture: boolean) => {
      const video = videoRef.current;
      if (!video) return;
      video.muted = false;
      let result: Promise<void> | undefined;
      try {
        result = video.play();
      } catch (e) {
        result = Promise.reject(e);
      }
      Promise.resolve(result).then(
        () => setPhase((p) => (ENDED.includes(p) ? p : 'playing')),
        (e: unknown) => {
          const name = (e as { name?: string } | null)?.name;
          if (name === 'AbortError') return; // перервали самі (load/pause) — не помилка
          if (name === 'NotAllowedError' && !fromGesture) setPhase('tap');
          else showTicket(true);
        },
      );
    },
    [showTicket],
  );

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
    const stopFill = fillRef.current ? startEdgeFill(video, fillRef.current, (tone) => theme?.setAttribute('content', tone)) : () => {};
    start(false);
    const pending = timers.current;
    return () => {
      stopFill();
      guard.current?.release();
      pending.forEach((t) => window.clearTimeout(t));
      window.cancelAnimationFrame(frame.current);
    };
  }, [start]);

  // талон у фокусі — Enter / пробіл з клавіатури теж компостують
  useEffect(() => {
    if (phase === 'ticket') ticketRef.current?.focus({ preventScroll: true });
  }, [phase]);

  const replay = () => {
    const video = videoRef.current;
    if (!video || phase !== 'ticket') return;
    if (failed) video.load();
    setFailed(false);
    guard.current?.restart();
    setPhase('playing');
    start(true);
  };

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const setHole = (x: number, y: number, r: number) => {
    const root = rootRef.current;
    if (!root) return;
    const mask = `radial-gradient(circle at ${x}px ${y}px, transparent ${r}px, #000 ${r + 0.75}px)`;
    root.style.setProperty('-webkit-mask-image', mask);
    root.style.setProperty('mask-image', mask);
  };

  /** Компостер: клац, три дірки, штамп «щасливий» — і крізь першу дірку відкривається сторінка */
  const punch = () => {
    if (phase !== 'ticket') return;
    setPhase('punching');
    playPunch();
    try {
      navigator.vibrate?.(15);
    } catch {
      /* вібрації може не бути */
    }
    later(STAMP_MS, playStamp);

    if (reducedMotion()) {
      later(STAMP_MS + 80, () => setLeaving(true));
      later(STAMP_MS + 80 + FADE_MS, () => callbacks.current.onDone());
      return;
    }
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    later(STRIKE_MS, () => {
      // міряємо в мить удару: талон уже зупинився (анімація виїзду знята класом punching), а дірка ще стиснута в
      // точку (scale(0)) — її прямокутник і є центр
      const box = holeRef.current?.getBoundingClientRect();
      if (box) {
        x = box.left + box.width / 2;
        y = box.top + box.height / 2;
      }
      setHole(x, y, HOLE_R);
    });
    later(IRIS_DELAY_MS, () => {
      setPhase('opening');
      const far = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 2;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / IRIS_MS);
        // спершу сторінку видно лише в дірці, потім коло розкривається на весь екран
        setHole(x, y, HOLE_R + (far - HOLE_R) * p * p * p);
        if (p < 1) frame.current = window.requestAnimationFrame(step);
        else callbacks.current.onDone();
      };
      frame.current = window.requestAnimationFrame(step);
    });
  };

  const ended = ENDED.includes(phase);
  return (
    <div
      ref={rootRef}
      className={`dv-intro dv-intro--${phase}${leaving ? ' dv-intro--leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Ролик «Доведе.»"
    >
      <canvas ref={fillRef} className="dv-intro__fill" aria-hidden="true" />
      <video
        ref={videoRef}
        className="dv-intro__video"
        src={INTRO_VIDEO}
        poster={INTRO_POSTER}
        playsInline
        preload="auto"
        aria-label={`Ролик «Доведе.» (${INTRO_SECONDS} с) з титрами`}
        onContextMenu={(e) => e.preventDefault()}
        onPlaying={() => {
          setWaiting(false);
          setPhase((p) => (ENDED.includes(p) ? p : 'playing'));
        }}
        onWaiting={() => setWaiting(true)}
        onPause={(e) => {
          if (!e.currentTarget.ended) setPhase((p) => (p === 'playing' ? 'paused' : p));
        }}
        onEnded={() => {
          markIntroSeen();
          showTicket(false);
        }}
        onError={() => showTicket(true)}
      />

      {phase === 'tap' || phase === 'paused' ? (
        <button
          type="button"
          className="dv-intro__play"
          onClick={() => start(true)}
          aria-label={phase === 'paused' ? 'Продовжити' : `Дивитися ролик, ${INTRO_SECONDS} с, зі звуком`}
        >
          <span className="dv-intro__dot" aria-hidden="true" />
          <span className="dv-intro__label">{phase === 'paused' ? 'Продовжити' : `Дивитися · ${INTRO_SECONDS} с`}</span>
          {phase === 'tap' ? <span className="dv-intro__sub">зі звуком</span> : null}
        </button>
      ) : null}

      {waiting && phase === 'playing' ? <span className="dv-intro__wait" role="status" aria-label="Завантажую ролик" /> : null}

      {ended ? (
        <div className="dv-intro__end">
          <p className="dv-intro__hint">Прокомпостуйте квиток, щоб увійти</p>
          <span className="dv-talon-wrap">
            <span className="dv-talon__jaw" aria-hidden="true" />
            <button
              ref={ticketRef}
              type="button"
              className="dv-talon"
              onClick={punch}
              aria-label="Прокомпостувати квиток і увійти"
              aria-disabled={phase !== 'ticket' ? true : undefined}
            >
              <span className="dv-talon__body">
                <span className="dv-talon__brand">
                  Доведе<span>.</span>
                </span>
                <span className="dv-talon__kind">Квиток на проїзд</span>
                <span className="dv-talon__route">Малин → куди скажете</span>
                <span className="dv-talon__no">Серія ДВ № {talon.no}</span>
              </span>
              <span className="dv-talon__grid" aria-hidden="true">
                {Array.from({ length: 9 }, (_, i) => {
                  const order = talon.holes.indexOf(i);
                  return (
                    <span key={i} className="dv-talon__cell">
                      <span className="dv-talon__digit">{i + 1}</span>
                      {order >= 0 ? (
                        <span
                          ref={order === 0 ? holeRef : undefined}
                          className="dv-talon__hole"
                          style={{ animationDelay: `${STRIKE_MS + order * 25}ms` }}
                        />
                      ) : null}
                    </span>
                  );
                })}
              </span>
              <span className="dv-talon__stamp" aria-hidden="true">
                щасливий
              </span>
            </button>
          </span>
          {failed ? <p className="dv-intro__failed">Відео не завантажилося.</p> : null}
          <button type="button" className="dv-intro__again" onClick={replay} disabled={phase !== 'ticket'}>
            <ReplayIcon />
            Ще раз
          </button>
        </div>
      ) : null}
    </div>
  );
}
