import { describe, expect, it } from 'vitest';
import type { DirectWalk, Endpoint, Journey } from '@/pages/LocalTransportPage/journey';
import type { Schedule, ViberListing } from '@/types';
import { parseLocal } from '../nlu/parseLocal';
import type { KyivNow } from '../nlu/types';
import { placesInNote } from '../nlu/notePlaces';
import { cityAsks, classify, composeStories, corridorCities, resolveDate, rideDepartures, ridesWanted } from './composeStories';
import { shareText } from './narrate';
import { cityAskKey, type CityRoute, type LocalPlanner, type Story, type StoryLeg } from './types';

/** п'ятниця 13.11.2026, 14:20 */
const NOW: KyivNow = { date: '2026-11-13', mins: 14 * 60 + 20 };
const hm = (h: number, m: number) => h * 60 + m;

const NAMES: Record<string, string> = {
  st_0079: 'ПТЛ',
  st_0049: 'м-н «Промінь»',
  st_0070: 'пл. Соборна (біля РБК)',
  st_0004: 'Автостанція',
  st_0090: 'Царське село',
  st_0019: 'Залізничний вокзал',
};
const COORDS: Record<string, [number, number]> = {
  st_0079: [50.75975, 29.28151],
  st_0049: [50.76699, 29.24245],
  st_0070: [50.76804, 29.24266],
  st_0004: [50.77398, 29.23669],
  st_0090: [50.76995, 29.26604],
  st_0019: [50.77417, 29.2951],
};

function bus(routeId: string, from: string, to: string, dep: number, arr: number): Journey {
  return {
    legs: [
      {
        kind: 'transit',
        routeId,
        tripId: `${routeId}-${dep}`,
        direction: 'back',
        variantId: null,
        boardStopId: from,
        alightStopId: to,
        depMins: dep,
        arrMins: arr,
        stopIds: [from, 'st_x', to],
        stopTimes: [dep, dep + 1, arr],
        patternIndex: 0,
        tripIndex: 0,
        boardPos: 0,
        alightPos: 2,
      },
    ],
    departMins: dep,
    arriveMins: arr,
    transfers: 0,
    walkMeters: 0,
    waitMins: 0,
  };
}

function planner(table: Record<string, Journey[]>, walks: Record<string, DirectWalk> = {}): LocalPlanner {
  const key = (e: Endpoint) => (e.kind === 'stop' ? e.stopId : `${e.lat},${e.lng}`);
  return {
    plan: (from, to) => ({ journeys: table[`${key(from)}>${key(to)}`] ?? [], directWalk: walks[`${key(from)}>${key(to)}`] ?? null }),
    stopName: (id) => NAMES[id] ?? id,
    stopCoords: (id) => COORDS[id] ?? null,
  };
}

function sched(p: Partial<Schedule> & Pick<Schedule, 'id' | 'route' | 'departureTime'>): Schedule {
  return {
    maxSeats: 20,
    supportPhone: null,
    createdAt: '',
    updatedAt: '',
    activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
    vehicleType: 'marshrutka',
    priceUah: 310,
    ...p,
  } as Schedule;
}

const kinds = (s: Story) => s.legs.map((l) => l.kind);
const intercity = (s: Story) => s.legs.find((l): l is Extract<StoryLeg, { kind: 'intercity' }> => l.kind === 'intercity')!;
const busLeg = (s: Story) => s.legs.find((l): l is Extract<StoryLeg, { kind: 'bus' }> => l.kind === 'bus')!;

describe('Київ (Святошин) → Малин, вокзал — пʼятниця, 14:20', () => {
  const intent = parseLocal('Як доїхати з Києва (Святошин) до Малина на вокзал', NOW).intent;
  const schedules = [
    sched({ id: 1, route: 'Kyiv-Malyn-Bucha', departureTime: '15:00', boardingPlace: 'м. Святошино' }),
    sched({ id: 2, route: 'Kyiv-Malyn', departureTime: '14:51', vehicleType: 'elektrichka', boardingPlace: 'Київ-Пас. (Приміський)', arrivalTime: '17:11', durationMinutes: 140, tripNumber: '6613', priceUah: 60, ticketPurchaseUrl: 'https://lnk.ua/x' }),
    sched({ id: 3, route: 'Kyiv-Malyn-Irpin', departureTime: '16:00', boardingPlace: 'м. Академмістечко' }),
  ];
  const p = planner({
    'st_0079>st_0019': [bus('8', 'st_0079', 'st_0019', hm(16, 24), hm(16, 26)), bus('7', 'st_0079', 'st_0019', hm(16, 28), hm(16, 33)), bus('7', 'st_0079', 'st_0019', hm(16, 41), hm(16, 46)), bus('8', 'st_0079', 'st_0019', hm(17, 24), hm(17, 26))],
    'st_0070>st_0019': [bus('8', 'st_0070', 'st_0019', hm(16, 46), hm(16, 56))],
  });
  const out = composeStories({ intent, now: NOW, date: resolveDate(intent.when.day, NOW), schedules, planner: p });

  it('дві історії — маршрутка й електричка — і питання «чим»', () => {
    expect(out.kind).toBe('stories');
    if (out.kind !== 'stories') return;
    expect(out.askMode).toBe(true);
    expect(out.stories.map((s) => s.mode)).toEqual(['marshrutka', 'elektrichka']);
  });

  it('маршрутка: вихід біля ПТЛ, автобус від найпізнішого прибуття (пʼятничний затор), раніший — як «якщо раніше»', () => {
    if (out.kind !== 'stories') throw new Error(out.kind);
    const s = out.stories[0];
    expect(kinds(s)).toEqual(['intercity', 'wait', 'bus']);
    const ic = intercity(s);
    expect(ic.boardLabel).toBe('від метро «Святошин»');
    expect([ic.alightLabel, ic.alightMins, ic.alightApprox]).toEqual(['біля ПТЛ', hm(16, 22), true]);
    expect(ic.phoneOnly).toBe(true);
    expect(ic.later).toEqual(['16:00 від метро «Академмістечко»']);
    const b = busLeg(s);
    expect([b.routeId, b.depMins]).toEqual(['7', hm(16, 41)]);
    expect(b.note).toBe('Якщо приїдете раніше — №7 о 16:28, на місці о 16:33.');
    expect([s.arriveMins, s.arriveApprox]).toEqual([hm(16, 46), false]);
    expect(s.lead).toBe('Маршрутка о 15:00 від метро «Святошин», далі автобус №7 о 16:41. Малин · вокзал — о 16:46.');
  });

  it('електричка: сідати на Святошині (≈ +25 хв від Київ-Пас.), вокзал — без пересадки, точний час', () => {
    if (out.kind !== 'stories') throw new Error(out.kind);
    const s = out.stories[1];
    expect(kinds(s)).toEqual(['intercity']);
    const ic = intercity(s);
    expect([ic.boardLabel, ic.boardMins, ic.boardApprox]).toEqual(['з платформи «Святошин»', hm(15, 16), true]);
    expect([s.arriveMins, s.arriveApprox]).toEqual([hm(17, 11), false]);
    expect(ic.ticketUrl).toBe('https://lnk.ua/x');
  });

  it('«електричкою» — лише електричка, без питання', () => {
    const only = parseLocal('електричкою з Києва (Святошин) до Малина на вокзал', NOW).intent;
    const r = composeStories({ intent: only, now: NOW, date: NOW.date, schedules, planner: p });
    expect(r.kind === 'stories' && r.stories.map((s) => s.mode)).toEqual(['elektrichka']);
    expect(r.kind === 'stories' && r.askMode).toBe(false);
  });
});

