/**
 * Пов'язані сторінки для конкретних зупинок міського транспорту.
 *
 * Плоский ESM, бо ту саму мапу читають і SPA (LocalTransportStopBoardPage), і Node-скрипт
 * prerender-transport-stops.mjs — так само, як site-hosts.mjs (див. CLAUDE.md).
 *
 * Сюди додаємо лише сторінки, що реально існують: зупинка «Автостанція» → сторінка автостанції
 * з розкладом міжміських автобусів. Залізничний вокзал під'єднаємо, коли зʼявиться сторінка
 * електричок (план 3.1).
 */

/** @type {Record<string, Array<{ label: string; to: string }>>} */
export const STOP_RELATED_PAGES = {
  st_0004: [
    { label: 'Автостанція Малин: розклад міжміських автобусів і телефони каси', to: '/avtostantsiya-malyn' },
  ],
  st_0005: [
    { label: 'Автостанція Малин: розклад міжміських автобусів і телефони каси', to: '/avtostantsiya-malyn' },
  ],
};

/** @returns {Array<{ label: string; to: string }>} */
export function relatedPagesForStop(stopId) {
  return STOP_RELATED_PAGES[stopId] ?? [];
}
