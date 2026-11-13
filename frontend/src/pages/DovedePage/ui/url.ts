/**
 * Адреса відповіді — лише id (Docs/dovede-roadmap.md, принцип 7): текст питання в URL не йде, бо в ньому
 * можуть бути домашні адреси. `?f=&t=&d=&h=&m=` (+ `a=1` — «прибути до», `p=` — частина дня, `r=` — маршрути).
 */
import { resolvePlace } from '../nlu/places';
import { streetIdForUrl } from '../nlu/streets';
import { addDays } from '../nlu/parseLocal';
import type { KyivNow, TripIntent, TripMode } from '../nlu/types';

const MODES: TripMode[] = ['marshrutka', 'elektrichka', 'poputka', 'city_bus'];
const PARTS = ['morning', 'day', 'evening'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DOVEDE_URL_KEYS = ['f', 't', 'd', 'h', 'a', 'p', 'm', 'r'] as const;
const ROUTE_ID_RE = /^[\w-]{1,12}$/;

/** Намір → параметри адреси; `date` — день, на який показано відповідь */
export function intentToParams(intent: TripIntent, date: string): URLSearchParams {
  const q = new URLSearchParams();
  // вулиця — без номера будинку: домашня адреса в посиланні не лишається
  if (intent.from) q.set('f', streetIdForUrl(intent.from.id));
  if (intent.to) q.set('t', streetIdForUrl(intent.to.id));
  q.set('d', date);
  if (intent.when.time) {
    q.set('h', intent.when.time);
    if (intent.when.kind === 'arrive') q.set('a', '1');
  } else if (intent.when.part) q.set('p', intent.when.part);
  if (intent.modes.length) q.set('m', intent.modes.join(','));
  if (intent.routes?.length) q.set('r', intent.routes.join(','));
  if (intent.avoidRoutes?.length) q.set('x', intent.avoidRoutes.join(','));
  return q;
}

/** Параметри адреси → намір; null — у адресі немає жодного відомого місця */
export function paramsToIntent(q: URLSearchParams, now: KyivNow): TripIntent | null {
  const place = (key: 'f' | 't') => {
    const p = resolvePlace(q.get(key) ?? '');
    return p ? { id: p.id, text: p.label } : null;
  };
  const from = place('f');
  const to = place('t');
  // id маршруту з адреси звіряє складальник (невідомий — картка без рейсів); тут лише форма
  const routes = (q.get('r') ?? '').split(',').filter((r) => ROUTE_ID_RE.test(r));
  const avoid = (q.get('x') ?? '').split(',').filter((r) => ROUTE_ID_RE.test(r) && !routes.includes(r));
  if (!from && !to && !routes.length) return null;

  const d = q.get('d') ?? '';
  // минулий день з давнього посилання — показуємо сьогодні
  const day = !DATE_RE.test(d) || d <= now.date ? 'today' : d === addDays(now.date, 1) ? 'tomorrow' : d;
  const h = q.get('h') ?? '';
  const when: TripIntent['when'] = { day, kind: 'depart' };
  if (TIME_RE.test(h)) {
    when.time = h;
    if (q.get('a') === '1') when.kind = 'arrive';
  } else {
    const part = PARTS.find((x) => x === q.get('p'));
    if (part) when.part = part;
  }
  const modes = (q.get('m') ?? '').split(',').filter((m): m is TripMode => (MODES as string[]).includes(m));
  return {
    intent: routes.length && !(from && to) ? 'route' : 'trip',
    from,
    to,
    when,
    modes: [...new Set(modes)],
    ...(routes.length ? { routes: [...new Set(routes)] } : {}),
    ...(avoid.length ? { avoidRoutes: [...new Set(avoid)] } : {}),
    unknown: [],
    confidence: (from && to) || routes.length ? 'high' : 'medium',
  };
}
