import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without types
import { buildKorostenStopArticles, KOROSTEN_ARTICLE_SOURCES, korostenArticlesFileText, normalizeStreet, stopIdOfCouncilUid } from '../../../scripts/city-stop-articles.mjs';

describe('статті зупинок Коростеня (scripts/city-stop-articles.mjs)', () => {
  it('закомічений файл = генератор (після зміни джерел: node scripts/city-stop-articles.mjs)', () => {
    expect(fs.readFileSync(KOROSTEN_ARTICLE_SOURCES.out, 'utf8')).toBe(korostenArticlesFileText());
  });

  it('вулиця ради — без зайвих пробілів і з малої «вул.»; порожнє — нема статті', () => {
    expect(normalizeStreet('вул.Бандери Степана')).toBe('вул. Бандери Степана');
    expect(normalizeStreet('Вул. Князя Володимира')).toBe('вул. Князя Володимира');
    expect(normalizeStreet('вул. Сосновського  ')).toBe('вул. Сосновського');
    expect(normalizeStreet('NA')).toBeNull();
    expect(stopIdOfCouncilUid('z-001')).toBe('st_1001');
    expect(stopIdOfCouncilUid('z-101')).toBe('st_1101');
    expect(stopIdOfCouncilUid('x')).toBeNull();
  });

  it('лише факти: вулиця й назва; на вимогу — підказка; зупинка-вулиця й зупинка без адреси — без статті', () => {
    const csv = 'uid;label;addressThoroughfare\nz-001;Вокзал;вул. Героїв небесної сотні\nz-004;Ощадбанк;вул. Грушевського\nz-044;Вул. Київська;вул. Київська\nz-050;Кладовище;NA\n';
    const dataset = {
      stops: [
        { id: 'st_1004', name: 'Ощадбанк (на вимогу)' },
        { id: 'st_1001', name: 'Залізничний вокзал' },
        { id: 'st_1044', name: 'Вул. Київська' },
        { id: 'st_1050', name: 'Кладовище' },
        { id: 'st_1101', name: 'Грозине' },
      ],
    };
    const out = buildKorostenStopArticles(csv, dataset);
    expect(out.map((a: { id: string }) => a.id)).toEqual(['st_1001', 'st_1004']);
    expect(out[0]).toEqual({ id: 'st_1001', name: 'Залізничний вокзал', place: 'вул. Героїв небесної сотні', tips: ['Адреса — з переліку зупинок Коростенської міської ради.'] });
    expect(out[1].tips[0]).toMatch(/^Зупинка на вимогу/);
    for (const a of out) expect(Object.keys(a).sort()).toEqual(['id', 'name', 'place', 'tips']);
  });
});
