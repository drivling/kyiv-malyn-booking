/**
 * transport-feeds.ts: RSS з одним записом про revision (лічильники, guid, дати за Києвом) та iCal маршруту
 * (VTIMEZONE Europe/Kyiv, подія на рейс із RRULE за сервісом, DTSTART = дата revision, згортання рядків, екранування).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { TransportDataset } from './local-transport';
import { buildGtfsFeed } from './gtfs-feed';
import { buildChangesRss, buildRouteCalendar, foldIcsLine, icsText, kyivDate } from './transport-feeds';

function dataset(): TransportDataset {
  return {
    stops: [
      { id: 'st_0001', name: 'Барміна, центр', lat: 50.771, lng: 29.241 },
      { id: 'st_0002', name: 'Лікарня', lat: 50.772, lng: 29.242 },
      { id: 'st_0003', name: 'Вокзал', lat: 50.774, lng: 29.244 },
    ],
    routes: [
      { id: '2', fromName: 'Барміна, центр', toName: 'Вокзал', shortName: '2А' },
      { id: '10', fromName: 'Поліклініка', toName: 'Вокзал', unreliable: true },
    ],
    routeStops: [
      { routeId: '2', stopId: 'st_0001', orderThere: 1, orderBack: 3 },
      { routeId: '2', stopId: 'st_0002', orderThere: 2, orderBack: 2 },
      { routeId: '2', stopId: 'st_0003', orderThere: 3, orderBack: 1 },
      { routeId: '10', stopId: 'st_0001', orderThere: 1, orderBack: 2 },
      { routeId: '10', stopId: 'st_0003', orderThere: 2, orderBack: 1 },
    ],
    trips: [
      { id: '2-01', routeId: '2', serviceId: 'everyday', headsign: 'Вокзал', directionId: '1', departureTime: '07:00' },
      { id: '2-02', routeId: '2', serviceId: 'weekdays', headsign: 'Барміна', directionId: '0', departureTime: '23:50' },
      { id: '10-01', routeId: '10', serviceId: 'everyday', headsign: 'Вокзал', directionId: '1', departureTime: '08:00' },
    ],
    segments: [
      { routeId: '2', fromStopId: 'st_0001', toStopId: 'st_0002', seconds: 300 },
      { routeId: '2', fromStopId: 'st_0002', toStopId: 'st_0003', seconds: 600 },
    ],
    meta: { defaultSec: 120 },
    // 22:30 UTC = 01:30 за Києвом наступної доби (EEST) — перевіряє київську дату
    revision: '2026-07-14T22:30:00.000Z',
  };
}

test('kyivDate uses the Kyiv calendar day', () => {
  assert.equal(kyivDate(new Date('2026-07-14T22:30:00Z')).label, '15.07.2026');
  assert.equal(kyivDate(new Date('2026-01-14T22:30:00Z')).label, '15.01.2026');
  assert.equal(kyivDate(new Date('2026-01-14T21:30:00Z')).label, '14.01.2026');
});

test('buildChangesRss: one item per revision with counts, guid = revision, Kyiv date in the title', () => {
  const feed = buildGtfsFeed(dataset());
  const rss = buildChangesRss(feed);
  assert.ok(rss.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"'));
  assert.ok(rss.includes('<title>Розклад оновлено 15.07.2026</title>'));
  assert.ok(rss.includes('<guid isPermaLink="false">malyn-transport-revision:2026-07-14T22:30:00.000Z</guid>'));
  assert.ok(rss.includes('<pubDate>Tue, 14 Jul 2026 22:30:00 GMT</pubDate>'));
  assert.ok(rss.includes('1 маршрут, 2 рейси, 3 зупинки'), rss);
  assert.ok(rss.includes('№2А Барміна, центр — Вокзал'));
  assert.ok(rss.includes('https://malin.kiev.ua/transport/gtfs.zip'));
  assert.ok(rss.includes('<atom:link href="https://malin.kiev.ua/transport/changes.rss" rel="self"'));
  assert.equal((rss.match(/<item>/g) || []).length, 1);
  // Детерміновано для тієї самої revision
  assert.equal(buildChangesRss(feed, { now: new Date('2030-01-01') }), rss);
});

test('buildRouteCalendar: VTIMEZONE, one VEVENT per trip with service RRULE, DTSTART on the revision day in Kyiv', () => {
  const feed = buildGtfsFeed(dataset());
  const ics = buildRouteCalendar(feed, '2')!;
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('TZID:Europe/Kyiv\r\n'));
  assert.ok(ics.includes('X-WR-CALNAME:Маршрут №2А — Малин'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  // 07:00 → 07:05 → 07:15 (сегменти 300 + 600 с); DTEND — прибуття на останню зупинку
  assert.ok(ics.includes('UID:2-01@malin.kiev.ua\r\n'));
  assert.ok(ics.includes('DTSTART;TZID=Europe/Kyiv:20260715T070000\r\n'), ics);
  assert.ok(ics.includes('DTEND;TZID=Europe/Kyiv:20260715T071500\r\n'), ics);
  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU\r\n'));
  assert.ok(ics.includes('SUMMARY:№2А → Вокзал\r\n'));
  assert.ok(ics.includes('LOCATION:Барміна\\, центр\r\n'));
  assert.ok(ics.includes('DTSTAMP:20260714T223000Z\r\n'));
  // Зворотний рейс пн–пт о 23:50 → прибуття 00:05 наступної доби
  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR\r\n'));
  assert.ok(ics.includes('DTSTART;TZID=Europe/Kyiv:20260715T235000\r\n'));
  assert.ok(ics.includes('DTEND;TZID=Europe/Kyiv:20260716T000500\r\n'), ics);
  // Жоден рядок не довший за 75 октетів
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
  // Довгі рядки згорнуті — розгортаємо (CRLF + пробіл) перед пошуком тексту опису
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('DESCRIPTION:Маршрут №2А\\, рейс 2-01 (щодня).\\n07:00 Барміна\\, центр\\n07:05 Лікарня\\n07:15 Вокзал\\nДані: https://malin.kiev.ua/transport/route/2'), unfolded);
});

test('buildRouteCalendar: unknown or hidden route → null', () => {
  const feed = buildGtfsFeed(dataset());
  assert.equal(buildRouteCalendar(feed, '10'), null);
  assert.equal(buildRouteCalendar(feed, '99'), null);
});

test('icsText and foldIcsLine follow RFC 5545', () => {
  assert.equal(icsText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
  const folded = foldIcsLine('DESCRIPTION:' + 'я'.repeat(100));
  const lines = folded.split('\r\n');
  assert.ok(lines.length >= 3);
  for (const l of lines) assert.ok(Buffer.byteLength(l, 'utf8') <= 75);
  assert.ok(lines.slice(1).every((l) => l.startsWith(' ')));
  assert.equal(lines.map((l, i) => (i ? l.slice(1) : l)).join(''), 'DESCRIPTION:' + 'я'.repeat(100));
  assert.equal(foldIcsLine('short'), 'short');
});
