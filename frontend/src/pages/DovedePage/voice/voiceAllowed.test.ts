import { afterEach, describe, expect, it } from 'vitest';
import { voiceAllowed } from './useVoiceInput';

afterEach(() => {
  localStorage.clear();
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

describe('voiceAllowed', () => {
  // доступ до самої сторінки вирішує сервер (`access.ts`); мікрофон — кожному, кому вона відкрита, де є Web Speech
  it('лише там, де є Web Speech; токен адміна не потрібен', () => {
    const w = window as unknown as Record<string, unknown>;
    expect(voiceAllowed()).toBe(false);
    w.webkitSpeechRecognition = function () {};
    expect(voiceAllowed()).toBe(true); // гість із паролем — без токена адміна
    delete w.webkitSpeechRecognition;
    expect(voiceAllowed()).toBe(false); // браузер не вміє
  });
});
