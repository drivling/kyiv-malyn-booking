/**
 * Встановлення застосунку «Як доїхати» на телефон (Docs/transport-pwa-2026-10.md, фаза 3).
 *
 * Chromium кидає `beforeinstallprompt` один раз і рано, а показати діалог можна лише пізніше, з жесту
 * людини — тому подію ловимо при старті (`main.tsx`) і тримаємо для кнопки «Встановити» у смужці
 * стану транспорту. Подію НЕ глушимо (`preventDefault`): без цього Chrome на Android сам показує свій
 * банер «Установите приложение «Як доїхати»» угорі сторінки — саме так, як хоче власник; кнопка в
 * смужці лишається запасним шляхом, коли банер закрили (Chrome не повторює його ~3 місяці). iOS такої події
 * не має — там підказка «Поділитися → На Початковий екран», яку можна закрити (localStorage). У встановленому
 * застосунку (standalone) пропозиції нема. Android без події (банер закрили або ще зарано) отримує підказку
 * «меню ⋮ → Додати на головний екран». Хрестик картки ховає її на 30 днів для всіх варіантів.
 */
import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallOfferKind = 'prompt' | 'ios-hint' | 'android-hint';
export type InstallOutcome = 'accepted' | 'dismissed';

const HINT_DISMISSED_KEY = 'transport-install-hint';
/** Скільки не показувати картку після хрестика */
export const HINT_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

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

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

/** Картку закрили менш ніж 30 днів тому. Старе значення '1' (перша версія підказки) — показуємо знову: дизайн новий */
function hintDismissed(now: number = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(HINT_DISMISSED_KEY));
    return Number.isFinite(at) && at > 1 && now - at < HINT_DISMISS_MS;
  } catch {
    return false;
  }
}

export function dismissInstallHint(): void {
  try {
    localStorage.setItem(HINT_DISMISSED_KEY, String(Date.now()));
  } catch {
    /* без localStorage картка повернеться наступного разу */
  }
  notify();
}

/** Що пропонувати: системний діалог (Chromium), кроки для iPhone, кроки для Android або нічого */
export function installOfferKind(): InstallOfferKind | null {
  if (isStandalone() || hintDismissed()) return null;
  if (deferred) return 'prompt';
  if (isIos()) return 'ios-hint';
  if (isAndroid()) return 'android-hint';
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
