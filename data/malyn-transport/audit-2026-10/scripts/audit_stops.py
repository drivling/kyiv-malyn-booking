"""Фази 1–2: перелік і координати кожної зупинки → stops-audit.json + таблиця для розбору.
Працює з кешу; Nominatim викликається лише як запасний варіант (кешується в osm/nominatim/)."""
import glob
import os
import re

from common import (FILE_ROUTE_TO_DB, OSM, dist_m, load, nominatim, norm, path, project, save)

STREET_MAP = {
    'вул. Барміна': ['вулиця Іллі Барміна'],
    'вул. Чорновола': ['вулиця Вʼячеслава Чорновола'],
    'вул. Приходька': ['вулиця Юрія Приходька'],
    'вул. Івана Мазепи': ['вулиця Івана Мазепи'], 'вул. Івана мазепи': ['вулиця Івана Мазепи'],
    'вул. Грушевського': ['вулиця Михайла Грушевського', 'вулиця Михайла Грушевськогоі'],
    'вул.Грушевського': ['вулиця Михайла Грушевського', 'вулиця Михайла Грушевськогоі'],
    'вул. Перемоги': ['вулиця Перемоги'],
    'вул. Володимирська': ['Володимирська вулиця'], 'вул  Володимирська': ['Володимирська вулиця'],
    'вул. Огієнка': ['вулиця Івана Огієнка'],
    'вул. Заводська': ['Заводська вулиця'],
    'вул. М.Вербицького': ['вулиця Михайла Вербицького'],
    'вул. Покровська': ['Покровська вулиця'],
    'вул. Миру': ['вулиця Миру'],
    'вул. Героїв Малинського підпілля': ['вулиця Героїв Малинського Підпілля'],
    'вул. 14 ОМБ': ['провулок 14-ї ОМБ Князя Романа Великого'],
    'вул. Городищанська': ['Городищанська вулиця'],
    'вул. Степана Бандери': ['вулиця Степана Бандери'],
    'пл. Соборна': ['Соборна площа'],
    'вул. Шевченка': ['вулиця Шевченка'],
    'вул. 10 ОГШБ': ['вулиця 10-ї Окремої Гірсько-Штурмової Бригади'],
    'вул. Бондарик': ['вулиця Галини Бондарик'],
    'вул. Винниченка': ['вулиця Володимира Винниченка'],
    'вул.Укр.Повстанців': ['вулиця Українських Повстанців'],
    'с. Гамарня': [],
}
# Перейменовані в базі (редактор карти), а у файлі — стара назва
RENAMED = {norm('ЗОШ " 3'): 'st_0020', norm('ЗОШ № 3 (навпроти)'): 'st_0023'}


def hn_norm(h):
    h = (h or '').lower().replace(' ', '')
    return h.translate(str.maketrans('abvgde', 'абвгде'))


def hn_num(h):
    m = re.match(r'(\d+)', h or '')
    return int(m.group(1)) if m else None


def latest_db():
    files = sorted(glob.glob(path('db-*-start.json')))
    return load(files[-1]), os.path.basename(files[-1])


