import { describe, expect, it } from 'vitest';
import { CORRIDOR_LANDINGS } from './corridorLandings';
import { PHONE_ONLY_SENTENCE, ZUBASTYK_PHONES_TEXT, isPhoneOnlySchedule } from './phoneOnlyBooking';

describe('phoneOnlyBooking', () => {
  it('«Зубастик» — лише маршрутки Київ ↔ Малин, не електрички й не інші напрямки', () => {
    for (const route of ['Kyiv-Malyn-Irpin', 'Malyn-Kyiv-Irpin', 'Kyiv-Malyn-Bucha', 'Malyn-Kyiv-Bucha']) {
      expect(isPhoneOnlySchedule({ route, vehicleType: 'marshrutka' })).toBe(true);
      expect(isPhoneOnlySchedule({ route })).toBe(true);
    }
    expect(isPhoneOnlySchedule({ route: 'Kyiv-Malyn', vehicleType: 'elektrichka' })).toBe(false);
    for (const route of ['Malyn-Zhytomyr-Potiivka', 'Korosten-Malyn', 'Kyiv-Korosten', 'Kyiv-Malynivka']) {
      expect(isPhoneOnlySchedule({ route, vehicleType: 'marshrutka' })).toBe(false);
    }
  });

  it('речення для FAQ каже «поки не працює», «лише за телефоном» і несе всі номери', () => {
    expect(ZUBASTYK_PHONES_TEXT).toBe('093 192 00 08, 096 142 00 08, 066 162 00 08, 093 170 18 35 (резервний)');
    expect(PHONE_ONLY_SENTENCE).toMatch(/поки не працює/);
    expect(PHONE_ONLY_SENTENCE).toMatch(/лише за телефоном/);
    expect(PHONE_ONLY_SENTENCE).toContain(ZUBASTYK_PHONES_TEXT);
  });

  it('коридори Київ ↔ Малин позначено, FAQ більше не обіцяє онлайн-бронювання', () => {
    const flagged = CORRIDOR_LANDINGS.filter((c) => c.phoneOnlyBooking).map((c) => c.slug);
    expect(flagged).toEqual(['kyiv-malyn', 'malyn-kyiv']);
    const online = CORRIDOR_LANDINGS.find((c) => c.slug === 'kyiv-malyn')?.faq.find((f) => /онлайн/.test(f.q));
    expect(online?.a).toMatch(/^Поки ні/);
    expect(online?.a).toContain('093 192 00 08');
    for (const c of CORRIDOR_LANDINGS.filter((l) => l.phoneOnlyBooking)) {
      const copy = [c.lead, ...c.ways.map((w) => w.text), ...c.faq.map((f) => f.a)].join(' ');
      expect(copy).not.toMatch(/забронюйте місце онлайн|рейси з бронюванням|рейси для бронювання/);
    }
  });
});
