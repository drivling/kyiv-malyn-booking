import { addDays } from '../nlu/parseLocal';
import { placeLabel } from '../nlu/gazetteer';
import { resolvePlace } from '../nlu/places';
import type { KyivNow, PlaceRef, TripIntent } from '../nlu/types';

const DOW = ['неділю', 'понеділок', 'вівторок', 'середу', 'четвер', 'пʼятницю', 'суботу'];
const DOW_NOM = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'];

function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** «сьогодні, пʼятниця» / «завтра, субота» / «понеділок, 16.11» */
export function dateHeading(iso: string, now: KyivNow): string {
  const dow = DOW_NOM[weekdayOf(iso)];
  if (iso === now.date) return `сьогодні, ${dow}`;
  if (iso === addDays(now.date, 1)) return `завтра, ${dow}`;
  return `${dow}, ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

/** «сьогодні» / «завтра» / «у неділю» / «20.11» */
export function dayLabel(day: string, now: KyivNow): string {
  if (day === 'today') return 'сьогодні';
  if (day === 'tomorrow') return 'завтра';
  const diff = Math.round((Date.parse(day) - Date.parse(now.date)) / 86_400_000);
  if (diff > 1 && diff < 7) return `у ${DOW[weekdayOf(day)]}`;
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

const PART = { morning: 'зранку', day: 'вдень', evening: 'ввечері' } as const;

export function whenLabel(when: TripIntent['when'], now: KyivNow): { text: string; guessed: boolean } {
  const parts = [dayLabel(when.day, now), when.part ? PART[when.part] : null, when.time ? `${when.kind === 'arrive' ? 'до' : 'о'} ${when.time}` : null];
  const guessed = when.day === 'today' && !when.part && !when.time;
  return { text: guessed ? 'сьогодні, найближчі' : parts.filter(Boolean).join(' '), guessed };
}

const MODE = { marshrutka: 'маршруткою', elektrichka: 'електричкою', poputka: 'попуткою', city_bus: 'міським автобусом' } as const;

/** `routeNos` — номери названих маршрутів для показу («5», «11/1») */
export function modeLabel(modes: TripIntent['modes'], routeNos: string[] = []): { text: string; guessed: boolean } {
  if (routeNos.length) return { text: `автобусом №${routeNos.join(', №')}`, guessed: false };
  if (!modes.length) return { text: 'будь-яким транспортом', guessed: true };
  return { text: modes.map((m) => MODE[m]).join(' або '), guessed: false };
}

export function placeRefLabel(ref: PlaceRef | null): string | null {
  if (!ref) return null;
  const p = resolvePlace(ref.id);
  return p ? placeLabel(p) : ref.text;
}
