"""Фаза 6 (Docs/route-variants-2026-10.md): маршрут №9 за листком міськради, лінією №9 в OSM і рішеннями власника.

Основні ланцюжки — лише звичайні рейси «Базарна площа – вул. Олекси Тихого»:
- туди: Промінь → Бандери → Машинобудівників → Огієнка → Малинівський круг (повз зупинку не проїжджає) → Малинівка
  (петля Молодіжна → Аграрна → Злагоди → до переїзду, як лінія №9 в OSM, relation 19065480) → Юрівка → вул. Олекси
  Тихого → перехрестя з Філатова (кінцева, рішення власника);
- назад — тими самими вулицями без петлі (так сходиться час першого рейсу: Малинівка 7:25 → БАМ 7:30).
На спільних вулицях — зупинки свого боку дороги, як у сусідів: на Бандери «туди» — С.Бандери 36 і Горбатюка-Бандери,
«назад» — Горбатюка-Бандери 2 і ДНЗ № 3 (як №7 і №8); біля БАМ «туди» (на захід) — «Огієнка 65 (БАМ) (навпроти)»,
«назад» — «Огієнка 65 (БАМ)» (як №3, №5, №10, №11, №12); «Малинівський круг» — лише «назад»: «туди» автобус проходить
кільце за 92 м від зупинки. Вокзал і лікарня — лише в першому рейсі.

Перший рейс (листок): Центр 6:45 → Машинобудівників → Вокзал 7:05 → переїзд → Олекси Тихого 7:15 → Малинівка 7:25 →
БАМ 7:30 → Центр 7:45 → Лікарня 7:50. Два рейси на варіантах шляху, спільний blockId «9-first»:
- 9-v1 «до вокзалу» (туди): Промінь → … → Царське село → Огієнка на схід (без зупинок) → Вокзал, опора 7:05;
- 9-v2 «від вокзалу до лікарні» (назад): Вокзал → єдиний дорожній переїзд через головну колію (охоронюваний,
  північно-західніше вокзалу; біля самого вокзалу — лише під'їзд через промислові колії) → Олекси Тихого → кінцева
  біля Філатова (7:15) → далі звичайним шляхом «назад» → Промінь → Лікарня; опори з листка.
Час перегонів — алгоритмом серверного «Перерахувати час» (backend/src/transport-segments.ts: пауза, 35 / 45 км/год,
щонайменше 30 с на відрізок, у середньому не швидше 24 км/год), але довжина — за лінією (технічні точки йдуть
дорогою), а не за OSRM для кожного перегону. Нічого не записує, якщо не передати --apply."""
import copy
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', '..', 'route-geometry-2026-10', 'scripts')))

from build_geometry import MERGE, anchor, bends_for  # noqa: E402
from build_more import build_routes, osm_route_anchors, road  # noqa: E402
from geo_lib2 import chain, dist_m, fetch, route_minutes, set_chains  # noqa: E402
import common  # noqa: E402
from geo_lib import axis_point, unxy  # noqa: E402

common.AUDIT = os.path.join('data', 'malyn-transport', 'route-variants-2026-10')

RID = '9'
REL = 19065480   # OSM: «Центр (вул. Степана Бандери) - вул. Олекси Тихого #9» (лише «туди»)
REL_MAX = 35.0   # м — далі від лінії OSM зупинку для маршрутизації не проєктуємо

PROMIN, BANDERY36, GORB, GORB2, DNZ3 = 'st_0049', 'st_0081', 'st_0068', 'st_0073', 'st_0014'
KONOV, TSARSKE, BAM, BAM_OPP, MK = 'st_0071', 'st_0090', 'st_0062', 'st_0063', 'st_0054'
MALYNIVKA, YURIVKA, TYKHOHO, FILATOVA = 'st_0053', 'st_0099', 'st_0009', 'st_0069'
VOKZAL, LIKARNIA = 'st_0019', 'st_0035'

