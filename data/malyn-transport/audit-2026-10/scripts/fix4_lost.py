"""Фаза 4 виправлень: загублені зупинки на Городищанській (№7, №8).

Файл 2024: непарні будинки — північний бік (Продукти 51, Миру-Городищанська 35, УЕГГ 1),
парні — південний (ПТЛ 20, УЕГГ 2). Правосторонній рух: «туди» (до Вокзалу) їде на схід і бере
південний бік, «назад» — на захід і бере північний. Шлях OSM №7 (rel 7510119) дає ту саму розкладку.

- новий `st_0120` «Малинське УЕГГ (навпроти)» — дзеркало `st_0055` через вісь Городищанської (буд. 1);
- №7 і №8 «назад»: `st_0055` → `st_0120`;
- №8 «назад»: «Миру-Городищанська» замість «ПТЛ» (ПТЛ — південний бік, лишається «туди»);
- №7 «туди»: без «Продукти» (північний бік, лишається «назад»; на схід автобус бере «ПТЛ»).
«Росава» на №5 увімкнена ще у фазі 3."""
import sys

from apply_lib import apply_change, chain, recalc, set_chains
from geo_lib import mirror, side

STREET = 'Городищанська вулиця'
W, E = (50.75984, 29.27000), (50.75960, 29.29000)  # захід → схід уздовж Городищанської
UEGG, UEGG2, PTL, PROD, MYRU = 'st_0055', 'st_0120', 'st_0079', 'st_0048', 'st_0059'
NEW_NAME = 'Малинське УЕГГ (навпроти)'
ON_STREET = {UEGG, UEGG2, PTL, PROD, MYRU}


def replace(seq, old, new):
    assert seq.count(old) == 1, f'{old} має бути рівно один раз'
    return [new if x == old else x for x in seq]


def build(d):
    st = {s['id']: s for s in d['stops']}
    assert UEGG2 not in st and not any(s['name'] == NEW_NAME for s in d['stops']), 'st_0120 / назва вже є'
    lat, lng = mirror(st[UEGG]['lat'], st[UEGG]['lng'], STREET)
    d['stops'].append({'id': UEGG2, 'name': NEW_NAME, 'lat': lat, 'lng': lng})
    st[UEGG2] = d['stops'][-1]

    t7, b7 = chain(d, '7', 'orderThere'), chain(d, '7', 'orderBack')
    assert t7[t7.index(UEGG):t7.index(UEGG) + 4] == [UEGG, PTL, PROD, 'st_0027'], t7
    assert b7[b7.index(PROD):b7.index(PROD) + 4] == [PROD, MYRU, UEGG, 'st_0041'], b7
    set_chains(d, '7', [x for x in t7 if x != PROD], replace(b7, UEGG, UEGG2))

    t8, b8 = chain(d, '8', 'orderThere'), chain(d, '8', 'orderBack')
    assert t8[t8.index(UEGG):t8.index(UEGG) + 3] == [UEGG, PTL, 'st_0058'], t8
    assert b8[b8.index(PROD):b8.index(PROD) + 4] == [PROD, PTL, UEGG, 'st_0041'], b8
    set_chains(d, '8', t8, replace(replace(b8, PTL, MYRU), UEGG, UEGG2))

    # кожна зупинка Городищанської — на правому боці свого напрямку
    for rid in ('7', '8'):
        for key, frm, to in (('orderThere', W, E), ('orderBack', E, W)):
            for sid in chain(d, rid, key):
                if sid in ON_STREET:
                    s, dist = side(st[sid]['lat'], st[sid]['lng'], STREET, frm, to)
                    assert s == 'right', f'№{rid} {key}: {st[sid]["name"]} на лівому боці ({dist} м)'
    # кожна з п'яти — рівно в одному напрямку кожного маршруту
    for sid in ON_STREET:
        for rid in ('7', '8'):
            r = next((x for x in d['routeStops'] if x['routeId'] == rid and x['stopId'] == sid), None)
            assert r and (r['orderThere'] > 0) != (r['orderBack'] > 0), f'№{rid} {sid}: {r}'
    return d


if __name__ == '__main__':
    dry = '--apply' not in sys.argv
    cur, nxt = apply_change('fix4', build, {UEGG2}, {'7', '8'}, dry=dry)
    nm = {s['id']: s['name'] for s in nxt['stops']}
    for rid in ('7', '8'):
        for key, lab in (('orderThere', 'туди'), ('orderBack', 'назад')):
            before = [nm.get(x, x) for x in chain(cur, rid, key) if x in ON_STREET]
            after = [nm[x] for x in chain(nxt, rid, key) if x in ON_STREET]
            print(f'№{rid} {lab:<5}: {" > ".join(before)}  →  {" > ".join(after)}')
    s = next(x for x in nxt['stops'] if x['id'] == UEGG2)
    print(f'{UEGG2} «{s["name"]}»: {s["lat"]}, {s["lng"]}')
    if not dry:
        recalc('fix4', ['7', '8'])
