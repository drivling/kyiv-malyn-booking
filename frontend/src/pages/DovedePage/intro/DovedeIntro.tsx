/**
 * Ролик-вступ «Доведе» (Docs/dovede-roadmap.md, «Ролик-вступ»): хто вперше відкриває /dovede, спершу дивиться
 * тизер — ще до рядка пароля. Сам ролик — спільна механіка ads/useAdVideo.ts + ads/AdVideo.tsx (без перемотки, поля в колір кадру,
 * «▶ Дивитися», коли браузер не дає звук). Safari на iOS 26+ власні смуги під годинником і за нижньою панеллю на ходу
 * не перефарбовує (перевірено в симуляторі) — вони лишаються білими, як перший і останній кадр.
 *
 * Ролик закінчується білим кадром, на ньому — талон: компостер пробиває його, і крізь одну з дірок відкривається сама
 * сторінка (та сама «склейка через крапку», що в ролику). «Ще раз» — ролик спочатку.
 */
import { useEffect, useRef, useState } from 'react';
import { AdPlayButton, AdVideoLayer, AdWait } from '@/ads/AdVideo';
import { openIris, reducedMotion, setHole, useAdChrome, useAdVideo } from '@/ads/useAdVideo';
import { INTRO_POSTER, INTRO_SECONDS, INTRO_VIDEO } from './introMedia';
import { markIntroSeen } from './introState';
import { playPunch, playStamp } from './punchSound';
import { luckyTicketNumber, punchCells } from './ticket';
import './DovedeIntro.css';

/** Після ролика: талон, компостування, коло, що відкриває сторінку */
type End = 'ticket' | 'punching' | 'opening';

/** Радіус пробитої дірки — як `.dv-talon__hole` у CSS */
const HOLE_R = 7;
const STRIKE_MS = 90;
const STAMP_MS = 260;
const IRIS_DELAY_MS = 560;
const IRIS_MS = 820;
const FADE_MS = 220;

/** Прибрати за собою, коли вступ зникає */
function useUnmount(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => () => ref.current(), []);
}

/** Події перегляду (для обліку реклами): показали, почав грати, досмотрів, прокомпостував талон (стіна наклейок святкує) */
export type IntroEvent = 'shown' | 'started' | 'completed' | 'punched';

const ReplayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M4 4.5v4.2h4.2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function DovedeIntro({ onTicket, onDone, onEvent }: { onTicket: () => void; onDone: () => void; onEvent?: (e: IntroEvent) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const holeRef = useRef<HTMLSpanElement>(null);
  const timers = useRef<number[]>([]);
  const cancelIris = useRef<() => void>(() => {});
  const [end, setEnd] = useState<End | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [talon] = useState(() => ({ no: luckyTicketNumber(), holes: punchCells() }));
  const callbacks = useRef({ onTicket, onDone, onEvent });
  callbacks.current = { onTicket, onDone, onEvent };

  const showTicket = () => {
    setEnd((e) => e ?? 'ticket');
    callbacks.current.onTicket();
  };
  const ad = useAdVideo({
    onStarted: () => callbacks.current.onEvent?.('started'),
    onEnded: () => {
      markIntroSeen();
      callbacks.current.onEvent?.('completed');
      showTicket();
    },
    onFailed: showTicket,
  });
  const failed = ad.phase === 'failed';

  useAdChrome(end !== 'punching' && end !== 'opening', ad.tone);

  // показали (повтор у StrictMode сервер відкине за viewId + подією)
  useEffect(() => {
    callbacks.current.onEvent?.('shown');
  }, []);
  // таймери й коло — прибрати, якщо вступ зникне посеред анімації
  const pending = timers.current;
  useUnmount(() => {
    pending.forEach((t) => window.clearTimeout(t));
    cancelIris.current();
  });

  const replay = () => {
    if (end !== 'ticket') return;
    setEnd(null);
    ad.replay();
  };

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  /** Компостер: клац, три дірки, штамп «щасливий» — і крізь першу дірку відкривається сторінка */
  const punch = () => {
    if (end !== 'ticket') return;
    setEnd('punching');
    callbacks.current.onEvent?.('punched');
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
      setHole(rootRef.current, x, y, HOLE_R);
    });
    later(IRIS_DELAY_MS, () => {
      setEnd('opening');
      cancelIris.current = openIris(rootRef.current, x, y, HOLE_R, IRIS_MS, () => callbacks.current.onDone());
    });
  };

  const shown = end ?? ad.phase;
  return (
    <div
      ref={rootRef}
      className={`dv-intro dv-intro--${shown}${leaving ? ' dv-intro--leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Ролик «Доведе.»"
      style={{ backgroundColor: ad.tone }}
    >
      <AdVideoLayer src={INTRO_VIDEO} poster={INTRO_POSTER} label={`Ролик «Доведе.» (${INTRO_SECONDS} с) з титрами`} fillRef={ad.fillRef} videoProps={ad.videoProps} />
      {end ? null : <AdPlayButton phase={ad.phase} seconds={INTRO_SECONDS} onStart={() => ad.start(true)} />}
      <AdWait show={ad.waiting && ad.phase === 'playing' && !end} />

      {end ? (
        <div className="dv-intro__end">
          <p className="dv-intro__hint">Прокомпостуйте квиток, щоб увійти</p>
          <span className="dv-talon-wrap">
            <span className="dv-talon__jaw" aria-hidden="true" />
            {/* без автофокусу: Safari на телефоні малює рамку фокусу; з клавіатури талон — перший Tab */}
            <button
              type="button"
              className="dv-talon"
              onClick={punch}
              aria-label="Прокомпостувати квиток і увійти"
              aria-disabled={end !== 'ticket' ? true : undefined}
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
          <button type="button" className="dv-intro__again" onClick={replay} disabled={end !== 'ticket'}>
            <ReplayIcon />
            Ще раз
          </button>
        </div>
      ) : null}
    </div>
  );
}
