import { hiddenTransportRouteIds, type TransportDataset } from '@/api/transportDataset';
import { routeColor } from '@/pages/LocalTransportPage/routeColors';
import { SCHEME_ROUTES } from '@/pages/LocalTransportPage/scheme/malyn-scheme-routes';
import type { SchemeNodeKind } from '@/pages/LocalTransportPage/scheme/malyn-scheme-nodes';
import { schemeNodeForStop } from '@/pages/LocalTransportPage/schemeStops';

/**
 * Модель наклейки на фізичну зупинку: які лінії відправляються з неї і в який бік.
 *
 * Датасет часто описує обидва боки дороги однією зупинкою (`з-д «Прожектор»` обслуговує №5 і №11
 * в обидва напрямки, а «Меркурій» навпроти виключено), тож бік визначається напрямком руху:
 * кут дотичної до маршруту в точці зупинки (попередня → наступна вершина ланцюжка). Лінії з
 * кутами в межах 90° — один бік; адмін може перекинути будь-яку лінію вручну.
 */

export type StickerDir = 'there' | 'back';

export type StickerNode = { stopId: string; name: string; kind: SchemeNodeKind | 'stop' };

export type StickerLine = {
  routeId: string;
  dir: StickerDir;
  /** Ключ лінії в UI розподілу по боках */
  key: string;
  /** Колір лінії зі схеми; null — маршрут поза схемою */
  color: string | null;
  /** Кінцева напрямку: назва вузла схеми, якщо кінцева — вузол, інакше назва зупинки */
  destination: string;
  /** Вузли схеми далі за маршрутом (без зупинки наклейки й кінцевої), до трьох */
  via: StickerNode[];
  /** Напрямок руху в точці зупинки, градуси (схід = 0°, північ = 90°) */
  bearing: number;
};

const ROUTE_RANK: ReadonlyMap<string, number> = new Map(SCHEME_ROUTES.map((r, i) => [r.id, i]));

/** Порядок ліній як у легенді схеми, далі — числовий */
export function compareStickerLines(a: StickerLine, b: StickerLine): number {
  const ra = ROUTE_RANK.get(a.routeId) ?? 1000 + (parseInt(a.routeId, 10) || 0);
  const rb = ROUTE_RANK.get(b.routeId) ?? 1000 + (parseInt(b.routeId, 10) || 0);
  if (ra !== rb) return ra - rb;
  if (a.routeId !== b.routeId) return a.routeId.localeCompare(b.routeId);
  return a.dir === b.dir ? 0 : a.dir === 'there' ? -1 : 1;
}

/** Прямі лапки з датасету → «ялинки», як на схемі: `з-д "Прожектор"` → `з-д «Прожектор»` */
export function prettyStopName(name: string): string {
  return name
    .trim()
    .replace(/"([^"]*)"/g, '«$1»')
    .replace(/\s+/g, ' ');
}

/** directionId рейсу → напрямок ланцюжка (як у табло: '1' — туди, '0' — назад) */
function tripDir(directionId: string | undefined): StickerDir | null {
  if (directionId === '1') return 'there';
  if (directionId === '0') return 'back';
  return null;
}

function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return (Math.atan2(b.lat - a.lat, (b.lng - a.lng) * k) * 180) / Math.PI;
}

/** Найменша різниця кутів, 0…180 */
export function angleDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

function nodeRef(stopId: string, stopNames: ReadonlyMap<string, string>): StickerNode {
  const node = schemeNodeForStop(stopId);
  if (node) return { stopId: node.id, name: node.name, kind: node.kind };
  return { stopId, name: prettyStopName(stopNames.get(stopId) || stopId), kind: 'stop' };
}

/**
 * Лінії, що відправляються з зупинки: маршрут проходить через неї в цьому напрямку (order > 0,
 * не «лише для карти»), вона не кінцева напрямку, і хоча б один рейс напрямку її обслуговує
 * (з урахуванням startStopId/endStopId скорочених рейсів — як на табло, рейс не «відправляється»
 * зі своєї кінцевої). Ненадійні маршрути приховано, як на сайті.
 */
