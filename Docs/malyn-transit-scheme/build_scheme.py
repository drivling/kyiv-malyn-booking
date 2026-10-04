#!/usr/bin/env python3
"""
Схема міських маршрутів Малина у стилі метро (октолінійна, не в масштабі).

Геометрія (вузли, коридори, смуги) задана вручну нижче; статистика для легенди
(кількість рейсів, перший/останній) береться з /transport/dataset.

  python3 build_scheme.py --dataset dataset.json --out-dir .
"""
import argparse, json, math, os, sys, urllib.request
from collections import defaultdict

API = 'https://kyiv-malyn-booking-production.up.railway.app/transport/dataset'
S = 10      # відстань між смугами (центр-центр), px
W = 7       # товщина лінії, px
HUB_R = 26  # радіус пересадкового вузла
TERM_R = 9  # радіус кінцевої

# ---------------------------------------------------------------- маршрути
ROUTE_ORDER = ['2', '3', '5', '7', '8', '9', '11', '12']
COLORS = {  # світла тема / темна тема
    '2':  ('#D7263D', '#FF5F73'),
    '3':  ('#1B9E4B', '#3FCB70'),
    '5':  ('#1F6FD6', '#64A6FF'),
    '7':  ('#F08A1C', '#FFAD4D'),
    '8':  ('#7E3FC2', '#B388F0'),
    '9':  ('#E3368C', '#FF74B8'),
    '11': ('#0E9AA7', '#3BC9D6'),
    '12': ('#8A5A2B', '#C9915A'),
}
LEGEND = {  # кінцеві та «через» — коротко, для легенди
    '2':  ('Паперова фабрика', 'Шевченка, 119', 'Приходька · Мазепи · Центр · Шевченка · Лікарня'),
    '3':  ('Лісотехнікум', 'Залізничний вокзал', 'Лікарня · Центр · Грушевського · Малинівський круг · Огієнка (БАМ)'),
    '5':  ('Шевченка, 119', 'Залізничний вокзал', 'Лікарня · Центр · з-д «Прожектор» · Малинівський круг · Огієнка'),
    '7':  ('Лікарня', 'Залізничний вокзал', 'Центр · С. Бандери · ПТЛ · Городище (14 ОМБ) · тимчасова схема'),
    '8':  ('Чорновола, 53', 'Залізничний вокзал', 'Барміна · Мазепи · Базар · С. Бандери · ПТЛ · вул. Миру · тимчасова схема'),
    '9':  ('Центр (ТЦ «Промінь»)', 'вул. Олекси Тихого', 'С. Бандери · Царське село · Малинівський круг · Малинівка · Юрівка · окремі рейси — Вокзал, Лікарня'),
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
}
# коридор: точки (у канонічному напрямку) + зсув кожного маршруту в смугах
# (+ = візуально ліворуч від напрямку руху, у координатах екрана)
C = {
    'LIS':   (['LIS', 'LIK'],                 {'3': 0}),
    'SH':    (['SH119', 'LIK'],               {'5': 0.5, '2': -0.5}),
    'TRUNK': (['LIK', 'CEN'],                 {'3': 2, '12': 1, '5': 0, '7': -1, '2': -2}),
    'NE1':   (['CEN', 'F1'],                  {'3': 1.5, '12': 0.5, '5': -0.5, '11': -1.5}),
    'NE2':   (['F1', 'F2', 'L2'],             {'3': 1.5, '12': 0.5}),
    'LOW':   (['F1', 'L1', 'L2'],             {'5': -0.5, '11': -1.5}),
    'NE3':   (['L2', 'MK'],                   {'3': 1.5, '12': 0.5, '5': -0.5, '11': -1.5}),
    'EAST':  (['MK', 'N1', 'VOK'],            {'3': 1.5, '12': 0.5, '5': -0.5, '11': -1.5}),
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
    '11': ['PF', 'SOUTH', 'NE1', 'LOW', 'NE3', 'EAST'],
    '12': ['TRUNK', 'NE1', 'NE2', 'NE3', 'EAST'],
}
DASHED = {'9': ['R9C']}

