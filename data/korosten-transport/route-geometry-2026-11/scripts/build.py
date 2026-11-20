"""Коростень · лінії маршрутів дорогами: будує новий датасет із технічними точками вздовж доріг. Нічого не записує
в базу — лише файли.

    python3 scripts/build.py <dataset.json> [--gps <gps.json>] --out <next.json> --report <REPORT.md>

Правила (ті самі, що в Малина, і три нові — позначено *):
- Відрізок — шлях між двома сусідніми справжніми зупинками ланцюжка (основний напрямок або варіант).
- Шлях дорогою дає OSRM. Кандидати: «через наявні технічні точки» (їх ставили з лінії Google — це підказка, якою
  дорогою їде автобус) і «найкоротший». * Вибір — за GPS-точками автобусів цього маршруту (частка шляху, біля якої
  автобуси справді були); без GPS чи при рівному рахунку — «через наявні точки», якщо він не робить гака.
- Технічні точки — повороти шляху (Дуглас — Пекер, EPS м): лінія між сусідніми точками відходить від дороги не
  більше ніж на EPS.
- Точки ближче MERGE м спільні між маршрутами. * У межах одного маршруту точка належить одному відрізку: сегменти
  маршруту спільні для всіх його ланцюжків, і спільна пара точок у двох відрізках дала б один час на двох.
- Час відрізка між справжніми зупинками не змінюється: його ділимо між новими перегонами за довжиною.
- * Перевірка кожного відрізка: найбільший відступ дороги від нової лінії (має бути ≤ EPS + відстань зупинки від
  дороги), довжина лінії проти довжини шляху OSRM, відстань зупинок до дороги. Усе, що не пройшло, — у звіт.
"""
import argparse
import collections
import json
import math

from geo import chains, dist_m, douglas_peucker, line_dist, load, osrm, path_len, spans, xy

EPS = 8.0            # м — наскільки лінія може відходити від дороги
MERGE = 10.0         # м — точки ближче за це вважаємо однією (між маршрутами)
DETOUR = 1.5         # шлях «через наявні точки» довший за найкоротший у стільки разів (і на DETOUR_M) — це гак
DETOUR_M = 250
GPS_NEAR = 60.0      # м — GPS-точка «біля» шляху
GPS_STEP = 40.0      # м — крок вибірки шляху для рахунку GPS
GPS_SPEED = 5        # км/год — повільніші точки (стоянка) не рахуємо
DIFFER = 40.0        # м — кандидати відрізняються, якщо один відходить від іншого далі
GPS_WIN = 0.15       # на стільки більша частка шляху з автобусами — і кандидат виграє
FIT_WIN = 10.0       # м — на стільки ближче до старої лінії — і кандидат виграє (коли GPS не розрізняє)
FIRST_ID = 3001
GPS_ROUTE = {'2b': '2Б'}

ap = argparse.ArgumentParser()
ap.add_argument('dataset')
ap.add_argument('--gps')
ap.add_argument('--out', required=True)
ap.add_argument('--report', required=True)
args = ap.parse_args()

ds = load(args.dataset)
st = {s['id']: s for s in ds['stops']}
pos = lambda sid: (st[sid]['lat'], st[sid]['lng'])
route_no = {r['id']: (r.get('shortName') or r['id']) for r in ds['routes']}

