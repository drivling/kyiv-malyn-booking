/**
 * «Автостанція Малин» — сутність із власним попитом (запит «автостанція Малин розклад», FB-пости,
 * AI Overview з телефонами каси — Docs/seo-aeo-review-2026-09.md §6–§7). Сторінка = повна доска
 * відправлень з автостанції з БД + телефони каси + прибуття з Житомира.
 */
import type { TransportDataset } from '@/api/transportDataset';
import type { Schedule } from '@/types';
import { tripsPerDayText } from '@/utils/weekdays';

export const AVTOSTANTSIYA_PATH = '/avtostantsiya-malyn';
export const AVTOSTANTSIYA_CANONICAL = `https://malin.kiev.ua${AVTOSTANTSIYA_PATH}`;

export const AVTOSTANTSIYA_PHONES = [
  { digits: '380731824049', label: '(073) 182 40 49' },
  { digits: '380687771590', label: '(068) 777 15 90' },
];

export const ZHYTOMYR_AS1 = {
  name: 'Автовокзал Житомир-1',
  address: 'вул. Київська, 93 (поруч із залізничним вокзалом, працює цілодобово)',
  phones: [
    { digits: '380412412303', label: '(0412) 41-23-03', note: 'довідкове бюро' },
    { digits: '380971269452', label: '(097) 126-94-52', note: 'диспетчер' },
  ],
};

export type BoardGroup = { key: string; title: string; rows: Schedule[] };

/** Зупинки «Автостанція» та «Автостанція (навпроти)» у датасеті міського транспорту. */
const AUTOSTATION_STOP_RE = /^автостанц/i;

/** Міський маршрут, що зупиняється біля автостанції. `published` = має сторінку (правило D1). */
export type CityRouteAtStation = { id: string; line: string | null; published: boolean };

/**
 * Міські маршрутки, які проходять через автостанцію. Маршрут вважається опублікованим лише якщо
 * в нього заповнені обидві кінцеві та він не позначений `unreliable` — той самий предикат, що й
 * у publishableRouteIds (prerender-spa.mjs), тож ми ніколи не лінкуємо на сторінку, якої немає.
 */
export function cityRoutesAtAutostation(dataset: TransportDataset | null | undefined): CityRouteAtStation[] {
  if (!dataset) return [];
  const stopIds = new Set(dataset.stops.filter((s) => AUTOSTATION_STOP_RE.test(s.name)).map((s) => s.id));
  if (!stopIds.size) return [];
  const routeIds = new Set(dataset.routeStops.filter((rs) => stopIds.has(rs.stopId)).map((rs) => rs.routeId));
  return dataset.routes
    .filter((r) => routeIds.has(r.id) && !String(r.id).endsWith('-old'))
    .map((r) => {
      const from = (r.fromName ?? '').trim();
      const to = (r.toName ?? '').trim();
      const line = from && to ? `${from} — ${to}` : null;
      return { id: String(r.id), line, published: Boolean(line) && !r.unreliable };
    })
    .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0) || a.id.localeCompare(b.id));
}

const isBus = (s: Schedule) => (s.vehicleType ?? 'marshrutka') !== 'elektrichka';
const byTime = (a: Schedule, b: Schedule) => a.departureTime.localeCompare(b.departureTime) || a.route.localeCompare(b.route);

/** Автобуси, що відправляються з Малина (без електричок — вони з вокзалу), згруповані за напрямком. */
export function groupDepartures(all: Schedule[]): BoardGroup[] {
  const fromMalyn = all.filter((s) => isBus(s) && s.startPoint?.code === 'Malyn').sort(byTime);
  const kyiv = fromMalyn.filter((s) => s.endPoint?.code === 'Kyiv');
  const zhytomyrDir = fromMalyn.filter((s) => s.endPoint?.code !== 'Kyiv' && s.endPoint?.code !== 'Korosten');
  const korosten = fromMalyn.filter((s) => s.endPoint?.code === 'Korosten');
  const groups: BoardGroup[] = [];
  if (zhytomyrDir.length) groups.push({ key: 'zhytomyr', title: 'Житомир, Бердичів, Вінниця, Хмільник', rows: zhytomyrDir });
  if (kyiv.length) groups.push({ key: 'kyiv', title: 'Київ (маршрутки до метро)', rows: kyiv });
  if (korosten.length) groups.push({ key: 'korosten', title: 'Коростень', rows: korosten });
  return groups;
}

