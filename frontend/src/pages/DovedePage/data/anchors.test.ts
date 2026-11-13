import { describe, expect, it } from 'vitest';
import { getStopArticle } from '@/content/stops';
import { ANCHORS, anchorFor, isPeak } from './anchors';
import { kyivPointForPlace, metroHint, mapsTransitUrl } from './kyiv';
import { PLACES, placeById } from '../nlu/gazetteer';

describe('якорі й словник указують на справжні зупинки Малина', () => {
  it('кожна зупинка якоря — зупинка датасету, а місце — у словнику', () => {
    for (const a of ANCHORS) {
      for (const s of a.stops) {
        expect(getStopArticle(s.stopId), `${a.corridor}/${a.mode}: ${s.stopId}`).toBeTruthy();
        expect(placeById(s.placeId)?.stopIds, s.placeId).toContain(s.stopId);
      }
    }
  });

  it('усі stopIds словника існують', () => {
    for (const p of PLACES) for (const id of p.stopIds ?? []) expect(getStopArticle(id), `${p.id}: ${id}`).toBeTruthy();
  });

  it('маршрутка з Києва: ПТЛ раніше за центр, тривалість зі слів власника', () => {
    const a = anchorFor('to_malyn', 'marshrutka');
    expect(a.stops.map((s) => s.placeId)).toEqual(['malyn.ptl', 'malyn.tsentr', 'malyn.avtostantsiya']);
    expect(a.stops[0].offsetMin).toBeLessThan(0);
    expect(a.duration).toEqual({ typical: 90, max: 97, peakMax: 100 });
    expect(anchorFor('from_malyn', 'marshrutka').bufferBeforeBoard).toBeGreaterThanOrEqual(10);
  });

  it('пʼятниця ввечері з Києва — пік', () => {
    expect(isPeak('to_malyn', '2026-11-13', 15 * 60)).toBe(true);
    expect(isPeak('to_malyn', '2026-11-13', 9 * 60)).toBe(false);
    expect(isPeak('to_malyn', '2026-11-14', 16 * 60)).toBe(false);
    expect(isPeak('from_malyn', '2026-11-13', 16 * 60)).toBe(false);
  });
});

describe('Київ', () => {
  it('точка посадки за текстом розкладу або маршрутом', () => {
    expect(kyivPointForPlace('м. Академмістечко')).toBe('kyiv.akadem');
    expect(kyivPointForPlace('м. Святошино')).toBe('kyiv.sviatoshyn');
    expect(kyivPointForPlace('Київ-Пас. (Приміський)')).toBe('kyiv.pas');
    expect(kyivPointForPlace('з.п. Борщагівка')).toBe('kyiv.borshch');
    expect(kyivPointForPlace(null, 'Malyn-Kyiv-Irpin')).toBe('kyiv.akadem');
  });

  it('підказка метро й посилання Google Maps', () => {
    expect(metroHint('kyiv.sviatoshyn', 'kyiv.akadem')).toBe('метро М1 «Святошин» → «Академмістечко», 2 станції, ≈ 5 хв');
    expect(metroHint('kyiv.borshch', 'kyiv.akadem')).toBeNull();
    expect(mapsTransitUrl('метро Святошин, Київ', null)).toBe(
      'https://www.google.com/maps/dir/?api=1&travelmode=transit&origin=%D0%BC%D0%B5%D1%82%D1%80%D0%BE+%D0%A1%D0%B2%D1%8F%D1%82%D0%BE%D1%88%D0%B8%D0%BD%2C+%D0%9A%D0%B8%D1%97%D0%B2',
    );
  });
});
