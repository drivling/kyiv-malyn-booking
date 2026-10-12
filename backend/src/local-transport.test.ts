/**
 * Unit tests for local-transport dataset validation and legacy conversion.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  convertLegacyRuntime,
  fillOmittedRouteFields,
  replaceTransportDataset,
  validateTransportDataset,
  type TransportDataset,
  type TransportRouteVariantInput,
} from './local-transport';

function minimalDataset(overrides: Partial<TransportDataset> = {}): TransportDataset {
  return {
    stops: [{ id: 'st_0001', name: 'Барміна', lat: 50.77, lng: 29.24 }],
    routes: [{ id: '2', fromName: 'А', toName: 'Б' }],
    routeStops: [{ routeId: '2', stopId: 'st_0001', orderThere: 1, orderBack: 1, mapOnly: false }],
    trips: [
      {
        id: '2-01',
        routeId: '2',
        serviceId: 'everyday',
        headsign: 'Б',
        directionId: '1',
        departureTime: '07:00:00',
      },
    ],
    segments: [],
    meta: { defaultSec: 120, center: [50.77, 29.24] },
    ...overrides,
  };
}

test('validateTransportDataset: ok for minimal valid dataset', () => {
  const { errors, dataset } = validateTransportDataset(minimalDataset());
  assert.equal(errors.length, 0);
  assert.ok(dataset);
  assert.equal(dataset!.stops.length, 1);
});

test('validateTransportDataset: rejects missing arrays', () => {
  const { errors } = validateTransportDataset({ meta: {} });
  assert.ok(errors.some((e) => e.includes('stops')));
});

test('validateTransportDataset: rejects unknown stop in routeStop', () => {
  const { errors } = validateTransportDataset(
    minimalDataset({
      routeStops: [{ routeId: '2', stopId: 'st_missing', orderThere: 1, orderBack: 1 }],
    })
  );
  assert.ok(errors.some((e) => e.includes('unknown stop')));
});

test('validateTransportDataset: rejects bad departureTime', () => {
  const { errors } = validateTransportDataset(
    minimalDataset({
      trips: [{ id: '2-01', routeId: '2', departureTime: '7am' }],
    })
  );
  assert.ok(errors.some((e) => e.includes('departureTime')));
});

test('validateTransportDataset: rejects non-boolean unreliable', () => {
  const { errors } = validateTransportDataset(
    minimalDataset({
      routes: [{ id: '2', unreliable: 'yes' as unknown as boolean }],
    })
  );
  assert.ok(errors.some((e) => e.includes('unreliable must be boolean')));
});

test('validateTransportDataset: accepts boolean / omitted unreliable', () => {
  const ok = validateTransportDataset(minimalDataset({ routes: [{ id: '2', unreliable: true }] }));
  assert.equal(ok.errors.length, 0);
  const omitted = validateTransportDataset(minimalDataset({ routes: [{ id: '2' }] }));
  assert.equal(omitted.errors.length, 0);
});

test('validateTransportDataset: shortName is an optional one-line string up to 16 characters', () => {
  for (const shortName of ['11/1', '5А', '', undefined]) {
    assert.equal(validateTransportDataset(minimalDataset({ routes: [{ id: '2', shortName }] })).errors.length, 0, String(shortName));
  }
  const bad = (shortName: unknown) =>
    validateTransportDataset(minimalDataset({ routes: [{ id: '2', shortName: shortName as string }] })).errors.join(' ');
  assert.match(bad(11), /shortName must be a string/);
  assert.match(bad('11\n1'), /shortName must be one line/);
  assert.match(bad('Дуже довгий номер маршруту'), /shortName longer than 16/);
});

/** Мінімальна заглушка Prisma для replaceTransportDataset: зберігає створені маршрути в пам'яті. */
function routeStore(initial: Array<{ id: string; shortName: string }>) {
  const state = { routes: initial.map((r) => ({ ...r })) as Array<Record<string, unknown>> };
  const model = (key?: 'routes') => ({
    findMany: async () => (key ? state[key] : []),
    deleteMany: async () => {
      if (key) state[key] = [];
      return { count: 0 };
    },
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      if (key) state[key] = data.map((r) => ({ ...r }));
      return { count: data.length };
    },
    upsert: async () => ({}),
  });
  const prisma = {
    transportStop: model(),
    transportRoute: model('routes'),
    transportRouteStop: model(),
    transportTrip: model(),
    transportSegment: model(),
    transportMeta: model(),
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaClient;
  return { prisma, state };
}

