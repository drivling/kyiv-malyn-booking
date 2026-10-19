import { describe, expect, it } from 'vitest';
import { endpointFromKey, endpointGaValue, isPointKey, parsePointKey, pointKey, pointLabel } from './endpointKey';

describe('pointKey / parsePointKey', () => {
  it('округлює до 5 знаків і читається назад', () => {
    const key = pointKey('pt', 50.772834567, 29.2580661);
    expect(key).toBe('pt:50.77283,29.25807');
    expect(parsePointKey(key)).toEqual({ kind: 'pt', lat: 50.77283, lng: 29.25807 });
    expect(parsePointKey(pointKey('me', -33.5, 151.2))).toEqual({ kind: 'me', lat: -33.5, lng: 151.2 });
  });

  it('id зупинок і сміття — не точки', () => {
    for (const bad of ['st_0019', '', 'pt:', 'pt:50.7', 'pt:abc,def', 'xx:50.1,29.1', 'pt:91,10', 'pt:10,181', ' ', 'pt:50.1,29.1,5']) {
      expect(parsePointKey(bad)).toBeNull();
      expect(isPointKey(bad)).toBe(false);
    }
    expect(parsePointKey(null)).toBeNull();
    expect(parsePointKey(undefined)).toBeNull();
  });
});

describe('endpointFromKey / pointLabel / endpointGaValue', () => {
  it('зупинка лишається зупинкою, точка стає координатами', () => {
    expect(endpointFromKey('st_a')).toEqual({ kind: 'stop', stopId: 'st_a' });
    expect(endpointFromKey('pt:50.77283,29.25807')).toEqual({ kind: 'point', lat: 50.77283, lng: 29.25807 });
  });

  it('підписи для людей', () => {
    expect(pointLabel('me:50.1,29.1')).toBe('Моє місцезнаходження');
    expect(pointLabel('pt:50.1,29.1')).toBe('Точка на карті');
    expect(pointLabel('st_a')).toBeNull();
  });

  it('в аналітику йде категорія, не координати', () => {
    expect(endpointGaValue('st_a')).toBe('st_a');
    expect(endpointGaValue('me:50.77283,29.25807')).toBe('geo');
    expect(endpointGaValue('pt:50.77283,29.25807')).toBe('point');
  });
});
