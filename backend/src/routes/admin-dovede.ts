/**
 * Адмін-API «Доведе» (Docs/dovede-roadmap.md, фаза 2): POST /admin/dovede/understand — текст питання →
 * TripIntent від Claude. Таємність сторінки тримає саме цей requireAdmin. Будь-яка причина, з якої ШІ не
 * відповів (вимкнено, немає ключа, денний ліміт, збій API), повертається з `fallback: 'local'`: сторінка
 * тоді відповідає з місцевого розбору, людина помилки не бачить.
 */
import express, { type Router } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import { kyivClock } from '../arrival-reports';
import { aiCallsToday, dovedeDailyCap, isDovedeEnabled } from '../dovede/guard';
import { IntentShapeError, validateIntent, type TripIntent } from '../dovede/intent';
import { understandFromEnv, type UnderstandFn } from '../dovede/understand';
import type { RouteLike } from '../dovede/prompt';
import { buildStopPlaces, type StopLike } from '../dovede/stopPlaces';
import { DEFAULT_TRANSPORT_CITY } from '../transport-city';

export const DOVEDE_MAX_TEXT = 300;
/** Як довго тримаємо список зупинок міста в памʼяті: нова зупинка з адмінки стає відомою Claude за цей час */
const STOPS_TTL_MS = 5 * 60_000;

/** Чи два розбори ведуть до тієї самої відповіді: місця, день, час, транспорт */
export function intentsAgree(a: TripIntent, b: TripIntent): boolean {
  const modes = (m: string[]) => [...m].sort().join(',');
  return (
    a.intent === b.intent &&
    (a.from?.id ?? null) === (b.from?.id ?? null) &&
    (a.to?.id ?? null) === (b.to?.id ?? null) &&
    a.when.day === b.when.day &&
    (a.when.time ?? null) === (b.when.time ?? null) &&
    (a.when.part ?? null) === (b.when.part ?? null) &&
    (a.when.time ? a.when.kind === b.when.kind : true) &&
    modes(a.modes) === modes(b.modes) &&
    modes(a.routes ?? []) === modes(b.routes ?? [])
  );
}

export function createAdminDovedeRouter(deps: {
  prisma: PrismaClient;
  /** undefined — з середовища (ANTHROPIC_API_KEY); null — ключа немає */
  understand?: UnderstandFn | null;
  enabled?: () => boolean;
  dailyCap?: () => number;
  now?: () => Date;
}): Router {
  const { prisma } = deps;
  const understand = deps.understand === undefined ? understandFromEnv() : deps.understand;
  const enabled = deps.enabled ?? (() => isDovedeEnabled());
  const dailyCap = deps.dailyCap ?? (() => dovedeDailyCap());
  const clock = deps.now ?? (() => new Date());
  const r = express.Router();

  /**
   * Усі зупинки й маршрути міського транспорту з бази — Claude має знати кожну, а не лише кураторський словник.
   * Той самий масив повертається до закінчення TTL (і після нього, якщо назви не змінились): промпт стабільний.
   */
  let cityCache: { at: number; key: string; stops: StopLike[]; ids: Set<string>; routes: RouteLike[]; routeIds: Set<string> } | null = null;
  const cityData = async (at: Date): Promise<{ stops: StopLike[]; ids: Set<string>; routes: RouteLike[]; routeIds: Set<string> }> => {
    if (cityCache && at.getTime() - cityCache.at < STOPS_TTL_MS) return cityCache;
    try {
      const [stopRows, routeRows] = await Promise.all([
        prisma.transportStop.findMany({ where: { cityCode: DEFAULT_TRANSPORT_CITY }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
        // «ненадійні» маршрути сайт не показує — і Claude про них не знає
        prisma.transportRoute.findMany({
          where: { cityCode: DEFAULT_TRANSPORT_CITY, unreliable: false },
          select: { id: true, shortName: true, fromName: true, toName: true },
          orderBy: { id: 'asc' },
        }),
      ]);
      const routes: RouteLike[] = routeRows.map((r) => ({ id: r.id, no: r.shortName.trim() || r.id, fromName: r.fromName.trim(), toName: r.toName.trim() }));
      const key = JSON.stringify([stopRows, routes]);
      if (cityCache && cityCache.key === key) cityCache.at = at.getTime();
      else {
        cityCache = { at: at.getTime(), key, stops: stopRows, ids: new Set(buildStopPlaces(stopRows).map((e) => e.place.id)), routes, routeIds: new Set(routes.map((r) => r.id)) };
      }
      return cityCache;
    } catch (e) {
      // без даних міста Claude знає лише кураторський словник — гірше, але відповідь буде
      console.error('❌ Dovede: не вдалося прочитати зупинки й маршрути міста:', e);
      return cityCache ?? { stops: [], ids: new Set<string>(), routes: [], routeIds: new Set<string>() };
    }
  };

  /** Журнал не має права зламати відповідь */
  const log = async (data: Prisma.DovedeQueryCreateInput): Promise<void> => {
    try {
      await prisma.dovedeQuery.create({ data });
    } catch (e) {
      console.error('❌ DovedeQuery log:', e);
    }
  };

  r.post('/admin/dovede/understand', requireAdmin, async (req, res) => {
    const body = (req.body ?? {}) as { text?: unknown; local?: unknown };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'Порожнє питання' });
      return;
    }
    if (text.length > DOVEDE_MAX_TEXT) {
      res.status(400).json({ error: `Питання задовге (до ${DOVEDE_MAX_TEXT} символів)` });
      return;
    }
    const at = clock();
    const city = await cityData(at);
    let local: TripIntent | null = null;
    if (body.local != null) {
      try {
        local = validateIntent(body.local, city.ids, city.routeIds);
      } catch (e) {
        if (!(e instanceof IntentShapeError)) throw e;
      }
    }
    const localIntent = local ? (local as unknown as Prisma.InputJsonValue) : undefined;

    try {
      if (!enabled()) {
        await log({ text, localIntent, status: 'disabled' });
        res.status(503).json({ fallback: 'local', reason: 'disabled' });
        return;
      }
      if (!understand) {
        await log({ text, localIntent, status: 'no_key' });
        res.status(503).json({ fallback: 'local', reason: 'no_key' });
        return;
      }
      if ((await aiCallsToday(prisma, at)) >= dailyCap()) {
        await log({ text, localIntent, status: 'cap' });
        res.status(429).json({ fallback: 'local', reason: 'cap' });
        return;
      }

      const result = await understand(text, kyivClock(at), city.stops, city.routes);
      const agree = result.ok && local ? intentsAgree(local, result.intent) : null;
      await log({
        text,
        localIntent,
        aiIntent: result.ok ? (result.intent as unknown as Prisma.InputJsonValue) : undefined,
        agree,
        status: result.ok ? 'ok' : result.failure,
        aiCalled: true,
        model: result.model,
        promptVersion: result.promptVersion,
        latencyMs: result.latencyMs,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        cacheReadTokens: result.usage?.cacheReadTokens,
        cacheWriteTokens: result.usage?.cacheWriteTokens,
        error: result.ok ? undefined : result.message,
      });
      if (!result.ok) {
        res.status(503).json({ fallback: 'local', reason: result.failure });
        return;
      }
      res.json({ intent: result.intent, agree, model: result.model, latencyMs: result.latencyMs });
    } catch (e) {
      console.error('❌ POST /admin/dovede/understand:', e);
      res.status(503).json({ fallback: 'local', reason: 'api_error' });
    }
  });

  return r;
}
