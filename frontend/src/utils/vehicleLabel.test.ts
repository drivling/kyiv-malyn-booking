import { describe, expect, it } from 'vitest';
import { vehicleLabel } from './vehicleLabel';

describe('vehicleLabel', () => {
  it('labels buses, suburban trains (4-digit) and regional trains (3-digit)', () => {
    expect(vehicleLabel({ vehicleType: 'marshrutka' })).toBe('Маршрутка');
    expect(vehicleLabel({})).toBe('Маршрутка');
    expect(vehicleLabel({ vehicleType: 'elektrichka', tripNumber: '6621' })).toBe('Електричка №6621');
    expect(vehicleLabel({ vehicleType: 'elektrichka', tripNumber: '859' })).toBe('Потяг №859');
    expect(vehicleLabel({ vehicleType: 'elektrichka', tripNumber: null })).toBe('Електричка');
  });
});
