/**
 * Міста міського транспорту (Docs/zhytomyr-transport-2026-11.md): місто з транспортом є в перемикачі адмінки й
 * у ?city=, навіть коли його домен ще не підключено (Житомир); домен для посилань лишається головним.
 */
import { describe, expect, it } from 'vitest';
import { canonicalTransportCity, transportCityOptions, transportProfile } from './transportCity';

describe('transportCity', () => {
  it('Житомир — у перемикачі міст адмінки після Малина й Коростеня', () => {
    expect(transportCityOptions().map((o) => o.cityCode)).toEqual(['Malyn', 'Korosten', 'Zhytomyr']);
  });

  it('?city= приймає місто з транспортом без урахування регістру', () => {
    expect(canonicalTransportCity('zhytomyr')).toBe('Zhytomyr');
    expect(canonicalTransportCity('Kyiv')).toBeNull();
  });

  it('профіль Житомира: центр карти, джерела, домен — поки головний', () => {
    const p = transportProfile('Zhytomyr');
    expect(p.center).toEqual([50.2547, 28.6587]);
    expect(p.nameGenitive).toBe('Житомира');
    expect(p.domain).toBe('malin.kiev.ua');
    expect(p.sourceLinks.map((s) => s.label)).toContain('Розклад автобусів: zt.rozklad.in.ua');
  });
});
