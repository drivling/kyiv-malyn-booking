"""Фаза 7: технічні точки для лінії №7 — ті самі правила, що для №8 (build_more.build_routes).

№7 «Лікарня – Вокзал ч/з Городище»: Поліклініка → 10-ї ОГШБ → Шевченка → центр → Бандери → Городищанська →
«Їдальня ЗОШ 6» → вулиця 14-ї ОМБ → Малуші → провулок 14-ї ОМБ («14 ОМБ») → проїзд з північного боку кварталу
ГМП («ГМП 14») → Миру → Покровська → вокзал — як лінія №7 в OSM (relation 7510119).
- Зупинку для маршрутизації проєктуємо на лінію №7 з OSM, якщо вона ближче REL_MAX; інакше — загальне правило.
- «ГМП 14» (обидва боки) стояли на вул. Героїв Малинського Підпілля біля буд. 14, за 140 м від лінії OSM. Власник
  ставив зупинки не на місці (2026-10-12) і просив робити як в OSM: переносимо їх на проїзд, яким іде №7 в OSM,
  навпроти будинку 14 — «туди» (на захід) з північного боку, «назад» (на схід) — з південного.
- Час: відрізки між справжніми зупинками не змінюємо; навколо перенесеної зупинки два відрізки рахуємо разом
  і ділимо за довжиною (час від «14 ОМБ» до ЗОШ 5 той самий, «ГМП 14» — за новим місцем).
- Між вулицею 14-ї ОМБ і провулком — вулицею Малуші, як в OSM (точка «через» посередині Малуші).
- Біля вокзалу «назад» — петлею навколо привокзальної площі (т.3 → т.4), як №8.
- Старі ручні точки №7 т.1–т.5 з ланцюжків прибираємо; ті, що збіглися з новими точками повороту, лишаються.
  Точки №7, поставлені цим скриптом раніше й тепер не потрібні жодному маршруту, видаляємо.
Нічого не записує, якщо не передати --apply."""
import math
import os
import re
import sys

from build_more import DROP_TECH, build_routes, osm_route_anchors, put_routes  # шляхи до audit-2026-10/scripts
from apply_lib import move_stop  # noqa: E402
from common import OSM, dist_m, load, xy  # noqa: E402
from geo_lib import unxy  # noqa: E402
from geo_lib2 import chain  # noqa: E402

ROUTES = ['7']
REL = 7510119    # OSM: «Залізничний вокзал - Лікарня #7»
REL_MAX = 35.0   # м — далі від лінії OSM зупинку не проєктуємо
OLD = {'st_0111', 'st_0112', 'st_0113', 'st_0114', 'st_0115'}  # №7 т.1–т.5, поставлені вручну
TOP = 238306500  # OSM: проїзд з північного боку кварталу ГМП, від провулка 14-ї ОМБ до Миру (без назви)
MALUSHI = 1322863026  # OSM: вулиця Малуші між вулицею й провулком 14-ї ОМБ (частина лінії №7)
HOUSE14_LNG = 29.29215  # будинок ГМП 14 (і колишнє місце обох зупинок)
SIDE = {'st_0010': 1, 'st_0011': -1}  # «ГМП 14» — північний бік (туди, на захід), «навпроти» — південний
OFFSET = 7.0     # м — від осі проїзду до зупинки


def gmp14_positions():
    """Нові місця «ГМП 14»: на проїзді TOP навпроти будинку 14, по боках дороги."""
    els = load(os.path.join(OSM, 'relations.json'))['elements']
    g = [(p['lat'], p['lon']) for e in els if e.get('type') == 'way' and e['id'] == TOP for p in e['geometry']]
    for (alat, alng), (blat, blng) in zip(g, g[1:]):
        if min(alng, blng) <= HOUSE14_LNG <= max(alng, blng):
            t = (HOUSE14_LNG - alng) / (blng - alng)
            (ax, ay), (bx, by) = xy(alat, alng), xy(blat, blng)
            break
    cx, cy = ax + t * (bx - ax), ay + t * (by - ay)
    nx, ny = -(by - ay), bx - ax
    norm = math.hypot(nx, ny) * (1 if ny > 0 else -1)  # нормаль на північ
    out = {}
    for sid, side in SIDE.items():
        lat, lng = unxy(cx + side * OFFSET * nx / norm, cy + side * OFFSET * ny / norm)
        out[sid] = (round(lat, 6), round(lng, 6))
    return out


