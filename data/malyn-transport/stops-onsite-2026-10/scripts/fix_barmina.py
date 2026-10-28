"""«Барміна» st_0007 — точка з місця (власник стояв на зупинці 2026-10-28, GPS з Google Maps) і шлях №8 / №11/1
на Чорновола.

Було 50.756380, 29.243686 — зупинка OSM «Вул. Барміна» на розі Чорновола й вул. Барміна (130 м від «Чорновола 10»).
Стало 50.754278, 29.249892 — павільйон OSM (node 5254015139, 8 м від GPS 50.75426, 29.249996) на розі вул. Барміна та
південного коліна Чорновола, 503 м на південний схід. Це кінцева з переліку 2024 («Кінцева. Містить криті місця для
сидіння», маршрути 1, 8, 10); сюди ж веде лінія №1 в OSM (relation 16654620 — Чорновола до самого коліна).

Шлях: автобус їде Чорновола на схід повз Вікторію, Чорновола 10 і 36, у коліні повертає на південь до Барміна,
розвертається й вертається тією самою дорогою через Чорновола 53 і 15 до світлофора (Мазепи). Тож:
- №8 «туди» (до вокзалу): Барміна → Чорновола 53 → Чорновола 15 → Мазепи 27 … (було: Чорновола 53 → 15 → Барміна →)
  «назад»: … Вікторія → Чорновола 10 → Чорновола 36 → Барміна (було: … 10 → Барміна → 36 → 53)
- №11/1 «туди»: … Вікторія → Чорновола 10 → Чорновола 36 → Барміна → Чорновола 53 → Чорновола 15 → Мазепи 27 …
  «назад»: … Вікторія → Чорновола 10 → Чорновола 36 → Барміна
  (було: … 10 → Барміна → Мазепи 27; Чорновола 36 / 53 / 15 на №11 не було — тепер автобус їх проїжджає)
Боки: на схід — південний (Вікторія, 10, 36), на захід — північний (53, 15); 36 і 53 — пара через дорогу в коліні (40 м).

Технічні точки ділянки (№11 т.14–т.15, №8 т.1, т.37, т.38, спільні №2 т.12–т.13) перебудовуються з геометрії
Чорновола й Мазепи з OSM (ways 183005376, 607217326, 1408420010) тими самими правилами, що в build_geometry.py
(Дуглас — Пекер 8 м, «зубці» до зупинок далі 10 м від дороги, наявні точки ближче 10 м беруться повторно);
решта ланцюжків — як була. Час: перегони поза ділянкою не змінюються; відрізки з новими парами зупинок рахуються
за моделлю recalculate-segments (12 с + довжина / 35 км/год, не менше 30 с, не повільніше 24 км/год) і діляться
за довжиною; --apply після PUT запускає recalculate-segments для №8 і №11 (правило з transport-stops-fix-2026-10.md).
Рейси не змінюються: у №11 прибуття фіксоване (arrivalTime), у №8 відправлення «туди» лишаються від першої
зупинки — тепер це Барміна, Чорновола 53 проїжджається на ~35 с пізніше.
Без --apply лише будує кандидата й перевіряє його валідатором. Токен: VIBER_ADMIN_TOKEN (змінна або ~/.zshrc)."""
import copy
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', '..', 'route-geometry-2026-10', 'scripts')))
from build_geometry import ANCHOR_MAX, MERGE, bends_for  # noqa: E402  (підтягує audit-2026-10/scripts)
import apply_lib  # noqa: E402
import common  # noqa: E402
from apply_lib import API, canon, chain, fetch, http_json, now, recalc, route_minutes, save, set_chains, validate  # noqa: E402
from common import dist_m, xy  # noqa: E402
from geo_lib import unxy  # noqa: E402

