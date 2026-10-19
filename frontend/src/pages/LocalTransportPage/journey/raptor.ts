/**
 * Один прохід RAPTOR (Delling, Pajor, Werneck — «Round-Based Public Transit Routing»), той самий принцип, що в
 * MOTIS/nigiri: раунд k = найраніше прибуття на кожну зупинку, коли поїздка складається з k рейсів. Після кожного раунду
 * з зупинок, куди щойно приїхали рейсом, робимо один піший перехід (пішки-пішки не ланцюжимо).
 *
 * Мітка = справжній час прибуття. Посадка після рейсу вимагає буфер minTransferMin; після пішого переходу буфер уже
 * всередині тривалості переходу (Footpath.minutes ≥ minTransferMin); на старті буфера немає.
 */
import type { Leg, Journey, Place, Timetable, TransitLeg, WalkLeg } from './types';

/** Стартова або кінцева зупинка з піший відступом від/до точки (для зупинки-кінця: minutes = 0, meters = 0) */
export interface Offset {
  stop: number;
  minutes: number;
  meters: number;
}

const SOURCE = 0;
const VEHICLE = 1;
const FOOT = 2;

type Parent =
  | { kind: 'source'; offset: Offset }
  | { kind: 'foot'; from: number; depMins: number; meters: number }
  | { kind: 'transit'; pattern: number; trip: number; boardPos: number; alightPos: number };

export interface SearchParams {
  tt: Timetable;
  sources: Offset[];
  egress: Offset[];
  originPlace: Place;
  destPlace: Place;
  /** Коли людина вирушає з початкового місця (кандидат відправлення) */
  departMins: number;
  /** Пішки від стартової зупинки до сусідніх (лише коли початок — зупинка, а не точка) */
  footFromSources: boolean;
  /** Найдовше очікування на пересадці, хв; Infinity — без ліміту */
  maxWaitMin: number;
}

/** Індекс першого рейсу патерна, що відходить із позиції pos не раніше ready; -1, якщо немає */
function earliestTrip(tt: Timetable, pattern: number, pos: number, ready: number): number {
  const trips = tt.patterns[pattern].trips;
  let lo = 0;
  let hi = trips.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (trips[mid].times[pos] < ready) lo = mid + 1;
    else hi = mid;
  }
  return lo < trips.length ? lo : -1;
}

