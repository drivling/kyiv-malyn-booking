/**
 * Відповідь сервера про дорогу містом → кроки історії за видом транспорту (Docs/dovede-roadmap.md, «Картки видів
 * транспорту в дорозі містом»). Сервер (Google) дає кроки «пішки» і «поїздка»; тут кожна поїздка стає окремим кроком
 * історії зі своєю карткою:
 *  - метро Києва — своє (`metroTrip`: лінії, пересадки, інтервал за порою дня, жетон), станції входу й виходу — з
 *    відповіді; кілька поїздів підряд з короткою пішою між ними — одна поїздка з пересадкою;
 *  - міська електричка Києва (Kyiv City Express) — свій рейс із розкладу (`nextRingRide`), час точний;
 *  - решта (автобус, маршрутка, тролейбус, трамвай, фунікулер, приміська електричка) — `cityRide` з карткою за видом.
 * Пішки між поїздками — крок `walk`. Чистий модуль: картки — `ui/CityRideCard.tsx`, `MetroCard`, `RingCard`.
 */
import { metroTrip } from '../data/kyiv';
import { RING_SERVICE, laterRingDepartures, nextRingRide } from '../data/kyivRing';
import { METRO_STATIONS, type MetroStation } from '../nlu/kyivMetroData';
import { RING_STATIONS, type RingStation } from '../nlu/kyivRingData';
import type { CityStep, StoryLeg } from './types';

type CityLeg = Extract<StoryLeg, { kind: 'city' }>;

/** Пішки між двома поїздами метро довше за це — уже не пересадка під землею, а окрема дорога */
const TRANSFER_WALK_MAX = 10;

