import { encode } from 'uqr';
import type { StickerLine, StickerNode } from './stickerModel';

/**
 * SVG наклейки на зупинку у стилі схеми маршрутів (Docs/malyn-transit-scheme/build_scheme.py,
 * плакат): біле поле, «МАЛИН» 800, плашки номерів у кольорах ліній, лінія маршруту з вузлами
 * (біле коло з темним кільцем — пересадковий вузол, кільце в кольорі лінії — кінцева), QR у рамці.
 *
 * Координати — міліметри аркуша A5 (148×210); A4 — той самий макет, масштабований на √2
 * (сторони A-форматів пропорційні), тож розкладка одна.
 */

export type StickerSize = 'A5' | 'A4';

export type StickerSection = {
  /** «Напрямок: …»; порожній — без підпису */
  heading: string;
  lines: StickerLine[];
};

export type StickerSpec = {
  title: string;
  sections: StickerSection[];
  /** Лінії з протилежного боку дороги — коротким рядком над QR */
  opposite: StickerLine[];
  /** Повна адреса для QR (табло зупинки) */
  qrUrl: string;
  /** Адреса під QR людською мовою, без https:// і utm */
  qrCaption: string;
  /** Рядок футера: проїзд, адреса розділу */
  footer: string;
  size: StickerSize;
  /** Колір назви зупинки (колір однієї з ліній); без нього — темний, як решта тексту */
  titleColor?: string;
};

const W = 148;
const H = 210;
const M = 9;
const FG = '#1b1f2a';
const MUTED = '#5f6673';
const RULE = '#d5d9df';
const FONT = "'Golos Text', 'Segoe UI', Roboto, Arial, sans-serif";

const PAGE_MM: Record<StickerSize, { w: number; h: number }> = { A5: { w: 148, h: 210 }, A4: { w: 210, h: 297 } };

