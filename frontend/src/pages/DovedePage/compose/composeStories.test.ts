import { describe, expect, it } from 'vitest';
import type { DirectWalk, Endpoint, Journey } from '@/pages/LocalTransportPage/journey';
import type { Schedule, ViberListing } from '@/types';
import { parseLocal } from '../nlu/parseLocal';
import type { KyivNow } from '../nlu/types';
import { placesInNote } from '../nlu/notePlaces';
import { classify, composeStories, corridorCities, resolveDate, rideDepartures, ridesWanted } from './composeStories';
import type { LocalPlanner, Story, StoryLeg } from './types';

/** п'ятниця 13.11.2026, 14:20 */
const NOW: KyivNow = { date: '2026-11-13', mins: 14 * 60 + 20 };
const hm = (h: number, m: number) => h * 60 + m;

const NAMES: Record<string, string> = {
  st_0079: 'ПТЛ',
  st_0049: 'м-н «Промінь»',
  st_0004: 'Автостанція',
  st_0090: 'Царське село',
  st_0019: 'Залізничний вокзал',
};
const COORDS: Record<string, [number, number]> = {
  st_0079: [50.75975, 29.28151],
  st_0049: [50.76699, 29.24245],
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
    'st_0049>st_0019': [bus('8', 'st_0049', 'st_0019', hm(16, 46), hm(16, 56))],
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
    expect(shape('з Житомира в Малин')).toEqual({ kind: 'outside', city: 'Zhytomyr' });
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
    'st_0049>st_0019': [bus('8', 'st_0049', 'st_0019', hm(20, 0), hm(20, 10))],
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
    expect(s.endLabel).toBe('Київ, метро «Академмістечко»');
    expect(s.endNote).toBeNull();
    const kyiv = s.legs[s.legs.length - 1];
    expect(kyiv.kind === 'kyiv' && kyiv.text).toContain('«Академмістечко» → «Житомирська», 1 станція');
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
    expect(ride(s)).toMatchObject({ boardLabel: 'від метро «Житомирська»', boardAssumed: false, alightLabel: 'у центрі, біля «Промінь»', alightAssumed: true, arrMins: hm(19, 35) });
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
