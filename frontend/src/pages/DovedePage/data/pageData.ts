/**
 * Дані сторінки, які власник міняє в адмінці без деплою (Docs/dovede-admin-roadmap.md, крок 11): сторінка читає
 * `GET /dovede/page-data` один раз на відкриття — лише змінені ключі — і кладе їх у свої модулі; решта лишається
 * типовою з коду. Відповідь чекає на них не довше `READY_WAIT_MS`: повільна мережа не тримає людину.
 */
import { applyMetroData } from './kyivMetroService';
import { applyRingData } from './kyivRing';
import { applyExamplesData } from './examples';

export const READY_WAIT_MS = 1500;

let ready: Promise<void> | null = null;

/** Розкласти дані з адмінки по модулях сторінки */
export function applyPageData(values: Record<string, unknown>): void {
  applyMetroData(values);
  applyRingData(values);
  applyExamplesData(values);
}

/** Прочитати один раз на сторінку (повторний виклик — той самий запит); помилка — лишаються типові */
export function loadPageData(fetchValues: () => Promise<Record<string, unknown>>): Promise<void> {
  if (!ready) {
    ready = fetchValues()
      .then(applyPageData)
      .catch(() => undefined);
  }
  return ready;
}

/** Дочекатися даних (не довше `ms`); ще не просили — одразу */
export function pageDataReady(ms = READY_WAIT_MS): Promise<void> {
  if (!ready) return Promise.resolve();
  return Promise.race([ready, new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

/** Для тестів: забути, що вже читали */
export function resetPageDataLoad(): void {
  ready = null;
}
