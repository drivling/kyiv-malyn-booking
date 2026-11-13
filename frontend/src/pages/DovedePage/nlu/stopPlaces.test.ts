import { describe, expect, it } from 'vitest';
import { parseLocal } from './parseLocal';
import { buildStopPlaces, stopBaseName } from './stopPlaces';

const NOW = { date: '2026-11-13', mins: 14 * 60 + 20 };

/** Назви з продакшн-датасету Малина (2026-11-13) */
const STOPS = [
  { id: 'st_0071', name: 'Поворот на Коновальця' },
  { id: 'st_0064', name: 'Паперова фабрика Вайдманн' },
  { id: 'st_0101', name: 'Швейна фабрика' },
  { id: 'st_0102', name: 'Швейна фабрика (навпроти)' },
  { id: 'st_0110', name: 'Чорновола 36' },
  { id: 'st_0111', name: 'Чорновола 10' },
  { id: 'st_0120', name: 'Грушевського 48' },
  { id: 'st_0130', name: '14 ОМБ' },
  { id: 'st_0140', name: 'м-н "Сільпо"' },
  { id: 'st_0150', name: 'РЕМ' },
  { id: 'st_0160', name: '№5 т.3' },
];
const INDEX = buildStopPlaces(STOPS);
const parse = (text: string) => parseLocal(text, NOW, INDEX).intent;

describe('«Доведе» — зупинки з розкладу як місця словника', () => {
  it('питання власника: з повороту на Коновальця до паперової фабрики о 17:00', () => {
    const i = parse('Як доїхати з  поворот на коновальця до паперова фабрика о 17:00');
    expect(i.from).toEqual({ id: 'st_0071', text: 'поворот на коновальця' });
    expect(i.to?.id).toBe('malyn.paperova');
    expect(i.when).toEqual({ day: 'today', kind: 'depart', time: '17:00' });
    expect(i.confidence).toBe('high');
  });

  it('відмінки й порядок слів: «до повороту на Коновальця», «від швейної фабрики»', () => {
    expect(parse('з вокзалу до повороту на Коновальця').to?.id).toBe('st_0071');
    expect(parse('від швейної фабрики на вокзал').from?.id).toBe('st_0101');
    expect(parse('в сільпо з центру').to?.id).toBe('st_0140');
  });

  it('зупинки з однаковою назвою (обидва боки дороги) — одне місце; технічні точки й уже відомі зупинки не беремо', () => {
    const sewing = INDEX.find((e) => e.place.id === 'st_0101');
    expect(sewing?.place.stopIds).toEqual(['st_0101', 'st_0102']);
    expect(stopBaseName('Швейна фабрика (навпроти)')).toBe('Швейна фабрика');
    expect(INDEX.some((e) => e.place.id === 'st_0160')).toBe(false);
    expect(INDEX.some((e) => e.place.id === 'st_0064')).toBe(false); // є в кураторському словнику: malyn.paperova
  });

  it('номер будинку розрізняє зупинки однієї вулиці; без номера — перша з них', () => {
    expect(parse('з Чорновола 36 на вокзал').from?.id).toBe('st_0110');
    expect(parse('з Чорновола 10 на вокзал').from?.id).toBe('st_0111');
    expect(parse('з Чорновола на вокзал').from?.id).toBe('st_0110');
    // такої зупинки немає — це вже адреса на вулиці (nlu/streets.ts), а не зупинка
    expect(parse('з Чорновола 99 на вокзал').from?.id).toBe('street.viacheslava-chornovola:99');
  });

  it('вулиця, яку вже знає кураторський словник, без номера лишається за ним', () => {
    expect(parse('з Грушевського на вокзал').from?.id).toBe('malyn.hrushevskoho');
    expect(parse('з Грушевського 48 на вокзал').from?.id).toBe('st_0120');
  });

  it('«до 14 ОМБ» — зупинка, а не «до 14:00»; короткі назви лише цілим словом', () => {
    const i = parse('з центру до 14 ОМБ');
    expect(i.to?.id).toBe('st_0130');
    expect(i.when.time).toBeUndefined();
    expect(parse('з РЕМ на вокзал').from?.id).toBe('st_0150');
    expect(parse('з ремонту на вокзал').from).toBeNull();
  });

  it('зупинка, чия назва — синонім кураторського місця, окремим місцем не стає', () => {
    const index = buildStopPlaces([{ id: 'st_b', name: 'Вокзал' }, { id: 'st_c', name: 'Лікарня (навпроти)' }, { id: 'st_d', name: 'Парк' }]);
    expect(index.map((e) => e.place.id)).toEqual(['st_d']);
    expect(parseLocal('з центру на вокзал', NOW, index).intent.to?.id).toBe('malyn.vokzal');
  });

  it('без зупинок розбір такий самий, як раніше', () => {
    expect(parseLocal('з повороту на Коновальця до вокзалу', NOW).intent.from).toBeNull();
  });

  it('mirror: stopPlaces.ts і normalize.ts однакові на фронтенді й бекенді', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    for (const f of ['stopPlaces.ts', 'normalize.ts']) {
      const here = path.resolve(__dirname, f);
      const mirror = path.resolve(__dirname, '../../../../../backend/src/dovede', f);
      expect(fs.readFileSync(here, 'utf8'), f).toBe(fs.readFileSync(mirror, 'utf8'));
    }
  });
});
