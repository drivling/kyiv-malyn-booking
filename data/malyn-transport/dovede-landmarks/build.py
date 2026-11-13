#!/usr/bin/env python3
"""Орієнтири Малина для «Доведе» (Docs/dovede-roadmap.md, фаза 4): магазини, аптеки, установи, підприємства —
місця, які люди називають замість зупинки («до АТБ», «в пенсійний», «до школи 3»). Зі знімка OpenStreetMap
(`osm/places.json`, оновлюється `fetch_osm.py`) і ручних рішень `config.json` будує

  frontend/src/pages/DovedePage/data/malyn-landmarks.json  — назва, як її кажуть, точка
  backend/src/dovede/landmarks.ts                          — id і назви (для промпту Claude)

Запуск з кореня репозиторію:  python3 data/malyn-transport/dovede-landmarks/build.py
Дані © учасники OpenStreetMap, ліцензія ODbL (див. README.md поруч). Мережі не потребує.
"""
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OSM = os.path.join(HERE, 'osm')
OUT_FRONT = os.path.join(ROOT, 'frontend', 'src', 'pages', 'DovedePage', 'data', 'malyn-landmarks.json')
OUT_BACK = os.path.join(ROOT, 'backend', 'src', 'dovede', 'landmarks.ts')

# тег OSM → (рід місця для підпису, чи писати його перед назвою)
KINDS = {
    'shop=supermarket': 'супермаркет',
    'shop=mall': 'торговий центр',
    'shop=department_store': 'магазин',
    'shop=variety_store': 'магазин',
    'shop=doityourself': 'будівельний магазин',
    'shop=hardware': 'господарський магазин',
    'shop=electronics': 'магазин техніки',
    'shop=furniture': 'меблевий магазин',
    'shop=convenience': 'магазин',
    'amenity=marketplace': 'ринок',
    'amenity=pharmacy': 'аптека',
    'amenity=post_office': 'пошта',
    'amenity=hospital': 'лікарня',
    'amenity=clinic': 'медичний заклад',
    'amenity=doctors': 'медичний заклад',
    'amenity=dentist': 'стоматологія',
    'amenity=veterinary': 'ветлікарня',
    'healthcare=laboratory': 'лабораторія',
    'amenity=kindergarten': 'дитячий садок',
    'amenity=school': 'школа',
    'amenity=music_school': 'школа',
    'amenity=college': 'навчальний заклад',
    'amenity=library': 'бібліотека',
    'amenity=driving_school': 'автошкола',
    'amenity=townhall': 'установа',
    'amenity=courthouse': 'установа',
    'amenity=police': 'установа',
    'office=government': 'установа',
    'office=employment_agency': 'установа',
    'amenity=place_of_worship': 'храм',
    'amenity=community_centre': 'заклад культури',
    'amenity=arts_centre': 'заклад культури',
    'tourism=museum': 'музей',
    'leisure=stadium': 'стадіон',
    'leisure=sports_centre': 'спортивний заклад',
    'leisure=fitness_centre': 'спортивний заклад',
    'leisure=park': 'парк',
    'tourism=hotel': 'готель',
    'tourism=hostel': 'готель',
    'amenity=restaurant': 'ресторан',
    'amenity=cafe': 'кафе',
    'amenity=bar': 'бар',
    'amenity=pub': 'бар',
    'amenity=fast_food': 'кафе',
    'amenity=fuel': 'АЗС',
    'landuse=industrial': 'підприємство',
    'landuse=commercial': 'підприємство',
    'historic=monument': 'памʼятка',
    'historic=memorial': 'памʼятка',
}
KIND_KEYS = ('amenity', 'shop', 'office', 'tourism', 'leisure', 'historic', 'healthcare', 'landuse')

# рід, який і так чути в назві, перед назвою не пишемо («аптека „Аптека оптових цін“»)
KIND_IN_NAME = re.compile(
    r'аптек|пошт|лікарн|церкв|костел|храм|бібліотек|ринок|стадіон|парк|готел|hotel|хостел|ресторац|бар\b|bar\b|'
    r'тц\b|центр|музей|суд\b|рада\b|відділ|управлінн|фонд|служб|бюро|архів|реєстр|дпі|завод|фабрик|комбінат|'
    r'лісництв|лісгосп|друкарн|підприємств|цех|дім молитви|зал царства|коледж|ліцей|гімназі|школ|садок|класи|днз|заклад|автошкол|'
    r'будинок|ветеринарн|амбулатор|пункт|кладовищ|відділення|корпус|хлібозавод|рем\b|кар.єр',
    re.I,
)

