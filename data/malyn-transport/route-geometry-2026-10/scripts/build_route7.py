"""Фаза 7: технічні точки для лінії №7 — ті самі правила, що для №8 (build_more.build_routes).

№7 «Лікарня – Вокзал ч/з Городище»: Поліклініка → 10-ї ОГШБ → Шевченка → центр → Бандери → Городищанська →
«Їдальня ЗОШ 6» → вулиця 14-ї ОМБ → провулок до «14 ОМБ» → вулиця Героїв Малинського Підпілля (ГМП) → Миру →
Покровська → вокзал.
- Зупинку для маршрутизації проєктуємо на лінію №7 з OSM (relation 7510119), якщо вона ближче REL_MAX: на сході
  дороги здебільшого без назви. Інакше — загальне правило.
- Від вулиці 14-ї ОМБ до провулка — провулком через старі точки №7 т.1 і т.2, як було в базі (OSM веде №7 південніше,
  вулицею Малуші).
- Між «14 ОМБ» і «ГМП 14» — вулицею ГМП, як стоять зупинки (в OSM №7 іде паралельною вулицею північніше, повз
  «ГМП 14»). Вулиця ГМП в OSM не з'єднана з провулком, тож OSRM її об'їжджає; цю ділянку беремо з геометрії вулиць.
- Біля вокзалу «назад» — петлею навколо привокзальної площі (т.3 → т.4), як №8.
- Старі точки №7 т.1–т.5 з ланцюжків прибираємо; ті, що збіглися з новими точками повороту, лишаються.
Час кожного відрізка між справжніми зупинками не змінюємо. Нічого не записує, якщо не передати --apply."""
import sys

from build_more import DROP_TECH, build_routes, osm_route_anchors, put_routes, road, street_between

ROUTES = ['7']
REL = 7510119    # OSM: «Залізничний вокзал - Лікарня #7»
REL_MAX = 35.0   # м — далі від лінії OSM зупинку не проєктуємо
OLD = {'st_0111', 'st_0112', 'st_0113', 'st_0114', 'st_0115'}  # №7 т.1–т.5, поставлені вручну
GMP = 'вулиця Героїв Малинського Підпілля'
LANE = 'провулок 14-ї ОМБ Князя Романа Великого'


def anchors(st):
    return osm_route_anchors(st, '7', REL, REL_MAX)


def via_points(st):
    P = lambda i: (st[i]['lat'], st[i]['lng'])  # noqa: E731
    return {
        ('7', 'orderThere', 'st_0027', 'st_0002'): [P('st_0111'), P('st_0112')],  # Їдальня ЗОШ 6 → т.1 → т.2 → 14 ОМБ
        ('7', 'orderBack', 'st_0003', 'st_0028'): [P('st_0112'), P('st_0111')],   # 14 ОМБ (навпр) → т.2 → т.1 → Їдальня
        ('7', 'orderBack', 'st_0019', 'st_0021'): [P('st_0103'), P('st_0104')],   # вокзал → навколо площі → ЗОШ 5
    }


def leg_path(st, special, via, rid, key, a, b, aa, bb):
    """Ділянка вулицею ГМП між провулком («14 ОМБ») і «ГМП 14» — з геометрії вулиць; решта — OSRM."""
    if (rid, key, a, b) in (('7', 'orderThere', 'st_0002', 'st_0010'), ('7', 'orderBack', 'st_0011', 'st_0003')):
        east = street_between(GMP, aa if key == 'orderThere' else bb, aa if key == 'orderThere' else bb)[0]
        if key == 'orderThere':  # провулком на південь до ГМП, ГМП на захід
            return [*street_between(LANE, aa, east), *street_between(GMP, east, bb)[1:], bb]
        return [aa, *street_between(GMP, aa, east), *street_between(LANE, east, bb)[1:]]
    return road(aa, bb, via.get((rid, key, a, b), ()))


def build(d):
    return build_routes(d, ROUTES, drop={'7': OLD}, special_fn=anchors, via_fn=via_points, leg_fn=leg_path,
                        pool_skip=set().union(*DROP_TECH.values()), keep=frozenset())


if __name__ == '__main__':
    put_routes(build, ROUTES, 'geom-4', '--apply' not in sys.argv)
