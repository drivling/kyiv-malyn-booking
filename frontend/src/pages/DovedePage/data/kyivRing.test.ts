/**
 * «Доведе» — міська електричка Києва (Kyiv City Express): дані, розклад, пошук рейсу, вибір між метро й електричкою,
 * станції як місця й еталони `eval/kyiv-ring.json`. Без ШІ й без мережі.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTimetable, parseTrainList, parseTrainPage, timetableJson, type RingConfig, type RingSource } from '../../../../scripts/kyiv-ring-parser.mjs';
import golden from '../eval/kyiv-ring.json';
import { classify, composeStories, resolveDate } from '../compose/composeStories';
import type { StoryLeg } from '../compose/types';
import { matchRing, ringPlace, ringStationOf } from '../nlu/kyivRing';
import { RING_STATIONS } from '../nlu/kyivRingData';
import { METRO_STATIONS } from '../nlu/kyivMetroData';
import { tokenize } from '../nlu/normalize';
import { storySummary } from '../ui/format';
import { parseLocal } from '../nlu/parseLocal';
import { resolvePlace } from '../nlu/places';
import { KYIV_POINTS } from './kyiv';
import { RING_ORDER, RING_TRAINS, lastRingRide, laterRingDepartures, nextRingRide, ringLeftBank, ringRides, ringTrainRuns } from './kyivRing';
import { kyivWay } from './kyivTrip';

const repo = path.resolve(__dirname, '../../../../..');
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
/** середа 18.11.2026, 16:40 — діють додаткові рейси */
const NOW = { date: '2026-11-18', mins: hm('16:40') };
const parse = (text: string) => parseLocal(text, NOW).intent;

describe('міська електричка: дані', () => {
  it('розклад у браузері дорівнює тому, що генератор дає зі знімка й ручного конфігу', () => {
    const source = JSON.parse(fs.readFileSync(path.join(repo, 'data/kyiv-city-express/source/trains.json'), 'utf8')) as RingSource;
    const config = JSON.parse(fs.readFileSync(path.join(repo, 'data/kyiv-city-express/config.json'), 'utf8')) as RingConfig;
    const built = timetableJson(buildTimetable(source, config));
    expect(fs.readFileSync(path.resolve(__dirname, 'kyivRingTimetable.json'), 'utf8')).toBe(built);
  });

  it('20 станцій у порядку розкладу, id унікальні, станція біля метро знає справжню станцію метро', () => {
    expect(RING_STATIONS).toHaveLength(20);
    expect(RING_ORDER.map((s) => s.name)).toEqual(RING_STATIONS.map((s) => s.name));
    expect(new Set(RING_STATIONS.map((s) => s.id)).size).toBe(20);
    const metro = new Set(METRO_STATIONS.map((s) => s.id));
    const hubs = RING_STATIONS.filter((s) => s.metro);
    expect(hubs.map((s) => s.name)).toEqual(['Святошин', 'Берестейська', 'Сирець', 'Почайна', 'Лівобережна', 'Видубичі', 'Вокзальна']);
    for (const s of hubs) {
      expect(metro.has(s.metro!), s.name).toBe(true);
      expect(s.walkMin).toBeGreaterThan(0);
      expect(ringStationOf(s.metro!)).toBe(s);
    }
    for (const s of RING_STATIONS) expect(KYIV_POINTS[s.id]?.label, s.id).toBeTruthy();
  });

  it('копія станцій на сервері байт-у-байт та сама (backend/src/dovede/kyivRingData.ts)', () => {
    const here = fs.readFileSync(path.resolve(__dirname, '../nlu/kyivRingData.ts'), 'utf8');
    expect(fs.readFileSync(path.join(repo, 'backend/src/dovede/kyivRingData.ts'), 'utf8')).toBe(here);
  });

  it('рейси: А — за годинниковою, Б — проти, повне коло починається й закінчується на Святошині; час не йде назад', () => {
    expect(RING_TRAINS.length).toBeGreaterThanOrEqual(50);
    for (const t of RING_TRAINS) {
      if (t.no.startsWith('А')) expect(t.dir, t.no).toBe('cw');
      if (t.no.startsWith('Б')) expect(t.dir, t.no).toBe('ccw');
      if (t.stops.length === 21) expect([t.stops[0][0], t.stops[20][0]], t.no).toEqual([0, 0]);
      t.stops.forEach(([, dep, arr], k) => {
        if (k) expect(dep, t.no).toBeGreaterThanOrEqual(t.stops[k - 1][1]);
        if (arr != null) expect(arr, t.no).toBeLessThanOrEqual(dep);
      });
    }
  });

  it('додаткові рейси «Д» — 16, півкільцем Почайна — Дарниця — Видубичі, лише 17–20 листопада (17-го — з вечора)', () => {
    const extra = RING_TRAINS.filter((t) => t.extra);
    expect(extra.map((t) => t.no).sort()).toEqual(Array.from({ length: 16 }, (_, i) => `Д${String(i + 1).padStart(2, '0')}`));
    for (const t of extra) {
      const ends = [t.stops[0][0], t.stops[t.stops.length - 1][0]].map((i) => RING_ORDER[i].name).sort();
      expect(ends, t.no).toEqual(['Видубичі', 'Почайна']);
      expect(t.stops).toHaveLength(9);
      const dep = t.stops[0][1];
      expect(ringTrainRuns(t, '2026-11-16', dep)).toBe(false);
      expect(ringTrainRuns(t, '2026-11-17', dep)).toBe(dep >= 12 * 60);
      expect(ringTrainRuns(t, '2026-11-18', dep)).toBe(true);
      expect(ringTrainRuns(t, '2026-11-20', dep)).toBe(true);
      expect(ringTrainRuns(t, '2026-11-23', dep)).toBe(false);
    }
  });

  it('лівий берег — між Почайною й Видубичами', () => {
    expect(RING_ORDER.filter((s) => ringLeftBank(s.id)).map((s) => s.name)).toEqual(['Райдужний', 'Воскресенка', 'Микільська Слобідка', 'Лівобережна', 'Русанівка', 'Дарниця', 'Березняки']);
  });
});