describe('Малин, Царське село → Київ — завтра зранку (субота)', () => {
  const intent = parseLocal('з Царського села до Києва завтра зранку', NOW).intent;
  const date = resolveDate(intent.when.day, NOW);
  const schedules = [
    sched({ id: 11, route: 'Malyn-Kyiv-Irpin', departureTime: '07:30', boardingPlace: 'Автостанція Малин', activeWeekdays: [1, 2, 3, 4, 5, 6] }),
    sched({ id: 12, route: 'Malyn-Kyiv-Irpin', departureTime: '08:30', boardingPlace: 'Автостанція Малин' }),
    sched({ id: 13, route: 'Malyn-Kyiv', departureTime: '09:48', vehicleType: 'elektrichka', boardingPlace: 'Малин', alightingPlace: 'Святошин', arrivalTime: '11:47', tripNumber: '6614', priceUah: 60 }),
  ];
  const p = planner({
    'st_0090>st_0049': [bus('9', 'st_0090', 'st_0049', hm(7, 9), hm(7, 16)), bus('9', 'st_0090', 'st_0049', hm(8, 34), hm(8, 41))],
    'st_0090>st_0019': [bus('9', 'st_0090', 'st_0019', hm(8, 34), hm(8, 56))],
  });
  const out = composeStories({ intent, now: NOW, date, schedules, planner: p });

  it('маршрутка 07:30: №9 до «Промінь», посадка в центрі «зазвичай» ≈07:35, із запасом ≥ 10 хв', () => {
    expect(date).toBe('2026-11-14');
    if (out.kind !== 'stories') throw new Error(out.kind);
    const s = out.stories[0];
    expect(s.mode).toBe('marshrutka');
    expect(kinds(s)).toEqual(['bus', 'wait', 'intercity', 'kyiv']);
    expect(busLeg(s).depMins).toBe(hm(7, 9));
    const ic = intercity(s);
    expect([ic.boardLabel, ic.boardMins, ic.boardApprox, ic.usual]).toEqual(['з центру, від «Промінь»', hm(7, 35), true, true]);
    expect([s.leaveMins, s.arriveMins, s.arriveApprox, s.endLabel]).toEqual([hm(7, 9), hm(9, 0), true, 'Київ, метро «Академмістечко»']);
    const k = s.legs[3] as Extract<StoryLeg, { kind: 'kyiv' }>;
    expect(k.mapsUrl).toContain('travelmode=transit');
  });

  it('електричка 6614: на вокзал №9, точний час у Святошині', () => {
    if (out.kind !== 'stories') throw new Error(out.kind);
    const s = out.stories.find((x) => x.mode === 'elektrichka')!;
    expect([s.arriveMins, s.arriveApprox, s.endLabel]).toEqual([hm(11, 47), false, 'Київ, платформа «Святошин»']);
  });
});

describe('пізно ввечері — міські автобуси вже не ходять', () => {
  it('маршрутка 20:00 до Царського села: вихід біля ПТЛ і пішки', () => {
    const intent = parseLocal('з Академмістечка до Царського села о 20:00', NOW).intent;
    const schedules = [sched({ id: 21, route: 'Kyiv-Malyn-Irpin', departureTime: '20:00', boardingPlace: 'м. Академмістечко' })];
    const out = composeStories({ intent, now: NOW, date: NOW.date, schedules, planner: planner({}) });
    if (out.kind !== 'stories') throw new Error(out.kind);
    const s = out.stories[0];
    const walk = s.legs.find((l): l is Extract<StoryLeg, { kind: 'walk' }> => l.kind === 'walk')!;
    expect(walk.late).toBe(true);
    expect(intercity(s).alightLabel).toBe('біля ПТЛ');
    expect(s.endNote).toBe('міські автобуси вже не ходять');
    expect(s.lead).toContain('Міські автобуси вже не ходять');
  });
});

describe('поїздка містом', () => {
  it('Царське село → вокзал: найближчий автобус після «зараз»', () => {
    const intent = parseLocal('автобусом з Царського села на вокзал', NOW).intent;
    const p = planner({ 'st_0090>st_0019': [bus('9', 'st_0090', 'st_0019', hm(8, 34), hm(8, 56)), bus('9', 'st_0090', 'st_0019', hm(15, 24), hm(15, 50))] });
    const out = composeStories({ intent, now: NOW, date: NOW.date, schedules: [], planner: p });
    if (out.kind !== 'stories') throw new Error(out.kind);
    expect(out.stories[0].mode).toBe('city_bus');
    expect(busLeg(out.stories[0]).depMins).toBe(hm(15, 24));
  });
});

describe('форма поїздки', () => {
  const shape = (text: string) => classify(parseLocal(text, NOW).intent);
  it('рідне місто — Малин; невідоме — питаємо; поза зоною — кажемо чесно', () => {
    expect(shape('мені в Київ на Святошин')).toMatchObject({ kind: 'from_malyn', kyivPoint: 'kyiv.sviatoshyn' });
    expect(shape('до Малина').kind).toBe('ask_from');
    expect(shape('з Житомира в Малин')).toMatchObject({ kind: 'to_malyn', far: 'Zhytomyr', kyivPoint: null });
    expect(shape('мені в Житомир завтра')).toMatchObject({ kind: 'from_malyn', far: 'Zhytomyr' });
    expect(shape('з Києва до Житомира')).toEqual({ kind: 'outside', city: 'Kyiv' });
    expect(shape('з Коростеня в Малин')).toMatchObject({ kind: 'to_malyn', far: 'Korosten', kyivPoint: null });
    expect(shape('мені в Коростень')).toMatchObject({ kind: 'from_malyn', far: 'Korosten' });
    expect(shape('з Києва до Коростеня')).toEqual({ kind: 'outside', city: 'Kyiv' });
    expect(shape('чи є попутка з Києва в Малин сьогодні')).toEqual({ kind: 'poputky', fromCity: 'Kyiv', toCity: 'Malyn' });
    expect(shape('попутка до Києва ввечері')).toEqual({ kind: 'poputky', fromCity: 'Malyn', toCity: 'Kyiv' });
    expect(shape('автобусом з Царського села на вокзал').kind).toBe('intra');
    expect(shape('з Ковалівки до Малина')).toEqual({ kind: 'unknown_place', words: ['Ковалівки'] });
    expect(shape('яка погода в Малині').kind).toBe('not_trip');
  });
});