LEGAL = re.compile(r'^(ват|пат|прат|тов|тзов|пп|кп|ку|фоп|вкф|ок|тц)\s+', re.I)

TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ie', 'ж': 'zh', 'з': 'z', 'и': 'y',
    'і': 'i', 'ї': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's',
    'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '', 'ю': 'iu',
    'я': 'ia', "'": '', '’': '', 'ʼ': '', 'ы': 'y', 'э': 'e', 'ё': 'e', 'ъ': '',
}


def slug(text):
    out = ''.join(TRANSLIT.get(ch, ch) for ch in text.lower())
    out = re.sub(r'[^a-z0-9]+', '-', out).strip('-')
    # довгі офіційні назви — до 40 знаків по межі слова
    while len(out) > 40 and '-' in out:
        out = out.rsplit('-', 1)[0]
    return out


def clean(name):
    """Лапки й дужки геть, пробіли рівно: «ОК "Промінь Плюс"» → «ОК Промінь Плюс»"""
    name = re.sub(r'\([^)]*\)', ' ', name)
    name = re.sub(r'[«»"“”„]', ' ', name)
    return re.sub(r'\s+', ' ', name).strip()


def norm(name):
    return re.sub(r"[^\w]+", ' ', clean(name).lower().replace('ё', 'е')).strip()


def dist_m(a, b):
    lat = math.radians((a[0] + b[0]) / 2)
    dx = (a[1] - b[1]) * 111320 * math.cos(lat)
    dy = (a[0] - b[0]) * 110540
    return math.hypot(dx, dy)


def el_coords(el):
    if 'lat' in el:
        return [el['lat'], el['lon']]
    c = el.get('center')
    return [c['lat'], c['lon']] if c else None


def numbered(name):
    """Як кличуть заклад з номером: «Малинський Ліцей №3» — «ліцей 3», «школа 3» (ліцеї — колишні школи з тим
    самим номером); «ДНЗ №8 Ялинка» — «садок 8», «Ялинка»."""
    m = re.match(r'^Малинський ліцей №\s?(\d+)', name, re.I)
    if m:
        n = m.group(1)
        return [f'ліцей {n}', f'лицей {n}', f'школа {n}', f'школи {n}', f'школу {n}', f'{n} школа', f'{n} школи', f'{n} школу', f'{n} ліцей']
    m = re.match(r'^ДНЗ\s+№?\s?(\d+)\s*(.*)$', name, re.I)
    if m:
        n, rest = m.group(1), m.group(2).strip()
        forms = [f'{w} {n}' for w in ('садок', 'садка', 'садочок', 'садочка', 'садик', 'садика', 'дитсадок', 'дитсадка', 'детсад')]
        return ([rest, f'садок {rest}', f'садка {rest}'] if rest else []) + forms
    return []


def kind_of(tags):
    for k in KIND_KEYS:
        if k in tags and f'{k}={tags[k]}' in KINDS:
            return f'{k}={tags[k]}'
    return None