# вузли: (тип, назва, підпис...)  type: hub | term
HUBS = [
    # key, name, sub, label anchor/pos, terminating routes + badge pos
    dict(key='LIK', name='Лікарня · Поліклініка', sub='', lx=280, ly=346, anchor='middle', term=['7', '12'], bx=280, by=354, balign='middle'),
    dict(key='CEN', name='Центр · Базарна площа', sub='пл. Соборна · ТЦ «Промінь» · Кооперативний ринок', lx=536, ly=450, anchor='end', term=['9'], bx=536, by=474, balign='end'),
    dict(key='MK',  name='Малинівський круг', sub='', lx=918, ly=342, anchor='start', term=[], bx=0, by=0, balign='start'),
    dict(key='VOK', name='Залізничний вокзал', sub='', lx=1218, ly=398, anchor='start', term=['3', '5', '7', '8', '11', '12'], bx=1218, by=408, balign='start'),
]
TERMS = [
    dict(key='LIS',   name='Лісотехнікум', sub='Фаховий коледж', lx=110, ly=432, anchor='middle', routes=['3'], bx=110, by=456, balign='middle', end_of='3'),
    dict(key='SH119', name='Шевченка, 119', sub='', lx=200, ly=510, anchor='middle', routes=['2', '5'], bx=200, by=518, balign='middle'),
    dict(key='PF',    name='Паперова фабрика', sub='Вайдманн', lx=340, ly=570, anchor='middle', routes=['2', '11'], bx=340, by=594, balign='middle'),
    dict(key='CH53',  name='Чорновола, 53', sub='', lx=604, ly=624, anchor='end', routes=['8'], bx=604, by=632, balign='end', end_of='8'),
    dict(key='OT',    name='вул. Олекси Тихого', sub='', lx=1202, ly=336, anchor='start', routes=['9'], bx=1202, by=344, balign='start', end_of='9'),
]
# проміжні орієнтири (маленькі): коридор, точка на осі, підпис
WAYPOINTS = [
    dict(cor='NE2',  seg=1, t=(760-660)/(860-660), name='Грушевського', lx=760, ly=270, anchor='middle'),
    dict(cor='LOW',  seg=0, t=(720-620)/(820-620), name='з-д «Прожектор»', lx=720, ly=378, anchor='middle'),
    dict(cor='R9A',  seg=0, t=0.5, name='Царське село', lx=806, ly=424, anchor='start'),
    dict(cor='R9B',  seg=1, t=0.0, name='Малинівка', lx=980, ly=200, anchor='middle'),
    dict(cor='R9B',  seg=1, t=1.0, name='Юрівка', lx=1060, ly=200, anchor='middle'),
    dict(cor='B78',  seg=1, t=1.0, name='ПТЛ', lx=980, ly=636, anchor='middle'),
    dict(cor='R7',   seg=0, t=(1080-980)/(1100-980), name='Городище · 14 ОМБ', lx=1086, ly=636, anchor='middle'),
    dict(cor='R8',   seg=0, t=0.5, name='вул. Миру', lx=1096, ly=512, anchor='start'),
    dict(cor='SOUTH', seg=0, t=1.0, name='Івана Мазепи', lx=536, ly=504, anchor='end'),
    dict(cor='PF',   seg=1, t=(520-440)/(520-340), name='Приходька', lx=440, ly=522, anchor='middle'),
    dict(cor='CH',   seg=0, t=1.0, name='Барміна', lx=584, ly=544, anchor='start'),
]

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

# ---------------------------------------------------------------- SVG
def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def badge(x, y, rid, col, align='start', h=16):
    w = 22 if len(rid) == 1 else 28
    if align == 'middle':
        x = x - w / 2
    elif align == 'end':
        x = x - w
    return (f'<rect x="{x:.1f}" y="{y:.1f}" width="{w}" height="{h}" rx="4" fill="{col(rid)}"/>'
            f'<text x="{x + w / 2:.1f}" y="{y + h - 4.2:.1f}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff">{rid}</text>')

