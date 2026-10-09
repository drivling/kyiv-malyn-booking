"""Фаза 4: маршрут №10 (колишній №6).
  --plan   порядок за шляхом OSM rel 7458748 + списком файлу 2024 → route10-proposal.json (без мережі)
  --apply  свіжий знімок-бекап → новий датасет → валідація + інваріанти → PUT → перевірка
  --segments  POST /admin/transport/recalculate-segments {routeId:'10'} → перевірка
Правила: пари розводимо за боком дороги (правосторонній рух; у напрямку OSM Вокзал→Поліклініка праворуч =
наш «назад», dir 0); одиночні — в обидва боки; поза шляхом (>45 м) — лишаються в №10 з -1."""
import datetime
import glob
import json
import subprocess
import sys
import urllib.request

from common import API, load, path, save

THRESH = 45
# Пари «один стовпчик на кожен бік»: беремо той, що праворуч від руху
PAIRS = [('st_0085', 'st_0061'), ('st_0033', 'st_0034'), ('st_0016', 'st_0017'), ('st_0062', 'st_0063'),
         ('st_0083', 'st_0084'), ('st_0004', 'st_0005'), ('st_0070', 'st_0056'), ('st_0050', 'st_0098'),
         ('st_0020', 'st_0023'), ('st_0001', 'st_0080')]
# Одиночні, що лежать за порогом через особливості геометрії, але точно на шляху (кільце)
FORCE_ON = {'st_0054': 'Малинівський круг — шлях проходить кільцем, точка зупинки на в\'їзді (56 м від осі)'}
# Одиночні на шляху, які за назвою/практикою інших маршрутів обслуговують лише один бік
ONE_SIDE = {'st_0052': 'back'}  # «Сонечко»: як у №3/7/12 — лише в бік Поліклініки (правий бік)
# Свідомо вимкнені (-1) з причиною
OFF_REASON = {
    'st_0082': 'координати хибні (стоїть у центрі); за адресою — біля Малинівського круга, на шляху. Увімкнути після '
               'перенесення точки: «туди» перед «Малинівський круг», «назад» після нього',
}
# Технічні точки біля вокзалу — як у №3/11/12 (той самий підхід до Вокзальної площі)
TECH_THERE_TAIL = ['st_0104', 'st_0102']   # … Фратеко → т.4 → т.2 → Вокзал
TECH_BACK_HEAD = ['st_0103', 'st_0104']    # Вокзал → т.3 → т.4 → Огієнка 36 …


