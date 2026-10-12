"""Фаза 9: технічні точки для лінії №3 — ті самі правила, що для №12 (build_more.build_routes).

№3 «Лікарня (Лісотехнікум) – Вокзал ч/з круг»: Лісотехнікум → Лісна → Поліклініка → 10-ї ОГШБ → Шевченка → центр →
Грушевського → Малинівський круг → Огієнка → вокзал (і назад), як у базі й в офіційному переліку зупинок 2024.
- Лінія №3 в OSM (relation 7285799) на сході йде Миру / Бандери, як №8 — там немає жодної зупинки №3 з переліку,
  тож її беремо лише для зупинок заходу, яких більше ніде немає (Лісотехнікум, Лісна, «Богдан»): дорога до
  Лісотехнікуму в OSM без назви.
- «Малинівський круг» — як у №12: на в'їзді на кільце із заходу (туди) і на виїзді з нього (назад).
- Старі ручні точки №3 т.1, т.2 з ланцюжків прибираємо; ті, що збіглися з новими точками повороту, лишаються.
- Петля біля вокзалу т.2–т.4 лишається як є.
Час кожного відрізка між справжніми зупинками не змінюємо. Нічого не записує, якщо не передати --apply."""
import sys

from build_more import DROP_TECH, build_routes, osm_route_anchors, osm_ways_projection, put_routes
from build_route12 import MK, MK_IN, MK_OUT, orphans

ROUTES = ['3']
REL = 7285799    # OSM: «Залізничний вокзал-Лісоколедж #3»
REL_MAX = 35.0
WEST = {'st_0038', 'st_0037', 'st_0039'}  # Лісотехнікум, Лісна, м-н «Богдан» — лише №3
OLD = {'st_0109', 'st_0110'}              # №3 т.1, т.2, поставлені вручну


def anchors(st):
    out = {k: v for k, v in osm_route_anchors(st, '3', REL, REL_MAX).items() if k[2] in WEST}
    p = (st[MK]['lat'], st[MK]['lng'])
    out[('3', 'orderThere', MK)] = osm_ways_projection(p, MK_IN)
    out[('3', 'orderBack', MK)] = osm_ways_projection(p, MK_OUT)
    return out


def build(d):
    return build_routes(d, ROUTES, drop={'3': OLD}, special_fn=anchors,
                        pool_skip=set().union(*DROP_TECH.values()) | orphans(d))


if __name__ == '__main__':
    put_routes(build, ROUTES, 'geom-8', '--apply' not in sys.argv)
