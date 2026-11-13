/**
 * Злиття двох розборів питання (Docs/dovede-roadmap.md, принцип 2): місцевого (браузер, миттєво) і Claude
 * (POST /admin/dovede/understand). Місцевий упевнений → відповідаємо одразу, Claude лише перевіряє; інакше
 * чекаємо Claude. Сервер уже відкинув id, яких немає в словнику; тут — ще одна перевірка тим самим словником.
 */
import { resolvePlace } from './places';
import type { LocalParse, TripIntent } from './types';

/** Чи два розбори ведуть до тієї самої відповіді (те саме правило, що `intentsAgree` на сервері) */
export function sameAnswer(a: TripIntent, b: TripIntent): boolean {
  const modes = (m: string[]) => [...m].sort().join(',');
  // «розклад» і «як доїхати» складальник відповідає однаково (classify) — це не розбіжність
  const kind = (i: TripIntent['intent']) => (i === 'schedule' ? 'trip' : i);
  const routes = (i: TripIntent) => [...(i.routes ?? [])].sort().join(',');
  return (
    kind(a.intent) === kind(b.intent) &&
    (a.from?.id ?? null) === (b.from?.id ?? null) &&
    (a.to?.id ?? null) === (b.to?.id ?? null) &&
    a.when.day === b.when.day &&
    (a.when.time ?? null) === (b.when.time ?? null) &&
    (a.when.part ?? null) === (b.when.part ?? null) &&
    (a.when.time ? a.when.kind === b.when.kind : true) &&
    modes(a.modes) === modes(b.modes) &&
    routes(a) === routes(b)
  );
}

/** Місцевому розбору досить самому: обидва місця відомі й нічого незнайомого */
export function localIsSure(parse: LocalParse): boolean {
  return parse.intent.confidence === 'high';
}

/** Розбір Claude придатний, якщо всі його місця є в нашому словнику (інакше це не наш контракт) */
export function usableAiIntent(ai: TripIntent | null | undefined): ai is TripIntent {
  if (!ai || typeof ai !== 'object' || !ai.when) return false;
  if (ai.from && !resolvePlace(ai.from.id)) return false;
  if (ai.to && !resolvePlace(ai.to.id)) return false;
  return Array.isArray(ai.modes) && Array.isArray(ai.unknown);
}

/**
 * Який розбір показати, коли місцевий не впевнений. Claude має перевагу, крім випадку, коли він сам не
 * зрозумів (low і жодного місця), а словник хоч одне місце знайшов.
 */
export function pickIntent(local: TripIntent, ai: TripIntent | null | undefined): TripIntent {
  if (!usableAiIntent(ai)) return local;
  if (ai.confidence === 'low' && !ai.from && !ai.to && (local.from || local.to)) return local;
  return ai;
}

/** Розбір для рядка «Розумію…» з наміром, який справді пішов у відповідь */
export function withIntent(parse: LocalParse, intent: TripIntent): LocalParse {
  if (intent === parse.intent) return parse;
  const unknownRole = intent.unknown.length === 0 ? null : !intent.from && intent.to ? 'from' : !intent.to ? 'to' : parse.unknownRole;
  // підсвічування слів (spans) рахував місцевий розбір — до іншого наміру воно не пасує
  return { ...parse, intent, spans: [], unknownRole, dayGiven: parse.dayGiven || intent.when.day !== 'today' };
}
