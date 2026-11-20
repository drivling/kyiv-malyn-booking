"""Коростень · лінії дорогами: записати новий датасет у базу (PUT ?city=Korosten з baseRevision).

    ADMIN_TOKEN=… python3 scripts/apply.py <next.json> [--apply]

Без --apply лише показує, що буде записано. З --apply: читає базу, перевіряє, що її ревізія та сама, з якої будували
(поле baseRevision у next.json), зберігає знімок «до» поруч (db-<час>-before.json), пише, читає знову й порівнює
записане з тим, що збирались записати (знімок «після» — db-<час>-after.json). Токен — ADMIN_TOKEN або
VIBER_ADMIN_TOKEN (те саме значення); у файли й на екран не потрапляє."""
import json
import os
import subprocess
import sys
import time

from geo import ROOT, load

API = os.environ.get('TRANSPORT_API', 'https://kyiv-malyn-booking-production.up.railway.app')
CITY = 'Korosten'
TOKEN = os.environ.get('ADMIN_TOKEN') or os.environ.get('VIBER_ADMIN_TOKEN') or ''


def curl(args):
    r = subprocess.run(['curl', '-sS', '-m', '120', *args], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f'curl: {r.stderr.strip()}')
    return r.stdout


def get():
    return json.loads(curl(['-H', f'Authorization: {TOKEN}', f'{API}/transport/dataset?city={CITY}&t={int(time.time())}']))


def canon(ds):
    key = lambda rows, f: sorted(rows, key=f)
    return {
        'stops': key([{k: s[k] for k in ('id', 'name', 'lat', 'lng')} for s in ds['stops']], lambda s: s['id']),
        'routeStops': key([{**x, 'mapOnly': bool(x.get('mapOnly'))} for x in ds['routeStops']], lambda x: (x['routeId'], x['stopId'])),
        'segments': key(ds['segments'], lambda s: (s['routeId'], s['fromStopId'], s['toStopId'])),
        'variants': {r['id']: r.get('variants') or [] for r in ds['routes']},
        'trips': key(ds['trips'], lambda t: t['id']),
    }


nxt = load(sys.argv[1])
base = nxt.pop('baseRevision')
print(f"записати: зупинок {len(nxt['stops'])}, рядків ланцюжків {len(nxt['routeStops'])}, сегментів {len(nxt['segments'])}, рейсів {len(nxt['trips'])}; база {base}")
if '--apply' not in sys.argv:
    print('без --apply нічого не записано')
    sys.exit(0)
if not TOKEN:
    raise SystemExit('немає ADMIN_TOKEN / VIBER_ADMIN_TOKEN')
before = get()
if before.get('revision') != base:
    raise SystemExit(f"база змінилась: {before.get('revision')} замість {base} — зібрати заново")
stamp = time.strftime('%Y-%m-%dT%H%M%S', time.gmtime())
json.dump(before, open(os.path.join(ROOT, f'db-{stamp}-before.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
body = os.path.join(ROOT, '.put-body.json')
json.dump({**nxt, 'baseRevision': base}, open(body, 'w', encoding='utf8'), ensure_ascii=False)
out = curl(['-X', 'PUT', '-H', f'Authorization: {TOKEN}', '-H', 'Content-Type: application/json', '--data-binary', f'@{body}', '-w', '\n%{http_code}', f'{API}/transport/dataset?city={CITY}'])
os.remove(body)
text, code = out.rsplit('\n', 1)
print('PUT', code, text[:300])
if code != '200':
    sys.exit(1)
after = get()
json.dump(after, open(os.path.join(ROOT, f'db-{stamp}-after.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
a, b = canon(after), canon(nxt)
bad = [k for k in a if json.dumps(a[k], sort_keys=True, ensure_ascii=False) != json.dumps(b[k], sort_keys=True, ensure_ascii=False)]
print('нова ревізія', after.get('revision'), '— записане збігається' if not bad else f'— РІЗНИЦЯ в {bad}')
sys.exit(1 if bad else 0)
