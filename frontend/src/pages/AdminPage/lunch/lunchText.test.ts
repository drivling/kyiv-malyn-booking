import { describe, expect, it } from 'vitest';
import type { LunchOrderRow } from '@/types';
import { computeTrayCount, dayStatus, filterOrders, isLunchSection, lunchSections, orderFilterCounts, splitUnmatched } from './lunchText';

const o = (over: Partial<LunchOrderRow>): LunchOrderRow =>
  ({ id: 1, participantId: 1, displayName: 'X', username: null, rawText: '', unmatchedText: null, totalUah: 0, trayCount: 0, trayTotalUah: 0, paidUah: 0, debtUah: 0, lines: [], ...over }) as LunchOrderRow;

describe('lunchText', () => {
  it('лотки: суп — на порцію, друге — один, салат — без лотка, крім єдиної страви', () => {
    expect(computeTrayCount([{ trayRole: 'soup', qty: 2 }, { trayRole: 'second' }, { trayRole: 'second' }])).toBe(3);
    expect(computeTrayCount([{ trayRole: 'salad' }])).toBe(1);
    expect(computeTrayCount([{ trayRole: 'salad' }, { trayRole: 'second' }])).toBe(1);
    expect(computeTrayCount([])).toBe(0);
  });

  it('фільтри замовлень: перевірити (не розпізнано / немає в меню) і винні', () => {
    const list = [
      o({ id: 1, debtUah: 40 }),
      o({ id: 2, unmatchedText: 'компот' }),
      o({ id: 3, lines: [{ menuItemId: null, dishId: 5, menuItemName: 'Борщ', rawName: 'борщ', qty: 1, unitPriceUah: 50, lineTotalUah: 50, unavailable: true }] }),
    ];
    expect(orderFilterCounts(list)).toEqual({ all: 3, problems: 2, debt: 1 });
    expect(filterOrders(list, 'problems').map((x) => x.id)).toEqual([2, 3]);
    expect(filterOrders(list, 'debt').map((x) => x.id)).toEqual([1]);
  });

  it('стан дня, розділи й нерозпізнані фрагменти', () => {
    expect(dayStatus('ordering').tone).toBe('ok');
    expect(dayStatus(undefined).label).toBe('дня ще немає');
    expect(isLunchSection('dishes')).toBe(true);
    expect(isLunchSection('x')).toBe(false);
    expect(lunchSections({ menu: 0, conflicts: 2 }).map((s) => s.label)).toEqual(['Сьогодні', 'Меню', 'Страви · конфліктів 2', 'Моделі']);
    expect(splitUnmatched('компот; хліб\n чай ')).toEqual(['компот', 'хліб', 'чай']);
  });
});
