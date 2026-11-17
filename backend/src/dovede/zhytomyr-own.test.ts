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

test('від автовокзалу до місця, що зветься як зупинка: дійти до зупинки, інтервал замість точного часу, чекати — пів інтервалу', () => {
  const r = ownZhytomyrRoute(q(), labels, data)!;
  assert.equal(r.source, 'own');
  // рейси на «Автовокзалі» о 09:10 і 09:30 → кожні 20 хв; чекати 10 хв, їхати 14 хв → 24 хв від 09:05
  assert.deepEqual(r.steps, [
    { kind: 'walk', minutes: 2, meters: 110 },
    { kind: 'transit', minutes: 14, mode: 'BUS', line: '58', headsign: 'Обласна лікарня', fromStop: 'Автовокзал', toStop: 'Обласна лікарня', stops: 2, headwayMin: 20 },
  ]);
  assert.equal(r.minutes, 24);
  // точного часу відправлення не називаємо: розклад сайту давній
  assert.ok(r.steps.every((s) => s.departs === undefined));
  assert.equal(r.fetchedAt, '2026-11-17T00:00:00.000Z');
  assert.deepEqual([r.fromLabel, r.toLabel], [labels.from, labels.to]);
});

test('інтервал — за сусідніми рейсами цієї пори; вихідний — свій розклад; у зворотний бік цим напрямком не їдемо', () => {
  // о 09:09 найближчий рейс 09:30: до нього 20 хв від попереднього, після — 100 хв → у середньому раз на годину
  assert.equal(ownZhytomyrRoute(q({ time: '09:09' }), labels, data)!.steps[1].headwayMin, 60);
  // субота: один рейс о 10:10 — інтервалу немає, чекаємо до нього (30 хв) + 14 хв у дорозі
  const sat = ownZhytomyrRoute(q({ date: '2026-11-21', time: '09:40' }), labels, data)!;
  assert.deepEqual([sat.steps[1].headwayMin, sat.minutes], [undefined, 44]);
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
  assert.deepEqual([r.steps[0].fromStop, r.steps[0].headwayMin, r.steps[0].minutes, r.minutes], ['Покровська', 20, 8, 18]);
});

test('дані сервера згенеровано зі знімка: закомічений модуль дорівнює генератору; рейсів «у депо» в ньому немає', () => {
  const root = path.resolve(__dirname, '../../../data/zhytomyr-transport');
  assert.equal(fs.readFileSync(path.join(__dirname, 'zhytomyr-own-data.ts'), 'utf8'), buildZhytomyrOwnData(root));
  assert.ok(ZT_OWN.dirs.length >= 30);
  assert.match(ZT_OWN.fetchedAt, /^\d{4}-\d{2}-\d{2}$/);
  for (const d of ZT_OWN.dirs) assert.ok(d.stops.every(([name]) => !/\s0\d$/.test(name)), `${d.no}: номер боку дороги в назві`);
});
