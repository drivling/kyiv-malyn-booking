"""Фаза 6 виправлень: графік №10 — копія фото-розкладу «Маршрут №10» з №12 (рішення власника 2026-10-10).

- 25 рейсів №12 → №10 з id 10-03…10-27 (12-NN → 10-(NN+2), порядок і чергування напрямків ті самі);
  напрямок, час відправлення і `serviceId` — як у №12; табличка — кінцева №10 у цьому напрямку
  («Залізничний вокзал» туди, «Поліклініка» назад); без власних кінцевих і прибуття.
- рейси 10-01 / 10-02 (номер автобуса АМ0033АА з файлу 2024, без часу) лишаються;
- людський розклад (`schedule`) — копія з №12, примітка №10 — що розклад скопійовано;
- №10 лишається прихованим (`unreliable`), №12 не змінюється, сегменти не перераховуємо (ланцюжки ті самі)."""
import copy
import sys

from apply_lib import apply_change, chain

OLD_NOTE_TAIL = 'Розкладу немає, маршрут прихований.'
NEW_NOTE_TAIL = ('Розклад скопійовано з №12 (фото оголошення «Маршрут №10») 2026-10-10 за рішенням власника; '
                 'маршрут прихований до перевірки на місці.')


def build(d):
    nm = {s['id']: s['name'] for s in d['stops']}
    routes = {r['id']: r for r in d['routes']}
    r10, r12 = routes['10'], routes['12']
    assert r10.get('unreliable') is True, '№10 має бути прихованим'
    assert not r10.get('schedule'), 'у №10 вже є розклад'
    assert r10['note'].endswith(OLD_NOTE_TAIL), r10['note']
    t10 = [t for t in d['trips'] if t['routeId'] == '10']
    t12 = sorted([t for t in d['trips'] if t['routeId'] == '12'], key=lambda t: int(t['id'].split('-')[1]))
    assert sorted(t['id'] for t in t10) == ['10-01', '10-02'] and all(not t['departureTime'] for t in t10), t10
    assert len(t12) == 25 and [int(t['id'].split('-')[1]) for t in t12] == list(range(1, 26))
    head = {'1': nm[chain(d, '10', 'orderThere')[-1]], '0': nm[chain(d, '10', 'orderBack')[-1]]}
    assert head == {'1': 'Залізничний вокзал', '0': 'Поліклініка'}, head
    taken = {t['id'] for t in d['trips']}
    for t in t12:
        assert t['departureTime'] and not t.get('startStopId') and not t.get('endStopId') and not t.get('arrivalTime'), t
        new = dict(t)
        new.update({'id': f"10-{int(t['id'].split('-')[1]) + 2:02d}", 'routeId': '10', 'headsign': head[t['directionId']],
                    'blockId': None, 'startStopId': None, 'endStopId': None, 'arrivalTime': None})
        assert new['id'] not in taken, new['id']
        d['trips'].append(new)
    r10['schedule'] = copy.deepcopy(r12['schedule'])
    r10['note'] = r10['note'][: -len(OLD_NOTE_TAIL)] + NEW_NOTE_TAIL
    return d


if __name__ == '__main__':
    dry = '--apply' not in sys.argv
    cur, nxt = apply_change('fix6', build, set(), {'10'}, dry=dry)
    trips = sorted([t for t in nxt['trips'] if t['routeId'] == '10'], key=lambda t: (t['directionId'], t['departureTime'] or ''))
    for lab, did in (('туди (до Вокзалу)', '1'), ('назад (до Поліклініки)', '0')):
        times = [t['departureTime'][:5] for t in trips if t['directionId'] == did and t['departureTime']]
        print(f'№10 {lab}: {len(times)} рейсів: {", ".join(times)}')
    r10 = next(r for r in nxt['routes'] if r['id'] == '10')
    print('№10 unreliable:', r10['unreliable'], '| note:', r10['note'][-140:])
    print('№12 без змін:', next(r for r in cur['routes'] if r['id'] == '12') == next(r for r in nxt['routes'] if r['id'] == '12'),
          sorted(t['id'] for t in cur['trips'] if t['routeId'] == '12') == sorted(t['id'] for t in nxt['trips'] if t['routeId'] == '12'))
