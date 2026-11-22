/**
 * Геолокація браузера (Docs/dovede-geo-roadmap.md, Г2): кожному, кому відкрито «Доведе», один запит на всіх, свіже 2 хв, відмова — тиха й
 * більше не питаємо. Справжнього GPS тест не торкається.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRESH_MS, freshHere, geoAllowed, locateError, locateNow, resetLocate } from './locate';

type Ok = (p: GeolocationPosition) => void;
type Err = (e: GeolocationPositionError) => void;
let answer: (ok: Ok, err: Err) => void = () => undefined;
const getCurrentPosition = vi.fn((ok: Ok, err: Err) => answer(ok, err));

const at = (lat: number, lng: number, accuracy = 20) => (ok: Ok) => ok({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition);

beforeEach(() => {
  resetLocate();
  getCurrentPosition.mockClear();
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
});
afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('geoAllowed', () => {
  it('де браузер уміє геолокацію; токен адміна не потрібен', () => {
    expect(geoAllowed()).toBe(true);
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    expect(geoAllowed()).toBe(false);
  });
});

describe('locateNow', () => {
  it('Малин: місце з містом і найближчою адресою; свіже 2 хв, потім ні', async () => {
    answer = at(50.7639, 29.2683);
    const fix = await locateNow();
    expect(fix).toEqual(expect.objectContaining({ city: 'Malyn', imprecise: false }));
    expect(freshHere()).toBe(fix);
    expect(freshHere(fix!.at + FRESH_MS + 1)).toBeNull();
  });

  it('два питання водночас — один запит до браузера', async () => {
    answer = at(50.7639, 29.2683);
    await Promise.all([locateNow(), locateNow()]);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('відмова: null, більше не питаємо в цій вкладці', async () => {
    answer = (_ok, err) => err({ code: 1 } as GeolocationPositionError);
    expect(await locateNow()).toBeNull();
    expect(locateError()).toBe('denied');
    expect(await locateNow()).toBeNull();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('тайм-аут — можна спитати ще раз', async () => {
    answer = (_ok, err) => err({ code: 3 } as GeolocationPositionError);
    expect(await locateNow()).toBeNull();
    expect(locateError()).toBe('timeout');
    answer = at(50.7639, 29.2683);
    expect(await locateNow()).not.toBeNull();
  });

  it('Коростень: адресу шукаємо у вулицях Коростеня (вантажаться окремо)', async () => {
    answer = at(50.9506, 28.6384);
    const fix = await locateNow();
    expect(fix?.city).toBe('Korosten');
  });
});
