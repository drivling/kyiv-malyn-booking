import type { Journey, TransitLeg } from './types';

/** Стабільний ключ поїздки: час + рейси (переживає перерахунок списку) */
export function journeyKey(j: Journey): string {
  return `${j.departMins}-${j.arriveMins}-${j.legs
    .filter((l): l is TransitLeg => l.kind === 'transit')
    .map((l) => l.tripId)
    .join('+')}`;
}
