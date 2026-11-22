/**
 * Мікрофон у полі питання (Docs/dovede-voice-roadmap.md, Ф1·2): кнопка є лише тоді, коли сторінка дала `onVoice`;
 * Web Speech підмінено — справжнього мікрофона тест не торкається.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WebSpeechOptions, WebSpeechResult } from '../voice/webSpeech';

let opts: WebSpeechOptions = {};
let finish: (r: WebSpeechResult) => void = () => undefined;
const stop = vi.fn();

vi.mock('../voice/webSpeech', () => ({
  webSpeechSupported: () => true,
  startWebSpeech: (o: WebSpeechOptions) => {
    opts = o;
    return {
      stop,
      result: new Promise<WebSpeechResult>((resolve) => {
        finish = resolve;
      }),
    };
  },
}));

import { QueryField } from './QueryField';

const base = { value: '', spans: [], onChange: vi.fn(), onSubmit: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QueryField · мікрофон', () => {
  it('без onVoice кнопки мікрофона немає', () => {
    render(<QueryField {...base} />);
    expect(screen.queryByRole('button', { name: /голосом|мікрофон|Слухаю/ })).toBeNull();
  });

  it('натиснули → «вмикаю», коли мікрофон готовий → «слухаю»; живий текст іде в поле, остаточний — із final', async () => {
    const onVoice = vi.fn();
    const user = userEvent.setup();
    render(<QueryField {...base} onVoice={onVoice} />);

    await user.click(screen.getByRole('button', { name: 'Сказати голосом' }));
    expect(screen.getByRole('button', { name: 'Вмикаю мікрофон…' })).toHaveAttribute('aria-pressed', 'true');
    expect(opts.continuous).toBe(false);

    act(() => opts.onReady?.());
    expect(screen.getByRole('button', { name: /Слухаю/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Говоріть');

    act(() => opts.onInterim?.('з малинської лікарні до Києва о шостій'));
    // числа словами вже цифрами
    expect(onVoice).toHaveBeenLastCalledWith('з малинської лікарні до Києва о 6:00', false);

    await act(async () => finish({ text: 'чи є попутка змалена на Київ' }));
    expect(onVoice).toHaveBeenLastCalledWith('чи є попутка з Малина на Київ', true);
    expect(screen.getByRole('button', { name: 'Сказати голосом' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('повторний клік під час слухання зупиняє його', async () => {
    const user = userEvent.setup();
    render(<QueryField {...base} onVoice={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Сказати голосом' }));
    act(() => opts.onReady?.());
    await user.click(screen.getByRole('button', { name: /Слухаю/ }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('нічого не почув → підказка, а не помилка', async () => {
    const onVoice = vi.fn();
    const user = userEvent.setup();
    render(<QueryField {...base} onVoice={onVoice} />);
    await user.click(screen.getByRole('button', { name: 'Сказати голосом' }));
    await act(async () => finish({ text: '', error: 'no-speech' }));
    expect(onVoice).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Нічого не почув');
  });

  it('натиснули мікрофон — сторінка водночас питає місце (onVoiceStart), зупинка — ні', async () => {
    const onVoiceStart = vi.fn();
    const user = userEvent.setup();
    render(<QueryField {...base} onVoice={vi.fn()} onVoiceStart={onVoiceStart} />);
    await user.click(screen.getByRole('button', { name: 'Сказати голосом' }));
    expect(onVoiceStart).toHaveBeenCalledTimes(1);
    act(() => opts.onReady?.());
    await user.click(screen.getByRole('button', { name: /Слухаю/ }));
    expect(onVoiceStart).toHaveBeenCalledTimes(1);
  });
});