describe('попутки, ціна, контакти', () => {
  const ask = (text: string, extra: Partial<Parameters<typeof composeStories>[0]> = {}) =>
    composeStories({ intent: parseLocal(text, NOW).intent, now: NOW, date: NOW.date, schedules: [], planner: null, ...extra });
  const listing = (over: Partial<ViberListing>): ViberListing =>
    ({ id: 1, senderName: 'Олег', listingType: 'driver', route: 'Kyiv-Malyn', date: NOW.date, departureTime: '18:00', seats: 2, notes: 'від м. Житомирська', priceUah: 250, isActive: true, createdAt: '', updatedAt: '', ...over }) as ViberListing;

  it('попутки: оголошення водіїв за часом, без телефонів; пасажирів лише рахуємо; посилання на дошку', () => {
    const out = ask('чи є попутка з Києва в Малин сьогодні', {
      listings: [
        listing({ id: 3, departureTime: '19:30', phone: '380501112233' }),
        listing({ id: 2, departureTime: '17:00', notes: null, priceUah: null, seats: null, senderName: null }),
        listing({ id: 4, listingType: 'passenger' }),
        listing({ id: 5, isActive: false }),
      ],
    });
    expect(out).toMatchObject({ kind: 'poputky', fromLabel: 'Київ', toLabel: 'Малин', more: 0, passengers: 1, boardUrl: '/mizhgorodski?type=carpool&from=Kyiv&to=Malyn&date=2026-11-13' });
    if (out.kind !== 'poputky') return;
    expect(out.rides).toEqual([
      { id: 2, time: '17:00', seats: null, priceUah: null, notes: null, name: null },
      { id: 3, time: '19:30', seats: 2, priceUah: 250, notes: 'від м. Житомирська', name: 'Олег' },
    ]);
    expect(JSON.stringify(out)).not.toContain('380501112233');
  });

  it('попуток немає — порожній список, а не вигадані рейси; понад пʼять — «ще N»', () => {
    expect(ask('попутка до Києва завтра')).toMatchObject({ kind: 'poputky', fromCity: 'Malyn', toCity: 'Kyiv', rides: [], more: 0 });
    const many = ask('попутка до Києва', { listings: Array.from({ length: 7 }, (_, i) => listing({ id: i + 1 })) });
    expect(many.kind === 'poputky' && [many.rides.length, many.more]).toEqual([5, 2]);
  });

  it('попутки на частину дня чи час: лише відповідні; якщо таких немає — усі за день з приміткою', () => {
    const listings = [listing({ id: 1, departureTime: '06:00' }), listing({ id: 2, departureTime: '08:20-08:30' }), listing({ id: 3, departureTime: '14:11' }), listing({ id: 4, departureTime: null })];
    const morning = ask('попутка до Києва завтра зранку', { listings });
    expect(morning.kind === 'poputky' && morning.rides.map((r) => r.id)).toEqual([1, 2, 4]);
    expect(morning.kind === 'poputky' && morning.notice).toBeUndefined();
    const after = ask('попутка до Києва завтра о 14:00', { listings });
    expect(after.kind === 'poputky' && after.rides.map((r) => r.id)).toEqual([3, 4]);
    const evening = ask('попутка до Києва завтра ввечері', { listings: listings.slice(0, 3) });
    expect(evening.kind === 'poputky' && [evening.rides.length, evening.notice]).toEqual([3, 'На цей час оголошень немає — ось усі за день.']);
  });

  it('ціна — лише з даних: розклад коридору й тариф міста; чого немає — так і кажемо', () => {
    const rows = [
      { vehicleType: 'marshrutka', priceUah: 310 },
      { vehicleType: 'marshrutka', priceUah: 310 },
      { vehicleType: 'elektrichka', priceUah: 60 },
      { vehicleType: 'elektrichka', priceUah: 75 },
    ] as Schedule[];
    expect(ask('скільки коштує маршрутка до Києва', { schedules: rows })).toEqual({
      kind: 'price',
      lines: [{ label: 'Маршрутка Київ ↔ Малин', price: '310 грн', note: 'за місце, в один бік' }],
    });
    const all = ask('скільки коштує проїзд', { schedules: rows, cityFare: 25 });
    expect(all.kind === 'price' && all.lines.map((l) => [l.label, l.price])).toEqual([
      ['Маршрутка Київ ↔ Малин', '310 грн'],
      ['Електричка Київ ↔ Малин', '60–75 грн'],
      ['Попутка', 'за домовленістю'],
      ['Міський автобус Малина', '25 грн'],
    ]);
    const city = ask('скільки коштує автобус з Царського села на вокзал', { schedules: rows });
    expect(city).toEqual({ kind: 'price', lines: [{ label: 'Міський автобус Малина', price: null, note: 'одна поїздка' }] });
  });

  it('«телефон зубастика» — картка контактів; ціна й контакти розклад коридору питають самі', () => {
    expect(ask('телефон зубастика')).toEqual({ kind: 'contact' });
    expect(corridorCities(classify(parseLocal('скільки коштує маршрутка до Києва', NOW).intent))).toEqual({ from: 'Malyn', to: 'Kyiv' });
    expect(corridorCities(classify(parseLocal('скільки коштує автобус з Царського села на вокзал', NOW).intent))).toBeNull();
    expect(corridorCities(classify(parseLocal('телефон зубастика', NOW).intent))).toBeNull();
  });
});

