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

    houses = {}
    for el in addresses:
        tags = el.get('tags') or {}
        street, num = tags.get('addr:street'), tags.get('addr:housenumber')
        if not street or not num:
            continue
        lat = el.get('lat') or (el.get('center') or {}).get('lat')
        lon = el.get('lon') or (el.get('center') or {}).get('lon')
        if lat is None or lon is None:
            continue
        num = re.sub(r'\s+', '', num).lower()
        if not re.match(r'^\d+[а-яіїєa-z]?(/\d+)?$', num):
            continue
        houses.setdefault(street, {}).setdefault(num, [round(lat, 6), round(lon, 6)])

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
        out.append({
            'id': sid,
            'kind': kind,
            'name': core,
            'label': f"{KINDS[kind]} {core}",
            'old': old,
            'lat': round(mid[0], 6),
            'lng': round(mid[1], 6),
            'lengthM': int(round(rec['length'] / 10.0) * 10),
            'houses': {k: hs[k] for k in sorted(hs, key=lambda x: (int(re.match(r'\d+', x).group()), x))},
        })

    doc = {
        'about': 'Вулиці Малина для «Доведе»: назва, колишні назви, точка на вулиці, будинки з координатами. '
                 'Згенеровано data/malyn-transport/dovede-streets/build.py з OSM-знімка 2026-10; не редагувати вручну.',
        'license': '© учасники OpenStreetMap, ODbL 1.0 — https://www.openstreetmap.org/copyright',
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

    with_houses = sum(1 for s in out if s['houses'])
    print(f"{len(out)} streets, {with_houses} with houses, {sum(len(s['houses']) for s in out)} houses, "
          f"{sum(1 for s in out if s['old'])} with old names; front {os.path.getsize(OUT_FRONT)} bytes")


if __name__ == '__main__':
    main()
