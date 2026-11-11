import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DEFAULT_TRANSPORT_CITY,
  TRANSPORT_CITY_PARAM,
  canonicalTransportCity,
  isDefaultTransportCity,
} from '@/site/transportCity';

/**
 * Місто, чий транспорт редагують транспортні вкладки адмінки (Docs/korosten-transport-2026-11.md, фаза 6):
 * ?city=Korosten, без параметра чи з невідомим містом — Малин. Місто живе в адресі, тож кожна
 * вкладка браузера незалежна, а посилання на «Графік транспорту» Коростеня можна зберегти.
 */
export function useAdminTransportCity(): { city: string; setCity: (city: string) => void } {
  const [params, setParams] = useSearchParams();
  const city = canonicalTransportCity(params.get(TRANSPORT_CITY_PARAM)) ?? DEFAULT_TRANSPORT_CITY;
  const setCity = useCallback(
    (next: string) => {
      const p = new URLSearchParams(params);
      // id зупинок у різних містах різні — обрана наклейка іншого міста не має сенсу
      p.delete('stop');
      if (isDefaultTransportCity(next)) p.delete(TRANSPORT_CITY_PARAM);
      else p.set(TRANSPORT_CITY_PARAM, next);
      setParams(p);
    },
    [params, setParams]
  );
  return { city, setCity };
}

/** Запит для переходу між транспортними вкладками: місто лишається тим самим */
export function transportCitySearch(city: string): string {
  return isDefaultTransportCity(city) ? '' : `?${TRANSPORT_CITY_PARAM}=${encodeURIComponent(city)}`;
}
