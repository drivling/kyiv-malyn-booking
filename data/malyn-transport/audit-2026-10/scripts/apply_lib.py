"""Спільне для фаз виправлення (Docs/transport-stops-fix-2026-10.md): знімки, перевірка обсягу змін,
валідація, PUT, перерахунок сегментів. Мережа — лише prod API; токен з ~/.zshrc, нікуди не друкується."""
import copy
import datetime
import json
import os
import subprocess
import sys
import urllib.request

from common import API, UA, load, path, save


def now():
    return datetime.datetime.now().strftime('%Y-%m-%dT%H%M%S')


def token():
    t = subprocess.run(['zsh', '-ic', 'printf %s "${VIBER_ADMIN_TOKEN:-}"'], capture_output=True, text=True).stdout
    if len(t) != 64:
        sys.exit('VIBER_ADMIN_TOKEN не знайдено в ~/.zshrc')
    return t


def http_json(method, url, body=None, tok=None, timeout=300):
    req = urllib.request.Request(url, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', 'Accept': 'application/json',
                                          'User-Agent': UA, **({'Authorization': tok} if tok else {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b'null')


def fetch():
    return http_json('GET', f'{API}/transport/dataset')


def canon(d, drop_default_sec=False):
    meta = {k: v for k, v in d['meta'].items() if not (drop_default_sec and k == 'defaultSec')}
    return json.dumps({
        'stops': sorted(d['stops'], key=lambda x: x['id']),
        'routes': sorted(d['routes'], key=lambda x: x['id']),
        'routeStops': sorted(d['routeStops'], key=lambda x: (x['routeId'], x['stopId'])),
        'trips': sorted(d['trips'], key=lambda x: x['id']),
        'segments': sorted(d['segments'], key=lambda x: (x['routeId'], x['fromStopId'], x['toStopId'])),
        'meta': meta,
    }, ensure_ascii=False, sort_keys=True)


def scope(a, b):
    """Що саме відрізняється між двома датасетами (без сегментів)."""
    out = {'stops': set(), 'routes': set()}
    sa, sb = {s['id']: s for s in a['stops']}, {s['id']: s for s in b['stops']}
    out['stops'] = {i for i in sa.keys() | sb.keys() if sa.get(i) != sb.get(i)}
    ra, rb = {r['id']: r for r in a['routes']}, {r['id']: r for r in b['routes']}
    out['routes'] |= {i for i in ra.keys() | rb.keys() if ra.get(i) != rb.get(i)}
    rsa = {(x['routeId'], x['stopId']): x for x in a['routeStops']}
    rsb = {(x['routeId'], x['stopId']): x for x in b['routeStops']}
    out['routes'] |= {k[0] for k in rsa.keys() | rsb.keys() if rsa.get(k) != rsb.get(k)}
    ta, tb = {t['id']: t for t in a['trips']}, {t['id']: t for t in b['trips']}
    out['routes'] |= {(ta.get(i) or tb.get(i))['routeId'] for i in ta.keys() | tb.keys() if ta.get(i) != tb.get(i)}
    out['meta'] = a['meta'] != b['meta']
    return out


def chain(d, rid, key):
    rs = [x for x in d['routeStops'] if x['routeId'] == rid and (x.get(key) or -1) > 0]
    return [x['stopId'] for x in sorted(rs, key=lambda x: x[key])]


def route_minutes(d, rid):
    seg = {(s['fromStopId'], s['toStopId']): s['seconds'] for s in d['segments'] if s['routeId'] == rid}
    dflt = float(d['meta'].get('defaultSec') or 120)
    res = []
    for key in ('orderThere', 'orderBack'):
        ch = chain(d, rid, key)
        res.append(round(sum(seg.get((x, y)) or seg.get((y, x)) or dflt for x, y in zip(ch, ch[1:])) / 60, 1))
    return res


def validate(dataset, tag):
    f = path(f'db-{tag}-next.json')
    save(f, dataset, indent=None)
    js = ("const {validateTransportDataset}=require('./backend/dist/local-transport.js');"
          f"const r=validateTransportDataset(require('./{f}'));"
          "console.log(JSON.stringify(r.errors));process.exit(r.errors.length?1:0)")
    res = subprocess.run(['node', '-e', js], capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit('валідатор: ' + (res.stdout or res.stderr))
    return f


def apply_change(phase, build, allowed_stops, allowed_routes, dry=False):
    """build(dataset) мутує копію датасету. allowed_* — що дозволено змінити. Повертає (до, після)."""
    ts = now()
    cur = fetch()
    nxt = build(copy.deepcopy(cur))
    sc = scope(cur, nxt)
    bad_s, bad_r = sc['stops'] - set(allowed_stops), sc['routes'] - set(allowed_routes)
    assert not bad_s and not bad_r and not sc['meta'], f'поза дозволеним: зупинки {bad_s}, маршрути {bad_r}, meta {sc["meta"]}'
    assert [s for s in cur['segments']] == [s for s in nxt['segments']], 'сегменти змінюються лише перерахунком'
    print(f'[{phase}] зміниться: зупинки {sorted(sc["stops"])}; маршрути {sorted(sc["routes"])}')
    validate(nxt, f'{ts}-{phase}')
    print(f'[{phase}] валідатор: OK')
    if dry:
        return cur, nxt
    backup = path(f'db-{ts}-before-{phase}.json')
    save(backup, cur, indent=None)
    tok = token()
    again = fetch()
    assert canon(again) == canon(cur), 'база змінилась після знімка — зупинка'
    res = http_json('PUT', f'{API}/transport/dataset', nxt, tok)
    after = fetch()
    save(path(f'db-{ts}-after-{phase}.json'), after, indent=None)
    assert canon(after) == canon(nxt), 'після PUT база не збігається з відправленим'
    print(f'[{phase}] PUT: {res["counts"]} | бекап {os.path.basename(backup)} | перевірка після PUT: OK')
    return cur, after


def recalc(phase, routes):
    tok = token()
    out = {}
    for rid in routes:
        before = fetch()
        res = http_json('POST', f'{API}/admin/transport/recalculate-segments', {'routeId': rid}, tok, timeout=600)
        after = fetch()
        strip = lambda d: [s for s in sorted(d['segments'], key=lambda s: (s['routeId'], s['fromStopId'], s['toStopId']))
                           if s['routeId'] != rid]
        assert strip(before) == strip(after), f'перерахунок {rid} зачепив інші маршрути'
        b2, a2 = copy.deepcopy(before), copy.deepcopy(after)
        b2['segments'] = a2['segments'] = []
        assert canon(b2, True) == canon(a2, True), f'перерахунок {rid} змінив щось, крім сегментів'
        out[rid] = {'before_min': route_minutes(before, rid), 'after_min': route_minutes(after, rid),
                    'segments': res['segmentsWritten'], 'osrm_failed': res['osrmFailed']}
        print(f'[{phase}] сегменти №{rid}: {res["segmentsWritten"]} (OSRM збоїв {res["osrmFailed"]}); '
              f'хв туди/назад {out[rid]["before_min"]} → {out[rid]["after_min"]}')
    save(path(f'db-{now()}-after-{phase}-segments.json'), fetch(), indent=None)
    return out
