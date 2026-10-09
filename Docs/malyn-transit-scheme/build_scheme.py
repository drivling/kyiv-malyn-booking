#!/usr/bin/env python3
"""
Схема міських маршрутів Малина у стилі метро (октолінійна, не в масштабі).

Геометрія (вузли, коридори, смуги, вода) задана вручну нижче; статистика для легенди
(кількість рейсів, перший/останній) береться з /transport/dataset.

Виходи:
  --out-dir DIR      index.html (сторінка зі світлою/темною темою) + malyn-transit-scheme.svg
  --site-dir DIR     malyn-scheme.svg (лише карта, CSS-змінні, data-атрибути для інтерактиву)
                     + malyn-scheme-routes.ts (легенда для React-сторінки /transport/scheme)
  --poster-dir DIR   malyn-transit-scheme-poster.svg (та сама схема + QR-код у правому
                     верхньому куті; шрифт вбудовується, якщо задано --fonts-dir)

  python3 build_scheme.py --dataset dataset.json --out-dir . \
      --site-dir ../../frontend/src/pages/LocalTransportPage/scheme \
      --poster-dir ../../frontend/public/transport/scheme --qr-url https://malin.kiev.ua/transport/scheme
"""
import argparse, base64, json, math, os, sys, urllib.request
from collections import defaultdict

API = 'https://kyiv-malyn-booking-production.up.railway.app/transport/dataset'
S = 10      # відстань між смугами (центр-центр), px
W = 7       # товщина лінії, px
HUB_R = 26  # радіус пересадкового вузла
TERM_R = 9  # радіус кінцевої
QR_URL_DEFAULT = 'https://malin.kiev.ua/transport/scheme'

# ---------------------------------------------------------------- маршрути
ROUTE_ORDER = ['2', '3', '5', '7', '8', '9', '10', '11', '12']
# Маршрути, намальовані за старою схемою на вокзалі, але без заповненого розкладу в базі
UNCONFIRMED = {'10'}
COLORS = {  # світла тема / темна тема
    '2':  ('#D7263D', '#FF5F73'),
    '3':  ('#1B9E4B', '#3FCB70'),
    '5':  ('#1F6FD6', '#64A6FF'),
    '7':  ('#F08A1C', '#FFAD4D'),
    '8':  ('#7E3FC2', '#B388F0'),
    '9':  ('#E3368C', '#FF74B8'),
    '10': ('#C99700', '#F2C94C'),
    '11': ('#0E9AA7', '#3BC9D6'),
    '12': ('#8A5A2B', '#C9915A'),
}
LEGEND = {  # кінцеві та «через» — коротко, для легенди
    '2':  ('Паперова фабрика', 'Шевченка, 119', 'Приходька · Мазепи · Центр · Шевченка · Лікарня'),
    '3':  ('Лісотехнікум', 'Залізничний вокзал', 'Лікарня · Центр · Грушевського · Малинівський круг · Огієнка (БАМ)'),
    '5':  ('Шевченка, 119', 'Залізничний вокзал', 'Лікарня · Центр · з-д «Прожектор» · Малинівський круг · Огієнка'),
    '7':  ('Лікарня', 'Залізничний вокзал', 'Центр · С. Бандери · ПТЛ · Городище (14 ОМБ) · тимчасова схема'),
    '8':  ('Чорновола, 53', 'Залізничний вокзал', 'Барміна · Мазепи · Базар · С. Бандери · ПТЛ · вул. Миру · тимчасова схема'),
    '9':  ('Центр (ТЦ «Промінь»)', 'вул. Олекси Тихого', 'Царське село · Малинівський круг · Малинівка · Юрівка · окремі рейси — Вокзал, Лікарня'),
    '10': ('Лікарня', 'Залізничний вокзал', 'Автостанція · Укр. Повстанців · Центр · Грушевського · Малинівський круг · Огієнка'),
    '11': ('Паперова фабрика', 'Залізничний вокзал', 'Приходька · Мазепи · Центр · з-д «Прожектор» · Малинівський круг · Огієнка'),
    '12': ('Лікарня', 'Залізничний вокзал', 'Центр · Грушевського · Малинівський круг · Огієнка (БАМ)'),
}

