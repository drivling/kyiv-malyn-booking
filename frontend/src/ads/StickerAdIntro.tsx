/**
 * Ролик перед табло зупинки (stickerAd.ts): міні-тизер «Крапка» або привітання «Вітаємо в Малині» (8 с) на весь екран —
 * так само, як вступ /dovede (useAdVideo.ts: без перемотки, поля в колір кадру). Після скану QR людина ще нічого не
 * торкалась, тож звук браузер не дасть: ролик одразу йде без звуку (`silentStart`), а звук вмикає «Увімкнути звук»;
 * «▶ Дивитися» — лише коли браузер не грає навіть без звуку. Табло відкривається колом із тієї точки кадру, де ролик лишив крапку. Табло під роликом уже завантажується;
 * поки ролик на екрані, сторінка (#root) недоступна для фокусу й читача екрана.
 * Облік: shown / started / completed → POST /ads/events (placement sticker, зупинка з наклейки, назва ролика).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AdPlayButton, AdSoundButton, AdVideoLayer, AdWait } from './AdVideo';
import { framePoint, openIris, reducedMotion, useAdChrome, useAdVideo, type AdVideoHandlers } from './useAdVideo';
import { newViewId, trackAd } from './adEvents';
import { HINT_NAME, HINT_POSTER, HINT_SECONDS, HINT_VIDEO } from './hintMedia';
import { markSeen } from './seen';
import { HINT_SEEN_KEY, WELCOME_SEEN_KEY, type StickerAdVideo } from './stickerAd';
import { WELCOME_NAME, WELCOME_POSTER, WELCOME_SECONDS, WELCOME_VIDEO } from './welcomeMedia';

/**
 * Ролики: файл, позначка «бачив», підписи й точка кадру 1080×1920, з якої відкривається табло —
 * у тизері там згасає крапка (центр безпечної зони сторіс), у привітанні вона стоїть крапкою після «в Малині»
 * (scripts/teaser/scene.html; інший текст чи кегль — переміряти)
 */
const VIDEOS: Record<StickerAdVideo, { src: string; poster: string; seconds: number; name: string; seenKey: string; title: string; dot: { x: number; y: number } }> = {
  hint: { src: HINT_VIDEO, poster: HINT_POSTER, seconds: HINT_SECONDS, name: HINT_NAME, seenKey: HINT_SEEN_KEY, title: 'Ролик «Доведе.»', dot: { x: 540, y: 902 } },
  welcome: { src: WELCOME_VIDEO, poster: WELCOME_POSTER, seconds: WELCOME_SECONDS, name: WELCOME_NAME, seenKey: WELCOME_SEEN_KEY, title: 'Ролик «Вітаємо в Малині»', dot: { x: 941, y: 1027 } },
};
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

export default function StickerAdIntro({ stopId, video = 'hint', onDone }: { stopId: string; video?: StickerAdVideo; onDone: () => void }) {
  const clip = VIDEOS[video];
  const rootRef = useRef<HTMLDivElement>(null);
  const cancel = useRef<() => void>(() => {});
  const [viewId] = useState(newViewId);
  const [opening, setOpening] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const track = (event: 'shown' | 'started' | 'completed') => trackAd({ placement: 'sticker', event, viewId, video: clip.name, stopId });

  const handlers: AdVideoHandlers = {
    onStarted: () => track('started'),
    onEnded: () => {
      markSeen(clip.seenKey);
      track('completed');
      if (reducedMotion()) {
        setLeaving(true);
        window.setTimeout(() => done.current(), FADE_MS);
        return;
      }
      // табло — з тієї точки, де ролик лишив крапку
      const p = framePoint(ad.videoRef.current, clip.dot.x, clip.dot.y);
      setOpening(true);
      cancel.current = openIris(rootRef.current, p.x, p.y, 6, IRIS_MS, () => done.current());
    },
    // ролик не завантажився — людина прийшла по розклад: просто показуємо табло (тизер — наступного разу)
    onFailed: () => {
      setLeaving(true);
      window.setTimeout(() => done.current(), FADE_MS);
    },
  };
  const ad = useAdVideo(handlers, { silentStart: true });

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
      aria-label={`${clip.title} перед розкладом зупинки`}
      style={{ backgroundColor: ad.tone }}
    >
      <AdVideoLayer src={clip.src} poster={clip.poster} label={`${clip.title} (${clip.seconds} с), далі — розклад зупинки`} fillRef={ad.fillRef} videoProps={ad.videoProps} />
      {opening ? null : <AdPlayButton phase={ad.phase} seconds={clip.seconds} onStart={() => ad.start(true)} />}
      <AdSoundButton show={ad.muted && ad.phase === 'playing' && !opening && !leaving} onUnmute={ad.unmute} />
      <AdWait show={ad.waiting && ad.phase === 'playing'} />
    </div>,
    document.body,
  );
}
