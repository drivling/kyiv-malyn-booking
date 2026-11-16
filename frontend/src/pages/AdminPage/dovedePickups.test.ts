import { describe, expect, it } from 'vitest';
import { percent, tallyPickups } from './dovedePickups';

describe('«Звідки забирають попутки»', () => {
  const data = {
    days: 90,
    total: 12,
    routes: [
      { route: 'Malyn-Kyiv', total: 10, withNote: 7 },
      { route: 'Kyiv-Malyn', total: 2, withNote: 1 },
    ],
    notes: [
      { route: 'Malyn-Kyiv', note: 'до Академмістечка', count: 3 },
      { route: 'Malyn-Kyiv', note: 'Академмістечко', count: 1 },
      { route: 'Malyn-Kyiv', note: 'заберу з вокзалу, до Святошина', count: 2 },
      { route: 'Malyn-Kyiv', note: 'візьму посилку', count: 1 },
      { route: 'Kyiv-Malyn', note: 'від м. Житомирська', count: 1 },
    ],
  };

  it('рахує місця за напрямком: Малин, Київ і примітки без місця', () => {
    const [toKyiv, toMalyn] = tallyPickups(data, []);
    expect(toKyiv).toMatchObject({ route: 'Malyn-Kyiv', total: 10, withNote: 7, malynNamed: 2, kyivNamed: 6 });
    expect(toKyiv.kyiv).toEqual([
      { label: 'метро «Академмістечко»', count: 4 },
      { label: 'метро «Святошин»', count: 2 },
    ]);
    expect(toKyiv.malyn).toHaveLength(1);
    expect(toKyiv.malyn[0].count).toBe(2);
    expect(toKyiv.unrecognised).toEqual([{ note: 'візьму посилку', count: 1 }]);
    expect(toMalyn.kyiv).toEqual([{ label: 'метро «Житомирська»', count: 1 }]);
  });

  it('частка', () => {
    expect(percent(2, 10)).toBe('20 %');
    expect(percent(0, 0)).toBe('—');
  });
});
