/**
 * Телефони «Зубастика» на сторінках сайту: типові — `ZUBASTYK_PHONES` у `zubastykContent.ts`; власник міняє їх в адмінці
 * без деплою (`GET /site/zubastyk-phones`, бекенд `zubastyk-phones.ts` — там же бот і SMS). Сторінка читає їх один раз
 * на відкриття й перемальовує всіх, хто показує номери (`useZubastykPhones`). Статична /zubastyk для пошуковиків
 * збирається з тим самим запитом (`prerender-spa` чекає на нього), тож після зміни номерів — передеплой фронтенду.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { apiClient } from '@/api/client';
import { ZUBASTYK_PHONES, type ZubastykPhone } from '@/pages/MizhgorodskiPage/zubastykContent';

let current: readonly ZubastykPhone[] = ZUBASTYK_PHONES;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const valid = (v: unknown): v is ZubastykPhone[] =>
  Array.isArray(v) && v.length > 0 && v.every((p) => p && typeof p === 'object' && /^380\d{9}$/.test(String((p as ZubastykPhone).digits)) && typeof (p as ZubastykPhone).label === 'string');

/** Номери, що діють зараз (типові, поки не прочитали з сервера) */
export const zubastykPhonesNow = (): readonly ZubastykPhone[] => current;

/** Прочитати з сервера один раз на сторінку; збій — лишаються типові */
export function loadZubastykPhones(): Promise<void> {
  loading ??= apiClient
    .getZubastykPhones()
    .then((list) => {
      if (valid(list)) {
        current = list;
        listeners.forEach((l) => l());
      }
    })
    .catch(() => undefined);
  return loading;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Номери для компонента: типові одразу, з адмінки — щойно прийдуть */
export function useZubastykPhones(): readonly ZubastykPhone[] {
  useEffect(() => {
    void loadZubastykPhones();
  }, []);
  return useSyncExternalStore(subscribe, zubastykPhonesNow, zubastykPhonesNow);
}

/** Для тестів: знову типові й читати заново */
export function resetZubastykPhones(): void {
  current = ZUBASTYK_PHONES;
  loading = null;
  listeners.forEach((l) => l());
}
