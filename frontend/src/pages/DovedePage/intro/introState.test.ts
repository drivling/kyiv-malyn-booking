import { afterEach, describe, expect, it, vi } from 'vitest';
import { INTRO_SEEN_KEY, introSeen, markIntroSeen } from './introState';

describe('ролик-вступ «Доведе»: хто вже бачив', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('новий відвідувач — не бачив; досмотрив — памʼятаємо в localStorage', () => {
    expect(introSeen()).toBe(false);
    markIntroSeen(new Date('2026-11-16T10:00:00Z'));
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBe('2026-11-16T10:00:00.000Z');
    expect(introSeen()).toBe(true);
  });

  it('ключ — dovede-intro:v2 (новий ролик для всіх = новий ключ; v1 → v2 2026-11-18)', () => {
    expect(INTRO_SEEN_KEY).toBe('dovede-intro:v2');
  });

  it('localStorage недоступний для запису — памʼятаємо в sessionStorage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    markIntroSeen();
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(INTRO_SEEN_KEY)).not.toBeNull();
    expect(introSeen()).toBe(true);
  });
});
