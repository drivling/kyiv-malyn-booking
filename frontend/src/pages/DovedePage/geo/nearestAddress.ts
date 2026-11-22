/**
 * «Доведе» · найближча адреса до точки з наших даних (OSM-знімок вулиць і будинків, `nlu/streets.ts`) — щоб у «Розумію…»
 * було видно «вул. Така-то, 12», а не координати. Жодних геокодерів: точка нікуди не йде (Docs/dovede-geo-roadmap.md).
 */
import type { Street } from '../nlu/streets';
import { distanceM } from './zones';

export interface NearestAddress {
  label: string;
  distanceM: number;
}

/** Найближчий будинок у межах `maxM`; далі — null (людина серед поля, адресу не вигадуємо) */
export function nearestAddress(lat: number, lng: number, streets: readonly Street[], maxM = 80): NearestAddress | null {
  let best: NearestAddress | null = null;
  for (const s of streets) {
    for (const list of [s.houses, s.near]) {
      for (const [house, p] of Object.entries(list)) {
        // грубе відсіювання до точної формули: 0,002° ≈ 150–220 м
        if (Math.abs(p[0] - lat) > 0.002 || Math.abs(p[1] - lng) > 0.003) continue;
        const d = distanceM([lat, lng], [p[0], p[1]]);
        if (d <= maxM && (!best || d < best.distanceM)) best = { label: `${s.label}, ${house}`, distanceM: Math.round(d) };
      }
    }
  }
  return best;
}
