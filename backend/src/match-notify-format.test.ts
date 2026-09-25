import { describe, expect, it } from 'vitest';
import { formatCounterpartLine, groupListingsByMatchType } from './match-notify-format';

describe('formatCounterpartLine', () => {
  it('пасажир: ім\'я — час, телефон, нотатки лише коли є', () => {
    expect(
      formatCounterpartLine('passenger', {
        name: 'Оля',
        phoneHtml: '<a href="tel:+380501112233">+380(50)1112233</a>',
        departureTime: '18:00',
        notes: 'з валізою',
      }),
    ).toBe('• 👤 Оля — 18:00\n  📞 <a href="tel:+380501112233">+380(50)1112233</a>\n  📝 з валізою');

    expect(
      formatCounterpartLine('passenger', {
        name: 'Оля',
        phoneHtml: '—',
        departureTime: null,
        notes: null,
      }),
    ).toBe('• 👤 Оля — —\n  📞 —');
  });

  it('водій: ім\'я — час, місця, телефон, нотатки лише коли є', () => {
    expect(
      formatCounterpartLine('driver', {
        name: 'Іван',
        phoneHtml: 'TEL',
        departureTime: '09:00',
        notes: null,
        seatsLabel: '3 місць',
      }),
    ).toBe('• 🚗 Іван — 09:00, 3 місць\n  📞 TEL');

    expect(
      formatCounterpartLine('driver', { name: 'Іван', phoneHtml: 'TEL', departureTime: null, notes: 'ноут' }),
    ).toBe('• 🚗 Іван — —, —\n  📞 TEL\n  📝 ноут');
  });
});

describe('groupListingsByMatchType', () => {
  it('розкладає по типу за один прохід, зберігаючи порядок усередині групи', () => {
    const matches = [
      { matchType: 'approximate' as const, listing: 'a' },
      { matchType: 'exact' as const, listing: 'b' },
      { matchType: 'exact' as const, listing: 'c' },
      { matchType: 'same_day' as const, listing: 'd' },
    ];
    expect(groupListingsByMatchType(matches)).toEqual({
      exact: ['b', 'c'],
      approximate: ['a'],
      same_day: ['d'],
    });
  });

  it('порожній вхід → порожні групи', () => {
    expect(groupListingsByMatchType([])).toEqual({ exact: [], approximate: [], same_day: [] });
  });
});
