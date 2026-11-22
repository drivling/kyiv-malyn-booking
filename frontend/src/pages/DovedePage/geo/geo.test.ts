/**
 * «Звідки — де я зараз» (Docs/dovede-geo-roadmap.md, Г1): геозони, найближча адреса з наших даних, місце `here`
 * і крок `applyHere`. Координати нікуди не йдуть: перевіряємо й те, що `here` не потрапляє в адресу сторінки.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { transportProfile } from '@/site/transportCity';
import { STREETS } from '../nlu/streets';
import { resolvePlace } from '../nlu/places';
import { classify } from '../compose/composeStories';
import { intentToParams } from '../ui/url';
import type { TripIntent } from '../nlu/types';
import { GEO_ZONES, distanceM, locateCity } from './zones';
import { nearestAddress } from './nearestAddress';
import { HERE_ID, getHere, herePlace, makeHereFix, setHere } from './here';
import { applyHere } from './applyHere';

const NOW = 1_800_000_000_000;
/** біля «Пелікана» в Малині */
const MALYN: [number, number] = [50.7639, 29.2683];
const KOROSTEN: [number, number] = [50.9506, 28.6384];
const KYIV: [number, number] = [50.4501, 30.5234];
const ARGENTINA: [number, number] = [-34.6037, -58.3816];

const trip = (patch: Partial<TripIntent>): TripIntent => ({
  intent: 'trip',
  from: null,
  to: null,
  when: { day: 'today', kind: 'depart' },
  modes: [],
  unknown: [],
  confidence: 'high',
  ...patch,
}) as TripIntent;

afterEach(() => setHere(null));

describe('locateCity', () => {
  it('центри Малина й Коростеня — ті самі, що в профілях транспорту', () => {
    expect(GEO_ZONES.find((z) => z.city === 'Malyn')!.center).toEqual(transportProfile('Malyn').center);
    expect(GEO_ZONES.find((z) => z.city === 'Korosten')!.center).toEqual(transportProfile('Korosten').center);
  });

  it.each([
    [MALYN, 'Malyn'],
    [KOROSTEN, 'Korosten'],
    [KYIV, 'Kyiv'],
    [[50.2547, 28.6587] as [number, number], 'Zhytomyr'],
    [ARGENTINA, 'far'],
    // Потіївка — село між Малином і Радомишлем: «далеко», маршрут від неї не будуємо
    [[50.633, 29.07] as [number, number], 'far'],
  ])('%j → %s', (p, city) => {
    expect(locateCity(p[0], p[1]).city).toBe(city);
  });

  it('distanceM: градус широти ≈ 111 км', () => {
    expect(Math.round(distanceM([50, 29], [51, 29]) / 1000)).toBe(111);
  });
});

describe('nearestAddress', () => {
  it('точка просто біля будинку з даних — його адреса', () => {
    const s = STREETS.find((x) => Object.keys(x.houses).length > 0)!;
    const [house, p] = Object.entries(s.houses)[0];
    expect(nearestAddress(p[0] + 0.0001, p[1], STREETS)).toEqual(expect.objectContaining({ label: `${s.label}, ${house}` }));
  });
  it('серед поля — null, адресу не вигадуємо', () => {
    expect(nearestAddress(50.9, 29.6, STREETS)).toBeNull();
  });
});

describe('місце here', () => {
  it('Малин: місце з точкою, підпис — найближча адреса', () => {
    setHere(makeHereFix(MALYN[0], MALYN[1], 20, NOW));
    const p = resolvePlace(HERE_ID)!;
    expect(p).toEqual(expect.objectContaining({ id: HERE_ID, city: 'Malyn', latLng: MALYN }));
    expect(p.label).toMatch(/ви тут|де ви зараз/);
  });
  it('неточне визначення: без адреси, «приблизно»', () => {
    setHere(makeHereFix(MALYN[0], MALYN[1], 3000, NOW));
    expect(getHere()!.imprecise).toBe(true);
    expect(herePlace()!.label).toBe('де ви зараз (приблизно)');
  });
  it('Київ і «Аргентина» — не місце-точка', () => {
    setHere(makeHereFix(KYIV[0], KYIV[1], 20, NOW));
    expect(resolvePlace(HERE_ID)).toBeUndefined();
    setHere(makeHereFix(ARGENTINA[0], ARGENTINA[1], 20, NOW));
    expect(resolvePlace(HERE_ID)).toBeUndefined();
  });
});