export function stickerPageMm(size: StickerSize): { w: number; h: number } {
  return PAGE_MM[size];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Оцінка ширини рядка Golos Text без canvas (генератор чистий і працює в тестах): середні ширини
 * гліфів у em, із запасом. Точність ±5% — макет лишає поля, а заголовок зменшується з кроком.
 */
export function textWidth(text: string, size: number, weight = 400): number {
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.27;
    else if (/[.,:;·'’«»"()]/.test(ch)) em += 0.32;
    else if (/[0-9]/.test(ch)) em += 0.6;
    else if (/[ЖШЩЮМФЫжшщюмфы]/.test(ch)) em += ch === ch.toUpperCase() ? 0.92 : 0.78;
    else if (/[А-ЯІЇЄҐA-Z]/.test(ch)) em += 0.7;
    else if (/[—–→]/.test(ch)) em += 0.85;
    else em += 0.56;
  }
  return em * size * (weight >= 700 ? 1.07 : weight >= 600 ? 1.04 : 1);
}

/** Розбиття на рядки по словах під ширину */
export function wrapWords(text: string, size: number, weight: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(next, size, weight) > maxWidth) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Найбільший кегль (з кроком 0.5), за якого текст влазить у maxLines рядків */
export function fitText(text: string, maxSize: number, minSize: number, weight: number, maxWidth: number, maxLines: number) {
  for (let s = maxSize; s >= minSize; s -= 0.5) {
    const lines = wrapWords(text, s, weight, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => textWidth(l, s, weight) <= maxWidth)) return { size: s, lines };
  }
  return { size: minSize, lines: wrapWords(text, minSize, weight, maxWidth) };
}

function txt(
  x: number,
  y: number,
  s: string,
  size: number,
  opts: { weight?: number; fill?: string; anchor?: string; ls?: number; cls?: string } = {}
) {
  const c = opts.cls ? ` class="${opts.cls}"` : '';
  const a = opts.anchor && opts.anchor !== 'start' ? ` text-anchor="${opts.anchor}"` : '';
  const w = opts.weight && opts.weight !== 400 ? ` font-weight="${opts.weight}"` : '';
  const ls = opts.ls ? ` letter-spacing="${opts.ls}"` : '';
  return `<text${c} x="${r(x)}" y="${r(y)}" font-size="${size}"${w}${a}${ls} fill="${opts.fill ?? FG}">${esc(s)}</text>`;
}

function r(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function badgeWidth(id: string, h: number): number {
  return id.length === 1 ? h * 1.35 : h * 1.75;
}

/** Плашка номера, як на схемі: прямокутник у кольорі лінії, білий жирний номер */
function badge(x: number, y: number, line: Pick<StickerLine, 'routeId' | 'color'>, h: number, width?: number): string {
  const w = width ?? badgeWidth(line.routeId, h);
  return (
    `<g data-route="${esc(line.routeId)}"><rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="${r(h * 0.19)}" fill="${line.color ?? FG}"/>` +
    txt(x + w / 2, y + h * 0.73, line.routeId, h * 0.68, { weight: 800, fill: '#ffffff', anchor: 'middle' }) +
    '</g>'
  );
}

function sectionLabel(y: number, label: string): string {
  return txt(M, y, label.toUpperCase(), 2.7, { weight: 700, fill: MUTED, ls: 0.25 }) +
    `<line x1="${M}" y1="${r(y + 1.6)}" x2="${W - M}" y2="${r(y + 1.6)}" stroke="${RULE}" stroke-width="0.3"/>`;
}

/** Підписи вузла: довгі назви «A · B» переносяться по крапці */
function nodeLabel(x: number, y: number, node: StickerNode, maxWidth: number, anchor: string, size: number): string {
  let parts = [node.name];
  if (textWidth(node.name, size) > maxWidth) {
    parts = node.name.includes(' · ') ? node.name.split(' · ') : wrapWords(node.name, size, 400, maxWidth).slice(0, 2);
  }
  return parts.map((p, i) => txt(x, y + i * size * 1.16, p, size, { fill: MUTED, anchor })).join('');
}

const STRIP_ROW = 21;
const COMPACT_ROW = 12.5;

/** Колонка плашок: однакова ширина для всіх рядків наклейки, щоб лінії починалися з однієї точки */
type RowGeom = { z: number; badgeChars: number };

function rowBadgeWidth(g: RowGeom, h: number): number {
  return badgeWidth(g.badgeChars > 1 ? '00' : '0', h);
}

/**
 * Рядок лінії зі схемою: плашка + «→ кінцева», під ними — лінія з «ви тут», вузлами й кінцевою.
 * z — збільшення по вертикалі (кегль, плашка), коли ліній мало і є місце; ширина лінії — завжди на весь аркуш.
 */
function stripRow(y0: number, line: StickerLine, g: RowGeom): string {
  const z = g.z;
  const bh = 8 * z;
  const bw = rowBadgeWidth(g, bh);
  const color = line.color ?? FG;
  const o: string[] = [badge(M, y0, line, bh, bw)];
  const tx = M + bw + 3.5 * z;
  const dest = `→ ${line.destination}`;
  const fit = fitText(dest, 5.6 * z, 4, 700, W - M - tx, 1);
  o.push(txt(tx, y0 + 6.1 * z, fit.lines[0] ?? dest, fit.size, { weight: 700 }));

  const ly = y0 + 13.6 * z;
  const x0 = M + bw / 2;
  const x1 = W - M - 2.2;
  const lz = Math.min(z, 1.15);
  const labelSize = 2.75 * lz;
  o.push(`<line x1="${r(x0)}" y1="${r(ly)}" x2="${r(x1)}" y2="${r(ly)}" stroke="${color}" stroke-width="${r(1.9 * lz)}" stroke-linecap="round"/>`);
  const n = line.via.length;
  const step = (x1 - x0) / (n + 1);
  line.via.forEach((v, i) => {
    const x = x0 + step * (i + 1);
    const hub = v.kind === 'hub';
    o.push(`<circle cx="${r(x)}" cy="${r(ly)}" r="${r((hub ? 2 : 1.35) * lz)}" fill="#ffffff" stroke="${FG}" stroke-width="${r((hub ? 0.8 : 0.6) * lz)}"/>`);
    o.push(nodeLabel(x, ly + 5.6 * lz, v, step - 2, 'middle', labelSize));
  });
  // кінцева — кільце в кольорі лінії, як термінали схеми
  o.push(`<circle cx="${r(x1)}" cy="${r(ly)}" r="${r(2 * lz)}" fill="#ffffff" stroke="${color}" stroke-width="${r(lz)}"/>`);
  // «ви тут» — біле коло з темним кільцем і точкою
  o.push(`<circle cx="${r(x0)}" cy="${r(ly)}" r="${r(2.4 * lz)}" fill="#ffffff" stroke="${FG}" stroke-width="${r(lz)}"/>`);
  o.push(`<circle cx="${r(x0)}" cy="${r(ly)}" r="${r(0.95 * lz)}" fill="${FG}"/>`);
  o.push(txt(x0 - 2.4 * lz, ly + 5.6 * lz, 'ви тут', labelSize, { weight: 700 }));
  return `<g class="sticker-line" data-line="${esc(line.key)}">${o.join('')}</g>`;
}

/** Стислий рядок, коли ліній багато: плашка, «→ кінцева» і «через …» */
function compactRow(y0: number, line: StickerLine, g: RowGeom): string {
  const z = g.z;
  const bh = 6.6 * z;
  const bw = rowBadgeWidth(g, bh);
  const tx = M + bw + 3 * z;
  const o: string[] = [badge(M, y0, line, bh, bw)];
  const fit = fitText(`→ ${line.destination}`, 4.8 * z, 3.4, 700, W - M - tx, 1);
  o.push(txt(tx, y0 + 5 * z, fit.lines[0] ?? '', fit.size, { weight: 700 }));
  if (line.via.length) {
    // у переліку — коротка назва вузла («Центр», не «Центр · Базарна площа»): крапка тут — роздільник
    const via = `через ${line.via.map((v) => v.name.split(' · ')[0]).join(' · ')}`;
    const vf = fitText(via, 3.1 * Math.min(z, 1.1), 2.5, 400, W - M - tx, 1);
    o.push(txt(tx, y0 + 9.4 * z, vf.lines[0] ?? '', vf.size, { fill: MUTED }));
  }
  return `<g class="sticker-line" data-line="${esc(line.key)}">${o.join('')}</g>`;
}

/** Шлях темних модулів QR (без тихої зони) у квадраті size×size */
export function qrPath(url: string, x0: number, y0: number, size: number): { d: string; modules: number } {
  const qr = encode(url, { ecc: 'M', border: 0 });
  const n = qr.size;
  const m = size / n;
  const parts: string[] = [];
  qr.data.forEach((row, y) => {
    let x = 0;
    while (x < n) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < n && row[x + run]) run += 1;
      parts.push(`M${r(x0 + x * m)} ${r(y0 + y * m)}h${r(run * m)}v${r(m)}h${r(-run * m)}z`);
      x += run;
    }
  });
  return { d: parts.join(''), modules: n };
}

