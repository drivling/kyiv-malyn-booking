import { afterEach, describe, expect, it, vi } from 'vitest';
import { AD_SEEN_KEYS, HINT_SEEN_KEY, KOROSTEN_WELCOME_SEEN_KEY, WELCOME_SEEN_KEY, stickerAdFor, stickerAdVideoFor } from './stickerAd';

const site = vi.hoisted(() => ({ city: 'Malyn' }));
vi.mock('@/site/transportCity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/site/transportCity')>()),
  siteTransportCity: () => site.city,
}));

const scan = (stopId: string) => `?utm_source=sticker&utm_medium=qr&utm_campaign=${stopId}-a`;

describe('stickerAd: який ролик показати перед табло після скану наклейки', () => {
  afterEach(() => {
    for (const key of Object.values(AD_SEEN_KEYS)) localStorage.removeItem(key);
    sessionStorage.clear();
    site.city = 'Malyn';
  });

  it('вокзал Малина — «Вітаємо в Малині», вокзал Коростеня — «Вітаємо в Коростені», решта зупинок — тизер', () => {
    expect(stickerAdVideoFor('st_0019', 'Malyn')).toBe('welcome');
    expect(stickerAdVideoFor('st_0004', 'Malyn')).toBe('hint');
    expect(stickerAdVideoFor('st_1001', 'Korosten')).toBe('welcomeKorosten');
    expect(stickerAdVideoFor('st_1002', 'Korosten')).toBe('hint');
    // id зупинки — у межах міста: вокзал одного міста не вітає на сайті іншого
    expect(stickerAdVideoFor('st_0019', 'Korosten')).toBe('hint');
    expect(stickerAdVideoFor('st_1001', 'Malyn')).toBe('hint');
    expect(stickerAdVideoFor('st_0019', 'Zhytomyr')).toBe('hint');
    expect(stickerAdVideoFor('toString', 'Malyn')).toBe('hint');
  });

  it('три ролики — три позначки «бачив», за назвою ролика', () => {
    expect(AD_SEEN_KEYS).toEqual({ hint: HINT_SEEN_KEY, welcome: WELCOME_SEEN_KEY, welcomeKorosten: KOROSTEN_WELCOME_SEEN_KEY });
    expect(new Set(Object.values(AD_SEEN_KEYS)).size).toBe(3);
    // позначки, які вже стоять у браузерах людей, лишаються тими самими
    expect(HINT_SEEN_KEY).toBe('dovede-hint:v1');
    expect(WELCOME_SEEN_KEY).toBe('malyn-welcome:v1');
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

  it('на сайті Коростеня: вокзал — своє привітання; малинські позначки його не скасовують, і навпаки', () => {
    site.city = 'Korosten';
    // хтось досмотрів і «Крапку», і «Вітаємо в Малині» — коростенське привітання однаково покажемо
    localStorage.setItem(HINT_SEEN_KEY, '2026-11-20T00:00:00.000Z');
    localStorage.setItem(WELCOME_SEEN_KEY, '2026-11-20T00:00:00.000Z');
    expect(stickerAdFor(scan('st_1001'))).toEqual({ stopId: 'st_1001', video: 'welcomeKorosten' });
    expect(stickerAdFor(scan('st_1002'))).toBeNull();

    localStorage.removeItem(HINT_SEEN_KEY);
    expect(stickerAdFor(scan('st_1002'))).toEqual({ stopId: 'st_1002', video: 'hint' });

    localStorage.setItem(KOROSTEN_WELCOME_SEEN_KEY, '2026-11-21T00:00:00.000Z');
    expect(stickerAdFor(scan('st_1001'))).toBeNull();
    // а в Малині вокзал вітає й далі — своєю позначкою
    site.city = 'Malyn';
    localStorage.removeItem(WELCOME_SEEN_KEY);
    expect(stickerAdFor(scan('st_0019'))).toEqual({ stopId: 'st_0019', video: 'welcome' });
  });
});