test('replaceTransportDataset: shortName is saved trimmed; a route without the key keeps its previous number', async () => {
  const { prisma, state } = routeStore([
    { id: '2', shortName: '2К' },
    { id: '11', shortName: '11/1' },
  ]);
  await replaceTransportDataset(
    prisma,
    minimalDataset({
      routes: [
        { id: '2', fromName: 'А', toName: 'Б', shortName: ' 2А ' },
        { id: '11', fromName: 'А', toName: 'Б' }, // старий клієнт: ключа немає
        { id: '12', fromName: 'А', toName: 'Б' }, // новий маршрут без номера
      ],
    })
  );
  const byId = new Map(state.routes.map((r) => [r.id, r.shortName]));
  assert.equal(byId.get('2'), '2А');
  assert.equal(byId.get('11'), '11/1');
  assert.equal(byId.get('12'), '');
});

test('convertLegacyRuntime: reads short_name from supplement.routes', () => {
  const { dataset } = convertLegacyRuntime({
    transport: {
      records: [{ route_id: '11', trip_id: '11-01', direction_id: '1', departure_time: '07:00:00' }],
      supplement: { routes: { '11': { from: 'А', to: 'Б', short_name: '11/1' } }, stops: { stops_catalog: {}, stops_by_route: {} } },
    },
    coords: { center: [50.77, 29.24], stops: {} },
    segments: { defaultSec: 120, segments: {} },
  });
  assert.equal(dataset.routes[0].shortName, '11/1');
});

test('convertLegacyRuntime: maps timed trip and coords', () => {
  const { dataset, warnings } = convertLegacyRuntime({
    transport: {
      records: [
        {
          route_id: '2',
          trip_id: '2-01',
          service_id: 'пн-вт-ср-чт-пт-сб-нд',
          trip_headsign: 'Лікарня',
          direction_id: '1',
          departure_time: '07:00:00',
        },
      ],
      supplement: {
        routes: { '2': { from: 'Фабрика', to: 'Лікарня' } },
        stops: {
          stops_catalog: { st_0001: { name: 'Барміна' } },
          stops_by_route: {
            '2': [{ id: 'st_0001', name: 'Барміна', order_there: 1, order_back: 5 }],
          },
        },
      },
    },
    coords: { center: [50.77, 29.24], stops: { st_0001: [50.77, 29.24] } },
    segments: { defaultSec: 120, segments: { '2|st_0001|st_0001': 60 } },
    agency: { agency_id: 'malyn' },
  });
  assert.equal(warnings.length, 0);
  assert.equal(dataset.stops.length, 1);
  assert.equal(dataset.trips[0].serviceId, 'everyday');
  assert.equal(dataset.trips[0].departureTime, '07:00:00');
  assert.equal((dataset.meta.agency as { agency_id: string }).agency_id, 'malyn');
});

test('convertLegacyRuntime: reads unreliable flag from supplement.routes', () => {
  const { dataset } = convertLegacyRuntime({
    transport: {
      records: [
        { route_id: '10', trip_id: '10-01', direction_id: '1' },
        { route_id: '2', trip_id: '2-01', direction_id: '1', departure_time: '07:00:00' },
      ],
      supplement: {
        routes: { '10': { unreliable: true }, '2': { from: 'А', to: 'Б' } },
        stops: { stops_catalog: {}, stops_by_route: {} },
      },
    },
    coords: { center: [50.77, 29.24], stops: {} },
    segments: { defaultSec: 120, segments: {} },
  });
  const byId = new Map(dataset.routes.map((r) => [r.id, r]));
  assert.equal(byId.get('10')?.unreliable, true);
  assert.equal(byId.get('2')?.unreliable, false);
});

