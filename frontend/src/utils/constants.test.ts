import { describe, expect, it } from 'vitest';
import { getDirectionLabel, getRouteLabel } from './constants';

describe('getDirectionLabel (generic slug → Ukrainian, rule D8)', () => {
  it('labels any known Start-End[-Via…] slug with the accusative after «через»', () => {
    expect(getDirectionLabel('Malyn-Zhytomyr-Potiivka')).toBe('Малин → Житомир (через Потіївку)');
    expect(getDirectionLabel('Malyn-Berdychiv-Radomyshl-Zhytomyr')).toBe('Малин → Бердичів (через Радомишль, Житомир)');
    expect(getDirectionLabel('Malyn-Vinnytsia-Zhytomyr')).toBe('Малин → Вінниця (через Житомир)');
    expect(getDirectionLabel('Zhytomyr-Malyn')).toBe('Житомир → Малин');
    expect(getRouteLabel('Kyiv-Malyn-Bucha')).toBe('Київ → Малин (через Бучу)');
  });

  it('returns the slug untouched when a code is unknown (caller should prefer tripRoute.labelUk)', () => {
    expect(getDirectionLabel('Malyn-Nowhere')).toBe('Malyn-Nowhere');
    expect(getDirectionLabel('')).toBe('');
  });
});
