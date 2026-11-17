/**
 * Міні-тизер «Доведе» перед табло зупинки (stickerAd.ts): ролик «Крапка» (8 с) на весь екран — так само, як вступ
 * /dovede (useAdVideo.ts: без перемотки, поля в колір кадру, «▶ Дивитися», коли браузер не дає звук). Ролик закінчується
 * білим кадром там, де згасла крапка, — і табло відкривається колом саме з цієї точки. Табло під тизером уже
 * завантажується; поки тизер на екрані, сторінка (#root) недоступна для фокусу й читача екрана.
 * Облік: shown / started / completed → POST /ads/events (placement sticker, зупинка з наклейки).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AdPlayButton, AdVideoLayer, AdWait } from './AdVideo';
import { framePoint, openIris, reducedMotion, useAdChrome, useAdVideo } from './useAdVideo';
import { newViewId, trackAd } from './adEvents';
import { HINT_NAME, HINT_POSTER, HINT_SECONDS, HINT_VIDEO } from './hintMedia';
import { markSeen } from './seen';
import { HINT_SEEN_KEY } from './stickerAd';

/** Де в кадрі згасає крапка тизера (video/src/hints/Hints.tsx: центр безпечної зони сторіс) */
const DOT_FRAME = { x: 540, y: 902 };
const IRIS_MS = 760;
const FADE_MS = 220;

/** #root недоступний, поки тизер на екрані: тизер — у порталі поза ним */
function useRootInert(active: boolean) {
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root || !active) return;
    root.inert = true;
    root.setAttribute('aria-hidden', 'true');
    return () => {
      root.inert = false;
      root.removeAttribute('aria-hidden');
    };
  }, [active]);
}

export default function StickerAdIntro({ stopId, onDone }: { stopId: string; onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cancel = useRef<() => void>(() => {});
  const [viewId] = useState(newViewId);
  const [opening, setOpening] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const track = (event: 'shown' | 'started' | 'completed') => trackAd({ placement: 'sticker', event, viewId, video: HINT_NAME, stopId });

  const ad = useAdVideo({
    onStarted: () => track('started'),
    onEnded: () => {
      markSeen(HINT_SEEN_KEY);
      track('completed');
      if (reducedMotion()) {
        setLeaving(true);
        window.setTimeout(() => done.current(), FADE_MS);
        return;
      }
      // табло — з тієї точки, де щойно згасла крапка
      const p = framePoint(ad.videoRef.current, DOT_FRAME.x, DOT_FRAME.y);
      setOpening(true);
      cancel.current = openIris(rootRef.current, p.x, p.y, 6, IRIS_MS, () => done.current());
    },
    // ролик не завантажився — людина прийшла по розклад: просто показуємо табло (тизер — наступного разу)
    onFailed: () => {
      setLeaving(true);
      window.setTimeout(() => done.current(), FADE_MS);
    },
  });

  useAdChrome(!opening && !leaving, ad.tone);
  useRootInert(true);
  const trackRef = useRef(track);
  trackRef.current = track;
  // показали — раз на показ; коло — прибрати, якщо тизер зникне посеред анімації
  useEffect(() => {
    trackRef.current('shown');
    const stop = cancel;
    return () => stop.current();
  }, []);

  return createPortal(
    <div
      ref={rootRef}
      className={`dv-intro dv-intro--${opening ? 'opening' : ad.phase}${leaving ? ' dv-intro--leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Ролик «Доведе.» перед розкладом зупинки"
      style={{ backgroundColor: ad.tone }}
    >
      <AdVideoLayer src={HINT_VIDEO} poster={HINT_POSTER} label={`Ролик «Доведе.» (${HINT_SECONDS} с), далі — розклад зупинки`} fillRef={ad.fillRef} videoProps={ad.videoProps} />
      {opening ? null : <AdPlayButton phase={ad.phase} seconds={HINT_SECONDS} onStart={() => ad.start(true)} />}
      <AdWait show={ad.waiting && ad.phase === 'playing'} />
    </div>,
    document.body,
  );
}
