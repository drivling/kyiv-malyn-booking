/**
 * Встановлення «Транспорту Малина» на телефон (Docs/transport-pwa-2026-10.md, фаза 3).
 *
 * Chromium кидає `beforeinstallprompt` один раз і рано, а показати діалог можна лише пізніше, з жесту
 * людини — тому подію ловимо при старті (`main.tsx`) і тримаємо для кнопки «Встановити» у смужці
 * стану транспорту. Подію НЕ глушимо (`preventDefault`): без цього Chrome на Android сам показує свій
 * банер «Установите приложение «Транспорт Малина»» угорі сторінки — саме так, як хоче власник; кнопка в
 * смужці лишається запасним шляхом, коли банер закрили (Chrome не повторює його ~3 місяці). iOS такої події
 * не має — там підказка «Поділитися → На Початковий екран», яку можна закрити (localStorage). У встановленому
 * застосунку (standalone) пропозиції нема.
 */
import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallOfferKind = 'prompt' | 'ios-hint';
export type InstallOutcome = 'accepted' | 'dismissed';

const HINT_DISMISSED_KEY = 'transport-install-hint';

let deferred: BeforeInstallPromptEvent | null = null;
let captured = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Один раз при старті, до першого рендера: подія не повторюється */
export function captureInstallPrompt(): void {
  if (typeof window === 'undefined' || captured) return;
  captured = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    // без preventDefault — рідний банер Chrome лишається; подію тримаємо для своєї кнопки
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/** Уже відкрито як встановлений застосунок (з головного екрана), на будь-якій платформі */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches) || nav.standalone === true;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function hintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallHint(): void {
  try {
    localStorage.setItem(HINT_DISMISSED_KEY, '1');
  } catch {
    /* без localStorage підказка повернеться наступного разу */
  }
  notify();
}

/** Що пропонувати: системний діалог, підказка для iOS або нічого */
export function installOfferKind(): InstallOfferKind | null {
  if (isStandalone()) return null;
  if (deferred) return 'prompt';
  if (isIos() && !hintDismissed()) return 'ios-hint';
  return null;
}

/** Показати системний діалог; null — показувати нема чого */
export async function promptInstall(): Promise<InstallOutcome | null> {
  const ev = deferred;
  if (!ev) return null;
  await ev.prompt();
  const choice = await ev.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  deferred = null;
  notify();
  return choice.outcome;
}

export function useInstallOffer(): InstallOfferKind | null {
  return useSyncExternalStore(subscribe, installOfferKind, () => null);
}

export function resetInstallPromptForTests(): void {
  deferred = null;
  notify();
}