describe('міська електричка: розбір сторінок розкладу', () => {
  it('сторінка рейсу: номер, дні, станції з часом', () => {
    const item = (time: string, name: string, extra = '') =>
      `<li class="station-selector__item"><div class="station-selector__item-time"><div class="station-selector__item-time-first"><div>\n ${time}\n </div></div><div class="station-selector__item-time-second">5 хв</div></div>\n ${name}\n ${extra}</li>`;
    const html = `<div class="route-info__title">Рейс <span class="route-info__highlight">Д10</span></div><div class="route-info__schedule"> Курсує пн-пт з <span class="route-info__time">16:59</span></div>
      <h3 class="title-h3">Розклад відправлень</h3><ul class="station-selector__list" id="rule-1">${item('16:59', 'Почайна', '<img src="/b.svg" alt="М2">')}${item('17:08', 'Райдужний')}${item('17:45', 'Видубичі')}</ul>`;
    expect(parseTrainPage(html)).toEqual({ name: 'Д10', runs: 'weekdays', stops: [['Почайна', '16:59'], ['Райдужний', '17:08'], ['Видубичі', '17:45']] });
    expect(() => parseTrainPage('<p>нічого</p>')).toThrow(/не розібрано/);
  });

  it('сторінка «Рейси»: посилання на рейси й станції з пересадками', () => {
    const html = `<a class="trips-clock__cell" href="https://x/trains/2-a02">А02</a><a class="trips-clock__cell" href="https://x/trains/1-d02">Д02</a>
      <li class="station-selector__item" data-value="Почайна" data-slug="pocaina">Почайна <img src="/b.svg" alt="М2"></li><li class="station-selector__item--to" data-value="Почайна" data-slug-to="pocaina">Почайна</li>`;
    expect(parseTrainList(html)).toEqual({ trains: [{ url: 'https://x/trains/2-a02', name: 'А02' }, { url: 'https://x/trains/1-d02', name: 'Д02' }], stations: [{ name: 'Почайна', slug: 'pocaina', badges: ['М2'] }] });
  });

  it('пропущена станція чи час назад — помилка, а не тихий розклад', () => {
    const stations = ['А', 'Б', 'В', 'Г'].map((name) => ({ name, slug: name, badges: [] }));
    const src = (stops: Array<[string, string]>): RingSource => ({ fetchedAt: '2026-11-17T00:00:00Z', stations, trains: [{ name: 'А01', runs: 'daily', stops }] });
    expect(buildTimetable(src([['А', '05:00'], ['Б', '05:05'], ['В', '05:09']]), {}).trains[0]).toMatchObject({ dir: 'cw', stops: [[0, 300], [1, 305], [2, 309]] });
    expect(buildTimetable(src([['В', '05:00'], ['Б', '05:05']]), {}).trains[0].dir).toBe('ccw');
    expect(() => buildTimetable(src([['А', '05:00'], ['В', '05:05']]), {})).toThrow(/не сусідні/);
    expect(() => buildTimetable(src([['А', '05:00'], ['Б', '05:05'], ['Г', '05:09']]), {})).toThrow(/пропущено/);
    expect(() => buildTimetable(src([['А', '05:10'], ['Б', '05:05']]), {})).toThrow(/назад/);
  });
});

