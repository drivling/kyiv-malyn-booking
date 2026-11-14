/**
 * API «Доведе» (Docs/dovede-roadmap.md, фаза 2 і «Доступ»): POST /dovede/understand — текст питання →
 * TripIntent від Claude. Доступ тримає сервер (`dovede/access.ts`): `DOVEDE_PUBLIC=ON` — усім, інакше пароль
 * `DOVEDE_PASSWORD` (GET /dovede/access, POST /dovede/login) або токен адміна. Будь-яка причина, з якої ШІ не
 * відповів (вимкнено, немає ключа, денний ліміт, збій API), повертається з `fallback: 'local'`: сторінка
 * тоді відповідає з місцевого розбору, людина помилки не бачить. GET /admin/dovede/queries — журнал цих питань (лише адмін).
 */
import express, { type Router } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { requireAdmin, safeEqual } from '../middleware/require-admin';
import {
  createLoginFailures,
  dovedeAccessFromEnv,
  dovedeAccessToken,
  hasDovedeAccess,
  requireDovedeAccess,
  type DovedeAccessConfig,
} from '../dovede/access';
import { kyivClock } from '../arrival-reports';
import { aiCallsToday, dovedeDailyCap, isDovedeEnabled, kyivDayStart } from '../dovede/guard';
import { DOVEDE_LOG_ROWS, DOVEDE_LOG_SCAN, parseLogDays, summarizeQueries, toLogItem, type DovedeLogFlag } from '../dovede/log';
import { IntentShapeError, isKnownPlaceId, validateIntent, type TripIntent } from '../dovede/intent';
import { SYNONYM_LIMIT, normalizePhrase, phraseProblem, type DovedeSynonymEntry } from '../dovede/synonyms';
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
    modes(a.routes ?? []) === modes(b.routes ?? []) &&
    modes(a.avoidRoutes ?? []) === modes(b.avoidRoutes ?? [])
  );
}