/** Автобуси, що прибувають на автостанцію Малина з Житомира (кінцева Малин або транзит через Малин). */
export function arrivalsFromZhytomyr(all: Schedule[]): Schedule[] {
  return all
    .filter((s) => isBus(s) && s.startPoint?.code === 'Zhytomyr')
    .filter((s) => s.endPoint?.code === 'Malyn' || (s.tripRoute?.stops ?? []).some((st) => st.point?.code === 'Malyn'))
    .sort(byTime);
}

function range(rows: Schedule[]) {
  const t = rows.map((s) => s.departureTime).sort();
  return t.length ? { first: t[0], last: t[t.length - 1] } : null;
}

export function buildAvtostantsiyaFaq(
  groups: BoardGroup[],
  arrivals: Schedule[],
  cityRoutes: CityRouteAtStation[] = []
): Array<{ q: string; a: string }> {
  const phones = AVTOSTANTSIYA_PHONES.map((p) => p.label).join(', ');
  const zh = groups.find((g) => g.key === 'zhytomyr');
  const ky = groups.find((g) => g.key === 'kyiv');
  const faq: Array<{ q: string; a: string }> = [
    {
      q: 'Який телефон автостанції Малин?',
      a: `Каса автостанції Малина: ${phones} — довідки про рух автобусів, попередній продаж квитків і бронювання місць на рейси до Житомира. Маршрутки на Київ бронюють за окремими телефонами — на сторінці «Зубастик».`,
    },
  ];
  const zr = zh ? range(zh.rows) : null;
  if (zh && zr) {
    faq.push({
      q: 'Який розклад автобусів з автостанції Малин на Житомир?',
      a: `Перше відправлення о ${zr.first}, останнє о ${zr.last}; ${tripsPerDayText(zh.rows)} у напрямку Житомира (включно з рейсами на Бердичів, Вінницю, Хмільник, що йдуть через Житомир). Більшість — через Потіївку, кілька — через Радомишль. Повна таблиця — на цій сторінці.`,
    });
  }
  const kr = ky ? range(ky.rows) : null;
  if (ky && kr) {
    faq.push({
      q: 'Чи відправляються з автостанції маршрутки на Київ?',
      a: `Так: маршрутки Малин — Київ (до метро «Академмістечко» або «Святошин») сідають на автостанції та по місту за маршрутом; перша о ${kr.first}, остання о ${kr.last}, ${tripsPerDayText(ky.rows)}. Розклад і телефони — на сторінці «Зубастик».`,
    });
  }
  const ar = range(arrivals);
  if (ar) {
    faq.push({
      q: 'О котрій прибувають автобуси з Житомира до Малина?',
      a: `З автовокзалу Житомир-1 автобуси відправляються з ${ar.first} до ${ar.last} (${arrivals.length} рейсів за табло автовокзалу); час прибуття в Малин — у таблиці «Прибуття з Житомира» на цій сторінці.`,
    });
  }
  if (cityRoutes.length) {
    const published = cityRoutes.filter((r) => r.published);
    const pending = cityRoutes.filter((r) => !r.published);
    const parts = [
      published.length ? `${published.map((r) => `№${r.id}`).join(', ')} — розклад на сторінці маршруту` : null,
      pending.length
        ? `${pending.map((r) => `№${r.id}`).join(', ')} — маршрут ще готуємо до запуску, час по зупинці «Автостанція» уточнюємо`
        : null,
    ].filter(Boolean);
    faq.push({
      q: 'Яка міська маршрутка їде до автостанції?',
      a: `Через зупинки «Автостанція» та «Автостанція (навпроти)» проходять: ${parts.join('; ')}. Планер «З → До» і табло зупинок — на /transport.`,
    });
  }
  faq.push(
    {
      q: 'Чи є з Малина автобуси на Бердичів, Вінницю, Хмільник?',
      a: 'Так, по одному ранковому/денному рейсу на день: на Хмільник о 05:20, на Вінницю о 05:40, на Бердичів о 12:15 — усі через Житомир. Дивіться таблицю відправлень.',
    },
    {
      q: 'Де подивитися розклад міських маршруток Малина?',
      a: 'Міські маршрути, планер «З → До» і табло зупинок — на сторінці /transport. Автостанція та залізничний вокзал — окремі зупинки міських маршруток.',
    }
  );
  return faq;
}
