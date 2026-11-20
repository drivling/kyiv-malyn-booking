/**
 * Стеження за джерелами розкладу: відбиток вмісту (таблиці сторінки ради, файли набору data.gov.ua),
 * базовий стан без сповіщення, одне сповіщення на зміну, збої, «Переглянуто», адмін-ендпоінти.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { listenLocal } from './http-test-server';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { adminAuthToken } from './middleware/require-admin';
import {
  SOURCE_FAIL_ALERT_AFTER,
  acknowledgeWatchedSource,
  changedParts,
  describeChanges,
  listWatchedSources,
  normalizeHtmlText,
  runSourceWatch,
  snapshotCkanPackage,
  snapshotHtmlTables,
  type SourceWatchDeps,
  type WatchedSourceDef,
} from './transport-source-watch';

type Row = {
  key: string;
  fingerprint: string | null;
  details: unknown;
  lastCheckedAt: Date | null;
  lastChangedAt: Date | null;
  acknowledgedAt: Date | null;
  failCount: number;
  lastError: string | null;
};

/** Мінімальний WatchedSource у пам'яті: findUnique / findMany / upsert / update / updateMany (рівність полів у where) */
function stubPrisma(rows = new Map<string, Row>()): { prisma: PrismaClient; rows: Map<string, Row> } {
  const blank = (key: string): Row => ({
    key,
    fingerprint: null,
    details: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    acknowledgedAt: null,
    failCount: 0,
    lastError: null,
  });
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v);
  const watchedSource = {
    findUnique: async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null,
    findMany: async ({ where }: { where: { key: { in: string[] } } }) => [...rows.values()].filter((r) => where.key.in.includes(r.key)),
    upsert: async ({ where, create, update }: { where: { key: string }; create: Partial<Row>; update: Partial<Row> }) => {
      const row = rows.get(where.key);
      const next = row ? { ...row, ...update } : { ...blank(where.key), ...create };
      rows.set(where.key, next);
      return next;
    },
    update: async ({ where, data }: { where: { key: string }; data: Partial<Row> }) => {
      const next = { ...(rows.get(where.key) as Row), ...data };
      rows.set(where.key, next);
      return next;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      let count = 0;
      for (const row of rows.values()) {
        if (!matches(row, where)) continue;
        rows.set(row.key, { ...row, ...data });
        count += 1;
      }
      return { count };
    },
  };
  return { prisma: { watchedSource } as unknown as PrismaClient, rows };
}

const table = (rows: string) => `<table><tr><td>Назва кінцевих зупинок маршруту</td><td>Відправ- лення</td></tr>${rows}</table>`;
const page = (r1: string, r6: string, note = '* Рейси не виконуються в суботу та неділю') => `
<html><head><meta property="article:modified_time" content="2026-07-13T10:44:39+00:00" /></head><body>
<p>Маршрут № 1 «Залізничний вокзал – Поліське водосховище» (на період дії воєнного стану)</p>
${table(r1)}
<p>${note}</p>
<h3>Маршрут № 2-Б «Пашини - Залізничний вокзал»</h3>
${table('<tr><td>Пашини &#8211; Романа Шухевича</td><td>6-55</td></tr>')}
<p>Маршрут № 6 «Цегельний завод – ст. Житомирська»</p>
${table(r6)}
<footer>© Коростенська міська рада</footer></body></html>`;
const R1 = '<tr><td>Залізничний вокзал&nbsp;– Поліське водосховище</td><td>6-20</td></tr>';
const R6 = '<tr><td>Цегельний завод – ст. Житомирська</td><td>7-10</td></tr>';

const ckan = (lastModified: string, metadataModified = '2026-08-04T12:26:19') =>
  JSON.stringify({
    success: true,
    result: {
      metadata_modified: metadataModified,
      resources: [
        { id: 'a', name: 'agency', url: 'https://data.gov.ua/a.csv', last_modified: '2026-07-17T10:53:39' },
        { id: 'r', name: 'routes', url: 'https://data.gov.ua/r.csv', last_modified: lastModified },
      ],
    },
  });

const HTML_SOURCE: WatchedSourceDef = { key: 'page', kind: 'html-tables', cityCode: 'Korosten', label: 'Розклад <ради>', url: 'https://example.org/p', fetchUrl: 'https://example.org/p' };
const CKAN_SOURCE: WatchedSourceDef = { key: 'set', kind: 'ckan', cityCode: 'Korosten', label: 'Маршрути', url: 'https://example.org/d', fetchUrl: 'https://example.org/api' };