describe('попутки серед варіантів', () => {
  const ride = (s: Story) => s.legs.find((l): l is Extract<StoryLeg, { kind: 'ride' }> => l.kind === 'ride')!;
  const listing = (over: Partial<ViberListing>): ViberListing =>
    ({ id: 1, senderName: 'Олег Петренко', listingType: 'driver', route: 'Malyn-Kyiv', date: '2026-11-14', departureTime: '07:00', seats: 2, notes: null, priceUah: 250, isActive: true, createdAt: '', updatedAt: '', ...over }) as ViberListing;
  const schedules = [sched({ id: 11, route: 'Malyn-Kyiv-Irpin', departureTime: '07:30', boardingPlace: 'Автостанція Малин' })];
  const p = planner({
    'st_0090>st_0049': [bus('9', 'st_0090', 'st_0049', hm(6, 40), hm(6, 47)), bus('9', 'st_0090', 'st_0049', hm(7, 9), hm(7, 16))],
    'st_0070>st_0019': [bus('8', 'st_0070', 'st_0019', hm(20, 0), hm(20, 10))],
  });
  const notePlaces = (note: string, dir: 'from_malyn' | 'to_malyn') => placesInNote(note, [], dir);
  const ask = (text: string, listings: ViberListing[], extra: Partial<Parameters<typeof composeStories>[0]> = {}) => {
    const intent = parseLocal(text, NOW).intent;
    const out = composeStories({ intent, now: NOW, date: resolveDate(intent.when.day, NOW), schedules, planner: p, listings, notePlaces, ...extra });
    if (out.kind !== 'stories') throw new Error(out.kind);
    return out;
  };

  it('транспорт не названо — попутка стає варіантом поруч із маршруткою; прибуття = виїзд + 1 год 35 хв, завжди «≈»', () => {
    const out = ask('з Малина до Києва завтра зранку', [listing({ id: 7 }), listing({ id: 8, listingType: 'passenger' }), listing({ id: 9, departureTime: null })]);
    expect(out.stories.map((s) => s.mode).sort()).toEqual(['marshrutka', 'poputka']);
    expect(out.askMode).toBe(true);
    const s = out.stories.find((x) => x.mode === 'poputka')!;
    expect(s.id).toBe('ride-7');
    expect([s.leaveMins, s.arriveMins, s.arriveApprox]).toEqual([hm(7, 0), hm(8, 35), true]);
    expect(ride(s)).toMatchObject({ depMins: hm(7, 0), arrMins: hm(8, 35), driveMinutes: 95, traffic: false, boardAssumed: true, alightAssumed: true });
    expect(ride(s).boardLabel).toBe('з центру, від «Промінь»');
    expect(s.priceUah).toBe(250);
    expect(s.lead).toBe('Попутка о 07:00 з центру, від «Промінь». Київ — приблизно о 08:35.');
    // оголошення без часу у варіанти не йде — лише в «ще N на дошці»; пасажирів не рахуємо
    expect(out.rides).toEqual({ more: 1, boardUrl: '/mizhgorodski?type=carpool&from=Malyn&to=Kyiv&date=2026-11-14', traffic: false });
  });

  it('час із заторами приходить ззовні й позначається; без нього — сталий', () => {
    const out = ask('з Малина до Києва завтра зранку', [listing({ id: 7 })], { driveMinutes: (dep) => ({ minutes: dep === hm(7, 0) ? 112 : 95, traffic: true }) });
    const s = out.stories.find((x) => x.mode === 'poputka')!;
    expect(s.arriveMins).toBe(hm(8, 52));
    expect(ride(s).traffic).toBe(true);
    expect(out.rides?.traffic).toBe(true);
  });

  it('до посадки в центрі — міським автобусом, бути за 5 хв до виїзду водія', () => {
    const out = ask('з Царського села до Києва завтра зранку', [listing({ id: 7 })]);
    const s = out.stories.find((x) => x.mode === 'poputka')!;
    expect(kinds(s)).toEqual(['bus', 'wait', 'ride']);
    expect(busLeg(s)).toMatchObject({ routeId: '9', depMins: hm(6, 40), arrMins: hm(6, 47) });
    expect(s.leaveMins).toBe(hm(6, 40));
    expect(s.legs[1]).toEqual({ kind: 'wait', text: 'Будьте на місці о 06:55 — водій виїжджає о 07:00.' });
  });

  it('місця з примітки водія: посадка в Малині й точка в Києві з підказкою метро', () => {
    const out = ask('з Малина до Житомирської завтра зранку', [listing({ id: 7, notes: 'заберу з вокзалу, їду до Академмістечка' })]);
    const s = out.stories.find((x) => x.mode === 'poputka')!;
    expect(ride(s)).toMatchObject({ boardAssumed: false, alightAssumed: false, alightLabel: 'біля метро «Академмістечко»' });
    expect(ride(s).boardLabel).toContain('вокзал');
    // просили «Житомирську» — кінець історії там: висадка 08:35 + метро (1 перегін, очікування, вхід і вихід ≈ 10 хв)
    expect(s.endLabel).toBe('Київ, метро «Житомирська»');
    expect(s.arriveMins).toBe(hm(8, 45));
    expect(s.endNote).toBeNull();
    const m = s.legs[s.legs.length - 1] as Extract<StoryLeg, { kind: 'metro' }>;
    expect(m.kind).toBe('metro');
    expect([m.segments[0].from.name, m.segments[0].to.name, m.segments[0].hops, m.depMins, m.arrMins]).toEqual(['Академмістечко', 'Житомирська', 1, hm(8, 35), hm(8, 45)]);
  });

  it('«заберу по місту» — без дороги до центру; київську точку не названо — «зазвичай Академмістечко»', () => {
    const out = ask('з Царського села до Києва завтра зранку', [listing({ id: 7, notes: 'Є місця; Заберу по місту' })]);
    const s = out.stories.find((x) => x.mode === 'poputka')!;
    expect(kinds(s)).toEqual(['ride']);
    expect(s.leaveMins).toBe(hm(7, 0));
    expect(ride(s)).toMatchObject({ boardLabel: 'по місту — домовтесь, де сісти', boardAssumed: false, alightLabel: 'у Києві, зазвичай біля метро «Академмістечко»', alightAssumed: true });
  });

  it('«до вокзалу» в оголошенні з Малина — це київський вокзал, а посадка лишається в центрі', () => {
    const out = ask('з Малина до Києва завтра зранку', [listing({ id: 7, notes: 'до вокзалу' })]);
    const s = out.stories.find((x) => x.mode === 'poputka')!;
    expect(ride(s)).toMatchObject({ boardAssumed: true, alightAssumed: false, alightLabel: 'біля вокзалу Київ-Пасажирський' });
  });

  it('«бути до» — лише попутки, що встигають із запасом 10 хв; найпізніша перша', () => {
    const list = [listing({ id: 1, departureTime: '06:00' }), listing({ id: 2, departureTime: '07:00' }), listing({ id: 3, departureTime: '07:30' })];
    const out = ask('з Малина до Києва завтра бути до 9:00', list);
    // 07:30 + 95 + 10 = 09:15 — не встигає
    expect(out.stories.filter((s) => s.mode === 'poputka').map((s) => s.id)).toEqual(['ride-1', 'ride-2']);
    expect(rideDepartures({ intent: parseLocal('з Малина до Києва завтра бути до 9:00', NOW).intent, now: NOW, date: '2026-11-14', listings: list })).toEqual(['07:30', '07:00', '06:00']);
  });

  it('не більше трьох варіантів, решта — «ще N»; частина дня відсікає вечірні', () => {
    const list = ['06:00', '06:30', '07:00', '08:00', '19:00'].map((t, i) => listing({ id: i + 1, departureTime: t }));
    const out = ask('з Малина до Києва завтра зранку', list);
    expect(out.stories.filter((s) => s.mode === 'poputka').map((s) => s.id)).toEqual(['ride-1', 'ride-2', 'ride-3']);
    expect(out.rides?.more).toBe(2);
  });

  it('названо лише маршрутку — попуток немає; «попутка» сама — дошка; разом — обидва без питання', () => {
    expect(ask('з Малина до Києва завтра зранку маршруткою', [listing({ id: 7 })]).stories.map((s) => s.mode)).toEqual(['marshrutka']);
    expect(ridesWanted([])).toBe(true);
    expect(ridesWanted(['poputka'])).toBe(false);
    expect(ridesWanted(['marshrutka'])).toBe(false);
    expect(ridesWanted(['marshrutka', 'poputka'])).toBe(true);
    const intent = parseLocal('попутка з Малина до Києва завтра', NOW).intent;
    expect(composeStories({ intent, now: NOW, date: '2026-11-14', schedules, planner: p, listings: [listing({ id: 7 })] }).kind).toBe('poputky');
  });

  it('з Києва в Малин: висадка в центрі, далі містом від найпізнішого прибуття; без розкладу — самі попутки', () => {
    const intent = parseLocal('з Києва до Малина на вокзал завтра ввечері', NOW).intent;
    const out = composeStories({
      intent,
      now: NOW,
      date: '2026-11-14',
      schedules: [],
      planner: p,
      notePlaces,
      listings: [listing({ id: 5, route: 'Kyiv-Malyn', departureTime: '18:00-18:30', notes: 'від м. Житомирська' })],
    });
    if (out.kind !== 'stories') throw new Error(out.kind);
    const s = out.stories[0];
    expect(out.askMode).toBe(false);
    expect(kinds(s)).toEqual(['ride', 'wait', 'bus']);
    expect(ride(s)).toMatchObject({ boardLabel: 'від метро «Житомирська»', boardAssumed: false, alightLabel: 'у центрі, біля РБК', alightAssumed: true, arrMins: hm(19, 35) });
    // автобус — після 19:35 + 10 хв запізнення + 3 хв на пересадку
    expect(busLeg(s).depMins).toBe(hm(20, 0));
    expect([s.arriveMins, s.arriveApprox]).toEqual([hm(20, 10), true]);
  });

  it('автобуси вже не ходять, а пішки далеко — не женемо пішки, а радимо попросити водія довезти', () => {
    const intent = parseLocal('з Києва до Малина на вокзал завтра ввечері', NOW).intent;
    const out = composeStories({ intent, now: NOW, date: '2026-11-14', schedules: [], planner: planner({}), listings: [listing({ id: 5, route: 'Kyiv-Malyn', departureTime: '21:00' })] });
    if (out.kind !== 'stories') throw new Error(out.kind);
    expect(kinds(out.stories[0])).toEqual(['ride']);
    expect(out.stories[0].arriveMins).toBe(hm(22, 35));
    expect(out.stories[0].endNote).toBe('міські автобуси вже не ходять — попросіть водія довезти до місця');
  });
});

