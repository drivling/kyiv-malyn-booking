"""Фаза 1: технічні точки для ліній №5 і №2 на карті — кандидат датасету (без запису в базу).

Для кожного напрямку: ланцюжок справжніх зупинок (+ спільні точки петлі біля вокзалу №11 т.2–т.4), шлях
дорогою між сусідніми точками (OSRM; зупинку для маршрутизації проєктуємо на вісь її вулиці), точки повороту
(Дуглас — Пекер, EPS м). Точки в межах MERGE м спільні для напрямків і маршрутів. Старі №11 т.1, т.5–т.8
з ланцюжків №5 і №2 прибираємо (у №11 вони лишаються). №2 «назад» — без «Мазепи 27» (протилежний бік, як у №11).
Вихід: candidate.json (повний датасет для перегляду / запису) і звіт по перегонах."""
import copy
import json
import os
import sys

from geo_lib2 import chain, douglas_peucker, fetch, max_dev, osrm_path, path_len, set_chains
from common import dist_m
sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'audit-2026-10', 'scripts')))
from geo_lib import axis_point, lines, unxy  # noqa: E402

EPS = 8.0        # м — наскільки лінія може відходити від дороги
MERGE = 10.0     # м — точки ближче за це вважаємо однією
ANCHOR_MAX = 40  # м — далі від вулиці зупинку не проєктуємо
OUT = os.path.join('data', 'malyn-transport', 'route-geometry-2026-10')
KEEP_TECH = {'st_0102', 'st_0103', 'st_0104'}            # петля біля вокзалу (спільна для 3, 5, 10, 11, 12)
DROP_TECH = {'st_0101', 'st_0105', 'st_0106', 'st_0107', 'st_0108'}  # №11 т.1, т.5–т.8
ANCHOR_STREET = {'st_0054': 'вулиця Михайла Грушевського'}  # «Малинівський круг» — під'їзд, не саме кільце
DROP_STOP = {('2', 'orderBack'): {'st_0024'}}             # Мазепи 27 у №2 «назад» — протилежний бік
FIRST_ID = 123
TICK_OFFSET = 10.0  # м — зупинка далі від дороги: лінія підходить до неї вузьким «зубцем»
TICK_ALONG = 8.0    # м — точки підходу й відходу вздовж дороги від проєкції зупинки


def along(path, dist, from_end=False):
    """Індекс точки шляху приблизно на відстані dist від початку (або кінця)."""
    idx = range(len(path) - 1, 0, -1) if from_end else range(len(path) - 1)
    acc = 0.0
    for i in idx:
        j = i - 1 if from_end else i + 1
        acc += dist_m(*path[i], *path[j])
        if acc >= dist:
            return j
    return 0 if from_end else len(path) - 1


