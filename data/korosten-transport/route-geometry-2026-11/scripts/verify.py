"""Коростень · лінії дорогами: незалежна перевірка нового датасету проти старого. Нічого не записує.

    python3 scripts/verify.py <before.json> <next.json>

Перевіряє: справжні зупинки, рейси й метадані ті самі; кожен ланцюжок проходить ті самі справжні зупинки в тому
самому порядку; час від початку ланцюжка до кожної справжньої зупинки той самий до секунди; жодна точка не
трапляється в ланцюжку двічі; для кожного перегону кожного ланцюжка є сегмент; зайвих зупинок і сегментів немає."""
import json
import sys

from geo import chains, load

old, new = load(sys.argv[1]), load(sys.argv[2])
errors = []


def tech_ids(ds):
    return {x['stopId'] for x in ds['routeStops'] if x.get('mapOnly')} | {s['stopId'] for r in ds['routes'] for v in r.get('variants') or [] for s in v['stops'] if s.get('mapOnly')}


def real_stops(ds):
    t = tech_ids(ds)
    return sorted((json.dumps(s, sort_keys=True, ensure_ascii=False) for s in ds['stops'] if s['id'] not in t))


if real_stops(old) != real_stops(new):
    errors.append('справжні зупинки змінились')
for k in ('trips', 'meta'):
    if json.dumps(old[k], sort_keys=True) != json.dumps(new[k], sort_keys=True):
        errors.append(f'{k} змінились')
strip = lambda r: {k: v for k, v in r.items() if k != 'variants'}
if [strip(r) for r in old['routes']] != [strip(r) for r in new['routes']]:
    errors.append('поля маршрутів змінились')


def timeline(ds):
    seg = {(s['routeId'], s['fromStopId'], s['toStopId']): s['seconds'] for s in ds['segments']}
    default = ds['meta'].get('defaultSec', 120)
    out, used, miss = {}, set(), 0
    for rid, label, chain in chains(ds):
        ids = [s['stopId'] for s in chain]
        if len(set(ids)) != len(ids):
            errors.append(f'{rid} {label}: точка двічі в ланцюжку')
        t, line = 0, [(ids[0], 0)]
        for (a, sa), (b, sb) in zip(zip(ids, chain), zip(ids[1:], chain[1:])):
            v = seg.get((rid, a, b))
            if v is None:
                v = seg.get((rid, b, a))
            if v is None:
                miss += 1
                v = default
            else:
                used.add((rid, a, b) if (rid, a, b) in seg else (rid, b, a))
            t += v
            if not sb['mapOnly']:
                line.append((b, t))
        out[(rid, label)] = line
    return out, set(seg) - used, miss


to, extra_o, miss_o = timeline(old)
tn, extra_n, miss_n = timeline(new)
if set(to) != set(tn):
    errors.append('набір ланцюжків змінився')
for k in to:
    if to[k] != tn.get(k):
        diff = next(((a, b) for a, b in zip(to[k], tn.get(k, [])) if a != b), None)
        errors.append(f'{k}: зупинки або час змінились, перша різниця {diff}')
if miss_n:
    errors.append(f'у новому датасеті немає сегмента для {miss_n} перегонів')
if extra_n:
    errors.append(f'зайві сегменти: {len(extra_n)}')
used_stops = {s['stopId'] for _, _, ch in chains(new) for s in ch}
unused = [s['id'] for s in new['stops'] if s['id'] not in used_stops]
if unused:
    errors.append(f'зупинки, яких немає в жодному ланцюжку: {unused[:5]}')
print(f'ланцюжків {len(to)}; перегонів без сегмента: було {miss_o}, стало {miss_n}; зайвих сегментів було {len(extra_o)}')
if errors:
    print('ПОМИЛКИ:')
    for e in errors:
        print(' -', e)
    sys.exit(1)
print('усе збігається: зупинки, порядок, час до кожної зупинки, рейси')
