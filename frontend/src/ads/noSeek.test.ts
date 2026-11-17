import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardNoSeek } from './noSeek';

/** Відео-заглушка: jsdom не грає медіа, тож час і події ставимо самі */
class FakeVideo extends EventTarget {
  currentTime = 0;
  seeking = false;
  playbackRate = 1;
  at(t: number) {
    this.currentTime = t;
    this.dispatchEvent(new Event('timeupdate'));
  }
  seekTo(t: number) {
    this.currentTime = t;
    this.dispatchEvent(new Event('seeking'));
  }
}

const asVideo = (v: FakeVideo) => v as unknown as HTMLVideoElement;

describe('ролик-вступ: без перемотки', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('стрибок уперед і назад повертається туди, докуди ролик дійшов', () => {
    const video = new FakeVideo();
    guardNoSeek(asVideo(video));
    video.at(12.4);
    video.seekTo(40);
    expect(video.currentTime).toBe(12.4);
    video.seekTo(2);
    expect(video.currentTime).toBe(12.4);
  });

  it('звичайне відтворення (крок між timeupdate) не вважається перемоткою', () => {
    const video = new FakeVideo();
    guardNoSeek(asVideo(video));
    video.at(5);
    video.seekTo(5.3);
    expect(video.currentTime).toBe(5.3);
  });

  it('швидкість завжди 1', () => {
    const video = new FakeVideo();
    guardNoSeek(asVideo(video));
    video.playbackRate = 2;
    video.dispatchEvent(new Event('ratechange'));
    expect(video.playbackRate).toBe(1);
  });

  it('«Ще раз» — дозволений стрибок на початок; після release охорони немає', () => {
    const video = new FakeVideo();
    const guard = guardNoSeek(asVideo(video));
    video.at(54);
    guard.restart();
    expect(video.currentTime).toBe(0);
    video.seekTo(0.1);
    expect(video.currentTime).toBe(0.1);
    guard.release();
    video.seekTo(30);
    expect(video.currentTime).toBe(30);
  });

  it('кнопки перемотки системного плеєра нічого не роблять, доки вступ на екрані', () => {
    const setActionHandler = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, mediaSession: { setActionHandler } });
    const guard = guardNoSeek(asVideo(new FakeVideo()));
    const actions = setActionHandler.mock.calls.map(([action]) => action);
    expect(actions).toEqual(['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack']);
    for (const [, handler] of setActionHandler.mock.calls) expect(typeof handler).toBe('function');
    guard.release();
    expect(setActionHandler.mock.calls.slice(5).every(([, handler]) => handler === null)).toBe(true);
    vi.unstubAllGlobals();
  });
});
