import type { TransportDataset } from '@/api/transportDataset';

/**
 * Тестовий датасет наклейок (імпортують лише тести): справжні id вузлів схеми, щоб працювали назви
 * вузлів. Вулиця зі сходу на захід: Шевченка, 119 → Лікарня → Центр → «Прожектор» →
 * Малинівський круг → Вокзал. «Прожектор» обслуговує №5 і №11 в обидва боки, «Меркурій» навпроти
 * виключено (-1), як у живих даних; №1 ненадійний, №7 торкається «Прожектора» лише як вершина карти,
 * №3 має лише скорочений рейс, що закінчується на «Прожекторі».
 */
const stop = (id: string, name: string, lng: number, lat = 50.77) => ({ id, name, lat, lng });

const chain = (routeId: string, ids: string[], extra: Partial<Record<string, { mapOnly?: boolean }>> = {}) =>
  ids.map((stopId, i) => ({
    routeId,
    stopId,
    orderThere: i + 1,
    orderBack: ids.length - i,
    mapOnly: extra[stopId]?.mapOnly ?? false,
  }));

const trip = (id: string, routeId: string, directionId: string, more: Record<string, string | null> = {}) => ({
  id,
  routeId,
  serviceId: 'everyday',
  headsign: '',
  directionId,
  departureTime: '08:00:00',
  blockId: null,
  ...more,
});

export const STICKER_DATASET: TransportDataset = {
  stops: [
    stop('st_0097', 'Шевченка 119', 29.2),
    stop('st_0035', 'Лікарня', 29.22),
    stop('st_0064', 'Паперова фабрика Вайдманн', 29.23, 50.76),
    stop('st_0070', 'пл. Соборна (біля РБК)', 29.24),
    stop('st_0015', 'з-д "Прожектор"', 29.256),
    stop('st_0046', 'м-н "Меркурій"', 29.2561, 50.7701),
    stop('st_0054', 'Малинівський круг', 29.27),
    stop('st_0019', 'Залізничний вокзал', 29.29),
  ],
  routes: [
    { id: '1', fromName: '', toName: '', unreliable: true },
    { id: '3', fromName: 'Центр', toName: 'Залізничний вокзал' },
    { id: '5', fromName: 'Шевченка 119', toName: 'Залізничний вокзал' },
    { id: '7', fromName: 'Центр', toName: 'Залізничний вокзал' },
    { id: '11', fromName: 'Паперова фабрика Вайдманн', toName: 'Залізничний вокзал' },
  ],
  routeStops: [
    ...chain('1', ['st_0070', 'st_0015', 'st_0019']),
    ...chain('3', ['st_0070', 'st_0015', 'st_0054', 'st_0019']),
    ...chain('5', ['st_0097', 'st_0035', 'st_0070', 'st_0015', 'st_0054', 'st_0019']),
    { routeId: '5', stopId: 'st_0046', orderThere: -1, orderBack: -1, mapOnly: false },
    ...chain('7', ['st_0070', 'st_0015', 'st_0019'], { st_0015: { mapOnly: true } }),
    ...chain('11', ['st_0064', 'st_0070', 'st_0015', 'st_0054', 'st_0019']),
  ],
  trips: [
    trip('1-1', '1', '1'),
    trip('3-1', '3', '1', { endStopId: 'st_0015' }),
    trip('5-1', '5', '1'),
    trip('5-0', '5', '0'),
    trip('7-1', '7', '1'),
    trip('11-1', '11', '1'),
    trip('11-0', '11', '0'),
  ],
  segments: [],
  meta: { fare: { amount: 20, currency: 'UAH' }, center: [50.768, 29.242] },
};