# --- GPS: рухомі точки за маршрутом, у клітинках 100 м
gps = collections.defaultdict(lambda: collections.defaultdict(list))
gps_count = collections.Counter()
if args.gps:
    for p in load(args.gps)['positions']:
        if (p.get('speed') or 0) < GPS_SPEED:
            continue
        x, y = xy(p['lat'], p['lng'])
        gps[p['routeNo']][(int(x // 100), int(y // 100))].append((p['lat'], p['lng']))
        gps_count[p['routeNo']] += 1


def sample(path, step):
    out, acc = [path[0]], 0.0
    for a, b in zip(path, path[1:]):
        d = dist_m(a, b)
        while acc + d >= step:
            t = (step - acc) / d
            a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            out.append(a)
            d = dist_m(a, b)
            acc = 0.0
        acc += d
    out.append(path[-1])
    return out


def closeness(path, line):
    """Наскільки шлях і лінія далеко одне від одного в середньому, м (в обидва боки)."""
    a = [line_dist(p, line) for p in sample(path, 25)]
    b = [line_dist(p, path) for p in sample(line, 25)]
    return (sum(a) / len(a) + sum(b) / len(b)) / 2


def gps_support(rids, path):
    """Частка шляху, біля якої були автобуси маршрутів rids; None — точок цих маршрутів замало."""
    nos = [GPS_ROUTE.get(r, r) for r in rids]
    if sum(gps_count[n] for n in nos) < 100:
        return None
    pts = sample(path, GPS_STEP)
    hit = 0
    for p in pts:
        x, y = xy(*p)
        cx, cy = int(x // 100), int(y // 100)
        if any(dist_m(p, q) <= GPS_NEAR for n in nos for dx in (-1, 0, 1) for dy in (-1, 0, 1) for q in gps[n].get((cx + dx, cy + dy), ())):
            hit += 1
    return hit / len(pts)


# --- відрізки: (маршрут, від, до) → шлях
all_chains = chains(ds)
old_seg = {(s['routeId'], s['fromStopId'], s['toStopId']): s['seconds'] for s in ds['segments']}
default_sec = ds['meta'].get('defaultSec', 120)
span_info = {}   # (rid, a, b) → dict
notes = []


def old_seconds(rid, ids):
    total, missing = 0, 0
    for x, y in zip(ids, ids[1:]):
        v = old_seg.get((rid, x, y), old_seg.get((rid, y, x)))
        if v is None:
            missing += 1
            v = default_sec
        total += v
    return total, missing


geo_routes = collections.defaultdict(set)   # (a, b, tech) → маршрути, що так їдуть
for rid, label, chain in all_chains:
    for a, b, tech in spans(chain):
        geo_routes[(a, b, tuple(tech))].add(rid)

CAND_NOTE = {
    'найкоротший': '',
    'через наявні точки': '',
    'зустрічним напрямком': 'OSRM цим напрямком сюди не пускає (у OpenStreetMap вулиця одностороння чи закрита) — узято ту саму дорогу з протилежного напрямку',
    'зустрічним через точки': 'OSRM цим напрямком сюди не пускає (у OpenStreetMap вулиця одностороння чи закрита) — узято ту саму дорогу з протилежного напрямку',
}


def flip(c):
    return c and {'m': c['m'], 'path': c['path'][::-1], 'snap': c['snap'][::-1]}


def choose(a, b, tech):
    """Шлях дорогою для відрізка: найкоротший, якщо інший кандидат не підтверджений краще — GPS-точками автобусів
    (частка шляху, де вони були, більша на GPS_WIN) або, коли GPS не розрізняє, близькістю до старої лінії."""
    rids = sorted(geo_routes[(a, b, tuple(tech))])
    old_line = [pos(a), *[pos(t) for t in tech], pos(b)]
    cands = {
        'найкоротший': osrm([pos(a), pos(b)]),
        'через наявні точки': osrm(old_line, straight=False) if tech else None,
        'зустрічним напрямком': flip(osrm([pos(b), pos(a)])),
        'зустрічним через точки': flip(osrm(old_line[::-1], straight=False)) if tech else None,
    }
    cands = {k: c for k, c in cands.items() if c}
    if not cands:
        return {'choice': 'без дороги', 'path': old_line, 'm': path_len(old_line), 'snap': [0, 0], 'why': 'OSRM шляху не знайшов — лишаємо стару лінію', 'fit': 0.0, 'gps': None}
    sup = {k: gps_support(rids, c['path']) for k, c in cands.items()}
    fit = {k: closeness(c['path'], old_line) for k, c in cands.items()}
    best = next(iter(cands))
    why = ''
    shortest = min(c['m'] for c in cands.values())
    for k, c in cands.items():
        if k == best:
            continue
        cur = cands[best]
        if max(line_dist(p, cur['path']) for p in c['path']) <= DIFFER and max(line_dist(p, c['path']) for p in cur['path']) <= DIFFER:
            continue
        by_gps = sup[k] is not None and sup[k] - sup[best] >= GPS_WIN
        gps_tie = sup[k] is None or abs(sup[k] - sup[best]) < GPS_WIN
        detour = c['m'] > shortest * DETOUR and c['m'] - shortest > DETOUR_M
        by_fit = bool(tech) and gps_tie and not detour and fit[k] + FIT_WIN < fit[best]
        if by_gps or by_fit:
            gps_txt = '' if sup[k] is None else f"GPS: {k} {sup[k]:.0%}, {best} {sup[best]:.0%}"
            why = (f'автобуси їздять саме так ({gps_txt})' if by_gps else f"ближчий до старої лінії (у середньому {fit[k]:.0f} м проти {fit[best]:.0f} м{'; ' + gps_txt if gps_txt else ''})")
            best = k
    c = cands[best]
    return {'choice': best, 'path': c['path'], 'm': c['m'], 'snap': [c['snap'][0], c['snap'][-1]], 'why': why, 'fit': fit[best] if tech else 0.0,
            'gps': sup[best], 'alt': {k: round(x['m']) for k, x in cands.items()} if why else None, 'osm': CAND_NOTE[best]}


geo_choice = {}
for rid, label, chain in all_chains:
    for a, b, tech in spans(chain):
        key = (rid, a, b)
        secs, missing = old_seconds(rid, [a, *tech, b])
        if key in span_info:
            info = span_info[key]
            info['chains'].append(label)
            if info['tech'] != tech:
                notes.append(f"№{route_no[rid]}: відрізок «{st[a]['name']}» → «{st[b]['name']}» мав різні технічні точки в ланцюжках {info['chains'][0]} і {label}; узято перші")
            if info['seconds'] != secs:
                notes.append(f"№{route_no[rid]}: відрізок «{st[a]['name']}» → «{st[b]['name']}» мав різний час у ланцюжках ({info['seconds']} і {secs} с); узято перший")
            continue
        gkey = (a, b, tuple(tech))
        if gkey not in geo_choice:
            geo_choice[gkey] = choose(a, b, tech)
        span_info[key] = {'tech': tech, 'chains': [label], 'seconds': secs, 'missing': missing,
                          'old_line': [pos(a), *[pos(t) for t in tech], pos(b)], **geo_choice[gkey]}

# --- технічні точки
tech_pts = []        # {'id','lat','lng','name','routes': {rid: span key}}
counters = collections.Counter()
next_id = FIRST_ID


def tech_point(rid, key, p, taken):
    """Точка для повороту p відрізка key маршруту rid: чужа в межах MERGE м або нова."""
    global next_id
    for t in tech_pts:
        if t['id'] in taken or rid in t['routes']:
            continue
        if dist_m(p, (t['lat'], t['lng'])) <= MERGE:
            t['routes'][rid] = key
            return t['id']
    counters[rid] += 1
    t = {'id': f'st_{next_id}', 'lat': round(p[0], 6), 'lng': round(p[1], 6), 'name': f'№{rid} т.{counters[rid]}', 'routes': {rid: key}}
    next_id += 1
    tech_pts.append(t)
    return t['id']


new_seg = {}
checks = []
for key, info in span_info.items():
    rid, a, b = key
    full = [pos(a), *info['path'], pos(b)]
    # зупинка стоїть збоку від дороги: перша й остання точки шляху (проєкції зупинок) — зайві зубці, якщо вони ближче EPS
    idx = douglas_peucker(full, EPS)
    bends = [full[i] for i in idx[1:-1]]
    taken = set()
    ids = []
    for p in bends:
        tid = tech_point(rid, key, p, taken)
        taken.add(tid)
        ids.append(tid)
    info['new'] = ids
    tp = {t['id']: (t['lat'], t['lng']) for t in tech_pts}
    line = [pos(a), *[tp[i] for i in ids], pos(b)]
    lens = [dist_m(p, q) for p, q in zip(line, line[1:])]
    total = sum(lens) or 1.0
    # час відрізка — між перегонами за довжиною, сума та сама (найбільші остачі)
    raw = [info['seconds'] * l / total for l in lens]
    secs = [int(math.floor(x)) for x in raw]
    for i in sorted(range(len(raw)), key=lambda i: raw[i] - secs[i], reverse=True)[: info['seconds'] - sum(secs)]:
        secs[i] += 1
    chain_ids = [a, *ids, b]
    for (x, y), s in zip(zip(chain_ids, chain_ids[1:]), secs):
        if (rid, x, y) in new_seg and new_seg[(rid, x, y)] != s:
            notes.append(f'№{route_no[rid]}: перегін {x}→{y} отримав два різні часи ({new_seg[(rid, x, y)]} і {s} с)')
        new_seg[(rid, x, y)] = s
    dev = max(line_dist(p, line) for p in info['path'])
    checks.append({'key': key, 'dev': dev, 'line_m': sum(lens), 'road_m': info['m'], 'snap': max(info['snap']), 'points': len(ids)})

# --- новий датасет
tech_ids = {t['id'] for t in tech_pts}
old_tech = {x['stopId'] for x in ds['routeStops'] if x.get('mapOnly')} | {s['stopId'] for r in ds['routes'] for v in r.get('variants') or [] for s in v['stops'] if s.get('mapOnly')}
real_used = {s['stopId'] for _, _, ch in all_chains for s in ch if not s['mapOnly']}
if old_tech & real_used:
    raise SystemExit(f'точка і технічна, і справжня: {sorted(old_tech & real_used)}')


def rebuild(chain):
    out, real = [], [s['stopId'] for s in chain if not s['mapOnly']]
    lead = []
    for s in chain:           # технічні точки до першої справжньої зупинки (не буває, але не губимо мовчки)
        if not s['mapOnly']:
            break
        lead.append(s)
    if lead or chain[-1]['mapOnly']:
        raise SystemExit('ланцюжок починається або кінчається технічною точкою')
    return real


stops = [s for s in ds['stops'] if s['id'] not in old_tech] + [{'id': t['id'], 'name': t['name'], 'lat': t['lat'], 'lng': t['lng']} for t in tech_pts]
route_stops = []
routes = []
for r in ds['routes']:
    rid = r['id']
    order = collections.defaultdict(lambda: {'orderThere': -1, 'orderBack': -1})
    for cid, label, chain in all_chains:
        if cid != rid or label not in ('туди', 'назад'):
            continue
        k = 'orderThere' if label == 'туди' else 'orderBack'
        real = rebuild(chain)
        seq = [real[0]]
        for a, b in zip(real, real[1:]):
            seq += [*span_info[(rid, a, b)]['new'], b]
        if len(set(seq)) != len(seq):
            raise SystemExit(f'№{rid} {label}: точка двічі в ланцюжку')
        for i, sid in enumerate(seq, 1):
            order[sid][k] = i
    for sid, o in order.items():
        route_stops.append({'routeId': rid, 'stopId': sid, 'orderThere': o['orderThere'], 'orderBack': o['orderBack'], 'mapOnly': sid in tech_ids})
    variants = []
    for v in r.get('variants') or []:
        chain = [{'stopId': s['stopId'], 'mapOnly': bool(s.get('mapOnly'))} for s in v['stops']]
        real = rebuild(chain)
        seq = [{'stopId': real[0]}]
        for a, b in zip(real, real[1:]):
            seq += [{'stopId': t, 'mapOnly': True} for t in span_info[(rid, a, b)]['new']] + [{'stopId': b}]
        if len({s['stopId'] for s in seq}) != len(seq):
            raise SystemExit(f'варіант {v["id"]}: точка двічі в ланцюжку')
        variants.append({**v, 'stops': seq})
    routes.append({**r, 'variants': variants})

out = {**ds, 'stops': stops, 'routes': routes, 'routeStops': route_stops,
       'segments': [{'routeId': k[0], 'fromStopId': k[1], 'toStopId': k[2], 'seconds': v} for k, v in new_seg.items()]}
out['baseRevision'] = out.pop('revision', None)   # ревізія бази, з якої будували: apply.py звіряє її перед записом
json.dump(out, open(args.out, 'w', encoding='utf8'), ensure_ascii=False, indent=1)

# --- звіт
name = lambda sid: st[sid]['name']
L = []
L.append('# Коростень — лінії маршрутів дорогами: звіт генератора\n')
L.append(f"База: ревізія `{ds.get('revision')}`. Згенеровано `scripts/build.py`; руками не правити.\n")
old_dev = []
for key, info in span_info.items():
    old_dev.append(max(line_dist(p, info['old_line']) for p in info['path']))
L.append('## Підсумок\n')
L.append('| | Було | Стало |\n|---|---|---|')
L.append(f"| Технічних точок | {len(old_tech)} | {len(tech_pts)} |")
L.append(f"| Відрізків між зупинками | {len(span_info)} | {len(span_info)} |")
L.append(f"| Дорога відходить від лінії більш як на 15 м | {sum(d > 15 for d in old_dev)} | {sum(c['dev'] > 15 for c in checks)} |")
L.append(f"| …більш як на 30 м | {sum(d > 30 for d in old_dev)} | {sum(c['dev'] > 30 for c in checks)} |")
L.append(f"| Найбільший відступ, м | {max(old_dev):.0f} | {max(c['dev'] for c in checks):.0f} |")
L.append(f"| Сегментів | {len(ds['segments'])} | {len(new_seg)} |\n")
L.append('Час кожного відрізка між справжніми зупинками той самий; змінилось лише те, як він поділений між перегонами.\n')
L.append('## За маршрутами\n')
L.append('| Маршрут | Відрізків | Точок було | Точок стало | Довжина ліній було, км | стало, км | GPS-точок у русі |\n|---|---|---|---|---|---|---|')
for r in ds['routes']:
    rid = r['id']
    ks = [k for k in span_info if k[0] == rid]
    L.append(f"| №{route_no[rid]} | {len(ks)} | {len({t for k in ks for t in span_info[k]['tech']})} | {len({t for k in ks for t in span_info[k]['new']})} | "
             f"{sum(path_len(span_info[k]['old_line']) for k in ks) / 1000:.1f} | {sum(c['line_m'] for c in checks if c['key'][0] == rid) / 1000:.1f} | {gps_count[GPS_ROUTE.get(rid, rid)]} |")
L.append('\n## Де взято не найкоротший шлях\n')
rows = [(k, g) for k, g in geo_choice.items() if g.get('why')]
if rows:
    L.append('| Відрізок | Маршрути | Узято | Довжини кандидатів, м | Чому |\n|---|---|---|---|---|')
    for (a, b, tech), g in rows:
        alt = ', '.join(f'{k} {v}' for k, v in (g.get('alt') or {}).items())
        L.append(f"| {name(a)} → {name(b)} | {', '.join('№' + route_no[r] for r in sorted(geo_routes[(a, b, tech)]))} | {g['choice']} | {alt} | {g['why']} |")
else:
    L.append('Таких відрізків немає.')
L.append('\n## Де карта OpenStreetMap, схоже, помиляється\n')
rows = [(k, g) for k, g in geo_choice.items() if g.get('osm')]
L += [f"- «{name(a)}» → «{name(b)}» ({', '.join('№' + route_no[r] for r in sorted(geo_routes[(a, b, tech)]))}): {g['osm']}." for (a, b, tech), g in rows] or ['Нічого.']
L.append('\n## На що подивитися на карті\n')
flags = []
by_key = {c['key']: c for c in checks}
for key, info in span_info.items():
    rid, a, b = key
    c = by_key[key]
    why = []
    if info['choice'] == 'без дороги':
        why.append('OSRM не знайшов дороги — лінія стара')
    if c['dev'] > EPS + 2:
        why.append(f"дорога відходить від лінії на {c['dev']:.0f} м")
    if c['snap'] > 40:
        why.append(f"зупинка за {c['snap']:.0f} м від дороги — можливо, стоїть не там або дороги немає в OSM")
    straight = dist_m(pos(a), pos(b))
    if c['road_m'] > 1.25 * straight + 80 and (g is None or g < 0.7):
        why.append(f"шлях дорогою {c['road_m']:.0f} м при {straight:.0f} м навпростець, а GPS цього не підтверджує — об'їзд чи інший бік дороги")
    if info['fit'] > 25:
        why.append(f"стара лінія йшла інакше (у середньому за {info['fit']:.0f} м від дороги) — перевірити, якою вулицею їде автобус")
    g = info.get('gps')
    if g is not None and g < 0.5 and c['road_m'] > 300 and len(geo_routes[(a, b, tuple(info['tech']))]) == 1 and gps_count[GPS_ROUTE.get(rid, rid)] >= 300:
        why.append(f'автобуси були лише біля {g:.0%} шляху (GPS) — можливо, їдуть іншою вулицею або зупинка стоїть не там')
    if info['missing']:
        why.append(f"у базі не було часу для {info['missing']} перегонів — узято типові {default_sec} с")
    if why:
        flags.append(f"- №{route_no[rid]} ({', '.join(info['chains'])}): «{name(a)}» → «{name(b)}» — {'; '.join(why)}")
L += flags or ['Нічого.']
if notes:
    L.append('\n## Примітки генератора\n')
    L += [f'- {n}' for n in dict.fromkeys(notes)]
open(args.report, 'w', encoding='utf8').write('\n'.join(L) + '\n')
print(f"точок {len(old_tech)} → {len(tech_pts)}; сегментів {len(ds['segments'])} → {len(new_seg)}; на карті глянути: {len(flags)}; приміток: {len(set(notes))}")
