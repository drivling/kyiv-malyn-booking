/**
 * Передача рідного міста між доменами: куки не ходять між malin.kiev.ua і korosten.kiev.ua,
 * тому вибір їде в URL (?city=Korosten), а на новому домені записується в куку й прибирається з адреси.
 */
import { useEffect } from 'react';
import { writeHomeCityCookie } from '@/pages/MizhgorodskiPage/mizhUtils';
import { CITY_HANDOFF_PARAM, getCurrentSite } from './siteConfig';

export interface CityHandoff {
  /** Код міста з ?city=, якщо він був */
  code: string | null;
  /** Query-рядок без ?city= (порожній або починається з «?») */
  nextSearch: string;
}

export function readCityHandoff(search: string): CityHandoff {
  const params = new URLSearchParams(search || '');
  const raw = params.get(CITY_HANDOFF_PARAM);
  const code = raw && raw.trim() ? raw.trim() : null;
  if (!code) return { code: null, nextSearch: search || '' };
  params.delete(CITY_HANDOFF_PARAM);
  const rest = params.toString();
  return { code, nextSearch: rest ? `?${rest}` : '' };
}

/**
 * Приймає ?city= на будь-якій сторінці: пише куку і чистить адресу (один раз на завантаження).
 * На вторинному домені рідне місто задає сам домен — куку пінимо в місто цього сайту.
 */
export function useHomeCityHandoff(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const site = getCurrentSite();
    const { code, nextSearch } = readCityHandoff(window.location.search);
    if (!site.isPrimary) writeHomeCityCookie(site.cityCode);
    if (!code) return;
    if (site.isPrimary) writeHomeCityCookie(code);
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${nextSearch}${window.location.hash}`,
    );
  }, []);
}