def plan():
    P = load(path('route10-projection.json'))
    by = {s['id']: s for s in P['stops'] if s['in_route10']}
    pair_of = {a: b for a, b in PAIRS} | {b: a for a, b in PAIRS}
    there, back, off = [], [], []
    for s in sorted(by.values(), key=lambda x: x['along']):
        sid = s['id']
        on = s['dist'] <= THRESH or sid in FORCE_ON
        if sid in OFF_REASON or not on:
            off.append({'id': sid, 'name': s['name'], 'dist': s['dist'],
                        'reason': OFF_REASON.get(sid, f'за {s["dist"]} м від шляху (маршрут тут не їде)')})
            continue
        if sid in pair_of:
            side = 'back' if s['side_osm'] == 'праворуч' else 'there'
        else:
            side = ONE_SIDE.get(sid, 'both')
        rec = {'id': sid, 'name': s['name'], 'along': s['along'], 'side_osm': s['side_osm'], 'dist': s['dist']}
        if side in ('back', 'both'):
            back.append(rec)
        if side in ('there', 'both'):
            there.append(rec)
    there.sort(key=lambda r: -r['along'])  # туди: Поліклініка → Вокзал
    back.sort(key=lambda r: r['along'])    # назад: Вокзал → Поліклініка
    # перевірка пар: обидва члени мають бути на різних боках
    for a, b in PAIRS:
        sa = [x for x in there if x['id'] == a] + [x for x in back if x['id'] == a]
        assert a in by and b in by, (a, b)
        assert not ({a, b} <= {x['id'] for x in there}) and not ({a, b} <= {x['id'] for x in back}), f'пара {a}/{b} в одному напрямку'
    there_ids = [r['id'] for r in there]
    back_ids = [r['id'] for r in back]
    assert there_ids[0] == 'st_0072' and there_ids[-1] == 'st_0019', there_ids
    assert back_ids[0] == 'st_0019' and back_ids[-1] == 'st_0072', back_ids
    there_chain = there_ids[:-1] + TECH_THERE_TAIL + there_ids[-1:]
    back_chain = back_ids[:1] + TECH_BACK_HEAD + back_ids[1:]
    names = {s['id']: s['name'] for s in P['stops']}
    out = {
        'relation': P['relation'], 'path_length_m': P['length_m'],
        'there': there, 'back': back, 'off': off,
        'there_chain': there_chain, 'back_chain': back_chain,
        'tech': sorted(set(TECH_THERE_TAIL + TECH_BACK_HEAD)),
        'route': {
            'fromName': 'Поліклініка', 'toName': 'Залізничний вокзал',
            'scheme': 'Поліклініка – Вокзал ч/з вул. 10-ї ОГШБ, Шевченка, центр, Залужного, Винниченка (автостанція), '
                      'Українських Повстанців, Мирутенка, Малинівський круг, Огієнка (і назад)',
            'note': 'Колишній №6 (data.gov.ua 2024). Порядок зупинок — за шляхом OSM rel 7458748 і списком зупинок '
                    'файлу 2024, бік дороги — за правостороннім рухом (аудит 2026-10, '
                    'Docs/transport-stops-audit-2026-10.md). Розкладу немає, маршрут прихований.',
        },
    }
    save(path('route10-proposal.json'), out)
    print('туди  (%d):' % len(there_chain), ' → '.join(names[i] for i in there_chain))
    print('назад (%d):' % len(back_chain), ' → '.join(names[i] for i in back_chain))
    print('-1    (%d):' % len(off), '; '.join(f"{o['name']} ({o['reason'][:40]})" for o in off))


# ---------- запис ----------
def token():
    t = subprocess.run(['zsh', '-ic', 'printf %s "${VIBER_ADMIN_TOKEN:-}"'], capture_output=True, text=True).stdout
    if len(t) != 64:
        sys.exit('VIBER_ADMIN_TOKEN не знайдено в ~/.zshrc')
    return t


def http_json(method, url, body=None, tok=None):
    req = urllib.request.Request(url, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', 'Accept': 'application/json',
                                          **({'Authorization': tok} if tok else {})})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read() or b'null')


def build_next(cur, prop):
    nxt = json.loads(json.dumps(cur))
    r10_ids = {x['stopId'] for x in cur['routeStops'] if x['routeId'] == '10'}
    tech = set(prop['tech'])
    order_t = {sid: i + 1 for i, sid in enumerate(prop['there_chain'])}
    order_b = {sid: i + 1 for i, sid in enumerate(prop['back_chain'])}
    rows = []
    for sid in sorted(r10_ids | tech):
        rows.append({'routeId': '10', 'stopId': sid, 'orderThere': order_t.get(sid, -1),
                     'orderBack': order_b.get(sid, -1), 'mapOnly': sid in tech})
    nxt['routeStops'] = [x for x in cur['routeStops'] if x['routeId'] != '10'] + rows
    for r in nxt['routes']:
        if r['id'] == '10':
            r.update(prop['route'])
            assert r.get('unreliable') is True, 'маршрут 10 має лишатися прихованим'
    return nxt


def strip(d, rid='10'):
    """Усе, крім рядків маршруту rid (для перевірки «нічого іншого не змінено»)."""
    return json.dumps({'stops': d['stops'], 'meta': d['meta'], 'trips': d['trips'], 'segments': d['segments'],
                       'routes': [r for r in d['routes'] if r['id'] != rid],
                       'routeStops': sorted([x for x in d['routeStops'] if x['routeId'] != rid],
                                            key=lambda x: (x['routeId'], x['stopId']))},
                      ensure_ascii=False, sort_keys=True)


