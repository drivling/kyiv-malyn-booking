import { describe, it, expect } from 'vitest';
import { angleDiff, brightestLineColor, prettyStopName, sideHeading, splitSides, stickerLines } from './stickerModel';
import { STICKER_DATASET } from './stickerTestDataset';

describe('stickerLines', () => {
  const lines = stickerLines(STICKER_DATASET, 'st_0015');

  it('лінії з зупинки в обидва боки, у порядку легенди схеми; без ненадійних, карти й скороченого рейсу', () => {
    expect(lines.map((l) => l.key)).toEqual(['5:there', '5:back', '11:there', '11:back']);
  });

  it('кінцева — назва вузла схеми, проміжні вузли — без зупинки наклейки й кінцевої', () => {
    const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(byKey['5:there'].destination).toBe('Залізничний вокзал');
    expect(byKey['5:there'].via.map((v) => v.name)).toEqual(['Малинівський круг']);
    expect(byKey['5:back'].destination).toBe('Шевченка, 119');
    expect(byKey['5:back'].via.map((v) => v.name)).toEqual(['Центр · Базарна площа', 'Лікарня · Поліклініка']);
    expect(byKey['11:back'].destination).toBe('Паперова фабрика');
    expect(byKey['5:there'].color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('напрямок руху: туди — на схід (≈0°), назад — на захід (≈180°)', () => {
    const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(angleDiff(byKey['5:there'].bearing, 0)).toBeLessThan(10);
    expect(angleDiff(byKey['5:back'].bearing, 180)).toBeLessThan(10);
  });

  it('кінцева напрямку не дає відправлень, виключена (-1) зупинка — жодних ліній', () => {
    expect(stickerLines(STICKER_DATASET, 'st_0019').map((l) => l.key)).toEqual(['5:back', '11:back']);
    expect(stickerLines(STICKER_DATASET, 'st_0046')).toEqual([]);
    expect(stickerLines(STICKER_DATASET, 'st_missing')).toEqual([]);
  });

  it('скорочений рейс відправляється до своєї кінцевої, але не з неї', () => {
    expect(stickerLines(STICKER_DATASET, 'st_0070').map((l) => l.key)).toContain('3:there');
    expect(stickerLines(STICKER_DATASET, 'st_0015').map((l) => l.key)).not.toContain('3:there');
  });
});

describe('splitSides / sideHeading', () => {
  const lines = stickerLines(STICKER_DATASET, 'st_0015');
  const pick = (keys: string[]) => lines.filter((l) => keys.includes(l.key));

  it('ділить лінії на два боки дороги за напрямком руху', () => {
    expect(splitSides(lines)).toEqual({ a: ['5:there', '11:there'], b: ['5:back', '11:back'] });
  });

  it('односторонній вузол — усе на боці 1', () => {
    const atStation = stickerLines(STICKER_DATASET, 'st_0019');
    expect(splitSides(atStation)).toEqual({ a: ['5:back', '11:back'], b: [] });
    expect(splitSides([])).toEqual({ a: [], b: [] });
  });

  it('підпис боку — спільний перший вузол; розбіжні лінії — без підпису', () => {
    const sides = splitSides(lines);
    expect(sideHeading(pick(sides.a))).toBe('Малинівський круг');
    expect(sideHeading(pick(sides.b))).toBe('Центр · Базарна площа');
    expect(sideHeading(pick(['5:there', '5:back']))).toBe('');
    expect(sideHeading([])).toBe('');
  });
});

describe('brightestLineColor', () => {
  it('найнасиченіший колір серед ліній: синя №5 яскравіша за бірюзову №11', () => {
    expect(brightestLineColor(stickerLines(STICKER_DATASET, 'st_0015'))).toBe('#1F6FD6');
    expect(brightestLineColor([{ color: '#0E9AA7' }, { color: '#F08A1C' }, { color: null }])).toBe('#F08A1C');
  });

  it('без кольорових ліній — null; рівні — перша', () => {
    expect(brightestLineColor([{ color: null }])).toBeNull();
    expect(brightestLineColor([])).toBeNull();
    expect(brightestLineColor([{ color: '#ff0000' }, { color: '#00ff00' }])).toBe('#ff0000');
  });
});

describe('prettyStopName', () => {
  it('прямі лапки → «ялинки», зайві пробіли прибрано', () => {
    expect(prettyStopName('з-д "Прожектор"')).toBe('з-д «Прожектор»');
    expect(prettyStopName('  м-н  "Меркурій" ')).toBe('м-н «Меркурій»');
  });
});