THERE = [PROMIN, BANDERY36, GORB, KONOV, TSARSKE, BAM_OPP, MALYNIVKA, YURIVKA, TYKHOHO, FILATOVA]
BACK = [FILATOVA, TYKHOHO, YURIVKA, MALYNIVKA, MK, BAM, TSARSKE, KONOV, GORB2, DNZ3, PROMIN]
OFF_ROUTE = {VOKZAL, LIKARNIA}  # рядки №9 прибираємо: лише в першому рейсі (варіанти)

# Петля в Малинівці — вершини доріг лінії №9 в OSM: кінець Молодіжної / Аграрна / злам Злагоди / південний кінець
# Злагоди / дорога без назви / роздоріжжя біля переїзду (сюди петля повертається)
LOOP_VIA = [(50.78578, 29.28206), (50.78821, 29.27800), (50.78901, 29.27375), (50.78541, 29.27198),
            (50.78476, 29.27352), (50.78411, 29.27506)]

# Перехрестя Бандери й Машинобудівників (вершина лінії №9 в OSM): «туди» автобус їде Бандери до проспекту, а OSRM
# від «Горбатюка-Бандери» зрізав би бічною вулицею Горбатюка
BANDERY_MASH = (50.76242, 29.26139)

# Від центру до лікарні — як №7 «назад» (Промінь → маркет «Соборний») і №5 «назад» (Шевченка → Бондарика), а не
# навпростець вуличками: точки маршрутизації — їхні зупинки (без зупинок 9-v2)
TAIL_VIA = ['st_0056', 'st_0098', 'st_0119', 'st_0045', 'st_0097', 'st_0067', 'st_0036']

V1, V2 = '9-v1', '9-v2'
V1_NAME, V2_NAME = 'до вокзалу', 'від вокзалу до лікарні'
BLOCK = '9-first'
FIRST_THERE, FIRST_BACK = '9-01', '9-02'
TIMEPOINTS_V1 = [(VOKZAL, '07:05')]
TIMEPOINTS_V2 = [(FILATOVA, '07:15'), (MALYNIVKA, '07:25'), (BAM, '07:30'), (PROMIN, '07:45'), (LIKARNIA, '07:50')]
TO_NAME = 'вул. Олекси Тихого'  # офіційна назва — «Базарна площа – вул. Олекси Тихого» (конкурс міськради 2026)


def anchors(st):
    """Точки маршрутизації. «Туди» — проєкція на лінію №9 з OSM (вона описує лише цей напрямок). «Назад»
    «Малинівський круг» — точка кільця біля зупинки: №9 заїжджає на кільце з Грушевського (з боку Малинівки) і
    об'їжджає його повз зупинку до виїзду на Огієнка, а загальне правило поставило б її на під'їзд із заходу."""
    out = osm_route_anchors(st, RID, REL, REL_MAX, keys=('orderThere',))
    _, (cx, cy), _ = axis_point(st[MK]['lat'], st[MK]['lng'], 'Малинівський круг')
    out[(RID, 'orderBack', MK)] = unxy(cx, cy)
    return out


def via_points(st=None):
    """«Туди»: від Горбатюка-Бандери — Бандери до проспекту Машинобудівників; від Малинівки — петлею, а не прямо
    Молодіжною до Незламної."""
    return {(RID, 'orderThere', GORB, KONOV): [BANDERY_MASH], (RID, 'orderThere', MALYNIVKA, YURIVKA): LOOP_VIA}


def orphans(d):
    """Технічні точки, що не стоять на жодному маршруті й варіанті (старі ручні точки зі статтями) — не
    перевикористовуємо. Точки варіантів №9 — вживані: повторний запуск бере їх знову."""
    used = {x['stopId'] for x in d['routeStops']} | {p['stopId'] for r in d['routes'] for v in (r.get('variants') or [])
                                                     for p in v['stops']}
    return {s['id'] for s in d['stops'] if re.match(r'^№\S+ т\.\d+$', s['name']) and s['id'] not in used}


