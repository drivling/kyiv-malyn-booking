import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DovedeIntro } from './DovedeIntro';
import { INTRO_SECONDS, INTRO_VIDEO } from './introMedia';
import { INTRO_SEEN_KEY } from './introState';

// jsdom не грає медіа й не малює canvas: відтворення підміняємо, поля навколо кадру вимикаються самі (getContext → null)
const play = vi.fn<() => Promise<void>>();
const pause = vi.fn();

function reducedMotion(on: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: on && query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

const video = () => document.querySelector('video') as HTMLVideoElement;

function renderIntro() {
  const onTicket = vi.fn();
  const onDone = vi.fn();
  const onEvent = vi.fn();
  render(<DovedeIntro onTicket={onTicket} onDone={onDone} onEvent={onEvent} />);
  return { onTicket, onDone, onEvent };
}

describe('ролик-вступ «Доведе»', () => {
  beforeEach(() => {
    play.mockReset().mockResolvedValue(undefined);
    pause.mockReset();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    reducedMotion(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
  });

  it('ролик без пульта на білому: autoplay зі звуком, без кнопки «Дивитися»', async () => {
    renderIntro();
    const dialog = screen.getByRole('dialog', { name: 'Ролик «Доведе.»' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const v = video();
    expect(v.getAttribute('src')).toBe(INTRO_VIDEO);
    expect(v).not.toHaveAttribute('controls');
    expect(v).toHaveAttribute('playsinline');
    expect(v).toHaveAttribute('disablepictureinpicture');
    expect(v.getAttribute('controlslist')).toContain('nofullscreen');
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(v.muted).toBe(false);
    expect(screen.queryByRole('button', { name: /Дивитися/ })).not.toBeInTheDocument();
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('браузер не дав звук без дотику → крапка «Дивитися · 54 с» → дотик запускає ролик', async () => {
    play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    renderIntro();
    const start = await screen.findByRole('button', { name: `Дивитися ролик, ${INTRO_SECONDS} с, зі звуком` });
    expect(start).toHaveTextContent(`Дивитися · ${INTRO_SECONDS} с`);
    fireEvent.click(start);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Дивитися/ })).not.toBeInTheDocument());
  });

  it('пауза не від людини (дзвінок, системний плеєр) → «Продовжити» з того ж місця', async () => {
    renderIntro();
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    fireEvent(video(), new Event('playing'));
    fireEvent(video(), new Event('pause'));
    fireEvent.click(await screen.findByRole('button', { name: 'Продовжити' }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
  });

  it('кінець ролика → талон зі щасливим номером, ролик позначено як побачений', async () => {
    const { onTicket } = renderIntro();
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBeNull();
    fireEvent(video(), new Event('ended'));
    expect(await screen.findByRole('button', { name: 'Прокомпостувати квиток і увійти' })).toBeInTheDocument();
    expect(screen.getByText('Прокомпостуйте квиток, щоб увійти')).toBeInTheDocument();
    const no = screen.getByText(/^Серія ДВ №/).textContent ?? '';
    const d = no.replace(/\D/g, '').split('').map(Number);
    expect(d[0] + d[1] + d[2]).toBe(d[3] + d[4] + d[5]);
    expect(onTicket).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(INTRO_SEEN_KEY)).not.toBeNull();
  });

  it('«Ще раз» — ролик спочатку, талон ховається', async () => {
    renderIntro();
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    fireEvent(video(), new Event('ended'));
    fireEvent.click(await screen.findByRole('button', { name: 'Ще раз' }));
    expect(video().currentTime).toBe(0);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Прокомпостувати квиток і увійти' })).not.toBeInTheDocument();
  });

  it('відео не завантажилось → одразу талон (не застрягти), але ролик не вважається побаченим', async () => {
    const { onTicket } = renderIntro();
    fireEvent(video(), new Event('error'));
    expect(await screen.findByRole('button', { name: 'Прокомпостувати квиток і увійти' })).toBeInTheDocument();
    expect(screen.getByText('Відео не завантажилося.')).toBeInTheDocument();
    expect(onTicket).toHaveBeenCalled();
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBeNull();
  });

  it('компостер: дірки, штамп — і вхід (без анімацій — затухання)', async () => {
    reducedMotion(true);
    const { onDone, onEvent } = renderIntro();
    fireEvent(video(), new Event('ended'));
    expect(onEvent).not.toHaveBeenCalledWith('punched');
    fireEvent.click(await screen.findByRole('button', { name: 'Прокомпостувати квиток і увійти' }));
    expect(screen.getByRole('dialog')).toHaveClass('dv-intro--punching');
    // облік реклами: талон прокомпостовано (стіна наклейок святкує) — один раз
    expect(onEvent.mock.calls.filter(([e]) => e === 'punched')).toHaveLength(1);
    expect(document.querySelectorAll('.dv-talon__hole')).toHaveLength(3);
    // фон сторінки повертається одразу: крізь дірку видно справжню сторінку
    expect(document.body.style.backgroundColor).toBe('');
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toHaveClass('dv-intro--leaving');
  });

  it('компостер з анімацією: сторінка відкривається колом із пробитої дірки', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    try {
      const { onDone } = renderIntro();
      await act(async () => {
        fireEvent(video(), new Event('ended'));
      });
      fireEvent.click(screen.getByRole('button', { name: 'Прокомпостувати квиток і увійти' }));
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.getByRole('dialog').style.getPropertyValue('mask-image')).toMatch(/^radial-gradient\(circle at [\d.]+px [\d.]+px, transparent 7px/);
      expect(onDone).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
