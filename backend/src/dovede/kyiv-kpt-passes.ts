/**
 * «Доведе» · онлайн-рух «Київпастрансу» → проходи контрольних точок (Docs/dovede-learning-roadmap.md, крок 8г).
 *
 * Сирі точки Києва (сотні машин щохвилини) у базу не пишемо: лише **візит** машини біля контрольної точки свого
 * маршруту (≤ 150 м) — коли прийшла (`firstAt`) і коли востаннє була поруч (`lastAt`). Візит закривається, коли
 * машину побачили деінде або не бачили `CLOSE_AFTER_MS`; закриті візити й пишемо. Час у дорозі A → B = прихід до B
 * мінус останній раз біля A. Держномерів тут немає. Чисті функції + невеликий стан у памʼяті процесу.
 */
import { distanceM } from '../korosten-osm';
import type { KptData } from './kyiv-kpt';
import { KYIV_KPT } from './kyiv-kpt-data';
import type { RtVehicle } from '../gtfs-rt';

/** Ближче за стільки — машина «біля точки» */
export const NEAR_POINT_M = 150;
/** Не бачили машину біля точки стільки — візит закрито */
export const CLOSE_AFTER_MS = 10 * 60_000;
/** Точка старша — машина стоїть вимкнена чи стрічка віддає старе, не беремо */
const STALE_MS = 15 * 60_000;

export interface KptPoint {
  name: string;
  lat: number;
  lng: number;
}

/** Контрольні точки кожного маршруту (route_id → унікальні за назвою точки всіх його напрямків) */
export function routePoints(data: KptData = KYIV_KPT): Map<string, KptPoint[]> {
  const out = new Map<string, KptPoint[]>();
  for (const d of data.dirs) {
    const routeId = d.id.split('/')[0];
    const list = out.get(routeId) ?? [];
    for (const [name, lat, lng] of d.points) if (!list.some((p) => p.name === name)) list.push({ name, lat, lng });
    out.set(routeId, list);
  }
  return out;
}

/** Найближча контрольна точка маршруту в межах `NEAR_POINT_M`; null — машина між точками */
export function nearestPoint(points: KptPoint[] | undefined, v: { lat: number; lng: number }): KptPoint | null {
  let best: { p: KptPoint; m: number } | null = null;
  for (const p of points ?? []) {
    const m = distanceM(p, v);
    if (m <= NEAR_POINT_M && (!best || m < best.m)) best = { p, m };
  }
  return best?.p ?? null;
}

export interface KptVisit {
  routeId: string;
  vehicleId: string;
  point: string;
  firstAt: Date;
  lastAt: Date;
}

/**
 * Відкриті візити по машинах. `feed` — одна стрічка; повертає візити, що закрилися (машина пішла від точки, змінила
 * маршрут або давно не з'являлась). `flush` закриває все (при зупинці процесу).
 */
export function createVisitTracker(points: Map<string, KptPoint[]> = routePoints()) {
  const open = new Map<string, KptVisit>();
  return {
    feed(vehicles: RtVehicle[], now: Date): KptVisit[] {
      const closed: KptVisit[] = [];
      const seen = new Set<string>();
      for (const v of vehicles) {
        if (now.getTime() - v.at.getTime() > STALE_MS || v.at.getTime() - now.getTime() > 5 * 60_000) continue;
        seen.add(v.vehicleId);
        const cur = open.get(v.vehicleId);
        const near = nearestPoint(points.get(v.routeId), v);
        if (cur && near && cur.routeId === v.routeId && cur.point === near.name) {
          if (v.at > cur.lastAt) cur.lastAt = v.at;
          continue;
        }
        if (cur) {
          closed.push(cur);
          open.delete(v.vehicleId);
        }
        if (near) open.set(v.vehicleId, { routeId: v.routeId, vehicleId: v.vehicleId, point: near.name, firstAt: v.at, lastAt: v.at });
      }
      for (const [id, visit] of open) {
        if (!seen.has(id) && now.getTime() - visit.lastAt.getTime() > CLOSE_AFTER_MS) {
          closed.push(visit);
          open.delete(id);
        }
      }
      return closed;
    },
    flush(): KptVisit[] {
      const all = [...open.values()];
      open.clear();
      return all;
    },
    openCount: () => open.size,
  };
}

export type VisitTracker = ReturnType<typeof createVisitTracker>;
