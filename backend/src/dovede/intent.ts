/**
 * «Доведе» — контракт TripIntent на сервері (Docs/dovede-roadmap.md, «Контракти»). Той самий, що у
 * `frontend/src/pages/DovedePage/nlu/types.ts`. Claude повертає його як structured output; `validateIntent`
 * не довіряє відповіді: чужі id місць переносить у `unknown`, зайве відкидає. Чисел розкладу тут немає.
 */
import { placeById } from './gazetteer';

export type TripMode = 'marshrutka' | 'elektrichka' | 'poputka' | 'city_bus';

export interface TripWhen {
  /** 'today' | 'tomorrow' | 'YYYY-MM-DD' */
  day: string;
  /** 'HH:MM' за Києвом */
  time?: string;
  kind: 'depart' | 'arrive' | 'any';
  part?: 'morning' | 'day' | 'evening';
}

export interface PlaceRef {
  id: string;
  text: string;
}

export interface TripIntent {
  /** route — питання про сам маршрут («куди їде №5») */
  intent: 'trip' | 'schedule' | 'route' | 'price' | 'contact' | 'other';
  from: PlaceRef | null;
  to: PlaceRef | null;
  when: TripWhen;
  modes: TripMode[];
  /** id маршрутів міських автобусів, які назвала людина; немає — поля немає */
  routes?: string[];
  unknown: string[];
  confidence: 'high' | 'medium' | 'low';
}

const INTENTS = ['trip', 'schedule', 'route', 'price', 'contact', 'other'] as const;
const MODES = ['marshrutka', 'elektrichka', 'poputka', 'city_bus'] as const;
const KINDS = ['depart', 'arrive', 'any'] as const;
const PARTS = ['morning', 'day', 'evening'] as const;
const CONFIDENCE = ['high', 'medium', 'low'] as const;

const PLACE_REF_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id зі словника місць, точно як у списку' },
        text: { type: 'string', description: 'як це місце назвала людина' },
      },
      required: ['id', 'text'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
} as const;

/** Схема відповіді Claude. Незмінна між запитами — частина кешованого префікса. Id місць — рядок, а не enum. */
export const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENTS },
    from: PLACE_REF_SCHEMA,
    to: PLACE_REF_SCHEMA,
    when: {
      type: 'object',
      properties: {
        day: { type: 'string', description: "'today', 'tomorrow' або дата 'YYYY-MM-DD'" },
        time: { anyOf: [{ type: 'string', description: "'HH:MM' за Києвом" }, { type: 'null' }] },
        kind: { type: 'string', enum: KINDS },
        part: { anyOf: [{ type: 'string', enum: PARTS }, { type: 'null' }] },
      },
      required: ['day', 'time', 'kind', 'part'],
      additionalProperties: false,
    },
    modes: { type: 'array', items: { type: 'string', enum: MODES } },
    routes: { type: 'array', items: { type: 'string', description: 'id маршруту міського автобуса зі списку маршрутів' } },
    unknown: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: CONFIDENCE },
  },
  required: ['intent', 'from', 'to', 'when', 'modes', 'routes', 'unknown', 'confidence'],
  additionalProperties: false,
} as const;

const DAY_RE = /^(today|tomorrow|\d{4}-\d{2}-\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TEXT = 80;

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

function clip(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '';
}

export class IntentShapeError extends Error {}

/**
 * Перевіряє й чистить намір (від Claude або від браузера). Місце з id, якого немає в словнику, стає `null`,
 * а його текст потрапляє в `unknown` — складальник покаже «не знаю, де це», а не вигадану зупинку.
 * `stopIds` — id зупинок із розкладу міста (`buildStopPlaces`), теж дозволені в from / to.
 * `routeIds` — id маршрутів міста; маршрут поза списком просто відкидається.
 */
export function validateIntent(raw: unknown, stopIds?: ReadonlySet<string>, routeIds?: ReadonlySet<string>): TripIntent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new IntentShapeError('намір — не обʼєкт');
  const o = raw as Record<string, unknown>;
  const unknown: string[] = [];
  const pushUnknown = (s: string) => {
    if (s && !unknown.includes(s) && unknown.length < 8) unknown.push(s);
  };
  if (Array.isArray(o.unknown)) o.unknown.forEach((u) => pushUnknown(clip(u)));

  const place = (v: unknown): PlaceRef | null => {
    if (!v || typeof v !== 'object') return null;
    const p = v as Record<string, unknown>;
    const id = typeof p.id === 'string' ? p.id.trim() : '';
    const text = clip(p.text);
    if (!placeById(id) && !stopIds?.has(id)) {
      pushUnknown(text || id.slice(0, MAX_TEXT));
      return null;
    }
    return { id, text: text || id };
  };
  const from = place(o.from);
  const to = place(o.to);

  const w = (o.when && typeof o.when === 'object' ? o.when : {}) as Record<string, unknown>;
  const when: TripWhen = {
    day: typeof w.day === 'string' && DAY_RE.test(w.day) ? w.day : 'today',
    kind: oneOf(KINDS, w.kind, 'depart'),
  };
  if (typeof w.time === 'string' && TIME_RE.test(w.time)) when.time = w.time;
  if (typeof w.part === 'string' && (PARTS as readonly string[]).includes(w.part)) when.part = w.part as TripWhen['part'];

  const modes: TripMode[] = [];
  if (Array.isArray(o.modes)) {
    for (const m of o.modes) {
      if (typeof m === 'string' && (MODES as readonly string[]).includes(m) && !modes.includes(m as TripMode)) modes.push(m as TripMode);
    }
  }

  const routes: string[] = [];
  if (Array.isArray(o.routes)) {
    for (const r of o.routes) {
      if (typeof r === 'string' && routeIds?.has(r) && !routes.includes(r)) routes.push(r);
    }
  }
  let intent = oneOf(INTENTS, o.intent, 'trip');
  // «питання про маршрут» без жодного відомого маршруту — звичайне питання про дорогу
  if (intent === 'route' && !routes.length) intent = 'trip';

  let confidence = oneOf(CONFIDENCE, o.confidence, 'low');
  // місце відкинуто або не назване — «high» бути не може (крім питання про сам маршрут: йому місце не потрібне)
  if (confidence === 'high' && (unknown.length > 0 || (!to && intent !== 'route'))) confidence = 'medium';

  return { intent, from, to, when, modes, ...(routes.length ? { routes } : {}), unknown, confidence };
}