def densify(path, step=4.0):
    """Проміжні точки на прямих відрізках шляху через ~step м (щоб точки підходу ставали точно за TICK_ALONG м)."""
    out = [path[0]]
    for p, q in zip(path, path[1:]):
        n = int(dist_m(*p, *q) // step)
        out += [(p[0] + (q[0] - p[0]) * k / (n + 1), p[1] + (q[1] - p[1]) * k / (n + 1)) for k in range(1, n + 1)]
        out.append(q)
    return out


def bends_for(pa, pb, path):
    """Точки повороту перегону: Дуглас — Пекер по шляху дорогою; біля зупинок, що стоять далі TICK_OFFSET
    від дороги, — точки підходу й відходу за TICK_ALONG м від проєкції, щоб «зубець» до зупинки був вузьким."""
    path = densify(path)
    pts = [pa] + path[1:-1] + [pb]
    cuts = [0]
    if len(path) > 2 and dist_m(*pa, *path[0]) > TICK_OFFSET:
        cuts.append(max(1, along(path, TICK_ALONG)))
    if len(path) > 2 and dist_m(*pb, *path[-1]) > TICK_OFFSET:
        cuts.append(min(len(pts) - 2, along(path, TICK_ALONG, from_end=True)))
    cuts.append(len(pts) - 1)
    cuts = sorted(set(cuts))
    keep = set(cuts)
    for i, j in zip(cuts, cuts[1:]):
        if j - i > 1:
            keep |= {i + k for k in douglas_peucker(pts[i:j + 1], EPS)}
    return [pts[k] for k in sorted(keep)[1:-1]]


def anchor(st, sid):
    """Точка для маршрутизації: проєкція зупинки на вісь її вулиці (або сама зупинка)."""
    s = st[sid]
    names = [ANCHOR_STREET[sid]] if sid in ANCHOR_STREET else list(lines())
    best = min(((axis_point(s['lat'], s['lng'], n)[0], n) for n in names), default=None)
    if not best or best[0] > ANCHOR_MAX:
        return (s['lat'], s['lng'])
    d, (cx, cy), _ = axis_point(s['lat'], s['lng'], best[1])
    return unxy(cx, cy)


def build_candidate(d):
    """Додає технічні точки в датасет d (мутує) і повертає (d, створені точки, звіт, нові ланцюжки)."""
    st = {s['id']: s for s in d['stops']}
    P = lambda i: (st[i]['lat'], st[i]['lng'])  # noqa: E731
    taken_names = {s['name'] for s in d['stops']}
    created = []          # [{'id','name','lat','lng','routes': set()}]
    counters = {'5': 0, '2': 0}
    report, new_chains = [], {}

    def point_for(rid, pos, used):
        for p in created:
            if p['id'] not in used and dist_m(p['lat'], p['lng'], *pos) <= MERGE:
                return p['id']
        while True:
            counters[rid] += 1
            name = f'№{rid} т.{counters[rid]}'
            if name not in taken_names:
                break
        sid = f'st_{FIRST_ID + len(created):04d}'
        assert sid not in st, sid
        p = {'id': sid, 'name': name, 'lat': round(pos[0], 6), 'lng': round(pos[1], 6)}
        created.append(p)
        taken_names.add(name)
        st[sid] = p
        return sid

    for rid in ('5', '2'):
        mo = {x['stopId'] for x in d['routeStops'] if x['routeId'] == rid and x.get('mapOnly')}
        for key in ('orderThere', 'orderBack'):
            base = [x for x in chain(d, rid, key)
                    if (x not in mo or x in KEEP_TECH) and x not in DROP_STOP.get((rid, key), set())]
            assert not (set(base) & DROP_TECH)
            out, used = [base[0]], set()
            for a, b in zip(base, base[1:]):
                aa = P(a) if a in KEEP_TECH else anchor(st, a)
                bb = P(b) if b in KEEP_TECH else anchor(st, b)
                path = osrm_path(aa, bb) or [aa, bb]
                bends = bends_for(P(a), P(b), path)
                road, straight = path_len(path), dist_m(*P(a), *P(b))
                report.append(dict(route=rid, dir=key, an=st[a]['name'], bn=st[b]['name'], straight=round(straight),
                                   road=round(road), dev=round(max_dev(path, P(a), P(b))), bends=len(bends),
                                   detour=road > 1.6 * straight and road - straight > 150))
                for pos in bends:
                    sid = point_for(rid, pos, used)
                    used.add(sid)
                    out.append(sid)
                out.append(b)
            new_chains[(rid, key)] = out

    d['stops'] += [{k: p[k] for k in ('id', 'name', 'lat', 'lng')} for p in created]
    for rid in ('5', '2'):
        set_chains(d, rid, new_chains[(rid, 'orderThere')], new_chains[(rid, 'orderBack')],
                   map_only=[p['id'] for p in created])
        # прибрати з маршруту рядки старих технічних точок і вимкнених зупинок без жодного напрямку
        d['routeStops'] = [x for x in d['routeStops'] if not (x['routeId'] == rid and x['stopId'] in DROP_TECH)]
    return d, created, report, new_chains, counters


def main():
    d, created, report, new_chains, counters = build_candidate(copy.deepcopy(fetch()))
    st = {s['id']: s for s in d['stops']}
    json.dump(d, open(os.path.join(OUT, 'candidate.json'), 'w'), ensure_ascii=False)
    json.dump(report, open(os.path.join(OUT, 'candidate-report.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'нових технічних точок: {len(created)} (№5 т.1…т.{counters["5"]}, №2 т.1…т.{counters["2"]})')
    for (rid, key), c in new_chains.items():
        tech = sum(1 for x in c if st[x]['name'].startswith('№'))
        print(f'№{rid} {key}: {len(c)} точок, з них технічних {tech}')
    for r in report:
        if r['detour']:
            print(f"⚠ обхід: №{r['route']} {r['dir']} {r['an']} → {r['bn']}: {r['straight']} → {r['road']} м")


if __name__ == '__main__':
    main()
