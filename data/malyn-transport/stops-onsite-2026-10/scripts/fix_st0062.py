"""«Огієнка 65 (БАМ)» st_0062 — точка з місця (власник стояв на зупинці 2026-10-24, GPS з Google Maps).

Було 50.778308, 29.267712 — на 71 м західніше справжньої зупинки. Стало 50.778276, 29.268721: південний бік
вул. Івана Огієнка (9 м від осі OSM), де її беруть маршрути, що їдуть на схід (№3, 5, 10, 11, 12 туди, №9 назад).
«Огієнка 65 (БАМ) (навпроти)» st_0063 збігається з павільйоном OSM на північному боці — не чіпаємо.

- Технічні точки №5 т.35 (st_0157) і т.36 (st_0158) стоять на осі дороги перед і за зупинкою; переносимо їх разом
  із нею, з тими самими відступами вздовж осі, інакше лінія робила б гачок назад (т.36 опинився б на 57 м західніше).
- Час: відрізки до і після зупинки (від попередньої до наступної справжньої зупинки) рахуємо разом і ділимо за
  довжиною перегонів, як у build_route7.py; час між сусідніми зупинками зберігається, зсувається лише st_0062.
- Ланцюжки, рейси, варіанти шляху й опорні часи не змінюються.
Без --apply лише будує кандидата й перевіряє його валідатором. Токен: VIBER_ADMIN_TOKEN (змінна або ~/.zshrc)."""
import copy
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', '..', 'audit-2026-10', 'scripts')))
from apply_lib import API, canon, fetch, http_json, now, save, validate  # noqa: E402
import apply_lib  # noqa: E402
from common import dist_m, xy  # noqa: E402
from geo_lib import unxy  # noqa: E402

OUT = os.path.join('data', 'malyn-transport', 'stops-onsite-2026-10')
STOP = 'st_0062'
OLD = (50.778308, 29.267712)
NEW = (50.778276, 29.268721)  # https://maps.app.goo.gl/j6Uf7PL2Xypo2VKu5
BEFORE, AFTER = 'st_0157', 'st_0158'  # №5 т.35, №5 т.36
# OSM way 701166645 «вулиця Івана Огієнка», вершини навколо зупинки (захід → схід)
AXIS = [(50.778504, 29.26703), (50.778474, 29.267382), (50.778366, 29.268625), (50.778268, 29.269715)]


def along(lat, lng):
    """Позиція проекції на AXIS, м від початку."""
    px, py = xy(lat, lng)
    best, acc = None, 0.0
    for a, b in zip(AXIS, AXIS[1:]):
        (ax, ay), (bx, by) = xy(*a), xy(*b)
        dx, dy = bx - ax, by - ay
        ln2 = dx * dx + dy * dy
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ln2))
        d = ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2) ** 0.5
        if best is None or d < best[0]:
            best = (d, acc + t * ln2 ** 0.5)
        acc += ln2 ** 0.5
    return best


def at(s):
    """Точка осі на позиції s м."""
    acc = 0.0
    for a, b in zip(AXIS, AXIS[1:]):
        (ax, ay), (bx, by) = xy(*a), xy(*b)
        ln = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
        if s <= acc + ln:
            t = (s - acc) / ln
            lat, lng = unxy(ax + t * (bx - ax), ay + t * (by - ay))
            return round(lat, 6), round(lng, 6)
        acc += ln
    raise ValueError(s)


def chains(d, rid):
    """Усі ланцюжки маршруту: головні (туди / назад) і варіанти шляху."""
    out = []
    for key in ('orderThere', 'orderBack'):
        rs = sorted((x for x in d['routeStops'] if x['routeId'] == rid and x[key] >= 0), key=lambda x: x[key])
        out.append([x['stopId'] for x in rs])
    route = next(r for r in d['routes'] if r['id'] == rid)
    out += [[s['stopId'] for s in v['stops']] for v in route.get('variants') or []]
    return [c for c in out if STOP in c]


