import { describe, expect, it } from 'vitest';
import { haversineDistance } from './geo';

// Прожектор ↔ Меркурій ~13 м; Далеко — за 2 км.
const prozhektor: [number, number] = [50.77062, 29.25598];
const merkurii: [number, number] = [50.77068, 29.25614];
const daleko: [number, number] = [50.75, 29.22];

describe('haversineDistance', () => {
  it('сусідні стовпчики — десятки метрів, різні райони — кілометри', () => {
    expect(haversineDistance(...prozhektor, ...merkurii)).toBeGreaterThan(5);
    expect(haversineDistance(...prozhektor, ...merkurii)).toBeLessThan(30);
    expect(haversineDistance(...prozhektor, ...daleko)).toBeGreaterThan(1500);
  });

  it('та сама точка — нуль', () => {
    expect(haversineDistance(...prozhektor, ...prozhektor)).toBe(0);
  });
});