OUT = os.path.join('data', 'malyn-transport', 'stops-onsite-2026-10')
common.AUDIT = OUT  # знімки, кандидат і бекапи — у цій теці
STOP = 'st_0007'
OLD = (50.75638, 29.2436864)
NEW = (50.754278, 29.249892)  # OSM node 5254015139; GPS власника https://www.google.com/maps/place/50.75426,29.249996
ROUTES = ['8', '11']
CH53, CH36, CH15, CH10 = 'st_0094', 'st_0093', 'st_0092', 'st_0091'
JUNCTION_8, JUNCTION_11 = 'st_0192', 'st_0218'  # світлофор Мазепи × Чорновола: №2 т.12 (№8) і №11 т.15 (повернення №11)
# OSM way 183005376 «вулиця Вʼячеслава Чорновола» від світлофора до коліна + 607217326 до рогу з вул. Барміна
CHORNOVOLA = [
    (50.757509, 29.239951), (50.757512, 29.240069), (50.757509, 29.240111), (50.757502, 29.240155),
    (50.757471, 29.240268), (50.757286, 29.240916), (50.757062, 29.241656), (50.756792, 29.242524),
    (50.756582, 29.243220), (50.756500, 29.243491), (50.756415, 29.243768), (50.756252, 29.244388),
    (50.756226, 29.244518), (50.756217, 29.244588), (50.756210, 29.244675), (50.756206, 29.244816),
    (50.756206, 29.244948), (50.756211, 29.245121), (50.756221, 29.245339), (50.756259, 29.245982),
    (50.756266, 29.246150), (50.756271, 29.246308), (50.756276, 29.246536), (50.756276, 29.246688),
    (50.756268, 29.246838), (50.756249, 29.247027), (50.756193, 29.247392), (50.756093, 29.248061),
    (50.755979, 29.248805), (50.755941, 29.249076), (50.755913, 29.249260), (50.755894, 29.249347),
    (50.755874, 29.249414), (50.755838, 29.249485), (50.755784, 29.249556), (50.755728, 29.249611),
    (50.755685, 29.249640), (50.755644, 29.249659), (50.755609, 29.249671), (50.755527, 29.249681),
    (50.755298, 29.249720), (50.754862, 29.249770), (50.754505, 29.249826), (50.754357, 29.249853),
    (50.754334, 29.249850), (50.754311, 29.249838), (50.754292, 29.249823),
]
# OSM way 1408420010 «вулиця Івана Мазепи», від світлофора на північ (до Мазепи 27)
MAZEPY = [(50.757509, 29.239951), (50.757582, 29.23994), (50.757642, 29.23993), (50.757691, 29.239922), (50.75809, 29.239857)]
# ділянка кожного ланцюжка: (справжня зупинка, з якої починається, або None = початок; нові зупинки ділянки;
# точка, на якій ділянка закінчується і далі ланцюжок як був, або None = кінець)
WINDOWS = {
    ('8', 'orderThere'): (None, [STOP, CH53, CH15], JUNCTION_8),
    ('8', 'orderBack'): (CH10, [CH36, STOP], None),
    ('11', 'orderThere'): (CH10, [CH36, STOP, CH53, CH15], JUNCTION_11),
    ('11', 'orderBack'): (CH10, [CH36, STOP], None),
}
TECH = re.compile(r'^№\S+ т\.\d+$')


def project(poly, lat, lng):
    """(відстань до полілінії м, позиція вздовж м)."""
    px, py = xy(lat, lng)
    best, acc = None, 0.0
    for a, b in zip(poly, poly[1:]):
        (ax, ay), (bx, by) = xy(*a), xy(*b)
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy)
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (ln * ln)))
        d = math.hypot(px - ax - t * dx, py - ay - t * dy)
        if best is None or d < best[0]:
            best = (d, acc + t * ln)
        acc += ln
    return best


def sub(poly, s_from, s_to):
    """Шматок полілінії між позиціями s_from і s_to (м), у напрямку від s_from до s_to."""
    pts, acc = [], 0.0
    lo, hi = min(s_from, s_to), max(s_from, s_to)

    def at(s):
        a = 0.0
        for p, q in zip(poly, poly[1:]):
            ln = dist_m(*p, *q)
            if s <= a + ln or (p, q) == (poly[-2], poly[-1]):
                t = 0.0 if ln == 0 else max(0.0, min(1.0, (s - a) / ln))
                (px, py), (qx, qy) = xy(*p), xy(*q)
                return unxy(px + t * (qx - px), py + t * (qy - py))
            a += ln
        return poly[-1]

    pts.append(at(lo))
    for p, q in zip(poly, poly[1:]):
        acc += dist_m(*p, *q)
        if lo < acc < hi:
            pts.append(q)
    pts.append(at(hi))
    return pts if s_from <= s_to else list(reversed(pts))


def leg_path(st, a, b):
    """Шлях дорогою між точками a → b ділянки: Чорновола, а до світлофора (кінець ділянки «туди») — Чорновола
    до самого перехрестя; обидві точки мають стояти не далі ANCHOR_MAX від осі."""
    out = []
    for sid in (a, b):
        d, s = project(CHORNOVOLA, st[sid]['lat'], st[sid]['lng'])
        assert d <= ANCHOR_MAX, (sid, st[sid]['name'], round(d))
        out.append(s)
    return sub(CHORNOVOLA, out[0], out[1])