describe('міська електричка: рейси за розкладом (еталони)', () => {
  it.each(golden.rides)('$from → $to, $date після $after', (c) => {
    const ride = nextRingRide(c.from, c.to, c.date, hm(c.after));
    if (c.train === null) {
      expect(ride).toBeNull();
      return;
    }
    expect(ride && [ride.train, ride.depMins, ride.arrMins, ride.extra]).toEqual([c.train, hm(c.dep!), hm(c.arr!), c.extra]);
    expect(ride!.stops[0].station.id).toBe(c.from);
    expect(ride!.stops[ride!.stops.length - 1].station.id).toBe(c.to);
  });

  it('їхати можна в обидва боки кільця: зі Святошина на Дарницю — і «А» північчю, і «Б» півднем; гірші відкинуто', () => {
    const rides = ringRides('kyiv.e.sviatoshyn', 'kyiv.e.darnytsia', '2026-11-18');
    expect(new Set(rides.map((r) => r.dir))).toEqual(new Set(['cw', 'ccw']));
    for (const r of rides) expect(rides.some((o) => o !== r && o.depMins >= r.depMins && o.arrMins < r.arrMins)).toBe(false);
  });

  it('останній рейс до часу й наступні відправлення', () => {
    const last = lastRingRide('kyiv.e.pochaina', 'kyiv.e.vydubychi', '2026-11-18', hm('18:00'))!;
    expect([last.train, last.arrMins]).toEqual(['А18', hm('17:57')]);
    const d10 = nextRingRide('kyiv.e.pochaina', 'kyiv.e.vydubychi', '2026-11-18', hm('16:50'))!;
    expect(laterRingDepartures(d10, '2026-11-18')).toEqual([hm('17:10'), hm('17:40'), hm('17:59')]);
    expect(lastRingRide('kyiv.e.pochaina', 'kyiv.e.vydubychi', '2026-11-18', hm('05:00'))).toBeNull();
  });
});

describe('міська електричка: дорога Києвом — метро, електричка чи обидва', () => {
  const D = '2026-11-18';
  const shape = (w: ReturnType<typeof kyivWay>) => w?.parts.map((p) => (p.kind === 'metro' ? 'metro' : p.ride.train));

  it('обидві точки на метро — метро, якщо електричка не виграє помітно', () => {
    expect(shape(kyivWay('kyiv.sviatoshyn', 'kyiv.m.vydubychi', 'from', hm('10:00'), D))).toEqual(['metro']);
    expect(shape(kyivWay('kyiv.m.pochaina', 'kyiv.m.vydubychi', 'from', hm('16:50'), D))).toEqual(['metro']);
  });

  it('станція без метро — електричка з точним часом; від метро до платформи — пішки й запас на посадку', () => {
    const w = kyivWay('kyiv.sviatoshyn', 'kyiv.e.darnytsia', 'from', hm('15:00'), D)!;
    expect(shape(w)).toEqual(['Б16']);
    expect([w.depMins, w.arrMins]).toEqual([hm('15:00'), hm('16:37')]);
    expect(w.parts[0]).toMatchObject({ kind: 'ring', walkBeforeMin: 4, walkAfterMin: 0 });
    // 15:35 + 4 хв пішки + 4 хв запасу > 15:38 — цей рейс уже не встигнути
    expect(shape(kyivWay('kyiv.sviatoshyn', 'kyiv.e.darnytsia', 'from', hm('15:35'), D))).toEqual(['А16']);
  });

  it('метро до станції кільця й далі електричка; у зворотний бік — електричка й метро', () => {
    const there = kyivWay('kyiv.akadem', 'kyiv.e.karavaievi-dachi', 'from', hm('10:00'), D)!;
    expect(shape(there)).toEqual(['metro', 'А09']);
    expect(there.arrMins).toBe(hm('10:47'));
    const back = kyivWay('kyiv.e.kurenivka', 'kyiv.akadem', 'until', hm('15:00'), D)!;
    expect(shape(back)).toEqual(['Б13', 'metro']);
    expect(back.arrMins).toBe(hm('15:00'));
    expect(back.depMins).toBeLessThan(hm('14:08'));
  });

  it('після приблизного прибуття на електричку сідаємо із запасом', () => {
    const tight = kyivWay('kyiv.pas', 'kyiv.e.karavaievi-dachi', 'from', hm('09:30'), '2026-11-19')!;
    expect(shape(tight)).toEqual(['А07']);
    const safe = kyivWay('kyiv.pas', 'kyiv.e.karavaievi-dachi', 'from', hm('09:30'), '2026-11-19', 'best', 6)!;
    expect(shape(safe)).toEqual(['А08']);
  });

  it('режими: лише метро, лише електричка, лише прямий рейс; уночі — нічого', () => {
    expect(shape(kyivWay('kyiv.m.pochaina', 'kyiv.m.vydubychi', 'from', hm('16:50'), D, 'direct'))).toEqual(['Д10']);
    expect(kyivWay('kyiv.akadem', 'kyiv.e.karavaievi-dachi', 'from', hm('10:00'), D, 'direct')).toBeNull();
    expect(kyivWay('kyiv.akadem', 'kyiv.e.karavaievi-dachi', 'from', hm('10:00'), D, 'metro')).toBeNull();
    expect(kyivWay('kyiv.sviatoshyn', 'kyiv.e.darnytsia', 'from', hm('23:40'), D)).toBeNull();
  });
});