def main():
    cfg = json.load(open(os.path.join(HERE, 'config.json'), encoding='utf-8'))
    exclude = [re.compile(p, re.I) for p in cfg['exclude']]
    centre = cfg['centre']
    elements = json.load(open(os.path.join(OSM, 'places.json'), encoding='utf-8'))['elements']

    # 1. кандидати: названі місця дозволених родів
    found = []
    for el in sorted(elements, key=lambda e: (e['type'], e['id'])):
        tags = el.get('tags', {})
        raw = tags.get('name')
        tag = kind_of(tags)
        pos = el_coords(el)
        if not raw or not tag or not pos:
            continue
        name = clean(raw)
        if tag.startswith('historic=') and name not in cfg['memorials']:
            continue
        if any(p.search(name) for p in exclude):
            continue
        street = tags.get('addr:street')
        house = tags.get('addr:housenumber')
        found.append({
            'name': name, 'tag': tag, 'kind': KINDS[tag], 'pos': [round(pos[0], 6), round(pos[1], 6)],
            'address': f'{street}, {house}' if street and house else None,
        })

    # 2. одне місце двічі в OSM (точка й будівля, поруч) — лишаємо одне, з адресою
    places = []
    for c in found:
        twin = next((p for p in places if norm(p['name']) == norm(c['name']) and dist_m(p['pos'], c['pos']) <= cfg['sameM']), None)
        if twin:
            if not twin['address'] and c['address']:
                twin['address'] = c['address']
            continue
        places.append(c)

    # 3. назви, якими це місце кличуть: повна, без «ТОВ / ТЦ / ДНЗ», ручні з config.json
    def said(name):
        out = [name]
        short = name
        while LEGAL.match(short):
            short = LEGAL.sub('', short, count=1)
        if short != name and name not in cfg['noShort']:
            out.append(short)
        out += numbered(name)
        for extra in cfg['aliases'].get(name, []):
            out.append(extra)
        seen, res = set(), []
        for n in out:
            if norm(n) and norm(n) not in seen:
                seen.add(norm(n))
                res.append(n)
        return res

    # 4. id: slug назви; однойменні місця в різних кінцях міста — «-2», «-3» (ближчі до центру — першими)
    places.sort(key=lambda p: (norm(p['name']), dist_m(p['pos'], centre), p['pos']))
    used = {}
    out = []
    for p in places:
        base = slug(p['name'])
        if not base:
            continue
        used[base] = used.get(base, 0) + 1
        n = used[base]
        label = p['name'] if KIND_IN_NAME.search(p['name']) else f"{p['kind']} {p['name']}"
        out.append({
            'id': f'lm.{base}' + (f'-{n}' if n > 1 else ''),
            'kind': p['kind'],
            'name': p['name'],
            'label': label,
            'said': said(p['name']),
            'lat': p['pos'][0],
            'lng': p['pos'][1],
            **({'address': p['address']} if p['address'] else {}),
        })
    # скільки ще місць кличуть так само (тоді відповідь чесно каже, яке саме показано)
    by_said = {}
    for lm in out:
        for s in lm['said']:
            by_said.setdefault(norm(s), []).append(lm['id'])
    for lm in out:
        twins = max(len(by_said[norm(s)]) for s in lm['said']) - 1
        if twins:
            lm['twins'] = twins
    out.sort(key=lambda lm: lm['id'])

    missing = [n for n in cfg['aliases'] if not any(lm['name'] == n for lm in out)]
    if missing:
        sys.exit('config.json: aliases для назв, яких немає серед орієнтирів: ' + ', '.join(missing))

    doc = {
        'about': 'Орієнтири Малина для «Доведе»: місця без власної зупинки (магазини, аптеки, установи, підприємства) — '
                 'назва, як її кажуть, точка. Згенеровано data/malyn-transport/dovede-landmarks/build.py з OSM-знімка '
                 '2026-10 і config.json; не редагувати вручну.',
        'license': '© учасники OpenStreetMap, ODbL 1.0 — https://www.openstreetmap.org/copyright',
        'landmarks': out,
    }
    with open(OUT_FRONT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')

    lines = [
        '/**',
        ' * Орієнтири Малина для промпту «Доведе» (id, підпис, як ще кажуть). Згенеровано',
        ' * data/malyn-transport/dovede-landmarks/build.py з OSM-знімка — не редагувати вручну. Координати —',
        ' * лише у фронтенд-копії (frontend/src/pages/DovedePage/data/malyn-landmarks.json); тест звіряє списки id.',
        ' * Дані © учасники OpenStreetMap, ODbL.',
        ' */',
        'export interface LandmarkName {',
        '  id: string;',
        '  label: string;',
        '  said: string[];',
        '}',
        '',
        'export const MALYN_LANDMARKS: LandmarkName[] = [',
    ]
    for lm in out:
        lines.append('  ' + json.dumps({'id': lm['id'], 'label': lm['label'], 'said': lm['said'][1:]}, ensure_ascii=False) + ',')
    lines += ['];', '']
    with open(OUT_BACK, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    kinds = {}
    for lm in out:
        kinds[lm['kind']] = kinds.get(lm['kind'], 0) + 1
    print(len(out), 'орієнтирів;', json.dumps(dict(sorted(kinds.items(), key=lambda x: -x[1])), ensure_ascii=False))


if __name__ == '__main__':
    main()
