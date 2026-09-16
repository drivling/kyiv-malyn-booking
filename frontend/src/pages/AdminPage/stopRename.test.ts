import { describe, it, expect } from 'vitest';
import type { TransportDataset } from '@/api/transportDataset';
import type { TransportData } from './mapEditorModel';
import {
  applyStopRenamesToDataset,
  buildStopRenameMap,
  countEditorChanges,
  filterStopIds,
  formatChangesLabel,
  formatPropagationSummary,
  pluralUk,
  renameStopInEditor,
  summarizeRenamePropagation,
  validateStopName,
} from './stopRename';

const catalog = { st_a: { name: 'Базар' }, st_b: { name: 'Вокзал' }, st_c: { name: 'Лікарня' } };

function editorData(): TransportData {
  return {
    supplement: {
      routes: { '2': { from: 'Базар', to: 'Лікарня' }, '3': { from: 'Ринок', to: 'Лікарня (Лісотехнікум)' } },
      stops: {
        stops_catalog: { ...catalog },
        stops_by_route: {
          '2': [
            { id: 'st_a', name: 'Базар', order_there: 1, order_back: 3 },
            { id: 'st_b', name: 'Вокзал', order_there: 2, order_back: 2 },
            { id: 'st_c', name: 'Лікарня', order_there: 3, order_back: 1 },
          ],
          '3': [
            { id: 'st_c', name: 'Лікарня', order_there: 1, order_back: 1, map_only: true },
          ],
          legacy: ['Базар', 'Лікарня'],
        },
      },
    },
  };
}

function dataset(): TransportDataset {
  return {
    stops: [
      { id: 'st_a', name: 'Базар', lat: 50.77, lng: 29.24 },
      { id: 'st_b', name: 'Вокзал', lat: 50.78, lng: 29.25 },
      { id: 'st_c', name: 'Лікарня', lat: 50.79, lng: 29.26 },
    ],
    routes: [
      { id: '2', fromName: 'Базар', toName: 'Лікарня' },
      { id: '3', fromName: 'Ринок', toName: 'Лікарня (Лісотехнікум)' },
    ],
    routeStops: [
      { routeId: '2', stopId: 'st_a', orderThere: 1, orderBack: 3, mapOnly: false },
      { routeId: '2', stopId: 'st_b', orderThere: 2, orderBack: 2, mapOnly: false },
      { routeId: '2', stopId: 'st_c', orderThere: 3, orderBack: 1, mapOnly: false },
    ],
    trips: [
      { id: 't1', routeId: '2', headsign: 'Лікарня' },
      { id: 't2', routeId: '2', headsign: 'Базар' },
      { id: 't3', routeId: '3', headsign: 'Лікарня (Лісотехнікум)' },
    ],
    segments: [{ routeId: '2', fromStopId: 'st_a', toStopId: 'st_b', seconds: 240 }],
    meta: { center: [50.768, 29.242] },
  };
}

describe('validateStopName', () => {
  it('rejects empty, whitespace-only and too long names', () => {
    expect(validateStopName('', catalog, 'st_a')).toBe('Назва не може бути порожньою');
    expect(validateStopName('   ', catalog, 'st_a')).toBe('Назва не може бути порожньою');
    expect(validateStopName('а'.repeat(81), catalog, 'st_a')).toMatch(/задовга/);
    expect(validateStopName('а'.repeat(80), catalog, 'st_a')).toBeNull();
  });

  it('rejects a name already used by another stop (case- and whitespace-insensitive), names it', () => {
    expect(validateStopName('базар ', catalog, 'st_b')).toBe('Така назва вже є: Базар (st_a)');
    expect(validateStopName('  ЛІКАРНЯ', catalog, 'st_a')).toBe('Така назва вже є: Лікарня (st_c)');
  });

  it("accepts a stop's own name and a distinct name; works without a catalog", () => {
    expect(validateStopName('Базар', catalog, 'st_a')).toBeNull();
    expect(validateStopName('Лікарня (центр)', catalog, 'st_c')).toBeNull();
    expect(validateStopName('Нова', undefined, 'st_x')).toBeNull();
  });
});