def badges_row(x, y, rids, col, align='start', gap=4):
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

def build_svg(stats, col, bg, fg, muted, line_bg, standalone, font):
    """col(rid)->color string; bg/fg/muted — колірні рядки (var(...) або літерали)."""
    W_, H_ = 1400, 872
    o = []
    o.append(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W_} {H_}" role="img" '
             f'aria-label="Схема міських автобусних маршрутів Малина: 8 ліній, кінцеві та пересадкові зупинки" '
             f'font-family="{font}" color="{fg}" style="max-width:100%;height:auto;display:block">')
    if standalone:
        o.append(f'<rect width="{W_}" height="{H_}" fill="{bg}"/>')
    # ---- заголовок
    o.append(f'<text x="60" y="92" font-size="44" font-weight="800" letter-spacing="2" fill="{fg}">МАЛИН</text>')
    o.append(f'<text x="60" y="120" font-size="17" font-weight="600" fill="{fg}">Схема міських автобусних маршрутів</text>')
    o.append(f'<text x="60" y="142" font-size="12" fill="{muted}">8 маршрутів · проїзд 20 ₴ · схема не в масштабі · показано кінцеві, центральні та вузлові зупинки</text>')
    # компас
    o.append(f'<g transform="translate(1340,78)" fill="{muted}" stroke="{muted}">'
             f'<line x1="0" y1="14" x2="0" y2="-10" stroke-width="2"/><polygon points="-5,-6 0,-16 5,-6" stroke="none"/>'
             f'<text x="0" y="30" text-anchor="middle" font-size="11" stroke="none" font-weight="600">Пн</text></g>')
    # ---- лінії (підкладка-обводка, потім кольори)
    paths = {rid: route_path(rid, cors) for rid, cors in ROUTES.items()}
    dashed = {rid: route_path(rid, cors) for rid, cors in DASHED.items()}
    o.append(f'<g fill="none" stroke-linecap="round" stroke-linejoin="round">')
    for rid in ROUTE_ORDER:
        o.append(f'<path d="{path_d(paths[rid])}" stroke="{line_bg}" stroke-width="{W + 2.5}"/>')
    for rid in ROUTE_ORDER:
        o.append(f'<path d="{path_d(paths[rid])}" stroke="{col(rid)}" stroke-width="{W}"/>')
    for rid, pts in dashed.items():
        o.append(f'<path d="{path_d(pts)}" stroke="{col(rid)}" stroke-width="{W - 1.5}" stroke-dasharray="8 9"/>')
    o.append('</g>')
    # ---- проміжні орієнтири
    for wp in WAYPOINTS:
        base, u, n, lo, hi = point_on_corridor(wp['cor'], wp['seg'], wp['t'])
        a = (base[0] + n[0] * lo, base[1] + n[1] * lo)
        b = (base[0] + n[0] * hi, base[1] + n[1] * hi)
        o.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{fg}" stroke-width="11" stroke-linecap="round"/>')
        o.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{bg}" stroke-width="7" stroke-linecap="round"/>')
        o.append(f'<text x="{wp["lx"]}" y="{wp["ly"]}" text-anchor="{wp["anchor"]}" font-size="11.5" fill="{muted}">{esc(wp["name"])}</text>')
    # ---- кінцеві
    ends = {}
    for rid in ROUTE_ORDER:
        p = paths[rid]
        ends[rid] = (p[0], p[-1])
    for t in TERMS:
        cx, cy = N[t['key']]
        if 'end_of' in t:
            e = ends[t['end_of']]
            cx, cy = min(e, key=lambda q: math.dist(q, N[t['key']]))
        stroke = col(t['routes'][0]) if len(t['routes']) == 1 else fg
        o.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{TERM_R}" fill="{bg}" stroke="{stroke}" stroke-width="3.5"/>')
        o.append(f'<text x="{t["lx"]}" y="{t["ly"]}" text-anchor="{t["anchor"]}" font-size="14" font-weight="700" fill="{fg}">{esc(t["name"])}</text>')
        if t.get('sub'):
            o.append(f'<text x="{t["lx"]}" y="{t["ly"] + 15}" text-anchor="{t["anchor"]}" font-size="11" fill="{muted}">{esc(t["sub"])}</text>')
        o.append(badges_row(t['bx'], t['by'], t['routes'], col, t['balign']))
    # ---- вузли
    for h in HUBS:
        cx, cy = N[h['key']]
        o.append(f'<circle cx="{cx}" cy="{cy}" r="{HUB_R}" fill="{bg}" stroke="{fg}" stroke-width="4"/>')
        o.append(f'<circle cx="{cx}" cy="{cy}" r="{HUB_R - 8}" fill="none" stroke="{fg}" stroke-width="1.5" opacity="0.35"/>')
        o.append(f'<text x="{h["lx"]}" y="{h["ly"]}" text-anchor="{h["anchor"]}" font-size="16" font-weight="800" fill="{fg}">{esc(h["name"])}</text>')
        if h['sub']:
            o.append(f'<text x="{h["lx"]}" y="{h["ly"] + 16}" text-anchor="{h["anchor"]}" font-size="11" fill="{muted}">{esc(h["sub"])}</text>')
        if h['term']:
            o.append(badges_row(h['bx'], h['by'], h['term'], col, h['balign']))
    # ---- легенда
    x0, y0 = 60, 690
    o.append(f'<line x1="60" y1="{y0 - 22}" x2="1340" y2="{y0 - 22}" stroke="{muted}" stroke-width="1" opacity="0.5"/>')
    o.append(f'<text x="60" y="{y0 - 30}" font-size="11" font-weight="700" letter-spacing="1.5" fill="{muted}">МАРШРУТИ · РЕЙСИ В КОЖЕН БІК НА ДЕНЬ · ПЕРШИЙ–ОСТАННІЙ</text>')
    o.append(f'<g transform="translate(1000,{y0 - 34})" font-size="11" fill="{muted}">'
             f'<circle cx="6" cy="0" r="7" fill="{bg}" stroke="{fg}" stroke-width="2.5"/><text x="20" y="4">пересадковий вузол</text>'
             f'<circle cx="150" cy="0" r="5.5" fill="{bg}" stroke="{fg}" stroke-width="2.5"/><text x="162" y="4">кінцева</text>'
             f'<line x1="228" y1="0" x2="262" y2="0" stroke="{fg}" stroke-width="4" stroke-dasharray="6 6" stroke-linecap="round"/><text x="270" y="4">окремі рейси</text></g>')
    row_h = 38
    for i, rid in enumerate(ROUTE_ORDER):
        colx = x0 if i < 4 else x0 + 660
        y = y0 + (i % 4) * row_h
        a, b, via = LEGEND[rid]
        st = stats.get(rid)
        o.append(badge(colx, y - 1, rid, col, 'start', h=20).replace('font-size="11.5"', 'font-size="13"').replace(f'y="{y - 1 + 20 - 4.2:.1f}"', f'y="{y + 14:.1f}"'))
        o.append(f'<text x="{colx + 38}" y="{y + 14}" font-size="13.5" font-weight="700" fill="{fg}">{esc(a)} — {esc(b)}</text>')
        if st:
            o.append(f'<text x="{colx + 622}" y="{y + 14}" text-anchor="end" font-size="11.5" fill="{muted}" font-variant-numeric="tabular-nums">{esc(st["trips"])} рейс. · {esc(st["first"])}–{esc(st["last"])}</text>')
        o.append(f'<text x="{colx + 38}" y="{y + 29}" font-size="10.5" fill="{muted}">{esc(via)}</text>')
    o.append(f'<text x="60" y="{H_ - 16}" font-size="10" fill="{muted}">Дані: розклади Малинської міської ради · malin.kiev.ua/transport · жовтень 2026</text>')
    o.append('</svg>')
    return '\n'.join(o)

