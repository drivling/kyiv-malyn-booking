/** Журнал «Доведе»: розбір питання (TripIntent) одним рядком для таблиці */
import type { PlaceRef, TripIntent } from '@/pages/DovedePage/nlu/types';
import { routeNo } from '@/utils/routeNames';
import { intentToParams, questionForUrl } from '@/pages/DovedePage/ui/url';

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

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Київська дата 'YYYY-MM-DD' */
export const kyivDate = (at: Date = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** Наміри, відповідь на які сторінка будує з адреси (місця, час, транспорт); решта — лише слова питання */
const URL_INTENTS = new Set<TripIntent['intent']>(['trip', 'schedule', 'route']);

/**
 * «Відкрити як людина» для питання з журналу: відповідь сторінки з того самого розбору (Claude, інакше браузера) —
 * як людина спитала б це сьогодні («завтра» — від сьогодні; минула дата — сьогодні), і слова питання в `q=`.
 * Посилання з id Claude не кличе (Docs/dovede-roadmap.md, принцип 7).
 */
export function questionLink(it: { text: string; ai: TripIntent | null; local: TripIntent | null }, today: string = kyivDate()): string {
  const intent = it.ai ?? it.local;
  let params = new URLSearchParams();
  if (intent && URL_INTENTS.has(intent.intent) && (intent.from || intent.to || intent.routes?.length)) {
    const day = intent.when.day;
    const date = day === 'tomorrow' ? addDays(today, 1) : /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= today ? day : today;
    params = intentToParams(intent, date);
  }
  const words = questionForUrl(it.text);
  if (words) params.set('q', words);
  const qs = params.toString();
  return `/dovede${qs ? `?${qs}` : ''}`;
}