function oppositeBlock(y: number, lines: StickerLine[]): { svg: string; height: number } {
  if (!lines.length) return { svg: '', height: 0 };
  const o: string[] = [sectionLabel(y, 'Протилежний бік дороги')];
  let x = M;
  let row = y + 4.6;
  const bh = 4.8;
  for (const l of lines) {
    const label = `→ ${l.destination}`;
    const w = badgeWidth(l.routeId, bh) + 1.6 + textWidth(label, 3.3, 600) + 5;
    if (x + w > W - M && x > M) {
      x = M;
      row += 6.4;
    }
    o.push(badge(x, row, l, bh));
    o.push(txt(x + badgeWidth(l.routeId, bh) + 1.6, row + 3.6, label, 3.3, { weight: 600, fill: MUTED }));
    x += w;
  }
  return { svg: o.join(''), height: row + bh - y + 2 };
}

export function renderStickerSvg(spec: StickerSpec): string {
  const page = stickerPageMm(spec.size);
  const o: string[] = [];
  o.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${page.w}mm" height="${page.h}mm" ` +
      `font-family="${esc(FONT)}" role="img" aria-label="${esc(`Наклейка зупинки «${spec.title}»`)}">`
  );
  o.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);

  // ---- шапка: як заголовок плаката схеми
  o.push(txt(M, 16.5, 'МАЛИН', 7.6, { weight: 800, ls: 0.45 }));
  o.push(txt(W - M, 16.5, 'Міські автобусні маршрути', 3.3, { weight: 600, fill: MUTED, anchor: 'end' }));
  o.push(`<line x1="${M}" y1="20.5" x2="${W - M}" y2="20.5" stroke="${FG}" stroke-width="0.5"/>`);

  // ---- назва зупинки
  o.push(txt(M, 27.6, 'ЗУПИНКА', 2.8, { weight: 700, fill: MUTED, ls: 0.3 }));
  const title = fitText(spec.title, 12, 7, 800, W - 2 * M, 2);
  let y = 28 + title.size * 1.02;
  title.lines.forEach((line, i) => {
    o.push(txt(M, y + i * title.size * 1.1, line, title.size, { weight: 800, fill: spec.titleColor || FG, cls: 'sticker-title' }));
  });
  y += (title.lines.length - 1) * title.size * 1.1;

  // ---- QR і футер знизу; лінії — у просторі між назвою і QR
  const qrSize = 50;
  const footerY = H - M;
  const qrY = footerY - 7 - qrSize;
  const opposite = oppositeBlock(0, spec.opposite);
  const oppositeY = qrY - 5 - opposite.height;
  const listTop = y + 6;
  const listBottom = (opposite.height ? oppositeY : qrY) - 4;

  const all = spec.sections.flatMap((s) => s.lines);
  const total = all.length;
  const headed = spec.sections.filter((s) => s.heading).length;
  const headingH = 7.5;
  const room = listBottom - listTop - headed * headingH;
  // мало ліній — схематичні рядки, збільшені до 1.5 під вільне місце; багато — стислі рядки
  const compact = total * STRIP_ROW > room;
  const rowH = compact ? COMPACT_ROW : STRIP_ROW;
  const geom: RowGeom = {
    z: Math.max(0.6, Math.min(1.5, room / Math.max(1, total * rowH))),
    badgeChars: Math.max(1, ...all.map((l) => l.routeId.length)),
  };

  let cy = listTop;
  for (const section of spec.sections) {
    if (section.heading) {
      o.push(sectionLabel(cy + 3, `Напрямок: ${section.heading}`));
      cy += headingH;
    }
    for (const line of section.lines) {
      const row = compact ? compactRow(0, line, geom) : stripRow(0, line, geom);
      o.push(`<g transform="translate(0 ${r(cy)})">${row}</g>`);
      cy += rowH * geom.z;
    }
  }

  if (opposite.height) o.push(`<g transform="translate(0 ${r(oppositeY)})">${opposite.svg}</g>`);

  // ---- QR: рамка як на плакаті схеми
  // тиха зона — 4 модулі (вимога стандарту), рамка поза нею
  const modules = encode(spec.qrUrl, { ecc: 'M', border: 0 }).size;
  const quiet = (4 * qrSize) / (modules + 8);
  o.push(`<rect x="${M}" y="${r(qrY)}" width="${qrSize}" height="${qrSize}" rx="2.4" fill="#ffffff" stroke="${MUTED}" stroke-width="0.4"/>`);
  const qr = qrPath(spec.qrUrl, M + quiet, qrY + quiet, qrSize - 2 * quiet);
  o.push(`<path class="sticker-qr" d="${qr.d}" fill="${FG}" shape-rendering="crispEdges"/>`);
  const tx = M + qrSize + 6;
  const tw = W - M - tx;
  const head = fitText('Коли приїде автобус?', 6, 4.5, 800, tw, 2);
  let ty = qrY + 7;
  head.lines.forEach((l) => {
    o.push(txt(tx, ty, l, head.size, { weight: 800 }));
    ty += head.size * 1.15;
  });
  ty += 1.5;
  for (const l of wrapWords('Наведіть камеру телефона на QR-код: найближчі відправлення з цієї зупинки онлайн.', 3.6, 400, tw)) {
    o.push(txt(tx, ty, l, 3.6));
    ty += 4.6;
  }
  const cap = fitText(spec.qrCaption, 3, 2.3, 400, tw, 2);
  ty = qrY + qrSize - 1 - (cap.lines.length - 1) * cap.size * 1.25;
  cap.lines.forEach((l, i) => o.push(txt(tx, ty + i * cap.size * 1.25, l, cap.size, { fill: MUTED })));

  // ---- футер
  o.push(`<line x1="${M}" y1="${r(footerY - 4.6)}" x2="${W - M}" y2="${r(footerY - 4.6)}" stroke="${RULE}" stroke-width="0.3"/>`);
  o.push(txt(M, footerY, spec.footer, 2.9, { fill: MUTED }));

  o.push('</svg>');
  return o.join('');
}