# ---------------------------------------------------------------- геометрія
N = {
    'LIS': (110, 400), 'LIK': (280, 400), 'SH119': (200, 480),
    'CEN': (560, 400), 'MAZ': (560, 500), 'P1': (520, 540), 'PF': (340, 540),
    'BAR': (560, 540), 'CH53': (620, 600),
    'GB': (680, 520), 'B2': (760, 600), 'PTL': (980, 600), 'GOR': (1100, 600), 'C7': (1180, 520),
    'VOK': (1180, 400), 'OT': (1180, 340), 'YUR': (1060, 220), 'MAL': (980, 220), 'MK': (900, 300),
    'F1': (620, 340), 'F2': (660, 300), 'L1': (820, 340), 'L2': (860, 300), 'N1': (1080, 300),
    'A0': (280, 360), 'A1': (320, 320), 'A2': (480, 320),
}
# коридор: точки (у канонічному напрямку) + зсув кожного маршруту в смугах
# (+ = візуально ліворуч від напрямку руху, у координатах екрана)
C = {
    'LIS':   (['LIS', 'LIK'],                 {'3': 0}),
    'SH':    (['SH119', 'LIK'],               {'5': 0.5, '2': -0.5}),
    'TRUNK': (['LIK', 'CEN'],                 {'3': 2, '12': 1, '5': 0, '7': -1, '2': -2}),
    'NE1':   (['CEN', 'F1'],                  {'3': 2, '12': 1, '10': 0, '5': -1, '11': -2}),
    'NE2':   (['F1', 'F2', 'L2'],             {'3': 2, '12': 1, '10': 0}),
    'LOW':   (['F1', 'L1', 'L2'],             {'5': -1, '11': -2}),
    'NE3':   (['L2', 'MK'],                   {'3': 2, '12': 1, '10': 0, '5': -1, '11': -2}),
    'EAST':  (['MK', 'N1', 'VOK'],            {'3': 2, '12': 1, '10': 0, '5': -1, '11': -2}),
    'R10A':  (['LIK', 'A0', 'A1', 'A2', 'CEN'], {'10': 0}),   # петля через Автостанцію / Укр. Повстанців
    'SOUTH': (['CEN', 'MAZ'],                 {'8': 1, '11': 0, '2': -1}),
    'PF':    (['MAZ', 'P1', 'PF'],            {'11': 0.5, '2': -0.5}),
    'CH':    (['MAZ', 'BAR', 'CH53'],         {'8': 1}),
    'SE':    (['CEN', 'GB'],                  {'9': 1, '8': 0, '7': -1}),
    'B78':   (['GB', 'B2', 'PTL'],            {'8': 0, '7': -1}),
    'R8':    (['PTL', 'VOK'],                 {'8': 0}),
    'R7':    (['PTL', 'GOR', 'C7', 'VOK'],    {'7': -1}),
    'R9A':   (['GB', 'MK'],                   {'9': 1}),
    'R9B':   (['MK', 'MAL', 'YUR', 'OT'],     {'9': 0}),
    'R9C':   (['OT', 'VOK'],                  {'9': 0}),   # пунктир: окремі рейси
}
ROUTES = {
    '2':  ['PF', 'SOUTH', 'TRUNK', 'SH'],
    '3':  ['LIS', 'TRUNK', 'NE1', 'NE2', 'NE3', 'EAST'],
    '5':  ['SH', 'TRUNK', 'NE1', 'LOW', 'NE3', 'EAST'],
    '7':  ['TRUNK', 'SE', 'B78', 'R7'],
    '8':  ['CH', 'SOUTH', 'SE', 'B78', 'R8'],
    '9':  ['SE', 'R9A', 'R9B'],
    '10': ['R10A', 'NE1', 'NE2', 'NE3', 'EAST'],
    '11': ['PF', 'SOUTH', 'NE1', 'LOW', 'NE3', 'EAST'],
    '12': ['TRUNK', 'NE1', 'NE2', 'NE3', 'EAST'],
}
DASHED = {'9': ['R9C']}

# вузли: stop — id зупинки на сайті (табло /transport/stop/<id>)
HUBS = [
    dict(key='LIK', stop='st_0035', name='Лікарня · Поліклініка', sub='', lx=266, ly=346, anchor='end', term=['7', '12', '10'], bx=266, by=354, balign='end'),
    dict(key='CEN', stop='st_0070', name='Центр · Базарна площа', sub='пл. Соборна · ТЦ «Промінь» · Коопринок', lx=536, ly=446, anchor='end', term=['9'], bx=536, by=450, balign='end', sub_dx=-30),
    dict(key='MK',  stop='st_0054', name='Малинівський круг', sub='', lx=918, ly=342, anchor='start', term=[], bx=0, by=0, balign='start'),
    dict(key='VOK', stop='st_0019', name='Залізничний вокзал', sub='', lx=1218, ly=398, anchor='start', term=['3', '5', '7', '8', '10', '11', '12'], bx=1218, by=408, balign='start'),
]
TERMS = [
    dict(key='LIS',   stop='st_0038', name='Лісотехнікум', sub='Фаховий коледж', lx=110, ly=432, anchor='middle', routes=['3'], bx=110, by=456, balign='middle', end_of='3'),
    dict(key='SH119', stop='st_0097', name='Шевченка, 119', sub='', lx=200, ly=510, anchor='middle', routes=['2', '5'], bx=200, by=518, balign='middle'),
    dict(key='PF',    stop='st_0064', name='Паперова фабрика', sub='Вайдманн', lx=340, ly=570, anchor='middle', routes=['2', '11'], bx=340, by=594, balign='middle'),
    dict(key='CH53',  stop='st_0094', name='Чорновола, 53', sub='', lx=604, ly=624, anchor='end', routes=['8'], bx=604, by=632, balign='end', end_of='8'),
    dict(key='OT',    stop='st_0009', name='вул. Олекси Тихого', sub='', lx=1202, ly=336, anchor='start', routes=['9'], bx=1202, by=344, balign='start', end_of='9'),
]
# проміжні орієнтири (маленькі): коридор, точка на осі, підпис
WAYPOINTS = [
    dict(cor='R10A', seg=2, t=0.5, stop='st_0004', name='Автостанція · Укр. Повстанців', lx=400, ly=302, anchor='middle'),
    dict(cor='NE2',  seg=1, t=(760-660)/(860-660), stop='st_0013', name='Грушевського', lx=760, ly=270, anchor='middle'),
    dict(cor='LOW',  seg=0, t=(720-620)/(820-620), stop='st_0015', name='з-д «Прожектор»', lx=720, ly=378, anchor='middle'),
    dict(cor='R9A',  seg=0, t=0.5, stop='st_0090', name='Царське село', lx=806, ly=424, anchor='start'),
    dict(cor='R9B',  seg=1, t=0.0, stop='st_0053', name='Малинівка', lx=980, ly=200, anchor='middle'),
    dict(cor='R9B',  seg=1, t=1.0, stop='st_0099', name='Юрівка', lx=1060, ly=200, anchor='middle'),
    dict(cor='B78',  seg=1, t=1.0, stop='st_0079', name='ПТЛ', lx=980, ly=636, anchor='middle'),
    dict(cor='R7',   seg=0, t=(1080-980)/(1100-980), stop='st_0002', name='Городище · 14 ОМБ', lx=1086, ly=636, anchor='middle'),
    dict(cor='R8',   seg=0, t=0.5, stop='st_0057', name='вул. Миру', lx=1096, ly=512, anchor='start'),
    dict(cor='SOUTH', seg=0, t=1.0, stop='st_0024', name='Івана Мазепи', lx=536, ly=504, anchor='end'),
    dict(cor='PF',   seg=1, t=(520-440)/(520-340), stop='st_0075', name='Приходька', lx=440, ly=522, anchor='middle'),
    dict(cor='CH',   seg=0, t=1.0, stop='st_0007', name='Барміна', lx=584, ly=544, anchor='start'),
]

