"""Записує згенеровані розділи звіту у Docs/transport-stops-audit-2026-10.md між маркерами
<!-- <name>:begin --> … <!-- <name>:end -->. Аргумент: імена розділів (phase1 phase2 …)."""
import os
import re
import sys

from common import dist_m, gmaps, load, path

DOC = os.path.join('Docs', 'transport-stops-audit-2026-10.md')
ICON = {'ok': '✅', 'doubt': '⚠️', 'wrong': '❌'}


def routes_str(xs):
    return ','.join(sorted(xs, key=lambda x: (len(x), x))) or '—'


def phase1(R):
    fs = R['file_stops']
    renamed = [x for x in fs if x['renamed']]
    merged = [x for x in fs if x['merged_with']]
    L = ['### Фаза 1 — перелік', '',
         f"- У файлі **93** зупинки, у базі **117**. Усі 93 знайдені в базі за назвою — **жодну не видалено**.",
         f"- Перейменовані в базі (редактор карти): " + '; '.join(f"`{x['file_name']}` → «{x['db_name']}» ({x['db_id']})" for x in renamed) + '.',
         f"- **Склеєна пара:** «Малинське УЕГГ» у файлі — дві зупинки (Городищанська 1 і 2, обидва боки), у базі одна "
         f"`st_0055` на обидва напрямки маршрутів 7 і 8. Друга сторона загублена.",
         '- Є в базі, але не у файлі (25): 6 зупинок маршруту 9 (запущений у травні 2025, файл — 2024), '
         '17 технічних точок для лінії на карті, `st_0006` «БАМ» — **сирота** (не на жодному маршруті, дубль біля «Огієнка 65 (БАМ)»), '
         '`st_0030` «Й. Кульчицького (груш)» — за адресою це і є «Й. Кульчицького» з файлу (Грушевського 90).',
         '', '**Маршрути: файл ↔ база.** У файлі маршрути записані групою на весь відрізок вулиці '
         '(«м-ти 1,3,5,6,11,12» на кожній зупинці Грушевського), тому частина розбіжностей — не помилки бази.',
         '`-1` = зупинка є в маршруті, але вимкнена (без порядку, на сайті не показується).', '',
         '| Зупинка | Маршрут | Розбіжність | Висновок |', '|---|---|---|---|']
    kind = {'db-disabled': 'у файлі є, у нас `-1`', 'file-only': 'у файлі є, у нас немає', 'db-only': 'лише в базі'}
    rows9 = [x['file_name'] for x in fs if any(m['route'] == '9' for m in x['membership'])]
    for x in fs:
        for m in x['membership']:
            if m['route'] == '9':
                continue
            L.append(f"| {x['file_name']} ({x['db_id']}) | {m['route']} | {kind[m['kind']]} | {m['note'] or '—'} |")
    L += ['', f"Лише в базі — маршрут **9** на {len(rows9)} зупинках ({', '.join(rows9)}): маршрут новіший за файл, це очікувано."]
    return L


def phase2(R):
    fs = R['file_stops']
    cnt = {v: sum(1 for x in fs if x['coord_verdict'] == v) for v in ICON}
    L = ['### Фаза 2 — координати', '',
         'У файлі **немає координат** (колонки `stop_lat/stop_lon` порожні), тому кожну нашу точку звірено з '
         'адресою з файлу через OSM: будинок з тим самим номером (або найближчий номер того ж боку, або Nominatim), '
         'відстань до вулиці з файлу, найближча зупинка/платформа в OSM. Частина наших точок — геокод адреси '
         '(відстань 0 м до будинку): вони стоять біля будинку, а не точно на зупинці, але в межах кварталу.', '',
         f"Підсумок: ✅ {cnt['ok']} · ⚠️ {cnt['doubt']} · ❌ {cnt['wrong']}. **Нічого в базі не змінено.**", '',
         '#### ❌ Координати хибні', '',
         '| Зупинка | Маршрути | Де стоїть зараз | Де має бути | Зсув | Чому |', '|---|---|---|---|---|---|']
    for x in fs:
        if x['coord_verdict'] != 'wrong':
            continue
        p = x['proposal']
        d = round(dist_m(x['lat'], x['lon'], p['lat'], p['lon']))
        rts = routes_str(x['routes_db_active']) + (f" (`-1`: {routes_str(x['routes_db_disabled'])})" if x['routes_db_disabled'] else '')
        L.append(f"| {x['file_name']} `{x['db_id']}` | {rts} | [{x['lat']:.5f}, {x['lon']:.5f}]({gmaps(x['lat'], x['lon'])}) | "
                 f"[{p['lat']:.5f}, {p['lon']:.5f}]({gmaps(p['lat'], p['lon'])}) — {p['source']} | {d} м | {x['coord_note']} |")
    L += ['', '#### ⚠️ Сумнівні / конфлікт джерел', '', '| Зупинка | Маршрути | Точка | Що не так |', '|---|---|---|---|']
    for x in fs:
        if x['coord_verdict'] != 'doubt':
            continue
        extra = ''
        if x['proposal']:
            p = x['proposal']
            extra = f" Варіант: [{p['lat']:.5f}, {p['lon']:.5f}]({gmaps(p['lat'], p['lon'])}) ({p['source']})."
        L.append(f"| {x['file_name']} `{x['db_id']}` | {routes_str(x['routes_db_active'])} | "
                 f"[{x['lat']:.5f}, {x['lon']:.5f}]({gmaps(x['lat'], x['lon'])}) | {x['coord_note']}{extra} |")
    L += ['', '<details><summary>Усі 93 зупинки файлу — по одній</summary>', '',
          '| Файл | Наш id | Зупинка | Адреса (файл) | До вулиці, м | До будинку, м | OSM-зупинка поруч | Коорд. | Примітка |',
          '|---|---|---|---|---|---|---|---|---|']
    for x in fs:
        osm = f"{x['nearest_osm_stop'][1]} {x['nearest_osm_stop'][0]} м" if x['nearest_osm_stop'] else '—'
        meth = {'osm-exact': '', 'osm-near-number': ' (сусідній №)', 'nominatim': ' (Nominatim)'}.get(x['addr_method'], '')
        da = '—' if x['d_addr'] is None else f"{x['d_addr']}{meth}"
        ds = '—' if x['d_file_street'] is None else x['d_file_street']
        nm = x['file_name'] + ('' if not x['renamed'] else f" → «{x['db_name']}»")
        L.append(f"| {x['file_id']} | `{x['db_id']}` | {nm} | {x['file_street']} {x['file_house'] or ''} | {ds} | {da} | {osm} | "
                 f"{ICON[x['coord_verdict']]} | {x['coord_note'] or ''} |")
    L += ['', '</details>']
    return L