class Points:
    """Технічні точки варіантів: наявна точка ближче MERGE (не вжита в цьому ланцюжку) або нова «№9 т.N»."""

    def __init__(self, d, pool_ids):
        self.d = d
        self.st = {s['id']: s for s in d['stops']}
        self.pool = [self.st[i] for i in pool_ids if i in self.st]
        self.taken = {s['name'] for s in d['stops']}
        self.next_id = 1 + max(int(s['id'][3:]) for s in d['stops'] if re.match(r'^st_\d+$', s['id']))
        nums = [int(m.group(1)) for s in d['stops'] for m in [re.match(rf'^№{RID} т\.(\d+)$', s['name'])] if m]
        self.counter = max(nums, default=0)
        self.created = []

    def get(self, pos, used):
        near = min(((dist_m(p['lat'], p['lng'], *pos), p['id']) for p in self.pool + self.created if p['id'] not in used),
                   default=(MERGE + 1, None))
        if near[0] <= MERGE:
            return near[1]
        while True:
            self.counter += 1
            name = f'№{RID} т.{self.counter}'
            if name not in self.taken:
                break
        sid = f'st_{self.next_id:04d}'
        self.next_id += 1
        p = {'id': sid, 'name': name, 'lat': round(pos[0], 6), 'lng': round(pos[1], 6)}
        self.created.append(p)
        self.taken.add(name)
        self.st[sid] = p
        return sid


def leg_points(pts, st, a, b, aa, bb, via, used):
    """Технічні точки перегону a → b дорогою (OSRM між точками маршрутизації aa → via… → bb)."""
    P = lambda i: (st[i]['lat'], st[i]['lng'])  # noqa: E731
    out = []
    for pos in bends_for(P(a), P(b), road(aa, bb, via)):
        sid = pts.get(pos, used)
        used.add(sid)
        out.append(sid)
    return out


def build_variants(d, pool_ids):
    """Варіанти першого рейсу: [(stopId, mapOnly)] для 9-v1 і 9-v2."""
    st = {s['id']: s for s in d['stops']}
    pts = Points(d, pool_ids)
    there, back = chain(d, RID, 'orderThere'), chain(d, RID, 'orderBack')

    # 9-v1: як «туди» до Царського села, далі Машинобудівників → Огієнка на схід → вокзал
    head = there[:there.index(TSARSKE) + 1]
    used = set(head)
    v1 = head + leg_points(pts, st, TSARSKE, VOKZAL, anchor(st, TSARSKE), anchor(st, VOKZAL), (), used) + [VOKZAL]

    # 9-v2: вокзал → переїзд → Олекси Тихого → Філатова, далі весь ланцюжок «назад», потім Промінь → лікарня.
    # Шлях від вокзалу йде Олекси Тихого на південь, а «назад» — нею ж на північ: точки беремо різні.
    body = back[:]
    used = set(body)
    lead = leg_points(pts, st, VOKZAL, FILATOVA, anchor(st, VOKZAL), anchor(st, FILATOVA), (), used)
    tail = leg_points(pts, st, PROMIN, LIKARNIA, anchor(st, PROMIN), anchor(st, LIKARNIA),
                      [anchor(st, x) for x in TAIL_VIA], used)
    v2 = [VOKZAL] + lead + body + tail + [LIKARNIA]
    is_tech = lambda i: bool(re.match(r'^№\S+ т\.\d+$', pts.st[i]['name']))  # noqa: E731
    return {V1: [(i, is_tech(i)) for i in v1], V2: [(i, is_tech(i)) for i in v2]}, pts.created


# ---------- час: як серверний перерахунок, але довжина — за лінією ----------

def secs_from_dist(m, pause):
    speed = 45 if m >= 600 else 35
    return round((12 if pause else 0) + m / 1000 / speed * 3600)


