/**
 * Розмітка рекламного ролика на весь екран (стан — useAdVideo.ts): полотно полів і відео, кнопка «▶ Дивитися» /
 * «Продовжити», «Увімкнути звук» для ролика, що пішов без нього, крапка очікування. Стилі — adVideo.css (класи .dv-intro*).
 */
import type React from 'react';
import type { AdPhase, useAdVideo } from './useAdVideo';
import './adVideo.css';

/** Полотно полів і саме відео — без пульта, кліки йдуть повз нього */
export const AdVideoLayer: React.FC<{
  src: string;
  poster: string;
  label: string;
  fillRef: React.RefObject<HTMLCanvasElement>;
  videoProps: ReturnType<typeof useAdVideo>['videoProps'];
}> = ({ src, poster, label, fillRef, videoProps }) => (
  <>
    <canvas ref={fillRef} className="dv-intro__fill" aria-hidden="true" />
    <video
      {...videoProps}
      className="dv-intro__video"
      src={src}
      poster={poster}
      playsInline
      preload="auto"
      aria-label={label}
      onContextMenu={(e) => e.preventDefault()}
    />
  </>
);

/** «▶ Дивитися · N с, зі звуком» (браузер не дав звук без дотику) чи «Продовжити» (пауза не від людини) */
export const AdPlayButton: React.FC<{ phase: AdPhase; seconds: number; onStart: () => void }> = ({ phase, seconds, onStart }) =>
  phase === 'tap' || phase === 'paused' ? (
    <button type="button" className="dv-intro__play" onClick={onStart} aria-label={phase === 'paused' ? 'Продовжити' : `Дивитися ролик, ${seconds} с, зі звуком`}>
      <span className="dv-intro__dot" aria-hidden="true" />
      <span className="dv-intro__label">{phase === 'paused' ? 'Продовжити' : `Дивитися · ${seconds} с`}</span>
      {phase === 'tap' ? <span className="dv-intro__sub">зі звуком</span> : null}
    </button>
  ) : null;

/** «Увімкнути звук»: ролик пішов без звуку, бо браузер не дав інакше (useAdVideo `silentStart`) */
export const AdSoundButton: React.FC<{ show: boolean; onUnmute: () => void }> = ({ show, onUnmute }) =>
  show ? (
    <button type="button" className="dv-intro__sound" onClick={onUnmute}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" stroke="none" />
        <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
        <path d="M18.3 6.3a8 8 0 0 1 0 11.4" />
      </svg>
      Увімкнути звук
    </button>
  ) : null;

export const AdWait: React.FC<{ show: boolean }> = ({ show }) => (show ? <span className="dv-intro__wait" role="status" aria-label="Завантажую ролик" /> : null);