/** Назва з відповіді Google → ключ: без лапок, «ст. м.», «станція», латинської «i» (у Google «Видубичi») */
const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/i/g, 'і')
    .replace(/[«»"“”„'’ʼ`]/g, ' ')
    .replace(/^\s*(станція метро|ст\.\s*м\.|станція|платформа|метро|м\.)\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim();

function byName<T extends { id: string; name: string; said: string[] }>(list: readonly T[], extra: Record<string, string> = {}): Map<string, T> {
  const out = new Map<string, T>();
  for (const st of list) {
    for (const n of [st.name, ...st.said]) {
      const k = norm(n);
      if (k && !out.has(k)) out.set(k, st);
    }
  }
  for (const [said, target] of Object.entries(extra)) {
    const st = list.find((x) => x.id === target);
    if (st) out.set(norm(said), st);
  }
  return out;
}

const METRO_BY_NAME = byName(METRO_STATIONS);
/** Так Google називає станції кільця інакше, ніж перевізник */
const RING_BY_NAME = byName(RING_STATIONS, {
  Північна: 'kyiv.e.vokzalna',
  'Київ-Пасажирський (Північна)': 'kyiv.e.vokzalna',
  'Київ-Пасажирський': 'kyiv.e.vokzalna',
  'Київ Пасажирський': 'kyiv.e.vokzalna',
});

/** Станція нашого метро за назвою з відповіді Google («Палац "Україна"», «ст. м. Хрещатик»); null — не впізнали */
export function metroStationByName(name: string | null | undefined): MetroStation | null {
  return name ? METRO_BY_NAME.get(norm(name)) ?? null : null;
}

/** Станція міської електрички Києва за назвою з відповіді Google («Видубичi», «Північна»); null — не впізнали */
export function ringStationByName(name: string | null | undefined): RingStation | null {
  return name ? RING_BY_NAME.get(norm(name)) ?? null : null;
}

const RAIL_MODES = new Set(['HEAVY_RAIL', 'COMMUTER_TRAIN', 'RAIL', 'LONG_DISTANCE_TRAIN', 'HIGH_SPEED_TRAIN']);
const isSubway = (s: CityStep | undefined): boolean => s?.kind === 'transit' && s.mode === 'SUBWAY';
/** Поїзд кільцевої: так його підписує Google («Kyiv City Express», напрямок «E1 (…)» / «E2 (…)») */
const isRing = (s: CityStep): boolean => s.kind === 'transit' && RAIL_MODES.has(s.mode ?? '') && (/city express/i.test(s.line ?? '') || /^E[12]\b/.test(s.headsign ?? ''));

type Part =
  | { kind: 'walk'; steps: CityStep[] }
  | { kind: 'metro'; steps: CityStep[]; from: MetroStation; to: MetroStation }
  | { kind: 'ring'; step: CityStep; from: RingStation; to: RingStation }
  | { kind: 'ride'; step: CityStep };

/** Кроки сервера → частини дороги (лише Київ має свої метро й кільцеву) */
function partsOf(steps: CityStep[], kyiv: boolean): Part[] {
  const parts: Part[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === 'walk') {
      const last = parts[parts.length - 1];
      if (last?.kind === 'walk') last.steps.push(s);
      else parts.push({ kind: 'walk', steps: [s] });
      continue;
    }
    const from = kyiv && isSubway(s) ? metroStationByName(s.fromStop) : null;
    if (from) {
      let j = i;
      while (isSubway(steps[j + 2]) && steps[j + 1].kind === 'walk' && steps[j + 1].minutes <= TRANSFER_WALK_MAX && metroStationByName(steps[j + 2].fromStop)) j += 2;
      while (isSubway(steps[j + 1]) && metroStationByName(steps[j + 1].fromStop)) j += 1;
      const to = metroStationByName(steps[j].toStop);
      if (to && to.id !== from.id) {
        parts.push({ kind: 'metro', steps: steps.slice(i, j + 1), from, to });
        i = j;
        continue;
      }
    }
    const a = kyiv && isRing(s) ? ringStationByName(s.fromStop) : null;
    const b = a ? ringStationByName(s.toStop) : null;
    if (a && b && a.id !== b.id) {
      parts.push({ kind: 'ring', step: s, from: a, to: b });
      continue;
    }
    parts.push({ kind: 'ride', step: s });
  }
  return parts;
}

const sum = (steps: CityStep[], f: (s: CityStep) => number) => steps.reduce((n, s) => n + f(s), 0);

/** Очікування коротше за це — без окремого рядка (лише в часі): пара хвилин на зупинці — звичайна справа */
export const WAIT_SHOWN_MIN = 3;

/** «Чекати ≈ 32 хв на зупинці «вул. Замковецька».» — де саме, за видом: зупинка, станція, платформа */
function waitText(city: CityLeg['city'], step: CityStep, minutes: number): string {
  const look = rideLook(step);
  const where = look === 'rail' ? 'на платформі' : look === 'funicular' || look === 'speedTram' || look === 'subway' ? 'на станції' : 'на зупинці';
  const name = rideStopName(city, step, 'from');
  return `Чекати ≈ ${minutes} хв ${where}${name ? ` «${name}»` : ''}.`;
}

/** Як назвати місце посадки наступної частини (для підпису «пішки до …») */
function boardingName(p: Part | undefined, city: CityLeg['city']): string | null {
  if (!p || p.kind === 'walk') return null;
  if (p.kind === 'metro') return p.from.name;
  if (p.kind === 'ring') return p.from.name;
  return rideStopName(city, p.step, 'from');
}

/**
 * Крок містом з відповіддю сервера → кроки історії за видом транспорту. `dep` — коли людина вирушає з першої точки
 * (хв від півночі). null — відповіді немає: крок лишається, як був (кнопка карти).
 *
 * Хвилини: метро й кільцева — свої (з входом, очікуванням, точним рейсом); поїздки Google — як у відповіді.
 */
export function splitCityRoute(leg: CityLeg, dep: number, date: string): { legs: StoryLeg[]; minutes: number } | null {
  const route = leg.route;
  if (!route || !route.steps.length) return null;
  const parts = partsOf(route.steps, leg.city === 'Kyiv');
  // очікування, якого Google не розписав (загальний час більший за суму кроків), — перед першою його поїздкою; коли
  // метро чи кільцева свої, їхні хвилини вже з очікуванням, тож цієї різниці не додаємо
  let slack = parts.some((p) => p.kind === 'metro' || p.kind === 'ring') ? 0 : Math.max(0, route.minutes - sum(route.steps, (s) => s.minutes));
  // «перевірено…» й посилання на карту — в останній поїздці Google (кільцева без нашого рейсу теж така)
  const kinds = parts.map((p) => p.kind);
  const lastRide = Math.max(kinds.lastIndexOf('ride'), kinds.lastIndexOf('ring'));
  const out: StoryLeg[] = [];
  let t = dep;
  const ride = (p: { step: CityStep }, k: number) => {
    // очікування, якого Google не розписав, — перед першою його поїздкою; від кількох хвилин — окремим рядком, щоб
    // людина бачила, звідки взялися пів години між «пішки» й маршруткою
    if (slack >= WAIT_SHOWN_MIN) out.push({ kind: 'wait', text: waitText(leg.city, p.step, slack) });
    t += slack;
    slack = 0;
    const last = k === lastRide;
    out.push({ kind: 'cityRide', city: leg.city, step: p.step, depMins: t, arrMins: t + p.step.minutes, checkedAt: last ? route.fetchedAt : null, mapsUrl: last ? leg.mapsUrl : null });
    t += p.step.minutes;
  };
  parts.forEach((p, k) => {
    if (p.kind === 'walk') {
      const next = boardingName(parts[k + 1], leg.city);
      out.push({ kind: 'walk', meters: sum(p.steps, (s) => s.meters ?? 0), minutes: sum(p.steps, (s) => s.minutes), toLabel: next ?? (k === parts.length - 1 ? leg.toLabel : null), late: false });
      t += sum(p.steps, (s) => s.minutes);
      return;
    }
    if (p.kind === 'metro') {
      const trip = metroTrip(p.from.id, p.to.id, { mins: t, date });
      if (trip && !trip.closed) {
        out.push({ kind: 'metro', segments: trip.segments, transfers: trip.transfers, minutes: trip.minutes, depMins: t, arrMins: t + trip.minutes, headwayMin: trip.headwayMin, priceUah: trip.priceUah, closed: false, mapsUrl: leg.mapsUrl });
        t += trip.minutes;
      } else {
        // метро о цій порі не працює за нашими даними — кажемо те, що сказав сервер
        for (const s of p.steps) {
          if (s.kind === 'walk') {
            out.push({ kind: 'walk', meters: s.meters ?? 0, minutes: s.minutes, toLabel: null, late: false });
            t += s.minutes;
          } else ride({ step: s }, -1);
        }
      }
      return;
    }
    if (p.kind === 'ring') {
      // рейс — завжди з нашого розкладу: збережена відповідь могла бути на іншу годину, а поїзди кільцевої ходять
      // раз на 30–60 хв; очікування на платформі чесно входить у час. Рейсів сьогодні вже немає — крок сервера
      const r = nextRingRide(p.from.id, p.to.id, date, t);
      if (r) {
        out.push({ kind: 'ring', ride: r, depMins: r.depMins, arrMins: r.arrMins, walkBeforeMin: 0, walkAfterMin: 0, later: laterRingDepartures(r, date), priceUah: RING_SERVICE.fareUah, mapsUrl: leg.mapsUrl });
        t = r.arrMins;
        return;
      }
      ride(p, k);
      return;
    }
    ride(p, k);
  });
  return { legs: out, minutes: t - dep };
}

// ─── Вид поїздки для картки й тексту ──────────────────────────────────────────────────────────

/** Як намалювати поїздку з відповіді сервера: за видом транспорту Google, а не за містом */
export type RideLook = 'bus' | 'minibus' | 'trolleybus' | 'tram' | 'speedTram' | 'funicular' | 'rail' | 'subway' | 'other';

export function rideLook(step: Pick<CityStep, 'mode' | 'fromStop' | 'toStop'>): RideLook {
  const m = step.mode ?? '';
  if (m === 'BUS' || m === 'INTERCITY_BUS') return 'bus';
  if (m === 'SHARE_TAXI') return 'minibus';
  if (m === 'TROLLEYBUS') return 'trolleybus';
  // швидкісний трамвай: окрема лінія зі станціями (у Google — «станція "Жуля Верна"»); LIGHT_RAIL — так його звуть деінде
  if (m === 'LIGHT_RAIL') return 'speedTram';
  if (m === 'TRAM') return [step.fromStop, step.toStop].some((n) => /^станці[яи](\s|$)/i.test((n ?? '').trim())) ? 'speedTram' : 'tram';
  if (m === 'FUNICULAR' || m === 'CABLE_CAR' || m === 'GONDOLA_LIFT') return 'funicular';
  if (RAIL_MODES.has(m) || m === 'MONORAIL') return 'rail';
  if (m === 'SUBWAY' || m === 'METRO_RAIL') return 'subway';
  return 'other';
}

/**
 * Колір виду транспорту — для лінії історії, смуги на осі часу й таблички. Свій, а не з відповіді: Google дає колір
 * перевізника (у Києві однаковий для трамвая й фунікулера), а картки мають відрізнятися видом.
 */
export const RIDE_COLOR: Record<RideLook, string> = {
  bus: '#1f63a8',
  minibus: '#c98a00',
  trolleybus: '#0e7f86',
  tram: '#c43a2f',
  speedTram: '#8b2c6e',
  funicular: '#8a5a2b',
  rail: '#2e7d4f',
  subway: '#4a5560',
  other: '#2f6f4f',
};


/** Назва виду словом — для тексту історії й підпису картки */
export const RIDE_NAME: Record<RideLook, string> = {
  bus: 'автобус',
  minibus: 'маршрутка',
  trolleybus: 'тролейбус',
  tram: 'трамвай',
  speedTram: 'швидкісний трамвай',
  funicular: 'фунікулер',
  rail: 'електричка',
  subway: 'метро',
  other: 'транспорт',
};

/**
 * Фунікулери міст, де працює «Доведе»: як звуться нижня й верхня станції. Google їх так не називає («Нижняя
 * станция» / «Верхня станція»), тож назви — свої.
 */
export const FUNICULARS: Partial<Record<CityLeg['city'], { lower: string; upper: string }>> = {
  Kyiv: { lower: 'Поштова площа', upper: 'Михайлівська площа' },
};

/** Фунікулер: вгору чи вниз і як назвати станції; null — сторона невідома (назви станцій без «верхня» / «нижня») */
export function funicularWay(city: CityLeg['city'], step: Pick<CityStep, 'fromStop' | 'toStop'>): { up: boolean; from: string; to: string } | null {
  const top = (n: string | undefined) => /верхн/i.test(n ?? '');
  const bottom = (n: string | undefined) => /нижн/i.test(n ?? '');
  const up = bottom(step.fromStop) || top(step.toStop) ? true : top(step.fromStop) || bottom(step.toStop) ? false : null;
  if (up == null) return null;
  const known = FUNICULARS[city];
  const lower = known?.lower ?? 'нижня станція';
  const upper = known?.upper ?? 'верхня станція';
  return up ? { up, from: lower, to: upper } : { up, from: upper, to: lower };
}

/** «трамвай 12», «маршрутка 575», «фунікулер вгору» — коротко, для першого речення історії */
export function ridePhrase(city: CityLeg['city'], step: CityStep): string {
  const look = rideLook(step);
  if (look === 'funicular') {
    const way = funicularWay(city, step);
    return way ? `фунікулер ${way.up ? 'вгору' : 'вниз'} до «${way.to}»` : 'фунікулер';
  }
  const no = look === 'rail' && /city express/i.test(step.line ?? '') ? '' : (step.line ?? '').trim();
  return `${RIDE_NAME[look]}${no ? ` ${no}` : ''}`;
}

/** «станція "Жуля Верна"» → «Жуля Верна»: на картці швидкісного трамвая слово «станція» стоїть окремо */
export const stationName = (n: string | undefined): string => (n ?? '').replace(/^станці[яи]\s+/i, '').replace(/^["«](.*)["»]$/, '$1').trim() || 'станція';

/** Як назвати зупинку поїздки людині: фунікулер — своїми назвами станцій, швидкісний трамвай — без «станція "…"» */
export function rideStopName(city: CityLeg['city'], step: CityStep, end: 'from' | 'to'): string | null {
  const look = rideLook(step);
  if (look === 'funicular') {
    const way = funicularWay(city, step);
    if (way) return way[end];
  }
  const raw = end === 'from' ? step.fromStop : step.toStop;
  if (look === 'speedTram') return raw ? stationName(raw) : null;
  return raw ?? null;
}
