/**
 * Усі місця, які знає «Доведе» в браузері: кураторський словник (`gazetteer.ts`) + зупинки з розкладу міста
 * (`stopPlaces.ts`). Зупинки приходять із датасетом, тому тут — «поточний» список, як у номерах і кольорах
 * маршрутів (`routeNames.ts`): сторінка викликає `setStopPlaces`, решта питає `resolvePlace`.
 */
import { placeById, type GazetteerPlace } from './gazetteer';
import type { StopPlace } from './stopPlaces';
import { landmarkPlace } from './landmarks';
import { streetPlace } from './streets';

let stopIndex: StopPlace[] = [];
let byId = new Map<string, GazetteerPlace>();

export function setStopPlaces(index: StopPlace[]): void {
  stopIndex = index;
  byId = new Map(index.map((e) => [e.place.id, e.place]));
}

export function getStopPlaces(): StopPlace[] {
  return stopIndex;
}

/** Місце за id: `city.Kyiv`, `malyn.vokzal`, зупинка `st_0071`, адреса `street.horodyshchanska:20` або орієнтир `lm.atb-market` */
export function resolvePlace(id: string): GazetteerPlace | undefined {
  return placeById(id) ?? byId.get(id) ?? (id.startsWith('street.') ? streetPlace(id) : id.startsWith('lm.') ? landmarkPlace(id) : undefined);
}
