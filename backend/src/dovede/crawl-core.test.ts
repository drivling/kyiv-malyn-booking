/**
 * «Доведе» · обхід у ширину для наповнення бази доріг містом (crawl-core.ts) — без мережі й диска.
 * Розбір фрази сторінкою й рівність `detailForm` з `parseLocal` перевіряє фронтенд
 * (src/test/dovede-crawl.test.ts, src/pages/DovedePage/nlu/cityDetail.test.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  candidates,
  compactSteps,
  createCrawl,
  normalizeKey,
  parseSlots,
  rejectedNames,
  resolveOrigins,
  rootsFromRecords,
  seedFromIntent,
  seedsFromUnanswered,
  siteForm,
  slotDate,
  summarizeRecords,
  type CrawlRecord,
  type CrawlTask,
} from './crawl-core';
import { dayTypeOf as cityRouteDayType, normalizeKey as cityRouteKey } from './city-route';

const NOW = new Date('2026-11-17T10:00:00Z'); // вівторок
const now = () => NOW;
const WEEKDAY = parseSlots('weekday@09:00');

/** Відповідь сервера: метро, потім автобус 118 від «Лівобережної» до «вул. Ентузіастів», кінцева «Русанівка» */
const ANSWER = [
  { kind: 'walk', minutes: 3, meters: 200 },
  { kind: 'transit', minutes: 30, mode: 'SUBWAY', line: 'M1', fromStop: 'Святошин', toStop: 'Лівобережна', headsign: 'Лісова' },
  { kind: 'transit', minutes: 6, mode: 'BUS', line: '118', fromStop: 'ст. м. Лівобережна', toStop: 'вул. Ентузіастів', headsign: 'Русанівка', stops: 3 },
  { kind: 'walk', minutes: 2, meters: 150 },
];

function runAll(crawl: ReturnType<typeof createCrawl>, answer: (t: CrawlTask) => { ok: boolean; steps?: unknown[]; reason?: string }) {
  const asked: string[] = [];
  const records: CrawlRecord[] = [];
  for (let t = crawl.next(); t; t = crawl.next()) {
    asked.push(`${t.ask.from} → ${t.ask.to} @${t.slot.dayType} ${t.ask.time}`);
    const a = answer(t);
    records.push(crawl.done(t, a.ok ? { ok: true, source: 'google', minutes: 40, steps: a.steps } : { ok: false, reason: a.reason }).record);
  }
  return { asked, records };
}

describe('dovede-crawl: з чого почати', () => {
  it('точки висадки за словами людини', () => {
    expect(resolveOrigins('Kyiv', '')).toEqual(['kyiv.akadem']);
    expect(resolveOrigins('Kyiv', 'Святошино, вокзал')).toEqual(['kyiv.sviatoshyn', 'kyiv.pas']);
    expect(resolveOrigins('Kyiv', 'all')).toHaveLength(5);
    expect(resolveOrigins('Zhytomyr', 'святошин')).toEqual(['zhytomyr.avtovokzal']);
    expect(() => resolveOrigins('Kyiv', 'Троєщина')).toThrow(/Не знаю точки/);
  });

  it('час: пресети й найближча дата потрібного типу дня', () => {
    expect(parseSlots('')).toEqual([{ dayType: 'weekday', time: '09:00' }]);
    expect(parseSlots('будні@8,субота@10:30')).toEqual([{ dayType: 'weekday', time: '08:00' }, { dayType: 'saturday', time: '10:30' }]);
    expect(parseSlots('day')).toHaveLength(5);
    expect(parseSlots('full')).toHaveLength(18);
    expect(() => parseSlots('weekday@25')).toThrow();
    expect(slotDate('weekday', '2026-11-17')).toBe('2026-11-18');
    expect(slotDate('weekday', '2026-11-20')).toBe('2026-11-23'); // після пʼятниці — понеділок
    expect(slotDate('saturday', '2026-11-17')).toBe('2026-11-21');
    expect(slotDate('sunday', '2026-11-22')).toBe('2026-11-29'); // сьогодні не беремо: Google потрібен майбутній час
  });
});

