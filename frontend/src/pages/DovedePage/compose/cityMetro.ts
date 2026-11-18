/**
 * Метро всередині дороги містом (Docs/dovede-roadmap.md, «Місто»). Дорогу до місця словами дає сервер (Google), і
 * метро там — лише крок «SUBWAY» з номером лінії Google. Метро ж у «Доведе» своє (`data/kyiv.ts`: лінії, пересадки,
 * інтервали за порою дня, години роботи, жетон), тож такий крок замінюємо своїм: зі станцій входу й виходу, які
 * назвав Google, рахуємо `metroTrip` і показуємо звичайною карткою метро — так само, як після маршрутки з Малина.
 * Автобуси, трамваї й тролейбуси лишаються від сервера. Чистий модуль.
 */
import { metroTrip } from '../data/kyiv';
import { METRO_STATIONS, type MetroStation } from '../nlu/kyivMetroData';
import type { CityStep, StoryLeg } from './types';

type CityLeg = Extract<StoryLeg, { kind: 'city' }>;

/** Пішки між двома поїздами Google довше за це — уже не пересадка в метро, а окрема дорога */
const TRANSFER_WALK_MAX = 10;

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[«»"“”„'’ʼ`]/g, ' ')
    .replace(/^\s*(станція метро|ст\.\s*м\.|станція|метро|м\.)\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim();

const BY_NAME = new Map<string, MetroStation>();
for (const st of METRO_STATIONS) {
  for (const n of [st.name, ...st.said]) {
    const k = norm(n);
    if (k && !BY_NAME.has(k)) BY_NAME.set(k, st);
  }
}

/** Станція нашого метро за назвою з відповіді Google («Палац "Україна"», «ст. м. Хрещатик»); null — не впізнали */
export function metroStationByName(name: string | null | undefined): MetroStation | null {
  return name ? BY_NAME.get(norm(name)) ?? null : null;
}

const isSubway = (s: CityStep | undefined): boolean => s?.kind === 'transit' && s.mode === 'SUBWAY';

interface Part {
  steps: CityStep[];
  /** метро: станції входу й виходу (наші id) */
  metro?: { from: MetroStation; to: MetroStation };
}

/** Кроки сервера → частини: підряд кілька поїздів метро з короткою пішою між ними — одна поїздка (з пересадкою) */
function partsOf(steps: CityStep[]): Part[] {
  const parts: Part[] = [];
  let rest: CityStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const from = isSubway(s) ? metroStationByName(s.fromStop) : null;
    if (!from) {
      rest.push(s);
      continue;
    }
    let j = i;
    while (
      isSubway(steps[j + 2]) &&
      steps[j + 1].kind === 'walk' &&
      steps[j + 1].minutes <= TRANSFER_WALK_MAX &&
      metroStationByName(steps[j + 2].fromStop)
    )
      j += 2;
    if (isSubway(steps[j + 1]) && metroStationByName(steps[j + 1].fromStop)) j += 1;
    const to = metroStationByName(steps[j].toStop);
    if (!to || to.id === from.id) {
      rest.push(s);
      continue;
    }
    if (rest.length) parts.push({ steps: rest });
    rest = [];
    parts.push({ steps: steps.slice(i, j + 1), metro: { from, to } });
    i = j;
  }
  if (rest.length) parts.push({ steps: rest });
  return parts;
}

const sum = (steps: CityStep[], f: (s: CityStep) => number) => steps.reduce((n, s) => n + f(s), 0);

/**
 * Крок містом з відповіддю сервера → кроки історії, де метро своє: пішки до станції, картка метро, далі містом.
 * `dep` — коли людина вирушає з першої точки (хв від півночі). null — у відповіді немає метро, яке ми впізнали
 * (або воно о цій порі не працює): крок лишається, як був.
 */
export function withOwnMetro(leg: CityLeg, dep: number, date: string): { legs: StoryLeg[]; minutes: number } | null {
  const route = leg.route;
  if (!route || leg.city !== 'Kyiv' || !route.steps.some(isSubway)) return null;
  const parts = partsOf(route.steps);
  if (!parts.some((p) => p.metro)) return null;
  const legs: StoryLeg[] = [];
  let t = dep;
  let fromLabel = leg.fromLabel;
  let converted = false;
  parts.forEach((p, k) => {
    const next = parts[k + 1];
    const trip = p.metro ? metroTrip(p.metro.from.id, p.metro.to.id, { mins: t, date }) : null;
    if (p.metro && trip && !trip.closed) {
      legs.push({ kind: 'metro', segments: trip.segments, transfers: trip.transfers, minutes: trip.minutes, depMins: t, arrMins: t + trip.minutes, headwayMin: trip.headwayMin, priceUah: trip.priceUah, closed: false, mapsUrl: leg.mapsUrl });
      t += trip.minutes;
      fromLabel = `метро «${p.metro.to.name}»`;
      converted = true;
      return;
    }
    const minutes = sum(p.steps, (s) => s.minutes);
    // куди веде ця частина: до входу в наше метро або до кінця дороги
    const toLabel = next?.metro ? `метро «${next.metro.from.name}»` : leg.toLabel;
    if (p.steps.every((s) => s.kind === 'walk')) {
      // картка пішого кроку сама бере назву в лапки: «до «Палац «Україна»»», а не «до «метро «…»»»
      legs.push({ kind: 'walk', meters: sum(p.steps, (s) => s.meters ?? 0), minutes, toLabel: next?.metro ? next.metro.from.name : leg.toLabel, late: false });
    } else {
      legs.push({ ...leg, fromLabel, toLabel, route: { ...route, steps: p.steps, minutes }, depMins: t, arrMins: t + minutes });
    }
    t += minutes;
    fromLabel = toLabel;
  });
  return converted ? { legs, minutes: t - dep } : null;
}