export function stickerLines(dataset: TransportDataset, stopId: string): StickerLine[] {
  const hidden = hiddenTransportRouteIds(dataset);
  const coords = new Map(dataset.stops.map((s) => [s.id, s] as const));
  const stopNames = new Map(dataset.stops.map((s) => [s.id, s.name] as const));
  const here = coords.get(stopId);
  if (!here) return [];
  const thisNode = schemeNodeForStop(stopId);

  const out: StickerLine[] = [];
  for (const route of dataset.routes) {
    if (hidden.has(route.id)) continue;
    const rs = dataset.routeStops.filter((x) => x.routeId === route.id);
    if (!rs.some((x) => x.stopId === stopId && !x.mapOnly)) continue;
    for (const dir of ['there', 'back'] as const) {
      const orderOf = (x: (typeof rs)[number]) => (dir === 'there' ? x.orderThere : x.orderBack) ?? -1;
      const chain = rs.filter((x) => orderOf(x) > 0 && coords.has(x.stopId)).sort((a, b) => orderOf(a) - orderOf(b));
      const real = chain.filter((x) => !x.mapOnly).map((x) => x.stopId);
      const at = real.indexOf(stopId);
      if (at < 0 || at === real.length - 1) continue;

      const served = dataset.trips.some((t) => {
        if (t.routeId !== route.id || tripDir(t.directionId) !== dir) return false;
        const start = t.startStopId ? real.indexOf(t.startStopId) : 0;
        const end = t.endStopId ? real.indexOf(t.endStopId) : real.length - 1;
        return (start < 0 ? 0 : start) <= at && at < (end < 0 ? real.length - 1 : end);
      });
      if (!served) continue;

      // дотична: сусідні вершини ланцюжка разом із «лише для карти» — вони точніше йдуть уздовж вулиці
      const ci = chain.findIndex((x) => x.stopId === stopId && !x.mapOnly);
      const prev = coords.get(chain[Math.max(0, ci - 1)].stopId)!;
      const next = coords.get(chain[Math.min(chain.length - 1, ci + 1)].stopId)!;
      const bearing = bearingDeg(prev === next ? here : prev, next);

      const dest = nodeRef(real[real.length - 1], stopNames);
      const via: StickerNode[] = [];
      for (const id of real.slice(at + 1, -1)) {
        const node = schemeNodeForStop(id);
        if (!node || node.id === thisNode?.id || node.id === dest.stopId) continue;
        if (via.some((v) => v.stopId === node.id)) continue;
        via.push({ stopId: node.id, name: node.name, kind: node.kind });
      }

      out.push({
        routeId: route.id,
        dir,
        key: `${route.id}:${dir}`,
        color: routeColor(route.id),
        destination: dest.name,
        via: via.slice(0, 3),
        bearing,
      });
    }
  }
  return out.sort(compareStickerLines);
}

/**
 * Розподіл ліній по двох боках дороги за напрямком руху: перша лінія задає бік А, наступні
 * приєднуються до боку, чий середній кут ближчий (поріг 90°). Порожній бік Б — зупинка
 * одностороння (кінцева, одностороння вулиця) або пара зупинок через дорогу вже розділена в даних.
 */
export function splitSides(lines: StickerLine[]): { a: string[]; b: string[] } {
  const sides: { keys: string[]; sx: number; sy: number }[] = [];
  for (const l of lines) {
    const rad = (l.bearing * Math.PI) / 180;
    let best = -1;
    let bestDiff = 181;
    sides.forEach((s, i) => {
      const d = angleDiff((Math.atan2(s.sy, s.sx) * 180) / Math.PI, l.bearing);
      if (d < bestDiff) {
        best = i;
        bestDiff = d;
      }
    });
    if (best < 0 || (bestDiff >= 90 && sides.length < 2)) {
      sides.push({ keys: [l.key], sx: Math.cos(rad), sy: Math.sin(rad) });
    } else {
      const s = sides[best];
      s.keys.push(l.key);
      s.sx += Math.cos(rad);
      s.sy += Math.sin(rad);
    }
  }
  return { a: sides[0]?.keys ?? [], b: sides[1]?.keys ?? [] };
}

/**
 * Підпис напрямку боку: перший пересадковий вузол схеми за зупинкою, якщо він спільний для всіх
 * ліній боку (для «Прожектора» — «Малинівський круг» в один бік і «Центр · Базарна площа» в
 * інший). Лінії розходяться одразу (вокзал, кінцеві) — підпису немає: він би збрехав.
 */
export function sideHeading(lines: StickerLine[]): string {
  const firsts = new Set(lines.map((l) => l.via.find((v) => v.kind === 'hub')?.name ?? l.via[0]?.name ?? l.destination));
  return lines.length > 0 && firsts.size === 1 ? [...firsts][0] : '';
}

/** Насиченість кольору (max − min каналів RGB, 0…255): «яскравість» лінії для назви зупинки */
function chroma(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return -1;
  const ch = m.slice(1).map((x) => parseInt(x, 16));
  return Math.max(...ch) - Math.min(...ch);
}

/**
 * Найяскравіший колір серед ліній наклейки — ним фарбується назва зупинки (для «Прожектора» —
 * синя №5, а не бірюзова №11). Рівні — перша в порядку легенди; ліній із кольором немає — null.
 */
export function brightestLineColor(lines: Pick<StickerLine, 'color'>[]): string | null {
  let best: string | null = null;
  let bestChroma = -1;
  for (const l of lines) {
    const c = l.color ? chroma(l.color) : -1;
    if (c > bestChroma) {
      best = l.color;
      bestChroma = c;
    }
  }
  return best;
}
