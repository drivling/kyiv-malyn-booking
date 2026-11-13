#!/usr/bin/env python3
"""Вулиці Малина для «Доведе» (Docs/dovede-roadmap.md, фаза 4): з OSM-знімка жовтневого аудиту
(`../audit-2026-10/osm/streets.json`, `addresses.json`) будує

  frontend/src/pages/DovedePage/data/malyn-streets.json  — вулиця, колишні назви, точка, будинки з координатами
  backend/src/dovede/streets.ts                          — лише id і назви (для промпту Claude)

Запуск з кореня репозиторію:  python3 data/malyn-transport/dovede-streets/build.py
Дані © учасники OpenStreetMap, ліцензія ODbL (див. README.md поруч). Мережі не потребує.
"""
import json
import math
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OSM = os.path.join(ROOT, 'data', 'malyn-transport', 'audit-2026-10', 'osm')
OUT_FRONT = os.path.join(ROOT, 'frontend', 'src', 'pages', 'DovedePage', 'data', 'malyn-streets.json')
OUT_BACK = os.path.join(ROOT, 'backend', 'src', 'dovede', 'streets.ts')

# слово-тип → коротка форма для підпису
KINDS = {
    'вулиця': 'вул.',
    'провулок': 'пров.',
    'площа': 'пл.',
    'проспект': 'просп.',
    'бульвар': 'бульв.',
    'узвіз': 'узвіз',
    'шосе': 'шосе',
    'тупик': 'тупик',
    'проїзд': 'проїзд',
    'набережна': 'наб.',
    'майдан': 'майдан',
    'дорога': 'дорога',
}

TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ie', 'ж': 'zh', 'з': 'z', 'и': 'y',
    'і': 'i', 'ї': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's',
    'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '', 'ю': 'iu',
    'я': 'ia', "'": '', '’': '', 'ʼ': '', 'ы': 'y', 'э': 'e', 'ё': 'e', 'ъ': '',
}


def slug(text):
    out = ''.join(TRANSLIT.get(ch, ch) for ch in text.lower())
    return re.sub(r'[^a-z0-9]+', '-', out).strip('-')


def split_name(name):
    """«вулиця Михайла Грушевського» / «Пиріжківська вулиця» → ('вулиця', 'Михайла Грушевського')"""
    words = name.split()
    for i, w in enumerate(words):
        if w.lower() in KINDS:
            core = ' '.join(words[:i] + words[i + 1:]).strip()
            return w.lower(), core
    return 'вулиця', name.strip()


def dist_m(a, b):
    lat = math.radians((a[0] + b[0]) / 2)
    dx = (a[1] - b[1]) * 111320 * math.cos(lat)
    dy = (a[0] - b[0]) * 110540
    return math.hypot(dx, dy)


# Привʼязка будинку без `addr:street` до вулиці за геометрією: найближча вулиця має бути близько й помітно ближче
# за другу — інакше будинок кутовий або у дворі, і вгадувати вулицю не можна. На будинках із відомою вулицею ці
# пороги дають ≈ 95% збігів (див. houseStats.check); помилки — багатоквартирні будинки у дворах, адресовані до
# головної вулиці. Тому такі будинки йдуть в окремий список `near` і у відповіді позначаються як неточні. Навіть
# помилково привʼязаний будинок стоїть не далі 45 м від названої вулиці — це не гірше за «середину вулиці».
MAX_DIST_M = 45.0      # далі від осі вулиці — це вже не «будинок на цій вулиці»
MIN_GAP_M = 30.0       # наскільки друга вулиця має бути далі за першу…
MIN_RATIO = 2.5        # …і у скільки разів
SAME_HOUSE_M = 60.0    # два обʼєкти з тим самим номером ближче за це — один будинок (корпус, прибудова)


def to_xy(lat, lon, lat0):
    return (lon * 111320.0 * math.cos(math.radians(lat0)), lat * 110540.0)


def seg_dist(p, a, b):
    """Відстань від точки p до відрізка ab (метри, площина)."""
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


