/** Журнал «Доведе»: розбір питання (TripIntent) одним рядком для таблиці */
import type { PlaceRef, TripIntent } from '@/pages/DovedePage/nlu/types';
import { routeNo } from '@/utils/routeNames';

const INTENT_LABEL: Record<TripIntent['intent'], string> = {
  trip: '',
  schedule: 'розклад',
  route: 'маршрут',
  price: 'ціна',
  contact: 'контакти',
  other: 'не про дорогу',
};

const MODE_LABEL: Record<string, string> = {
  marshrutka: 'маршрутка',
  elektrichka: 'електричка',
  poputka: 'попутка',
  city_bus: 'автобус',
};

const DAY_LABEL: Record<string, string> = { today: 'сьогодні', tomorrow: 'завтра' };
const PART_LABEL: Record<string, string> = { morning: 'зранку', day: 'вдень', evening: 'ввечері' };

/** Розбір одним рядком: «Київ → Вокзал · завтра 08:00 · №5 · маршрутка» */
export function intentLine(intent: TripIntent, placeLabel: (ref: PlaceRef | null) => string): string {
  const parts: string[] = [];
  if (INTENT_LABEL[intent.intent]) parts.push(INTENT_LABEL[intent.intent]);
  if (intent.from || intent.to) parts.push(`${placeLabel(intent.from)} → ${placeLabel(intent.to)}`);
  const when = [
    DAY_LABEL[intent.when.day] ?? intent.when.day,
    intent.when.time ? `${intent.when.kind === 'arrive' ? 'бути о ' : ''}${intent.when.time}` : '',
    intent.when.part ? PART_LABEL[intent.when.part] ?? intent.when.part : '',
  ].filter(Boolean);
  // «сьогодні» без часу — це просто «не сказано»
  if (when.length > 1 || intent.when.day !== 'today') parts.push(when.join(' '));
  if (intent.routes?.length) parts.push(intent.routes.map((id) => `№${routeNo(id)}`).join(', '));
  if (intent.avoidRoutes?.length) parts.push(`крім ${intent.avoidRoutes.map((id) => `№${routeNo(id)}`).join(', ')}`);
  if (intent.modes.length) parts.push(intent.modes.map((m) => MODE_LABEL[m] ?? m).join(', '));
  return parts.join(' · ') || '—';
}
