/**
 * Poputky OD helpers — unit tests.
 */
import { describe, expect, test } from 'vitest';
import {
  buildOdMatchWhere,
  buildOdRouteSlug,
  classifyPoputkyRouteMatch,
  formatOdRouteLabel,
  isOdAlongItinerary,
  orderedPointIdsFromStops,
  parseOdCodesFromRoute,
  resolveOdPointIdsFromRoute,
  resolvePoputkyOdPair,
} from './poputky-od';

describe('poputky-od', () => {
  test('parseOdCodesFromRoute: corridor and variant', () => {
    expect(parseOdCodesFromRoute('Kyiv-Malyn')).toEqual({ fromCode: 'Kyiv', toCode: 'Malyn' });
    expect(parseOdCodesFromRoute('Kyiv-Malyn-Irpin')).toEqual({ fromCode: 'Kyiv', toCode: 'Malyn' });
    expect(parseOdCodesFromRoute('Kyiv')).toBeNull();
  });

  test('buildOdRouteSlug', () => {
    expect(buildOdRouteSlug('Irpin', 'Malyn')).toBe('Irpin-Malyn');
  });

  test('formatOdRouteLabel uses default map', () => {
    expect(formatOdRouteLabel('Irpin-Malyn', { Irpin: 'Ірпінь', Malyn: 'Малин' })).toBe('Ірпінь → Малин');
    expect(
      formatOdRouteLabel('Kyiv-Malyn-Irpin', { Kyiv: 'Київ', Malyn: 'Малин', Irpin: 'Ірпінь' })
    ).toBe('Київ → Малин (через Ірпінь)');
  });

  test('buildOdMatchWhere: with points uses dual-read OR', () => {
    expect(buildOdMatchWhere({ route: 'Kyiv-Malyn', fromPointId: 1, toPointId: 2 })).toEqual({
      OR: [
        { fromPointId: 1, toPointId: 2 },
        { fromPointId: null, toPointId: null, route: 'Kyiv-Malyn' },
      ],
    });
  });

  test('buildOdMatchWhere: without points falls back to route', () => {
    expect(buildOdMatchWhere({ route: 'Malyn-Kyiv' })).toEqual({ route: 'Malyn-Kyiv' });
  });

  test('resolveOdPointIdsFromRoute + resolvePoputkyOdPair', async () => {
    const points = [
      { id: 1, code: 'Kyiv', nameUk: 'Київ', appearInPoputky: true },
      { id: 2, code: 'Malyn', nameUk: 'Малин', appearInPoputky: true },
      { id: 3, code: 'Irpin', nameUk: 'Ірпінь', appearInPoputky: true },
      { id: 4, code: 'Other', nameUk: 'Інше', appearInPoputky: false },
    ];
    const prisma = {
      tripPoint: {
        findMany: async (args?: { where?: { appearInPoputky?: boolean } }) => {
          if (args?.where?.appearInPoputky) return points.filter((p) => p.appearInPoputky);
          return points;
        },
      },
    };

    const od = await resolveOdPointIdsFromRoute(prisma, 'Irpin-Malyn');
    expect(od).toEqual({ fromPointId: 3, toPointId: 2 });

    const ok = await resolvePoputkyOdPair(prisma, 'irpin', 'malyn');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.route).toBe('Irpin-Malyn');
      expect(ok.from.id).toBe(3);
      expect(ok.to.id).toBe(2);
    }

    const bad = await resolvePoputkyOdPair(prisma, 'Other', 'Malyn');
    expect(bad.ok).toBe(false);

    const same = await resolvePoputkyOdPair(prisma, 'Malyn', 'Malyn');
    expect(same.ok).toBe(false);

    const kyivMalyn = await resolveOdPointIdsFromRoute(prisma, 'Kyiv-Malyn');
    expect(kyivMalyn).toEqual({ fromPointId: 1, toPointId: 2 });
    expect(kyivMalyn).not.toEqual(od);
  });

  test('orderedPointIdsFromStops + isOdAlongItinerary', () => {
    const itinerary = orderedPointIdsFromStops([
      { pointId: 2, position: 2 },
      { pointId: 1, position: 0 },
      { pointId: 3, position: 1 },
    ]);
    expect(itinerary).toEqual([1, 3, 2]); // Kyiv, Irpin, Malyn
    expect(isOdAlongItinerary(itinerary, 3, 2)).toBe(true); // Irpin → Malyn
    expect(isOdAlongItinerary(itinerary, 1, 2)).toBe(true); // Kyiv → Malyn
    expect(isOdAlongItinerary(itinerary, 2, 3)).toBe(false); // reverse
    expect(isOdAlongItinerary(itinerary, 3, 99)).toBe(false);
    expect(isOdAlongItinerary([1, 2], 3, 2)).toBe(false); // corridor without Irpin
  });

  test('classifyPoputkyRouteMatch: exact and along_route', () => {
    const itinerary = [1, 3, 2]; // Kyiv, Irpin, Malyn
    expect(
      classifyPoputkyRouteMatch({
        driver: { route: 'Kyiv-Malyn', fromPointId: 1, toPointId: 2, itineraryPointIds: itinerary },
        passenger: { route: 'Kyiv-Malyn', fromPointId: 1, toPointId: 2 },
      })
    ).toBe('exact');

    expect(
      classifyPoputkyRouteMatch({
        driver: { route: 'Kyiv-Malyn', fromPointId: 1, toPointId: 2, itineraryPointIds: itinerary },
        passenger: { route: 'Irpin-Malyn', fromPointId: 3, toPointId: 2 },
      })
    ).toBe('along_route');

    expect(
      classifyPoputkyRouteMatch({
        driver: { route: 'Kyiv-Malyn', fromPointId: 1, toPointId: 2, itineraryPointIds: [1, 2] },
        passenger: { route: 'Irpin-Malyn', fromPointId: 3, toPointId: 2 },
      })
    ).toBeNull();

    expect(
      classifyPoputkyRouteMatch({
        driver: { route: 'Kyiv-Malyn', fromPointId: 1, toPointId: 2, itineraryPointIds: null },
        passenger: { route: 'Irpin-Malyn', fromPointId: 3, toPointId: 2 },
      })
    ).toBeNull();
  });
});