describe('dovede-crawl: нові місця з відповіді', () => {
  const steps = compactSteps(ANSWER);

  it('зупинки наземного транспорту й кінцева лінії; метро і зупинка біля метро — ні', () => {
    expect(candidates(steps)).toEqual([
      { name: 'вул. Ентузіастів', via: 'stop' },
      { name: 'Русанівка', via: 'headsign' },
    ]);
    expect(candidates(steps, { headsigns: false }).map((c) => c.name)).toEqual(['вул. Ентузіастів']);
  });

  it('зупинку біля самої точки пропускає: першу посадку «від точки», останню висадку «до точки»', () => {
    const bus = compactSteps([{ kind: 'transit', minutes: 20, mode: 'BUS', line: '37', fromStop: 'Академмістечко (зупинка)', toStop: 'вул. Сімʼї Сосніних', headsign: 'Микільська Борщагівка' }]);
    expect(candidates(bus, { dir: 'to' }).map((c) => c.name)).toEqual(['вул. Сімʼї Сосніних', 'Микільська Борщагівка']);
    expect(candidates(bus, { dir: 'from' }).map((c) => c.name)).toEqual(['Академмістечко (зупинка)', 'Микільська Борщагівка']);
  });

  it('назву бере у формі сторінки; відоме сторінці місце й загальні слова — ні', () => {
    const s = compactSteps([
      { kind: 'transit', minutes: 5, mode: 'TRAM', line: '1', fromStop: 'A', toStop: 'Ринок', headsign: 'Дарницький вокзал' },
      { kind: 'transit', minutes: 5, mode: 'BUS', line: '9', fromStop: 'Кінотеатр «Росія»', toStop: 'Кінотеатр «Росія»', headsign: 'Національний університет біоресурсів і природокористування України' },
    ]);
    const siteForm = (name: string) => (name.includes('вокзал') ? null : name.split(' ').slice(0, 5).join(' '));
    expect(candidates(s, { siteForm }).map((c) => c.name)).toEqual(['Кінотеатр «Росія»', 'Національний університет біоресурсів і природокористування']);
  });

  it('назви, яких у місті багато, і обірвані словником сторінки — не питає: Google знайшов би не те місце', () => {
    const s = compactSteps([
      { kind: 'transit', minutes: 5, mode: 'BUS', line: '9', fromStop: 'A', toStop: 'Супермаркет', headsign: 'ж/м Теремки' },
      { kind: 'transit', minutes: 5, mode: 'BUS', line: '7', fromStop: 'Гіпермаркет', toStop: 'Авторинок', headsign: 'Національний музей народної архітектури та побуту' },
      { kind: 'transit', minutes: 5, mode: 'BUS', line: '5', fromStop: 'Універмаг "Дитячий світ"', toStop: 'вул. Татарська', headsign: 'Медучилище' },
      { kind: 'transit', minutes: 5, mode: 'BUS', line: '3', fromStop: 'станція', toStop: 'Дорога', headsign: 'Дитяча поліклініка' },
    ]);
    // сторінка інколи скорочує назву до одного складу чи обриває на сполучнику
    const siteForm = (name: string) => (name.startsWith('ж/м') ? 'ж' : name.replace(/ побуту$/, ''));
    expect(candidates(s, { siteForm }).map((c) => c.name)).toEqual(['Універмаг "Дитячий світ"', 'вул. Татарська']);
    // те, що відкинуто, — для звіту якості кампанії; зупинку біля точки й метро сміттям не рахуємо
    expect(rejectedNames(s, { siteForm })).toEqual(['Супермаркет', 'ж/м Теремки', 'Гіпермаркет', 'Авторинок', 'Національний музей народної архітектури та побуту', 'Медучилище', 'станція', 'Дорога', 'Дитяча поліклініка']);
  });

  it('відкинуті назви: метро й залізниця — не сміття; повтори — один раз', () => {
    const s = compactSteps([
      { kind: 'transit', minutes: 5, mode: 'SUBWAY', line: 'M1', fromStop: 'Академмістечко', toStop: 'Вокзальна', headsign: 'Лісова' },
      { kind: 'transit', minutes: 5, mode: 'BUS', line: '9', fromStop: 'метро «Вокзальна»', toStop: 'Ринок', headsign: 'Ринок' },
    ]);
    expect(rejectedNames(s)).toEqual(['Ринок']);
    expect(candidates(s).map((c) => c.name)).toEqual([]);
  });
});

