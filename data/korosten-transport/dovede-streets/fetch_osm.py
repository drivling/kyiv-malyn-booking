#!/usr/bin/env python3
"""Знімок OpenStreetMap для вулиць Коростеня («Доведе», Docs/dovede-learning-roadmap.md, крок 7а).

Overpass з робочого середовища недоступний, тому місто береться плитками з офіційного API OpenStreetMap
(`/api/0.6/map`, не більше 50 000 вузлів на запит — завелика плитка ділиться на чотири) і обрізається межею міста
(Nominatim, `polygon_geojson`). Виходять два файли того самого вигляду, що в знімка Малина
(`data/malyn-transport/audit-2026-10/osm/`):

  osm/streets.json    — дороги з назвою: теги `name`, `old_name`, `highway` і геометрія
  osm/addresses.json  — обʼєкти з `addr:housenumber`: вузол — координати, лінія чи звʼязок — центр

Запуск з кореня репозиторію (потрібна мережа; ввічливо: пауза між запитами, свій User-Agent):
  python3 data/korosten-transport/dovede-streets/fetch_osm.py
Дані © учасники OpenStreetMap, ліцензія ODbL 1.0.
"""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'osm')
# ті самі межі, що в стартовому списку навчання (data/korosten-transport/dovede-learn/build.py)
BBOX = (28.55, 50.90, 28.75, 51.00)  # захід, південь, схід, північ
TILE = 0.05
API = 'https://api.openstreetmap.org/api/0.6/map.json'
NOMINATIM = 'https://nominatim.openstreetmap.org/search'
UA = 'transit-streets-snapshot/1.0 (city street index; manual run)'
PAUSE_S = 1.5
LICENSE = '© учасники OpenStreetMap, ODbL 1.0 — https://www.openstreetmap.org/copyright'


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def tile(w, s, e, n, depth=0):
    """Елементи плитки; завелика (HTTP 400 — понад 50 000 вузлів) ділиться на чотири."""
    time.sleep(PAUSE_S)
    try:
        doc = get(f'{API}?bbox={w:.5f},{s:.5f},{e:.5f},{n:.5f}')
        print(f"  {'  ' * depth}{w:.3f},{s:.3f} … {e:.3f},{n:.3f}: {len(doc['elements'])} елементів", file=sys.stderr)
        return doc['elements']
    except urllib.error.HTTPError as err:
        if err.code != 400 or depth >= 4:
            raise
    mx, my = (w + e) / 2, (s + n) / 2
    out = []
    for box in ((w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n)):
        out.extend(tile(*box, depth + 1))
    return out


def city_rings():
    """Зовнішні кільця межі міста: [[(lat, lon), …], …]"""
    q = urllib.parse.urlencode({'q': 'Коростень, Житомирська область', 'format': 'jsonv2', 'polygon_geojson': 1, 'limit': 5, 'accept-language': 'uk'})
    for hit in get(f'{NOMINATIM}?{q}'):
        g = hit.get('geojson') or {}
        if hit.get('osm_type') == 'relation' and g.get('type') in ('Polygon', 'MultiPolygon'):
            polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
            return [[(lat, lon) for lon, lat in poly[0]] for poly in polys]
    raise SystemExit('межу Коростеня не знайдено')


def inside(pt, rings):
    lat, lon = pt
    hit = False
    for ring in rings:
        j = len(ring) - 1
        for i in range(len(ring)):
            (la1, lo1), (la2, lo2) = ring[i], ring[j]
            if (la1 > lat) != (la2 > lat) and lon < (lo2 - lo1) * (lat - la1) / (la2 - la1) + lo1:
                hit = not hit
            j = i
    return hit


def main():
    rings = city_rings()
    nodes, ways, rels = {}, {}, {}
    w0, s0, e0, n0 = BBOX
    x = w0
    while x < e0 - 1e-9:
        y = s0
        while y < n0 - 1e-9:
            for el in tile(x, y, min(x + TILE, e0), min(y + TILE, n0)):
                {'node': nodes, 'way': ways, 'relation': rels}[el['type']][el['id']] = el
            y += TILE
        x += TILE

    def way_points(way):
        return [(nodes[r]['lat'], nodes[r]['lon']) for r in way.get('nodes', []) if r in nodes]

    def centre(points):
        return {'lat': round(sum(p[0] for p in points) / len(points), 7), 'lon': round(sum(p[1] for p in points) / len(points), 7)}

    streets = []
    for wid in sorted(ways):
        way = ways[wid]
        tags = way.get('tags') or {}
        pts = way_points(way)
        if not tags.get('highway') or not tags.get('name') or len(pts) < 2:
            continue
        # дорога міста — хоча б третина вершин у межі (траса, що лише торкається міста, не вулиця)
        if sum(1 for p in pts if inside(p, rings)) * 3 < len(pts):
            continue
        keep = {k: tags[k] for k in ('highway', 'name', 'old_name') if tags.get(k)}
        streets.append({'type': 'way', 'id': wid, 'geometry': [{'lat': la, 'lon': lo} for la, lo in pts], 'tags': keep})

    addresses = []

    def address(kind, el, pt):
        tags = el.get('tags') or {}
        if not tags.get('addr:housenumber') or not pt or not inside((pt['lat'], pt['lon']), rings):
            return
        keep = {k: tags[k] for k in ('addr:housenumber', 'addr:street') if tags.get(k)}
        rec = {'type': kind, 'id': el['id'], 'tags': keep}
        rec.update({'lat': pt['lat'], 'lon': pt['lon']} if kind == 'node' else {'center': pt})
        addresses.append(rec)

    for nid in sorted(nodes):
        address('node', nodes[nid], {'lat': nodes[nid]['lat'], 'lon': nodes[nid]['lon']})
    for wid in sorted(ways):
        pts = way_points(ways[wid])
        address('way', ways[wid], centre(pts) if pts else None)
    for rid in sorted(rels):
        pts = [p for m in rels[rid].get('members', []) if m['type'] == 'way' and m['ref'] in ways for p in way_points(ways[m['ref']])]
        address('relation', rels[rid], centre(pts) if pts else None)

    os.makedirs(OUT, exist_ok=True)
    stamp = datetime.date.today().isoformat()
    for name, elements in (('streets', streets), ('addresses', addresses)):
        doc = {'_license': LICENSE, '_source': 'api.openstreetmap.org/api/0.6/map, межа міста — Nominatim', 'fetchedAt': stamp, 'elements': elements}
        with open(os.path.join(OUT, f'{name}.json'), 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
            f.write('\n')
        print(f'{name}: {len(elements)}', file=sys.stderr)


if __name__ == '__main__':
    main()