function shortTurnDataset(overrides: Partial<TransportDataset> = {}): TransportDataset {
  return minimalDataset({
    stops: [
      { id: 'st_a', name: 'А', lat: 50.77, lng: 29.24 },
      { id: 'st_m', name: 'Тех', lat: 50.771, lng: 29.241 },
      { id: 'st_b', name: 'Б', lat: 50.772, lng: 29.242 },
      { id: 'st_c', name: 'В', lat: 50.773, lng: 29.243 },
    ],
    routeStops: [
      { routeId: '2', stopId: 'st_a', orderThere: 1, orderBack: 4, mapOnly: false },
      { routeId: '2', stopId: 'st_m', orderThere: 2, orderBack: 3, mapOnly: true },
      { routeId: '2', stopId: 'st_b', orderThere: 3, orderBack: 2, mapOnly: false },
      { routeId: '2', stopId: 'st_c', orderThere: 4, orderBack: -1, mapOnly: false },
    ],
    ...overrides,
  });
}

function tripWith(extra: Partial<TransportDataset['trips'][number]>) {
  return [{ id: '2-01', routeId: '2', directionId: '1', departureTime: '07:00:00', ...extra }];
}

test('validate: short-turn trip with start/end/arrival is accepted', () => {
  const { errors } = validateTransportDataset(
    shortTurnDataset({ trips: tripWith({ startStopId: 'st_a', endStopId: 'st_b', arrivalTime: '07:10:00' }) })
  );
  assert.deepEqual(errors, []);
});

test('validate: start/end must be passenger stops of the route in that direction', () => {
  const cases: Array<[Partial<TransportDataset['trips'][number]>, string]> = [
    [{ startStopId: 'st_zzz' }, 'startStopId st_zzz is not a passenger stop'],
    [{ endStopId: 'st_m' }, 'endStopId st_m is not a passenger stop'], // технічна точка
    [{ directionId: '0', startStopId: 'st_c' }, 'startStopId st_c is not a passenger stop'], // orderBack -1
    [{ startStopId: 'st_b', endStopId: 'st_a' }, 'startStopId must precede endStopId'],
    [{ startStopId: 'st_b', endStopId: 'st_b' }, 'startStopId must precede endStopId'],
    [{ endStopId: 'st_a' }, 'startStopId must precede endStopId'], // кінцева = перша зупинка
    [{ startStopId: 5 as unknown as string }, 'startStopId must be a string'],
  ];
  for (const [extra, expected] of cases) {
    const { errors } = validateTransportDataset(shortTurnDataset({ trips: tripWith(extra) }));
    assert.ok(errors.some((e) => e.includes(expected)), `${JSON.stringify(extra)} → ${errors.join('; ')}`);
  }
});

test('validate: arrivalTime format, order and dependency on departureTime', () => {
  const bad = validateTransportDataset(shortTurnDataset({ trips: tripWith({ arrivalTime: '7am' }) }));
  assert.ok(bad.errors.some((e) => e.includes('bad arrivalTime')));
  const early = validateTransportDataset(shortTurnDataset({ trips: tripWith({ arrivalTime: '07:00' }) }));
  assert.ok(early.errors.some((e) => e.includes('arrivalTime must be after departureTime')));
  const noDep = validateTransportDataset(
    shortTurnDataset({ trips: tripWith({ departureTime: null, arrivalTime: '07:30' }) })
  );
  assert.ok(noDep.errors.some((e) => e.includes('arrivalTime requires departureTime')));
  const empty = validateTransportDataset(
    shortTurnDataset({ trips: tripWith({ startStopId: '', endStopId: '', arrivalTime: '' }) })
  );
  assert.deepEqual(empty.errors, []);
});

