"""Фаза 4.1 (крок 1): шлях маршруту №10 з OSM rel 7458748 → полілінія Вокзал → Поліклініка,
проекція зупинок (відстань до шляху, позиція вздовж, бік). Вихід: route10-projection.json."""
import glob
import os

from common import OSM, dist_m, load, path, project, save

REL = 7458748
THRESH = 45  # м — зупинка вважається на шляху


def stitch(rel, ways):
    """Відрізки шляху в порядку першої появи (у релейшені є дублікати — артефакт редагування OSM),
    кожен орієнтований так, щоб продовжувати попередній."""
    ids, seen = [], set()
    for m in rel['members']:
        if m['type'] == 'way' and m.get('role') in ('', 'forward', 'backward') and m['ref'] in ways and m['ref'] not in seen:
            ids.append(m['ref'])
            seen.add(m['ref'])
    geoms = [[(p['lat'], p['lon']) for p in ways[i]['geometry']] for i in ids]
    first, second = geoms[0], geoms[1]
    if min(dist_m(*first[0], *second[0]), dist_m(*first[0], *second[-1])) < min(dist_m(*first[-1], *second[0]), dist_m(*first[-1], *second[-1])):
        first = first[::-1]
    line = list(first)
    for i, g in zip(ids[1:], geoms[1:]):
        if dist_m(*line[-1], *g[-1]) < dist_m(*line[-1], *g[0]):
            g = g[::-1]
        gap = dist_m(*line[-1], *g[0])
        if gap > 30:
            print(f'   ⚠ розрив {gap:.0f} м перед way {i} ({ways[i]["tags"].get("name", "?")})')
        line += g[1:] if gap < 1 else g
    return line


def main():
    els = load(os.path.join(OSM, 'relations.json'))['elements']
    ways = {e['id']: e for e in els if e['type'] == 'way'}
    rel = next(e for e in els if e['type'] == 'relation' and e['id'] == REL)
    line = stitch(rel, ways)
    db = load(sorted(glob.glob(path('db-*-start.json')))[-1])
    st = {s['id']: s for s in db['stops']}
    # зорієнтувати: початок біля Вокзалу
    if dist_m(*line[0], st['st_0019']['lat'], st['st_0019']['lng']) > dist_m(*line[-1], st['st_0019']['lat'], st['st_0019']['lng']):
        line = line[::-1]
    total = sum(dist_m(*line[i], *line[i + 1]) for i in range(len(line) - 1))
    print(f'шлях: {len(line)} точок, {total / 1000:.2f} км; від Вокзалу ({dist_m(*line[0], st["st_0019"]["lat"], st["st_0019"]["lng"]):.0f} м) '
          f'до Поліклініки ({dist_m(*line[-1], st["st_0072"]["lat"], st["st_0072"]["lng"]):.0f} м)')
    review = {x['db_id']: x for x in load(path('stops-review.json'))['file_stops']}
    r10 = {x['stopId'] for x in db['routeStops'] if x['routeId'] == '10'}
    out = []
    for s in db['stops']:
        pos = (s['lat'], s['lng'])
        src = 'база'
        rv = review.get(s['id'])
        if rv and rv['coord_verdict'] == 'wrong' and rv['proposal']:
            pos = (rv['proposal']['lat'], rv['proposal']['lon'])
            src = 'пропозиція фази 2'
        d, along, side, _ = project(pos[0], pos[1], line)
        if s['id'] in r10 or d <= THRESH:
            out.append({'id': s['id'], 'name': s['name'], 'in_route10': s['id'] in r10, 'pos_source': src,
                        'lat': pos[0], 'lon': pos[1], 'dist': round(d), 'along': round(along),
                        'side_osm': 'праворуч' if side < 0 else 'ліворуч'})
    out.sort(key=lambda x: x['along'])
    save(path('route10-projection.json'), {'relation': REL, 'path': line, 'length_m': round(total), 'stops': out})
    for x in out:
        flag = '' if x['in_route10'] else '   (не в №10)'
        far = '  ПОЗА ШЛЯХОМ' if x['dist'] > THRESH else ''
        print(f"{x['along']:>5} м  {x['dist']:>4} м  {x['side_osm']:<8} {x['id']} {x['name']}{' ['+x['pos_source']+']' if x['pos_source']!='база' else ''}{far}{flag}")


if __name__ == '__main__':
    main()
