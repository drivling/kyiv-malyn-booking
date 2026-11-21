"""Коростень · лінії маршрутів дорогами (Docs/dovede-learning-roadmap.md, крок 5).

Спільне для скриптів цієї теки: читання датасету, ланцюжки (основні напрямки й варіанти), шлях дорогою OSRM з кешем,
геометрія (відстані, спрощення Дугласа — Пекера). Той самий підхід, що в Малина
(data/malyn-transport/route-geometry-2026-10/scripts/geo_lib2.py), але без залежності від його тек."""
import json
import math
import os
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
CACHE = os.path.join(ROOT, 'osrm-cache.json')
OSRM = 'https://router.project-osrm.org/route/v1/driving'
UA = 'malin.kiev.ua route geometry (admin script)'
LAT0 = 50.95

_CACHE = None


def xy(lat, lng):
    """Плоскі метри навколо Коростеня (для відстаней до відрізків)."""
    return (math.radians(lng) * 6371000 * math.cos(math.radians(LAT0)), math.radians(lat) * 6371000)


def dist_m(a, b):
    ax, ay = xy(*a)
    bx, by = xy(*b)
    return math.hypot(ax - bx, ay - by)


def seg_dist(p, a, b):
    """Відстань у метрах від p до відрізка ab."""
    px, py = xy(*p)
    ax, ay = xy(*a)
    bx, by = xy(*b)
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def line_dist(p, line):
    """Відстань від p до ламаної."""
    return min((seg_dist(p, a, b) for a, b in zip(line, line[1:])), default=float('inf')) if len(line) > 1 else dist_m(p, line[0])


def path_len(pts):
    return sum(dist_m(a, b) for a, b in zip(pts, pts[1:]))


def douglas_peucker(pts, eps):
    """Індекси точок, що лишаються (перша й остання — завжди)."""
    keep = {0, len(pts) - 1}
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, k = 0.0, None
        for m in range(i + 1, j):
            d = seg_dist(pts[m], pts[i], pts[j])
            if d > best:
                best, k = d, m
        if k is not None and best > eps:
            keep.add(k)
            stack += [(i, k), (k, j)]
    return sorted(keep)


def _cache():
    global _CACHE
    if _CACHE is None:
        _CACHE = json.load(open(CACHE, encoding='utf8')) if os.path.exists(CACHE) else {}
    return _CACHE


def _pack(route, data):
    return {
        'm': route['distance'],
        'path': [[round(lat, 6), round(lng, 6)] for lng, lat in route['geometry']['coordinates']],
        'snap': [round(w.get('distance', 0), 1) for w in data.get('waypoints', [])],
    }


def osrm_all(points, straight=True, alternatives=False):
    """Шляхи дорогою через points [(lat, lng), …] по порядку: [{'path': [(lat, lng)…], 'm': довжина, 'snap': [м від
    кожної точки до дороги]}…] — перший найкоротший, далі запасні (лише з alternatives і двома точками). Порожньо —
    OSRM шляху не знайшов. `straight` — у проміжній точці не розвертатись. Відповіді — у кеші (osrm-cache.json)."""
    coords = ';'.join(f'{lng:.6f},{lat:.6f}' for lat, lng in points)
    key = coords + ('' if straight else '|turn') + ('|alt' if alternatives else '')
    cache = _cache()
    if key not in cache:
        url = (f'{OSRM}/{coords}?overview=full&geometries=geojson&continue_straight={"true" if straight else "false"}'
               + ('&alternatives=3' if alternatives else ''))
        data = None
        for attempt in range(5):
            r = subprocess.run(['curl', '-sS', '-m', '40', '-A', UA, url], capture_output=True, text=True)
            try:
                data = json.loads(r.stdout)
                if data.get('code') in ('Ok', 'NoRoute', 'NoSegment'):
                    break
            except ValueError:
                pass
            data = None
            time.sleep(3 + attempt * 4)
        if data is None:
            raise RuntimeError(f'OSRM недоступний: {url}')
        cache[key] = [_pack(r, data) for r in data.get('routes') or []]
        json.dump(cache, open(CACHE, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
        time.sleep(1.1)
    hit = cache[key]
    hit = [hit] if isinstance(hit, dict) else (hit or [])
    return [{'m': h['m'], 'path': [tuple(p) for p in h['path']], 'snap': h['snap']} for h in hit]


def osrm(points, straight=True):
    """Найкоротший шлях дорогою через points; None — немає."""
    found = osrm_all(points, straight)
    return found[0] if found else None


def load(path):
    return json.load(open(path, encoding='utf8'))


def chains(ds):
    """Усі ланцюжки датасету: [(routeId, назва, [{'stopId', 'mapOnly'}…])] — «туди», «назад» і варіанти."""
    out = []
    for r in ds['routes']:
        rows = [x for x in ds['routeStops'] if x['routeId'] == r['id']]
        for key, label in (('orderThere', 'туди'), ('orderBack', 'назад')):
            ch = sorted((x for x in rows if x.get(key, -1) >= 0), key=lambda x: x[key])
            if ch:
                out.append((r['id'], label, [{'stopId': x['stopId'], 'mapOnly': bool(x.get('mapOnly'))} for x in ch]))
        for v in r.get('variants') or []:
            out.append((r['id'], v['id'], [{'stopId': s['stopId'], 'mapOnly': bool(s.get('mapOnly'))} for s in v['stops']]))
    return out


def spans(chain):
    """Ланцюжок → відрізки між справжніми зупинками: [(від, до, [технічні точки між ними])]."""
    out, cur = [], None
    for s in chain:
        if s['mapOnly']:
            if cur is not None:
                cur[1].append(s['stopId'])
            continue
        if cur is not None:
            out.append((cur[0], s['stopId'], cur[1]))
        cur = [s['stopId'], []]
    return out
