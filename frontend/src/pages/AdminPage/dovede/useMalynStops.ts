import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import { DEFAULT_TRANSPORT_CITY } from '@/site/transportCity';

/**
 * Зупинки Малина для «Доведе» в адмінці: назви місць у журналі (`st_XXXX` → назва), вибір місця для синоніма,
 * примітки водіїв. Не вдалося завантажити — порожній список: сторінка працює, лише без назв зупинок.
 */
export function useMalynStops(): Array<{ id: string; name: string }> {
  const [stops, setStops] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    let alive = true;
    apiClient
      .getTransportDataset({ city: DEFAULT_TRANSPORT_CITY })
      .then((d) => {
        if (alive) setStops(d.stops.map((s) => ({ id: s.id, name: s.name })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return stops;
}