def span_seconds(span_m):
    """Модель recalculate-segments (backend/src/transport-segments.ts): пауза 12 с + довжина / 35 км/год
    (45 від 600 м), не менше 30 с і не повільніше 24 км/год."""
    speed = 45 if span_m >= 600 else 35
    sec = max(30, round(12 + span_m / 1000 / speed * 3600))
    return max(sec, round(span_m / 1000 / 24 * 3600))


def build(d):
    st = {s['id']: s for s in d['stops']}
    P = lambda i: (st[i]['lat'], st[i]['lng'])  # noqa: E731
    assert (round(st[STOP]['lat'], 6), round(st[STOP]['lng'], 6)) == (round(OLD[0], 6), round(OLD[1], 6)), 'зупинку вже переносили'
    st[STOP]['lat'], st[STOP]['lng'] = NEW
    print(f'{STOP} «{st[STOP]["name"]}»: {dist_m(*OLD, *NEW):.0f} м на південний схід, '
          f'{project(CHORNOVOLA, *NEW)[0]:.0f} м від осі Чорновола')

    shared = [s for s in d['stops'] if TECH.match(s['name'])]
    taken = {s['name'] for s in d['stops']}
    next_id = 1 + max(int(s['id'][3:]) for s in d['stops'] if re.match(r'^st_\d+$', s['id']))
    counters = {rid: max([int(m.group(1)) for s in d['stops'] for m in [re.match(rf'^№{rid} т\.(\d+)$', s['name'])] if m],
                         default=0) for rid in ROUTES}
    created, reused = [], set()

    def point_for(rid, pos, used):
        near = min(((dist_m(p['lat'], p['lng'], *pos), p['id']) for p in shared + created if p['id'] not in used),
                   default=(MERGE + 1, None))
        if near[0] <= MERGE:
            reused.add(near[1])
            return near[1]
        nonlocal next_id
        while True:
            counters[rid] += 1
            name = f'№{rid} т.{counters[rid]}'
            if name not in taken:
                break
        sid = f'st_{next_id:04d}'
        next_id += 1
        p = {'id': sid, 'name': name, 'lat': round(pos[0], 6), 'lng': round(pos[1], 6)}
        created.append(p)
        taken.add(name)
        st[sid] = p
        return sid

    old_chains, new_chains, old_window_tech = {}, {}, set()
    for rid in ROUTES:
        mo = {x['stopId'] for x in d['routeStops'] if x['routeId'] == rid and x.get('mapOnly')}
        for key in ('orderThere', 'orderBack'):
            old = chain(d, rid, key)
            old_chains[(rid, key)] = old
            first, middle, last = WINDOWS[(rid, key)]
            i0 = old.index(first) if first else -1
            i1 = old.index(last) if last else len(old)
            prefix, suffix = old[:i0 + 1], old[i1:]
            old_window_tech |= {x for x in old[i0 + 1:i1] if x in mo}
            seq = ([first] if first else []) + middle + ([last] if last else [])
            used = set(prefix) | set(suffix)
            out = list(prefix) if first else [seq[0]]
            for a, b in zip(seq, seq[1:]):
                for pos in bends_for(P(a), P(b), leg_path(st, a, b)):
                    sid = point_for(rid, pos, used)
                    used.add(sid)
                    out.append(sid)
                if b != last:
                    out.append(b)
            out += suffix
            assert len(out) == len(set(out)), (rid, key, 'дубль у ланцюжку')
            new_chains[(rid, key)] = out

    d['stops'] += [dict(p) for p in created]
    tech_ids = {s['id'] for s in d['stops'] if TECH.match(s['name'])}
    for rid in ROUTES:
        set_chains(d, rid, new_chains[(rid, 'orderThere')], new_chains[(rid, 'orderBack')], map_only=sorted(tech_ids))
        in_chains = set(new_chains[(rid, 'orderThere')]) | set(new_chains[(rid, 'orderBack')])
        d['routeStops'] = [x for x in d['routeStops'] if not (x['routeId'] == rid and x['stopId'] not in in_chains and x.get('mapOnly'))]
    referenced = {x['stopId'] for x in d['routeStops']} | {t.get(k) for t in d['trips'] for k in ('startStopId', 'endStopId')}
    removed = sorted(s for s in old_window_tech if s not in referenced)
    d['stops'] = [s for s in d['stops'] if s['id'] not in removed]

    # час: перегони поза ділянкою як були; відрізок з новою парою зупинок — за моделлю, поділ за довжиною
    seg = {(s['routeId'], s['fromStopId'], s['toStopId']): s['seconds'] for s in d['segments']}
    new_seg = {}
    for rid in ROUTES:
        mo = {x['stopId'] for x in d['routeStops'] if x['routeId'] == rid and x.get('mapOnly')}
        for key in ('orderThere', 'orderBack'):
            nc = new_chains[(rid, key)]
            starts = [i for i, x in enumerate(nc) if x not in mo]
            for i, j in zip(starts, starts[1:]):
                hops = list(zip(nc[i:j], nc[i + 1:j + 1]))
                if all((rid, p, q) in seg for p, q in hops):
                    for p, q in hops:
                        new_seg[(rid, p, q)] = seg[(rid, p, q)]
                    continue
                lens = [max(1.0, dist_m(*P(p), *P(q))) for p, q in hops]
                total = span_seconds(sum(lens))
                acc = prev = 0
                for (p, q), ln in zip(hops, lens):
                    acc += ln
                    cum = round(total * acc / sum(lens))
                    new_seg[(rid, p, q)] = max(1, cum - prev)  # спільний перегін «туди» / «назад» — як у бекенді, пізніший
                    prev = cum
                print(f'№{rid} {key}: новий відрізок {st[nc[i]]["name"]} → {st[nc[j]]["name"]} {sum(lens):.0f} м, {total} с')
    d['segments'] = [s for s in d['segments'] if s['routeId'] not in ROUTES] + \
        [{'routeId': r, 'fromStopId': p, 'toStopId': q, 'seconds': v} for (r, p, q), v in new_seg.items()]
    return d, created, removed, reused, old_chains, new_chains


