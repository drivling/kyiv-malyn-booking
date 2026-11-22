/**
 * Адреса відповіді (Docs/dovede-roadmap.md, принцип 7). Відповідь будується з id: `?f=&t=&d=&h=&m=` (+ `fd=` / `td=` — місце словами в Києві чи Житомирі, `a=1` —
 * «прибути до», `p=` — частина дня, `r=` — маршрути, `x=` — маршрути, яких уникати). Слова людини завжди йдуть у
 * `q=` цілком: посилання відкриває ту саму фразу з підсвіткою й ту саму відповідь (номер будинку береться з цих
 * слів). Рішення власника 2026-11-13: людина сама вирішує, кому надсилати посилання зі своєю адресою.
 */
import { HERE_ID } from '../geo/here';
import { resolvePlace } from '../nlu/places';
import { streetIdForUrl } from '../nlu/streets';
import { addDays } from '../nlu/parseLocal';
import type { KyivNow, TripIntent, TripMode } from '../nlu/types';

const MODES: TripMode[] = ['marshrutka', 'elektrichka', 'poputka', 'city_bus'];
const PARTS = ['morning', 'day', 'evening'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DOVEDE_URL_KEYS = ['f', 't', 'fd', 'td', 'd', 'h', 'a', 'p', 'm', 'r', 'x', 'q'] as const;
/**
 * Міста, де місце всередині міста — `fd=` / `td=`: у Києві й Житомирі до нього веде сервер, у Коростені — назва
 * зупинки його датасету (етап 3, планувальник Коростеня)
 */
const DETAIL_CITIES = new Set(['city.Kyiv', 'city.Zhytomyr', 'city.Korosten']);
const MAX_DETAIL = 80;
/** Найдовше питання, яке приймає сторінка й сервер */
const MAX_QUESTION = 300;
const ROUTE_ID_RE = /^[\w-]{1,12}$/;

/** Намір → параметри адреси; `date` — день, на який показано відповідь */
export function intentToParams(intent: TripIntent, date: string): URLSearchParams {
  const q = new URLSearchParams();
  // вулиця — без номера будинку: домашня адреса в посиланні не лишається
  // «де ви зараз» в адресу не пишемо: координат там бути не може, а інша людина відкрила б «зі свого місця»
  if (intent.from && intent.from.id !== HERE_ID) q.set('f', streetIdForUrl(intent.from.id));
  if (intent.to) q.set('t', streetIdForUrl(intent.to.id));
  if (intent.from?.detail) q.set('fd', intent.from.detail);
  if (intent.to?.detail) q.set('td', intent.to.detail);
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
    if (!p) return null;
    const detail = DETAIL_CITIES.has(p.id) ? (q.get(`${key}d`) ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL) : '';
    return { id: p.id, text: p.label, ...(detail.length >= 2 ? { detail } : {}) };
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

/** Слова питання для посилання — цілком; null — питання порожнє або задовге */
export function questionForUrl(text: string): string | null {
  const t = text.trim();
  return t && t.length <= MAX_QUESTION ? t : null;
}

/** Слова питання з посилання (`q=`) — лише для показу в полі */
export function questionFromParams(q: URLSearchParams): string {
  return (q.get('q') ?? '').trim().slice(0, MAX_QUESTION);
}

const STORE_KEY = 'dovede:question';

/** Адреса без слів питання — ключ, за яким вкладка впізнає «свою» відповідь після перезавантаження */
function answerKey(q: URLSearchParams): string {
  const copy = new URLSearchParams(q);
  copy.delete('q');
  copy.sort();
  return copy.toString();
}

/** Запамʼятати питання цієї вкладки (sessionStorage): після перезавантаження поле знову покаже ті самі слова */
export function rememberQuestion(params: URLSearchParams, text: string): void {
  try {
    if (text.trim()) sessionStorage.setItem(STORE_KEY, JSON.stringify({ key: answerKey(params), text: text.trim().slice(0, MAX_QUESTION) }));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* приватний режим — обійдемося без цього */
  }
}

/** Питання, збережене цією вкладкою саме для такої адреси; інакше порожньо */
export function recallQuestion(params: URLSearchParams): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? 'null') as { key?: unknown; text?: unknown } | null;
    return saved && saved.key === answerKey(params) && typeof saved.text === 'string' ? saved.text : '';
  } catch {
    return '';
  }
}
