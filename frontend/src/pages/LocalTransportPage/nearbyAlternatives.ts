/**
 * Стан «немає прямого маршруту»: у Малині десятки зупинок стоять за 10–130 м одна від одної
 * з різними назвами (з-д "Прожектор" ↔ м-н "Меркурій", м-н "Сільпо" ↔ Грушевського 48…).
 * Людина обирає «не ту» назву і бачить глухий кут, хоча автобус є з сусіднього стовпчика.
 * Тут — пошук сусідніх зупинок, між якими прямий маршрут є.
 */

export type StopCoords = Record<string, [number, number]>;

export type NearbyAlternative = {
  /** Запропонована пара (id зупинок) */
  from: string;
  to: string;
  /** Що замінено відносно початкової пари */
  changed: 'from' | 'to' | 'both';
  /** Скільки пройти пішки від початкових зупинок, м (для both — сума) */
  walkMeters: number;
  /** Прямі маршрути між запропонованою парою */
  routeIds: string[];
};

/** Відстань між координатами, м */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Near = { id: string; meters: number };

function stopsNear(center: string, stopIds: string[], coords: StopCoords, radiusMeters: number, exclude: string[]): Near[] {
  const c = coords[center];
  if (!c) return [];
  const out: Near[] = [];
  for (const id of stopIds) {
    if (id === center || exclude.includes(id)) continue;
    const p = coords[id];
    if (!p) continue;
    const meters = haversineDistance(c[0], c[1], p[0], p[1]);
    if (meters <= radiusMeters) out.push({ id, meters: Math.round(meters) });
  }
  return out.sort((a, b) => a.meters - b.meters);
}

export function findNearbyAlternatives(args: {
  from: string;
  to: string;
  stopIds: string[];
  coords: StopCoords | null | undefined;
  /** Прямі маршрути між двома зупинками (той самий предикат, що й для основної видачі) */
  directRouteIds: (from: string, to: string) => string[];
  /** Радіус пошуку сусідніх зупинок, м */
  radiusMeters?: number;
  limit?: number;
}): NearbyAlternative[] {
  const { from, to, stopIds, coords, directRouteIds, radiusMeters = 400, limit = 3 } = args;
  if (!coords || !from || !to || from === to) return [];

  const nearFrom = stopsNear(from, stopIds, coords, radiusMeters, [to]);
  const nearTo = stopsNear(to, stopIds, coords, radiusMeters, [from]);

  const found: NearbyAlternative[] = [];
  for (const s of nearFrom) {
    const routeIds = directRouteIds(s.id, to);
    if (routeIds.length) found.push({ from: s.id, to, changed: 'from', walkMeters: s.meters, routeIds });
  }
  for (const s of nearTo) {
    const routeIds = directRouteIds(from, s.id);
    if (routeIds.length) found.push({ from, to: s.id, changed: 'to', walkMeters: s.meters, routeIds });
  }
  // Лише коли одностороння заміна нічого не дала — міняємо обидві (сума пішої відстані).
  if (found.length === 0) {
    for (const a of nearFrom) {
      for (const b of nearTo) {
        if (a.id === b.id) continue;
        const routeIds = directRouteIds(a.id, b.id);
        if (routeIds.length) found.push({ from: a.id, to: b.id, changed: 'both', walkMeters: a.meters + b.meters, routeIds });
      }
    }
  }

  const seen = new Set<string>();
  return found
    .sort((a, b) => a.walkMeters - b.walkMeters)
    .filter((alt) => {
      const key = `${alt.from}>${alt.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
