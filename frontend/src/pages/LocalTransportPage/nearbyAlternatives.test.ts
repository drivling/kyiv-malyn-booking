import { describe, expect, it } from 'vitest';
import { findNearbyAlternatives, haversineDistance, type StopCoords } from './nearbyAlternatives';

// Прожектор ↔ Меркурій ~13 м, Сільпо ↔ Грушевського 48 ~28 м; Далеко — за 2 км.
const coords: StopCoords = {
  prozhektor: [50.77062, 29.25598],
  merkurii: [50.77068, 29.25614],
  silpo: [50.7686, 29.2486],
  hrushevskoho: [50.76882, 29.24875],
  daleko: [50.75, 29.22],
};
const stopIds = Object.keys(coords);

/** Прямі маршрути: №5 Меркурій→Сільпо, №3 Прожектор→Грушевського, №7 Меркурій→Грушевського */
const direct = (from: string, to: string): string[] => {
  const table: Record<string, string[]> = {
    'merkurii>silpo': ['5', '11'],
    'prozhektor>hrushevskoho': ['3'],
    'merkurii>hrushevskoho': ['7'],
  };
  return table[`${from}>${to}`] ?? [];
};

describe('haversineDistance', () => {
  it('сусідні стовпчики — десятки метрів, різні райони — кілометри', () => {
    expect(haversineDistance(...coords.prozhektor, ...coords.merkurii)).toBeGreaterThan(5);
    expect(haversineDistance(...coords.prozhektor, ...coords.merkurii)).toBeLessThan(30);
    expect(haversineDistance(...coords.prozhektor, ...coords.daleko)).toBeGreaterThan(1500);
  });
});

describe('findNearbyAlternatives', () => {
  it('пропонує заміну «З» і «До» на сусідні зупинки з прямим маршрутом, ближчі першими', () => {
    const alts = findNearbyAlternatives({ from: 'prozhektor', to: 'silpo', stopIds, coords, directRouteIds: direct });
    expect(alts.map((a) => `${a.changed}:${a.from}>${a.to}`)).toEqual(['from:merkurii>silpo', 'to:prozhektor>hrushevskoho']);
    expect(alts[0].routeIds).toEqual(['5', '11']);
    expect(alts[0].walkMeters).toBeLessThan(30);
    expect(alts[1].walkMeters).toBeLessThan(40);
  });

  it('обидві зупинки міняє лише коли одностороння заміна нічого не дає', () => {
    const onlyBoth = (from: string, to: string) => (from === 'merkurii' && to === 'hrushevskoho' ? ['7'] : []);
    const alts = findNearbyAlternatives({ from: 'prozhektor', to: 'silpo', stopIds, coords, directRouteIds: onlyBoth });
    expect(alts).toHaveLength(1);
    expect(alts[0]).toMatchObject({ changed: 'both', from: 'merkurii', to: 'hrushevskoho', routeIds: ['7'] });
    expect(alts[0].walkMeters).toBeLessThan(70);
  });

  it('поважає радіус і ліміт', () => {
    expect(findNearbyAlternatives({ from: 'prozhektor', to: 'silpo', stopIds, coords, directRouteIds: direct, radiusMeters: 5 })).toEqual([]);
    expect(findNearbyAlternatives({ from: 'prozhektor', to: 'silpo', stopIds, coords, directRouteIds: direct, limit: 1 })).toHaveLength(1);
  });

  it('без координат, без пари або з однаковими зупинками — порожньо', () => {
    expect(findNearbyAlternatives({ from: 'prozhektor', to: 'silpo', stopIds, coords: null, directRouteIds: direct })).toEqual([]);
    expect(findNearbyAlternatives({ from: '', to: 'silpo', stopIds, coords, directRouteIds: direct })).toEqual([]);
    expect(findNearbyAlternatives({ from: 'silpo', to: 'silpo', stopIds, coords, directRouteIds: direct })).toEqual([]);
  });

  it('другу зупинку пари не пропонує як заміну першої', () => {
    // Сільпо і Грушевського поруч: для пари Сільпо → Грушевського «сусід» Грушевського — не варіант для «З».
    const alts = findNearbyAlternatives({ from: 'silpo', to: 'hrushevskoho', stopIds, coords, directRouteIds: () => ['9'] });
    expect(alts.every((a) => a.from !== 'hrushevskoho' && a.to !== 'silpo')).toBe(true);
  });
});