describe('кінцева точка в Києві — та, яку просили', () => {
  const schedules = [sched({ id: 21, route: 'Malyn-Kyiv-Bucha', departureTime: '07:30', boardingPlace: 'Автостанція Малин', alightingPlace: 'м. Святошино' })];
  const story = (text: string, s = schedules) => {
    const intent = parseLocal(text, NOW).intent;
    const out = composeStories({ intent, now: NOW, date: resolveDate(intent.when.day, NOW), schedules: s, planner: null });
    if (out.kind !== 'stories') throw new Error(out.kind);
    return out.stories[0];
  };

  it('«до Києва вокзал» маршруткою до Святошина: кінець — вокзал, час = висадка + метро (5 перегонів + вхід і вихід)', () => {
    const s = story('з малина до вокзалу в києві завтра маршруткою');
    const ic = intercity(s);
    // рядок маршрутки лишає свою висадку
    expect([ic.alightLabel, ic.alightMins]).toEqual(['біля метро «Святошин»', hm(9, 0)]);
    const m = s.legs[s.legs.length - 1] as Extract<StoryLeg, { kind: 'metro' }>;
    expect(m).toMatchObject({ kind: 'metro', minutes: 20, depMins: hm(9, 0), arrMins: hm(9, 20), priceUah: 30, closed: false });
    expect(m.segments[0].towards.name).toBe('Лісова');
    expect([s.endLabel, s.arriveMins, s.arriveApprox]).toEqual(['Київ, вокзал Київ-Пасажирський', hm(9, 20), true]);
    expect(s.lead).toBe('Маршрутка о 07:30 з автостанції, далі метро до «Вокзальна». Київ, вокзал Київ-Пасажирський — приблизно о 09:20.');
  });

  it('будь-яка станція з пересадкою: «на Позняки» — через «Палац спорту»', () => {
    const s = story('з малина на позняки завтра маршруткою');
    const m = s.legs[s.legs.length - 1] as Extract<StoryLeg, { kind: 'metro' }>;
    expect(m.transfers.map((t) => [t.from.name, t.to.name])).toEqual([['Театральна', 'Золоті ворота']]);
    // за «Видубичами» зараз автобус замість метро
    expect(m.segments.map((x) => [x.line, x.to.name, x.bus])).toEqual([['M1', 'Театральна', null], ['M3', 'Видубичі', null], ['M3', 'Позняки', '318']]);
    expect(s.endLabel).toBe('Київ, метро «Позняки»');
    expect(s.arriveMins).toBeGreaterThan(hm(9, 30));
    // текст не видає автобус-замінник за метро
    expect(s.lead).toContain('далі метро до «Видубичі», далі автобус №318 замість метро до «Позняки».');
    expect(shareText(s, (id) => id, 'Як доїхати')).toContain('пересадка «Театральна» → «Золоті ворота», від «Видубичі» до «Позняки» — автобус №318 замість метро, ≈ ');
  });

  it('електричкою до Борщагівки й далі на Позняки: міська електричка до «Видубичів», а звідти — автобус замість метро, так і сказано', () => {
    const train = [sched({ id: 59, route: 'Malyn-Kyiv', vehicleType: 'elektrichka', departureTime: '06:58', arrivalTime: '09:06', boardingPlace: 'Малин', alightingPlace: 'Борщагівка', tripNumber: '6610', priceUah: 60 })];
    // середа 18.11.2026 — як у зверненні власника
    const now = { date: '2026-11-17', mins: hm(17, 0) };
    const intent = parseLocal('з малина на позняки електричкою завтра', now).intent;
    const out = composeStories({ intent, now, date: '2026-11-18', schedules: train, planner: null });
    if (out.kind !== 'stories') throw new Error(out.kind);
    const s = out.stories[0];
    expect(kinds(s)).toEqual(['intercity', 'ring', 'metro']);
    const m = s.legs[2] as Extract<StoryLeg, { kind: 'metro' }>;
    expect(m.segments.map((x) => [x.from.name, x.to.name, x.bus])).toEqual([['Видубичі', 'Позняки', '318']]);
    expect(s.lead).toBe('Електричка 6610 о 06:58 з вокзалу, далі міська електричка Б09 о 09:15 з платформи «Борщагівка», далі автобус №318 замість метро до «Позняки». Київ, метро «Позняки» — приблизно о 10:09.');
    expect(shareText(s, (id) => id, 'Як доїхати')).toContain('— автобус №318 замість метро «Видубичі» → «Позняки», ≈ 19 хв');
  });

  it('точка не на метро, але на кільці міської електрички: далі — рейс за розкладом, час точний', () => {
    const s = story('з малина до борщагівки завтра маршруткою');
    expect(s.endLabel).toBe('Київ, платформа «Борщагівка»');
    // маршрутка ≈ 09:00 біля метро «Святошин»; запас на приблизне прибуття, 4 хв до платформи, 4 хв на посадку → Б10 о 09:38
    const r = s.legs[s.legs.length - 1] as Extract<StoryLeg, { kind: 'ring' }>;
    expect(r).toMatchObject({ kind: 'ring', depMins: hm(9, 38), arrMins: hm(9, 45), walkBeforeMin: 4, walkAfterMin: 0, priceUah: 30 });
    expect([r.ride.train, r.ride.dir]).toEqual(['Б10', 'ccw']);
    expect([s.arriveMins, s.arriveApprox, s.endNote]).toEqual([hm(9, 45), false, null]);
    expect(s.lead).toBe('Маршрутка о 07:30 з автостанції, далі міська електричка Б10 о 09:38 з платформи «Святошин». Київ, платформа «Борщагівка» — о 09:45.');
  });

  it('у зворотний бік історія починається з метро: вийти раніше на час дороги до посадки', () => {
    const back = [sched({ id: 22, route: 'Kyiv-Malyn-Bucha', departureTime: '15:00', boardingPlace: 'м. Святошино' })];
    const s = story('з лівобережної в малин сьогодні маршруткою', back);
    expect(kinds(s)[0]).toBe('metro');
    const ic = intercity(s);
    expect(ic.boardMins).toBe(hm(15, 0));
    // Лівобережна → Святошин: 12 перегонів × 158 с + очікування 180 с + вхід і вихід 240 с ≈ 39 хв
    expect(s.leaveMins).toBe(hm(14, 21));
    const m = s.legs[0] as Extract<StoryLeg, { kind: 'metro' }>;
    expect([m.depMins, m.arrMins, m.segments[0].towards.name]).toEqual([hm(14, 21), hm(15, 0), 'Академмістечко']);
  });
});

describe('центр Малина: висадка біля РБК, посадка від «Промінь»', () => {
  it('з Києва «в Малин» — маршрутка довозить до центру: зупинка біля РБК', () => {
    const intent = parseLocal('з Києва в Малин сьогодні маршруткою', NOW).intent;
    const out = composeStories({ intent, now: NOW, date: NOW.date, schedules: [sched({ id: 31, route: 'Kyiv-Malyn-Irpin', departureTime: '16:00', boardingPlace: 'м. Академмістечко' })], planner: null });
    if (out.kind !== 'stories') throw new Error(out.kind);
    expect(intercity(out.stories[0]).alightLabel).toBe('у центрі, біля РБК');
    expect(out.stories[0].endLabel).toBe('Малин, Центр, пл. Соборна (РБК)');
  });

  it('з Малина в Київ — посадка в центрі лишається від «Промінь»', () => {
    const intent = parseLocal('з центру до Києва завтра зранку маршруткою', NOW).intent;
    const out = composeStories({ intent, now: NOW, date: '2026-11-14', schedules: [sched({ id: 32, route: 'Malyn-Kyiv-Irpin', departureTime: '07:30', boardingPlace: 'Автостанція Малин' })], planner: planner({}) });
    if (out.kind !== 'stories') throw new Error(out.kind);
    expect(intercity(out.stories[0]).boardLabel).toBe('з центру, від «Промінь»');
  });
});