# Вузол схеми = кілька фізичних зупинок датасету навколо головної (data-stop). Ключ — головна
# зупинка (посилання на табло), значення — решта зупинок вузла: через дорогу, за рогом, а для
# «Лікарні» — ще й Поліклініка за 209 м (кінцева 7 і 12). Лінії вузла = обʼєднання ліній усіх його
# зупинок. Ревізія після змін датасету: python3 build_scheme.py --suggest-node-stops [--dataset …].
NODE_STOPS = {
    'st_0035': ['st_0036', 'st_0072'],  # Лікарня · Поліклініка: Лікарня 2, Поліклініка
    'st_0070': ['st_0082', 'st_0008', 'st_0056', 'st_0049', 'st_0044'],  # Центр: сквер, Вербицького, «Соборний», «Промінь», «Доктор ЗОО»
    'st_0015': ['st_0046'],  # з-д «Прожектор» + м-н «Меркурій»
    'st_0079': ['st_0059'],  # ПТЛ + Миру-Городищанська
    'st_0002': ['st_0003'],  # Городище · 14 ОМБ + «14 ОМБ (навпр)»
    'st_0094': ['st_0093'],  # Чорновола, 53 + Чорновола 36
    'st_0004': ['st_0005'],  # Автостанція + «навпроти»
    'st_0097': ['st_0067'],  # Шевченка, 119 + перехр. Бондарик-Шевченка
    'st_0007': ['st_0092'],  # Барміна + Чорновола 15
    'st_0024': ['st_0043'],  # Івана Мазепи + м-н «Вікторія»
}
SUGGEST_RADIUS_M = 150  # радіус для --suggest-node-stops


def node_stops(primary):
    """Усі зупинки вузла, головна перша."""
    return [primary] + NODE_STOPS.get(primary, [])


def scheme_nodes():
    """Вузли схеми для сайту (malyn-scheme-nodes.ts): спершу пересадкові, потім кінцеві, потім орієнтири."""
    rows = []
    for kind, items in (('hub', HUBS), ('terminal', TERMS), ('waypoint', WAYPOINTS)):
        for it in items:
            rows.append(dict(id=it['stop'], kind=kind, name=it['name'], stopIds=node_stops(it['stop'])))
    return rows

# Вода (схематично, за контурами OpenStreetMap): Малинське водосховище на заході, Ірша витікає
# біля Паперової фабрики, перетинає Мазепи між Коопринком і Мазепи, 3 (міст), далі йде південніше
# Бандери – Миру і за ГМП повертає на південний схід.
RESERVOIR = [(28, 556), (110, 540), (200, 548), (262, 560), (312, 574), (262, 604), (170, 612), (80, 606), (28, 588)]
RIVER = [(306, 574), (340, 540), (400, 480), (560, 480), (660, 580), (700, 580), (780, 660), (1060, 660), (1120, 720), (1372, 720)]
WATER_LABELS = [dict(text='Малинське водосховище', x=165, y=580, anchor='middle'),
                dict(text='р. Ірша', x=424, y=497, anchor='middle'),
                dict(text='р. Ірша', x=920, y=651, anchor='middle')]

# ---------------------------------------------------------------- геометрія: зсув полілінії
def unit(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l = math.hypot(dx, dy)
    return (dx / l, dy / l)

def left_normal(u):
    return (u[1], -u[0])

def intersect(p1, p2, p3, p4):
    x1, y1 = p1; x2, y2 = p2; x3, y3 = p3; x4, y4 = p4
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

def offset_polyline(verts, offs):
    segs = []
    for i in range(len(verts) - 1):
        a, b = verts[i], verts[i + 1]
        u = unit(a, b); n = left_normal(u); d = offs[i]
        segs.append(((a[0] + n[0] * d, a[1] + n[1] * d), (b[0] + n[0] * d, b[1] + n[1] * d), u))
    out = [segs[0][0]]
    for i in range(1, len(segs)):
        pa, pb = segs[i - 1], segs[i]
        cross = pa[2][0] * pb[2][1] - pa[2][1] * pb[2][0]
        if abs(cross) < 1e-9:
            if math.dist(pa[1], pb[0]) < 1e-6:
                out.append(pa[1])
            else:  # зміна смуги на прямій: короткий похилий перехід
                L = 2 * math.dist(pa[1], pb[0])
                out.append(pa[1])
                out.append((pb[0][0] + pb[2][0] * L, pb[0][1] + pb[2][1] * L))
        else:
            out.append(intersect(pa[0], pa[1], pb[0], pb[1]))
    out.append(segs[-1][1])
    return out

def corridor_pts(name):
    return [N[k] for k in C[name][0]]

def route_vertices(rid, cors):
    verts, offs = [], []
    for idx, cname in enumerate(cors):
        pts = corridor_pts(cname); off = C[cname][1][rid] * S
        if idx == 0:
            if len(cors) > 1:
                nxt = corridor_pts(cors[1])
                if pts[-1] not in (nxt[0], nxt[-1]) and pts[0] in (nxt[0], nxt[-1]):
                    pts = pts[::-1]; off = -off
            verts.append(pts[0])
        else:
            last = verts[-1]
            if pts[0] != last:
                if pts[-1] != last:
                    raise SystemExit(f'route {rid}: corridor {cname} does not connect at {last}')
                pts = pts[::-1]; off = -off
        for p in pts[1:]:
            verts.append(p); offs.append(off)
    return verts, offs

def path_d(points):
    return 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in points)

