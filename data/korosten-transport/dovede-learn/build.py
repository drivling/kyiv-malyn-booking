"""Коростень · стартові місця навчання «Доведе» (Docs/dovede-learning-roadmap.md, крок 4).

    python3 build.py            # з наявного знімка places.json → backend/src/dovede/korosten-learn-places.ts
    python3 build.py --fetch    # спершу оновити знімок з OpenStreetMap (Nominatim, 1 запит на секунду)

Що в списку: названі місця з OpenStreetMap у межах міста — лікарні, школи, садки, магазини, установи, — яких
сторінка «Доведе» не знає сама. Не беремо (аналіз 2026-11-23, Docs/dovede-learning-roadmap.md): зупинки датасету,
вулиці й будинки (`korosten-streets.json`) і орієнтири (`korosten-landmarks.json`) — їх сторінка веде своїм
планувальником, а відповідь Google про них ніхто не побачить. Тест фронтенду проганяє кожен рядок справжнім розбором
сторінки; те, що він усе ж знає, — у `exclude` config.json. Список — лише «що спитати»: дорогу до кожного місця дає
сервер і зберігає в базі. Згенерований файл руками не правити; виключення й ручні додатки — у config.json.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
SNAPSHOT = os.path.join(HERE, 'places.json')
CONFIG = os.path.join(HERE, 'config.json')
LANDMARKS = os.path.join(ROOT, 'frontend', 'src', 'pages', 'DovedePage', 'data', 'korosten-landmarks.json')
DATASET = os.path.join(ROOT, 'data', 'korosten-transport', 'dataset', 'korosten-dataset.json')
OUT = os.path.join(ROOT, 'backend', 'src', 'dovede', 'korosten-learn-places.ts')
UA = 'malin.kiev.ua admin script'
# межі міста: захід, північ, схід, південь
VIEWBOX = '28.55,51.00,28.75,50.90'
# що питати в Nominatim; місце беремо лише з перелічених класів OSM
QUERIES = ['лікарня', 'поліклініка', 'амбулаторія', 'школа', 'ліцей', 'гімназія', 'коледж', 'дитячий садок', 'супермаркет',
           'торговий центр', 'ринок', 'пошта', 'парк', 'стадіон', 'музей', 'готель', 'бібліотека', 'будинок культури',
           'кінотеатр', 'міська рада', 'суд', 'поліція', 'церква', 'завод', 'автостанція', 'басейн']
CLASSES = {'amenity', 'shop', 'leisure', 'tourism', 'office', 'building', 'man_made', 'landuse', 'craft', 'historic'}
SKIP_TYPES = {'bus_stop', 'bus_station', 'parking', 'atm', 'bench', 'fuel', 'residential', 'apartments', 'house', 'yes', 'garages', 'toilets'}


def fetch():
    found = {}
    for term in QUERIES:
        url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
            {'q': f'{term}, Коростень', 'format': 'json', 'limit': 40, 'accept-language': 'uk', 'viewbox': VIEWBOX, 'bounded': 1})
        r = subprocess.run(['curl', '-sS', '-m', '40', '-A', UA, url], capture_output=True, text=True)
        time.sleep(1.2)
        try:
            rows = json.loads(r.stdout)
        except ValueError:
            raise SystemExit(f'Nominatim не відповів на «{term}»: {r.stdout[:200]}')
        for x in rows:
            name = ' '.join(str(x.get('name') or '').split())
            if not name or x.get('class') not in CLASSES or x.get('type') in SKIP_TYPES:
                continue
            key = f"{x.get('osm_type')}/{x.get('osm_id')}"
            found[key] = {'osm': key, 'name': name, 'class': x['class'], 'type': x['type']}
        print(f'{term}: {len(rows)}', file=sys.stderr)
    snapshot = {
        '_license': '© учасники OpenStreetMap, ODbL 1.0 (https://www.openstreetmap.org/copyright); пошук — Nominatim',
        'fetchedAt': time.strftime('%Y-%m-%d', time.gmtime()),
        'viewbox': VIEWBOX,
        'places': sorted(found.values(), key=lambda p: (p['name'].lower(), p['osm'])),
    }
    json.dump(snapshot, open(SNAPSHOT, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    open(SNAPSHOT, 'a', encoding='utf8').write('\n')


def words(name):
    """Значущі слова назви — як `korostenNameWords` у korostenPlaces.ts"""
    text = name.lower().replace('ё', 'е')
    out = []
    for w in re.findall(r"[^\W\d_][\w']*|\d+", text):
        w = re.sub(r'ский$', 'ський', w)
        if w.isdigit() or (len(w) > 1 and w not in NAME_SKIP):
            out.append(w)
    return out


NAME_SKIP = {'вул', 'вулиця', 'пров', 'провулок', 'мн', 'кафе', 'зупинка', 'на', 'вимогу', 'ім'}


def known():
    """Що сторінка знає сама: назви орієнтирів і зупинки датасету (слова зупинки — усі в назві місця)"""
    marks = set()
    for lm in json.load(open(LANDMARKS, encoding='utf8'))['landmarks']:
        for n in [lm['name'], lm.get('label', ''), *lm.get('said', [])]:
            if n:
                marks.add(' '.join(words(n)))
    stops = []
    for st in json.load(open(DATASET, encoding='utf8'))['stops']:
        if st['name'].strip().startswith('№'):
            continue
        w = words(re.sub(r'\([^)]*\)', ' ', st['name']))
        if w:
            stops.append(set(w))
    return marks, stops


def build():
    config = json.load(open(CONFIG, encoding='utf8'))
    skip = {s.lower() for s in config.get('exclude', [])}
    names = []
    seen = set()
    marks, stops = known()
    for name in [*config.get('add', []), *(p['name'] for p in json.load(open(SNAPSHOT, encoding='utf8'))['places'])]:
        key = name.lower()
        if key in seen or key in skip or len(name) < 4 or len(name) > 70:
            continue
        w = words(name)
        if ' '.join(w) in marks or any(st <= set(w) for st in stops):
            continue
        seen.add(key)
        names.append(name)
    body = ''.join(f'  {json.dumps(n, ensure_ascii=False)},\n' for n in names)
    text = (
        '/**\n'
        ' * Коростень · стартові місця навчання «Доведе». ЗГЕНЕРОВАНО: data/korosten-transport/dovede-learn/build.py —\n'
        ' * руками не правити (виключення й додатки — у config.json поруч зі скриптом). Назви місць — © учасники\n'
        ' * OpenStreetMap (ODbL). Лише те, чого сторінка не знає сама: без зупинок, вулиць і орієнтирів.\n'
        ' */\n'
        f'export const KOROSTEN_LEARN_PLACES: readonly string[] = [\n{body}];\n'
    )
    open(OUT, 'w', encoding='utf8').write(text)
    print(f'{len(names)} місць → {os.path.relpath(OUT, ROOT)}')


if '--fetch' in sys.argv:
    fetch()
build()
