import { describe, expect, it } from 'vitest';
import type { Schedule } from '@/types';
import { ZUBASTYK_PHONES, buildZubastykFaq, priceRange, scheduleRange } from './zubastykContent';

const row = (route: string, departureTime: string, priceUah: number | null = 280): Schedule =>
  ({ id: Math.random(), route, departureTime, maxSeats: 14, supportPhone: null, priceUah, createdAt: '', updatedAt: '' }) as unknown as Schedule;

describe('zubastykContent', () => {
  it('lists the three main booking phones first and the DB reserve number last', () => {
    expect(ZUBASTYK_PHONES.map((p) => p.label)).toEqual(['093 192 00 08', '096 142 00 08', '066 162 00 08', '093 170 18 35']);
    expect(ZUBASTYK_PHONES[3].note).toBe('резервний');
    for (const p of ZUBASTYK_PHONES) expect(p.digits).toMatch(/^380\d{9}$/);
  });

  it('computes first/last/count and price range', () => {
    const rows = [row('Malyn-Kyiv-Irpin', '17:30'), row('Malyn-Kyiv-Bucha', '05:00'), row('Malyn-Kyiv-Irpin', '08:30', null)];
    expect(scheduleRange(rows)).toEqual({ first: '05:00', last: '17:30', count: 3 });
    expect(priceRange(rows)).toEqual({ min: 280, max: 280 });
    expect(scheduleRange([])).toBeNull();
    expect(priceRange([row('Malyn-Kyiv-Irpin', '08:30', null)])).toBeNull();
  });

  it('builds the FAQ people type into Google: phone, first/last trip, price, boarding', () => {
    const faq = buildZubastykFaq([row('Malyn-Kyiv-Bucha', '05:00'), row('Malyn-Kyiv-Irpin', '17:30')], [row('Kyiv-Malyn-Bucha', '08:00')]);
    const qs = faq.map((f) => f.q);
    expect(qs[0]).toMatch(/номер телефону/);
    expect(faq[0].a).toContain('093 192 00 08');
    expect(faq[0].a).toContain('093 170 18 35 (резервний)');
    expect(faq.find((f) => f.q.includes('з Малина до Києва'))?.a).toContain('Перший рейс о 05:00, останній о 17:30; 2 рейсів щодня');
    expect(faq.find((f) => f.q.includes('з Києва до Малина'))?.a).toContain('08:00');
    expect(faq.find((f) => f.q.includes('Скільки коштує'))?.a).toContain('280 грн за місце');
    expect(qs.at(-1)).toBe('Чи це той самий «Зубастик»?');
  });

  it('does not invent a price when none is known', () => {
    const faq = buildZubastykFaq([row('Malyn-Kyiv-Irpin', '08:30', null)], []);
    expect(faq.find((f) => f.q.includes('Скільки коштує'))?.a).toMatch(/дивіться в таблиці/);
  });
});