def route_path(rid, cors):
    v, o = route_vertices(rid, cors)
    return offset_polyline(v, o)

def point_on_corridor(cname, seg, t, rid=None):
    pts = corridor_pts(cname)
    a, b = pts[seg], pts[seg + 1]
    u = unit(a, b); n = left_normal(u)
    base = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    lanes = C[cname][1]
    offs = [lanes[r] * S for r in lanes] if rid is None else [lanes[rid] * S]
    return base, u, n, min(offs), max(offs)

# ---------------------------------------------------------------- статистика для легенди
def load_dataset(path):
    if path and os.path.exists(path):
        return json.load(open(path, encoding='utf-8'))
    try:
        with urllib.request.urlopen(API, timeout=30) as r:
            return json.load(r)
    except Exception as e:  # noqa
        print(f'warn: dataset unavailable ({e}); legend without trip counts', file=sys.stderr)
        return None

def route_stats(ds):
    out = {}
    if not ds:
        return out
    by = defaultdict(list)
    for t in ds['trips']:
        by[t['routeId']].append(t)
    for rid in ROUTE_ORDER:
        ts = by.get(rid, [])
        times = sorted(t['departureTime'][:5] for t in ts if t.get('departureTime'))
        per_dir = defaultdict(int)
        for t in ts:
            per_dir[t.get('directionId')] += 1
        counts = sorted(per_dir.values())
        if not times:
            continue
        a, b = (counts[0], counts[-1]) if counts else (0, 0)
        trips = f'{a}' if a == b else f'{a}–{b}'
        out[rid] = dict(first=times[0].lstrip('0'), last=times[-1].lstrip('0'), trips=trips)
    return out

def _haversine_m(a, b):
    r = 6371000.0
    p1, p2 = math.radians(a['lat']), math.radians(b['lat'])
    dp, dl = p2 - p1, math.radians(b['lng'] - a['lng'])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def suggest_node_stops(ds):
    """Звіт для ревізії NODE_STOPS: зупинки датасету в радіусі SUGGEST_RADIUS_M від кожного вузла
    з їхніми лініями (без mapOnly і ненадійних маршрутів); ✓ — уже у вузлі."""
    if not ds:
        raise SystemExit('--suggest-node-stops: датасет недоступний (дайте --dataset dataset.json)')
    stops = {st['id']: st for st in ds['stops']}
    hidden = {r['id'] for r in ds['routes'] if r.get('unreliable')}
    routes_at = defaultdict(set)
    for rs in ds['routeStops']:
        if rs.get('mapOnly') or rs['routeId'] in hidden:
            continue
        routes_at[rs['stopId']].add(rs['routeId'])

    def fmt(ids):
        return ', '.join(sorted(ids, key=lambda r: ROUTE_ORDER.index(r) if r in ROUTE_ORDER else 99)) or '—'

    for row in scheme_nodes():
        members = row['stopIds']
        union = set().union(*(routes_at[m] for m in members))
        print(f"{row['id']} {row['name']} [{row['kind']}]: лінії вузла {fmt(union)}")
        base = stops.get(row['id'])
        if not base:
            print('    ! головної зупинки немає в датасеті')
            continue
        near = sorted(((_haversine_m(base, o), o) for o in ds['stops'] if o['id'] != row['id']), key=lambda t: t[0])
        for d, o in near:
            if d > SUGGEST_RADIUS_M and o['id'] not in members:
                continue
            mark = '✓' if o['id'] in members else ' '
            print(f"  {mark} {int(d):4d} м {o['id']} {o['name']}: {fmt(routes_at[o['id']])}")


# ---------------------------------------------------------------- QR-код (segno) та шрифти
def qr_svg_path(url, x0, y0, size):
    """Шлях модулів QR-коду (без тихої зони) у квадраті size×size з верхнім лівим кутом (x0, y0)."""
    try:
        import segno
    except ImportError:
        raise SystemExit('pip install segno — потрібен для QR-коду плаката')
    qr = segno.make(url, error='m')
    rows = [list(r) for r in qr.matrix_iter(scale=1, border=0)]
    n = len(rows)
    m = size / n
    cells = []
    for r, row in enumerate(rows):
        for c, v in enumerate(row):
            if v:
                cells.append(f'M{x0 + c * m:.2f},{y0 + r * m:.2f}h{m:.2f}v{m:.2f}h-{m:.2f}z')
    return ''.join(cells), n

