"""Фаза 0: наскільки лінії №5 і №2 на карті відходять від доріг. Для кожного перегону (сусідні точки ланцюжка,
технічні теж): шлях OSRM, довжина, відхилення прямої від дороги, точки повороту (Дуглас — Пекер, EPS м).
Вихід: analysis.json і таблиця гірших перегонів."""
import json
import os

from geo_lib2 import chain, douglas_peucker, fetch, max_dev, osrm_path, path_len
from common import dist_m

EPS = 8.0
OUT = os.path.join('data', 'malyn-transport', 'route-geometry-2026-10', 'analysis.json')


def main():
    d = fetch()
    st = {s['id']: s for s in d['stops']}
    P = lambda i: (st[i]['lat'], st[i]['lng'])  # noqa: E731
    rows = []
    for rid in ('5', '2'):
        mo = {x['stopId'] for x in d['routeStops'] if x['routeId'] == rid and x.get('mapOnly')}
        for key in ('orderThere', 'orderBack'):
            c = chain(d, rid, key)
            for a, b in zip(c, c[1:]):
                path = osrm_path(P(a), P(b))
                if not path:
                    rows.append(dict(route=rid, dir=key, a=a, b=b, error='OSRM'))
                    continue
                pts = [P(a)] + path[1:-1] + [P(b)]
                keep = douglas_peucker(pts, EPS)
                bends = [pts[k] for k in keep[1:-1]]
                straight = dist_m(*P(a), *P(b))
                rows.append(dict(route=rid, dir=key, a=a, b=b, an=st[a]['name'], bn=st[b]['name'],
                                 a_tech=a in mo, b_tech=b in mo, straight=round(straight), road=round(path_len(path)),
                                 dev=round(max_dev(path, P(a), P(b))), bends=[[round(x, 6), round(y, 6)] for x, y in bends]))
    json.dump(rows, open(OUT, 'w'), ensure_ascii=False, indent=1)
    for rid in ('5', '2'):
        for key in ('orderThere', 'orderBack'):
            rs = [r for r in rows if r['route'] == rid and r['dir'] == key]
            need = [r for r in rs if r.get('bends')]
            print(f"№{rid} {key}: перегонів {len(rs)}, потребують точок {len(need)}, нових точок {sum(len(r['bends']) for r in need)}")
            for r in sorted(need, key=lambda r: -r['dev'])[:40]:
                ratio = r['road'] / max(1, r['straight'])
                flag = '  ⚠ обхід' if ratio > 1.6 and r['road'] - r['straight'] > 150 else ''
                print(f"   {r['dev']:>4} м відхил | {len(r['bends'])} т. | {r['straight']:>4}→{r['road']:>4} м | {r['an']} → {r['bn']}{flag}")


if __name__ == '__main__':
    main()
