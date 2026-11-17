/**
 * Тексти сторінки зупинки, спільні для SPA-табло (LocalTransportStopBoardPage.tsx) і статичного
 * пререндера (prerender-transport-stops.mjs). Плоский ESM, як stop-related-pages.mjs: одне джерело
 * заголовка, опису та FAQ, щоб обидві версії сторінки не розходились у формулюваннях.
 */

/**
 * Місто сторінки: форми назви й домен. За замовчуванням — Малин (статичний пререндер); SPA передає місто з профілю
 * транспорту (Docs/korosten-transport-2026-11.md, фаза 10а). Для Малина тексти дослівно ті самі.
 */
export const MALYN_COPY_CITY = { genitive: 'Малина', locative: 'Малині', domain: 'malin.kiev.ua' };

/** <title> сторінки зупинки */
export function stopPageTitle(name, city = MALYN_COPY_CITY) {
  return `Зупинка «${name}» — розклад маршруток ${city.genitive} | ${city.domain}`;
}

/**
 * Опис статті «Про зупинку» для meta description (`routeIds` — лише видимі маршрути; статичний
 * пререндер відкидає приховані перед викликом). Тут і нижче в масивах — номери для показу («11/1»),
 * не id: викликач перетворює id → номер (SPA — routeNo(), пререндер — shortName з датасету).
 */
export function stopArticleDescription(article, city = MALYN_COPY_CITY) {
  if (article.place) {
    const routes =
      article.routeIds && article.routeIds.length
        ? ` Маршрути: ${article.routeIds.map((r) => `№${r}`).join(', ')}.`
        : '';
    return `Зупинка «${article.name}» у ${city.locative} — ${article.place}.${routes}`;
  }
  return (article.lead && article.lead.trim()) || `Зупинка «${article.name}» у ${city.locative}.`;
}

/** Місто для текстів сторінок зупинок з запису мапи сайтів (site-hosts.mjs) */
export function copyCityOfSite(site) {
  return { genitive: site.cityNameUkGenitive, locative: site.cityNameUkLocative, domain: site.domain };
}

/** Опис, коли статті про зупинку немає (`routeIds` — номери для показу) */
export function stopFallbackDescription(name, routeIds, city = MALYN_COPY_CITY) {
  const routes = routeIds.length ? `: маршрути ${routeIds.map((r) => `№${r}`).join(', ')}` : '';
  return `Табло зупинки «${name}» у ${city.locative}${routes}. Наступні відправлення міського транспорту.`;
}

/** FAQ хаба табло (без обраної зупинки); друге питання повторюється на кожній сторінці зупинки */
export function stopHubFaq(city = MALYN_COPY_CITY) {
  return [
    {
      q: `Як подивитися розклад з зупинки в ${city.locative}?`,
      a: `Відкрийте ${city.domain}/transport/stop, оберіть зупинку — побачите наступні відправлення всіх маршрутів. Або перейдіть за прямим посиланням /transport/stop/st_…`,
    },
    {
      q: 'Чим табло відрізняється від планера «Звідки → Куди»?',
      a: 'Табло показує всі рейси з однієї зупинки. Планер /transport шукає прямі маршрути між двома зупинками.',
    },
  ];
}
export const STOP_HUB_FAQ = stopHubFaq();

/** Перше питання сторінки зупинки: які маршрути тут зупиняються (`routeIds` — номери для показу, у порядку показу) */
export function stopRoutesFaq(name, routeIds, stopId, city = MALYN_COPY_CITY) {
  return {
    q: `Які маршрутки зупиняються на «${name}»?`,
    a: routeIds.length
      ? `На зупинці «${name}» у ${city.locative} курсують маршрути: ${routeIds.map((r) => `№${r}`).join(', ')}. Час відправлення зі зупинки — у картках табло ${city.domain}/transport/stop/${stopId}.`
      : `Відкрийте табло зупинки «${name}» на ${city.domain}/transport/stop/${stopId} — відправлення зʼявляться, щойно розклад буде в даних.`,
  };
}
