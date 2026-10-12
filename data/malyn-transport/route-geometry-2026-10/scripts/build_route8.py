"""Фаза 6: технічні точки для лінії №8 — ті самі правила, що для №10 / №11 (build_more.build_routes).

№8 «Базар – Вокзал по вул. Миру»: Чорновола → Барміна → Мазепи → Кооперативний ринок → Бандери → Городищанська →
Миру → Покровська → вокзал. На сході дорога в OSM здебільшого без назви («вулиця Миру» — коротка ділянка), тож
загальне правило (проєкція на найближчу вулицю з назвою) чіпляло зупинки «Миру – ГМП» до Мелещенка / Яремчука, і
OSRM вів провулками. Тут зупинку для маршрутизації проєктуємо на лінію маршруту №8 з OSM (relation 17747121), якщо
вона ближче REL_MAX; інакше — загальне правило. Перевикористовуємо всі наявні технічні точки (№2, №5, №7, №9, №10,
№11, петля біля вокзалу), крім старих точок №11, що лишились без маршруту.
Біля вокзалу «назад» — через петлю навколо привокзальної площі (т.3 → т.4), як у OSM і як їздять №5, №10, №11:
OSRM повертав автобус від зупинки тією самою дорогою. Час кожного відрізка між справжніми зупинками не змінюємо. Нічого не записує, якщо не передати --apply."""
import math
import os
import sys

from build_more import DROP_TECH, build_routes, put_routes
from common import OSM, load, xy
from geo_lib import unxy

ROUTES = ['8']
REL = 17747121   # OSM: «Залізничний вокзал - Центр #8», via «ч/з вулиця Миру»
REL_MAX = 35.0   # м — далі від лінії OSM зупинку не проєктуємо


def rel_lines():
    """Дороги маршруту №8 з OSM (без майданчиків зупинок)."""
    els = load(os.path.join(OSM, 'relations.json'))['elements']
    rel = next(e for e in els if e.get('type') == 'relation' and e['id'] == REL)
    ways = {e['id']: e for e in els if e.get('type') == 'way'}
    return [[(p['lat'], p['lon']) for p in ways[m['ref']]['geometry']] for m in rel['members']
            if m['type'] == 'way' and m.get('role') in ('', 'forward', 'backward')
            and ways[m['ref']].get('tags', {}).get('highway') != 'bus_stop']


def anchors(st):
    """Зупинка ближче REL_MAX до лінії №8 з OSM → її проєкція на цю лінію (обидва напрямки №8)."""
    segs = [(xy(*p), xy(*q)) for g in rel_lines() for p, q in zip(g, g[1:])]
    out = {}
    for sid, s in st.items():
        px, py = xy(s['lat'], s['lng'])
        best = None
        for (ax, ay), (bx, by) in segs:
            dx, dy = bx - ax, by - ay
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) or 1)))
            cx, cy = ax + t * dx, ay + t * dy
            d = math.hypot(px - cx, py - cy)
            if best is None or d < best[0]:
                best = (d, (cx, cy))
        if best and best[0] <= REL_MAX:
            for key in ('orderThere', 'orderBack'):
                out[('8', key, sid)] = unxy(*best[1])
    return out


def via_points(st):
    """Вокзал → ЗОШ 5 («назад»): навколо привокзальної площі північним боком (№11 т.3, т.4)."""
    loop = [(st[i]['lat'], st[i]['lng']) for i in ('st_0103', 'st_0104')]
    return {('8', 'orderBack', 'st_0019', 'st_0021'): loop}


def build(d):
    return build_routes(d, ROUTES, special_fn=anchors, via_fn=via_points, pool_skip=set().union(*DROP_TECH.values()),
                        keep=frozenset())


if __name__ == '__main__':
    put_routes(build, ROUTES, 'geom-3', '--apply' not in sys.argv)