def main():
    Z = load(path('zupinki-24.json'))
    db, db_name = latest_db()
    streets = load(os.path.join(OSM, 'streets.json'))['elements']
    addrs = load(os.path.join(OSM, 'addresses.json'))['elements']
    osm_stops = [e for e in load(os.path.join(OSM, 'stops.json'))['elements'] if e['type'] == 'node']

    lines_by_name = {}
    for w in streets:
        g = [(p['lat'], p['lon']) for p in (w.get('geometry') or [])]
        if len(g) >= 2:
            lines_by_name.setdefault(w['tags']['name'], []).append(g)
    addr_by_street = {}
    for e in addrs:
        t = e['tags']
        c = e.get('center') or ({'lat': e['lat'], 'lon': e['lon']} if 'lat' in e else None)
        if c and t.get('addr:street'):
            addr_by_street.setdefault(t['addr:street'], []).append((hn_norm(t['addr:housenumber']), c['lat'], c['lon']))

    stops = {s['id']: s for s in db['stops']}
    by_name = {norm(s['name']): s['id'] for s in db['stops']}
    active, disabled, maponly = {}, {}, {}
    for rs in db['routeStops']:
        on = (rs.get('orderThere') or -1) > 0 or (rs.get('orderBack') or -1) > 0
        bucket = maponly if rs.get('mapOnly') else (active if on else disabled)
        bucket.setdefault(rs['stopId'], set()).add(rs['routeId'])

    def nearest_streets(lat, lon, k=2):
        best = {}
        for name, lines in lines_by_name.items():
            d = min(project(lat, lon, g)[0] for g in lines)
            if name not in best or d < best[name]:
                best[name] = d
        return sorted(((round(d), n) for n, d in best.items()))[:k]

    def dist_to_street(lat, lon, names):
        ds = [project(lat, lon, g)[0] for n in names for g in lines_by_name.get(n, [])]
        return round(min(ds)) if ds else None

    def nearest_osm_stops(lat, lon, k=2):
        c = sorted((dist_m(lat, lon, e['lat'], e['lon']), e.get('tags', {}).get('name') or '(без назви)', e['id'])
                   for e in osm_stops)
        return [(round(d), n, i) for d, n, i in c[:k]]

    def address_point(f, names):
        house = hn_norm(f['house'])
        if not names or not house or house in ('00', '0'):
            return None
        cands = [a for n in names for a in addr_by_street.get(n, [])]
        variants = [house] + (house.split('-') if '-' in house else [])
        for v in variants:
            hit = [a for a in cands if a[0] == v]
            if hit:
                return {'method': 'osm-exact', 'house': hit[0][0], 'lat': hit[0][1], 'lon': hit[0][2]}
        n = hn_num(house)
        if n is not None:
            num = [(abs(hn_num(a[0]) - n), (hn_num(a[0]) - n) % 2, a) for a in cands if hn_num(a[0]) is not None]
            same = sorted(x for x in num if x[1] == 0)
            if same and same[0][0] <= 6:
                a = same[0][2]
                return {'method': 'osm-near-number', 'house': a[0], 'lat': a[1], 'lon': a[2]}
        # запасний варіант — Nominatim (структурований запит)
        key = re.sub(r'[^\w]+', '_', f"{names[0]}_{house}")
        res = nominatim('search', {'street': f"{f['house']} {names[0]}", 'city': 'Малин', 'country': 'Україна',
                                   'limit': 1}, os.path.join(OSM, 'nominatim', key + '.json'))
        if res:
            r = res[0]
            hn = (r.get('address') or {}).get('house_number')
            if hn:
                return {'method': 'nominatim', 'house': hn, 'lat': float(r['lat']), 'lon': float(r['lon'])}
        return None

    out_file, seen = [], {}
    for f in Z:
        sid = by_name.get(norm(f['stop_name'])) or RENAMED.get(norm(f['stop_name']))
        seen.setdefault(sid, []).append(f['stop_id'])
        names = STREET_MAP.get(f['street'], [])
        froutes = {FILE_ROUTE_TO_DB.get(r, r) for r in f['routes']}
        s = stops.get(sid)
        rec = {
            'file_id': f['stop_id'], 'file_name': f['stop_name'], 'file_street': f['street'], 'file_house': f['house'],
            'osm_street': names[0] if names else None, 'terminus': f['terminus'],
            'db_id': sid, 'db_name': s['name'] if s else None,
            'renamed': bool(s and norm(s['name']) != norm(f['stop_name'])),
            'routes_file': sorted(froutes, key=lambda x: (len(x), x)),
            'routes_db_active': sorted(active.get(sid, set()), key=lambda x: (len(x), x)),
            'routes_db_disabled': sorted(disabled.get(sid, set()), key=lambda x: (len(x), x)),
        }
        rec['only_file_disabled'] = sorted(froutes & disabled.get(sid, set()) - active.get(sid, set()))
        rec['only_file_absent'] = sorted(froutes - active.get(sid, set()) - disabled.get(sid, set()))
        rec['only_db'] = sorted(active.get(sid, set()) - froutes)
        if s:
            lat, lon = s['lat'], s['lng']
            rec.update({'lat': lat, 'lon': lon,
                        'd_file_street': dist_to_street(lat, lon, names) if names else None,
                        'nearest_streets': nearest_streets(lat, lon),
                        'nearest_osm_stops': nearest_osm_stops(lat, lon)})
            ap = address_point(f, names)
            rec['addr'] = ap
            rec['d_addr'] = round(dist_m(lat, lon, ap['lat'], ap['lon'])) if ap else None
        out_file.append(rec)
    for rec in out_file:
        rec['merged_with'] = [x for x in seen.get(rec['db_id'], []) if x != rec['file_id']]

    file_ids = {r['db_id'] for r in out_file}
    out_db_only = []
    for s in db['stops']:
        if s['id'] in file_ids:
            continue
        out_db_only.append({
            'db_id': s['id'], 'db_name': s['name'], 'lat': s['lat'], 'lon': s['lng'],
            'routes_db_active': sorted(active.get(s['id'], set())), 'routes_db_disabled': sorted(disabled.get(s['id'], set())),
            'routes_map_only': sorted(maponly.get(s['id'], set())),
            'nearest_streets': nearest_streets(s['lat'], s['lng']),
            'nearest_osm_stops': nearest_osm_stops(s['lat'], s['lng']),
        })
    save(path('stops-audit.json'), {'db_snapshot': db_name, 'file_stops': out_file, 'db_only_stops': out_db_only})
    print('stops-audit.json: file', len(out_file), '| db-only', len(out_db_only))


if __name__ == '__main__':
    main()