def chain_seconds(technical, dists):
    """Копія chainSegmentSeconds з backend/src/transport-segments.ts."""
    n, out, start = len(dists), [0] * len(dists), 0
    for i in range(1, n + 1):
        if i < n and technical[i]:
            continue
        hops = dists[start:i]
        span = sum(max(0, x) for x in hops)
        sec = max(30, secs_from_dist(span, not technical[start]))
        acc = prev = 0
        for k, x in enumerate(hops):
            acc += max(0, x)
            cum = round(sec * acc / span) if span > 0 else round(sec * (k + 1) / len(hops))
            out[start + k] = max(1, cum - prev)
            prev = cum
        start = i
    return out


def timed_chain(st, ids, technical):
    dists = [dist_m(st[a]['lat'], st[a]['lng'], st[b]['lat'], st[b]['lng']) for a, b in zip(ids, ids[1:])]
    sec = chain_seconds(technical, dists)
    t24 = sum(dists) / 1000 / 24 * 3600  # у середньому не швидше 24 км/год
    if t24 > sum(sec):
        sec = [max(1, round(v * t24 / sum(sec))) for v in sec]
    return sec


def route_segments(d, variants):
    st = {s['id']: s for s in d['stops']}
    tech = {x['stopId'] for x in d['routeStops'] if x['routeId'] == RID and x.get('mapOnly')}
    seg = {}
    for key in ('orderThere', 'orderBack'):
        ids = chain(d, RID, key)
        for a, b, v in zip(ids, ids[1:], timed_chain(st, ids, [i in tech for i in ids])):
            seg[(a, b)] = v
    for vid in (V1, V2):  # варіант лише доповнює: спільні перегони — як в основних ланцюжках
        ids = [i for i, _ in variants[vid]]
        for a, b, v in zip(ids, ids[1:], timed_chain(st, ids, [m for _, m in variants[vid]])):
            seg.setdefault((a, b), v)
    return [{'routeId': RID, 'fromStopId': a, 'toStopId': b, 'seconds': v} for (a, b), v in seg.items()]


# ---------- датасет ----------

def build(d):
    """Мутує датасет d → (d, створені технічні точки)."""
    pool_skip = orphans(d)
    set_chains(d, RID, THERE, BACK)
    d, created = build_routes(d, [RID], drop={RID: OFF_ROUTE}, special_fn=anchors, via_fn=via_points,
                              pool_skip=pool_skip)
    pool_ids = [s['id'] for s in d['stops'] if re.match(r'^№\S+ т\.\d+$', s['name']) and s['id'] not in pool_skip]
    variants, created_v = build_variants(d, pool_ids)
    d['stops'] += created_v
    for r in d['routes']:
        if r['id'] == RID:
            r['toName'] = TO_NAME
            r['variants'] = [
                {'id': V1, 'directionId': '1', 'name': V1_NAME, 'stops': [{'stopId': i, **({'mapOnly': True} if m else {})}
                                                                        for i, m in variants[V1]]},
                {'id': V2, 'directionId': '0', 'name': V2_NAME, 'stops': [{'stopId': i, **({'mapOnly': True} if m else {})}
                                                                        for i, m in variants[V2]]},
            ]
    for t in d['trips']:
        if t['routeId'] != RID:
            continue
        if t['id'] == FIRST_THERE:
            t.update(variantId=V1, startStopId=None, endStopId=None, arrivalTime=None, blockId=BLOCK,
                     timepoints=[{'stopId': s, 'time': h} for s, h in TIMEPOINTS_V1])
        elif t['id'] == FIRST_BACK:
            t.update(variantId=V2, startStopId=None, endStopId=None, arrivalTime=None, blockId=BLOCK,
                     timepoints=[{'stopId': s, 'time': h} for s, h in TIMEPOINTS_V2])
        elif t['directionId'] == '1':
            t.update(endStopId=None)          # до кінцевої біля Філатова; arrivalTime (лише стискає) — там же
        else:
            t.update(startStopId=None, endStopId=None)  # від кінцевої біля Філатова до Променя
    d['segments'] = [s for s in d['segments'] if s['routeId'] != RID] + route_segments(d, variants)
    return d, created + created_v


if __name__ == '__main__':
    from put9 import put
    put(build, '--apply' in sys.argv)
