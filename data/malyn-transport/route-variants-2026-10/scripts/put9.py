"""Запис №9: свіжий датасет → build → перевірки → кандидат; з --apply — бекап, PUT з baseRevision, перевірка
«після PUT = кандидат». Час рейсів друкується тим самим помічником, що й на сайті (backend/dist/trip-timing.js)."""
import copy
import json
import os
import re
import subprocess

from build_route9 import RID, V1, V2
from geo_lib2 import chain, dist_m, fetch, route_minutes  # noqa: F401
from apply_lib import API, canon, http_json, now, save, token, validate
from common import path

TIMING_JS = r"""
const {computeTripTiming, parseTimepoints} = require('./backend/dist/trip-timing.js');
const d = require(process.argv[1]); const rid = process.argv[2]; const ids = process.argv.slice(3);
const st = Object.fromEntries(d.stops.map((s) => [s.id, s.name]));
const seg = new Map(d.segments.filter((s) => s.routeId === rid).map((s) => [`${s.fromStopId}|${s.toStopId}`, s.seconds]));
const dflt = Number(d.meta.defaultSec) || 120;
const route = d.routes.find((r) => r.id === rid);
const mins = (s) => { if (!s) return null; const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const clock = (m) => `${String(Math.floor(Math.round(m) / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
for (const id of ids) {
  const t = d.trips.find((x) => x.id === id);
  const v = t.variantId ? route.variants.find((x) => x.id === t.variantId) : null;
  const key = t.directionId === '0' ? 'orderBack' : 'orderThere';
  const chain = v ? v.stops.map((p) => p.stopId)
    : d.routeStops.filter((x) => x.routeId === rid && (x[key] ?? -1) > 0).sort((a, b) => a[key] - b[key]).map((x) => x.stopId);
  const tech = new Set(v ? v.stops.filter((p) => p.mapOnly).map((p) => p.stopId)
    : d.routeStops.filter((x) => x.routeId === rid && x.mapOnly).map((x) => x.stopId));
  const timing = computeTripTiming(chain, (a, b) => seg.get(`${a}|${b}`) ?? seg.get(`${b}|${a}`) ?? dflt, {
    departureMins: mins(t.departureTime), arrivalMins: mins(t.arrivalTime), startStopId: t.startStopId,
    endStopId: t.endStopId, timepoints: parseTimepoints(t.timepoints) });
  const real = timing.stops.filter((s) => !tech.has(s.stopId));
  console.log(`${id}${v ? ' [' + v.id + ']' : ''}: ` + real.map((s) => `${st[s.stopId]} ${clock(s.mins)}`).join(' → ')
    + (timing.timepointsIgnored ? `  (відкинуто опор: ${timing.timepointsIgnored})` : '')
    + (timing.factor !== 1 ? `  ×${timing.factor.toFixed(2)}` : ''));
}
"""


def times(f, trip_ids):
    res = subprocess.run(['node', '-e', TIMING_JS, f'./{f}', RID, *trip_ids], capture_output=True, text=True)
    print(res.stdout.strip() or res.stderr.strip())


def put(build_fn, apply):
    tag = 'r9'
    ts = now()
    cur = fetch()
    nxt, created = build_fn(copy.deepcopy(cur))
    created_ids = {p['id'] for p in created}
    removed = {s['id'] for s in cur['stops']} - {s['id'] for s in nxt['stops']}
    assert not removed, f'зупинки не видаляємо: {removed}'
    other = lambda d: {**d, 'routeStops': [x for x in d['routeStops'] if x['routeId'] != RID],  # noqa: E731
                       'segments': [x for x in d['segments'] if x['routeId'] != RID],
                       'trips': [x for x in d['trips'] if x['routeId'] != RID],
                       'routes': [x for x in d['routes'] if x['id'] != RID],
                       'stops': [s for s in d['stops'] if s['id'] not in created_ids]}
    assert canon(other(cur)) == canon(other(nxt)), f'змінилось щось поза №{RID} і новими точками'
    r_cur = next(r for r in cur['routes'] if r['id'] == RID)
    r_nxt = next(r for r in nxt['routes'] if r['id'] == RID)
    changed = {k for k in set(r_cur) | set(r_nxt) if r_cur.get(k) != r_nxt.get(k)}
    assert changed <= {'toName', 'variants'}, changed
    t_cur = {t['id']: t for t in cur['trips'] if t['routeId'] == RID}
    t_nxt = {t['id']: t for t in nxt['trips'] if t['routeId'] == RID}
    assert set(t_cur) == set(t_nxt), 'рейси №9 не додаємо й не прибираємо'
    for tid, t in t_nxt.items():
        diff = {k for k in set(t) | set(t_cur[tid]) if t.get(k) != t_cur[tid].get(k)}
        assert diff <= {'variantId', 'startStopId', 'endStopId', 'arrivalTime', 'blockId', 'timepoints'}, (tid, diff)
    if canon(nxt) == canon(cur):
        print(f'[{tag}] змін немає — база вже така')
        return
    f = validate(nxt, f'{ts}-{tag}')
    print(f'[{tag}] валідатор: OK; нових точок {len(created)}')
    st = {s['id']: s['name'] for s in nxt['stops']}
    for key in ('orderThere', 'orderBack'):
        c = chain(nxt, RID, key)
        tech = {x['stopId'] for x in nxt['routeStops'] if x['routeId'] == RID and x.get('mapOnly')}
        print(f'  {key}: {len(c)} точок; ' + ' → '.join(st[i] for i in c if i not in tech))
    for v in r_nxt['variants']:
        print(f"  {v['id']} ({v['name']}): {len(v['stops'])} точок; "
              + ' → '.join(st[p['stopId']] for p in v['stops'] if not p.get('mapOnly')))
    print(f'  хв за сегментами туди/назад: {route_minutes(cur, RID)} → {route_minutes(nxt, RID)}; '
          f'сегментів {sum(1 for s in cur["segments"] if s["routeId"] == RID)} → {sum(1 for s in nxt["segments"] if s["routeId"] == RID)}')
    times(f, ['9-01', '9-02', '9-03', '9-11', '9-12', '9-20'])
    save(path(f'db-{ts}-{tag}-candidate.json'), nxt, indent=None)
    if not apply:
        return
    save(path(f'db-{ts}-before-{tag}.json'), cur, indent=None)
    tok = token()
    again = fetch()
    assert canon(again) == canon(cur), 'база змінилась після знімка'
    res = http_json('PUT', f'{API}/transport/dataset', {**nxt, 'baseRevision': again.get('revision')}, tok)
    after = fetch()
    save(path(f'db-{ts}-after-{tag}.json'), after, indent=None)
    assert canon(after) == canon(nxt), 'після PUT база не збігається з кандидатом'
    print(f'[{tag}] PUT: {res["counts"]}, revision {res.get("revision")} | перевірка після PUT: OK')