export function createAdminDovedeRouter(deps: {
  prisma: PrismaClient;
  /** undefined — з середовища (ANTHROPIC_API_KEY); null — ключа немає */
  understand?: UnderstandFn | null;
  enabled?: () => boolean;
  dailyCap?: () => number;
  now?: () => Date;
  /** Хто відкриває сторінку; типово з середовища (DOVEDE_PUBLIC, DOVEDE_PASSWORD) */
  access?: DovedeAccessConfig;
}): Router {
  const { prisma } = deps;
  const understand = deps.understand === undefined ? understandFromEnv() : deps.understand;
  const enabled = deps.enabled ?? (() => isDovedeEnabled());
  const dailyCap = deps.dailyCap ?? (() => dovedeDailyCap());
  const clock = deps.now ?? (() => new Date());
  const access = deps.access ?? dovedeAccessFromEnv();
  const loginFailures = createLoginFailures(() => clock().getTime());
  const r = express.Router();

  /** Чи відкривати сторінку: `open` — відкрита всім, `allowed` — цьому браузеру (токен пароля чи адміна) */
  r.get('/dovede/access', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ open: access.isPublic(), allowed: hasDovedeAccess(req, access) });
  });

  /** Пароль запрошених → токен для `X-Dovede-Token` */
  r.post('/dovede/login', (req, res) => {
    const password = access.password();
    if (!password) {
      res.status(503).json({ error: 'Вхід за паролем вимкнено' });
      return;
    }
    if (loginFailures.blocked()) {
      res.status(429).json({ error: 'Забагато спроб. Спробуйте за кілька хвилин.' });
      return;
    }
    const given = (req.body ?? {}).password;
    if (!safeEqual(given, password)) {
      loginFailures.fail();
      res.status(401).json({ error: 'Невірний пароль' });
      return;
    }
    res.json({ token: dovedeAccessToken(password) });
  });

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

  /** Синоніми з адмінки; кеш на хвилину, запис в адмінці скидає його одразу */
  let synCache: { at: number; list: DovedeSynonymEntry[] } | null = null;
  const synonyms = async (at: Date): Promise<DovedeSynonymEntry[]> => {
    if (synCache && at.getTime() - synCache.at < 60_000) return synCache.list;
    try {
      const rows = await prisma.dovedeSynonym.findMany({ select: { phrase: true, placeId: true }, orderBy: { phrase: 'asc' }, take: SYNONYM_LIMIT });
      const list = rows.map((x) => ({ phrase: x.phrase, placeId: x.placeId }));
      synCache = { at: at.getTime(), list };
      return list;
    } catch (e) {
      // без синонімів сторінка працює, як до них
      console.error('❌ Dovede: не вдалося прочитати синоніми:', e);
      return synCache?.list ?? [];
    }
  };

  /** Синоніми для сторінки: браузер розбирає з ними питання сам */
  r.get('/dovede/synonyms', requireDovedeAccess(access), async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json({ synonyms: await synonyms(clock()) });
  });

  r.get('/admin/dovede/synonyms', requireAdmin, async (_req, res) => {
    try {
      const rows = await prisma.dovedeSynonym.findMany({ orderBy: { id: 'desc' } });
      res.set('Cache-Control', 'private, no-store');
      res.json({ synonyms: rows.map((s) => ({ id: s.id, phrase: s.phrase, placeId: s.placeId, createdAt: s.createdAt.toISOString() })) });
    } catch (e) {
      console.error('❌ GET /admin/dovede/synonyms:', e);
      res.status(500).json({ error: 'Не вдалося прочитати синоніми' });
    }
  });

  /** Навчити: фраза → місце. Та сама фраза вдруге — міняє місце (одна фраза не може вести у два місця) */
  r.post('/admin/dovede/synonyms', requireAdmin, async (req, res) => {
    const body = (req.body ?? {}) as { phrase?: unknown; placeId?: unknown };
    const phrase = normalizePhrase(body.phrase);
    const placeId = typeof body.placeId === 'string' ? body.placeId.trim() : '';
    const problem = phraseProblem(phrase);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
    try {
      const city = await cityData(clock());
      if (!isKnownPlaceId(placeId, city.ids)) {
        res.status(400).json({ error: 'Такого місця немає у словнику' });
        return;
      }
      const saved = await prisma.dovedeSynonym.upsert({ where: { phrase }, create: { phrase, placeId }, update: { placeId } });
      synCache = null;
      res.json({ id: saved.id, phrase: saved.phrase, placeId: saved.placeId, createdAt: saved.createdAt.toISOString() });
    } catch (e) {
      console.error('❌ POST /admin/dovede/synonyms:', e);
      res.status(500).json({ error: 'Не вдалося зберегти синонім' });
    }
  });

  r.delete('/admin/dovede/synonyms/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Невірний id' });
      return;
    }
    try {
      await prisma.dovedeSynonym.deleteMany({ where: { id } });
      synCache = null;
      res.json({ ok: true });
    } catch (e) {
      console.error('❌ DELETE /admin/dovede/synonyms/:id:', e);
      res.status(500).json({ error: 'Не вдалося видалити синонім' });
    }
  });

  /** Журнал не має права зламати відповідь */
  const log = async (data: Prisma.DovedeQueryCreateInput): Promise<void> => {
    try {
      await prisma.dovedeQuery.create({ data });
    } catch (e) {
      console.error('❌ DovedeQuery log:', e);
    }
  };

  r.post('/dovede/understand', requireDovedeAccess(access), async (req, res) => {
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

      const result = await understand(text, kyivClock(at), city.stops, city.routes, await synonyms(at));
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
      console.error('❌ POST /dovede/understand:', e);
      res.status(503).json({ fallback: 'local', reason: 'api_error' });
    }
  });

  /**
   * Журнал питань: зведення за період (1 = сьогодні від київської півночі, 7 / 30 / 90 днів) і останні рядки.
   * `only=problems` лишає в таблиці лише питання з позначками (збій, розбіжність, невпізнані слова, без місця).
   */
  r.get('/admin/dovede/queries', requireAdmin, async (req, res) => {
    try {
      const days = parseLogDays(req.query.days);
      const at = clock();
      const today = kyivDayStart(at);
      const since = new Date(today.getTime() - (days - 1) * 24 * 60 * 60_000);
      const [rows, callsToday] = await Promise.all([
        prisma.dovedeQuery.findMany({ where: { createdAt: { gte: since } }, orderBy: { id: 'desc' }, take: DOVEDE_LOG_SCAN }),
        aiCallsToday(prisma, at),
      ]);
      const flag = typeof req.query.only === 'string' ? req.query.only : '';
      const items = rows.map(toLogItem).filter((it) => {
        if (!flag) return true;
        if (flag === 'problems') return it.flags.length > 0;
        return it.flags.includes(flag as DovedeLogFlag);
      });
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        days,
        since: since.toISOString(),
        enabled: enabled(),
        hasKey: understand != null,
        dailyCap: dailyCap(),
        callsToday,
        truncated: rows.length >= DOVEDE_LOG_SCAN,
        summary: summarizeQueries(rows),
        matched: items.length,
        items: items.slice(0, DOVEDE_LOG_ROWS),
      });
    } catch (e) {
      console.error('❌ GET /admin/dovede/queries:', e);
      res.status(500).json({ error: 'Не вдалося прочитати журнал' });
    }
  });

  return r;
}
