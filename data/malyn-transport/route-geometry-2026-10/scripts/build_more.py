"""Фаза 4–5: технічні точки для ліній №11 і №10 — ті самі правила, що для №5 і №2 (build_geometry.py).

Відмінності: точки №5 / №2 на спільних вулицях використовуємо повторно (у межах MERGE м); з №11 прибираємо його
старі точки т.1, т.5–т.10 (лишається спільна петля біля вокзалу т.2–т.4); зупинку «Малинівський круг» для
маршрутизації №11 ставимо на під'їзд з Грушевського (як №5), для №10 — на кільце біля зупинки (№10 їде
Мирутенкою; «назад» лінія доходить до зупинки західною дугою кільця і тією ж дугою повертається до Мирутенки).
№10 від Соборної і назад — через Залужного (точка «через» на ній), «Автостанція» назад — на осі Винниченка.
Час кожного відрізка між справжніми зупинками не змінюємо: ділимо поточний час відрізка між новими перегонами
за довжиною. Нічого не записує, якщо не передати --apply."""
import copy
import math
import os
import re
import sys

from build_geometry import KEEP_TECH, MERGE, anchor, bends_for
from geo_lib2 import chain, fetch, osrm_path, route_minutes, set_chains
from common import OSM, dist_m, load, xy
sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'audit-2026-10', 'scripts')))
from geo_lib import axis_point, lines, unxy  # noqa: E402

ROUTES = ['11', '10']
DROP_TECH = {'11': {'st_0101', 'st_0105', 'st_0106', 'st_0107', 'st_0108', 'st_0121', 'st_0122'}, '10': set()}
MK = 'st_0054'


def ring_points():
    els = load(os.path.join(OSM, 'streets.json'))['elements']
    ring = [(p['lat'], p['lon']) for w in els if w.get('tags', {}).get('junction') == 'roundabout'
            and w['tags'].get('name') == 'Малинівський круг' for p in w.get('geometry', [])]
    mir = [(p['lat'], p['lon']) for w in els if w.get('tags', {}).get('name') == 'вулиця Віктора Мирутенка'
           for p in w.get('geometry', [])]
    return ring, mir


def street_mid(name):
    """Середина вулиці за довжиною (точка «через» для маршрутизації)."""
    g = max(lines()[name], key=len)
    half, acc = sum(dist_m(*g[i], *g[i + 1]) for i in range(len(g) - 1)) / 2, 0.0
    for p, q in zip(g, g[1:]):
        step = dist_m(*p, *q)
        if acc + step >= half:
            t = (half - acc) / step
            return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
        acc += step
    return g[-1]


def via_points(st=None):
    """(маршрут, напрямок, зупинка, наступна зупинка) → проміжні точки дороги: OSRM вибирає коротший шлях, а
    автобус їде інакше. №10 від Соборної — Грушевського → Залужного → Винниченка (і так само назад), а не через площу."""
    zal = street_mid('вулиця Валерія Залужного')
    return {('10', 'orderThere', 'st_0070', 'st_0005'): [zal], ('10', 'orderBack', 'st_0004', 'st_0056'): [zal]}


def road(a, b, via=()):
    """Шлях дорогою a → (via…) → b."""
    pts = [a, *via, b]
    out = []
    for p, q in zip(pts, pts[1:]):
        part = osrm_path(p, q) or [p, q]
        out += part if not out else part[1:]
    return out