describe('міська електричка: станції як місця', () => {
  it('кожна станція без метро — місце в Києві, і її назва розбирається назад у неї', () => {
    for (const st of RING_STATIONS.filter((s) => !s.metro)) {
      expect(resolvePlace(st.id), st.id).toMatchObject({ id: st.id, city: 'Kyiv' });
      for (const name of [...(st.strict ? [] : [st.name]), ...st.said]) {
        expect(matchRing(tokenize(name), 0)?.station.id, name).toBe(st.id);
        expect(parse(`з Малина до ${name}`).to?.id, name).toBe(st.id);
      }
    }
    expect(ringPlace('kyiv.e.kurenivka')?.label).toBe('ст. Куренівка');
  });

  it('станція біля метро лишається місцем метро; «Дарниця» без слова «вокзал» — метро', () => {
    for (const st of RING_STATIONS.filter((s) => s.metro)) expect(matchRing(tokenize(st.name), 0), st.name).toBeNull();
    expect(matchRing(tokenize('Дарниця'), 0)).toBeNull();
  });

  it.each(golden.questions)('питання: «$text»', (c) => {
    const intent = parse(c.text);
    expect([intent.from?.id ?? null, intent.to?.id ?? null]).toEqual([c.from, c.to]);
    if ('modes' in c && c.modes) expect(intent.modes).toEqual(c.modes);
  });

  it('«у неділю» і «воскресенье» лишаються днем тижня, «на Воскресенку» — станцією', () => {
    expect(parse('з Малина до Києва в воскресенье').to?.id).toBe('city.Kyiv');
    expect(parse('з Малина на Воскресенку в неділю').to?.id).toBe('kyiv.e.voskresenka');
  });
});