def anchors(st):
    return osm_route_anchors(st, '7', REL, REL_MAX)


def osm_way_mid(way_id):
    """Середина дороги OSM за довжиною."""
    els = load(os.path.join(OSM, 'relations.json'))['elements']
    g = [(p['lat'], p['lon']) for e in els if e.get('type') == 'way' and e['id'] == way_id for p in e['geometry']]
    half, acc = sum(dist_m(*a, *b) for a, b in zip(g, g[1:])) / 2, 0.0
    for a, b in zip(g, g[1:]):
        step = dist_m(*a, *b)
        if acc + step >= half:
            t = (half - acc) / step
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        acc += step
    return g[-1]


def via_points(st):
    """Між «Їдальнею ЗОШ 6» і «14 ОМБ» — вулицею Малуші, як у OSM (OSRM вибрав би коротший провулок 14-ї ОМБ
    через колишні т.1–т.2); вокзал → ЗОШ 5 — навколо привокзальної площі."""
    P = lambda i: (st[i]['lat'], st[i]['lng'])  # noqa: E731
    malushi = osm_way_mid(MALUSHI)
    return {
        ('7', 'orderThere', 'st_0027', 'st_0002'): [malushi],
        ('7', 'orderBack', 'st_0003', 'st_0028'): [malushi],
        ('7', 'orderBack', 'st_0019', 'st_0021'): [P('st_0103'), P('st_0104')],
    }


def pool_around(d, rid, moved):
    """Два відрізки навколо перенесеної зупинки — разом: їхній час ділимо між перегонами за довжиною."""
    st = {s['id']: s for s in d['stops']}
    mo = {x['stopId'] for x in d['routeStops'] if x['routeId'] == rid and x.get('mapOnly')}
    seg = {(s['fromStopId'], s['toStopId']): s for s in d['segments'] if s['routeId'] == rid}
    for key in ('orderThere', 'orderBack'):
        c = chain(d, rid, key)
        real = [i for i, x in enumerate(c) if x not in mo]
        for k, i in enumerate(real):
            if c[i] not in moved or k == 0 or k == len(real) - 1:
                continue
            hops = list(zip(c[real[k - 1]:real[k + 1]], c[real[k - 1] + 1:real[k + 1] + 1]))
            total = sum(seg[h]['seconds'] for h in hops)
            lens = [max(1.0, dist_m(st[p]['lat'], st[p]['lng'], st[q]['lat'], st[q]['lng'])) for p, q in hops]
            acc = prev = 0
            for h, ln in zip(hops, lens):
                acc += ln
                cum = round(total * acc / sum(lens))
                seg[h]['seconds'] = max(1, cum - prev)
                prev = cum
    return d


def build(d):
    for sid, (lat, lng) in gmp14_positions().items():
        move_stop(d, sid, lat, lng)
    d, created = build_routes(d, ROUTES, drop={'7': OLD}, special_fn=anchors, via_fn=via_points,
                              pool_skip=set().union(*DROP_TECH.values()), keep=frozenset())
    # точки №7, які ставив цей скрипт і які тепер не стоять на жодному маршруті, прибираємо
    # (старі ручні т.1–т.5 лишаються: на них є статті зупинок)
    used = {x['stopId'] for x in d['routeStops']}
    d['stops'] = [s for s in d['stops'] if s['id'] in used or s['id'] in OLD or not re.match(r'^№7 т\.\d+$', s['name'])]
    created = [p for p in created if p['id'] in used]
    return pool_around(d, '7', set(SIDE)), created


if __name__ == '__main__':
    put_routes(build, ROUTES, 'geom-6', '--apply' not in sys.argv, moved=set(SIDE))
