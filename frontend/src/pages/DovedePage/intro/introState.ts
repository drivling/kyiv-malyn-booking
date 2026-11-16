/**
 * «Ролик-вступ досмотрено» (Docs/dovede-roadmap.md, «Ролик-вступ»). Хто досмотрив ролик до кінця, більше його не
 * бачить — ні після перезавантаження, ні з посиланням `?q=…`. Новий ролик для всіх (і тих, хто бачив старий) —
 * змінити ключ на `v2`; новий файл ролика без зміни ключа повторно не показується.
 */
export const INTRO_SEEN_KEY = 'dovede-intro:v1';

/** Якщо браузер не дає жодного сховища — памʼятаємо до кінця вкладки */
let seenInMemory = false;

function storages(): Storage[] {
  const out: Storage[] = [];
  try {
    out.push(window.localStorage);
  } catch {
    /* сховище заборонене */
  }
  try {
    out.push(window.sessionStorage);
  } catch {
    /* сховище заборонене */
  }
  return out;
}

export function introSeen(): boolean {
  if (seenInMemory) return true;
  for (const store of storages()) {
    try {
      if (store.getItem(INTRO_SEEN_KEY)) return true;
    } catch {
      /* читання заборонене — пробуємо наступне */
    }
  }
  return false;
}

/** Ролик досмотрено: спершу localStorage, якщо не вийшло — sessionStorage, далі памʼять вкладки */
export function markIntroSeen(at: Date = new Date()): void {
  for (const store of storages()) {
    try {
      store.setItem(INTRO_SEEN_KEY, at.toISOString());
      return;
    } catch {
      /* переповнене чи заборонене — пробуємо наступне */
    }
  }
  seenInMemory = true;
}