describe('renameStopInEditor', () => {
  it('updates the catalog and the name inside every route that has the stop, leaves the rest', () => {
    const input = editorData();
    const out = renameStopInEditor(input, 'st_c', '  Лікарня   (центр) ');
    expect(out).not.toBe(input);
    expect(out.supplement?.stops?.stops_catalog).toEqual({ ...catalog, st_c: { name: 'Лікарня (центр)' } });
    const sbr = out.supplement!.stops!.stops_by_route!;
    expect((sbr['2'] as Array<{ name: string }>).map((s) => s.name)).toEqual(['Базар', 'Вокзал', 'Лікарня (центр)']);
    expect((sbr['3'] as Array<{ name: string; map_only?: boolean }>)[0]).toEqual({
      id: 'st_c', name: 'Лікарня (центр)', order_there: 1, order_back: 1, map_only: true,
    });
    // Легасі-масив назв: ключ — назва, тому за id нічого не збігається
    expect(sbr.legacy).toEqual(['Базар', 'Лікарня']);
    // Кінцеві маршрутів не чіпаємо тут — це робить пропагація при збереженні
    expect(out.supplement?.routes?.['2'].to).toBe('Лікарня');
    // Вхід не мутується
    expect(input.supplement?.stops?.stops_catalog?.st_c.name).toBe('Лікарня');
  });

  it('legacy string array: the entry equal to the key is renamed', () => {
    const input: TransportData = { supplement: { stops: { stops_by_route: { l: ['Базар', 'Лікарня'] } } } };
    const out = renameStopInEditor(input, 'Лікарня', 'Лікарня (центр)');
    expect(out.supplement?.stops?.stops_by_route?.l).toEqual(['Базар', 'Лікарня (центр)']);
    expect(out.supplement?.stops?.stops_catalog).toEqual({ 'Лікарня': { name: 'Лікарня (центр)' } });
  });

  it('returns the same reference when the normalized name is unchanged or empty', () => {
    const input = editorData();
    expect(renameStopInEditor(input, 'st_c', ' Лікарня ')).toBe(input);
    expect(renameStopInEditor(input, 'st_c', '   ')).toBe(input);
  });
});

describe('buildStopRenameMap', () => {
  it('maps db name → current name only for changed stops; added stops are skipped', () => {
    const base = dataset().stops;
    expect(buildStopRenameMap(base, catalog).size).toBe(0);
    const cat = { ...catalog, st_c: { name: 'Лікарня (центр)' }, st_new: { name: '№2 т.1' } };
    expect([...buildStopRenameMap(base, cat)]).toEqual([['Лікарня', 'Лікарня (центр)']]);
    expect(buildStopRenameMap(base, undefined).size).toBe(0);
  });

  it('a chained rename collapses to db → latest', () => {
    const cat = { ...catalog, st_c: { name: 'C3' } };
    expect(buildStopRenameMap(dataset().stops, cat).get('Лікарня')).toBe('C3');
  });
});

describe('applyStopRenamesToDataset', () => {
  it('rewrites exact matches in route termini and headsigns, nothing else', () => {
    const base = dataset();
    const { dataset: out, touchedRoutes, touchedTrips } = applyStopRenamesToDataset(
      base,
      new Map([['Лікарня', 'Лікарня (центр)']])
    );
    expect(touchedRoutes).toEqual([{ routeId: '2', field: 'toName' }]);
    expect(touchedTrips).toBe(1);
    expect(out.routes[0]).toEqual({ id: '2', fromName: 'Базар', toName: 'Лікарня (центр)' });
    expect(out.routes[1].toName).toBe('Лікарня (Лісотехнікум)');
    expect(out.trips.map((t) => t.headsign)).toEqual(['Лікарня (центр)', 'Базар', 'Лікарня (Лісотехнікум)']);
    expect(out.stops).toBe(base.stops);
    expect(out.segments).toBe(base.segments);
    expect(out.routeStops).toBe(base.routeStops);
    expect(base.routes[0].toName).toBe('Лікарня');
  });

  it('a swap is applied in one pass (no double rewrite)', () => {
    const { dataset: out } = applyStopRenamesToDataset(
      dataset(),
      new Map([['Базар', 'Лікарня'], ['Лікарня', 'Базар']])
    );
    expect(out.routes[0]).toMatchObject({ fromName: 'Лікарня', toName: 'Базар' });
    expect(out.trips.slice(0, 2).map((t) => t.headsign)).toEqual(['Базар', 'Лікарня']);
  });

  it('empty map or no match returns the same dataset reference', () => {
    const base = dataset();
    expect(applyStopRenamesToDataset(base, new Map()).dataset).toBe(base);
    expect(applyStopRenamesToDataset(base, new Map([['Ніде', 'X']])).dataset).toBe(base);
  });
});

