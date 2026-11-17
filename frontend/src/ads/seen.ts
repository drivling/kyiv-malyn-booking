/**
 * «Цей браузер уже бачив ролик» — для реклами, що показується один раз (ролик-вступ /dovede, міні-тизер перед табло
 * зупинки). Спершу localStorage, якщо не вийшло — sessionStorage, далі памʼять вкладки. Показати новий ролик усім —
 * змінити ключ (`…:v2`).
 */
const inMemory = new Set<string>();

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

export function isSeen(key: string): boolean {
  if (inMemory.has(key)) return true;
  for (const store of storages()) {
    try {
      if (store.getItem(key)) return true;
    } catch {
      /* читання заборонене — пробуємо наступне */
    }
  }
  return false;
}

export function markSeen(key: string, at: Date = new Date()): void {
  for (const store of storages()) {
    try {
      store.setItem(key, at.toISOString());
      return;
    } catch {
      /* переповнене чи заборонене — пробуємо наступне */
    }
  }
  inMemory.add(key);
}