describe('applyHere', () => {
  const pelikan = { id: 'lm.pelikan', text: 'Пелікан' };
  const malyn = { pageCity: 'Malyn' as const };

  it('«як доїхати до кафе Пелікан» у Малині → від того місця, де людина, своїм планувальником', () => {
    const fix = makeHereFix(MALYN[0], MALYN[1], 20, NOW);
    setHere(fix);
    const r = applyHere(trip({ to: pelikan }), fix, malyn);
    expect(r.outcome).toEqual({ kind: 'used', imprecise: false });
    expect(r.intent.from?.id).toBe(HERE_ID);
    expect(classify(r.intent)).toEqual(expect.objectContaining({ kind: 'intra', origin: expect.objectContaining({ id: HERE_ID, latLng: MALYN }) }));
  });

  it('без місця те саме питання — як і раніше, «скажіть, звідки»', () => {
    expect(applyHere(trip({ to: pelikan }), null, malyn).outcome).toEqual({ kind: 'skip' });
    expect(classify(trip({ to: pelikan })).kind).toBe('ask_from');
  });

  it('слова мають перевагу: «звідки» названо — місце не чіпаємо', () => {
    const fix = makeHereFix(MALYN[0], MALYN[1], 20, NOW);
    const asked = trip({ from: { id: 'malyn.vokzal', text: 'вокзал' }, to: pelikan });
    expect(applyHere(asked, fix, malyn).intent).toBe(asked);
  });

  it('не поїздка (ціна, телефон) — не чіпаємо', () => {
    const fix = makeHereFix(MALYN[0], MALYN[1], 20, NOW);
    expect(applyHere(trip({ intent: 'price', to: { id: 'city.Kyiv', text: 'Київ' } }), fix, malyn).outcome.kind).toBe('skip');
  });

  it('у Малині «до Києва» — від точки людини (як від її адреси)', () => {
    const fix = makeHereFix(MALYN[0], MALYN[1], 20, NOW);
    setHere(fix);
    const r = applyHere(trip({ to: { id: 'city.Kyiv', text: 'Київ' } }), fix, malyn);
    expect(r.intent.from?.id).toBe(HERE_ID);
    expect(classify(r.intent)).toEqual(expect.objectContaining({ kind: 'from_malyn', far: 'Kyiv', origin: expect.objectContaining({ id: HERE_ID }) }));
  });

  it('у Києві «до Малина» — «з Києва» (місто без місця); у Києві «до Академмістечка» — не чіпаємо', () => {
    const fix = makeHereFix(KYIV[0], KYIV[1], 20, NOW);
    expect(applyHere(trip({ to: { id: 'city.Malyn', text: 'Малин' } }), fix, malyn).intent.from?.id).toBe('city.Kyiv');
    expect(applyHere(trip({ to: { id: 'kyiv.akadem', text: 'Академмістечко' } }), fix, malyn).outcome.kind).toBe('skip');
  });

  it('«Аргентина» — не підставляємо, кажемо «далеко»', () => {
    const fix = makeHereFix(ARGENTINA[0], ARGENTINA[1], 20, NOW);
    const r = applyHere(trip({ to: pelikan }), fix, malyn);
    expect(r.outcome).toEqual({ kind: 'far' });
    expect(r.intent.from).toBeNull();
  });

  it('у Коростені на сторінці Малина: «до Малина» — від Коростеня, місце в Коростені — перемкнути місто', () => {
    const fix = makeHereFix(KOROSTEN[0], KOROSTEN[1], 20, NOW);
    expect(applyHere(trip({ to: { id: 'malyn.vokzal', text: 'вокзал' } }), fix, malyn).intent.from).toEqual(expect.objectContaining({ id: 'city.Korosten' }));
    expect(applyHere(trip({ to: { id: 'malyn.vokzal', text: 'вокзал' } }), fix, malyn).intent.from?.detail).toBeUndefined();
  });

  it('на сторінці Коростеня: від точки; інший кінець — слова не з наших даних — не підставляємо (їх питали б у сервера)', () => {
    const fix = makeHereFix(KOROSTEN[0], KOROSTEN[1], 20, NOW);
    const words = trip({ to: { id: 'city.Korosten', text: 'Коростень', detail: 'кафе Невідоме' } });
    expect(applyHere(words, fix, { pageCity: 'Korosten', isLocalKorosten: () => false }).outcome.kind).toBe('skip');
    expect(applyHere(words, fix, { pageCity: 'Korosten', isLocalKorosten: () => true }).intent.from?.id).toBe(HERE_ID);
  });

  it('людина в Малині, а на сторінці Коростень — сторінці перемкнутися на Малин', () => {
    const fix = makeHereFix(MALYN[0], MALYN[1], 20, NOW);
    expect(applyHere(trip({ to: pelikan }), fix, { pageCity: 'Korosten' }).outcome).toEqual({ kind: 'other_city', city: 'Malyn' });
  });

  it('«де ви зараз» не потрапляє в адресу сторінки', () => {
    const fix = makeHereFix(MALYN[0], MALYN[1], 20, NOW);
    setHere(fix);
    const params = intentToParams(applyHere(trip({ to: pelikan }), fix, malyn).intent, '2026-11-22');
    expect(params.has('f')).toBe(false);
    expect(params.toString()).not.toMatch(/50\.7|29\.2|here/);
  });
});
