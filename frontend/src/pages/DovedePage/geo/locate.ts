/**
 * «Доведе» · де людина зараз — від браузера (Docs/dovede-geo-roadmap.md, Г2). Лише адміну (те саме правило, що в
 * мікрофона); дозвіл браузер питає тоді, коли натиснули мікрофон, або коли набране питання без «звідки». Координати
 * лишаються в памʼяті вкладки (`here.ts`); відмова — тиха, сторінка працює як без місця.
 */
import { readAdminToken } from '@/utils/adminTokenStorage';
import { loadKorostenStreets } from '../korosten/korostenStreets';
import { extraStreets } from '../nlu/streets';
import { getHere, makeHereFix, setHere, type HereFix } from './here';

/** Визначення свіже 2 хв: людина за цей час далеко не відійде, а браузер не питає щоразу */
export const FRESH_MS = 2 * 60_000;
const TIMEOUT_MS = 10_000;

export type LocateError = 'denied' | 'unavailable' | 'timeout' | 'unsupported';

let pending: Promise<HereFix | null> | null = null;
let lastError: LocateError | null = null;

export function geoAllowed(): boolean {
  return Boolean(readAdminToken()) && typeof navigator !== 'undefined' && !!navigator.geolocation;
}

export function freshHere(now = Date.now()): HereFix | null {
  const h = getHere();
  return h && now - h.at <= FRESH_MS ? h : null;
}

export function locateError(): LocateError | null {
  return lastError;
}

/** Для тестів */
export function resetLocate(): void {
  pending = null;
  lastError = null;
  setHere(null);
}

/** Визначити місце (один запит на всіх, хто питає водночас); людина вже відмовила — більше не питаємо в цій вкладці */
export function locateNow(): Promise<HereFix | null> {
  if (pending) return pending;
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    lastError = 'unsupported';
    return Promise.resolve(null);
  }
  if (lastError === 'denied') return Promise.resolve(null);
  pending = new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, (e) => {
      lastError = e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable';
      resolve(null);
    }, { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: FRESH_MS });
  })
    .then(async (pos) => {
      if (!pos) return null;
      const { latitude, longitude, accuracy } = pos.coords;
      let fix = makeHereFix(latitude, longitude, accuracy, Date.now());
      // адресу в Коростені шукаємо в його вулицях — вони вантажаться окремо
      if (fix.city === 'Korosten') {
        await loadKorostenStreets();
        fix = makeHereFix(latitude, longitude, accuracy, fix.at, extraStreets());
      }
      lastError = null;
      setHere(fix);
      return fix;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