def validate(dataset_file):
    js = ("const {validateTransportDataset}=require('./backend/dist/local-transport.js');"
          f"const d=require('./{dataset_file}');const r=validateTransportDataset(d);"
          "console.log(JSON.stringify(r.errors));process.exit(r.errors.length?1:0)")
    res = subprocess.run(['node', '-e', js], capture_output=True, text=True)
    return res.returncode == 0, res.stdout.strip() or res.stderr.strip()


def apply():
    prop = load(path('route10-proposal.json'))
    ts = datetime.datetime.now().strftime('%Y-%m-%dT%H%M%S')
    cur = http_json('GET', f'{API}/transport/dataset')
    backup = path(f'db-{ts}-before-route10.json')
    save(backup, cur, indent=None)
    print('бекап:', backup)
    nxt = build_next(cur, prop)
    nfile = path(f'db-{ts}-route10-next.json')
    save(nfile, nxt, indent=None)
    ok, msg = validate(nfile)
    print('валідатор:', 'OK' if ok else msg)
    if not ok:
        sys.exit(1)
    assert strip(cur) == strip(nxt), 'змінилось щось поза маршрутом 10'
    changed = [k for k in ('fromName', 'toName', 'scheme', 'note') if
               next(r for r in cur['routes'] if r['id'] == '10')[k] != next(r for r in nxt['routes'] if r['id'] == '10')[k]]
    print('змінено лише маршрут 10: routeStops', sum(1 for x in nxt['routeStops'] if x['routeId'] == '10'), 'рядків; поля', changed)
    tok = token()
    # мінімальне вікно гонки: перевіряємо, що база не змінилась після бекапу
    again = http_json('GET', f'{API}/transport/dataset')
    assert json.dumps(again, sort_keys=True) == json.dumps(cur, sort_keys=True), 'база змінилась після бекапу — зупинка'
    res = http_json('PUT', f'{API}/transport/dataset', nxt, tok)
    print('PUT:', res)
    after = http_json('GET', f'{API}/transport/dataset')
    save(path(f'db-{ts}-after-route10.json'), after, indent=None)
    assert strip(after) == strip(cur), 'після PUT змінилось щось поза маршрутом 10'
    got = sorted([x for x in after['routeStops'] if x['routeId'] == '10'], key=lambda x: x['stopId'])
    want = sorted([x for x in nxt['routeStops'] if x['routeId'] == '10'], key=lambda x: x['stopId'])
    assert got == want, 'routeStops маршруту 10 не збігаються з відправленими'
    print('перевірка після PUT: OK (інші маршрути, зупинки, рейси, сегменти — без змін)')


def segments():
    tok = token()
    before = http_json('GET', f'{API}/transport/dataset')
    res = http_json('POST', f'{API}/admin/transport/recalculate-segments', {'routeId': '10'}, tok)
    print('recalculate:', {k: res[k] for k in ('routes', 'segmentsWritten', 'segmentsKept', 'osrmRequested', 'osrmFailed')})
    after = http_json('GET', f'{API}/transport/dataset')
    other = lambda d: sorted([s for s in d['segments'] if s['routeId'] != '10'], key=lambda s: (s['routeId'], s['fromStopId'], s['toStopId']))
    assert other(before) == other(after), 'змінились сегменти інших маршрутів'
    b = dict(before); a = dict(after)
    b.pop('segments'); a.pop('segments')
    b['meta'] = {k: v for k, v in b['meta'].items() if k != 'defaultSec'}
    a['meta'] = {k: v for k, v in a['meta'].items() if k != 'defaultSec'}
    assert json.dumps(b, sort_keys=True) == json.dumps(a, sort_keys=True), 'змінилось щось, крім сегментів'
    ts = datetime.datetime.now().strftime('%Y-%m-%dT%H%M%S')
    save(path(f'db-{ts}-after-route10-segments.json'), after, indent=None)
    print('сегментів №10:', sum(1 for s in after['segments'] if s['routeId'] == '10'), '| інші маршрути без змін')


if __name__ == '__main__':
    {'--plan': plan, '--apply': apply, '--segments': segments}[sys.argv[1]]()
