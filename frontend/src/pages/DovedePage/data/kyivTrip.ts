/**
 * Дорога Києвом між двома точками (Docs/dovede-roadmap.md, «Міська електричка Києва»): метро, міська електричка
 * або їх поєднання — метро до станції кільця чи від неї. Метро їздить часто, але час у нього приблизний;
 * електричка — раз на пів години чи годину, зате за розкладом. Обираємо те, що раніше привозить ('from') або
 * дозволяє пізніше вийти ('until'); електричка мусить вигравати помітно, бо на неї можна спізнитись.
 */
import { ringStationOf } from '../nlu/kyivRing';
import { RING_STATIONS, type RingStation } from '../nlu/kyivRingData';
import { KYIV_POINTS, metroTrip, type MetroTrip } from './kyiv';
import { RING_SERVICE, lastRingRide, laterRingDepartures, nextRingRide, type RingRide } from './kyivRing';

export type KyivPart =
  | { kind: 'metro'; trip: MetroTrip; depMins: number; arrMins: number }
  | {
      kind: 'ring';
      ride: RingRide;
      /** пішки від метро до платформи перед посадкою / від платформи до метро після виходу, хв */
      walkBeforeMin: number;
      walkAfterMin: number;
      /** наступні відправлення тієї ж пари, хв */
      later: number[];
    };

export interface KyivWay {
  parts: KyivPart[];
  /** коли людина вирушає з першої точки й коли вона на останній */
  depMins: number;
  arrMins: number;
  ring: boolean;
}

/** best — найкраща з усіх; metro — без електрички; ring — лише з електричкою; direct — лише один рейс електрички без метро */
export type KyivWayMode = 'best' | 'metro' | 'ring' | 'direct';

/** Станції кільця біля метро — там пересідають між метро й електричкою */
const HUBS = RING_STATIONS.filter((st) => st.metro);
/** На стільки хвилин дорога з електричкою має бути кращою за саме метро, щоб її обрали */
const RING_MARGIN = 5;
/** Кожна додаткова пересадка «коштує» стільки хвилин при виборі */
const PART_PENALTY = 4;
/** Електричкою треба приїхати не впритул до того, куди людина поспішає (посадка на маршрутку чи попутку) */
const RING_ARRIVE_BUFFER = 5;

const walkAt = (st: RingStation, pointId: string) => (st.id === pointId ? 0 : st.walkMin ?? 0);
const onMetro = (id: string) => Boolean(KYIV_POINTS[id]?.metro);

function ringPart(ride: RingRide, date: string, walkBeforeMin: number, walkAfterMin: number): KyivPart {
  return { kind: 'ring', ride, walkBeforeMin, walkAfterMin, later: laterRingDepartures(ride, date) };
}

/** Метро о цій порі: null — не їздить або між точками його немає */
function metroPart(fromId: string, toId: string, depMins: number, date: string): Extract<KyivPart, { kind: 'metro' }> | null {
  const trip = metroTrip(fromId, toId, { mins: depMins, date });
  return trip && !trip.closed ? { kind: 'metro', trip, depMins, arrMins: depMins + trip.minutes } : null;
}

/** Те саме, але метро має привезти до `arrMins` */
function metroPartUntil(fromId: string, toId: string, arrMins: number, date: string): Extract<KyivPart, { kind: 'metro' }> | null {
  const rough = metroTrip(fromId, toId);
  if (!rough) return null;
  const trip = metroTrip(fromId, toId, { mins: arrMins - rough.minutes, date });
  return trip && !trip.closed ? { kind: 'metro', trip, depMins: arrMins - trip.minutes, arrMins } : null;
}

