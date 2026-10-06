import { PRIMARY_SITE } from '@/site/siteConfig';
import type { StickerSide } from '@/types';
import type { StickerLine } from './stickerModel';
import { renderStickerSvg, stickerPageMm, type StickerSize, type StickerSpec } from './stickerSvg';

export type StickerSideKey = 'a' | 'b';

/** Куди «їде» лінія в адмінці: на бік 1, бік 2 або не друкується */
export type StickerAssign = StickerSideKey | 'off';

export type StickerLayout = 'split' | 'single';

export type StickerSheet = {
  /** Код наклейки в QR (utm_campaign=<зупинка>-<key>): a / b — бік дороги, s — одна наклейка */
  key: StickerSide;
  /** Підпис прев'ю в адмінці */
  label: string;
  spec: StickerSpec;
};

/**
 * QR — завжди на головний домен (не localhost, навіть якщо наклейку друкують з dev-сервера):
 * табло зупинки, яке показує найближчі відправлення. Мітки: GA4 бачить переходи як
 * `sticker / qr`, кампанія — конкретна наклейка (`st_0015-a`); табло з тією самою міткою пише
 * відкриття в базу (stickerScan.ts → POST /transport/sticker-scans), адмінка рахує популярність.
 */
export function stickerQrUrl(stopId: string, side: StickerSide): string {
  const campaign = encodeURIComponent(`${stopId}-${side}`);
  return `https://${PRIMARY_SITE.domain}/transport/stop/${encodeURIComponent(stopId)}?utm_source=sticker&utm_medium=qr&utm_campaign=${campaign}`;
}

export function stickerQrCaption(stopId: string): string {
  return `${PRIMARY_SITE.domain}/transport/stop/${stopId}`;
}

export function stickerFooter(fare: number | null): string {
  const parts = [fare ? `Проїзд ${fare} ₴` : '', `Схема маршрутів і розклад: ${PRIMARY_SITE.domain}/transport`];
  return parts.filter(Boolean).join(' · ');
}

/** Запасний підпис боку для наклейки з обома боками: кінцеві ліній */
function destinationsHeading(lines: StickerLine[]): string {
  return [...new Set(lines.map((l) => l.destination))].join(' · ');
}

export type StickerSheetsInput = {
  stopId: string;
  title: string;
  lines: StickerLine[];
  assign: Record<string, StickerAssign>;
  headings: Record<StickerSideKey, string>;
  layout: StickerLayout;
  showOpposite: boolean;
  size: StickerSize;
  fare: number | null;
  /** Колір назви зупинки; порожній — темний */
  titleColor?: string;
};

/**
 * Аркуші до друку. «Окремо» — по наклейці на кожен непорожній бік (лінії іншого боку — коротким
 * рядком «Протилежний бік дороги»); «Одна» — обидва боки секціями на одному аркуші (зупинка, де
 * автобуси в обидва боки стають біля одного стовпа, або кінцева).
 */
export function buildStickerSheets(input: StickerSheetsInput): StickerSheet[] {
  const side = (k: StickerSideKey) => input.lines.filter((l) => (input.assign[l.key] ?? 'off') === k);
  const a = side('a');
  const b = side('b');
  const common = {
    title: input.title.trim() || input.stopId,
    qrCaption: stickerQrCaption(input.stopId),
    footer: stickerFooter(input.fare),
    size: input.size,
    titleColor: input.titleColor || undefined,
  };
  if (input.layout === 'single') {
    const both = a.length > 0 && b.length > 0;
    const sections = (
      [
        ['a', a],
        ['b', b],
      ] as const
    )
      .filter(([, lines]) => lines.length > 0)
      .map(([k, lines]) => ({
        heading: input.headings[k].trim() || (both ? destinationsHeading(lines) : ''),
        lines,
      }));
    if (!sections.length) return [];
    return [
      {
        key: 's',
        label: 'Одна наклейка — обидва боки',
        spec: { ...common, qrUrl: stickerQrUrl(input.stopId, 's'), sections, opposite: [] },
      },
    ];
  }
  const out: StickerSheet[] = [];
  for (const [k, own, other] of [
    ['a', a, b],
    ['b', b, a],
  ] as const) {
    if (!own.length) continue;
    const heading = input.headings[k].trim();
    out.push({
      key: k,
      label: `Бік ${k === 'a' ? 1 : 2}${heading ? ` · напрямок: ${heading}` : ''}`,
      spec: {
        ...common,
        qrUrl: stickerQrUrl(input.stopId, k),
        sections: [{ heading, lines: own }],
        opposite: input.showOpposite ? other : [],
      },
    });
  }
  return out;
}

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;600;700;800&display=swap';

/** HTML для друку: кожна наклейка — окрема сторінка точного розміру аркуша, без полів */
export function stickerPrintHtml(sheets: StickerSheet[], size: StickerSize, title: string): string {
  const page = stickerPageMm(size);
  const body = sheets.map((s) => `<div class="sheet">${renderStickerSvg({ ...s.spec, size })}</div>`).join('');
  const esc = title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return (
    '<!doctype html><html lang="uk"><head><meta charset="utf-8">' +
    `<title>Наклейка — ${esc}</title>` +
    `<link rel="stylesheet" href="${FONT_HREF}">` +
    `<style>@page{size:${size} portrait;margin:0}html,body{margin:0;padding:0;background:#fff}` +
    `.sheet{width:${page.w}mm;height:${page.h}mm;overflow:hidden;break-after:page}.sheet:last-child{break-after:auto}` +
    'svg{display:block}</style></head>' +
    `<body>${body}</body></html>`
  );
}

/**
 * Друк через прихований iframe: власний документ з @page потрібного розміру, без шапки адмінки.
 * Шрифт Golos Text підвантажується в iframe і чекається перед print(), інакше перший друк вийде
 * системним шрифтом.
 */
export function printStickerSheets(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const link = doc.querySelector('link[rel="stylesheet"]');
  const cssReady = new Promise<void>((resolve) => {
    if (!link) return resolve();
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
    window.setTimeout(resolve, 4000);
  });
  void cssReady
    .then(() =>
      Promise.all(['400', '600', '700', '800'].map((w) => doc.fonts?.load(`${w} 12px "Golos Text"`, 'Зупинка 0') ?? null)).catch(
        () => null
      )
    )
    .then(() => {
      win.addEventListener('afterprint', () => iframe.remove(), { once: true });
      win.focus();
      win.print();
    });
}

/** Окремий SVG-файл (для друкарні — краще PDF з «Друкувати → Зберегти як PDF»: там вбудований шрифт) */
export function downloadStickerSvg(sheet: StickerSheet, stopId: string): void {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${renderStickerSvg(sheet.spec)}`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `naklejka-${stopId}-${sheet.key}-${sheet.spec.size}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
