import { describe, expect, it } from 'vitest';
import { noteDirOf, placesInNote } from './notePlaces';

const out = (note: string | null, dir: 'from_malyn' | 'to_malyn' | null = 'from_malyn') => placesInNote(note, [], dir);

describe('місця в примітці водія', () => {
  it('київська точка — з описками й тими назвами, якими пишуть водії', () => {
    expect(out('від м. Житомирська').kyiv).toBe('kyiv.zhytomyrska');
    expect(out('(м. Житом.)').kyiv).toBe('kyiv.zhytomyrska');
    expect(out('до Академмістечка').kyiv).toBe('kyiv.akadem');
    expect(out('(Аккадемістечко)').kyiv).toBe('kyiv.akadem');
    expect(out('є місця; Шулявка').kyiv).toBe('kyiv.shuliavka');
    expect(out('(ст.м. Берестейська далі по проспекту)').kyiv).toBe('kyiv.beresteiska');
    expect(out('(ст.м.Героїв Дніпра)').kyiv).toBe('kyiv.heroiv');
    expect(out('Є місця; до Цирку').kyiv).toBe('kyiv.tsyrk');
    expect(out('(Печерськ)').kyiv).toBe('kyiv.m.pecherska');
    expect(out('Оболонь').kyiv).toBe('kyiv.obolon');
  });

  it('«Житомирська» без «м.» — траса, а не метро і не вулиця Малина', () => {
    expect(out('по Житомирській трасі')).toEqual({ malyn: null, kyiv: null, door: false });
    expect(out('вул. Київська, 10', 'to_malyn').malyn).toBeNull();
  });

  it('«вокзал»: малинський лише з прийменником свого кінця дороги або зі словом «Малин»', () => {
    expect(out('заберу з вокзалу, їду до Святошина')).toEqual({ malyn: 'malyn.vokzal', kyiv: 'kyiv.sviatoshyn', door: false });
    expect(out('до вокзалу')).toEqual({ malyn: null, kyiv: 'kyiv.pas', door: false });
    expect(out('до вокзалу', 'to_malyn').malyn).toBe('malyn.vokzal');
    expect(out('від вокзалу', 'to_malyn')).toEqual({ malyn: null, kyiv: 'kyiv.pas', door: false });
    expect(out('вокзал', 'to_malyn')).toEqual({ malyn: null, kyiv: null, door: false });
    expect(out('вокзал Малин', 'to_malyn').malyn).toBe('malyn.vokzal');
  });

  it('напрямок без Малина — малинських місць не шукаємо', () => {
    expect(placesInNote('від автостанції', [], null).malyn).toBeNull();
    expect(noteDirOf('Malyn-Kyiv-Irpin')).toBe('from_malyn');
    expect(noteDirOf('Kyiv-Malyn')).toBe('to_malyn');
    expect(noteDirOf('Kyiv-Zhytomyr')).toBeNull();
    expect(noteDirOf('Kyiv-Korosten-Malyn')).toBeNull();
  });

  it('«заберу по місту» — посадка де домовитесь; порожнє й стороннє — нічого', () => {
    expect(out('Є місця; Заберу по місту')).toEqual({ malyn: null, kyiv: null, door: true });
    expect(out('з Малина до Києва')).toEqual({ malyn: null, kyiv: null, door: false });
    expect(out(null)).toEqual({ malyn: null, kyiv: null, door: false });
    expect(out('візьму посилку, 2 місця')).toEqual({ malyn: null, kyiv: null, door: false });
  });
});
