/**
 * Поїздка → геометрія для карти: ділянки рейсів уздовж ланцюжка рейсу (з технічними точками, що гнуть лінію по
 * вулицях), пішки — пряма між кінцями. Чисте: ланцюжок рейсу й координати дає викликач.
 */
import type { LatLng } from '../routeGeometry';
import type { Journey, Place, TransitLeg } from './types';

export interface MapJourneyLeg {
  kind: 'transit' | 'walk';
  routeId?: string;
  positions: LatLng[];
}

export interface MapJourney {
  legs: MapJourneyLeg[];
  /** Посадки й висадки (пересадкові точки) */
  nodes: LatLng[];
}

export interface MapJourneyContext {
  /** Координати зупинок і технічних точок */
  coords: Record<string, LatLng>;
  /** Ланцюжок рейсу (з технічними точками); порожній — малюємо прямими між пасажирськими зупинками */
  chainOf: (leg: TransitLeg) => string[];
}

function placePosition(place: Place, coords: Record<string, LatLng>): LatLng | null {
  if ('stopId' in place) return coords[place.stopId] ?? null;
  return [place.lat, place.lng];
}

function transitPositions(leg: TransitLeg, ctx: MapJourneyContext): LatLng[] {
  const chain = ctx.chainOf(leg);
  const a = chain.indexOf(leg.boardStopId);
  const b = chain.indexOf(leg.alightStopId);
  const keys = a >= 0 && b > a ? chain.slice(a, b + 1) : leg.stopIds;
  return keys.map((k) => ctx.coords[k]).filter((p): p is LatLng => Array.isArray(p));
}

export function journeyToMap(journey: Journey, ctx: MapJourneyContext): MapJourney {
  const legs: MapJourneyLeg[] = [];
  const nodes: LatLng[] = [];
  for (const leg of journey.legs) {
    if (leg.kind === 'transit') {
      const positions = transitPositions(leg, ctx);
      if (positions.length >= 2) legs.push({ kind: 'transit', routeId: leg.routeId, positions });
      const board = ctx.coords[leg.boardStopId];
      const alight = ctx.coords[leg.alightStopId];
      if (board) nodes.push(board);
      if (alight) nodes.push(alight);
    } else {
      const from = placePosition(leg.from, ctx.coords);
      const to = placePosition(leg.to, ctx.coords);
      if (from && to) legs.push({ kind: 'walk', positions: [from, to] });
    }
  }
  return { legs, nodes };
}
