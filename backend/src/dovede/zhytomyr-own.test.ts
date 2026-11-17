/**
 * «Доведе» · пряма поїздка Житомиром за власним розкладом (zt.rozklad.in.ua), без Google.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { buildZhytomyrOwnData } from '../zhytomyr-routes';
import { ownZhytomyrRoute } from './zhytomyr-own';
import { ZT_OWN, type ZtOwnData } from './zhytomyr-own-data';

const data: ZtOwnData = {
  fetchedAt: '2026-11-17',
  validFrom: '2026-11-09',
  dirs: [
    {
      id: 1,
      no: '58',
      name: 'Мальованка - Обласна лікарня',
      checked: true,
      // автовокзал Житомир-1 — 50.2679, 28.6919; «Автовокзал» за ~110 м від нього
      stops: [
        ['Мальованка', 0, 50.25, 28.62],
        ['Автовокзал', 10, 50.2689, 28.6919],
        ['Покровська', 16, 50.262, 28.68],
        ['Обласна лікарня', 24, 50.255, 28.67],
      ],
      wd: ['09:00', '09:20', '11:00'],
      we: ['10:00'],
    },
    {
      id: 2,
      no: '7',
      name: 'Неперевірений',
      checked: false,
      stops: [
        ['Автовокзал', 0, 50.2689, 28.6919],
        ['Обласна лікарня', 5, 50.255, 28.67],
      ],
      wd: ['09:01'],
      we: ['09:01'],
    },
  ],
};
const labels = { from: 'автовокзал Житомир-1', to: 'обласна лікарня' };
const q = (over: Partial<Parameters<typeof ownZhytomyrRoute>[0]> = {}) => ({ from: 'zhytomyr.avtovokzal', to: 'обласна лікарня', date: '2026-11-18', time: '09:05', ...over });

test('від автовокзалу до місця, що зветься як зупинка: дійти до зупинки, найближчий рейс, хвилини разом із очікуванням', () => {
  const r = ownZhytomyrRoute(q(), labels, data)!;
  assert.equal(r.source, 'own');
  // 09:00 + 10 хв = 09:10 на «Автовокзалі»; дійти 110 м — 2 хв; їхати 14 хв → 09:24, тобто 19 хв від 09:05
  assert.deepEqual(r.steps, [
    { kind: 'walk', minutes: 2, meters: 110 },
    { kind: 'transit', minutes: 14, mode: 'BUS', line: '58', headsign: 'Обласна лікарня', fromStop: 'Автовокзал', toStop: 'Обласна лікарня', stops: 2, departs: '09:10' },
  ]);
  assert.equal(r.minutes, 19);
  assert.equal(r.fetchedAt, '2026-11-17T00:00:00.000Z');
  assert.deepEqual([r.fromLabel, r.toLabel], [labels.from, labels.to]);
});

test('рейс, на який не встигнути дійти, пропускаємо; вихідний — свій розклад; у зворотний бік цим напрямком не їдемо', () => {
  // о 09:09 до зупинки 2 хв пішки — на 09:10 не встигнути, наступний 09:30
  assert.equal(ownZhytomyrRoute(q({ time: '09:09' }), labels, data)!.steps[1].departs, '09:30');
  // субота: 10:00 + 10 = 10:10
  assert.equal(ownZhytomyrRoute(q({ date: '2026-11-21', time: '09:40' }), labels, data)!.steps[1].departs, '10:10');
  assert.equal(ownZhytomyrRoute(q({ from: 'обласна лікарня', to: 'zhytomyr.avtovokzal' }), labels, data), null);
});

test('немає відповіді: довго чекати, після останнього рейсу, місце не зветься як зупинка, напрямок не звірено', () => {
  assert.equal(ownZhytomyrRoute(q({ time: '09:40' }), labels, data), null); // до 11:10 — понад 45 хв
  assert.equal(ownZhytomyrRoute(q({ time: '12:00' }), labels, data), null);
  assert.equal(ownZhytomyrRoute(q({ to: 'Польова 12' }), labels, data), null);
  // неперевірений №7 їде о 09:06 і швидше, але в відповідь не потрапляє
  assert.equal(ownZhytomyrRoute(q(), labels, data)!.steps[1].line, '58');
  assert.equal(ownZhytomyrRoute(q(), labels, { ...data, dirs: [data.dirs[1]] }), null);
});

test('між двома місцями з назвами зупинок — без пішої частини; назва у відмінку «вулиця …» теж годиться', () => {
  const r = ownZhytomyrRoute(q({ from: 'вулиця Покровська', time: '09:10' }), labels, data)!;
  assert.deepEqual(r.steps.map((s) => s.kind), ['transit']);
  assert.deepEqual([r.steps[0].fromStop, r.steps[0].departs, r.steps[0].minutes, r.minutes], ['Покровська', '09:16', 8, 14]);
});

test('дані сервера згенеровано зі знімка: закомічений модуль дорівнює генератору; рейсів «у депо» в ньому немає', () => {
  const root = path.resolve(__dirname, '../../../data/zhytomyr-transport');
  assert.equal(fs.readFileSync(path.join(__dirname, 'zhytomyr-own-data.ts'), 'utf8'), buildZhytomyrOwnData(root));
  assert.ok(ZT_OWN.dirs.length >= 30);
  assert.match(ZT_OWN.fetchedAt, /^\d{4}-\d{2}-\d{2}$/);
  for (const d of ZT_OWN.dirs) assert.ok(d.stops.every(([name]) => !/\s0\d$/.test(name)), `${d.no}: номер боку дороги в назві`);
});
