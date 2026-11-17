/**
 * Розмітка рекламного ролика на весь екран (стан — useAdVideo.ts): полотно полів і відео, кнопка «▶ Дивитися» /
 * «Продовжити», крапка очікування. Стилі — adVideo.css (класи .dv-intro*).
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

export const AdWait: React.FC<{ show: boolean }> = ({ show }) => (show ? <span className="dv-intro__wait" role="status" aria-label="Завантажую ролик" /> : null);