describe('summarizeRenamePropagation / formatPropagationSummary', () => {
  it('counts routes (once each) and trips with the exact old name', () => {
    const base = dataset();
    expect(summarizeRenamePropagation(base, 'Лікарня')).toEqual({ routeIds: ['2'], tripCount: 1 });
    expect(summarizeRenamePropagation(base, 'Вокзал')).toEqual({ routeIds: [], tripCount: 0 });
    expect(summarizeRenamePropagation({ routes: [{ id: '9', fromName: 'X', toName: 'X' }], trips: [] }, 'X')).toEqual({
      routeIds: ['9'], tripCount: 0,
    });
  });

  it('formats the summary with Ukrainian plurals, null when nothing is touched', () => {
    expect(formatPropagationSummary({ routeIds: ['5', '11'], tripCount: 55 })).toBe(
      'Також оновиться при збереженні: кінцева №5, №11 · 55 рейсів'
    );
    expect(formatPropagationSummary({ routeIds: [], tripCount: 1 })).toBe('Також оновиться при збереженні: 1 рейс');
    expect(formatPropagationSummary({ routeIds: [], tripCount: 2 })).toBe('Також оновиться при збереженні: 2 рейси');
    expect(formatPropagationSummary({ routeIds: ['2'], tripCount: 0 })).toBe('Також оновиться при збереженні: кінцева №2');
    expect(formatPropagationSummary({ routeIds: [], tripCount: 0 })).toBeNull();
  });

  it('pluralUk and formatChangesLabel', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 111].map((n) => formatChangesLabel(n))).toEqual([
      '1 зміна', '2 зміни', '5 змін', '11 змін', '21 зміна', '22 зміни', '25 змін', '111 змін',
    ]);
    expect(pluralUk(3, ['рейс', 'рейси', 'рейсів'])).toBe('рейси');
  });
});

describe('countEditorChanges', () => {
  it('identical datasets → 0; missing input → 0', () => {
    expect(countEditorChanges(dataset(), dataset()).total).toBe(0);
    expect(countEditorChanges(null, dataset()).total).toBe(0);
  });

  it('rename, move, order swap, technical stop, normalized undefined vs -1', () => {
    const base = dataset();
    const renamed = dataset();
    renamed.stops[2].name = 'Лікарня (центр)';
    expect(countEditorChanges(base, renamed)).toMatchObject({ renamedStops: ['st_c'], total: 1 });

    const moved = dataset();
    moved.stops[0].lat = 50.7701;
    expect(countEditorChanges(base, moved)).toMatchObject({ movedStops: ['st_a'], total: 1 });

    const swapped = dataset();
    swapped.routeStops[0].orderThere = 2;
    swapped.routeStops[1].orderThere = 1;
    expect(countEditorChanges(base, swapped)).toMatchObject({ routeStopChanges: 2, total: 2 });

    const technical = dataset();
    technical.stops.push({ id: 'st_new', name: '№2 т.1', lat: 50.775, lng: 29.245 });
    technical.routeStops.push({ routeId: '2', stopId: 'st_new', orderThere: 4, orderBack: -1, mapOnly: true });
    expect(countEditorChanges(base, technical)).toMatchObject({ addedStops: ['st_new'], routeStopChanges: 0, total: 1 });

    const normalized = dataset();
    normalized.routeStops = normalized.routeStops.map((rs) => ({ routeId: rs.routeId, stopId: rs.stopId, orderThere: rs.orderThere, orderBack: rs.orderBack }));
    const baseWithMinusOne = dataset();
    baseWithMinusOne.routeStops[0] = { routeId: '2', stopId: 'st_a', orderThere: 1, orderBack: undefined, mapOnly: false };
    const nextMinusOne = dataset();
    nextMinusOne.routeStops[0] = { routeId: '2', stopId: 'st_a', orderThere: 1, orderBack: -1 };
    expect(countEditorChanges(base, normalized).total).toBe(0);
    expect(countEditorChanges(baseWithMinusOne, nextMinusOne).total).toBe(0);

    const removed = dataset();
    removed.routeStops.pop();
    expect(countEditorChanges(base, removed)).toMatchObject({ routeStopChanges: 1, total: 1 });
  });
});

describe('filterStopIds', () => {
  const ids = ['st_a', 'st_b', 'st_c'];
  it('matches by name or id, case-insensitive; empty query keeps the list', () => {
    expect(filterStopIds(ids, catalog, 'ЛІКАР')).toEqual(['st_c']);
    expect(filterStopIds(ids, catalog, 'st_b')).toEqual(['st_b']);
    expect(filterStopIds(ids, catalog, '  ')).toBe(ids);
    expect(filterStopIds(ids, catalog, 'zzz')).toEqual([]);
    expect(filterStopIds(ids, undefined, 'st_')).toEqual(ids);
  });
});
