#!/usr/bin/env python3
"""Свіжий знімок названих місць Малина з OpenStreetMap для орієнтирів «Доведе».

  python3 data/malyn-transport/dovede-landmarks/fetch_osm.py   # пише osm/places.json поруч

Один запит до Overpass (кілька дзеркал, перше, що відповіло): усі обʼєкти з назвою і тегом, що описує заклад, у рамці міста.
Після цього — `build.py`. Дані © учасники OpenStreetMap, ODbL.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'osm', 'places.json')
# дзеркала Overpass: беремо перше, що відповіло
ENDPOINTS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter']
# південь, захід, північ, схід — Малин з околицями (як у жовтневому аудиті)
BBOX = '50.735,29.170,50.810,29.300'
KEYS = ('amenity', 'shop', 'office', 'tourism', 'leisure', 'historic', 'healthcare', 'landuse', 'building')

QUERY = '[out:json][timeout:120];(' + ''.join(f'nwr["name"]["{k}"]({BBOX});' for k in KEYS) + ');out center tags;'


def main():
    doc = None
    used = None
    for endpoint in ENDPOINTS:
        req = urllib.request.Request(endpoint, data=urllib.parse.urlencode({'data': QUERY}).encode(), headers={'User-Agent': 'dovede-landmarks/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                doc = json.load(r)
            used = endpoint
            break
        except Exception as e:  # noqa: BLE001 — наступне дзеркало
            print(endpoint, '—', e, file=sys.stderr)
    if doc is None:
        sys.exit('Жодне дзеркало Overpass не відповіло — знімок не оновлено')
    els = sorted(doc.get('elements', []), key=lambda e: (e['type'], e['id']))
    if len(els) < 200:
        sys.exit(f'Overpass повернув лише {len(els)} обʼєктів — схоже на збій, знімок не оновлено')
    out = {'source': used, 'bbox': BBOX, 'osm_base': doc.get('osm3s', {}).get('timestamp_osm_base'), 'elements': els}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=0, sort_keys=True)
        f.write('\n')
    print(len(els), 'обʼєктів; база OSM від', out['osm_base'])


if __name__ == '__main__':
    main()