function harness(bodies: Record<string, string | Error>, sources = [HTML_SOURCE, CKAN_SOURCE]) {
  const sent: string[] = [];
  let clock = Date.parse('2026-11-09T10:00:00Z');
  const deps: SourceWatchDeps = {
    fetchText: async (url) => {
      const body = bodies[url];
      if (body instanceof Error) throw body;
      return body;
    },
    notify: async (html) => {
      sent.push(html);
      return true;
    },
    now: () => new Date((clock += 60_000)),
    sources,
  };
  return { deps, sent, bodies };
}

test('normalizeHtmlText: теги, сутності й різні тире зводяться до одного вигляду, курсив лишається позначкою', () => {
  assert.equal(normalizeHtmlText('<td>Вокзал&nbsp;&#8211;  Чигирі</td>'), normalizeHtmlText('<td><span>Вокзал – Чигирі</span></td>'));
  assert.notEqual(normalizeHtmlText('<td><em>7-10</em></td>'), normalizeHtmlText('<td>7-10</td>'));
});

test('snapshotHtmlTables: частина на маршрут із заголовка, дата зміни з meta; розмітка без зміни тексту не міняє відбиток', () => {
  const a = snapshotHtmlTables(page(R1, R6));
  assert.deepEqual(Object.keys(a.parts), ['№1', '№2-Б', '№6']);
  assert.equal(a.modified, '2026-07-13T10:44:39+00:00');
  const cosmetic = snapshotHtmlTables(page(R1.replace('&nbsp;– ', ' &#8211; ').replace('<td>6-20', '<td class="x"><span>6-20</span>'), R6));
  assert.equal(cosmetic.fingerprint, a.fingerprint);
});

test('snapshotHtmlTables: змінений час, курсив і примітка під таблицею змінюють лише свою частину', () => {
  const a = snapshotHtmlTables(page(R1, R6));
  assert.deepEqual(changedParts(a.parts, snapshotHtmlTables(page(R1.replace('6-20', '6-25'), R6)).parts), ['№1']);
  assert.deepEqual(changedParts(a.parts, snapshotHtmlTables(page(R1, R6.replace('7-10', '<em>7-10</em>'))).parts), ['№6']);
  assert.deepEqual(changedParts(a.parts, snapshotHtmlTables(page(R1, R6, '* Рейси виконуються щодня')).parts), ['№1']);
});

test('snapshotHtmlTables: сторінка без таблиць — помилка, а не «зміна»', () => {
  assert.throws(() => snapshotHtmlTables('<html><body>Перевірка браузера…</body></html>'), /немає таблиць/);
});

test('snapshotCkanPackage: відбиток — файли набору; сама дата метаданих його не міняє', () => {
  const a = snapshotCkanPackage(ckan('2026-07-17T10:47:56'));
  assert.deepEqual(Object.keys(a.parts), ['agency', 'routes']);
  assert.equal(snapshotCkanPackage(ckan('2026-07-17T10:47:56', '2026-12-01T00:00:00')).fingerprint, a.fingerprint);
  assert.deepEqual(changedParts(a.parts, snapshotCkanPackage(ckan('2026-11-20T09:00:00')).parts), ['routes']);
  assert.throws(() => snapshotCkanPackage(JSON.stringify({ success: false })), /неочікувана/);
});

test('changedParts: змінені, нові й зниклі частини', () => {
  assert.deepEqual(changedParts({ a: '1', b: '2', c: '3' }, { a: '1', b: '9', d: '4' }), ['b', 'd (нове)', 'c (зникло)']);
});

test('runSourceWatch: перший запуск — базовий стан без сповіщення; без змін — тиша', async () => {
  const { prisma, rows } = stubPrisma();
  const h = harness({ 'https://example.org/p': page(R1, R6), 'https://example.org/api': ckan('2026-07-17T10:47:56') });
  assert.deepEqual((await runSourceWatch(prisma, h.deps)).map((r) => r.status), ['baseline', 'baseline']);
  assert.deepEqual((await runSourceWatch(prisma, h.deps)).map((r) => r.status), ['unchanged', 'unchanged']);
  assert.equal(h.sent.length, 0);
  assert.equal(rows.get('page')?.lastChangedAt, null);
  assert.ok(rows.get('page')?.lastCheckedAt);
});

