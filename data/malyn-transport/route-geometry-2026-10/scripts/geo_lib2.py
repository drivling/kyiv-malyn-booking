"""Геометрія ліній на карті: шлях дорогою між сусідніми точками ланцюжка (OSRM, з кешем) і точки повороту
(спрощення Дугласа — Пекера). Знімки бази цієї роботи — у route-geometry-2026-10/."""
import json
import math
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', '..', 'audit-2026-10', 'scripts')))

import common  # noqa: E402

common.AUDIT = os.path.join('data', 'malyn-transport', 'route-geometry-2026-10')

from apply_lib import apply_change, chain, fetch, recalc, route_minutes, set_chains  # noqa: E402,F401
from common import UA, dist_m, xy  # noqa: E402,F401

OSRM = 'https://router.project-osrm.org/route/v1/driving'
CACHE = os.path.join('data', 'malyn-transport', 'route-geometry-2026-10', 'osrm-cache.json')


_CACHE = None


def _cache():
    global _CACHE
    if _CACHE is None:
        _CACHE = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    return _CACHE


def osrm_path(a, b):
    """Шлях дорогою від a до b: [(lat, lng), …] (OSRM, кеш в одному файлі). None — OSRM не знайшов."""
    key = f'{a[0]:.6f},{a[1]:.6f}_{b[0]:.6f},{b[1]:.6f}'
    cache = _cache()
    if key not in cache:
        url = f'{OSRM}/{a[1]:.6f},{a[0]:.6f};{b[1]:.6f},{b[0]:.6f}?overview=full&geometries=geojson'
        # curl, а не urllib: Python з Xcode не домовляється з сервером OSRM про TLS
        for attempt in range(4):
            r = subprocess.run(['curl', '-sS', '-m', '30', '-A', UA, url], capture_output=True, text=True)
            try:
                data = json.loads(r.stdout)
                if data.get('code') == 'Ok' or data.get('routes') is not None:
                    break
            except ValueError:
                pass
            time.sleep(2 + attempt * 2)
        else:
            raise RuntimeError(f'OSRM недоступний: {url}')
        cache[key] = {'routes': [{'distance': x.get('distance'), 'geometry': x['geometry']} for x in (data.get('routes') or [])[:1]]}
        json.dump(cache, open(CACHE, 'w'), separators=(',', ':'))
        time.sleep(0.4)
    routes = cache[key].get('routes') or []
    if not routes:
        return None
    return [(lat, lng) for lng, lat in routes[0]['geometry']['coordinates']]


def seg_dist(p, a, b):
    """Відстань у метрах від p до відрізка ab."""
    px, py = xy(*p); ax, ay = xy(*a); bx, by = xy(*b)
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


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


def path_len(pts):
    return sum(dist_m(*pts[i], *pts[i + 1]) for i in range(len(pts) - 1))


def max_dev(path, a, b):
    """Наскільки пряма a–b відходить від шляху дорогою (м)."""
    return max((seg_dist(p, a, b) for p in path), default=0.0)