function waysFrom(fromId: string, toId: string, t: number, date: string, slackMin: number): KyivWay[] {
  const out: KyivWay[] = [];
  const B = RING_SERVICE.boardBufferMin + slackMin;
  const fr = ringStationOf(fromId);
  const tr = ringStationOf(toId);
  const metro = onMetro(fromId) && onMetro(toId) ? metroPart(fromId, toId, t, date) : null;
  if (metro) out.push({ parts: [metro], depMins: t, arrMins: metro.arrMins, ring: false });
  if (fr && tr && fr !== tr) {
    const ride = nextRingRide(fr.id, tr.id, date, t + walkAt(fr, fromId) + B);
    if (ride) out.push({ parts: [ringPart(ride, date, walkAt(fr, fromId), walkAt(tr, toId))], depMins: t, arrMins: ride.arrMins + walkAt(tr, toId), ring: true });
  }
  // метро до станції кільця, далі електричка
  if (tr && onMetro(fromId)) {
    for (const hub of HUBS) {
      if (hub === tr || hub === fr || hub.metro === fromId) continue;
      const m = metroPart(fromId, hub.metro!, t, date);
      const ride = m ? nextRingRide(hub.id, tr.id, date, m.arrMins + hub.walkMin! + B) : null;
      if (m && ride) out.push({ parts: [m, ringPart(ride, date, hub.walkMin!, walkAt(tr, toId))], depMins: t, arrMins: ride.arrMins + walkAt(tr, toId), ring: true });
    }
  }
  // електричка до станції кільця біля метро, далі метро
  if (fr && onMetro(toId)) {
    for (const hub of HUBS) {
      if (hub === fr || hub === tr || hub.metro === toId) continue;
      const ride = nextRingRide(fr.id, hub.id, date, t + walkAt(fr, fromId) + B);
      const m = ride ? metroPart(hub.metro!, toId, ride.arrMins + hub.walkMin!, date) : null;
      if (ride && m) out.push({ parts: [ringPart(ride, date, walkAt(fr, fromId), hub.walkMin!), m], depMins: t, arrMins: m.arrMins, ring: true });
    }
  }
  return out;
}

function waysUntil(fromId: string, toId: string, d: number, date: string): KyivWay[] {
  const out: KyivWay[] = [];
  const B = RING_SERVICE.boardBufferMin;
  const fr = ringStationOf(fromId);
  const tr = ringStationOf(toId);
  const metro = onMetro(fromId) && onMetro(toId) ? metroPartUntil(fromId, toId, d, date) : null;
  if (metro) out.push({ parts: [metro], depMins: metro.depMins, arrMins: d, ring: false });
  if (fr && tr && fr !== tr) {
    const ride = lastRingRide(fr.id, tr.id, date, d - walkAt(tr, toId) - RING_ARRIVE_BUFFER);
    if (ride) out.push({ parts: [ringPart(ride, date, walkAt(fr, fromId), walkAt(tr, toId))], depMins: ride.depMins - walkAt(fr, fromId) - B, arrMins: ride.arrMins + walkAt(tr, toId), ring: true });
  }
  if (tr && onMetro(fromId)) {
    for (const hub of HUBS) {
      if (hub === tr || hub === fr || hub.metro === fromId) continue;
      const ride = lastRingRide(hub.id, tr.id, date, d - walkAt(tr, toId) - RING_ARRIVE_BUFFER);
      const m = ride ? metroPartUntil(fromId, hub.metro!, ride.depMins - hub.walkMin! - B, date) : null;
      if (ride && m) out.push({ parts: [m, ringPart(ride, date, hub.walkMin!, walkAt(tr, toId))], depMins: m.depMins, arrMins: ride.arrMins + walkAt(tr, toId), ring: true });
    }
  }
  if (fr && onMetro(toId)) {
    for (const hub of HUBS) {
      if (hub === fr || hub === tr || hub.metro === toId) continue;
      const m = metroPartUntil(hub.metro!, toId, d, date);
      const ride = m ? lastRingRide(fr.id, hub.id, date, m.depMins - hub.walkMin!) : null;
      if (ride && m) out.push({ parts: [ringPart(ride, date, walkAt(fr, fromId), hub.walkMin!), m], depMins: ride.depMins - walkAt(fr, fromId) - B, arrMins: d, ring: true });
    }
  }
  return out;
}

/**
 * Найкраща дорога Києвом. `anchor: 'from'` — людина в першій точці о `mins`; `'until'` — має бути в другій до
 * `mins`. `mode` — див. `KyivWayMode`. null — ні метро, ні електричка між
 * цими точками о цій порі не возять. `slackMin` — запас перед електричкою, коли людина приїде в першу точку
 * приблизно (маршрутка, попутка): на метро можна сісти в наступний поїзд, на електричку — ні.
 */
export function kyivWay(fromId: string, toId: string, anchor: 'from' | 'until', mins: number, date: string, mode: KyivWayMode = 'best', slackMin = 0): KyivWay | null {
  if (fromId === toId) return null;
  const all = (anchor === 'from' ? waysFrom(fromId, toId, mins, date, slackMin) : waysUntil(fromId, toId, mins, date)).filter((w) =>
    mode === 'metro' ? !w.ring : mode === 'ring' ? w.ring : mode === 'direct' ? w.ring && w.parts.length === 1 : true,
  );
  const cost = (w: KyivWay) => (anchor === 'from' ? w.arrMins - mins : mins - w.depMins) + (w.parts.length - 1) * PART_PENALTY + (w.ring && mode === 'best' ? RING_MARGIN : 0);
  return all.sort((a, b) => cost(a) - cost(b) || a.parts.length - b.parts.length)[0] ?? null;
}
