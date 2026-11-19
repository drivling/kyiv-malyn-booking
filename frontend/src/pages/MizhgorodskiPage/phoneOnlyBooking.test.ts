import { describe, expect, it } from 'vitest';
import { CORRIDOR_LANDINGS } from './corridorLandings';
import { isPhoneOnlySchedule } from './phoneOnlyBooking';

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

  it('реклама й SEO обіцяють онлайн-бронювання як до попереджень: жодної примітки про «Зубастик»', () => {
    const copy = CORRIDOR_LANDINGS.flatMap((c) => [c.lead, c.description, ...c.ways.map((w) => w.text), ...c.faq.map((f) => f.a)]);
    for (const text of copy) expect(text).not.toMatch(/не працює|лише за телефоном|тимчасово/);
    const km = CORRIDOR_LANDINGS.find((c) => c.slug === 'kyiv-malyn');
    const mk = CORRIDOR_LANDINGS.find((c) => c.slug === 'malyn-kyiv');
    expect(km?.lead).toContain('рейси для бронювання');
    expect(mk?.lead).toContain('рейси з можливістю бронювання');
    const online = km?.faq.find((f) => /онлайн/.test(f.q))?.a;
    expect(online).toBe('Так: у результатах оберіть картку «Маршрутка», вкажіть контакти й підтвердіть у Telegram-боті @malin_kiev_ua_bot.');
    expect(mk?.ways.find((w) => w.title === 'Маршрутка')?.text).toBe('Оберіть рейс у пошуку й забронюйте місце. Підтвердження зручно отримувати в боті.');
  });
});
