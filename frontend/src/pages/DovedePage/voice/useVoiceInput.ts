/**
 * «Доведе» · голос: мікрофон у полі питання (Docs/dovede-voice-roadmap.md, Ф1·2). Web Speech слухає до паузи, текст
 * ідеться в поле живцем, а коли браузер визнав його остаточним — `onText(текст, true)` (сторінка одразу шукає).
 * Стан `starting` — до миті, коли мікрофон справді слухає: до цього говорити не варто, початок фрази губиться.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareHeard } from './heardFixes';
import { startWebSpeech, webSpeechSupported, type WebSpeechSession } from './webSpeech';

export type VoiceState = 'idle' | 'starting' | 'listening';

/**
 * Мікрофон — усім, кому відкрито «Доведе» (рішення власника 2026-11-22, Docs/dovede-voice-roadmap.md): пошук сторінки
 * монтується лише після того, як сервер дав доступ (`access.ts`: пароль запрошених, токен адміна або `DOVEDE_PUBLIC`),
 * тож тут лишається одне — чи вміє браузер Web Speech.
 */
export function voiceAllowed(): boolean {
  return webSpeechSupported();
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Дозвольте доступ до мікрофона в браузері.',
  'service-not-allowed': 'Браузер не дає користуватися розпізнаванням мови.',
  'no-speech': 'Нічого не почув. Спробуйте ще раз.',
  'audio-capture': 'Не знайшов мікрофон.',
  network: 'Немає зв’язку із сервісом розпізнавання.',
  unsupported: 'Цей браузер не вміє розпізнавати мову.',
};

export function useVoiceInput(onText: (text: string, final: boolean) => void): {
  state: VoiceState;
  error: string | null;
  toggle: () => void;
} {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const session = useRef<WebSpeechSession | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => () => session.current?.stop(), []);

  const toggle = useCallback(() => {
    if (session.current) {
      session.current.stop();
      return;
    }
    setError(null);
    setState('starting');
    const s = startWebSpeech({
      continuous: false,
      onReady: () => setState('listening'),
      onInterim: (t) => {
        if (t) cb.current(prepareHeard(t), false);
      },
    });
    session.current = s;
    void s.result.then((r) => {
      session.current = null;
      setState('idle');
      const text = prepareHeard(r.text);
      if (text) cb.current(text, true);
      else setError(ERRORS[r.error ?? ''] ?? 'Не вдалося розпізнати. Наберіть текстом.');
    });
  }, []);

  return { state, error, toggle };
}
