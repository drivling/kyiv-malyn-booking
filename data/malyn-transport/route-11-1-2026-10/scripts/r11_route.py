"""Фаза 1: шлях №11 (на листку 11/1) через обидва розгалуження району.

Туди: фабрика → Приходька → перехрестя → Чорновола → Барміна → розворот → перехрестя → Мазепи → … → Вокзал.
Назад: Вокзал → … → Мазепи 4 → Приходька → ФБП → фабрика → розворот → Приходька → перехрестя → Чорновола →
Барміна (кінцева). Зупинка може бути в напрямку лише раз, тож для зворотного проїзду від фабрики — нові
технічні точки т.9 / т.10 у тих самих місцях, що т.8 / т.7 (лише для лінії на карті)."""
import sys

from r11_lib import (BAR, CH10, FBP, MAZ3, MAZ4, MAZ27, NAT, P8, P9, P28, P29, PF, T7, T8, T9, T10, VIK, apply_change,
                     chain, recalc, set_chains, side)

NEW = {T9: ('№11 т.9', T8), T10: ('№11 т.10', T7)}
# (вулиця OSM, точка «звідки», точка «куди») — правий бік руху для кожної зупинки
EAST_PR = ('вулиця Юрія Приходька', (50.7576, 29.2250), (50.7573, 29.2400))
WEST_PR = ('вулиця Юрія Приходька', (50.7573, 29.2400), (50.7576, 29.2250))
EAST_CH = ('вулиця Вʼячеслава Чорновола', (50.7571, 29.2405), (50.7562, 29.2450))
NORTH_MZ = ('вулиця Івана Мазепи', (50.7573, 29.2400), (50.7610, 29.2390))
SOUTH_MZ = ('вулиця Івана Мазепи', (50.7610, 29.2390), (50.7573, 29.2400))
SIDES = {
    'orderThere': {NAT: EAST_PR, P29: EAST_PR, P9: EAST_PR, VIK: EAST_CH, CH10: EAST_CH, BAR: EAST_CH,
                   MAZ27: NORTH_MZ, MAZ3: NORTH_MZ},
    'orderBack': {MAZ4: SOUTH_MZ, P8: WEST_PR, P28: WEST_PR, FBP: WEST_PR, NAT: EAST_PR, P29: EAST_PR, P9: EAST_PR,
                  VIK: EAST_CH, CH10: EAST_CH, BAR: EAST_CH},
}


def build(d):
    st = {s['id']: s for s in d['stops']}
    for sid, (name, at) in NEW.items():
        assert sid not in st and not any(s['name'] == name for s in d['stops']), f'{sid} / {name} вже є'
        d['stops'].append({'id': sid, 'name': name, 'lat': st[at]['lat'], 'lng': st[at]['lng']})
        st[sid] = d['stops'][-1]
    t, b = chain(d, '11', 'orderThere'), chain(d, '11', 'orderBack')
    i = t.index(P9)
    assert t[i + 1] == MAZ27, [st[x]['name'] for x in t[i:i + 3]]
    t = t[:i + 1] + [VIK, CH10, BAR] + t[i + 1:]
    j = b.index(MAZ4)
    assert b[j:] == [MAZ4, MAZ27, P8, P29, P28, FBP, T7, T8, PF], [st[x]['name'] for x in b[j:]]
    b = b[:j + 1] + [P8, P28, FBP, T7, T8, PF, T9, T10, NAT, P29, P9, VIK, CH10, BAR]
    set_chains(d, '11', t, b, map_only=(T9, T10))
    for key, checks in SIDES.items():
        c = chain(d, '11', key)
        for sid, (street, frm, to) in checks.items():
            assert sid in c, f'{key}: {st[sid]["name"]} нема в ланцюжку'
            s, dist = side(st[sid]['lat'], st[sid]['lng'], street, frm, to)
            assert s == 'right', f'{key}: {st[sid]["name"]} на лівому боці ({dist} м)'
    return d


if __name__ == '__main__':
    dry = '--apply' not in sys.argv
    cur, nxt = apply_change('r11-1', build, set(NEW), {'11'}, dry=dry)
    nm = {s['id']: s['name'] for s in nxt['stops']}
    mo = {x['stopId'] for x in nxt['routeStops'] if x['routeId'] == '11' and x.get('mapOnly')}
    for key, lab in (('orderThere', 'туди'), ('orderBack', 'назад')):
        c = [x for x in chain(nxt, '11', key) if x not in mo]
        print(f'№11 {lab} ({len(c)} зупинок): {" > ".join(nm[x] for x in c)}')
    off = [nm[x['stopId']] for x in nxt['routeStops'] if x['routeId'] == '11' and x['orderThere'] <= 0 and x['orderBack'] <= 0]
    print('№11 вимкнені (-1/-1):', off)
    if not dry:
        recalc('r11-1', ['11'])