describe('dovede-crawl: обхід у ширину', () => {
  const seed = { city: 'Kyiv' as const, origin: 'kyiv.sviatoshyn', place: 'вулиця Ентузіастів 7' };

  it('питає перше місце, потім знайдені з відповіді — від тієї самої точки; рівень за рівнем до --depth', () => {
    const crawl = createCrawl({ seeds: [seed], slots: WEEKDAY, maxDepth: 1, now });
    const { asked } = runAll(crawl, () => ({ ok: true, steps: ANSWER }));
    expect(asked).toEqual([
      'kyiv.sviatoshyn → вулиця Ентузіастів 7 @weekday 09:00',
      'kyiv.sviatoshyn → вул. Ентузіастів @weekday 09:00',
      'kyiv.sviatoshyn → Русанівка @weekday 09:00',
    ]);
    expect(crawl.stats.found).toBe(2);
    expect(crawl.next()).toBeNull();
  });

  it('напрям «від місця до точки» шле місце у from', () => {
    const crawl = createCrawl({ seeds: [{ ...seed, dir: 'from' as const }], slots: WEEKDAY, maxDepth: 0, now });
    expect(crawl.next()?.ask).toEqual({ city: 'Kyiv', from: 'вулиця Ентузіастів 7', to: 'kyiv.sviatoshyn', date: '2026-11-18', time: '09:00' });
  });

  it('невдала відповідь нових місць не дає; інші часи питає лише для вдалих місць і після всіх місць', () => {
    const slots = parseSlots('weekday@09,saturday@10');
    const crawl = createCrawl({ seeds: [seed, { ...seed, place: 'Ніде' }], slots, maxDepth: 1, headsigns: false, now });
    const { asked } = runAll(crawl, (t) => (t.node.place === 'Ніде' ? { ok: false, reason: 'no_route' } : { ok: true, steps: ANSWER }));
    expect(asked).toEqual([
      'kyiv.sviatoshyn → вулиця Ентузіастів 7 @weekday 09:00',
      'kyiv.sviatoshyn → Ніде @weekday 09:00',
      'kyiv.sviatoshyn → вул. Ентузіастів @weekday 09:00',
      'kyiv.sviatoshyn → вулиця Ентузіастів 7 @saturday 10:00',
      'kyiv.sviatoshyn → вул. Ентузіастів @saturday 10:00',
    ]);
  });

  it('другий запуск із журналом нічого не питає вдруге, але продовжує з місць, знайдених минулого разу', () => {
    const first = createCrawl({ seeds: [seed], slots: WEEKDAY, maxDepth: 2, now });
    // перший запуск перервали після першої відповіді
    const t = first.next()!;
    const { record } = first.done(t, { ok: true, source: 'google', minutes: 40, steps: ANSWER });
    expect(record).toMatchObject({ city: 'Kyiv', origin: 'kyiv.sviatoshyn', place: 'вулиця Ентузіастів 7', dayType: 'weekday', hour: 9, ok: true, source: 'google' });

    const second = createCrawl({ records: [record], seeds: rootsFromRecords([record]), slots: WEEKDAY, maxDepth: 2, now });
    const { asked } = runAll(second, () => ({ ok: false, reason: 'no_route' }));
    expect(asked).toEqual(['kyiv.sviatoshyn → вул. Ентузіастів @weekday 09:00', 'kyiv.sviatoshyn → Русанівка @weekday 09:00']);
    expect(second.stats.skipped).toBe(1);
  });

  it('сусідня година вже є в журналі — сервер віддасть її з бази, не питаємо; стара за 30 днів — питаємо знову', () => {
    const base: CrawlRecord = { at: NOW.toISOString(), city: 'Kyiv', origin: 'kyiv.sviatoshyn', dir: 'to', place: 'Вулиця Ентузіастів, 7', depth: 0, via: 'seed', dayType: 'weekday', hour: 10, date: '2026-11-18', time: '10:00', ok: true, source: 'google', minutes: 40, steps: [] };
    expect(createCrawl({ records: [base], seeds: [seed], slots: WEEKDAY, now }).next()).toBeNull();
    expect(createCrawl({ records: [{ ...base, hour: 12 }], seeds: [seed], slots: WEEKDAY, now }).next()).not.toBeNull();
    expect(createCrawl({ records: [{ ...base, at: '2026-10-01T10:00:00Z' }], seeds: [seed], slots: WEEKDAY, now }).next()).not.toBeNull();
    // «маршруту немає» теж памʼятаємо; збій Google — ні, скільки б разів він не стався: це не відповідь про місце
    const fail = { ...base, ok: false, source: undefined, reason: 'error' };
    expect(createCrawl({ records: [{ ...fail, reason: 'no_route' }], seeds: [seed], slots: WEEKDAY, now }).next()).toBeNull();
    expect(createCrawl({ records: [fail], seeds: [seed], slots: WEEKDAY, now }).next()).not.toBeNull();
    expect(createCrawl({ records: [fail, fail, fail], seeds: [seed], slots: WEEKDAY, now }).next()).not.toBeNull();
  });

  it('те саме місце двічі не питає, хоч би як його написали', () => {
    expect(normalizeKey('Вул. «Ентузіастів»,  7')).toBe('вул ентузіастів 7');
    const crawl = createCrawl({ seeds: [seed, { ...seed, place: 'Вулиця Ентузіастів, 7' }], slots: WEEKDAY, maxDepth: 0, now });
    expect(runAll(crawl, () => ({ ok: true, steps: ANSWER })).asked).toHaveLength(1);
  });

  it('зведення журналу: що зібрано і скільки відповідей уже застаріло', () => {
    const crawl = createCrawl({ seeds: [seed], slots: WEEKDAY, maxDepth: 1, headsigns: false, now });
    const { records } = runAll(crawl, (t) => (t.node.depth ? { ok: false, reason: 'no_route' } : { ok: true, steps: ANSWER }));
    expect(summarizeRecords(records, { now })).toMatchObject({ total: 2, pairs: 1, lines: 2, stops: 4, by: { google: 1, no_route: 1 }, stale: 0, expiring: 0 });
    const in25 = () => new Date(NOW.getTime() + 25 * 24 * 3600_000);
    const in31 = () => new Date(NOW.getTime() + 31 * 24 * 3600_000);
    expect(summarizeRecords(records, { now: in25 })).toMatchObject({ stale: 0, expiring: 1 });
    expect(summarizeRecords(records, { now: in31 })).toMatchObject({ stale: 1, expiring: 0 });
    // строк з адмінки довший — та сама відповідь ще свіжа; і обхід її не перепитує
    expect(summarizeRecords(records, { now: in31, freshDays: 90 })).toMatchObject({ stale: 0, expiring: 0 });
    expect(createCrawl({ records, seeds: [seed], slots: WEEKDAY, maxDepth: 0, freshDays: 90, now: in31 }).next()).toBeNull();
    expect(createCrawl({ records, seeds: [seed], slots: WEEKDAY, maxDepth: 0, freshDays: 30, now: in31 }).next()).not.toBeNull();
  });

  it('питання людей без відповіді → з чого почати: точка з одного боку, слова з другого', () => {
    expect(
      seedsFromUnanswered([
        { city: 'Kyiv', fromKey: 'kyiv.akadem', toKey: 'охматдит', from: 'метро «Академмістечко»', to: 'Охматдит', asked: 3 },
        { city: 'Kyiv', fromKey: 'трц лавина', toKey: 'kyiv.sviatoshyn', from: 'ТРЦ Лавина', to: 'метро «Святошин»', asked: 1 },
        { city: 'Zhytomyr', fromKey: 'zhytomyr.avtovokzal', toKey: 'польова 12', from: 'автовокзал Житомир-1', to: 'Польова 12', asked: 1 },
        // такого сторінка не шле — пропускаємо
        { city: 'Kyiv', fromKey: 'kyiv.akadem', toKey: 'kyiv.pas', from: 'a', to: 'b', asked: 1 },
        { city: 'Kyiv', fromKey: 'охматдит', toKey: 'лавина', from: 'Охматдит', to: 'Лавина', asked: 1 },
        { city: 'Malyn', fromKey: 'kyiv.akadem', toKey: 'охматдит', from: 'a', to: 'Охматдит', asked: 1 },
      ]),
    ).toEqual([
      { city: 'Kyiv', origin: 'kyiv.akadem', dir: 'to', place: 'Охматдит', via: 'people' },
      { city: 'Kyiv', origin: 'kyiv.sviatoshyn', dir: 'from', place: 'ТРЦ Лавина', via: 'people' },
      { city: 'Zhytomyr', origin: 'zhytomyr.avtovokzal', dir: 'to', place: 'Польова 12', via: 'people' },
    ]);
    expect(seedsFromUnanswered(undefined)).toEqual([]);
  });
});

