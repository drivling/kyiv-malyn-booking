import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  captureInstallPrompt,
  dismissInstallHint,
  installOfferKind,
  isStandalone,
  promptInstall,
  resetInstallPromptForTests,
  useInstallOffer,
} from './installPrompt';

function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const ev = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  ev.prompt = vi.fn(async () => undefined);
  ev.userChoice = Promise.resolve({ outcome });
  window.dispatchEvent(ev);
  return ev;
}

const originalUa = navigator.userAgent;
function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
}

describe('installPrompt (Docs/transport-pwa-2026-10.md, фаза 3)', () => {
  beforeEach(() => {
    captureInstallPrompt();
    resetInstallPromptForTests();
  });
  afterEach(() => {
    setUserAgent(originalUa);
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('у звичайному браузері без події нічого не пропонує', () => {
    expect(installOfferKind()).toBeNull();
    expect(isStandalone()).toBe(false);
  });

  it('ловить beforeinstallprompt, показує діалог з кнопки і забуває подію після відповіді', async () => {
    const { result } = renderHook(() => useInstallOffer());
    expect(result.current).toBeNull();
    let ev!: ReturnType<typeof fireBeforeInstallPrompt>;
    act(() => {
      ev = fireBeforeInstallPrompt('accepted');
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(result.current).toBe('prompt');

    let outcome: string | null = null;
    await act(async () => {
      outcome = await promptInstall();
    });
    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('accepted');
    expect(result.current).toBeNull();
    expect(await promptInstall()).toBeNull();
  });

  it('appinstalled прибирає пропозицію', () => {
    fireBeforeInstallPrompt();
    expect(installOfferKind()).toBe('prompt');
    window.dispatchEvent(new Event('appinstalled'));
    expect(installOfferKind()).toBeNull();
  });

  it('iOS: підказка, поки її не закрили', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1');
    const { result } = renderHook(() => useInstallOffer());
    expect(result.current).toBe('ios-hint');
    act(() => dismissInstallHint());
    expect(result.current).toBeNull();
    expect(localStorage.getItem('transport-install-hint')).toBe('1');
  });

  it('у встановленому застосунку (standalone) пропозиції нема', () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: q === '(display-mode: standalone)' })) as unknown as typeof window.matchMedia;
    fireBeforeInstallPrompt();
    expect(isStandalone()).toBe(true);
    expect(installOfferKind()).toBeNull();
  });
});