test('runSourceWatch: зміна → одне сповіщення з назвою частини й посиланням; повторна перевірка мовчить', async () => {
  const { prisma } = stubPrisma();
  const h = harness({ 'https://example.org/p': page(R1, R6), 'https://example.org/api': ckan('2026-07-17T10:47:56') });
  await runSourceWatch(prisma, h.deps);
  h.bodies['https://example.org/p'] = page(R1, R6.replace('7-10', '7-15'));
  const second = await runSourceWatch(prisma, h.deps);
  assert.deepEqual(second[0], { key: 'page', status: 'changed', changed: ['№6'], notified: true });
  assert.equal(second[1].status, 'unchanged');
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0], /Змінилось: №6/);
  assert.match(h.sent[0], /Розклад &lt;ради&gt;/);
  assert.match(h.sent[0], /href="https:\/\/example\.org\/p"/);
  await runSourceWatch(prisma, h.deps);
  assert.equal(h.sent.length, 1);

  const [view] = await listWatchedSources(prisma, [HTML_SOURCE]);
  assert.equal(view.pending, true);
  assert.deepEqual(view.changed, ['№6']);
  assert.equal(view.parts, 3);
});

test('runSourceWatch: рядок уже перевів інший процес — сповіщення не дублюється', async () => {
  const { prisma, rows } = stubPrisma();
  const h = harness({ 'https://example.org/p': page(R1, R6) }, [HTML_SOURCE]);
  await runSourceWatch(prisma, h.deps);
  h.bodies['https://example.org/p'] = page(R1.replace('6-20', '6-30'), R6);
  // Інший контейнер встиг записати новий відбиток між читанням рядка й умовним оновленням
  const real = prisma.watchedSource.updateMany.bind(prisma.watchedSource);
  (prisma.watchedSource as unknown as { updateMany: unknown }).updateMany = async (args: { where: Record<string, unknown> }) => {
    const row = rows.get('page') as Row;
    rows.set('page', { ...row, fingerprint: 'written-by-another-container' });
    return real(args as never);
  };
  const [result] = await runSourceWatch(prisma, h.deps);
  assert.equal(result.status, 'changed');
  assert.equal(result.notified, false);
  assert.equal(h.sent.length, 0);
});

test(`runSourceWatch: збій не затирає відбиток; одне сповіщення рівно на ${SOURCE_FAIL_ALERT_AFTER}-й збій поспіль; успіх скидає лічильник`, async () => {
  const { prisma, rows } = stubPrisma();
  const h = harness({ 'https://example.org/p': page(R1, R6) }, [HTML_SOURCE]);
  await runSourceWatch(prisma, h.deps);
  const fingerprint = rows.get('page')?.fingerprint;
  h.bodies['https://example.org/p'] = new Error('HTTP 503');
  for (let i = 1; i <= SOURCE_FAIL_ALERT_AFTER + 2; i += 1) {
    const [r] = await runSourceWatch(prisma, h.deps);
    assert.equal(r.status, 'error');
    assert.equal(r.notified, i === SOURCE_FAIL_ALERT_AFTER);
  }
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0], /не відповідає/);
  assert.equal(rows.get('page')?.fingerprint, fingerprint);
  assert.equal(rows.get('page')?.lastError, 'HTTP 503');

  h.bodies['https://example.org/p'] = page(R1, R6);
  assert.equal((await runSourceWatch(prisma, h.deps))[0].status, 'unchanged');
  assert.equal(rows.get('page')?.failCount, 0);
  assert.equal(rows.get('page')?.lastError, null);
});

test('runSourceWatch: джерело, що не відповіло з першого разу, отримує базовий стан пізніше — без сповіщення про зміну', async () => {
  const { prisma } = stubPrisma();
  const h = harness({ 'https://example.org/p': new Error('timeout') }, [HTML_SOURCE]);
  assert.equal((await runSourceWatch(prisma, h.deps))[0].status, 'error');
  h.bodies['https://example.org/p'] = page(R1, R6);
  assert.equal((await runSourceWatch(prisma, h.deps))[0].status, 'baseline');
  assert.equal(h.sent.length, 0);
});

