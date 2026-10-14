import { describe, expect, it } from 'vitest';
import { ID_DM_DAILY_CAP_DEFAULT, createIdDmGuard, idDmDailyCap, idDmEnabled } from './telegram-user-dm-guard';

describe('idDmEnabled / idDmDailyCap', () => {
  it('за замовчуванням увімкнено, "0" вимикає; ліміт з env або 20', () => {
    expect(idDmEnabled({})).toBe(true);
    expect(idDmEnabled({ TELEGRAM_USER_DM_BY_ID: '0' })).toBe(false);
    expect(idDmDailyCap({})).toBe(ID_DM_DAILY_CAP_DEFAULT);
    expect(idDmDailyCap({ TELEGRAM_USER_DM_BY_ID_DAILY_CAP: '5' })).toBe(5);
    expect(idDmDailyCap({ TELEGRAM_USER_DM_BY_ID_DAILY_CAP: '0' })).toBe(0);
    expect(idDmDailyCap({ TELEGRAM_USER_DM_BY_ID_DAILY_CAP: 'abc' })).toBe(ID_DM_DAILY_CAP_DEFAULT);
  });
});

describe('createIdDmGuard', () => {
  const at = (iso: string) => () => new Date(iso);

  it('пускає до ліміту, далі відмовляє; нова доба за Києвом скидає лічильник', () => {
    let now = '2026-10-12T10:00:00Z';
    const g = createIdDmGuard({ cap: () => 2, now: () => new Date(now) });
    expect([g.tryAcquire(), g.tryAcquire(), g.tryAcquire()]).toEqual([true, true, false]);
    expect(g.used()).toBe(2);
    now = '2026-10-12T20:59:00Z'; // 23:59 Київ — ще та сама доба
    expect(g.tryAcquire()).toBe(false);
    now = '2026-10-12T21:01:00Z'; // 00:01 наступної доби за Києвом
    expect(g.tryAcquire()).toBe(true);
    expect(g.used()).toBe(1);
  });

  it('вимкнений вимикач нічого не пускає й не рахує', () => {
    const g = createIdDmGuard({ enabled: () => false, now: at('2026-10-12T10:00:00Z') });
    expect(g.tryAcquire()).toBe(false);
    expect(g.used()).toBe(0);
  });

  it('PEER_FLOOD (trip) блокує до кінця доби, не довше', () => {
    let now = '2026-10-12T10:00:00Z';
    const g = createIdDmGuard({ cap: () => 100, now: () => new Date(now) });
    expect(g.tryAcquire()).toBe(true);
    g.trip();
    expect(g.tryAcquire()).toBe(false);
    now = '2026-10-13T10:00:00Z';
    expect(g.tryAcquire()).toBe(true);
  });
});
