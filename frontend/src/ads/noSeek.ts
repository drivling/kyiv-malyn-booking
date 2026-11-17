/**
 * Ролик не перемотується ні вперед, ні назад: памʼятаємо, докуди він дійшов, і повертаємо туди, якщо час стрибнув
 * (повзунок системного плеєра, клавіші, кнопки навушників). Швидкість — завжди 1. Кнопки перемотки в
 * `navigator.mediaSession` (системний плеєр, екран блокування) нічого не роблять, доки вступ на екрані.
 */
const SEEK_ACTIONS = ['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as const;
/** Між двома `timeupdate` ролик проходить до ~0,3 с — більший стрибок уже перемотка */
const JUMP_SEC = 0.75;

export type NoSeek = {
  /** «Ще раз»: дозволений стрибок на початок */
  restart: () => void;
  release: () => void;
};

export function guardNoSeek(video: HTMLVideoElement): NoSeek {
  let reached = video.currentTime;
  const onTime = () => {
    if (!video.seeking) reached = video.currentTime;
  };
  const onSeeking = () => {
    if (Math.abs(video.currentTime - reached) > JUMP_SEC) video.currentTime = reached;
  };
  const onRate = () => {
    if (video.playbackRate !== 1) video.playbackRate = 1;
  };
  video.addEventListener('timeupdate', onTime);
  video.addEventListener('seeking', onSeeking);
  video.addEventListener('ratechange', onRate);

  const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  const setAll = (handler: (() => void) | null) => {
    for (const action of SEEK_ACTIONS) {
      try {
        session?.setActionHandler(action, handler);
      } catch {
        /* дія не підтримується цим браузером */
      }
    }
  };
  setAll(() => {});

  return {
    restart() {
      reached = 0;
      video.currentTime = 0;
    },
    release() {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('ratechange', onRate);
      setAll(null);
    },
  };
}
