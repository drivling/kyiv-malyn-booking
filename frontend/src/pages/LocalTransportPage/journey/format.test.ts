import { describe, expect, it } from 'vitest';
import { formatClock, formatWait, stopsLabel, transfersLabel } from './format';

describe('formatClock / formatWait', () => {
  it('години й хвилини з нулями, доба замикається', () => {
    expect(formatClock(545)).toBe('09:05');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(24 * 60 + 5)).toBe('00:05');
    expect(formatClock(480.6)).toBe('08:01');
  });

  it('тривалість у хв і год', () => {
    expect(formatWait(12)).toBe('12 хв');
    expect(formatWait(60)).toBe('1 год');
    expect(formatWait(65)).toBe('1 год 5 хв');
  });
});

describe('transfersLabel / stopsLabel', () => {
  it('відмінювання «пересадка»', () => {
    expect(transfersLabel(0)).toBe('без пересадок');
    expect(transfersLabel(1)).toBe('1 пересадка');
    expect(transfersLabel(2)).toBe('2 пересадки');
    expect(transfersLabel(5)).toBe('5 пересадок');
    expect(transfersLabel(11)).toBe('11 пересадок');
    expect(transfersLabel(21)).toBe('21 пересадка');
  });

  it('відмінювання «зупинка»', () => {
    expect([1, 2, 4, 5, 11, 12, 21].map(stopsLabel)).toEqual([
      '1 зупинка',
      '2 зупинки',
      '4 зупинки',
      '5 зупинок',
      '11 зупинок',
      '12 зупинок',
      '21 зупинка',
    ]);
  });
});
