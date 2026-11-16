import { describe, expect, it } from 'vitest';
import { placesInNote } from './notePlaces';

describe('місця в примітці водія', () => {
  it('київська точка й місце в Малині — тим самим словником, що й питання', () => {
    expect(placesInNote('від м. Житомирська')).toEqual({ malyn: null, kyiv: 'kyiv.zhytomyrska' });
    expect(placesInNote('до Академмістечка')).toEqual({ malyn: null, kyiv: 'kyiv.akadem' });
    expect(placesInNote('Академмістечко')).toEqual({ malyn: null, kyiv: 'kyiv.akadem' });
    expect(placesInNote('заберу з вокзалу, їду до Святошина')).toEqual({ malyn: 'malyn.vokzal', kyiv: 'kyiv.sviatoshyn' });
  });

  it('саме місто, порожня чи стороння примітка — нічого', () => {
    expect(placesInNote('з Малина до Києва')).toEqual({ malyn: null, kyiv: null });
    expect(placesInNote(null)).toEqual({ malyn: null, kyiv: null });
    expect(placesInNote('візьму посилку, 2 місця')).toEqual({ malyn: null, kyiv: null });
  });
});
