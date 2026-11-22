/**
 * «Доведе» · «звідки — де я зараз» (Docs/dovede-geo-roadmap.md, Г1): у якому з відомих міст людина. Найближчий центр і
 * радіус; поза всіма — `far` («Аргентина»: глушать GPS чи людина справді далеко), і тоді координати не початок маршруту.
 * Чисто: координати нікуди не йдуть.
 */

export type GeoCity = 'Malyn' | 'Korosten' | 'Kyiv' | 'Zhytomyr';

/** Центри Малина й Коростеня — ті самі, що в `site/transportCity.ts` (тест звіряє); Київ і Житомир — лише тут */
export const GEO_ZONES: ReadonlyArray<{ city: GeoCity; center: [number, number]; radiusKm: number }> = [
  { city: 'Malyn', center: [50.768, 29.242], radiusKm: 6 },
  { city: 'Korosten', center: [50.9506, 28.6384], radiusKm: 8 },
  { city: 'Zhytomyr', center: [50.2547, 28.6587], radiusKm: 12 },
  { city: 'Kyiv', center: [50.4501, 30.5234], radiusKm: 35 },
];

/** Гірше за це — «приблизно»: місто ще можна вгадати, вулицю — ні */
export const IMPRECISE_M = 1500;

/** Відстань по поверхні Землі, метри */
export function distanceM(a: readonly [number, number], b: readonly [number, number]): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface Located {
  /** місто, у межах якого точка, або `far` */
  city: GeoCity | 'far';
  /** найближче місто й відстань до його центру — для підказки «ви далеко» */
  nearest: GeoCity;
  distanceKm: number;
}

export function locateCity(lat: number, lng: number): Located {
  let best = GEO_ZONES[0];
  let bestKm = Infinity;
  let inside: GeoCity | null = null;
  for (const z of GEO_ZONES) {
    const km = distanceM([lat, lng], z.center) / 1000;
    if (km <= z.radiusKm && inside === null) inside = z.city;
    if (km < bestKm) {
      best = z;
      bestKm = km;
    }
  }
  return { city: inside ?? 'far', nearest: best.city, distanceKm: Math.round(bestKm * 10) / 10 };
}
