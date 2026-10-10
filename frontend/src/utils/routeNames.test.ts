import { afterEach, describe, expect, it } from 'vitest';
import { configureRouteNames, routeNo, routeNoWithId } from './routeNames';

afterEach(() => configureRouteNames([]));

describe('routeNames: display number of a city route', () => {
  it('shows shortName for its id and the id itself otherwise', () => {
    configureRouteNames([
      { id: '11', shortName: '11/1' },
      { id: '5', shortName: ' 5А ' },
      { id: '3', shortName: '' },
      { id: '2' },
    ]);
    expect(routeNo('11')).toBe('11/1');
    expect(routeNo('5')).toBe('5А');
    expect(routeNo('3')).toBe('3');
    expect(routeNo('2')).toBe('2');
    expect(routeNo('99')).toBe('99');
    expect(routeNo(undefined)).toBe('');
  });

  it('a new dataset replaces the old numbers (a cleared shortName goes back to the id)', () => {
    configureRouteNames([{ id: '11', shortName: '11/1' }]);
    configureRouteNames([{ id: '11', shortName: '' }]);
    expect(routeNo('11')).toBe('11');
    configureRouteNames(undefined);
    expect(routeNo('11')).toBe('11');
  });

  it('admin label adds the id only when it differs', () => {
    configureRouteNames([{ id: '11', shortName: '11/1' }, { id: '7', shortName: '7' }]);
    expect(routeNoWithId('11')).toBe('11/1 (id 11)');
    expect(routeNoWithId('7')).toBe('7');
  });
});