class StreetIndex:
    """Сітка 150 м з відрізками вулиць — щоб не міряти кожен будинок до кожного відрізка."""

    CELL = 150.0

    def __init__(self, ways, lat0):
        self.lat0 = lat0
        self.grid = {}
        for name, pts in ways:
            xy = [to_xy(la, lo, lat0) for la, lo in pts]
            for a, b in zip(xy, xy[1:]):
                x0, x1 = sorted((a[0], b[0]))
                y0, y1 = sorted((a[1], b[1]))
                for cx in range(int(x0 // self.CELL) - 1, int(x1 // self.CELL) + 2):
                    for cy in range(int(y0 // self.CELL) - 1, int(y1 // self.CELL) + 2):
                        self.grid.setdefault((cx, cy), []).append((name, a, b))

    def nearest(self, lat, lon):
        """[(відстань, назва вулиці)] за зростанням — по одній найкращій відстані на вулицю."""
        p = to_xy(lat, lon, self.lat0)
        best = {}
        for name, a, b in self.grid.get((int(p[0] // self.CELL), int(p[1] // self.CELL)), []):
            d = seg_dist(p, a, b)
            if d < best.get(name, 1e9):
                best[name] = d
        return sorted((d, n) for n, d in best.items())


def street_by_geometry(index, lat, lon):
    near = index.nearest(lat, lon)
    if not near or near[0][0] > MAX_DIST_M:
        return None
    if len(near) > 1:
        d1, d2 = near[0][0], near[1][0]
        if d2 - d1 < MIN_GAP_M or d2 < d1 * MIN_RATIO:
            return None
    return near[0][1]


def el_coords(el):
    lat = el.get('lat') or (el.get('center') or {}).get('lat')
    lon = el.get('lon') or (el.get('center') or {}).get('lon')
    return (lat, lon) if lat is not None and lon is not None else None


HOUSE_RE = re.compile(r'^\d+[а-яіїєa-z]?(/\d+)?$')


def house_number(tags):
    num = re.sub(r'\s+', '', tags.get('addr:housenumber') or '').lower()
    return num if HOUSE_RE.match(num) else None


def main():
    streets_raw = json.load(open(os.path.join(OSM, 'streets.json'), encoding='utf-8'))['elements']
    addresses = json.load(open(os.path.join(OSM, 'addresses.json'), encoding='utf-8'))['elements']

    by_name = {}
    for el in streets_raw:
        name = (el.get('tags') or {}).get('name')
        geom = el.get('geometry') or []
        if not name or len(geom) < 2:
            continue
        rec = by_name.setdefault(name, {'points': [], 'old': set(), 'length': 0.0})
        pts = [(p['lat'], p['lon']) for p in geom]
        rec['points'].extend(pts)
        rec['length'] += sum(dist_m(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        for old in ((el['tags'].get('old_name') or '').split(';')):
            old = old.strip()
            if old:
                rec['old'].add(old)

    ways = []
    for el in streets_raw:
        name = (el.get('tags') or {}).get('name')
        geom = el.get('geometry') or []
        if name and len(geom) >= 2:
            ways.append((name, [(p['lat'], p['lon']) for p in geom]))
    lat0 = sum(p[0] for _, pts in ways for p in pts) / sum(len(pts) for _, pts in ways)
    index = StreetIndex(ways, lat0)

    # 1) будинки, де вулицю вписано в OSM, — як є
    houses = {}
    tagged = 0
    for el in addresses:
        tags = el.get('tags') or {}
        street, num, xy = tags.get('addr:street'), house_number(tags), el_coords(el)
        if not street or not num or not xy:
            continue
        if num not in houses.setdefault(street, {}):
            houses[street][num] = [round(xy[0], 6), round(xy[1], 6)]
            tagged += 1

    # перевірка способу на будинках із відомою вулицею: скільки з привʼязаних привʼязано правильно
    check_ok = check_wrong = check_skipped = 0
    for el in addresses:
        tags = el.get('tags') or {}
        street, xy = tags.get('addr:street'), el_coords(el)
        if not street or not xy or street not in by_name:
            continue
        guess = street_by_geometry(index, xy[0], xy[1])
        if guess is None:
            check_skipped += 1
        elif guess == street:
            check_ok += 1
        else:
            check_wrong += 1

    # 2) будинки без вулиці — за геометрією; той самий номер на вулиці двічі в різних місцях — не беремо жодного
    found = {}
    no_street = unsure = 0
    for el in addresses:
        tags = el.get('tags') or {}
        num, xy = house_number(tags), el_coords(el)
        if tags.get('addr:street') or not num or not xy:
            continue
        no_street += 1
        street = street_by_geometry(index, xy[0], xy[1])
        if street is None:
            unsure += 1
            continue
        found.setdefault((street, num), []).append(xy)
    inferred = conflicts = 0
    near_houses = {}
    for (street, num), pts in sorted(found.items()):
        if num in houses.get(street, {}):
            continue
        spread = max(dist_m(a, b) for a in pts for b in pts)
        if spread > SAME_HOUSE_M:
            conflicts += 1
            continue
        lat = sum(p[0] for p in pts) / len(pts)
        lon = sum(p[1] for p in pts) / len(pts)
        near_houses.setdefault(street, {})[num] = [round(lat, 6), round(lon, 6)]
        inferred += 1
    stats = {
        'tagged': tagged, 'inferred': inferred, 'noStreet': no_street, 'unsure': unsure, 'conflicts': conflicts,
        'check': {'ok': check_ok, 'wrong': check_wrong, 'skipped': check_skipped},
    }

    out = []
    seen = set()
    for name in sorted(by_name):
        rec = by_name[name]
        kind, core = split_name(name)
        if not core:
            continue
        sid = 'street.' + slug(core) + ('' if kind == 'вулиця' else '-' + slug(kind))
        if sid in seen:
            print('duplicate id, skipped:', sid, name, file=sys.stderr)
            continue
        seen.add(sid)
        pts = rec['points']
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        # точка вулиці — її вершина, найближча до центру мас (центр мас кривої вулиці може лежати поза нею)
        mid = min(pts, key=lambda p: dist_m(p, (cx, cy)))
        old = sorted({split_name(o)[1] for o in rec['old']} - {core})
        hs = houses.get(name, {})
        ns = near_houses.get(name, {})
        by_num = lambda d: {k: d[k] for k in sorted(d, key=lambda x: (int(re.match(r'\d+', x).group()), x))}
        out.append({
            'id': sid,
            'kind': kind,
            'name': core,
            'label': f"{KINDS[kind]} {core}",
            'old': old,
            'lat': round(mid[0], 6),
            'lng': round(mid[1], 6),
            'lengthM': int(round(rec['length'] / 10.0) * 10),
            'houses': by_num(hs),
            'near': by_num(ns),
        })

    doc = {
        'about': 'Вулиці Малина для «Доведе»: назва, колишні назви, точка на вулиці, будинки з координатами '
                 '(houses — вулицю вписано в OSM; near — привʼязано до вулиці за геометрією, може бути неточно). '
                 'Згенеровано data/malyn-transport/dovede-streets/build.py з OSM-знімка 2026-10; не редагувати вручну.',
        'license': '© учасники OpenStreetMap, ODbL 1.0 — https://www.openstreetmap.org/copyright',
        'houseStats': stats,
        'streets': out,
    }
    os.makedirs(os.path.dirname(OUT_FRONT), exist_ok=True)
    with open(OUT_FRONT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')

    lines = [
        '/**',
        ' * Вулиці Малина для промпту «Доведе» (id, тип, назва, колишні назви). Згенеровано',
        ' * data/malyn-transport/dovede-streets/build.py з OSM-знімка — не редагувати вручну. Координати й будинки —',
        ' * лише у фронтенд-копії (frontend/src/pages/DovedePage/data/malyn-streets.json); тест звіряє списки id.',
        ' * Дані © учасники OpenStreetMap, ODbL.',
        ' */',
        'export interface StreetName {',
        '  id: string;',
        '  kind: string;',
        '  name: string;',
        '  old: string[];',
        '}',
        '',
        'export const MALYN_STREETS: StreetName[] = [',
    ]
    for s in out:
        lines.append('  ' + json.dumps({'id': s['id'], 'kind': s['kind'], 'name': s['name'], 'old': s['old']}, ensure_ascii=False) + ',')
    lines += ['];', '']
    with open(OUT_BACK, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    with_houses = sum(1 for s in out if s['houses'] or s['near'])
    print('houses:', json.dumps(stats, ensure_ascii=False))
    print(f"{len(out)} streets, {with_houses} with houses, {sum(len(s['houses']) for s in out)} tagged + "
          f"{sum(len(s['near']) for s in out)} by geometry, "
          f"{sum(1 for s in out if s['old'])} with old names; front {os.path.getsize(OUT_FRONT)} bytes")


if __name__ == '__main__':
    main()
