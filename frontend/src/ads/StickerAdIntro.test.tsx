import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import StickerAdIntro from './StickerAdIntro';
import { AD_SEEN_KEYS, KOROSTEN_WELCOME_SEEN_KEY } from './stickerAd';
import { WELCOME_KOROSTEN_NAME, WELCOME_KOROSTEN_VIDEO } from './welcomeKorostenMedia';

describe('StickerAdIntro: привітання «Вітаємо в Коростені» на вокзалі Коростеня', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const key of Object.values(AD_SEEN_KEYS)) localStorage.removeItem(key);
  });

  it('свій файл, свій заголовок, своя позначка «бачив», облік — з назвою ролика й зупинкою', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.stubGlobal('matchMedia', vi.fn((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const ads: { placement: string; event: string; stopId?: string; video?: string }[] = [];
    server.use(
      http.post(`${TEST_API_URL}/ads/events`, async ({ request }) => {
        ads.push((await request.json()) as (typeof ads)[number]);
        return HttpResponse.json({ ok: true, counted: true }, { status: 201 });
      })
    );
    const onDone = vi.fn();
    render(<StickerAdIntro stopId="st_1001" video="welcomeKorosten" onDone={onDone} />);

    const dialog = await screen.findByRole('dialog', { name: 'Ролик «Вітаємо в Коростені» перед розкладом зупинки' });
    const video = dialog.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe(WELCOME_KOROSTEN_VIDEO);
    expect(WELCOME_KOROSTEN_VIDEO).toMatch(/^\/ads\/welcome-korosten-[0-9a-f]{8}\.mp4$/);
    await waitFor(() => expect(play).toHaveBeenCalled());
    video.dispatchEvent(new Event('playing'));
    video.dispatchEvent(new Event('ended'));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(localStorage.getItem(KOROSTEN_WELCOME_SEEN_KEY)).not.toBeNull();
    expect(localStorage.getItem(AD_SEEN_KEYS.welcome)).toBeNull();
    expect(localStorage.getItem(AD_SEEN_KEYS.hint)).toBeNull();
    await waitFor(() => expect(ads.map((a) => a.event)).toEqual(['shown', 'started', 'completed']));
    expect(ads.every((a) => a.placement === 'sticker' && a.stopId === 'st_1001' && a.video === WELCOME_KOROSTEN_NAME)).toBe(true);
  });
});