/** Усі поїздки за один проміжок «людина вирушає не раніше departMins»: по одній на кількість рейсів, що покращує прибуття */
export function searchAtDeparture(p: SearchParams): Journey[] {
  const { tt, sources, egress } = p;
  const n = tt.stops.length;
  const rounds = tt.options.maxTransfers + 1;
  const buffer = tt.options.minTransferMin;

  const tau: Float64Array[] = [];
  const kind: Uint8Array[] = [];
  const parent: Array<Array<Parent | undefined>> = [];
  const vtau: Float64Array[] = [];
  const vparent: Array<Array<Parent | undefined>> = [];
  for (let k = 0; k <= rounds; k++) {
    tau.push(new Float64Array(n).fill(Infinity));
    vtau.push(new Float64Array(n).fill(Infinity));
    kind.push(new Uint8Array(n));
    parent.push(new Array<Parent | undefined>(n).fill(undefined));
    vparent.push(new Array<Parent | undefined>(n).fill(undefined));
  }
  const best = new Float64Array(n).fill(Infinity);

  const relaxFootpaths = (k: number, from: number[]) => {
    // база — значення рейсових міток на початок релаксації, щоб піший перехід не ланцюжився
    const bases = from.map((s) => [s, vtau[k][s]] as const);
    const marked: number[] = [];
    for (const [s, base] of bases) {
      for (const fp of tt.footpaths[s]) {
        const arr = base + fp.minutes;
        if (arr < best[fp.to]) {
          best[fp.to] = arr;
          tau[k][fp.to] = arr;
          kind[k][fp.to] = FOOT;
          parent[k][fp.to] = { kind: 'foot', from: s, depMins: base, meters: fp.meters };
          marked.push(fp.to);
        }
      }
    }
    return marked;
  };

  // Раунд 0: старт
  let marked: number[] = [];
  for (const offset of sources) {
    const arr = p.departMins + offset.minutes;
    if (arr < best[offset.stop]) {
      best[offset.stop] = arr;
      tau[0][offset.stop] = arr;
      vtau[0][offset.stop] = arr;
      kind[0][offset.stop] = SOURCE;
      const src: Parent = { kind: 'source', offset };
      parent[0][offset.stop] = src;
      vparent[0][offset.stop] = src;
      marked.push(offset.stop);
    }
  }
  if (p.footFromSources) marked = [...marked, ...relaxFootpaths(0, [...marked])];

  const journeys: Journey[] = [];
  let bestTotal = Infinity;

  for (let k = 1; k <= rounds && marked.length > 0; k++) {
    const queue = new Map<number, number>();
    for (const s of marked) {
      for (const { pattern, pos } of tt.patternsAtStop[s]) {
        const cur = queue.get(pattern);
        if (cur === undefined || pos < cur) queue.set(pattern, pos);
      }
    }

    const vehicleImproved = new Set<number>();
    for (const [pi, startPos] of queue) {
      const pat = tt.patterns[pi];
      let ti = -1;
      let boardPos = -1;
      for (let pos = startPos; pos < pat.stops.length; pos++) {
        const s = pat.stops[pos];
        if (ti >= 0) {
          const arr = pat.trips[ti].times[pos];
          if (arr < best[s]) {
            best[s] = arr;
            tau[k][s] = arr;
            vtau[k][s] = arr;
            kind[k][s] = VEHICLE;
            const par: Parent = { kind: 'transit', pattern: pi, trip: ti, boardPos, alightPos: pos };
            parent[k][s] = par;
            vparent[k][s] = par;
            vehicleImproved.add(s);
          }
        }
        const prev = tau[k - 1][s];
        if (prev !== Infinity && pos < pat.stops.length - 1) {
          const ready = prev + (kind[k - 1][s] === VEHICLE ? buffer : 0);
          if (ti < 0 || ready <= pat.trips[ti].times[pos]) {
            const cand = earliestTrip(tt, pi, pos, ready);
            // Ліміт очікування діє на пересадках (з другого раунду), не на першій посадці
            if (cand >= 0 && (ti < 0 || cand < ti) && (k < 2 || pat.trips[cand].times[pos] - ready <= p.maxWaitMin)) {
              ti = cand;
              boardPos = pos;
            }
          }
        }
      }
    }

    // Піший перехід — лише з зупинок, куди приїхали рейсом у цьому раунді; нові мітки (рейс або пішки) — у чергу наступного
    const fromVehicle = [...vehicleImproved];
    const footMarked = relaxFootpaths(k, fromVehicle);
    marked = [...new Set([...fromVehicle, ...footMarked])];

    // Кінець: найкраще прибуття в точку призначення на цьому раунді; береться, лише якщо краще за раунди з меншою кількістю рейсів
    let bestHere = Infinity;
    let bestEgress: Offset | null = null;
    for (const e of egress) {
      const t = tau[k][e.stop];
      if (t === Infinity) continue;
      const total = t + e.minutes;
      if (total < bestHere) {
        bestHere = total;
        bestEgress = e;
      }
    }
    if (bestEgress && bestHere < bestTotal) {
      bestTotal = bestHere;
      journeys.push(reconstruct(p, { tau, parent, vparent }, k, bestEgress));
    }
  }
  return journeys;
}

interface Labels {
  tau: Float64Array[];
  parent: Array<Array<Parent | undefined>>;
  vparent: Array<Array<Parent | undefined>>;
}

