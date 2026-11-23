/**
 * «Доведе» · GTFS «Київпастрансу» (kyiv-kpt.ts): розбір CSV, напрямки з контрольними точками, відправлення за
 * типом дня, хвилини за годиною; згенерований файл даних дорівнює генератору з архіву в репозиторії.
 */
import fs from 'node:fs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildKptData, cleanStopName, gtfsMinutes, parseCsv, renderKptDataTs, renderKptReport } from './kyiv-kpt';
import { KYIV_KPT } from './kyiv-kpt-data';
import { KPT_DATA_TS, KPT_DIR, KPT_ZIP, readKptZip } from '../scripts/kyiv-kpt';

test('CSV: лапки, подвоєні лапки, BOM, \\r\\n', () => {
  const rows = parseCsv('﻿a,b,c\r\n1,"x, ""y""",z\r\n\r\n2,,"w"\n');
  assert.deepEqual(rows, [
    { a: '1', b: 'x, "y"', c: 'z' },
    { a: '2', b: '', c: 'w' },
  ]);
});

test('час GTFS і назви точок', () => {
  assert.equal(gtfsMinutes('05:48:00'), 348);
  assert.equal(gtfsMinutes('24:10:00'), 1450);
  assert.equal(gtfsMinutes('x'), null);
  assert.equal(cleanStopName('ст.м.  "Лісова" 1'), 'ст.м. "Лісова" 1');
  assert.equal(cleanStopName('ст.м. "Палац спорту "(55)'), 'ст.м. "Палац спорту"(55)');
});

const FILES = {
  'feed_info.txt': 'feed_publisher_name,feed_version,feed_start_date,feed_end_date\nКПТ,20261123,20261123,20271123\n',
  'routes.txt': 'route_id,route_short_name,route_long_name,route_type\n1_1,1,Борщагівка - Вокзал,0\n2_1,1,Тролейбус один,11\n3_9,9,Без рейсів,3\n',
  'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday\nW,1,1,1,1,1,0,0\nE,0,0,0,0,0,1,1\n',
  'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Мих Борщагівка,50.40,30.40\nB,Індустріальна,50.42,30.45\nC,ст. Старовокзальна,50.44,30.49\nD,Депо,50.41,30.42\nT1,Тролейбусна,50.45,30.50\nT2,Кінець,50.46,30.51\n',
  'trips.txt': 'route_id,service_id,trip_id,direction_id,shape_id\n1_1,W,t1,0,s1\n1_1,W,t2,0,s1\n1_1,E,t3,0,s1\n1_1,W,t4,0,s1\n1_1,W,short,0,s1\n1_1,W,bad,0,s1\n2_1,W,tr1,1,\n',
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    't1,07:00:00,07:00:00,A,1', 't1,07:10:00,07:10:00,B,2', 't1,07:25:00,07:25:00,C,3',
    't2,07:30:00,07:30:00,A,1', 't2,07:42:00,07:42:00,B,2', 't2,07:59:00,07:59:00,C,3',
    't3,07:15:00,07:15:00,A,1', 't3,07:23:00,07:23:00,B,2', 't3,07:35:00,07:35:00,C,3',
    't4,23:50:00,23:50:00,A,1', 't4,23:58:00,23:58:00,B,2', 't4,24:08:00,24:08:00,C,3',
    'short,08:00:00,08:00:00,A,1', 'short,08:05:00,08:05:00,D,2',
    'bad,09:00:00,09:00:00,A,1', 'bad,08:50:00,08:50:00,B,2', 'bad,09:10:00,09:10:00,C,3',
    'tr1,06:00:00,06:00:00,T1,1', 'tr1,06:09:00,06:09:00,T2,2',
  ].join('\n'),
  'shapes.txt': 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\ns1,50.40,30.40,1\ns1,50.42,30.45,2\ns1,50.44,30.49,3\n',
};

test('напрямки: найчастіший набір точок першим, короткі рейси окремо, відправлення за типом дня, хвилини за годиною', () => {
  const { data, report } = buildKptData(FILES);
  assert.deepEqual([data.version, data.validFrom, data.validTo], ['20261123', '20261123', '20271123']);
  const main = data.dirs.find((d) => d.id === '1_1/0/0')!;
  assert.deepEqual(main.points.map((p) => p[0]), ['Мих Борщагівка', 'Індустріальна', 'ст. Старовокзальна']);
  assert.equal(main.mode, 'TRAM');
  assert.deepEqual(main.wd, [420, 450, 1430]);
  assert.deepEqual(main.we, [435]);
  // о 7-й три рейси (будні й вихідні разом): медіана хвилин до кожної точки; рейс через північ — у годину відправлення
  assert.deepEqual(main.run['7'], [0, 10, 25]);
  assert.deepEqual(main.run['23'], [0, 8, 18]);
  const short = data.dirs.find((d) => d.id === '1_1/0/1')!;
  assert.deepEqual([short.points.map((p) => p[0]), short.wd], [['Мих Борщагівка', 'Депо'], [480]]);
  // той самий номер іншим видом транспорту — окремий маршрут
  assert.deepEqual(data.dirs.find((d) => d.id === '2_1/1/0')?.mode, 'TROLLEYBUS');
  assert.equal(report.badTrips, 1);
  assert.deepEqual(report.routesWithoutTrips, ['автобус 9']);
  assert.deepEqual(report.sharedNumbers, ['1']);
  // точка «Депо» короткого рейсу не лежить на лінії s1
  assert.deepEqual(report.shapes, { total: 1, coarse: 1, pointsFar: 1, pointsChecked: 5 });
  assert.match(renderKptReport(data, report), /Маршрути без жодного рейсу \(у дані не ввійшли\): автобус 9/);
});

test('дані з архіву в репозиторії: згенерований файл і звіт дорівнюють генератору', () => {
  const { data, report } = buildKptData(readKptZip(KPT_ZIP));
  assert.equal(fs.readFileSync(KPT_DATA_TS, 'utf8'), renderKptDataTs(data));
  assert.equal(fs.readFileSync(`${KPT_DIR}/REPORT.md`, 'utf8'), renderKptReport(data, report));
  assert.ok(KYIV_KPT.dirs.length > 500);
  assert.deepEqual(new Set(KYIV_KPT.dirs.map((d) => d.mode)), new Set(['TRAM', 'TROLLEYBUS', 'BUS']));
  for (const d of KYIV_KPT.dirs) {
    assert.ok(d.points.length >= 2, d.id);
    assert.ok(d.wd.length + d.we.length > 0, d.id);
    for (const [, lat, lng] of d.points) assert.ok(lat > 50.2 && lat < 50.7 && lng > 30.2 && lng < 30.9, `${d.id}: точка поза Києвом`);
  }
});
