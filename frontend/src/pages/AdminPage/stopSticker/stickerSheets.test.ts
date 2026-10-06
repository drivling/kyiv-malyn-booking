import { describe, it, expect } from 'vitest';
import { stickerLines, splitSides } from './stickerModel';
import { buildStickerSheets, stickerFooter, stickerPrintHtml, stickerQrUrl, type StickerAssign, type StickerSheetsInput } from './stickerSheets';
import { STICKER_DATASET } from './stickerTestDataset';

const lines = stickerLines(STICKER_DATASET, 'st_0015');
const sides = splitSides(lines);
const assign: Record<string, StickerAssign> = Object.fromEntries(lines.map((l) => [l.key, sides.b.includes(l.key) ? 'b' : 'a']));

const input = (over: Partial<StickerSheetsInput> = {}): StickerSheetsInput => ({
  stopId: 'st_0015',
  title: 'з-д «Прожектор»',
  lines,
  assign,
  headings: { a: 'Малинівський круг', b: 'Центр · Базарна площа' },
  layout: 'split',
  showOpposite: true,
  size: 'A5',
  fare: 20,
  ...over,
});

describe('stickerQrUrl', () => {
  it('завжди головний домен, табло зупинки, utm для GA4', () => {
    expect(stickerQrUrl('st_0015')).toBe('https://malin.kiev.ua/transport/stop/st_0015?utm_source=sticker&utm_medium=qr');
    expect(stickerFooter(20)).toBe('Проїзд 20 ₴ · Схема маршрутів і розклад: malin.kiev.ua/transport');
    expect(stickerFooter(null)).toBe('Схема маршрутів і розклад: malin.kiev.ua/transport');
  });
});

describe('buildStickerSheets', () => {
  it('«окремо» — по наклейці на бік, з лініями протилежного боку', () => {
    const sheets = buildStickerSheets(input());
    expect(sheets.map((s) => s.label)).toEqual(['Бік 1 · напрямок: Малинівський круг', 'Бік 2 · напрямок: Центр · Базарна площа']);
    expect(sheets[0].spec.sections[0].lines.map((l) => l.key)).toEqual(['5:there', '11:there']);
    expect(sheets[0].spec.opposite.map((l) => l.key)).toEqual(['5:back', '11:back']);
    expect(sheets[1].spec.opposite.map((l) => l.key)).toEqual(['5:there', '11:there']);
    expect(sheets[0].spec.qrUrl).toBe(stickerQrUrl('st_0015'));
  });

  it('без протилежного боку, «не друкувати» і порожній бік', () => {
    const sheets = buildStickerSheets(
      input({ showOpposite: false, assign: { ...assign, '5:back': 'off', '11:back': 'off' } })
    );
    expect(sheets).toHaveLength(1);
    expect(sheets[0].spec.opposite).toEqual([]);
    expect(buildStickerSheets(input({ assign: {} }))).toEqual([]);
  });

  it('«одна» — обидва боки секціями; без підпису боку — кінцеві ліній', () => {
    const [sheet, ...rest] = buildStickerSheets(input({ layout: 'single', headings: { a: '', b: 'Центр' } }));
    expect(rest).toEqual([]);
    expect(sheet.spec.sections.map((s) => s.heading)).toEqual(['Залізничний вокзал', 'Центр']);
    expect(sheet.spec.opposite).toEqual([]);
  });

  it('порожня назва — id зупинки', () => {
    expect(buildStickerSheets(input({ title: '  ' }))[0].spec.title).toBe('st_0015');
  });
});

describe('stickerPrintHtml', () => {
  it('сторінка точного розміру без полів, кожна наклейка — окремий аркуш', () => {
    const html = stickerPrintHtml(buildStickerSheets(input({ size: 'A4' })), 'A4', 'з-д «Прожектор»');
    expect(html).toContain('@page{size:A4 portrait;margin:0}');
    expect(html).toContain('.sheet{width:210mm;height:297mm');
    expect(html.split('<div class="sheet">').length - 1).toBe(2);
    expect(html).toContain('width="210mm" height="297mm"');
    expect(html).toContain('family=Golos+Text');
  });
});