describe('міська електричка: відповідь у межах Києва', () => {
  const answer = (text: string, now = NOW) => {
    const intent = parseLocal(text, now).intent;
    const out = composeStories({ intent, now, date: resolveDate(intent.when.day, now), schedules: [], planner: null });
    return { intent, out };
  };
  const ring = (legs: StoryLeg[]) => legs.find((l): l is Extract<StoryLeg, { kind: 'ring' }> => l.kind === 'ring')!;

  it('«з Почайни на Видубичі електричкою» о 16:40 — додатковий Д10 о 16:59 і наступний прямий рейс, без метро', () => {
    const { intent, out } = answer('з Почайни на Видубичі електричкою');
    expect(classify(intent).kind).toBe('kyiv');
    if (out.kind !== 'stories') throw new Error(out.kind);
    expect(out.stories.map((s) => [s.mode, ring(s.legs).ride.train, s.legs.length])).toEqual([['kyiv', 'Д10', 1], ['kyiv', 'А18', 1]]);
    const s = out.stories[0];
    // вийти з метро «Почайна» за 3 хв пішки й 4 хв запасу до рейсу; на місці — 17:45 + 3 хв до метро «Видубичі»
    expect([s.leaveMins, s.arriveMins, s.arriveApprox, s.priceUah]).toEqual([hm('16:52'), hm('17:48'), true, 30]);
    expect(s.lead).toBe('Міська електричка Д10 о 16:59 з платформи «Почайна». Київ, метро «Видубичі» — приблизно о 17:48.');
    expect(ring(s.legs)).toMatchObject({ depMins: hm('16:59'), arrMins: hm('17:45'), walkBeforeMin: 3, walkAfterMin: 3, priceUah: 30 });
  });

  it('без слова «електричкою» — ще й метро для порівняння, першим той варіант, що раніше привозить', () => {
    const { out } = answer('з Почайни на Видубичі');
    if (out.kind !== 'stories') throw new Error(out.kind);
    expect(out.stories).toHaveLength(3);
    expect(out.stories[0].legs.map((l) => l.kind)).toEqual(['metro']);
    expect(out.stories.slice(1).map((s) => ring(s.legs).ride.train)).toEqual(['Д10', 'А18']);
    expect(out.askMode).toBe(false);
  });

  it('станція без метро: кінець — платформа, час точний; після строку додаткових рейсів їх немає', () => {
    const { out } = answer('з Почайни на вокзал Дарниця', { date: '2026-11-23', mins: hm('16:40') });
    if (out.kind !== 'stories') throw new Error(out.kind);
    const s = out.stories[0];
    expect([ring(s.legs).ride.train, ring(s.legs).ride.extra, s.arriveApprox, s.endLabel]).toEqual(['А18', false, false, 'Київ, платформа «Дарниця»']);
  });

  it('«бути на Видубичах до 18:00» — останній рейс, що встигає із запасом (А18 прибуває о 17:57 — впритул)', () => {
    const { out } = answer('електричкою з Почайни на Видубичі щоб бути до 18:00');
    if (out.kind !== 'stories') throw new Error(out.kind);
    expect(ring(out.stories[0].legs).ride.train).toBe('Д10');
    expect(out.stories[0].arriveMins).toBeLessThanOrEqual(hm('18:00'));
  });

  it('зі Святошина на Позняки: поїзди за «Видубичами» не ходять — у кожному варіанті названо автобус №318, і в підписах «інших варіантів» теж', () => {
    const { out } = answer('сейчас со святошина на позняки', { date: '2026-11-17', mins: hm('20:05') });
    if (out.kind !== 'stories') throw new Error(out.kind);
    expect(out.stories.map((s) => s.lead)).toEqual([
      'Метро до «Видубичі», далі автобус №318 замість метро до «Позняки». Київ, метро «Позняки» — приблизно о 21:09.',
      'Міська електричка Б24 о 20:38 з платформи «Святошин», далі автобус №318 замість метро до «Позняки». Київ, метро «Позняки» — приблизно о 21:39.',
      'Міська електричка А24 о 20:44 з платформи «Святошин», далі метро до «Видубичі», далі автобус №318 замість метро до «Позняки». Київ, метро «Позняки» — приблизно о 21:48.',
    ]);
    expect(out.stories.map((s) => storySummary(s))).toEqual([
      { title: 'Метро й автобус №318', sub: '≈ 1 год 4 хв · 30 ₴', time: '≈21:09' },
      // електричка до «Видубичів» і лише автобус: жетон метро не рахуємо
      { title: 'Міська електричка Б24', sub: '20:38 з платформи «Святошин» · далі автобус №318 · 30 ₴', time: '≈21:39' },
      { title: 'Міська електричка А24', sub: '20:44 з платформи «Святошин» · з метро й автобусом №318 · 60 ₴', time: '≈21:48' },
    ]);
  });

  it('пізно ввечері рейсів уже немає — порожньо (сторінка покаже завтрашні)', () => {
    const { out } = answer('електричкою з Куренівки на Березняки', { date: '2026-11-18', mins: hm('23:10') });
    expect(out).toEqual({ kind: 'empty', reason: 'too_late' });
  });

  it('Київ загалом чи та сама точка — як і раніше поза зоною', () => {
    expect(classify(parse('з Києва до Києва')).kind).toBe('outside');
    expect(classify(parse('з Почайни в Київ')).kind).toBe('outside');
  });
});
