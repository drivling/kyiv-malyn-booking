"""Термінове виправлення після geom-1: перерахунок на сервері дає кожному перегону щонайменше 30 с, тож десятки
коротких технічних перегонів роздули час №5 і №2 майже вдвічі. Тут час кожного відрізка між сусідніми справжніми
зупинками береться з бекапу перед geom-1 (як було) і ділиться між новими перегонами пропорційно довжині.
Геометрія не змінюється."""
import glob
import json
import sys

from geo_lib2 import apply_change, chain, route_minutes
from common import dist_m, path, load

BEFORE = sorted(glob.glob(path('db-*-before-geom-1.json')))[-1]


def real(d, rid):
    return {x['stopId'] for x in d['routeStops'] if x['routeId'] == rid and not x.get('mapOnly')}


def build(d):
    old = load(BEFORE)
    ost = {s['id']: s for s in old['stops']}
    st = {s['id']: s for s in d['stops']}
    oseg = {(s['routeId'], s['fromStopId'], s['toStopId']): s['seconds'] for s in old['segments']}
    new_segments = [s for s in d['segments'] if s['routeId'] not in ('2', '5')]
    for rid in ('5', '2'):
        for key in ('orderThere', 'orderBack'):
            oc, nc = chain(old, rid, key), chain(d, rid, key)
            ro, rn = real(old, rid), real(d, rid)
            o_real = [x for x in oc if x in ro]
            n_real = [x for x in nc if x in rn]
            # №2 «назад»: «Мазепи 27» прибрано; решта справжніх зупинок — ті самі й у тому самому порядку
            assert [x for x in o_real if x in n_real] == n_real, (rid, key)
            idx_old = {x: i for i, x in enumerate(oc)}
            starts = [i for i, x in enumerate(nc) if x in rn]
            for i, j in zip(starts, starts[1:]):
                a, b = nc[i], nc[j]
                ia, ib = idx_old[a], idx_old[b]
                assert ia < ib, (rid, key, a, b)
                span_old = sum(oseg.get((rid, oc[k], oc[k + 1]), old['meta'].get('defaultSec', 120)) for k in range(ia, ib))
                hops = list(zip(nc[i:j], nc[i + 1:j + 1]))
                lens = [max(1.0, dist_m(st[p]['lat'], st[p]['lng'], st[q]['lat'], st[q]['lng'])) for p, q in hops]
                total = sum(lens)
                acc_prev = 0
                for k, ((p, q), ln) in enumerate(zip(hops, lens)):
                    # накопичене округлення, щоб сума відрізка дорівнювала старій точно
                    acc = round(span_old * sum(lens[:k + 1]) / total)
                    new_segments.append({'routeId': rid, 'fromStopId': p, 'toStopId': q, 'seconds': max(1, acc - acc_prev)})
                    acc_prev = acc
    d['segments'] = new_segments
    return d


def put_segments(dry):
    """Як apply_change, але дозволяє змінити лише сегменти №2 і №5 (усе інше — без змін)."""
    import copy, os
    from apply_lib import API, canon, http_json, now, save, token, validate, fetch
    ts = now()
    cur = fetch()
    nxt = build(copy.deepcopy(cur))
    strip = lambda d: {**d, 'segments': [s for s in d['segments'] if s['routeId'] not in ('2', '5')]}  # noqa: E731
    assert canon(strip(cur)) == canon(strip(nxt)), 'змінилось щось, крім сегментів №2 і №5'
    validate(nxt, f'{ts}-geom-1-times')
    print('[geom-1-times] валідатор: OK')
    for r in ('5', '2'):
        print(f'№{r}: до geom-1 {route_minutes(load(BEFORE), r)} | зараз {route_minutes(cur, r)} | буде {route_minutes(nxt, r)}')
    if dry:
        return
    save(path(f'db-{ts}-before-geom-1-times.json'), cur, indent=None)
    tok = token()
    assert canon(fetch()) == canon(cur), 'база змінилась після знімка'
    res = http_json('PUT', f'{API}/transport/dataset', nxt, tok)
    after = fetch()
    save(path(f'db-{ts}-after-geom-1-times.json'), after, indent=None)
    assert canon(after) == canon(nxt), 'після PUT база не збігається'
    print('[geom-1-times] PUT:', res['counts'], '| перевірка після PUT: OK')


if __name__ == '__main__':
    put_segments('--apply' not in sys.argv)