describe('метро поза годинами роботи', () => {
  it('пізня маршрутка: метро вже зачинене — час лишається до висадки, і про це сказано', () => {
    const intent = parseLocal('з малина до вокзалу в києві завтра маршруткою', NOW).intent;
    const out = composeStories({ intent, now: NOW, date: '2026-11-14', schedules: [sched({ id: 41, route: 'Malyn-Kyiv-Bucha', departureTime: '21:20', boardingPlace: 'Автостанція Малин', alightingPlace: 'м. Святошино' })], planner: null });
    if (out.kind !== 'stories') throw new Error(out.kind);
    const s = out.stories[0];
    const m = s.legs[s.legs.length - 1] as Extract<StoryLeg, { kind: 'metro' }>;
    expect(m.closed).toBe(true);
    // висадка 22:50 — до закриття о 23:00 доїхати не встигнути
    expect([s.arriveMins, s.endLabel]).toEqual([hm(22, 50), 'Київ, вокзал Київ-Пасажирський']);
    expect(s.endNote).toBe('метро о цій порі не працює (05:30–23:00); час — до висадки біля метро «Святошин»');
  });
});

describe('Житомир ↔ Малин — між містами', () => {
  const ZT = 'Автовокзал Житомир-1 (вул. Київська, 93)';
  const toMalyn = [
    sched({ id: 51, route: 'Zhytomyr-Malyn', departureTime: '15:50', arrivalTime: '17:15', boardingPlace: ZT, priceUah: 287 }),
    sched({ id: 52, route: 'Zhytomyr-Malyn', departureTime: '16:30', arrivalTime: '18:40', boardingPlace: `${ZT}; транзит з Вінниці`, priceUah: 299 }),
    sched({ id: 53, route: 'Zhytomyr-Bazar-Potiivka-Malyn', departureTime: '14:30', arrivalTime: '16:59', boardingPlace: `${ZT}; через Малин ≈ 16:15`, priceUah: null }),
  ];
  const fromMalyn = [
    sched({ id: 61, route: 'Malyn-Zhytomyr-Potiivka', departureTime: '06:50', boardingPlace: 'Автостанція Малин', priceUah: null }),
    sched({ id: 62, route: 'Malyn-Zhytomyr-Radomyshl', departureTime: '06:30', boardingPlace: 'Автостанція Малин', priceUah: null }),
    sched({ id: 63, route: 'Malyn-Khmilnyk-Zhytomyr', departureTime: '05:20', boardingPlace: 'Автостанція Малин', priceUah: null }),
  ];
  const p = planner({
    'st_0004>st_0019': [bus('8', 'st_0004', 'st_0019', hm(17, 30), hm(17, 42))],
    'st_0090>st_0004': [bus('9', 'st_0090', 'st_0004', hm(6, 20), hm(6, 32))],
  });
  const run = (text: string, schedules: Schedule[], extra: Partial<Parameters<typeof composeStories>[0]> = {}) => {
    const intent = parseLocal(text, NOW).intent;
    const out = composeStories({ intent, now: NOW, date: resolveDate(intent.when.day, NOW), schedules, planner: p, ...extra });
    if (out.kind !== 'stories') throw new Error(out.kind);
    return out;
  };

  describe('містом до місця, названого словами', () => {
    const cityLeg = (st: Story) => st.legs.find((l): l is Extract<StoryLeg, { kind: 'city' }> => l.kind === 'city')!;
    const route: CityRoute = {
      source: 'google',
      fromLabel: 'автовокзал Житомир-1',
      toLabel: 'Польова 12',
      minutes: 21,
      fetchedAt: '2026-11-13T10:00:00.000Z',
      steps: [
        { kind: 'walk', minutes: 3, meters: 190 },
        { kind: 'transit', minutes: 14, mode: 'BUS', line: '110', fromStop: 'Автовокзал', toStop: 'Агротехнічний коледж', stops: 6 },
        { kind: 'walk', minutes: 1, meters: 50 },
      ],
    };

    it('з Малина: відповіді сервера ще немає — крок із кнопкою Google Maps, час до висадки, і список «що спитати»', () => {
      const out = run('з Малина в Житомир на Польову 12 завтра зранку', fromMalyn.slice(0, 1));
      const st = out.stories[0];
      const leg = cityLeg(st);
      const ic = intercity(st);
      expect(kinds(st).at(-1)).toBe('city');
      expect(leg.route).toBeNull();
      expect(leg.ask).toMatchObject({ city: 'Zhytomyr', from: 'zhytomyr.avtovokzal', to: 'Польова 12', date: '2026-11-14' });
      expect(leg.ask.time).toMatch(/^\d\d:\d0$/);
      expect(leg.mapsUrl).toContain(encodeURIComponent('Польова 12, Житомир').replace(/%20/g, '+'));
      expect(st.arriveMins).toBe(ic.alightMins);
      expect(st.endLabel).toBe('Житомир, Польова 12');
      expect(st.endNote).toContain('час — до висадки');
      expect(st.toLabel).toBe('Житомир, Польова 12');
      expect(cityAsks(out)).toEqual([leg.ask]);
      // спитали, відповіді немає — удруге не питаємо
      expect(cityAsks(out, new Map([[cityAskKey(leg.ask), null]]))).toEqual([]);
    });

    it('з Малина: відповідь є — історія закінчується на місці, час прибуття з хвилинами міста, завжди «≈»', () => {
      const first = run('з Малина в Житомир на Польову 12 завтра зранку', fromMalyn.slice(0, 1));
      const ask = cityLeg(first.stories[0]).ask;
      const out = run('з Малина в Житомир на Польову 12 завтра зранку', fromMalyn.slice(0, 1), { cityRoutes: new Map([[cityAskKey(ask), route]]) });
      const st = out.stories[0];
      const leg = cityLeg(st);
      const ic = intercity(st);
      expect(leg.route).toBe(route);
      expect(leg.depMins).toBe(ic.alightMins);
      expect(leg.arrMins).toBe(ic.alightMins + 21);
      expect(st.arriveMins).toBe(ic.alightMins + 21);
      expect(st.arriveApprox).toBe(true);
      expect(st.endNote).toBeNull();
      expect(st.transfers).toBe(1);
      expect(st.lead).toContain('автобус 110');
      expect(cityAsks(out)).toEqual([]);
      expect(shareText(st, (id) => id, 'x')).toContain('автобус 110: «Автовокзал» → «Агротехнічний коледж», ≈ 14 хв');
    });

    it('з Житомира: спершу містом до автовокзалу — вийти на 7 хв раніше за дорогу містом', () => {
      const q = 'з Житомира з вулиці Покровської в Малин сьогодні';
      const first = run(q, toMalyn.slice(0, 1));
      const ask = cityLeg(first.stories[0]).ask;
      expect(kinds(first.stories[0])[0]).toBe('city');
      // 15:50 − 7 хв запасу − 40 хв «на дорогу» → питаємо на 15:00
      expect(ask).toEqual({ city: 'Zhytomyr', from: 'вулиця Покровська', to: 'zhytomyr.avtovokzal', date: '2026-11-13', time: '15:00' });
      expect(first.stories[0].leaveMins).toBe(hm(15, 50));
      const out = run(q, toMalyn.slice(0, 1), { cityRoutes: new Map([[cityAskKey(ask), route]]) });
      const st = out.stories[0];
      expect(st.leaveMins).toBe(hm(15, 50) - 7 - 21);
      expect(cityLeg(st)).toMatchObject({ depMins: hm(15, 50) - 7 - 21, arrMins: hm(15, 50) - 7 });
      expect(st.fromLabel).toBe('Житомир, вулиця Покровська');
    });

    it('Київ: місце словами — від точки висадки рейсу; назване метро лишається метро', () => {
      const kyiv = [sched({ id: 71, route: 'Malyn-Kyiv', departureTime: '15:00', arrivalTime: '17:00', alightingPlace: 'м. Академмістечко' })];
      const out = run('з Малина до Києва до Охматдиту сьогодні', kyiv);
      const leg = cityLeg(out.stories[0]);
      expect(leg.ask).toMatchObject({ city: 'Kyiv', to: 'Охматдиту' });
      expect(leg.ask.from).toMatch(/^kyiv\./);
      const metro = run('з Малина в Київ на Хрещатик сьогодні', kyiv);
      expect(kinds(metro.stories[0])).not.toContain('city');
    });
  });

  it('з Житомира в Малин: посадка на автовокзалі, прибуття з розкладу, далі містом від автостанції', () => {
    const out = run('з Житомира в Малин на вокзал сьогодні', toMalyn.slice(0, 2));
    const s = out.stories[0];
    expect(out.askMode).toBe(false);
    const ic = intercity(s);
    expect([ic.routeLabel, ic.boardLabel, ic.boardMins, ic.alightLabel, ic.alightMins, ic.alightApprox]).toEqual(['Житомир — Малин', 'від автовокзалу Житомир-1', hm(15, 50), 'на автостанції', hm(17, 15), false]);
    expect(ic.phoneOnly).toBe(false);
    expect(kinds(s)).toEqual(['intercity', 'wait', 'bus']);
    expect(busLeg(s)).toMatchObject({ routeId: '8', depMins: hm(17, 30) });
    expect([s.fromLabel, s.arriveMins, s.priceUah]).toEqual(['Житомир', hm(17, 42), 287]);
    // наступний рейс — у «Інші рейси»
    expect(ic.later).toEqual(['16:30 від автовокзалу Житомир-1']);
  });

  it('транзитний рейс на Базар: час у Малині — з тексту «через Малин ≈ …», завжди приблизний', () => {
    const out = run('з Житомира в Малин сьогодні', [toMalyn[2]]);
    const ic = intercity(out.stories[0]);
    expect([ic.alightMins, ic.alightApprox, ic.via, ic.transit]).toEqual([hm(16, 15), true, 'через Потіївку', 'їде далі на Базар']);
    expect(out.stories[0].endLabel).toBe('Малин, Автостанція');
  });

  it('з Малина до Житомира: часу прибуття в розкладі немає — оцінка за шляхом, «≈»; кінець — автовокзал', () => {
    const out = run('з Малина до Житомира завтра зранку', [fromMalyn[0]]);
    const s = out.stories[0];
    const ic = intercity(s);
    expect([ic.routeLabel, ic.boardLabel, ic.via, ic.alightLabel, ic.alightApprox]).toEqual(['Малин — Житомир', 'з автостанції', 'через Потіївку', 'на автовокзалі Житомир-1', true]);
    // через Потіївку ≈ 1 год 30 хв
    expect([ic.boardMins, ic.alightMins]).toEqual([hm(6, 50), hm(8, 20)]);
    expect([s.endLabel, s.arriveApprox, s.priceUah]).toEqual(['Житомир, автовокзал Житомир-1', true, null]);
    const last = s.legs[s.legs.length - 1];
    expect(last).toMatchObject({ kind: 'kyiv', city: 'Житомир', text: 'Далі по Житомиру' });
  });

  it('шлях міняє оцінку: через Радомишль довше; транзитний на Хмільник — «транзит на Хмільник»', () => {
    const radomyshl = intercity(run('з Малина до Житомира завтра зранку', [fromMalyn[1]]).stories[0]);
    expect([radomyshl.via, radomyshl.alightMins - radomyshl.boardMins]).toEqual(['через Радомишль', 135]);
    const transit = intercity(run('з Малина до Житомира завтра зранку', [fromMalyn[2]]).stories[0]);
    expect([transit.transit, transit.alightMins - transit.boardMins]).toEqual(['транзит на Хмільник', 100]);
  });

  it('вийти раніше: до місця на шляху автобуса — біля РБК чи за мостом, з поміткою «зазвичай»', () => {
    const p2 = planner({
      'st_0004>st_0019': [bus('10', 'st_0004', 'st_0019', hm(17, 50), hm(18, 5))],
      // від РБК №11/1 їде раніше, ніж від автостанції
      'st_0070>st_0019': [bus('11', 'st_0070', 'st_0019', hm(17, 20), hm(17, 34))],
    });
    const intent = parseLocal('з Житомира в Малин на вокзал сьогодні', NOW).intent;
    const out = composeStories({ intent, now: NOW, date: NOW.date, schedules: toMalyn.slice(0, 1), planner: p2 });
    if (out.kind !== 'stories') throw new Error(out.kind);
    const s = out.stories[0];
    const ic = intercity(s);
    // на автостанцію 17:15 → біля РБК на 3 хв раніше
    expect([ic.alightLabel, ic.alightMins, ic.usual]).toEqual(['у центрі, біля РБК', hm(17, 12), true]);
    expect(busLeg(s)).toMatchObject({ routeId: '11', depMins: hm(17, 20) });
    expect(s.arriveMins).toBe(hm(17, 34));
  });

  it('з району Малина: міським автобусом до автостанції із запасом 10 хв', () => {
    const s = run('з Царського села до Житомира завтра зранку', [fromMalyn[0]]).stories[0];
    expect(kinds(s).slice(0, 3)).toEqual(['bus', 'wait', 'intercity']);
    expect([busLeg(s).depMins, s.leaveMins]).toEqual([hm(6, 20), hm(6, 20)]);
  });

  it('попутка на Житомир: сталий час авто 1 год 30 хв, місце в Житомирі — «уточніть»; київських підказок немає', () => {
    const listing = { id: 9, senderName: 'Ігор', listingType: 'driver', route: 'Malyn-Zhytomyr', date: '2026-11-14', departureTime: '07:00', seats: 2, notes: 'до Академмістечка не їду', priceUah: 200, isActive: true, createdAt: '', updatedAt: '' } as ViberListing;
    const out = run('з Малина до Житомира завтра зранку', [fromMalyn[0]], { listings: [listing], notePlaces: (note, dir) => placesInNote(note, [], dir) });
    const s = out.stories.find((x) => x.mode === 'poputka')!;
    const r = s.legs.find((l): l is Extract<StoryLeg, { kind: 'ride' }> => l.kind === 'ride')!;
    expect([r.depMins, r.arrMins, r.alightLabel, r.alightAssumed]).toEqual([hm(7, 0), hm(8, 30), 'у Житомирі', true]);
    expect(s.endLabel).toBe('Житомир');
    expect(out.rides?.boardUrl).toBe('/mizhgorodski?type=carpool&from=Malyn&to=Zhytomyr&date=2026-11-14');
  });

  it('ціна на Житомир — з розкладу рейсів з Житомира; електрички немає', () => {
    const intent = parseLocal('скільки коштує до Житомира', NOW).intent;
    const shapeOf = classify(intent);
    expect(shapeOf).toMatchObject({ kind: 'price', far: 'Zhytomyr' });
    expect(corridorCities(shapeOf)).toEqual({ from: 'Zhytomyr', to: 'Malyn' });
    const out = composeStories({ intent, now: NOW, date: NOW.date, schedules: toMalyn, planner: null });
    if (out.kind !== 'price') throw new Error(out.kind);
    expect(out.lines.map((l) => [l.label, l.price])).toContainEqual(['Маршрутка Житомир ↔ Малин', '287–299 грн']);
    expect(out.lines.some((l) => l.label.startsWith('Електричка'))).toBe(false);
  });
});

