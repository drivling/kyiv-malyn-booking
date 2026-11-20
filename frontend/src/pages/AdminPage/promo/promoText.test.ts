import { describe, expect, it } from 'vitest';
import { firstOf, isPromoSection, promoSections } from './promoText';

describe('promoText', () => {
  it('розділи й лічильники в назвах', () => {
    expect(isPromoSection('reminders')).toBe(true);
    expect(isPromoSection('nope')).toBe(false);
    expect(promoSections({ channel: 12, bot: null }).map((s) => s.label)).toEqual(['Реклама каналу 12', 'Нагадування в боті', 'Постійні клієнти']);
  });

  it('перші N і скільки лишилось', () => {
    expect(firstOf([1, 2, 3], 2)).toEqual({ shown: [1, 2], more: 1 });
    expect(firstOf([1], 5)).toEqual({ shown: [1], more: 0 });
  });
});
