"""Спільні хелпери аудиту зупинок (лише stdlib). Запуск з кореня репозиторію."""
import json
import math
import os
import re
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

AUDIT = os.path.join('data', 'malyn-transport', 'audit-2026-10')
OSM = os.path.join(AUDIT, 'osm')
API = 'https://kyiv-malyn-booking-production.up.railway.app'
UA = 'kyiv-malyn-booking-audit/1.0 (+https://malin.kiev.ua)'
BBOX = '50.735,29.170,50.810,29.300'
OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]
# Маршрути файлу 2024 → наші id
FILE_ROUTE_TO_DB = {'6': '10', '10': '10-old'}
# OSM-релейшени міських маршрутів (ref → id), знайдені 2026-10-10
OSM_ROUTE_RELATIONS = {
    '1': 16654620, '3': 7285799, '5': 8443669, '7': 7510119,
    '8': 17747121, '9': 19065480, '10': 7458748, '12': 7423159,
}


def path(*parts):
    return os.path.join(AUDIT, *parts)


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def save(p, data, indent=1):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
        f.write('\n')


def norm(s):
    s = unicodedata.normalize('NFC', s or '').lower()
    for a, b in (('’', "'"), ('`', "'"), ('«', '"'), ('»', '"'), ('“', '"'), ('”', '"')):
        s = s.replace(a, b)
    return re.sub(r'\s+', ' ', s).strip()


# ---------- xlsx (stdlib) ----------
def read_xlsx_rows(xlsx_path):
    z = zipfile.ZipFile(xlsx_path)
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    tag_t = '{%s}t' % ns['m']
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        ss = [''.join(t.text or '' for t in si.iter(tag_t))
              for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns)]
    sh = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))

    def col(ref):
        n = 0
        for ch in re.match(r'([A-Z]+)', ref).group(1):
            n = n * 26 + ord(ch) - 64
        return n - 1

    rows = []
    for r in sh.find('m:sheetData', ns).findall('m:row', ns):
        vals = {}
        for c in r.findall('m:c', ns):
            v = c.find('m:v', ns)
            if v is None:
                isv = c.find('m:is', ns)
                val = ''.join(t.text or '' for t in isv.iter(tag_t)) if isv is not None else None
            else:
                val = ss[int(v.text)] if c.get('t') == 's' else v.text
            if isinstance(val, str):
                val = val.strip()
            if val not in (None, ''):
                vals[col(c.get('r'))] = val
        rows.append((int(r.get('r')), vals))
    return rows


# ---------- HTTP ----------
def http(url, data=None, headers=None, timeout=120):
    h = {'User-Agent': UA, 'Accept': 'application/json'}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def overpass(query, cache_file):
    if os.path.exists(cache_file):
        return load(cache_file)
    body = urllib.parse.urlencode({'data': query}).encode()
    last = None
    for attempt in range(6):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            raw = http(url, data=body, timeout=180)
            if raw[:1] == b'{':
                data = json.loads(raw)
                save(cache_file, data, indent=None)
                return data
            last = raw[:120]
        except Exception as e:  # noqa: BLE001 — мережа нестабільна, пробуємо ще
            last = e
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f'Overpass failed: {last}')


_last_nominatim = [0.0]


def nominatim(endpoint, params, cache_file):
    """endpoint: 'search' | 'reverse'. ≤1 запит/с, кеш у файлі."""
    if os.path.exists(cache_file):
        return load(cache_file)
    wait = 1.1 - (time.time() - _last_nominatim[0])
    if wait > 0:
        time.sleep(wait)
    q = dict(params)
    q.update({'format': 'jsonv2', 'addressdetails': '1', 'accept-language': 'uk'})
    url = f'https://nominatim.openstreetmap.org/{endpoint}?' + urllib.parse.urlencode(q)
    for attempt in range(4):
        try:
            data = json.loads(http(url, timeout=60))
            _last_nominatim[0] = time.time()
            save(cache_file, data)
            return data
        except Exception:  # noqa: BLE001
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f'Nominatim failed: {url}')


# ---------- геометрія ----------
LAT0, LON0 = 50.7700, 29.2400
R = 6371008.8


def xy(lat, lon):
    """Локальна проекція в метрах навколо Малина (достатньо для міста)."""
    return ((lon - LON0) * math.cos(math.radians(LAT0)) * R * math.pi / 180,
            (lat - LAT0) * R * math.pi / 180)


def dist_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def project(lat, lon, line):
    """Проекція точки на полілінію [(lat, lon), …].
    → (відстань м, позиція вздовж м, бік: +1 зліва / -1 справа від напрямку руху, індекс відрізка)"""
    px, py = xy(lat, lon)
    best = None
    along = 0.0
    for i in range(len(line) - 1):
        ax, ay = xy(*line[i])
        bx, by = xy(*line[i + 1])
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
        cx, cy = ax + t * dx, ay + t * dy
        d = math.hypot(px - cx, py - cy)
        cross = dx * (py - ay) - dy * (px - ax)
        cand = (d, along + t * math.sqrt(seg2), 1 if cross > 0 else -1, i)
        if best is None or d < best[0]:
            best = cand
        along += math.sqrt(seg2)
    return best


def gmaps(lat, lon):
    return f'https://maps.google.com/?q={lat:.6f},{lon:.6f}'