def osm_route_anchors(st, rid, rel, max_m, keys=('orderThere', 'orderBack')):
    """Зупинка ближче max_m до лінії маршруту з OSM (relation rel) → її проєкція на цю лінію (напрямки keys маршруту
    rid). Для доріг без назви в OSM, де загальне правило (найближча вулиця з назвою) чіпляє зупинку до сусідньої вулиці.
    Якщо relation описує лише один напрямок, а дорога там має дві окремі проїжджі частини, — передати лише його."""
    els = load(os.path.join(OSM, 'relations.json'))['elements']
    rel_ = next(e for e in els if e.get('type') == 'relation' and e['id'] == rel)
    ways = {e['id']: e for e in els if e.get('type') == 'way'}
    lines_ = [[(p['lat'], p['lon']) for p in ways[m['ref']]['geometry']] for m in rel_['members']
              if m['type'] == 'way' and m.get('role') in ('', 'forward', 'backward')
              and ways[m['ref']].get('tags', {}).get('highway') != 'bus_stop']
    segs = [(xy(*p), xy(*q)) for g in lines_ for p, q in zip(g, g[1:])]
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
        if best and best[0] <= max_m:
            for key in keys:
                out[(rid, key, sid)] = unxy(*best[1])
    return out


def osm_ways_projection(p, way_ids):
    """Найближча до p точка на дорогах OSM way_ids (геометрія з кешу relations.json або streets.json)."""
    els = load(os.path.join(OSM, 'relations.json'))['elements'] + load(os.path.join(OSM, 'streets.json'))['elements']
    geoms = {e['id']: [(q['lat'], q['lon']) for q in e['geometry']] for e in els
             if e.get('type') == 'way' and e['id'] in way_ids and e.get('geometry')}
    assert set(geoms) == set(way_ids), set(way_ids) - set(geoms)
    px, py = xy(*p)
    best = None
    for g in geoms.values():
        for a, b in zip(g, g[1:]):
            (ax, ay), (bx, by) = xy(*a), xy(*b)
            dx, dy = bx - ax, by - ay
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) or 1)))
            d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if best is None or d < best[0]:
                best = (d, unxy(ax + t * dx, ay + t * dy))
    return best[1]


def street_between(name, a, b):
    """Шлях уздовж вулиці name від проєкції точки a до проєкції b (вершини вулиці між ними, у порядку руху).
    Для ділянок, які OSRM об'їжджає, бо в OSM вулиця не з'єднана з сусідньою."""
    g = min(lines()[name], key=lambda g: min(dist_m(*a, *p) for p in g))
    pts = [xy(*p) for p in g]

    def proj(p):
        px, py = xy(*p)
        best = None
        for i, ((ax, ay), (bx, by)) in enumerate(zip(pts, pts[1:])):
            dx, dy = bx - ax, by - ay
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) or 1)))
            d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if best is None or d < best[0]:
                best = (d, i + t, unxy(ax + t * dx, ay + t * dy))
        return best[1], best[2]

    (ta, pa), (tb, pb) = proj(a), proj(b)
    inner = [g[i] for i in range(math.ceil(ta), math.floor(tb) + 1)] if ta <= tb else \
        [g[i] for i in range(math.floor(ta), math.ceil(tb) - 1, -1)]
    return [pa, *inner, pb]


