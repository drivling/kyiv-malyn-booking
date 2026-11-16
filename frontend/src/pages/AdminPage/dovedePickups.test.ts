import { describe, expect, it } from 'vitest';
import { meaningfulNote, percent, tallyPickups } from './dovedePickups';

describe('«Звідки забирають попутки»', () => {
  // примітки з архіву власника (2026-11-16)
  const data = {
    days: 90,
    total: 22,
    routes: [
      { route: 'Malyn-Kyiv', total: 12, withNote: 9 },
      { route: 'Kyiv-Malyn', total: 6, withNote: 5 },
      { route: 'Kyiv-Zhytomyr', total: 4, withNote: 3 },
    ],
    notes: [
      { route: 'Malyn-Kyiv', note: 'до Академмістечка', count: 3 },
      { route: 'Malyn-Kyiv', note: '(Аккадемістечко)', count: 1 },
      { route: 'Malyn-Kyiv', note: 'Є місця; до Цирку', count: 1 },
      { route: 'Malyn-Kyiv', note: 'заберу з вокзалу, до Святошина', count: 1 },
      { route: 'Malyn-Kyiv', note: 'Є місця; Заберу по місту', count: 2 },
      { route: 'Malyn-Kyiv', note: 'Є місця', count: 1 },
      { route: 'Kyiv-Malyn', note: 'вокзал', count: 2 },
      { route: 'Kyiv-Malyn', note: 'є місця; Шулявка', count: 1 },
      { route: 'Kyiv-Malyn', note: '(кільцева)', count: 1 },
      { route: 'Kyiv-Malyn', note: '(вівторок); (кільцева)', count: 1 },
      { route: 'Kyiv-Zhytomyr', note: 'від автостанції', count: 2 },
      { route: 'Kyiv-Zhytomyr', note: 'м. Житомирська', count: 1 },
    ],
  };

  it('рахує за напрямком; шум не потрапляє в «невпізнане»; «заберу по місту» — окремо', () => {
    const [toKyiv, toMalyn, other] = tallyPickups(data, []);
    expect(toKyiv).toMatchObject({ route: 'Malyn-Kyiv', hasMalyn: true, hasKyiv: true, malynNamed: 1, kyivNamed: 6, door: 2 });
    expect(toKyiv.kyiv).toEqual([
      { label: 'метро «Академмістечко»', count: 4 },
      { label: 'метро «Святошин»', count: 1 },
      { label: 'цирк', count: 1 },
    ]);
    expect(toKyiv.unrecognised).toEqual([]);

    // голе «вокзал» у Київ → Малин — не малинський вокзал; дві примітки про кільцеву зливаються в одну
    expect(toMalyn.malyn).toEqual([]);
    expect(toMalyn.kyiv).toEqual([{ label: 'метро «Шулявська»', count: 1 }]);
    expect(toMalyn.unrecognised).toEqual([
      { note: 'вокзал', count: 2 },
      { note: 'кільцева', count: 2 },
    ]);

    // напрямок без Малина: житомирська «автостанція» — не малинська
    expect(other).toMatchObject({ hasMalyn: false, hasKyiv: true, malynNamed: 0, kyivNamed: 1 });
    expect(other.unrecognised).toEqual([{ note: 'від автостанції', count: 2 }]);
  });

  it('шум і частка', () => {
    expect(meaningfulNote('Є місця; (Вівторок)')).toBe('');
    expect(meaningfulNote('(дзвоніть або пишіть)')).toBe('');
    expect(meaningfulNote('Двоє позаду; біля Новуса')).toBe('біля Новуса');
    expect(percent(2, 10)).toBe('20 %');
    expect(percent(0, 0)).toBe('—');
  });
});