describe('Коростень ↔ Малин — від дверей до дверей (етап 3)', () => {
  // розклад сайту: між містами лише електрички; 20:48 — без часу прибуття
  const fromMalyn = [
    sched({ id: 71, route: 'Malyn-Korosten', departureTime: '17:13', arrivalTime: '18:20', durationMinutes: 67, vehicleType: 'elektrichka', boardingPlace: 'Малин', alightingPlace: 'Коростень', tripNumber: '6613', priceUah: 35 }),
    sched({ id: 72, route: 'Malyn-Korosten', departureTime: '20:48', vehicleType: 'elektrichka', boardingPlace: 'Малин', alightingPlace: 'Коростень', tripNumber: '6621', priceUah: 35 }),
  ];
  const toMalyn = [
    sched({ id: 81, route: 'Korosten-Malyn', departureTime: '18:25', arrivalTime: '19:31', durationMinutes: 66, vehicleType: 'elektrichka', boardingPlace: 'Коростень', alightingPlace: 'Малин', tripNumber: '6626', priceUah: 35 }),
  ];
  const malynP = planner({
    'st_0064>st_0019': [bus('5', 'st_0064', 'st_0019', hm(16, 40), hm(16, 55))],
    'st_0019>st_0090': [bus('9', 'st_0019', 'st_0090', hm(19, 40), hm(19, 50))],
  });
  const K_NAMES: Record<string, string> = { st_1001: 'Залізничний вокзал', st_1079: 'Міськлікарня' };
  const kp = (table: Record<string, Journey[]>): LocalPlanner => ({ ...planner(table), stopName: (id) => K_NAMES[id] ?? id, stopCoords: () => null });
  const korostenP = kp({
    'st_1001>st_1079': [bus('2', 'st_1001', 'st_1079', hm(18, 21), hm(18, 30)), bus('2', 'st_1001', 'st_1079', hm(18, 25), hm(18, 37))],
    'st_1079>st_1001': [bus('2', 'st_1079', 'st_1001', hm(17, 50), hm(18, 2)), bus('2', 'st_1079', 'st_1001', hm(18, 5), hm(18, 17))],
  });
  const farStop = (d: string) => (d === 'Міськлікарня' ? 'st_1079' : d === 'вокзал' ? 'st_1001' : null);
  const run = (text: string, detail: { from?: string; to?: string }, schedules: Schedule[], extra: Partial<Parameters<typeof composeStories>[0]> = {}) => {
    const parsed = parseLocal(text, NOW).intent;
    const intent = {
      ...parsed,
      from: parsed.from && detail.from ? { ...parsed.from, detail: detail.from } : parsed.from,
      to: parsed.to && detail.to ? { ...parsed.to, detail: detail.to } : parsed.to,
      modes: ['elektrichka' as const],
    };
    return composeStories({ intent, now: NOW, date: NOW.date, schedules, planner: malynP, farPlanner: korostenP, farStop, ...extra });
  };
  const stories = (out: ReturnType<typeof composeStories>) => {
    if (out.kind !== 'stories') throw new Error(out.kind);
    return out.stories;
  };
  const buses = (s: Story) => s.legs.filter((l): l is Extract<StoryLeg, { kind: 'bus' }> => l.kind === 'bus');

  it('Паперова фабрика → міськлікарня: автобус Малина до вокзалу, електричка, автобус Коростеня від вокзалу', () => {
    const [s] = stories(run('з Паперової фабрики в Коростень', { to: 'Міськлікарня' }, fromMalyn));
    expect(kinds(s)).toEqual(['bus', 'wait', 'intercity', 'wait', 'bus']);
    const [m, k] = buses(s);
    expect([m.routeId, m.city, m.depMins]).toEqual(['5', undefined, hm(16, 40)]);
    // з електрички о 18:20 + 3 хв запасу — на автобус 18:25, а не 18:21
    expect([k.routeId, k.city, k.fromName, k.toName, k.depMins]).toEqual(['2', 'Korosten', 'Залізничний вокзал', 'Міськлікарня', hm(18, 25)]);
    const ic = intercity(s);
    expect([ic.routeLabel, ic.alightLabel, ic.alightMins, ic.alightApprox, ic.priceUah]).toEqual(['Малин — Коростень', 'на вокзалі Коростеня', hm(18, 20), false, 35]);
    expect(s.legs[3]).toEqual({ kind: 'wait', text: 'Вийдіть на вокзалі Коростеня (18:20) і пересядьте на міський автобус Коростеня.' });
    expect([s.arriveMins, s.arriveApprox, s.endLabel, s.toLabel]).toEqual([hm(18, 37), false, 'Коростень, Міськлікарня', 'Коростень, Міськлікарня']);
  });

  it('міськлікарня → Царське село: до вокзалу Коростеня з запасом 7 хв, електричка, автобус Малина', () => {
    const [s] = stories(run('з Коростеня до Царського села', { from: 'Міськлікарня' }, toMalyn));
    expect(kinds(s)).toEqual(['bus', 'wait', 'intercity', 'wait', 'bus']);
    const [k, m] = buses(s);
    // електричка о 18:25 — бути на вокзалі до 18:18: автобус 18:05 → 18:17, а не 17:50
    expect([k.city, k.depMins, k.arrMins]).toEqual(['Korosten', hm(18, 5), hm(18, 17)]);
    expect(s.legs[1]).toEqual({ kind: 'wait', text: 'Чекайте на вокзалі Коростеня: до відправлення 8 хв.' });
    expect(intercity(s).boardLabel).toBe('з вокзалу Коростеня');
    expect([m.routeId, m.city, m.depMins]).toEqual(['9', undefined, hm(19, 40)]);
    expect([s.leaveMins, s.arriveMins, s.fromLabel]).toEqual([hm(18, 5), hm(19, 50), 'Коростень, Міськлікарня']);
  });

  it('без місця в Коростені — до вокзалу; рейс без часу прибуття — «≈» за розкидом розкладу', () => {
    const [late] = stories(run('з Малина в Коростень о 20:30', {}, fromMalyn));
    const ic = intercity(late);
    expect(kinds(late)).toEqual(['intercity']);
    expect([ic.schedule.id, ic.alightMins, ic.alightApprox]).toEqual([72, hm(20, 48) + 67, true]);
    expect([late.endLabel, late.arriveApprox]).toEqual(['Коростень, вокзал', true]);
  });

  it('місце названо, а планувальника Коростеня нема — час до висадки на вокзалі, з приміткою', () => {
    const [s] = stories(run('з Паперової фабрики в Коростень', { to: 'Міськлікарня' }, fromMalyn, { farPlanner: null }));
    expect(kinds(s)).toEqual(['bus', 'wait', 'intercity']);
    expect([s.arriveMins, s.endLabel, s.endNote]).toEqual([hm(18, 20), 'Коростень, Міськлікарня', 'час — до висадки на вокзалі Коростеня']);
  });

  it('пара для дошки попуток і ціни — Малин ↔ Коростень; маршрутки в розкладі нема — і рядка про неї нема', () => {
    expect(corridorCities(classify(parseLocal('з Малина в Коростень', NOW).intent))).toEqual({ from: 'Malyn', to: 'Korosten' });
    const price = composeStories({ intent: parseLocal('скільки коштує квиток з Малина в Коростень', NOW).intent, now: NOW, date: NOW.date, schedules: fromMalyn, planner: malynP });
    if (price.kind !== 'price') throw new Error(price.kind);
    expect(price.lines.map((l) => l.label)).toEqual(['Електричка Коростень ↔ Малин', 'Попутка']);
  });
});