test('джерело з парсером: сповіщення називає змінені рейси; перше порівняння після появи парсера — лише номер маршруту', async () => {
  const fixture = fs.readFileSync(path.resolve(__dirname, '../../data/korosten-transport/source/rada-timetable.html'), 'utf8');
  const parsed: WatchedSourceDef = { ...HTML_SOURCE, parser: 'korosten-timetable' };
  const { prisma, rows } = stubPrisma();
  const h = harness({ 'https://example.org/p': fixture }, [parsed]);
  await runSourceWatch(prisma, h.deps);
  assert.equal(Object.keys((rows.get('page')?.details as { items: Record<string, string[]> }).items).length, 9);

  // Рада зсунула останній рейс №8 на п'ять хвилин
  const lastRun = '<td><span>18-00</span></td>\n<td><span>18-30</span></td>';
  const at = fixture.lastIndexOf(lastRun);
  assert.ok(at > 0);
  h.bodies['https://example.org/p'] = fixture.slice(0, at) + lastRun.replace('18-00', '18-05').replace('18-30', '18-35') + fixture.slice(at + lastRun.length);
  assert.notEqual(h.bodies['https://example.org/p'], fixture);
  const [result] = await runSourceWatch(prisma, h.deps);
  assert.deepEqual(result.changed, ['№8']);
  assert.match(h.sent[0], /№8: − 18:00–18:30 Романа Шухевича → Бровар/);
  assert.match(h.sent[0], /№8: \+ 18:05–18:35 Романа Шухевича → Бровар/);
  assert.deepEqual((await listWatchedSources(prisma, [parsed]))[0].changeLines, [
    '№8: − 18:00–18:30 Романа Шухевича → Бровар',
    '№8: + 18:05–18:35 Романа Шухевича → Бровар',
  ]);

  // Рядок, записаний до появи парсера (фаза 1): рядків рейсів у базі ще нема
  const old = stubPrisma();
  const h2 = harness({ 'https://example.org/p': fixture }, [HTML_SOURCE]);
  await runSourceWatch(old.prisma, h2.deps);
  h2.deps.sources = [parsed];
  h2.bodies['https://example.org/p'] = h.bodies['https://example.org/p'] as string;
  const [first] = await runSourceWatch(old.prisma, h2.deps);
  assert.deepEqual(first.changed, ['№8']);
  assert.doesNotMatch(h2.sent[0], /18:05/);
});

test('describeChanges: довгий перелік обрізається, частини без попередніх рядків пропускаються', () => {
  const before = { a: Array.from({ length: 12 }, (_, i) => `рейс ${i}`), b: ['x'] };
  const after = { a: [], b: ['x'], c: ['новий'] };
  const lines = describeChanges(before, after);
  assert.equal(lines.length, 9);
  assert.equal(lines[8], 'a: … ще 4');
  assert.deepEqual(describeChanges(undefined, after), []);
});

test('acknowledgeWatchedSource: «Переглянуто» знімає позначку, нова зміна повертає її', async () => {
  const { prisma } = stubPrisma();
  const h = harness({ 'https://example.org/p': page(R1, R6) }, [HTML_SOURCE]);
  await runSourceWatch(prisma, h.deps);
  h.bodies['https://example.org/p'] = page(R1.replace('6-20', '6-40'), R6);
  await runSourceWatch(prisma, h.deps);
  assert.equal(await acknowledgeWatchedSource(prisma, 'page', h.deps.now()), true);
  assert.equal((await listWatchedSources(prisma, [HTML_SOURCE]))[0].pending, false);
  assert.equal(await acknowledgeWatchedSource(prisma, 'nope'), false);
  h.bodies['https://example.org/p'] = page(R1.replace('6-20', '6-50'), R6);
  await runSourceWatch(prisma, h.deps);
  assert.equal((await listWatchedSources(prisma, [HTML_SOURCE]))[0].pending, true);
});

test('HTTP: /admin/transport/sources* лише для адміна; check запам\'ятовує стан, ack позначає переглянутим', async () => {
  const ADMIN = 'source-watch-test-password';
  const { prisma } = stubPrisma();
  const h = harness({ 'https://example.org/p': page(R1, R6) }, [HTML_SOURCE]);
  const app = await listenLocal(createApp({ prisma, adminPassword: ADMIN, sourceWatch: h.deps }));
  const auth = { Authorization: adminAuthToken(ADMIN) };

  assert.equal((await request(app).get('/admin/transport/sources')).status, 401);
  assert.equal((await request(app).post('/admin/transport/sources/check')).status, 401);

  const empty = await request(app).get('/admin/transport/sources').set(auth);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.sources.length, 1);
  assert.equal(empty.body.sources[0].lastCheckedAt, null);

  const first = await request(app).post('/admin/transport/sources/check').set(auth);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.results, [{ key: 'page', status: 'baseline' }]);
  assert.equal(first.body.sources[0].parts, 3);

  h.bodies['https://example.org/p'] = page(R1.replace('6-20', '6-45'), R6);
  const second = await request(app).post('/admin/transport/sources/check').set(auth);
  assert.equal(second.body.sources[0].pending, true);
  assert.equal(h.sent.length, 1);

  const ack = await request(app).post('/admin/transport/sources/page/ack').set(auth);
  assert.equal(ack.status, 200);
  assert.equal(ack.body.sources[0].pending, false);
  assert.equal((await request(app).post('/admin/transport/sources/unknown/ack').set(auth)).status, 404);
});
