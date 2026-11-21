/**
 * «Доведе» · голос: записи лабораторії лежать лише в IndexedDB цього браузера (Docs/dovede-voice-roadmap.md, Ф1·1) —
 * не в репозиторії й не на сервері. Сховище може бути недоступне (приватне вікно, очищені дані): тоді функції
 * мовчки повертають «немає», а лабораторія працює без збереження.
 */

const DB_NAME = 'dovede-voice-lab';
const STORE = 'takes';

export type VoiceCondition = 'quiet' | 'noise';

export interface StoredTake {
  key: string;
  n: number;
  condition: VoiceCondition;
  blob: Blob;
  at: number;
}

export const takeKey = (n: number, condition: VoiceCondition): string => `${n}:${condition}`;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function saveTake(take: StoredTake): Promise<boolean> {
  return (await run('readwrite', (s) => s.put(take))) !== null;
}

export async function getTake(key: string): Promise<StoredTake | null> {
  return ((await run('readonly', (s) => s.get(key))) as StoredTake | undefined | null) ?? null;
}

export async function listTakeKeys(): Promise<string[]> {
  return ((await run('readonly', (s) => s.getAllKeys())) as string[] | null) ?? [];
}

export async function clearTakes(): Promise<void> {
  await run('readwrite', (s) => s.clear());
}