describe('dovede-crawl: спільне з сервером', () => {
  it('ключ пари й тип дня — ті самі функції, що в city-route.ts', () => {
    expect(cityRouteKey).toBe(normalizeKey);
    expect(cityRouteDayType('2026-11-21')).toBe('saturday');
  });

  it('розбір сторінки → місце словами', () => {
    expect(seedFromIntent({ from: { id: 'city.Malyn' }, to: { id: 'city.Kyiv', detail: ' вулиця Ентузіастів 7 ' } })).toEqual({ city: 'Kyiv', place: 'вулиця Ентузіастів 7', dir: 'to' });
    expect(seedFromIntent({ from: { id: 'city.Zhytomyr', detail: 'Польова 12' }, to: { id: 'city.Malyn' } })).toEqual({ city: 'Zhytomyr', place: 'Польова 12', dir: 'from' });
    expect(seedFromIntent({ to: { id: 'kyiv.akadem' } })).toBeNull();
    expect(seedFromIntent(null)).toBeNull();
  });

  it('siteForm: назва так, як її надіслала б сторінка; відоме сторінці — null', () => {
    expect(siteForm('Kyiv', 'вул. Ентузіастів')).toBe('вул. Ентузіастів');
    expect(siteForm('Kyiv', 'Національний університет біоресурсів і природокористування України')).toBe('Національний університет біоресурсів і природокористування');
    expect(siteForm('Zhytomyr', 'Польову 12')).toBe('Польова 12');
    expect(siteForm('Kyiv', 'ст. м. Лівобережна')).toBeNull();
    expect(siteForm('Kyiv', 'Лівобережна')).toBeNull();
    expect(siteForm('Kyiv', 'Дарницький вокзал')).toBeNull();
    expect(siteForm('Zhytomyr', 'автовокзал')).toBeNull();
  });
});
