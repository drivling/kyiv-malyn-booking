import { describe, expect, it } from 'vitest';
import { isLucky, luckyTicketNumber, punchCells } from './ticket';

/** Детермінований генератор для тестів (LCG) */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('талон після ролика «Доведе»', () => {
  it('номер завжди «щасливий»: шість цифр, сума перших трьох = сумі останніх', () => {
    const random = seeded(7);
    for (let i = 0; i < 1000; i++) {
      const no = luckyTicketNumber(random);
      expect(no, no).toMatch(/^\d{3} \d{3}$/);
      expect(isLucky(no), no).toBe(true);
    }
  });

  it('крайні суми теж можливі: 000 000 і 999 999', () => {
    expect(luckyTicketNumber(() => 0)).toBe('000 000');
    expect(luckyTicketNumber(() => 0.9999)).toBe('999 999');
  });

  it('isLucky відрізняє щасливий номер від звичайного', () => {
    expect(isLucky('042 357')).toBe(false);
    expect(isLucky('042 015')).toBe(true);
    expect(isLucky('12345')).toBe(false);
  });

  it('компостер пробиває три різні клітинки з девʼяти', () => {
    const random = seeded(11);
    for (let i = 0; i < 1000; i++) {
      const cells = punchCells(random);
      expect(cells).toHaveLength(3);
      expect(new Set(cells).size).toBe(3);
      for (const c of cells) expect(c >= 0 && c <= 8, String(c)).toBe(true);
    }
  });
});
