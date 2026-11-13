import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KYIV_MALYN_FARE_PREVIOUS_UAH,
  KYIV_MALYN_FARE_ROUND_TRIP_UAH,
  KYIV_MALYN_FARE_SINCE,
  KYIV_MALYN_FARE_UAH,
} from './fares';
import { PRICES_FAQ, TRAVEL_FAQ } from '@/pages/SupportPage/supportContent';

describe('fares: маршрутка Малин ↔ Київ', () => {
  it('310 грн з 4 листопада 2026, було 280, туди й назад 620', () => {
    expect(KYIV_MALYN_FARE_UAH).toBe(310);
    expect(KYIV_MALYN_FARE_PREVIOUS_UAH).toBe(280);
    expect(KYIV_MALYN_FARE_ROUND_TRIP_UAH).toBe(620);
    expect(KYIV_MALYN_FARE_SINCE).toBe('4 листопада 2026');
  });

  it('mirror: backend/src/schedule-price.ts has the same default fare', () => {
    const backend = path.resolve(__dirname, '../../../backend/src/schedule-price.ts');
    const src = fs.readFileSync(backend, 'utf8');
    expect(src).toContain(`KYIV_MALYN_MARSHRUTKA_FARE_UAH = ${KYIV_MALYN_FARE_UAH};`);
  });

  it('FAQ answers state the current fare and never the old one as the price', () => {
    const priceQs = [...TRAVEL_FAQ, ...PRICES_FAQ].filter((f) => /Скільки коштує маршрутка/.test(f.q));
    expect(priceQs.length).toBeGreaterThanOrEqual(3);
    for (const f of priceQs) {
      expect(f.a).toContain(`${KYIV_MALYN_FARE_UAH} грн`);
      expect(f.a).not.toMatch(/— 280 грн|Так само 280/);
    }
  });
});
