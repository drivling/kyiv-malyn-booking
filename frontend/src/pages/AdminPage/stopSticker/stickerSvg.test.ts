import { describe, it, expect } from 'vitest';
import { stickerLines, type StickerLine } from './stickerModel';
import { fitText, qrPath, renderStickerSvg, textWidth, wrapWords, type StickerSpec } from './stickerSvg';
import { STICKER_DATASET } from './stickerTestDataset';

const lines = stickerLines(STICKER_DATASET, 'st_0015');
const there = lines.filter((l) => l.dir === 'there');
const back = lines.filter((l) => l.dir === 'back');

const spec = (over: Partial<StickerSpec> = {}): StickerSpec => ({
  title: 'з-д «Прожектор»',
  sections: [{ heading: 'Малинівський круг', lines: there }],
  opposite: back,
  qrUrl: 'https://malin.kiev.ua/transport/stop/st_0015?utm_source=sticker&utm_medium=qr',
  qrCaption: 'malin.kiev.ua/transport/stop/st_0015',
  footer: 'Проїзд 20 ₴',
  size: 'A5',
  ...over,
});

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('renderStickerSvg', () => {
  it('аркуш A5 у міліметрах: назва, підпис напрямку, плашки ліній, QR і футер', () => {
    const svg = renderStickerSvg(spec());
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 148 210" width="148mm" height="210mm"/);
    expect(svg).toContain('з-д «Прожектор»');
    expect(svg).toContain('НАПРЯМОК: МАЛИНІВСЬКИЙ КРУГ');
    expect(svg).toContain('→ Залізничний вокзал');
    expect(svg).toMatch(/<path class="sticker-qr" d="M[^"]+"/);
    expect(svg).toContain('malin.kiev.ua/transport/stop/st_0015');
    expect(svg).toContain('Проїзд 20 ₴');
  });

  it('мало ліній — рядки зі схемою лінії і «ви тут»; лінії протилежного боку окремим рядком', () => {
    const svg = renderStickerSvg(spec());
    expect(count(svg, 'class="sticker-line"')).toBe(2);
    expect(count(svg, '>ви тут<')).toBe(2);
    expect(svg).toContain('ПРОТИЛЕЖНИЙ БІК ДОРОГИ');
    expect(svg).toContain('→ Шевченка, 119');
    expect(svg).toContain('data-route="11"');
  });

  it('без протилежного боку й підпису напрямку — блоків немає', () => {
    const svg = renderStickerSvg(spec({ opposite: [], sections: [{ heading: '', lines: there }] }));
    expect(svg).not.toContain('ПРОТИЛЕЖНИЙ БІК');
    expect(svg).not.toContain('НАПРЯМОК');
  });

  it('багато ліній — стислі рядки «через …» з короткими назвами вузлів', () => {
    const many: StickerLine[] = Array.from({ length: 8 }, (_, i) => ({ ...back[0], key: `x${i}`, routeId: String(i + 2) }));
    const svg = renderStickerSvg(spec({ sections: [{ heading: '', lines: many }], opposite: [] }));
    expect(count(svg, 'class="sticker-line"')).toBe(8);
    expect(svg).not.toContain('>ви тут<');
    expect(svg).toContain('через Центр · Лікарня');
  });

  it('назва зупинки в кольорі лінії; без кольору — темна', () => {
    expect(renderStickerSvg(spec({ titleColor: '#1F6FD6' }))).toMatch(/<text class="sticker-title"[^>]* fill="#1F6FD6">з-д «Прожектор»</);
    expect(renderStickerSvg(spec())).toMatch(/<text class="sticker-title"[^>]* fill="#1b1f2a">/);
  });

  it('A4 — той самий макет у більшому аркуші', () => {
    expect(renderStickerSvg(spec({ size: 'A4' }))).toMatch(/viewBox="0 0 148 210" width="210mm" height="297mm"/);
  });

  it('екранує текст назви', () => {
    const svg = renderStickerSvg(spec({ title: 'A & B <c>' }));
    expect(svg).toContain('A &amp; B &lt;c&gt;');
    expect(svg).not.toContain('<c>');
  });
});

describe('qrPath', () => {
  it('модулі QR без тихої зони в заданому квадраті; той самий URL — той самий шлях', () => {
    const a = qrPath('https://malin.kiev.ua/transport/stop/st_0015', 10, 20, 40);
    expect(a.modules).toBeGreaterThanOrEqual(21);
    expect(a.d.startsWith('M10 20h')).toBe(true); // верхній лівий шукач стоїть у куті
    expect(qrPath('https://malin.kiev.ua/transport/stop/st_0015', 10, 20, 40).d).toBe(a.d);
  });
});

describe('текст', () => {
  it('wrapWords переносить по словах, fitText зменшує кегль, поки не влізе', () => {
    expect(wrapWords('один два три', 5, 400, textWidth('один два', 5))).toEqual(['один два', 'три']);
    const fit = fitText('Дуже довга назва зупинки біля перехрестя вулиць', 12, 7, 800, 130, 2);
    expect(fit.size).toBeLessThan(12);
    expect(fit.lines.length).toBeLessThanOrEqual(2);
    expect(textWidth('Ш', 10, 700)).toBeGreaterThan(textWidth('і', 10, 700));
  });
});
