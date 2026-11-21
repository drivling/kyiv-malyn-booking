/** Малий датасет для тестів звірки свого розкладу з Google (city-check, city-campaign) */
import type { TransportDataset } from '../local-transport';

/** П'ять зупинок уздовж меридіана, ~555 м одна від одної; між B і C — технічна точка */
export const CHECK_DATASET: TransportDataset = {
  stops: [
    { id: 'st_1', name: 'Вокзал', lat: 50.95, lng: 28.6 },
    { id: 'st_2', name: 'Ринок', lat: 50.955, lng: 28.6 },
    { id: 't_1', name: '№1 т.1', lat: 50.9575, lng: 28.6 },
    { id: 'st_3', name: 'Лікарня', lat: 50.96, lng: 28.6 },
    { id: 'st_4', name: 'Школа', lat: 50.965, lng: 28.6 },
    { id: 'st_5', name: 'Завод', lat: 50.97, lng: 28.6 },
  ],
  routes: [
    { id: '1', shortName: '1-А' },
    { id: '2' },
    { id: '9', unreliable: true },
  ],
  routeStops: [
    { routeId: '1', stopId: 'st_1', orderThere: 1, orderBack: 6 },
    { routeId: '1', stopId: 'st_2', orderThere: 2, orderBack: 5 },
    { routeId: '1', stopId: 't_1', orderThere: 3, orderBack: 4, mapOnly: true },
    { routeId: '1', stopId: 'st_3', orderThere: 4, orderBack: 3 },
    { routeId: '1', stopId: 'st_4', orderThere: 5, orderBack: 2 },
    { routeId: '1', stopId: 'st_5', orderThere: 6, orderBack: 1 },
    // №2 їде ту саму пару Вокзал → Завод напряму, лише «туди»
    { routeId: '2', stopId: 'st_1', orderThere: 1 },
    { routeId: '2', stopId: 'st_5', orderThere: 2 },
    { routeId: '9', stopId: 'st_1', orderThere: 1 },
    { routeId: '9', stopId: 'st_4', orderThere: 2 },
  ],
  trips: [
    { id: '1-a', routeId: '1', directionId: '1', serviceId: 'weekdays', departureTime: '06:30' },
    { id: '1-b', routeId: '1', directionId: '1', serviceId: 'weekdays', departureTime: '09:55' },
    { id: '1-c', routeId: '1', directionId: '1', serviceId: 'weekends', departureTime: '10:00' },
    { id: '1-d', routeId: '1', directionId: '0', serviceId: 'weekends', departureTime: '15:20' },
    { id: '2-a', routeId: '2', directionId: '1', serviceId: 'everyday', departureTime: '12:00' },
    { id: '9-a', routeId: '9', directionId: '1', serviceId: 'everyday', departureTime: '10:00' },
  ],
  segments: [
    ...[['st_1', 'st_2', 180], ['st_2', 't_1', 60], ['t_1', 'st_3', 60], ['st_3', 'st_4', 240], ['st_4', 'st_5', 180]].flatMap(([a, b, s]) => [
      { routeId: '1', fromStopId: a as string, toStopId: b as string, seconds: s as number },
      { routeId: '1', fromStopId: b as string, toStopId: a as string, seconds: s as number },
    ]),
    { routeId: '2', fromStopId: 'st_1', toStopId: 'st_5', seconds: 600 },
    { routeId: '9', fromStopId: 'st_1', toStopId: 'st_4', seconds: 300 },
  ],
  meta: {},
};