test('convertLegacyRuntime: maps snake_case start/end/arrival, empty → null', () => {
  const { dataset } = convertLegacyRuntime({
    transport: {
      records: [
        { route_id: '2', trip_id: '2-01', direction_id: '1', departure_time: '07:00:00',
          start_stop_id: 'st_a', end_stop_id: 'st_b', arrival_time: '07:10:00' },
        { route_id: '2', trip_id: '2-02', direction_id: '1', departure_time: '08:00:00', start_stop_id: '' },
      ],
      supplement: { routes: {}, stops: { stops_catalog: {}, stops_by_route: {} } },
    },
    coords: { center: [50.77, 29.24], stops: {} },
    segments: { defaultSec: 120, segments: {} },
  });
  assert.equal(dataset.trips[0].startStopId, 'st_a');
  assert.equal(dataset.trips[0].endStopId, 'st_b');
  assert.equal(dataset.trips[0].arrivalTime, '07:10:00');
  assert.equal(dataset.trips[1].startStopId, null);
  assert.equal(dataset.trips[1].arrivalTime, null);
});

// ---------- Варіанти шляху й опорні часи (Docs/route-variants-2026-10.md) ----------

/** Маршрут 9: основний ланцюжок туди a → b → c, назад c → b → a; варіант «туди» a → тех → v (v — лише у варіанті). */
function variantDataset(
  variants: TransportRouteVariantInput[] = [mainVariant()],
  trips: TransportDataset['trips'] = []
): TransportDataset {
  return minimalDataset({
    stops: [
      { id: 'st_a', name: 'А', lat: 50.77, lng: 29.24 },
      { id: 'st_b', name: 'Б', lat: 50.771, lng: 29.241 },
      { id: 'st_c', name: 'В', lat: 50.772, lng: 29.242 },
      { id: 'st_m', name: '№9 т.1', lat: 50.773, lng: 29.243 },
      { id: 'st_v', name: 'Вокзал', lat: 50.774, lng: 29.244 },
    ],
    routes: [{ id: '9', fromName: 'А', toName: 'В', variants }],
    routeStops: [
      { routeId: '9', stopId: 'st_a', orderThere: 1, orderBack: 3 },
      { routeId: '9', stopId: 'st_b', orderThere: 2, orderBack: 2 },
      { routeId: '9', stopId: 'st_c', orderThere: 3, orderBack: 1 },
    ],
    trips,
  });
}

function mainVariant(extra: Partial<TransportRouteVariantInput> = {}): TransportRouteVariantInput {
  return {
    id: '9-v1',
    directionId: '1',
    name: 'Перший рейс ч/з вокзал',
    stops: [{ stopId: 'st_a' }, { stopId: 'st_m', mapOnly: true }, { stopId: 'st_b' }, { stopId: 'st_v' }],
    ...extra,
  };
}

function variantTrip(extra: Partial<TransportDataset['trips'][number]> = {}): TransportDataset['trips'][number] {
  return { id: '9-01', routeId: '9', directionId: '1', departureTime: '06:45:00', variantId: '9-v1', ...extra };
}

test('validate: a variant trip with timepoints on its own chain is accepted', () => {
  const { errors } = validateTransportDataset(
    variantDataset(undefined, [
      variantTrip({ timepoints: [{ stopId: 'st_b', time: '06:55' }, { stopId: 'st_v', time: '07:05:00' }] }),
      { id: '9-02', routeId: '9', directionId: '1', departureTime: '08:00:00', variantId: null, timepoints: [] },
    ])
  );
  assert.deepEqual(errors, []);
});

