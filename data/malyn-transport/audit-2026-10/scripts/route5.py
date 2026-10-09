"""Фаза 3: пропозиція порядку маршруту №5 (і №2 — та сама західна петля). Лише звіт, у базу не пишемо.
Логіка: офіційний опис 2024 («від Поліклініки по вул. Шевченка, центром, через Прожектор до Вокзалу») +
список зупинок файлу + бік дороги за правостороннім рухом (перевірено геометрією OSM, див. Docs)."""
import glob

from common import load, path, save

T = {  # технічні точки (map_only) — як у чинних ланцюжках №11/№5
    't1': 'st_0101', 't2': 'st_0102', 't3': 'st_0103', 't4': 'st_0104', 't5': 'st_0105', 't6': 'st_0106',
    't7': 'st_0107', 't8': 'st_0108'}

ROUTE5 = {
    # туди (directionId 1): Поліклініка → Вокзал
    'there': ['st_0072', 'st_0035', 'st_0067', 'st_0097', 'st_0050', 'st_0070', 'st_0012', T['t1'], 'st_0096',
              'st_0015', 'st_0065', 'st_0029', 'st_0054', T['t5'], 'st_0062', 'st_0016', 'st_0089', 'st_0060',
              'st_0033', 'st_0085', T['t4'], T['t2'], 'st_0019'],
    # назад (directionId 0): Вокзал → Поліклініка
    'back': ['st_0019', T['t3'], T['t4'], 'st_0061', 'st_0034', 'st_0060', 'st_0089', 'st_0017', 'st_0063', T['t5'],
             T['t6'], 'st_0054', 'st_0029', 'st_0066', 'st_0046', 'st_0095', T['t1'], 'st_0051', 'st_0056', 'st_0098',
             'st_0052', 'st_0045', 'st_0097', 'st_0067', 'st_0036', 'st_0072'],
}
# №2: та сама західна частина (центр ↔ Шевченка ↔ Бондарик ↔ Поліклініка), решта як у базі
ROUTE2 = {
    'there': ['st_0064', T['t8'], T['t7'], 'st_0047', 'st_0075', 'st_0078', 'st_0024', 'st_0025', 'st_0031', 'st_0056',
              'st_0098', 'st_0052', 'st_0045', 'st_0097', 'st_0067', 'st_0036', 'st_0072'],
    'back': ['st_0072', 'st_0035', 'st_0067', 'st_0097', 'st_0050', 'st_0056', 'st_0044', 'st_0032', 'st_0026', 'st_0024',
             'st_0077', 'st_0074', 'st_0076', T['t7'], T['t8'], 'st_0064'],
}
NOTES5 = [
    'Старт «туди» — Поліклініка (кінцева «Лікарня»), далі Бондарик на південь: «Лікарня» (правий бік), перехрестя, Шевченка 119.',
    'Шевченка на схід — лише «Росава» (правий бік); «Шевченка 22», «Сонечко», «Корона» — лівий бік, тобто напрямок «назад».',
    '«Назад» на Володимирській — «Меркурій» (правий бік) замість «Прожектора»; зараз «Прожектор» в обидва боки, «Меркурій» вимкнений.',
    '«Назад» закінчується на Поліклініці: Шевченка 22 → Сонечко (буд. 48) → Корона (58) → Шевченка 119 → перехрестя → «Лікарня 2» → Поліклініка.',
    'Відрізок від Грушевського 48 до Вокзалу (обидва боки) не змінюється — він збігається з перевіреним №11.',
    '«Шевченка 119» і «перехр-тя Бондарик-Шевченка» — одиночні стовпчики на розі, лишаються в обох напрямках, як у №2.',
    'Порядок «Сонечко» перед «Короною» — за нумерацією (48 < 58). Поки координати «Сонечка» на 10-ї ОГШБ, лінія на карті '
    'робитиме гачок; виправляється разом із координатами (фаза 2).',
    'Після застосування: перерахувати сегменти №5 (OSRM) — для нових пар зупинок їх зараз немає.',
]


def chain(db, rid, key):
    rs = [x for x in db['routeStops'] if x['routeId'] == rid and (x.get(key) or -1) > 0]
    return [x['stopId'] for x in sorted(rs, key=lambda x: x[key])]


def main():
    db = load(sorted(glob.glob(path('db-*-start.json')))[-1])
    name = {s['id']: s['name'] for s in db['stops']}
    maponly = {x['stopId'] for x in db['routeStops'] if x.get('mapOnly')}
    out = {}
    for rid, prop in (('5', ROUTE5), ('2', ROUTE2)):
        cur = {'there': chain(db, rid, 'orderThere'), 'back': chain(db, rid, 'orderBack')}
        on_route = {x['stopId'] for x in db['routeStops'] if x['routeId'] == rid}
        new_ids = sorted(set(prop['there'] + prop['back']) - on_route)
        disabled_before = {x['stopId'] for x in db['routeStops'] if x['routeId'] == rid
                           and (x.get('orderThere') or -1) <= 0 and (x.get('orderBack') or -1) <= 0}
        out[rid] = {
            'current': {k: [name[i] for i in v] for k, v in cur.items()},
            'proposal': {k: [name[i] for i in v] for k, v in prop.items()},
            'proposal_ids': prop,
            'enable_from_minus1': [name[i] for i in sorted(disabled_before & set(prop['there'] + prop['back']))],
            'not_on_route_yet': [name[i] for i in new_ids],
            'removed': {k: [name[i] for i in cur[k] if i not in prop[k]] for k in cur},
            'added': {k: [name[i] for i in prop[k] if i not in cur[k]] for k in cur},
        }
        assert not new_ids, f'route {rid}: proposal uses stops outside the route: {new_ids}'
    out['notes_route5'] = NOTES5
    out['map_only'] = sorted(name[i] for i in maponly)
    save(path('route5-proposal.json'), out)
    for rid in ('5', '2'):
        o = out[rid]
        print(f"#{rid} enable(-1→on): {o['enable_from_minus1']} | removed {o['removed']} | added {o['added']}")


if __name__ == '__main__':
    main()
