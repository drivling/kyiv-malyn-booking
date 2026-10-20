/**
 * Налаштування транспорту на пристрої — файлом (Docs/transport-open-data-2026-10.md, фаза 4.3, «Дані належать
 * людині»). Усе особисте, що розділ «Транспорт Малина» тримає в браузері, — це часті зупинки «Куди» планера
 * (`lt.frequentToStops`, до 5 назв). Решта ключів — кеш і службові мітки. Файл `malin-transport-prefs.json`
 * версіонований; без сервера й без акаунта — щоб перенести на новий телефон або зберегти, коли сайту вже нема.
 *
 * «Очистити мої дані на цьому пристрої» — для спільного телефона: ключі нижче + кеші воркера
 * (`malin-transport-*`). Сесію входу (`user_state`) не чіпає — це не транспорт.
 */

export const TRANSPORT_PREFS_VERSION = 1;
export const TRANSPORT_PREFS_FILENAME = 'malin-transport-prefs.json';
export const FREQUENT_TO_STOPS_KEY = 'lt.frequentToStops';
export const FREQUENT_TO_STOPS_MAX = 5;

/** Що саме стирає «Очистити»: особисте (часті зупинки, перша наклейка, анонімний id) і кеш розділу */
export const TRANSPORT_DEVICE_KEYS = [
  FREQUENT_TO_STOPS_KEY,
  'sticker-origin',
  'arrival-report-client',
  'transport-install-hint',
  'transport-dataset:v1',
  'transport-dataset-invalidate',
  'transport-outbox:v1',
] as const;
export const TRANSPORT_DEVICE_KEY_PREFIXES = ['site-local-transport:'] as const;
export const TRANSPORT_CACHE_PREFIX = 'malin-transport-';

export type TransportPrefsFile = {
  version: typeof TRANSPORT_PREFS_VERSION;
  site: string;
  exportedAt: string;
  frequentToStops: string[];
};

export function readFrequentToStops(): string[] {
  try {
    const raw = localStorage.getItem(FREQUENT_TO_STOPS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== '').slice(0, FREQUENT_TO_STOPS_MAX) : [];
  } catch {
    return [];
  }
}

export function writeFrequentToStops(stops: string[]): void {
  try {
    if (stops.length) localStorage.setItem(FREQUENT_TO_STOPS_KEY, JSON.stringify(stops.slice(0, FREQUENT_TO_STOPS_MAX)));
    else localStorage.removeItem(FREQUENT_TO_STOPS_KEY);
  } catch {
    /* приватний режим / квота — мовчки */
  }
}

export function collectTransportPrefs(now: Date = new Date()): TransportPrefsFile {
  return {
    version: TRANSPORT_PREFS_VERSION,
    site: typeof window !== 'undefined' ? window.location.hostname : '',
    exportedAt: now.toISOString(),
    frequentToStops: readFrequentToStops(),
  };
}

export type ParsedTransportPrefs = {
  frequentToStops: string[];
  /** Назви з файлу, яких нема серед зупинок датасету (перейменовані / злиті) — не імпортуємо */
  unknownStops: string[];
};

/**
 * Перевірка файлу: версія 1, `frequentToStops` — масив рядків; лише назви зупинок із датасету (коли список
 * відомий), не більше FREQUENT_TO_STOPS_MAX. Кидає Error з текстом для людини.
 */
export function parseTransportPrefs(text: string, knownStopNames?: Iterable<string>): ParsedTransportPrefs {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Це не файл налаштувань: не вдалося прочитати JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Це не файл налаштувань транспорту.');
  const d = data as Record<string, unknown>;
  if (d.version !== TRANSPORT_PREFS_VERSION) throw new Error(`Непідтримувана версія файлу: ${String(d.version)} (очікуємо ${TRANSPORT_PREFS_VERSION}).`);
  if (!Array.isArray(d.frequentToStops)) throw new Error('У файлі нема списку частих зупинок.');
  const names = (d.frequentToStops as unknown[])
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v !== '');
  const unique = Array.from(new Set(names));
  const known = knownStopNames ? new Set(knownStopNames) : null;
  const unknownStops = known ? unique.filter((n) => !known.has(n)) : [];
  const frequentToStops = (known ? unique.filter((n) => known.has(n)) : unique).slice(0, FREQUENT_TO_STOPS_MAX);
  return { frequentToStops, unknownStops };
}

/** Злиття: імпортоване наперед, потім те, що вже було; без повторів; ≤ 5 */
export function mergeFrequentToStops(imported: string[], existing: string[]): string[] {
  return Array.from(new Set([...imported, ...existing])).slice(0, FREQUENT_TO_STOPS_MAX);
}

export function applyTransportPrefs(parsed: ParsedTransportPrefs): string[] {
  const merged = mergeFrequentToStops(parsed.frequentToStops, readFrequentToStops());
  writeFrequentToStops(merged);
  return merged;
}

export type ClearedDeviceData = { keys: number; caches: number };

/** Усі ключі транспорту в localStorage + кеші воркера. Повертає, скільки прибрано. */
export async function clearTransportDeviceData(): Promise<ClearedDeviceData> {
  let keys = 0;
  try {
    const names: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k) names.push(k);
    }
    for (const k of names) {
      const hit = (TRANSPORT_DEVICE_KEYS as readonly string[]).includes(k) || TRANSPORT_DEVICE_KEY_PREFIXES.some((p) => k.startsWith(p));
      if (hit) {
        localStorage.removeItem(k);
        keys += 1;
      }
    }
  } catch {
    /* localStorage недоступний */
  }
  let caches = 0;
  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      const all = await window.caches.keys();
      for (const name of all) {
        if (name.startsWith(TRANSPORT_CACHE_PREFIX) && (await window.caches.delete(name))) caches += 1;
      }
    }
  } catch {
    /* без кешів */
  }
  return { keys, caches };
}

/** Текст файлу для завантаження (з відступами — людина може відкрити й прочитати) */
export function transportPrefsFileText(prefs: TransportPrefsFile = collectTransportPrefs()): string {
  return JSON.stringify(prefs, null, 2);
}