def font_face_style(fonts_dir):
    """@font-face з вбудованими woff2 (кирилиця + латиниця), щоб плакат відкривався з тим самим шрифтом."""
    if not fonts_dir:
        return ''
    faces = []
    for fname, urange in (('golos-cyrillic.woff2', 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116'),
                          ('golos-latin.woff2', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD')):
        p = os.path.join(fonts_dir, fname)
        if not os.path.exists(p):
            print(f'warn: {p} not found — poster without embedded font', file=sys.stderr)
            return ''
        b64 = base64.b64encode(open(p, 'rb').read()).decode('ascii')
        faces.append(f"@font-face{{font-family:'Golos Text';font-style:normal;font-weight:400 800;font-display:swap;"
                     f"src:url(data:font/woff2;base64,{b64}) format('woff2');unicode-range:{urange};}}")
    # Друк напряму з браузера/Chromium: сторінка A2 landscape без полів, малюнок на всю сторінку
    faces.append('@media print{@page{size:594mm 420mm;margin:0}svg:root{width:594mm;height:420mm}}')
    return '<style>' + ''.join(faces) + '</style>'

# ---------------------------------------------------------------- SVG
def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def badge(x, y, rid, col, align='start', h=16, extra=''):
    w = 22 if len(rid) == 1 else 28
    if align == 'middle':
        x = x - w / 2
    elif align == 'end':
        x = x - w
    return (f'<g class="lts-badge" data-route="{rid}"{extra}>'
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{w}" height="{h}" rx="4" fill="{col(rid)}"/>'
            f'<text x="{x + w / 2:.1f}" y="{y + h - 4.2:.1f}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff">{rid}</text></g>')

def badges_row(x, y, rids, col, align='start', gap=4, per_row=4):
    if len(rids) > per_row:
        return ''.join(badges_row(x, y + i * 20, rids[i * per_row:(i + 1) * per_row], col, align, gap, per_row)
                       for i in range((len(rids) + per_row - 1) // per_row))
    ws = [22 if len(r) == 1 else 28 for r in rids]
    total = sum(ws) + gap * (len(rids) - 1)
    if align == 'middle':
        x = x - total / 2
    elif align == 'end':
        x = x - total
    parts = []
    for r, w in zip(rids, ws):
        parts.append(badge(x, y, r, col, 'start'))
        x += w + gap
    return ''.join(parts)

def build_svg(stats, col, bg, fg, muted, line_bg, water, water_fill, water_text, font,
              variant='page', standalone=False, qr_url=QR_URL_DEFAULT, fonts_dir=''):
    """variant: page (заголовок + легенда) | poster (page + QR) | site (лише карта, data-атрибути)."""
    site = variant == 'site'
    W_, H_ = 1400, 1012
    view = '0 176 1400 566' if site else f'0 0 {W_} {H_}'
    o = []
    cls = ' class="lts-svg"' if site else ''
    # Окремий файл: явні width/height (root-svg із height:auto у Chromium має нульову висоту);
    # вбудований у сторінку: масштабується CSS-ом.
    size = f'width="{W_}" height="{H_}"' if standalone else 'style="max-width:100%;height:auto;display:block"'
    o.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" {size}{cls} role="img" '
             f'aria-label="Схема міських автобусних маршрутів Малина: 9 ліній, кінцеві та пересадкові зупинки" '
             f'font-family="{font}" color="{fg}">')
    if variant == 'poster':
        o.append(font_face_style(fonts_dir))
    if standalone:
        o.append(f'<rect width="{W_}" height="{H_}" fill="{bg}"/>')
    # ---- заголовок
    if not site:
        o.append(f'<text x="60" y="92" font-size="44" font-weight="800" letter-spacing="2" fill="{fg}">МАЛИН</text>')
        o.append(f'<text x="60" y="120" font-size="17" font-weight="600" fill="{fg}">Схема міських автобусних маршрутів</text>')
        o.append(f'<text x="60" y="142" font-size="12" fill="{muted}">9 маршрутів · проїзд 20 ₴ · схема не в масштабі · показано кінцеві, центральні та вузлові зупинки</text>')
    # компас
    cx, cy = (1340, 212) if site else ((1120, 84) if variant == 'poster' else (1340, 78))
    o.append(f'<g transform="translate({cx},{cy})" fill="{muted}" stroke="{muted}">'
             f'<line x1="0" y1="14" x2="0" y2="-10" stroke-width="2"/><polygon points="-5,-6 0,-16 5,-6" stroke="none"/>'
             f'<text x="0" y="30" text-anchor="middle" font-size="11" stroke="none" font-weight="600">Пн</text></g>')
    # ---- QR-код плаката
    if variant == 'poster':
        box_x, box_y, box = 1170, 36, 170
        quiet = 12
        d, n = qr_svg_path(qr_url, box_x + quiet, box_y + quiet, box - 2 * quiet)
        o.append(f'<rect x="{box_x}" y="{box_y}" width="{box}" height="{box}" rx="10" fill="#ffffff" stroke="{muted}" stroke-width="1.5"/>')
        o.append(f'<path d="{d}" fill="#1b1f2a" shape-rendering="crispEdges"/>')
        o.append(f'<text x="{box_x + box / 2:.0f}" y="{box_y + box + 20}" text-anchor="middle" font-size="12" font-weight="700" fill="{fg}">Скануй: інтерактивна схема й розклад</text>')
        o.append(f'<text x="{box_x + box / 2:.0f}" y="{box_y + box + 36}" text-anchor="middle" font-size="11.5" fill="{muted}">{esc(qr_url.replace("https://", ""))}</text>')
    # ---- вода (під лініями)
    o.append(f'<g class="lts-water"><path d="{path_d(RESERVOIR)} Z" fill="{water_fill}" stroke="{water}" stroke-width="2" stroke-linejoin="round"/>')
    o.append(f'<path d="{path_d(RIVER)}" fill="none" stroke="{water}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>')
    for wl in WATER_LABELS:
        o.append(f'<text x="{wl["x"]}" y="{wl["y"]}" text-anchor="{wl["anchor"]}" font-size="11" font-style="italic" fill="{water_text}">{esc(wl["text"])}</text>')
    o.append('</g>')
    # ---- лінії: кожен маршрут — група (підкладка-обводка + колір + пунктир)
    paths = {rid: route_path(rid, cors) for rid, cors in ROUTES.items()}
    dashed = {rid: route_path(rid, cors) for rid, cors in DASHED.items()}
    o.append('<g class="lts-routes" fill="none" stroke-linecap="round" stroke-linejoin="round">')
    for rid in ROUTE_ORDER:
        a, b, via = LEGEND[rid]
        extra = f' role="button" tabindex="0" aria-label="Маршрут №{rid}: {esc(a)} — {esc(b)}"' if site else ''
        o.append(f'<g class="lts-route" data-route="{rid}"{extra}>')
        o.append(f'<path d="{path_d(paths[rid])}" stroke="{line_bg}" stroke-width="{W + 2.5}"/>')
        o.append(f'<path d="{path_d(paths[rid])}" stroke="{col(rid)}" stroke-width="{W}"/>')
        if rid in dashed:
            o.append(f'<path d="{path_d(dashed[rid])}" stroke="{col(rid)}" stroke-width="{W - 1.5}" stroke-dasharray="8 9"/>')
        o.append('</g>')
    o.append('</g>')

    def stop_open(stop_id, name, kind):
        extra = f' role="link" tabindex="0" aria-label="Зупинка {esc(name)}: табло"' if site else ''
        return (f'<g class="lts-stop lts-stop--{kind}" data-stop="{stop_id}" '
                f'data-stops="{" ".join(node_stops(stop_id))}"{extra}>')

    # ---- проміжні орієнтири
    for wp in WAYPOINTS:
        base, u, n, lo, hi = point_on_corridor(wp['cor'], wp['seg'], wp['t'])
        a = (base[0] + n[0] * lo, base[1] + n[1] * lo)
        b = (base[0] + n[0] * hi, base[1] + n[1] * hi)
        o.append(stop_open(wp['stop'], wp['name'], 'waypoint'))
        o.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{fg}" stroke-width="11" stroke-linecap="round"/>')
        o.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{bg}" stroke-width="7" stroke-linecap="round"/>')
        o.append(f'<text x="{wp["lx"]}" y="{wp["ly"]}" text-anchor="{wp["anchor"]}" font-size="11.5" fill="{muted}">{esc(wp["name"])}</text>')
        o.append('</g>')
    # ---- кінцеві
    ends = {rid: (paths[rid][0], paths[rid][-1]) for rid in ROUTE_ORDER}
    for t in TERMS:
        cx_, cy_ = N[t['key']]
        if 'end_of' in t:
            e = ends[t['end_of']]
            cx_, cy_ = min(e, key=lambda q: math.dist(q, N[t['key']]))
        stroke = col(t['routes'][0]) if len(t['routes']) == 1 else fg
        o.append(stop_open(t['stop'], t['name'], 'terminal'))
        o.append(f'<circle cx="{cx_:.1f}" cy="{cy_:.1f}" r="{TERM_R}" fill="{bg}" stroke="{stroke}" stroke-width="3.5"/>')
        o.append(f'<text x="{t["lx"]}" y="{t["ly"]}" text-anchor="{t["anchor"]}" font-size="14" font-weight="700" fill="{fg}">{esc(t["name"])}</text>')
        if t.get('sub'):
            o.append(f'<text x="{t["lx"]}" y="{t["ly"] + 15}" text-anchor="{t["anchor"]}" font-size="11" fill="{muted}">{esc(t["sub"])}</text>')
        o.append(badges_row(t['bx'], t['by'], t['routes'], col, t['balign']))
        o.append('</g>')
    # ---- вузли
    for h in HUBS:
        cx_, cy_ = N[h['key']]
        o.append(stop_open(h['stop'], h['name'], 'hub'))
        o.append(f'<circle cx="{cx_}" cy="{cy_}" r="{HUB_R}" fill="{bg}" stroke="{fg}" stroke-width="4"/>')
        o.append(f'<circle cx="{cx_}" cy="{cy_}" r="{HUB_R - 8}" fill="none" stroke="{fg}" stroke-width="1.5" opacity="0.35"/>')
        o.append(f'<text x="{h["lx"]}" y="{h["ly"]}" text-anchor="{h["anchor"]}" font-size="16" font-weight="800" fill="{fg}">{esc(h["name"])}</text>')
        if h['sub']:
            o.append(f'<text x="{h["lx"] + h.get("sub_dx", 0)}" y="{h["ly"] + 16}" text-anchor="{h["anchor"]}" font-size="11" fill="{muted}">{esc(h["sub"])}</text>')
        if h['term']:
            o.append(badges_row(h['bx'], h['by'], h['term'], col, h['balign']))
        o.append('</g>')
    # ---- легенда
    if not site:
        x0, y0 = 60, 790
        o.append(f'<line x1="60" y1="{y0 - 22}" x2="1340" y2="{y0 - 22}" stroke="{muted}" stroke-width="1" opacity="0.5"/>')
        o.append(f'<text x="60" y="{y0 - 30}" font-size="11" font-weight="700" letter-spacing="1.5" fill="{muted}">МАРШРУТИ · РЕЙСИ В КОЖЕН БІК НА ДЕНЬ · ПЕРШИЙ–ОСТАННІЙ</text>')
        o.append(f'<g transform="translate(1000,{y0 - 34})" font-size="11" fill="{muted}">'
                 f'<circle cx="6" cy="0" r="7" fill="{bg}" stroke="{fg}" stroke-width="2.5"/><text x="20" y="4">пересадковий вузол</text>'
                 f'<circle cx="150" cy="0" r="5.5" fill="{bg}" stroke="{fg}" stroke-width="2.5"/><text x="162" y="4">кінцева</text>'
                 f'<line x1="228" y1="0" x2="262" y2="0" stroke="{fg}" stroke-width="4" stroke-dasharray="6 6" stroke-linecap="round"/><text x="270" y="4">окремі рейси</text></g>')
        row_h = 38
        for i, rid in enumerate(ROUTE_ORDER):
            colx = x0 if i < 5 else x0 + 660
            y = y0 + (i % 5) * row_h
            a, b, via = LEGEND[rid]
            st = stats.get(rid)
            o.append(f'<g class="lts-legend-row" data-route="{rid}">')
            o.append(badge(colx, y - 1, rid, col, 'start', h=20).replace('font-size="11.5"', 'font-size="13"').replace(f'y="{y - 1 + 20 - 4.2:.1f}"', f'y="{y + 14:.1f}"'))
            o.append(f'<text x="{colx + 38}" y="{y + 14}" font-size="13.5" font-weight="700" fill="{fg}">{esc(a)} — {esc(b)}</text>')
            if rid in UNCONFIRMED:
                o.append(f'<text x="{colx + 622}" y="{y + 14}" text-anchor="end" font-size="11.5" font-style="italic" fill="{muted}">розклад уточнюється</text>')
            elif st:
                o.append(f'<text x="{colx + 622}" y="{y + 14}" text-anchor="end" font-size="11.5" fill="{muted}" font-variant-numeric="tabular-nums">{esc(st["trips"])} рейс. · {esc(st["first"])}–{esc(st["last"])}</text>')
            o.append(f'<text x="{colx + 38}" y="{y + 29}" font-size="10.5" fill="{muted}">{esc(via)}</text>')
            o.append('</g>')
        o.append(f'<text x="60" y="{H_ - 16}" font-size="10" fill="{muted}">Дані: розклади Малинської міської ради · malin.kiev.ua/transport · жовтень 2026 · контури води за © OpenStreetMap</text>')
    o.append('</svg>')
    return '\n'.join(o)

HTML_TMPL = '''<title>Схема маршрутів Малина</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;600;700;800&display=swap">
<style>
/* Layout: one wide schematic (scrolls sideways on phones) over a short notes column. */
:root {
  --bg: #f7f6f2; --panel: #ffffff; --fg: #1b1f2a; --muted: #5f6673; --rule: #d9dbe0; --line-bg: #ffffff;
  --r2: #D7263D; --r3: #1B9E4B; --r5: #1F6FD6; --r7: #F08A1C; --r8: #7E3FC2; --r9: #E3368C; --r10: #C99700; --r11: #0E9AA7; --r12: #8A5A2B;
  --water: #9ccfe8; --water-fill: #cfe8f5; --water-text: #3d7fa3;
  --font: 'Golos Text', 'Segoe UI', Roboto, system-ui, -apple-system, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #15181f; --panel: #1d2129; --fg: #eef0f4; --muted: #a2a9b6; --rule: #343a46; --line-bg: #1d2129;
  --r2: #FF5F73; --r3: #3FCB70; --r5: #64A6FF; --r7: #FFAD4D; --r8: #B388F0; --r9: #FF74B8; --r10: #F2C94C; --r11: #3BC9D6; --r12: #C9915A;
  --water: #2f6a8a; --water-fill: #1f4559; --water-text: #7fb6d6;
  color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #15181f; --panel: #1d2129; --fg: #eef0f4; --muted: #a2a9b6; --rule: #343a46; --line-bg: #1d2129;
  --r2: #FF5F73; --r3: #3FCB70; --r5: #64A6FF; --r7: #FFAD4D; --r8: #B388F0; --r9: #FF74B8; --r10: #F2C94C; --r11: #3BC9D6; --r12: #C9915A;
  --water: #2f6a8a; --water-fill: #1f4559; --water-text: #7fb6d6;
  color-scheme: dark; }
body { background: var(--bg); color: var(--fg); font-family: var(--font); margin: 0; padding-block: 24px 48px; padding-inline: 16px; }
.wrap { max-width: 1440px; margin: 0 auto; display: grid; gap: 24px; }
.map { background: var(--panel); border: 1px solid var(--rule); border-radius: 12px; overflow-x: auto; padding: 8px; }
.map svg { min-width: 1100px; width: 100%; }
.notes { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
.notes section { min-width: 0; }
h2 { font-size: 13px; letter-spacing: 1.2px; text-transform: uppercase; color: var(--muted); margin: 0 0 10px; font-weight: 700; }
p, li { font-size: 15px; line-height: 1.5; max-width: 62ch; margin: 0; }
ul { padding-left: 18px; margin: 0; display: grid; gap: 6px; }
.pill { display: inline-block; min-width: 20px; padding: 0 5px; border-radius: 4px; color: #fff; font-weight: 700; font-size: 12px; line-height: 18px; text-align: center; vertical-align: 1px; }
@media (prefers-reduced-motion: no-preference) { .map { scroll-behavior: smooth; } }
</style>
<div class="wrap">
  <div class="map">
__SVG__
  </div>
  <div class="notes">
    <section>
      <h2>Як читати</h2>
      <ul>
        <li>Великі кільця — вузли, де сходяться кілька маршрутів і де зручно пересідати: Лікарня, Центр, Малинівський круг, Вокзал.</li>
        <li>Номери в кольорових плашках біля зупинки — маршрути, для яких ця зупинка кінцева.</li>
        <li>Дрібні сірі підписи — орієнтири на розгалуженнях (де лінії розходяться), не повний перелік зупинок.</li>
        <li>Схема не в масштабі: відстані між зупинками умовні, кути спрямлені до 45°.</li>
      </ul>
    </section>
    <section>
      <h2>Що взято з даних сайту</h2>
      <ul>
        <li>8 маршрутів, які показує malin.kiev.ua, плюс <span class="pill" style="background:var(--r10)">10</span>, намальований за старою схемою на вокзалі: його розклад у базі ще не заповнений, тому в легенді стоїть «розклад уточнюється». Маршрут 1 на схему не потрапив.</li>
        <li>Річка Ірша та Малинське водосховище показані схематично за контурами OpenStreetMap: міст на Мазепи між Кооперативним ринком і Мазепи, 3; Барміна, Чорновола й Приходька — на південному березі.</li>
        <li><span class="pill" style="background:var(--r9)">9</span> більшість рейсів закінчується на вул. Олекси Тихого; відрізок до Вокзалу (пунктир) і ранковий рейс до Лікарні — окремі рейси за розкладом міськради.</li>
        <li><span class="pill" style="background:var(--r8)">8</span> офіційна назва «Базар — Вокзал», але послідовність зупинок у базі починається з Чорновола, 53 — так і намальовано.</li>
        <li><span class="pill" style="background:var(--r7)">7</span> та <span class="pill" style="background:var(--r8)">8</span> ходять за тимчасовою схемою (жовтень 2023, ремонт вул. Городищанської).</li>
        <li>Кількість рейсів і час першого/останнього — з розкладів у базі (/transport/dataset).</li>
      </ul>
    </section>
  </div>
</div>
'''

SITE_ROUTES_TS_HEAD = '''/**
 * Легенда схеми маршрутів (/transport/scheme). ЗГЕНЕРОВАНО — не редагувати руками:
 *   python3 Docs/malyn-transit-scheme/build_scheme.py --site-dir frontend/src/pages/LocalTransportPage/scheme
 * Кольори звідси підставляються в CSS-змінні (--lts-r<id>, --lt-route-color) на сторінках транспорту.
 */
export type SchemeRoute = {
  id: string;
  from: string;
  to: string;
  via: string;
  /** Намальований за старою схемою; розклад у базі ще не заповнений */
  unconfirmed: boolean;
  /** Колір лінії (світла тема) — єдине джерело для схеми, планувальника й табло */
  color: string;
};

'''

SITE_NODES_TS_HEAD = '''/**
 * Вузли схеми маршрутів (/transport/scheme). ЗГЕНЕРОВАНО — не редагувати руками:
 *   python3 Docs/malyn-transit-scheme/build_scheme.py --site-dir frontend/src/pages/LocalTransportPage/scheme
 * Вузол = кілька фізичних зупинок датасету (NODE_STOPS у генераторі, ревізія — --suggest-node-stops):
 * id — головна зупинка (data-stop у SVG, посилання на табло), stopIds — усі зупинки вузла.
 */
export type SchemeNodeKind = 'hub' | 'terminal' | 'waypoint';
export type SchemeNode = {
  /** Головна зупинка вузла — data-stop у SVG */
  id: string;
  kind: SchemeNodeKind;
  /** Підпис на схемі */
  name: string;
  /** Усі зупинки датасету, що належать вузлу (головна перша) */
  stopIds: string[];
};

'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dataset', default='')
    ap.add_argument('--out-dir', default='')
    ap.add_argument('--site-dir', default='')
    ap.add_argument('--poster-dir', default='')
    ap.add_argument('--qr-url', default=QR_URL_DEFAULT)
    ap.add_argument('--fonts-dir', default='')
    ap.add_argument('--suggest-node-stops', action='store_true', help='звіт по зупинках навколо вузлів (ревізія NODE_STOPS)')
    args = ap.parse_args()
    ds = load_dataset(args.dataset)
    if args.suggest_node_stops:
        suggest_node_stops(ds)
        return
    if not (args.out_dir or args.site_dir or args.poster_dir):
        args.out_dir = '.'
    stats = route_stats(ds)
    light = dict(col=lambda r: COLORS[r][0], bg='#ffffff', fg='#1b1f2a', muted='#5f6673', line_bg='#ffffff',
                 water='#9ccfe8', water_fill='#cfe8f5', water_text='#3d7fa3',
                 font="'Golos Text', 'Segoe UI', Roboto, Arial, sans-serif")
    if args.out_dir:
        os.makedirs(args.out_dir, exist_ok=True)
        svg_html = build_svg(stats, col=lambda r: f'var(--r{r})', bg='var(--panel)', fg='var(--fg)', muted='var(--muted)',
                             line_bg='var(--line-bg)', water='var(--water)', water_fill='var(--water-fill)',
                             water_text='var(--water-text)', font='var(--font)')
        with open(os.path.join(args.out_dir, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(HTML_TMPL.replace('__SVG__', svg_html))
        with open(os.path.join(args.out_dir, 'malyn-transit-scheme.svg'), 'w', encoding='utf-8') as f:
            f.write('<?xml version="1.0" encoding="UTF-8"?>\n' + build_svg(stats, standalone=True, **light))
    if args.site_dir:
        os.makedirs(args.site_dir, exist_ok=True)
        svg_site = build_svg(stats, col=lambda r: f'var(--lts-r{r})', bg='var(--lts-bg)', fg='var(--lts-fg)',
                             muted='var(--lts-muted)', line_bg='var(--lts-bg)', water='var(--lts-water)',
                             water_fill='var(--lts-water-fill)', water_text='var(--lts-water-text)',
                             font='inherit', variant='site')
        with open(os.path.join(args.site_dir, 'malyn-scheme.svg'), 'w', encoding='utf-8') as f:
            f.write(svg_site + '\n')
        rows = [dict(id=rid, **{'from': LEGEND[rid][0], 'to': LEGEND[rid][1]}, via=LEGEND[rid][2], unconfirmed=rid in UNCONFIRMED,
                     color=COLORS[rid][0])
                for rid in ROUTE_ORDER]
        with open(os.path.join(args.site_dir, 'malyn-scheme-routes.ts'), 'w', encoding='utf-8') as f:
            f.write(SITE_ROUTES_TS_HEAD + 'export const SCHEME_ROUTES: SchemeRoute[] = '
                    + json.dumps(rows, ensure_ascii=False, indent=2) + ';\n')
        with open(os.path.join(args.site_dir, 'malyn-scheme-nodes.ts'), 'w', encoding='utf-8') as f:
            f.write(SITE_NODES_TS_HEAD + 'export const SCHEME_NODES: SchemeNode[] = '
                    + json.dumps(scheme_nodes(), ensure_ascii=False, indent=2) + ';\n')
    if args.poster_dir:
        os.makedirs(args.poster_dir, exist_ok=True)
        with open(os.path.join(args.poster_dir, 'malyn-transit-scheme-poster.svg'), 'w', encoding='utf-8') as f:
            f.write('<?xml version="1.0" encoding="UTF-8"?>\n'
                    + build_svg(stats, standalone=True, variant='poster', qr_url=args.qr_url, fonts_dir=args.fonts_dir, **light))
    print('ok', {k: v['trips'] for k, v in stats.items()})

if __name__ == '__main__':
    main()
