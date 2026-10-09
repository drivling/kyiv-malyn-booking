"""Фаза 0: розпарсити xlsx data.gov.ua, зняти знімок бази, закешувати OSM (Overpass).
Запуск: python3 data/malyn-transport/audit-2026-10/scripts/fetch_inputs.py [--db-tag start]"""
import datetime
import re
import sys

from common import (API, BBOX, OSM, OSM_ROUTE_RELATIONS, http, load, overpass, path, read_xlsx_rows,
                    save)
import json
import os

ZCOLS = ['stop_id', 'stop_code', 'stop_name', 'stop_desc', 'stop_lat', 'stop_lon', 'post_code',
         'country', 'region', 'district', 'locality', 'street', 'house', 'route_note', 'zone_id',
         'stop_url', 'location_type', 'parent_station', 'timezone', 'wheelchair']


def parse_zupinki():
    out = []
    for rn, v in read_xlsx_rows(path('zupinki-24.xlsx')):
        if not str(v.get(0, '')).startswith('z-'):
            continue
        rec = {k: v.get(i) for i, k in enumerate(ZCOLS)}
        rec['row'] = rn
        desc = rec['stop_desc'] or ''
        rec['routes'] = sorted(set(re.findall(r'\d+', rec['route_note'] or '')), key=int)
        rec['terminus'] = 'кінцева' in desc.lower()
        rec['on_request'] = 'на вимогу' in desc.lower()
        rec['shelter'] = 'криті' in desc.lower()
        rec['has_coords'] = bool(rec['stop_lat'] and rec['stop_lon'])
        out.append(rec)
    save(path('zupinki-24.json'), out)
    print('zupinki-24.json:', len(out), 'stops; with coords:', sum(r['has_coords'] for r in out))


def parse_simple(xlsx, out_name):
    rows = read_xlsx_rows(xlsx)
    keys = rows[0][1]
    recs = []
    for rn, v in rows[2:]:
        if not v:
            continue
        recs.append({keys.get(i, f'c{i}'): val for i, val in v.items()})
    save(path(out_name), recs)
    print(out_name + ':', len(recs), 'rows')


def fetch_marshruty():
    x = path('perelik-marshrutiv-24.xlsx')
    if not os.path.exists(x):
        url = ('https://data.gov.ua/dataset/f61d2487-11eb-43bf-8f81-43db0130d657/resource/'
               '5dc4e6d8-896a-41f8-8cf1-1e000780dced/download/perelik-marshrutiv-24.xlsx')
        with open(x, 'wb') as f:
            f.write(http(url, headers={'Accept': '*/*'}))
    parse_simple(x, 'marshruty-24.json')
    parse_simple(os.path.join('data', 'malyn-transport', 'perelik-reisiv-24.xlsx'), 'reisy-24.json')


def snapshot_db(tag):
    ts = datetime.datetime.now().strftime('%Y-%m-%dT%H%M%S')
    raw = http(f'{API}/transport/dataset')
    data = json.loads(raw)
    p = path(f'db-{ts}-{tag}.json')
    save(p, data, indent=None)
    print('DB snapshot:', p, '| stops', len(data['stops']), 'routes', len(data['routes']),
          'routeStops', len(data['routeStops']), 'trips', len(data['trips']), 'segments', len(data['segments']))


def fetch_osm():
    ids = ','.join(str(i) for i in OSM_ROUTE_RELATIONS.values())
    q = (f'[out:json][timeout:180];rel(id:{ids})->.r;.r out body;'
         'way(r.r)->.w;.w out body geom;node(r.r)->.n;.n out body;')
    d = overpass(q, os.path.join(OSM, 'relations.json'))
    print('osm/relations.json:', len(d['elements']), 'elements')
    q = f'[out:json][timeout:180];way["highway"]["name"]({BBOX});out tags geom;'
    d = overpass(q, os.path.join(OSM, 'streets.json'))
    print('osm/streets.json:', len(d['elements']), 'named ways')
    q = f'[out:json][timeout:180];nwr["addr:housenumber"]({BBOX});out tags center;'
    d = overpass(q, os.path.join(OSM, 'addresses.json'))
    print('osm/addresses.json:', len(d['elements']), 'addressed objects')
    q = (f'[out:json][timeout:180];(node["highway"="bus_stop"]({BBOX});'
         f'node["public_transport"~"platform|stop_position"]({BBOX}););out body;')
    d = overpass(q, os.path.join(OSM, 'stops.json'))
    print('osm/stops.json:', len(d['elements']), 'stop nodes')


if __name__ == '__main__':
    tag = sys.argv[sys.argv.index('--db-tag') + 1] if '--db-tag' in sys.argv else None
    parse_zupinki()
    fetch_marshruty()
    if tag:
        snapshot_db(tag)
    fetch_osm()
