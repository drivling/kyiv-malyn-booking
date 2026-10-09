"""Фаза 3 виправлень: порядок №5 і №2 — уся вулиця Шевченка, кінцева Поліклініка.
Беремо route5-proposal.json (аудит, фаза 3) і міняємо: «Сонечко» → «Шевченка 48» (st_0119);
№5 «назад» — «Прожектор» замість «Меркурія» (рішення власника). «м-н Сонечко» st_0052 прибираємо з №2/№5:
на 10-ї ОГШБ вони не заїжджають (у файлі їхнє «Сонечко» — це буд. 48)."""
import sys

from apply_lib import apply_change, recalc, set_chains
from common import load, path

SUB = {'st_0052': 'st_0119'}
SUB5_BACK = {'st_0046': 'st_0015'}  # Меркурій → Прожектор


def chains():
    P = load(path('route5-proposal.json'))
    out = {}
    for rid in ('5', '2'):
        t = [SUB.get(x, x) for x in P[rid]['proposal_ids']['there']]
        b = [SUB.get(x, x) for x in P[rid]['proposal_ids']['back']]
        if rid == '5':
            b = [SUB5_BACK.get(x, x) for x in b]
        out[rid] = (t, b)
    return out


def build(d):
    for rid, (t, b) in chains().items():
        set_chains(d, rid, t, b)
        d['routeStops'] = [x for x in d['routeStops'] if not (x['routeId'] == rid and x['stopId'] == 'st_0052')]
    return d


if __name__ == '__main__':
    C = chains()
    assert 'st_0046' not in C['5'][1] and 'st_0015' in C['5'][0] and 'st_0015' in C['5'][1]
    assert 'st_0050' in C['5'][0], 'Росава має бути на №5 «туди»'
    assert all('st_0052' not in t + b for t, b in C.values())
    dry = '--apply' not in sys.argv
    apply_change('fix3', build, set(), {'2', '5'}, dry=dry)
    if not dry:
        recalc('fix3', ['2', '5'])
