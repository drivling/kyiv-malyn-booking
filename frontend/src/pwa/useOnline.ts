/**
 * Чи є мережа (navigator.onLine + події online/offline). Без слухачів значення сідало б раз при
 * монтуванні й не рухалось — табло не відрізняло б зниклий Wi-Fi від повільного
 * (Docs/transport-pwa-2026-10.md, шар даних). У jsdom і під пререндером — завжди true.
 */
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}
