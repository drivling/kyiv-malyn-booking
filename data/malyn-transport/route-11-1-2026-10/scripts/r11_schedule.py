"""Фаза 2: розклад №11 (11/1) з листка 2026-10-10 (sheet-2026-10-10.json).

Туди (directionId 1, від Паперової фабрики): відправлення — фабрика, прибуття — Вокзал; рейс 18:45 — лише до
Барміна (кінцева Барміна). Назад (directionId 0, від Вокзалу): прибуття — Барміна; рейс 6:20 — лише від фабрики
до Барміна (початок — фабрика). Старі 17 рейсів (розклад міськради) замінюємо всі. Людський розклад — з листка,
без прізвища водія."""
import json
import os
import sys

from r11_lib import BAR, PF, apply_change, chain

HERE = os.path.dirname(os.path.abspath(__file__))
SHEET = json.load(open(os.path.join(HERE, '..', 'sheet-2026-10-10.json'), encoding='utf-8'))
DEFAULT_SEC = 120


def hhmm(s):
    s = s.replace('+ заправка', '').strip()
    h, m = s.split(':')
    return f'{int(h):02d}:{int(m):02d}:00'


def trips_from_sheet():
    out = []
    for pf, b, v, _ in SHEET['there']['rows']:
        out.append({'directionId': '1', 'departureTime': hhmm(pf), 'arrivalTime': hhmm(v or b),
                    'startStopId': None, 'endStopId': None if v else BAR,
                    'headsign': 'Залізничний вокзал' if v else 'Барміна'})
    for v, pf, b, _ in SHEET['back']['rows']:
        out.append({'directionId': '0', 'departureTime': hhmm(v or pf), 'arrivalTime': hhmm(b),
                    'startStopId': None if v else PF, 'endStopId': None, 'headsign': 'Барміна'})
    out.sort(key=lambda t: (t['departureTime'], t['directionId'] != '1'))
    # wheelchairAccessible / bikesAllowed — порожні, як у всіх старих рейсах №11
    return [{'id': f'11-{i + 1:02d}', 'routeId': '11', 'serviceId': 'everyday', 'blockId': None,
             'wheelchairAccessible': '', 'bikesAllowed': '', **t}
            for i, t in enumerate(out)]


def times(rows, col):
    return ', '.join(r[col].replace(' + заправка', '') for r in rows if r[col])


SCHEDULE = {
    'note': ('За листком 10.10.2026 «Паперова фабрика – Барміна – Вокзал ч/з Прожектор і в зворотньому напрямку '
             '11/1». Туди: 5:50 — до електрички 6:35; 17:05 — електричка 17:22; після 17:55 — заправка; 18:45 — '
             'лише до Барміна. Назад: 6:20 — від Паперової фабрики до Барміна; 18:30 — із заправкою; 19:30 — '
             'після електрички 19:25.'),
    'lunch_break': 'з Вокзалу немає рейсів між 13:30 і 15:15 (після 13:30 — до вокзалу за маршрутом і на обід)',
    'schedule_entries': [
        {'label': 'З Паперової фабрики (через Барміна)', 'times': times(SHEET['there']['rows'], 0)},
        {'label': 'З Вокзалу (до Паперової фабрики й Барміна)', 'times': times(SHEET['back']['rows'], 0)},
        {'label': 'Від Паперової фабрики до Барміна', 'times': '6:20'},
    ],
}


def build(d):
    old = [t for t in d['trips'] if t['routeId'] == '11']
    assert len(old) == 17, len(old)
    keys = set(old[0].keys())
    new = trips_from_sheet()
    assert len(new) == 32 and all(set(t) == keys for t in new), (len(new), keys ^ set(new[0]))
    d['trips'] = [t for t in d['trips'] if t['routeId'] != '11'] + new
    r = next(r for r in d['routes'] if r['id'] == '11')
    r['schedule'] = SCHEDULE
    for t in new:  # старт і кінець — у ланцюжку свого напрямку
        c = chain(d, '11', 'orderThere' if t['directionId'] == '1' else 'orderBack')
        for k in ('startStopId', 'endStopId'):
            assert t[k] is None or t[k] in c, (t['id'], k)
    return d


def report(d):
    """Той самий розрахунок, що tripTiming.ts: сума сегментів, стиснення під пізніше прибуття (без розтягування)."""
    seg = {(s['fromStopId'], s['toStopId']): s['seconds'] for s in d['segments'] if s['routeId'] == '11'}
    rows = []
    for t in sorted((t for t in d['trips'] if t['routeId'] == '11'), key=lambda t: (t['directionId'] != '1', t['departureTime'])):
        c = chain(d, '11', 'orderThere' if t['directionId'] == '1' else 'orderBack')
        a = c.index(t['startStopId']) if t['startStopId'] else 0
        b = c.index(t['endStopId']) if t['endStopId'] else len(c) - 1
        need = sum(seg.get((x, y), DEFAULT_SEC) for x, y in zip(c[a:b], c[a + 1:b + 1])) / 60
        dep = int(t['departureTime'][:2]) * 60 + int(t['departureTime'][3:5])
        arr = int(t['arrivalTime'][:2]) * 60 + int(t['arrivalTime'][3:5])
        shown = dep + min(need, arr - dep)
        rows.append((t['id'], t['directionId'], t['departureTime'][:5], t['arrivalTime'][:5], round(need, 1),
                     f'{int(shown) // 60:02d}:{int(round(shown)) % 60:02d}', round(arr - dep - need, 1)))
    return rows


if __name__ == '__main__':
    dry = '--apply' not in sys.argv
    cur, nxt = apply_change('r11-2', build, set(), {'11'}, dry=dry)
    rows = report(nxt)
    comp = [r for r in rows if r[6] < 0]
    print(f'рейсів {len(rows)}; стиснуто під листок: {len(comp)}; раніше за листок на сайті: {sum(1 for r in rows if r[6] > 0.5)}')
    for r in rows:
        print('  %s напр.%s %s → листок %s | сегменти %4.1f хв → на сайті %s | різниця %+.1f' % r)