def build(d):
    st = {s['id']: s for s in d['stops']}
    assert (round(st[STOP]['lat'], 6), round(st[STOP]['lng'], 6)) == OLD, 'зупинку вже переносили'
    s0 = along(*OLD)[1]
    off_before = along(st[BEFORE]['lat'], st[BEFORE]['lng'])[1] - s0
    off_after = along(st[AFTER]['lat'], st[AFTER]['lng'])[1] - s0
    side, s1 = along(*NEW)
    print(f'{STOP}: {dist_m(*OLD, *NEW):.0f} м на схід, {side:.0f} м від осі; т.35 {off_before:+.0f} м, т.36 {off_after:+.0f} м')
    pos = {STOP: NEW, BEFORE: at(s1 + off_before), AFTER: at(s1 + off_after)}
    for sid, (lat, lng) in pos.items():
        st[sid]['lat'], st[sid]['lng'] = lat, lng

    mo = {(x['routeId'], x['stopId']) for x in d['routeStops'] if x['mapOnly']}
    seg = {(s['routeId'], s['fromStopId'], s['toStopId']): s for s in d['segments']}
    default = d['meta'].get('defaultSec', 120)
    for rid in sorted({x['routeId'] for x in d['routeStops'] if x['stopId'] == STOP}):
        spans = set()
        for c in chains(d, rid):
            i = c.index(STOP)
            a = max(k for k in range(i) if (rid, c[k]) not in mo)
            b = min(k for k in range(i + 1, len(c)) if (rid, c[k]) not in mo)
            spans.add(tuple(c[a:b + 1]))
        hops_all = [h for span in spans for h in zip(span, span[1:])]
        assert len(hops_all) == len(set(hops_all)), f'№{rid}: ланцюжки ділять перегін по-різному'
        for span in sorted(spans):
            hops = list(zip(span, span[1:]))
            have = [(rid, p, q) in seg for p, q in hops]
            if not any(have):  # №1: прихований, зупинки за абеткою, сегментів немає (по defaultSec на перегін)
                print(f'№{rid}: сегментів немає — час не змінюється')
                continue
            assert all(have), f'№{rid}: перегін без сегмента'
            total = sum(seg[(rid, p, q)]['seconds'] for p, q in hops)
            lens = [max(1.0, dist_m(st[p]['lat'], st[p]['lng'], st[q]['lat'], st[q]['lng'])) for p, q in hops]
            acc = prev = 0
            for (p, q), ln in zip(hops, lens):
                acc += ln
                cum = round(total * acc / sum(lens))
                seg[(rid, p, q)]['seconds'] = max(1, cum - prev)
                prev = cum
            k = span.index(STOP)
            to_stop = sum(seg[(rid, p, q)]['seconds'] for p, q in hops[:k])
            print(f'№{rid}: {st[span[0]]["name"]} → {st[span[-1]]["name"]} {total} с, до зупинки {to_stop} с')
    return d


def main():
    apply = '--apply' in sys.argv
    ts = now()
    cur = fetch()
    nxt = build(copy.deepcopy(cur))
    plain = lambda d: {**d, 'stops': [s for s in d['stops'] if s['id'] not in (STOP, BEFORE, AFTER)],  # noqa: E731
                       'segments': []}
    assert canon(plain(cur)) == canon(plain(nxt)), 'змінилось щось, крім трьох точок і сегментів'
    validate(nxt, f'{ts}-st0062')  # пише кандидата в audit-2026-10 — переносимо до себе
    os.replace(apply_lib.path(f'db-{ts}-st0062-next.json'), os.path.join(OUT, f'db-{ts}-st0062-next.json'))
    print('валідатор: OK')
    if not apply:
        return
    save(os.path.join(OUT, f'db-{ts}-before-st0062.json'), cur, indent=None)
    tok = os.environ.get('VIBER_ADMIN_TOKEN') or apply_lib.token()
    res = http_json('PUT', f'{API}/transport/dataset', {**nxt, 'baseRevision': cur['revision']}, tok)
    after = fetch()
    save(os.path.join(OUT, f'db-{ts}-after-st0062.json'), after, indent=None)
    assert canon(after) == canon(nxt), 'після PUT база не збігається з відправленим'
    print(f'PUT: {res["counts"]}, revision {res["revision"]}; перевірка після PUT: OK')


if __name__ == '__main__':
    main()