def mk_exit_mirutenka():
    """Точка кільця, де з нього з'їжджають на Мирутенка."""
    ring, mir = ring_points()
    c = (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
    mir_end = min(mir, key=lambda p: dist_m(*p, *c))
    return min(ring, key=lambda p: dist_m(*p, *mir_end))


def leg_path(st, special, via, rid, key, a, b, aa, bb):
    """Шлях дорогою для перегону a → b (aa, bb — точки маршрутизації).
    №10 «назад» з Огієнка повертає на Мирутенка північною стороною кільця, а зупинка «Малинівський круг» —
    з південно-західного боку. Щоб лінія не перетинала кільце навпростець, від зупинки повертаємось західною
    дугою кільця (тією, якою до неї доїхали) до з'їзду на Мирутенка."""
    if (rid, key, a) == ('10', 'orderBack', MK):
        exit_ = mk_exit_mirutenka()
        prev = special.get((rid, key, 'st_0063'), anchor(st, 'st_0063'))  # Огієнка 65 (БАМ) (навпроти)
        to_stop = road(prev, aa)
        k = min(range(len(to_stop)), key=lambda i: dist_m(*to_stop[i], *exit_))
        return list(reversed(to_stop[k:])) + road(exit_, bb)[1:]
    return road(aa, bb, via.get((rid, key, a, b), ()))


def anchors(st):
    """(маршрут, напрямок, зупинка) → точка маршрутизації, що відрізняється від загального правила."""
    _, (cx, cy), _ = axis_point(st[MK]['lat'], st[MK]['lng'], 'Малинівський круг')
    return {
        ('11', 'orderThere', MK): anchor(st, MK), ('11', 'orderBack', MK): anchor(st, MK),  # Грушевського
        # №10 їде Мирутенкою, не Грушевського: точка кільця біля зупинки (обидва напрямки, див. leg_path)
        ('10', 'orderThere', MK): unxy(cx, cy), ('10', 'orderBack', MK): unxy(cx, cy),
        # «Автостанція» — на Винниченка (західний бік, рух на південь), а не на Черешневій поруч
        ('10', 'orderBack', 'st_0004'): unxy(*axis_point(st['st_0004']['lat'], st['st_0004']['lng'],
                                                          'вулиця Володимира Винниченка')[1]),
    }


def tech_ids(d, rid):
    return {x['stopId'] for x in d['routeStops'] if x['routeId'] == rid and x.get('mapOnly')}


def build(d):
    """№10 і №11. Перевикористовуємо технічні точки №5 / №2 (спільні вулиці) і вже створені для №10 / №11
    (повторний запуск на записаній базі нічого не змінює)."""
    return build_routes(d, ROUTES, drop=DROP_TECH, special_fn=anchors, via_fn=via_points, leg_fn=leg_path,
                        pool=r'^№(5|2|10|11) т\.\d+$', pool_skip=KEEP_TECH | set().union(*DROP_TECH.values()))


def build_routes(d, routes, drop=None, special_fn=None, via_fn=None, leg_fn=None, pool=r'^№\S+ т\.\d+$',
                 pool_skip=frozenset(), keep=KEEP_TECH):
    """Технічні точки для маршрутів routes (мутує датасет d) → (d, створені точки).
    drop — {маршрут: старі технічні точки, які прибрати з ланцюжків}; special_fn(st) — {(маршрут, напрямок,
    зупинка): точка маршрутизації}; via_fn(st) — {(маршрут, напрямок, зупинка, наступна): [точки «через»]};
    leg_fn(st, special, via, маршрут, напрямок, a, b, aa, bb) — шлях перегону (за замовчуванням OSRM через via);
    pool / pool_skip — які наявні технічні точки можна перевикористати (назва за шаблоном, крім pool_skip);
    keep — технічні точки, що лишаються в ланцюжку як є (петля біля вокзалу №10 / №11)."""
    drop = drop or {}
    st = {s['id']: s for s in d['stops']}
    P = lambda i: (st[i]['lat'], st[i]['lng'])  # noqa: E731
    special = special_fn(st) if special_fn else {}
    via = via_fn(st) if via_fn else {}
    leg = leg_fn or (lambda st_, sp, vi, rid, key, a, b, aa, bb: road(aa, bb, vi.get((rid, key, a, b), ())))
    shared = [s for s in d['stops'] if re.match(pool, s['name']) and s['id'] not in pool_skip]
    taken_names = {s['name'] for s in d['stops']}
    next_id = 1 + max(int(s['id'][3:]) for s in d['stops'] if re.match(r'^st_\d+$', s['id']))
    created, new_chains, old_chains = [], {}, {}
    counters = {}
    for rid in routes:
        nums = [int(m.group(1)) for s in d['stops'] for m in [re.match(rf'^№{rid} т\.(\d+)$', s['name'])] if m]
        counters[rid] = max(nums, default=0)

    def point_for(rid, pos, used):
        # найближча вільна точка в межах MERGE (у напрямку точка може бути лише раз)
        near = min(((dist_m(p['lat'], p['lng'], *pos), p['id']) for p in shared + created if p['id'] not in used),
                   default=(MERGE + 1, None))
        if near[0] <= MERGE:
            return near[1]
        nonlocal next_id
        while True:
            counters[rid] += 1
            name = f'№{rid} т.{counters[rid]}'
            if name not in taken_names:
                break
        sid = f'st_{next_id:04d}'
        next_id += 1
        p = {'id': sid, 'name': name, 'lat': round(pos[0], 6), 'lng': round(pos[1], 6)}
        created.append(p)
        taken_names.add(name)
        st[sid] = p
        return sid

    for rid in routes:
        mo = tech_ids(d, rid)
        for key in ('orderThere', 'orderBack'):
            old = chain(d, rid, key)
            old_chains[(rid, key)] = old
            base = [x for x in old if x not in mo or x in keep]
            assert not set(base) & drop.get(rid, set()), (rid, key)
            out, used = [base[0]], set()
            for a, b in zip(base, base[1:]):
                aa = P(a) if a in keep else special.get((rid, key, a), anchor(st, a))
                bb = P(b) if b in keep else special.get((rid, key, b), anchor(st, b))
                path = leg(st, special, via, rid, key, a, b, aa, bb)
                for pos in bends_for(P(a), P(b), path):
                    sid = point_for(rid, pos, used)
                    used.add(sid)
                    out.append(sid)
                out.append(b)
            new_chains[(rid, key)] = out

    d['stops'] += [{k: p[k] for k in ('id', 'name', 'lat', 'lng')} for p in created]
    new_tech = {p['id'] for p in created} | {s['id'] for s in shared}
    for rid in routes:
        set_chains(d, rid, new_chains[(rid, 'orderThere')], new_chains[(rid, 'orderBack')], map_only=sorted(new_tech))
        # рядки технічних точок, яких немає в нових ланцюжках (старі й ті, що лишились без повороту), прибираємо
        in_chains = set(new_chains[(rid, 'orderThere')]) | set(new_chains[(rid, 'orderBack')])
        d['routeStops'] = [x for x in d['routeStops'] if not (x['routeId'] == rid and x['stopId'] not in in_chains
                                                               and (x.get('mapOnly') or x['stopId'] in drop.get(rid, set())))]

    # час: кожен відрізок між сусідніми справжніми зупинками — як був, ділимо за довжиною
    default = d['meta'].get('defaultSec', 120)
    seg = {(s['routeId'], s['fromStopId'], s['toStopId']): s['seconds'] for s in d['segments']}
    segments = [s for s in d['segments'] if s['routeId'] not in routes]
    new_seg = {}  # пара може повторюватись у «туди» й «назад» (№11: фабрика → Барміна) — один сегмент на пару
    for rid in routes:
        mo_new = {x['stopId'] for x in d['routeStops'] if x['routeId'] == rid and x.get('mapOnly')}
        for key in ('orderThere', 'orderBack'):
            oc, nc = old_chains[(rid, key)], new_chains[(rid, key)]
            idx = {x: i for i, x in enumerate(oc)}
            starts = [i for i, x in enumerate(nc) if x not in mo_new]
            for i, j in zip(starts, starts[1:]):
                a, b = nc[i], nc[j]
                assert idx[a] < idx[b], (rid, key, a, b)
                hops = list(zip(nc[i:j], nc[i + 1:j + 1]))
                if oc[idx[a]:idx[b] + 1] == nc[i:j + 1]:  # відрізок не змінився — час перегонів як є
                    for p, q in hops:
                        new_seg.setdefault((rid, p, q), seg.get((rid, p, q), default))
                    continue
                span = sum(seg.get((rid, oc[k], oc[k + 1]), default) for k in range(idx[a], idx[b]))
                lens = [max(1.0, dist_m(*P(p), *P(q))) for p, q in hops]
                acc = prev = 0
                for (p, q), ln in zip(hops, lens):
                    acc += ln
                    cum = round(span * acc / sum(lens))
                    sec = max(1, cum - prev)
                    prev = cum
                    if (rid, p, q) in new_seg:
                        assert abs(new_seg[(rid, p, q)] - sec) <= 1, (rid, p, q, new_seg[(rid, p, q)], sec)
                        continue
                    new_seg[(rid, p, q)] = sec
    segments += [{'routeId': r, 'fromStopId': p, 'toStopId': q, 'seconds': v} for (r, p, q), v in new_seg.items()]
    d['segments'] = segments
    return d, created


def put(dry):
    put_routes(build, ROUTES, 'geom-2', dry)


def put_routes(build_fn, routes, tag, dry, moved=()):
    """Свіжий датасет → build_fn → перевірки (поза маршрутами routes, новими точками й координатами зупинок moved
    нічого не змінилось, валідатор) → кандидат; з --apply — бекап, PUT, перевірка «після PUT = кандидат»."""
    from apply_lib import API, canon, http_json, now, save, token, validate
    from common import path
    ts = now()
    cur = fetch()
    nxt, created = build_fn(copy.deepcopy(cur))
    removed = {s['id'] for s in cur['stops']} - {s['id'] for s in nxt['stops']}
    refs = {x['stopId'] for x in nxt['routeStops']} | {x[k] for x in nxt['segments'] for k in ('fromStopId', 'toStopId')} \
        | {x.get(k) for x in nxt['trips'] for k in ('startStopId', 'endStopId')}
    for s in cur['stops']:
        if s['id'] in removed:  # прибирати можна лише технічні точки, на які ніщо не посилається
            assert re.match(r'^№\S+ т\.\d+$', s['name']) and s['id'] not in refs, s
            print(f"[{tag}] прибрано точку без маршруту: {s['name']} ({s['id']})")
    skip = {p['id'] for p in created} | set(moved) | removed
    other = lambda d: {**d, 'routeStops': [x for x in d['routeStops'] if x['routeId'] not in routes],  # noqa: E731
                       'segments': [x for x in d['segments'] if x['routeId'] not in routes],
                       'stops': [s for s in d['stops'] if s['id'] not in skip]}
    assert canon(other(cur)) == canon(other(nxt)), f'змінилось щось поза {routes} і новими точками'
    before = {s['id']: s for s in cur['stops']}
    for s in nxt['stops']:
        if s['id'] in moved:
            b = before[s['id']]
            assert {k: v for k, v in s.items() if k not in ('lat', 'lng')} == {k: v for k, v in b.items() if k not in ('lat', 'lng')}
            if (b['lat'], b['lng']) != (s['lat'], s['lng']):
                print(f"[{tag}] зупинка {s['name']}: {b['lat']:.6f},{b['lng']:.6f} → {s['lat']:.6f},{s['lng']:.6f}"
                      f" ({dist_m(b['lat'], b['lng'], s['lat'], s['lng']):.0f} м)")
    if canon(nxt) == canon(cur):
        print(f'[{tag}] змін немає — база вже з цими точками')
        return
    validate(nxt, f'{ts}-{tag}')
    print(f'[{tag}] валідатор: OK; нових точок {len(created)}:', ', '.join(p['name'] for p in created[:3]), '…')
    for rid in routes:
        print(f'№{rid}: хв {route_minutes(cur, rid)} → {route_minutes(nxt, rid)}; точок туди/назад '
              f'{len(chain(cur, rid, "orderThere"))}/{len(chain(cur, rid, "orderBack"))} → '
              f'{len(chain(nxt, rid, "orderThere"))}/{len(chain(nxt, rid, "orderBack"))}')
    save(path(f'db-{ts}-{tag}-candidate.json'), nxt, indent=None)
    if dry:
        return
    save(path(f'db-{ts}-before-{tag}.json'), cur, indent=None)
    tok = token()
    assert canon(fetch()) == canon(cur), 'база змінилась після знімка'
    res = http_json('PUT', f'{API}/transport/dataset', nxt, tok)
    after = fetch()
    save(path(f'db-{ts}-after-{tag}.json'), after, indent=None)
    assert canon(after) == canon(nxt), 'після PUT база не збігається'
    print(f'[{tag}] PUT:', res['counts'], '| перевірка після PUT: OK')


if __name__ == '__main__':
    put('--apply' not in sys.argv)
