/**
 * Тексти сторінки зупинки, спільні для SPA-табло (LocalTransportStopBoardPage.tsx) і статичного
 * пререндера (prerender-transport-stops.mjs). Плоский ESM, як stop-related-pages.mjs: одне джерело
 * заголовка, опису та FAQ, щоб обидві версії сторінки не розходились у формулюваннях.
 */

/** <title> сторінки зупинки */
export function stopPageTitle(name) {
  return `Зупинка «${name}» — розклад маршруток Малина | malin.kiev.ua`;
}

/**
 * Опис статті «Про зупинку» для meta description (`routeIds` — лише видимі маршрути; статичний
 * пререндер відкидає приховані перед викликом). Тут і нижче в масивах — номери для показу («11/1»),
 * не id: викликач перетворює id → номер (SPA — routeNo(), пререндер — shortName з датасету).
 */
export function stopArticleDescription(article) {
  if (article.place) {
    const routes =
      article.routeIds && article.routeIds.length
        ? ` Маршрути: ${article.routeIds.map((r) => `№${r}`).join(', ')}.`
        : '';
    return `Зупинка «${article.name}» у Малині — ${article.place}.${routes}`;
  }
  return (article.lead && article.lead.trim()) || `Зупинка «${article.name}» у Малині.`;
}

/** Опис, коли статті про зупинку немає (`routeIds` — номери для показу) */
export function stopFallbackDescription(name, routeIds) {
  const routes = routeIds.length ? `: маршрути ${routeIds.map((r) => `№${r}`).join(', ')}` : '';
  return `Табло зупинки «${name}» у Малині${routes}. Наступні відправлення міського транспорту.`;
}

/** FAQ хаба табло (без обраної зупинки); друге питання повторюється на кожній сторінці зупинки */
export const STOP_HUB_FAQ = [
  {
    q: 'Як подивитися розклад з зупинки в Малині?',
    a: 'Відкрийте malin.kiev.ua/transport/stop, оберіть зупинку — побачите наступні відправлення всіх маршрутів. Або перейдіть за прямим посиланням /transport/stop/st_…',
  },
  {
    q: 'Чим табло відрізняється від планера «Звідки → Куди»?',
    a: 'Табло показує всі рейси з однієї зупинки. Планер /transport шукає прямі маршрути між двома зупинками.',
  },
];

/** Перше питання сторінки зупинки: які маршрути тут зупиняються (`routeIds` — номери для показу, у порядку показу) */
export function stopRoutesFaq(name, routeIds, stopId) {
  return {
    q: `Які маршрутки зупиняються на «${name}»?`,
    a: routeIds.length
      ? `На зупинці «${name}» у Малині курсують маршрути: ${routeIds.map((r) => `№${r}`).join(', ')}. Час відправлення зі зупинки — у картках табло malin.kiev.ua/transport/stop/${stopId}.`
      : `Відкрийте табло зупинки «${name}» на malin.kiev.ua/transport/stop/${stopId} — відправлення зʼявляться, щойно розклад буде в даних.`,
  };
}
