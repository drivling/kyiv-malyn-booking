/**
 * «Паспорт пасажира» — мітка на телефоні людини з QR-наклейок (Docs/stop-stickers.md, «Люди з наклейок»): з якої
 * зупинки прийшла вперше, які ще сканувала (порядок першого скану, скільки разів, перший і останній раз) і номер
 * пасажира в місті, який дав сервер (відповідь POST /transport/sticker-scans, backend sticker-people.ts). Те саме
 * сервер памʼятає у StickerPerson. Поки нічого не показується — паспорт для майбутніх привітань і акцій
 * (`readStickerPassport`). «Очистити дані пристрою» (transportPrefs.ts) його стирає.
 */
import type { PassengerSummary, StickerSide } from '@/types';

export const PASSPORT_KEY = 'sticker-passport:v1';
/** Перша наклейка, яку памʼятав сайт до паспорта (stickerReturn.ts) — з неї паспорт засівається */
const ORIGIN_KEY = 'sticker-origin';
/** Скільки зупинок памʼятати (перша лишається завжди) */
export const MAX_PASSPORT_STOPS = 60;

export type PassportStop = { stopId: string; side: StickerSide; first: number; last: number; scans: number };
export type StickerPassport = {
  v: 1;
  /** Номер пасажира в місті; null — сервер ще не відповів (скан чекає мережі) */
  number: number | null;
  first: { stopId: string; side: StickerSide; at: number };
  stops: PassportStop[];
  scans: number;
  lastAt: number;
};

const STOP_RE = /^[A-Za-z0-9_-]{1,40}$/;
const isSide = (s: unknown): s is StickerSide => s === 'a' || s === 'b' || s === 's';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function valid(p: unknown): StickerPassport | null {
  const x = p as Partial<StickerPassport> | null;
  if (!x || x.v !== 1 || !x.first || !STOP_RE.test(String(x.first.stopId)) || !isSide(x.first.side)) return null;
  const stops = (Array.isArray(x.stops) ? x.stops : [])
    .filter((s) => s && STOP_RE.test(String(s.stopId)) && isSide(s.side))
    .map((s) => ({ stopId: s.stopId, side: s.side, first: num(s.first), last: num(s.last), scans: num(s.scans) }));
  return {
    v: 1,
    number: typeof x.number === 'number' && x.number > 0 ? Math.floor(x.number) : null,
    first: { stopId: x.first.stopId, side: x.first.side, at: num(x.first.at) },
    stops,
    scans: num(x.scans),
    lastAt: num(x.lastAt),
  };
}

/** Паспорт цього браузера; null — людина ще не приходила з наклейки (або сховище недоступне) */
export function readStickerPassport(): StickerPassport | null {
  try {
    const raw = localStorage.getItem(PASSPORT_KEY);
    if (raw) return valid(JSON.parse(raw));
    // сканував до паспорта: перша наклейка — із запису для повернень
    const origin = JSON.parse(localStorage.getItem(ORIGIN_KEY) ?? 'null') as { stopId?: unknown; side?: unknown; firstAt?: unknown } | null;
    if (!origin || !STOP_RE.test(String(origin.stopId)) || !isSide(origin.side)) return null;
    const at = num(origin.firstAt);
    const stopId = String(origin.stopId);
    return { v: 1, number: null, first: { stopId, side: origin.side, at }, stops: [{ stopId, side: origin.side, first: at, last: at, scans: 1 }], scans: 1, lastAt: at };
  } catch {
    return null;
  }
}

function write(p: StickerPassport): void {
  try {
    localStorage.setItem(PASSPORT_KEY, JSON.stringify(p));
  } catch {
    /* без сховища паспорта немає — сервер однаково памʼятає людину */
  }
}

/** Скан, який рахуємо (раз за сесію на наклейку, stickerScan.ts): дописати зупинку в паспорт */
export function noteStickerScan(scan: { stopId: string; side: StickerSide }, now = Date.now()): StickerPassport {
  const prev = readStickerPassport();
  if (!prev) {
    const fresh: StickerPassport = {
      v: 1,
      number: null,
      first: { ...scan, at: now },
      stops: [{ ...scan, first: now, last: now, scans: 1 }],
      scans: 1,
      lastAt: now,
    };
    write(fresh);
    return fresh;
  }
  const known = prev.stops.find((s) => s.stopId === scan.stopId);
  let stops = known
    ? prev.stops.map((s) => (s === known ? { ...s, side: scan.side, last: now, scans: s.scans + 1 } : s))
    : [...prev.stops, { ...scan, first: now, last: now, scans: 1 }];
  // перша зупинка лишається завжди, далі — найсвіжіші
  if (stops.length > MAX_PASSPORT_STOPS) stops = [stops[0], ...stops.slice(stops.length - MAX_PASSPORT_STOPS + 1)];
  const next = { ...prev, stops, scans: prev.scans + 1, lastAt: now };
  write(next);
  return next;
}

/** Відповідь сервера на скан: номер пасажира (той самий для браузера, поки його не стерли) */
export function rememberPassengerNumber(person: Pick<PassengerSummary, 'number'> | undefined | null): void {
  if (!person || !(person.number > 0)) return;
  const prev = readStickerPassport();
  if (!prev || prev.number === person.number) return;
  write({ ...prev, number: person.number });
}