HTML_TMPL = '''<title>Схема маршрутів Малина</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;600;700;800&display=swap">
<style>
/* Layout: one wide schematic (scrolls sideways on phones) over a short notes column. */
:root {
  --bg: #f7f6f2; --panel: #ffffff; --fg: #1b1f2a; --muted: #5f6673; --rule: #d9dbe0; --line-bg: #ffffff;
  --r2: #D7263D; --r3: #1B9E4B; --r5: #1F6FD6; --r7: #F08A1C; --r8: #7E3FC2; --r9: #E3368C; --r11: #0E9AA7; --r12: #8A5A2B;
  --font: 'Golos Text', 'Segoe UI', Roboto, system-ui, -apple-system, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #15181f; --panel: #1d2129; --fg: #eef0f4; --muted: #a2a9b6; --rule: #343a46; --line-bg: #1d2129;
  --r2: #FF5F73; --r3: #3FCB70; --r5: #64A6FF; --r7: #FFAD4D; --r8: #B388F0; --r9: #FF74B8; --r11: #3BC9D6; --r12: #C9915A;
  color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #15181f; --panel: #1d2129; --fg: #eef0f4; --muted: #a2a9b6; --rule: #343a46; --line-bg: #1d2129;
  --r2: #FF5F73; --r3: #3FCB70; --r5: #64A6FF; --r7: #FFAD4D; --r8: #B388F0; --r9: #FF74B8; --r11: #3BC9D6; --r12: #C9915A;
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
        <li>8 маршрутів, які показує malin.kiev.ua; маршрути 1 та 10 позначені в базі як ненадійні й на схему не потрапили.</li>
        <li><span class="pill" style="background:var(--r9)">9</span> більшість рейсів закінчується на вул. Олекси Тихого; відрізок до Вокзалу (пунктир) і ранковий рейс до Лікарні — окремі рейси за розкладом міськради.</li>
        <li><span class="pill" style="background:var(--r8)">8</span> офіційна назва «Базар — Вокзал», але послідовність зупинок у базі починається з Чорновола, 53 — так і намальовано.</li>
        <li><span class="pill" style="background:var(--r7)">7</span> та <span class="pill" style="background:var(--r8)">8</span> ходять за тимчасовою схемою (жовтень 2023, ремонт вул. Городищанської).</li>
        <li>Кількість рейсів і час першого/останнього — з розкладів у базі (/transport/dataset).</li>
      </ul>
    </section>
  </div>
</div>
'''

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dataset', default='')
    ap.add_argument('--out-dir', default='.')
    args = ap.parse_args()
    stats = route_stats(load_dataset(args.dataset))
    os.makedirs(args.out_dir, exist_ok=True)
    # сторінка з токенами теми
    svg_html = build_svg(stats, col=lambda r: f'var(--r{r})', bg='var(--panel)', fg='var(--fg)', muted='var(--muted)',
                         line_bg='var(--line-bg)', standalone=False, font='var(--font)')
    with open(os.path.join(args.out_dir, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(HTML_TMPL.replace('__SVG__', svg_html))
    # самодостатній SVG (світла тема, для друку/месенджерів)
    svg_file = build_svg(stats, col=lambda r: COLORS[r][0], bg='#ffffff', fg='#1b1f2a', muted='#5f6673',
                         line_bg='#ffffff', standalone=True,
                         font="'Golos Text', 'Segoe UI', Roboto, Arial, sans-serif")
    with open(os.path.join(args.out_dir, 'malyn-transit-scheme.svg'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n' + svg_file)
    print('ok', stats)

if __name__ == '__main__':
    main()
