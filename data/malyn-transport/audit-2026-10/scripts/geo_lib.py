"""Геометрія для фаз виправлення: вісь вулиці з OSM, точка на узбіччі, бік відносно руху, вставка в ланцюжок."""
import math
import os

from common import OSM, dist_m, load, project, xy

_LINES = None


def lines():
    global _LINES
    if _LINES is None:
        _LINES = {}
        for w in load(os.path.join(OSM, 'streets.json'))['elements']:
            g = [(p['lat'], p['lon']) for p in (w.get('geometry') or [])]
            if len(g) >= 2:
                _LINES.setdefault(w['tags']['name'], []).append(g)
    return _LINES


def unxy(x, y):
    from common import LAT0, LON0, R
    return (LAT0 + y / (R * math.pi / 180), LON0 + x / (math.cos(math.radians(LAT0)) * R * math.pi / 180))


def axis_point(lat, lon, street):
    """Найближча точка осі вулиці і вектор напрямку відрізка."""
    best = None
    for g in lines()[street]:
        for i in range(len(g) - 1):
            ax, ay = xy(*g[i]); bx, by = xy(*g[i + 1]); px, py = xy(lat, lon)
            dx, dy = bx - ax, by - ay
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) or 1)))
            cx, cy = ax + t * dx, ay + t * dy
            d = math.hypot(px - cx, py - cy)
            if best is None or d < best[0]:
                best = (d, (cx, cy), (dx, dy))
    return best


def roadside(lat, lon, street, offset=7.0, toward=None):
    """Точка на узбіччі: проекція (lat, lon) на вісь + offset м у бік `toward` (точки) або в бік самої (lat, lon)."""
    d, (cx, cy), _ = axis_point(lat, lon, street)
    tx, ty = xy(*(toward or (lat, lon)))
    vx, vy = tx - cx, ty - cy
    n = math.hypot(vx, vy) or 1
    la, lo = unxy(cx + vx / n * offset, cy + vy / n * offset)
    return round(la, 6), round(lo, 6)


def mirror(lat, lon, street, offset=7.0):
    """Точка через дорогу: по той бік осі на тій самій відстані offset."""
    d, (cx, cy), _ = axis_point(lat, lon, street)
    px, py = xy(lat, lon)
    vx, vy = cx - px, cy - py
    n = math.hypot(vx, vy) or 1
    la, lo = unxy(cx + vx / n * offset, cy + vy / n * offset)
    return round(la, 6), round(lo, 6)


def side(lat, lon, street, frm, to):
    """'right' / 'left' відносно руху frm → to (за найближчим відрізком осі вулиці)."""
    d, (cx, cy), (dx, dy) = axis_point(lat, lon, street)
    fx, fy = xy(*frm); tx, ty = xy(*to)
    if dx * (tx - fx) + dy * (ty - fy) < 0:
        dx, dy = -dx, -dy
    px, py = xy(lat, lon)
    cross = dx * (py - cy) - dy * (px - cx)
    return ('left' if cross > 0 else 'right'), round(d)


def insertion(chain_pts, pt):
    """Найдешевша вставка точки в ланцюжок [(id, lat, lon)]: (додаткова довжина м, індекс вставки, сусіди)."""
    best = None
    for i in range(len(chain_pts) - 1):
        a, b = chain_pts[i], chain_pts[i + 1]
        cost = dist_m(a[1], a[2], *pt) + dist_m(*pt, b[1], b[2]) - dist_m(a[1], a[2], b[1], b[2])
        if best is None or cost < best[0]:
            best = (round(cost), i + 1, a[0], b[0])
    return best
