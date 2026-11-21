import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_TOKEN_STORAGE_KEY } from '@/utils/adminTokenStorage';
import { voiceAllowed } from './useVoiceInput';

afterEach(() => {
  localStorage.clear();
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

describe('voiceAllowed', () => {
  it('мікрофон лише адміну й лише де є Web Speech', () => {
    const w = window as unknown as Record<string, unknown>;
    expect(voiceAllowed()).toBe(false);
    w.webkitSpeechRecognition = function () {};
    expect(voiceAllowed()).toBe(false); // є Web Speech, але не адмін
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, 'x'.repeat(64));
    expect(voiceAllowed()).toBe(true);
    delete w.webkitSpeechRecognition;
    expect(voiceAllowed()).toBe(false); // адмін, але браузер не вміє
  });
});