def main():
    apply = '--apply' in sys.argv
    ts = now()
    cur = fetch()
    nxt, created, removed, reused, old_chains, new_chains = build(copy.deepcopy(cur))
    st = {s['id']: s for s in nxt['stops']}
    touched = {STOP} | {p['id'] for p in created} | set(removed)
    other = lambda d: {**d, 'routeStops': [x for x in d['routeStops'] if x['routeId'] not in ROUTES],  # noqa: E731
                       'segments': [x for x in d['segments'] if x['routeId'] not in ROUTES],
                       'stops': [s for s in d['stops'] if s['id'] not in touched]}
    assert canon(other(cur)) == canon(other(nxt)), f'змінилось щось поза №{", №".join(ROUTES)}, зупинкою і технічними точками'
    names = {s['id']: s['name'] for s in cur['stops']}
    print(f'нові точки: {", ".join(p["name"] for p in created) or "—"}; прибрано без маршруту: '
          f'{", ".join(names[i] for i in removed) or "—"}; взято повторно: {len(reused)}')
    tech_old = {s['id'] for s in cur['stops'] if TECH.match(s['name'])}
    tech_new = {s['id'] for s in nxt['stops'] if TECH.match(s['name'])}
    for (rid, key), nc in new_chains.items():
        first, middle, last = WINDOWS[(rid, key)]
        o = [names[x] for x in old_chains[(rid, key)] if x not in tech_old]
        n = [st[x]['name'] for x in nc if x not in tech_new]
        if first:  # показуємо ділянку: від зупинки, з якої вона починається, до першої зупинки після неї
            o, n = o[o.index(names[first]):], n[n.index(names[first]):]
        k_o = len(middle) + 2 if last else len(o)
        k_n = len(middle) + 2 if last else len(n)
        print(f'№{rid} {key}: {len(old_chains[(rid, key)])} → {len(nc)} точок; '
              f'{"…" if first else ""}{" → ".join(o[:k_o])}{"…" if last else ""}  ⇒  '
              f'{"…" if first else ""}{" → ".join(n[:k_n])}{"…" if last else ""}')
    for rid in ROUTES:
        print(f'№{rid}: хв туди/назад {route_minutes(cur, rid)} → {route_minutes(nxt, rid)}')
    validate(nxt, f'{ts}-barmina')
    print('валідатор: OK')
    if not apply:
        return
    save(apply_lib.path(f'db-{ts}-before-barmina.json'), cur, indent=None)
    tok = os.environ.get('VIBER_ADMIN_TOKEN') or apply_lib.token()
    apply_lib.token = lambda: tok
    res = http_json('PUT', f'{API}/transport/dataset', {**nxt, 'baseRevision': cur['revision']}, tok)
    after = fetch()
    save(apply_lib.path(f'db-{ts}-after-barmina.json'), after, indent=None)
    assert canon(after) == canon(nxt), 'після PUT база не збігається з відправленим'
    print(f'PUT: {res["counts"]}, revision {res["revision"]}; перевірка після PUT: OK')
    recalc('barmina', ROUTES)


if __name__ == '__main__':
    main()