test('validate: variant shape errors', () => {
  const cases: Array<[unknown, string]> = [
    ['nope', 'variants must be an array'],
    [[null], 'variant must be an object'],
    [[mainVariant({ id: 'бад id' })], 'bad id'],
    [[mainVariant(), mainVariant()], 'duplicate variant id'],
    [[mainVariant({ directionId: '2' })], 'directionId must be "0" or "1"'],
    [[mainVariant({ name: ' ' })], 'name required'],
    [[mainVariant({ name: 'два\nрядки' })], 'name must be one line'],
    [[mainVariant({ name: 'х'.repeat(81) })], 'name longer than 80'],
    [[mainVariant({ stops: 'a' as unknown as [] })], 'stops must be an array'],
    [[mainVariant({ stops: [{ stopId: 'st_a' }, { stopId: 'st_zzz' }] })], 'unknown stop st_zzz'],
    [[mainVariant({ stops: [{ stopId: 'st_a' }, { stopId: 'st_b' }, { stopId: 'st_a' }] })], 'stop st_a repeats'],
    [[mainVariant({ stops: [{ stopId: 'st_a' }, { stopId: 'st_m', mapOnly: true }] })], 'needs at least 2 passenger stops'],
    [[mainVariant({ stops: [{ stopId: 'st_a' }, { stopId: 'st_b' }, { stopId: 'st_m', mapOnly: true }] })], 'first and last points'],
    [[mainVariant({ stops: [{ stopId: 'st_a' }, { stopId: 'st_b', mapOnly: 'так' as unknown as boolean }, { stopId: 'st_v' }] })], 'mapOnly must be boolean'],
    [[mainVariant({ stops: [5 as unknown as { stopId: string }, { stopId: 'st_a' }, { stopId: 'st_b' }] })], 'stop #1 must be { stopId }'],
  ];
  for (const [variants, expected] of cases) {
    const { errors } = validateTransportDataset(variantDataset(variants as TransportRouteVariantInput[]));
    assert.ok(errors.some((e) => e.includes(expected)), `${expected} → ${errors.join('; ')}`);
  }
});

test('validate: a trip variant must exist, belong to the route and match the direction; start/end use its chain', () => {
  const other = { id: '5', fromName: 'X', toName: 'Y', variants: [mainVariant({ id: '5-v1' })] };
  const cases: Array<[Partial<TransportDataset['trips'][number]>, string]> = [
    [{ variantId: 'nope' }, 'unknown variant nope'],
    [{ variantId: 5 as unknown as string }, 'variantId must be a string'],
    [{ variantId: '5-v1' }, 'variant 5-v1 belongs to route 5'],
    [{ directionId: '0' }, 'is for the other direction'],
    [{ endStopId: 'st_c' }, 'endStopId st_c is not a passenger stop of variant 9-v1'], // c — лише в основному ланцюжку
    [{ startStopId: 'st_m' }, 'startStopId st_m is not a passenger stop of variant 9-v1'], // технічна точка
    [{ startStopId: 'st_v', endStopId: 'st_b' }, 'startStopId must precede endStopId'],
  ];
  for (const [extra, expected] of cases) {
    const ds = variantDataset(undefined, [variantTrip(extra)]);
    ds.routes.push(other);
    const { errors } = validateTransportDataset(ds);
    assert.ok(errors.some((e) => e.includes(expected)), `${JSON.stringify(extra)} → ${errors.join('; ')}`);
  }
  // кінцева у варіанті — st_v, якої немає в основному ланцюжку
  assert.deepEqual(validateTransportDataset(variantDataset(undefined, [variantTrip({ endStopId: 'st_v' })])).errors, []);
});

test('validate: timepoints rules', () => {
  const tp = (stopId: string, time: string) => ({ stopId, time });
  const cases: Array<[Partial<TransportDataset['trips'][number]>, string]> = [
    [{ timepoints: 'x' as unknown as [] }, 'timepoints must be an array'],
    [{ timepoints: Array.from({ length: 41 }, () => tp('st_v', '07:05')) }, 'more than 40 timepoints'],
    [{ departureTime: null, timepoints: [tp('st_v', '07:05')] }, 'timepoints require departureTime'],
    [{ arrivalTime: '07:10', timepoints: [tp('st_v', '07:05')] }, 'use timepoints or arrivalTime'],
    [{ timepoints: [tp('st_v', '7am')] }, 'bad time "7am"'],
    [{ timepoints: [{ stopId: 'st_v' } as unknown as { stopId: string; time: string }] }, 'timepoint must be { stopId, time }'],
    [{ timepoints: [tp('st_m', '07:00')] }, 'timepoint st_m is not a passenger stop'],
    [{ timepoints: [tp('st_a', '06:50')] }, 'must follow the previous one'], // перша зупинка — це відправлення
    [{ timepoints: [tp('st_v', '07:05'), tp('st_b', '07:10')] }, 'must follow the previous one'],
    [{ endStopId: 'st_b', timepoints: [tp('st_v', '07:05')] }, 'must follow the previous one'], // поза зрізом
    [{ timepoints: [tp('st_b', '06:45')] }, 'must be later than the previous time'],
    [{ timepoints: [tp('st_b', '07:00'), tp('st_v', '06:59')] }, 'must be later than the previous time'],
  ];
  for (const [extra, expected] of cases) {
    const { errors } = validateTransportDataset(variantDataset(undefined, [variantTrip(extra)]));
    assert.ok(errors.some((e) => e.includes(expected)), `${JSON.stringify(extra)} → ${errors.join('; ')}`);
  }
  // опорні часи на основному ланцюжку теж можна
  const main = validateTransportDataset(
    variantDataset([], [{ id: '9-02', routeId: '9', directionId: '1', departureTime: '08:00', timepoints: [tp('st_c', '08:20')] }])
  );
  assert.deepEqual(main.errors, []);
});

