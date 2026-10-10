"""Фаза 2: запис технічних точок №5 і №2 (build_geometry.build_candidate на свіжому датасеті) і перерахунок сегментів."""
import sys

from build_geometry import build_candidate
from geo_lib2 import apply_change, chain, recalc, route_minutes

NEW_IDS = {f'st_{i:04d}' for i in range(123, 400)}


def build(d):
    d, created, *_ = build_candidate(d)
    for t in d['trips']:  # власні старт/кінець рейсів №2 і №5 лишаються в ланцюжках
        if t['routeId'] in ('2', '5'):
            c = chain(d, t['routeId'], 'orderThere' if t['directionId'] == '1' else 'orderBack')
            for k in ('startStopId', 'endStopId'):
                assert not t.get(k) or t[k] in c, (t['id'], k, t[k])
    return d


if __name__ == '__main__':
    dry = '--apply' not in sys.argv
    cur, nxt = apply_change('geom-1', build, NEW_IDS, {'2', '5'}, dry=dry)
    print('було хв:', {r: route_minutes(cur, r) for r in ('2', '5')})
    if not dry:
        recalc('geom-1', ['5', '2'])
