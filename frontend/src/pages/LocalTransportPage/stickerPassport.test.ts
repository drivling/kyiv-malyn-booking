import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PASSPORT_STOPS, PASSPORT_KEY, noteStickerScan, readStickerPassport, rememberPassengerNumber } from './stickerPassport';

afterEach(() => localStorage.clear());

describe('паспорт пасажира (мітка на телефоні)', () => {
  it('перший скан — перша зупинка; нова зупинка дописується, повтор — лише лічильник і час', () => {
    expect(readStickerPassport()).toBeNull();
    noteStickerScan({ stopId: 'st_0015', side: 'a' }, 1000);
    noteStickerScan({ stopId: 'st_0019', side: 'b' }, 2000);
    const p = noteStickerScan({ stopId: 'st_0015', side: 's' }, 3000);
    expect(p.first).toEqual({ stopId: 'st_0015', side: 'a', at: 1000 });
    expect(p.stops).toEqual([
      { stopId: 'st_0015', side: 's', first: 1000, last: 3000, scans: 2 },
      { stopId: 'st_0019', side: 'b', first: 2000, last: 2000, scans: 1 },
    ]);
    expect(p.scans).toBe(3);
    expect(p.lastAt).toBe(3000);
    expect(readStickerPassport()).toEqual(p);
  });

  it('хто сканував до паспорта — засів із першої наклейки (sticker-origin), далі історія триває', () => {
    localStorage.setItem('sticker-origin', JSON.stringify({ stopId: 'st_0070', side: 's', firstAt: 500, lastSeenAt: 900 }));
    expect(readStickerPassport()?.first).toEqual({ stopId: 'st_0070', side: 's', at: 500 });
    const p = noteStickerScan({ stopId: 'st_0015', side: 'a' }, 4000);
    expect(p.stops.map((s) => s.stopId)).toEqual(['st_0070', 'st_0015']);
    expect(p.scans).toBe(2);
  });

  it('номер пасажира — з відповіді сервера; без паспорта чи без номера — нічого', () => {
    rememberPassengerNumber({ number: 7 });
    expect(localStorage.getItem(PASSPORT_KEY)).toBeNull();
    noteStickerScan({ stopId: 'st_0015', side: 'a' }, 1000);
    rememberPassengerNumber(undefined);
    expect(readStickerPassport()?.number).toBeNull();
    rememberPassengerNumber({ number: 37 });
    expect(readStickerPassport()?.number).toBe(37);
    // наступний скан номер не губить
    expect(noteStickerScan({ stopId: 'st_0019', side: 'b' }, 2000).number).toBe(37);
  });

  it('зупинок не більше межі: перша лишається, найстаріші після неї випадають', () => {
    for (let i = 0; i <= MAX_PASSPORT_STOPS; i += 1) noteStickerScan({ stopId: `st_${i}`, side: 'a' }, i);
    const p = readStickerPassport()!;
    expect(p.stops).toHaveLength(MAX_PASSPORT_STOPS);
    expect(p.stops[0].stopId).toBe('st_0');
    expect(p.stops[1].stopId).toBe('st_2');
    expect(p.stops[p.stops.length - 1].stopId).toBe(`st_${MAX_PASSPORT_STOPS}`);
  });

  it('зіпсований запис — як без паспорта', () => {
    localStorage.setItem(PASSPORT_KEY, '{"v":2}');
    expect(readStickerPassport()).toBeNull();
    localStorage.setItem(PASSPORT_KEY, 'not json');
    expect(readStickerPassport()).toBeNull();
  });
});
