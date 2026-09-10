/**
 * «Зубастик» — так у Малині досі називають маршрутки Малин — Київ (старий бренд перевізника;
 * домен malin.kiev.ua у 2016–2022 був його сайтом бронювання). Google щоквартально показує нас
 * за ~1 500 запитів «зубастик малин / номер телефону / розклад» — сторінка відповідає саме на них.
 * Джерела: Docs/seo-aeo-review-2026-09.md §9, §12; телефони — Polissya.today (17.11.2025) + власник.
 */
import type { Schedule } from '@/types';

export const ZUBASTYK_PATH = '/zubastyk';
export const ZUBASTYK_CANONICAL = `https://malin.kiev.ua${ZUBASTYK_PATH}`;

/** Телефони бронювання маршруток Малин — Київ. Перший у списку — резервний з нашої бази. */
export const ZUBASTYK_PHONES: Array<{ digits: string; label: string; note?: string }> = [
  { digits: '380931920008', label: '093 192 00 08' },
  { digits: '380961420008', label: '096 142 00 08' },
  { digits: '380661620008', label: '066 162 00 08' },
  { digits: '380931701835', label: '093 170 18 35', note: 'резервний' },
];

export const ZUBASTYK_BOARDING = {
  malyn: 'У Малині посадка на автостанції; можна сісти й у центрі міста за маршрутом автобуса.',
  kyiv:
    'У Києві рейси через Ірпінь відправляються від станції метро «Академмістечко», рейси через Бучу — від метро «Святошин».',
  travelTime: 'Час у дорозі — приблизно 1,5–2 години залежно від заторів на виїзді з Києва.',
};

export type ScheduleRange = { first: string; last: string; count: number };

export function scheduleRange(rows: Schedule[]): ScheduleRange | null {
  const times = rows.map((s) => s.departureTime).sort();
  return times.length ? { first: times[0], last: times[times.length - 1], count: times.length } : null;
}

export function priceRange(rows: Schedule[]): { min: number; max: number } | null {
  const prices = rows.map((s) => s.priceUah).filter((p): p is number => typeof p === 'number');
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
}

const phonesText = ZUBASTYK_PHONES.map((p) => (p.note ? `${p.label} (${p.note})` : p.label)).join(', ');

/** FAQ = те, що люди буквально вводять у Google: «зубастик малин номер телефону», «…розклад». */
export function buildZubastykFaq(
  toKyiv: Schedule[],
  toMalyn: Schedule[]
): Array<{ q: string; a: string }> {
  const rk = scheduleRange(toKyiv);
  const rm = scheduleRange(toMalyn);
  const price = priceRange([...toKyiv, ...toMalyn]);
  const priceText = price ? (price.min === price.max ? `${price.min} грн` : `${price.min}–${price.max} грн`) : null;

  const faq: Array<{ q: string; a: string }> = [
    {
      q: 'Який номер телефону маршрутки «Зубастик» Малин — Київ?',
      a: `Бронювання місць за телефонами: ${phonesText}. Або оберіть рейс у пошуку на malin.kiev.ua/mizhgorodski — бронювання без дзвінка.`,
    },
  ];
  if (rk) {
    faq.push({
      q: 'О котрій перша та остання маршрутка з Малина до Києва?',
      a: `Перший рейс о ${rk.first}, останній о ${rk.last}; усього ${rk.count} відправлень на день. Повна таблиця — на цій сторінці, актуальний розклад на дату — у пошуку на malin.kiev.ua/mizhgorodski.`,
    });
  }
  if (rm) {
    faq.push({
      q: 'О котрій перша та остання маршрутка з Києва до Малина?',
      a: `Перший рейс о ${rm.first}, останній о ${rm.last}; усього ${rm.count} відправлень на день від метро «Академмістечко» (через Ірпінь) або «Святошин» (через Бучу).`,
    });
  }
  faq.push({
    q: 'Скільки коштує маршрутка «Зубастик» Малин — Київ?',
    a: priceText
      ? `${priceText} за місце. Це місцева маршрутка до метро — не плутати з міжміськими автобусами за 450–600 грн на сайтах-агрегаторах.`
      : 'Ціну за місце дивіться в таблиці розкладу на цій сторінці або в пошуку на malin.kiev.ua/mizhgorodski.',
  });
  faq.push(
    {
      q: 'Звідки відправляється «Зубастик» у Києві та в Малині?',
      a: `${ZUBASTYK_BOARDING.kyiv} ${ZUBASTYK_BOARDING.malyn}`,
    },
    {
      q: 'Чи це той самий «Зубастик»?',
      a: 'Так у Малині за звичкою називають маршрутки Малин — Київ: бренд «Зубастик» лишився на частині автобусів і в старих оголошеннях, а сайт malin.kiev.ua колись був його сервісом бронювання. Сьогодні тут актуальний розклад цих рейсів, телефони й онлайн-бронювання.',
    }
  );
  return faq;
}
