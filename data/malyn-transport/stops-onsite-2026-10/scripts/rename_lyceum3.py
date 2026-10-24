"""«ЗОШ 3» → «Малинський ліцей №3» (st_0020, st_0023) — як на наклейках, що висять на обох боках дороги (2026-10-24).

Школа тепер Малинський ліцей №3. Назва зупинки — рядковий «зовнішній ключ» (routes.fromName/toName, trips.headsign),
тому, як і редактор карти (applyStopRenamesToDataset у frontend/src/pages/AdminPage/stopRename.ts), міняємо точні
збіги старої назви й там; на 2026-10-24 їх немає — скрипт це друкує. Координати, ланцюжки, рейси й сегменти не змінюються.
Без --apply лише будує кандидата й перевіряє його валідатором.
Токен: VIBER_ADMIN_TOKEN (змінна або ~/.zshrc); --proxy-auth — без заголовка, Authorization додає проксі середовища."""
import copy
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', '..', 'audit-2026-10', 'scripts')))
from apply_lib import API, canon, fetch, http_json, now, save, validate  # noqa: E402
import apply_lib  # noqa: E402

OUT = os.path.join('data', 'malyn-transport', 'stops-onsite-2026-10')
RENAMES = {
    'st_0020': ('ЗОШ 3', 'Малинський ліцей №3'),
    'st_0023': ('ЗОШ 3 (навпроти)', 'Малинський ліцей №3 (навпроти)'),
}


def build(d):
    names = {old: new for old, new in RENAMES.values()}
    taken = {s['name'].lower() for s in d['stops'] if s['id'] not in RENAMES}
    for s in d['stops']:
        if s['id'] in RENAMES:
            old, new = RENAMES[s['id']]
            assert s['name'] == old, f'{s["id"]}: у базі «{s["name"]}», а не «{old}» — вже перейменовано?'
            assert new.lower() not in taken, f'«{new}» вже є в базі'
            s['name'] = new
            print(f'{s["id"]}: «{old}» → «{new}»')
    for r in d['routes']:
        for f in ('fromName', 'toName'):
            if r.get(f) in names:
                print(f'№{r["id"]} {f}: «{r[f]}» → «{names[r[f]]}»')
                r[f] = names[r[f]]
    trips = [t for t in d['trips'] if t.get('headsign') in names]
    for t in trips:
        t['headsign'] = names[t['headsign']]
    print(f'кінцеві маршрутів і headsign рейсів: {len(trips)} рейсів')
    return d


def main():
    apply = '--apply' in sys.argv
    ts = now()
    cur = fetch()
    nxt = build(copy.deepcopy(cur))
    plain = lambda d: {**d, 'stops': [{**s, 'name': ''} for s in d['stops']],  # noqa: E731
                       'routes': [{**r, 'fromName': '', 'toName': ''} for r in d['routes']],
                       'trips': [{**t, 'headsign': ''} for t in d['trips']]}
    assert canon(plain(cur)) == canon(plain(nxt)), 'змінилось щось, крім назв'
    validate(nxt, f'{ts}-lyceum3')  # пише кандидата в audit-2026-10 — переносимо до себе
    os.replace(apply_lib.path(f'db-{ts}-lyceum3-next.json'), os.path.join(OUT, f'db-{ts}-lyceum3-next.json'))
    print('валідатор: OK')
    if not apply:
        return
    save(os.path.join(OUT, f'db-{ts}-before-lyceum3.json'), cur, indent=None)
    tok = None if '--proxy-auth' in sys.argv else (os.environ.get('VIBER_ADMIN_TOKEN') or apply_lib.token())
    res = http_json('PUT', f'{API}/transport/dataset', {**nxt, 'baseRevision': cur['revision']}, tok)
    after = fetch()
    save(os.path.join(OUT, f'db-{ts}-after-lyceum3.json'), after, indent=None)
    assert canon(after) == canon(nxt), 'після PUT база не збігається з відправленим'
    print(f'PUT: {res["counts"]}, revision {res["revision"]}; перевірка після PUT: OK')


if __name__ == '__main__':
    main()
