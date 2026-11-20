import { afterEach, describe, expect, it } from 'vitest';
import { HINT_SEEN_KEY, WELCOME_SEEN_KEY, stickerAdFor, stickerAdVideoFor } from './stickerAd';

const scan = (stopId: string) => `?utm_source=sticker&utm_medium=qr&utm_campaign=${stopId}-a`;

describe('stickerAd: який ролик показати перед табло після скану наклейки', () => {
  afterEach(() => {
    localStorage.removeItem(HINT_SEEN_KEY);
    localStorage.removeItem(WELCOME_SEEN_KEY);
    sessionStorage.clear();
  });

  it('вокзал Малина — привітання, решта зупинок — тизер; вокзал іншого міста — теж тизер', () => {
    expect(stickerAdVideoFor('st_0019', 'Malyn')).toBe('welcome');
    expect(stickerAdVideoFor('st_0004', 'Malyn')).toBe('hint');
    expect(stickerAdVideoFor('st_0019', 'Korosten')).toBe('hint');
    expect(stickerAdVideoFor('st_1001', 'Korosten')).toBe('hint');
  });

  it('не зі скану — нічого', () => {
    expect(stickerAdFor('')).toBeNull();
    expect(stickerAdFor('?utm_source=reload&utm_medium=qr&utm_campaign=st_0019-a')).toBeNull();
  });

  it('у кожного ролика своя позначка «бачив»: тизер не скасовує привітання на вокзалі й навпаки', () => {
    expect(stickerAdFor(scan('st_0019'))).toEqual({ stopId: 'st_0019', video: 'welcome' });
    expect(stickerAdFor(scan('st_0004'))).toEqual({ stopId: 'st_0004', video: 'hint' });

    localStorage.setItem(HINT_SEEN_KEY, '2026-11-20T00:00:00.000Z');
    expect(stickerAdFor(scan('st_0004'))).toBeNull();
    expect(stickerAdFor(scan('st_0019'))).toEqual({ stopId: 'st_0019', video: 'welcome' });

    localStorage.setItem(WELCOME_SEEN_KEY, '2026-11-20T00:00:00.000Z');
    // на вокзалі після привітання — одразу табло: «Крапку» там не показуємо
    expect(stickerAdFor(scan('st_0019'))).toBeNull();

    localStorage.removeItem(HINT_SEEN_KEY);
    expect(stickerAdFor(scan('st_0019'))).toBeNull();
    expect(stickerAdFor(scan('st_0004'))).toEqual({ stopId: 'st_0004', video: 'hint' });
  });
});
