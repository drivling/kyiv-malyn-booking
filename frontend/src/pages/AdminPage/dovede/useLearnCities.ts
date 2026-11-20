import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { DovedeLearnCity } from '@/types';

/**
 * Міста навчання «Доведе» — список із сервера (`GET /admin/dovede/city/cities`, реєстр
 * `backend/src/dovede/learn-cities.ts`). До відповіді й при помилці — ті два, що були завжди: вкладка не блимає,
 * а нове місто з'являється в усіх розділах без правок тут.
 */
export const FALLBACK_LEARN_CITIES: readonly DovedeLearnCity[] = [
  { code: 'Kyiv', name: 'Київ', genitive: 'Києва' },
  { code: 'Zhytomyr', name: 'Житомир', genitive: 'Житомира' },
];

let cached: readonly DovedeLearnCity[] | null = null;
let pending: Promise<readonly DovedeLearnCity[]> | null = null;

const valid = (list: unknown): list is DovedeLearnCity[] =>
  Array.isArray(list) && list.length > 0 && list.every((c) => c && typeof c.code === 'string' && typeof c.name === 'string' && typeof c.genitive === 'string');

function load(): Promise<readonly DovedeLearnCity[]> {
  pending ??= apiClient
    .getDovedeLearnCities()
    .then((r) => {
      if (!valid(r?.cities)) throw new Error('cities');
      cached = r.cities;
      return cached;
    })
    .catch(() => {
      pending = null;
      return FALLBACK_LEARN_CITIES;
    });
  return pending;
}

/** Для тестів: забути список, узятий із сервера */
export function resetLearnCities(): void {
  cached = null;
  pending = null;
}

export function useLearnCities(): readonly DovedeLearnCity[] {
  const [cities, setCities] = useState<readonly DovedeLearnCity[]>(cached ?? FALLBACK_LEARN_CITIES);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    void load().then((list) => {
      if (alive) setCities(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  return cities;
}

/** Назва міста за кодом; невідомий код — як є */
export const learnCityName = (cities: readonly DovedeLearnCity[], code: string): string => cities.find((c) => c.code === code)?.name ?? code;