test('fillOmittedRouteFields: missing or null keeps stored variants, [] clears, unknown route gets none', async () => {
  const stored = [mainVariant()];
  const prisma = {
    transportRoute: { findMany: async () => [{ id: '9', variants: stored }, { id: '5', variants: null }] },
  } as unknown as PrismaClient;
  const body = {
    routes: [{ id: '9' }, { id: '5', variants: null }, { id: '7', variants: [] }, { id: '12' }],
  } as unknown as TransportDataset;
  await fillOmittedRouteFields(prisma, body);
  const byId = new Map(body.routes.map((r) => [r.id, r.variants]));
  assert.deepEqual(byId.get('9'), stored);
  assert.deepEqual(byId.get('5'), []);
  assert.deepEqual(byId.get('7'), []);
  assert.deepEqual(byId.get('12'), []);

  let calls = 0;
  const counting = { transportRoute: { findMany: async () => (calls++, []) } } as unknown as PrismaClient;
  await fillOmittedRouteFields(counting, { routes: [{ id: '9', variants: [] }] });
  await fillOmittedRouteFields(counting, null);
  assert.equal(calls, 0); // усі ключі є — БД не читаємо
});

test('replaceTransportDataset: stores variants and trip variantId/timepoints in a compact form, empty → NULL', async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = { routes: [], trips: [] };
  const model = (key?: 'routes' | 'trips') => ({
    findMany: async () => [],
    deleteMany: async () => ({ count: 0 }),
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      if (key) rows[key] = data;
      return { count: data.length };
    },
    upsert: async () => ({}),
  });
  const prisma = {
    transportStop: model(),
    transportRoute: model('routes'),
    transportRouteStop: model(),
    transportTrip: model('trips'),
    transportSegment: model(),
    transportMeta: model(),
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaClient;
  const ds = variantDataset(
    [mainVariant({ name: ' Перший рейс ', stops: [{ stopId: 'st_a', mapOnly: false }, { stopId: 'st_m', mapOnly: true }, { stopId: 'st_v' }] })],
    [variantTrip({ timepoints: [{ stopId: 'st_v', time: '07:05:00' }] }), { id: '9-02', routeId: '9', directionId: '1', variantId: '', timepoints: [] }]
  );
  ds.routes.push({ id: '5', variants: [] });
  await replaceTransportDataset(prisma, { ...ds, routes: ds.routes.map((r) => ({ ...r, shortName: '' })) });
  const routes = new Map(rows.routes.map((r) => [r.id, r.variants]));
  assert.deepEqual(routes.get('9'), [
    { id: '9-v1', directionId: '1', name: 'Перший рейс', stops: [{ stopId: 'st_a' }, { stopId: 'st_m', mapOnly: true }, { stopId: 'st_v' }] },
  ]);
  assert.equal(routes.get('5'), undefined);
  const trips = new Map(rows.trips.map((t) => [t.id, t]));
  assert.equal(trips.get('9-01')?.variantId, '9-v1');
  assert.deepEqual(trips.get('9-01')?.timepoints, [{ stopId: 'st_v', time: '07:05:00' }]);
  assert.equal(trips.get('9-02')?.variantId, null);
  assert.equal(trips.get('9-02')?.timepoints, undefined);
});