function reconstruct(p: SearchParams, labels: Labels, k: number, egress: Offset): Journey {
  const { tt } = p;
  const legsRev: Leg[] = [];
  const stopPlace = (idx: number): Place => ({ stopId: tt.stops[idx].id });

  if (egress.meters > 0) {
    const dep = labels.tau[k][egress.stop];
    legsRev.push({
      kind: 'walk',
      from: stopPlace(egress.stop),
      to: p.destPlace,
      depMins: dep,
      arrMins: dep + egress.minutes,
      meters: egress.meters,
    });
  }

  let cur = egress.stop;
  let round = k;
  let par = labels.parent[round][cur];
  while (par) {
    if (par.kind === 'transit') {
      const pat = tt.patterns[par.pattern];
      const trip = pat.trips[par.trip];
      const leg: TransitLeg = {
        kind: 'transit',
        routeId: pat.routeId,
        tripId: trip.tripId,
        direction: pat.direction,
        variantId: pat.variantId,
        boardStopId: tt.stops[pat.stops[par.boardPos]].id,
        alightStopId: tt.stops[pat.stops[par.alightPos]].id,
        depMins: trip.times[par.boardPos],
        arrMins: trip.times[par.alightPos],
        stopIds: pat.stops.slice(par.boardPos, par.alightPos + 1).map((i) => tt.stops[i].id),
        stopTimes: trip.times.slice(par.boardPos, par.alightPos + 1),
        patternIndex: par.pattern,
        tripIndex: par.trip,
        boardPos: par.boardPos,
        alightPos: par.alightPos,
      };
      legsRev.push(leg);
      cur = pat.stops[par.boardPos];
      round -= 1;
      par = labels.parent[round][cur];
    } else if (par.kind === 'foot') {
      legsRev.push({
        kind: 'walk',
        from: stopPlace(par.from),
        to: stopPlace(cur),
        depMins: par.depMins,
        arrMins: labels.tau[round][cur],
        meters: par.meters,
      });
      cur = par.from;
      par = labels.vparent[round][cur];
    } else {
      if (par.offset.meters > 0) {
        const arr = labels.tau[0][cur];
        legsRev.push({
          kind: 'walk',
          from: p.originPlace,
          to: stopPlace(cur),
          depMins: arr - par.offset.minutes,
          arrMins: arr,
          meters: par.offset.meters,
        });
      }
      break;
    }
  }
  return finalizeJourney(legsRev.reverse());
}

/** Піший початок зсуваємо якнайпізніше (очікувати зручніше вдома, ніж на зупинці), сусідні піші відрізки зливаємо */
function finalizeJourney(legs: Leg[]): Journey {
  const firstTransit = legs.findIndex((l) => l.kind === 'transit');
  let t = (legs[firstTransit] as TransitLeg).depMins;
  for (let i = firstTransit - 1; i >= 0; i--) {
    const w = legs[i] as WalkLeg;
    const dur = w.arrMins - w.depMins;
    w.arrMins = t;
    w.depMins = t - dur;
    t = w.depMins;
  }

  const merged: Leg[] = [];
  for (const leg of legs) {
    const last = merged[merged.length - 1];
    if (leg.kind === 'walk' && last?.kind === 'walk') {
      merged[merged.length - 1] = {
        kind: 'walk',
        from: last.from,
        to: leg.to,
        depMins: last.depMins,
        arrMins: leg.arrMins,
        meters: last.meters + leg.meters,
      };
    } else {
      merged.push(leg);
    }
  }

  let walkMeters = 0;
  let waitMins = 0;
  let transitLegs = 0;
  merged.forEach((leg, i) => {
    if (leg.kind === 'walk') walkMeters += leg.meters;
    else transitLegs++;
    if (i > 0) waitMins += Math.max(0, leg.depMins - merged[i - 1].arrMins);
  });
  return {
    legs: merged,
    departMins: merged[0].depMins,
    arriveMins: merged[merged.length - 1].arrMins,
    transfers: transitLegs - 1,
    walkMeters,
    waitMins,
  };
}