def phase3(_R):
    P = load(path('route5-proposal.json'))
    mo = set(P['map_only'])

    def fmt(seq, other):
        out = []
        for n in seq:
            if n in mo:
                continue
            out.append(f"**{n}**" if n not in other else n)
        return ' → '.join(out)

    L = ['### Фаза 3 — маршрут №5 (лише пропозиція, у базі не змінено)', '',
         '**Підтверджується: №5 має їхати всією вулицею Шевченка.** Офіційний опис 2024: «розпочинає рух від Поліклініки, '
         'рухається по вул. Шевченка, центром міста, через з-д «Прожектор» та прибуває до Залізничного вокзалу». У файлі №5 має '
         'Лікарню, Лікарню 2, Шевченка 119, перехрестя Бондарик-Шевченка, Корону, і **не має** зупинок 10-ї ОГШБ (ЗОШ 3, РЕМ).',
         '',
         'У базі західна частина зроблена петлею через 10-ї ОГШБ: «туди» починається з Шевченка 119, йде на північ до Поліклініки, '
         'потім до «Сонечка» (воно в базі стоїть на 10-ї ОГШБ біля РЕМу) і лише тоді на Шевченка 22; «назад» проїжджає '
         'кінцеву Поліклініку і закінчується на Шевченка 119. Причина — координати «Сонечка» (див. фазу 2).',
         '',
         'Бік дороги перевірено геометрією OSM (правосторонній рух): на Бондарик на південь праворуч «Лікарня», на північ — '
         '«Лікарня 2»; на Шевченка на схід праворуч «Росава» і «Шевченка 119», ліворуч «Корона» і «Шевченка 22»; на '
         'Володимирській на схід праворуч «Прожектор», на захід — «Меркурій»; на Перемоги на північ — «Перемоги 15-17».',
         '', 'Жирним — зупинки, яких немає в іншому варіанті. Технічні точки не показані.', '']
    for key, lab in (('there', 'Туди (Поліклініка → Вокзал)'), ('back', 'Назад (Вокзал → Поліклініка)')):
        cur, prop = P['5']['current'][key], P['5']['proposal'][key]
        L += [f"**{lab}**", '', f"- зараз: {fmt(cur, prop)}", f"- пропозиція: {fmt(prop, cur)}", '']
    L += ['Що змінюється:', '']
    L += [f"- {n}" for n in P['notes_route5']]
    L += ['', f"Увімкнути з `-1`: {', '.join(P['5']['enable_from_minus1'])}. Нових зупинок не потрібно — усі вже є в маршруті.",
          '', '**№2 має ту саму петлю** (Корона → Сонечко на 10-ї ОГШБ → Поліклініка → Лікарня → Шевченка 119). '
          'Та сама логіка дає: «туди» … Шевченка 22 → Сонечко → Корона → Шевченка 119 → перехрестя → Лікарня 2 → Поліклініка; '
          '«назад» Поліклініка → Лікарня → перехрестя → Шевченка 119 → Росава → маркет Соборний … '
          'Обидві пропозиції — у `route5-proposal.json` (`proposal_ids` готові до застосування).']
    return L


def write(name, lines):
    doc = open(DOC, encoding='utf-8').read()
    block = f"<!-- {name}:begin -->\n" + '\n'.join(lines).rstrip() + f"\n<!-- {name}:end -->"
    pat = re.compile(rf"<!-- {name}:begin -->.*?<!-- {name}:end -->", re.S)
    if pat.search(doc):
        doc = pat.sub(lambda _: block, doc)
    else:
        doc = doc.rstrip() + '\n\n' + block + '\n'
    open(DOC, 'w', encoding='utf-8').write(doc)
    print('written section', name, f'({len(lines)} lines)')


if __name__ == '__main__':
    R = load(path('stops-review.json'))
    for n in sys.argv[1:]:
        write(n, {'phase1': phase1, 'phase2': phase2, 'phase3': phase3}[n](R))
