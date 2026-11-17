/**
 * API «Доведе» (Docs/dovede-roadmap.md, фаза 2 і «Доступ»): POST /dovede/understand — текст питання →
 * TripIntent від Claude. Доступ тримає сервер (`dovede/access.ts`): `DOVEDE_PUBLIC=ON` — усім, інакше пароль
 * `DOVEDE_PASSWORD` (GET /dovede/access, POST /dovede/login) або токен адміна. Будь-яка причина, з якої ШІ не
 * відповів (вимкнено, немає ключа, денний ліміт, збій API), повертається з `fallback: 'local'`: сторінка
 * тоді відповідає з місцевого розбору, людина помилки не бачить. GET /admin/dovede/queries — журнал цих питань (лише адмін).
 */
import express, { type Router } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
import { isAdminRequest, requireAdmin, safeEqual } from '../middleware/require-admin';
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
import { DEFAULT_CAR_MINUTES, driveTimeFromEnv, type DriveTimeFn } from '../drive-time';
import { CITY_FRESH_DAYS_MAX, CITY_FRESH_DAYS_MIN, cityRoutesFromEnv, isValidFreshDays, type CityCode, type CityRoutes } from '../dovede/city-route';
import { kyivWallToUtc } from '../viber-listing-expiry';

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
    // місце в іншому місті словами: словник і Claude пишуть його в різних відмінках — звіряємо лише, чи воно є
    Boolean(a.from?.detail) === Boolean(b.from?.detail) &&
    Boolean(a.to?.detail) === Boolean(b.to?.detail) &&
    a.when.day === b.when.day &&
    (a.when.time ?? null) === (b.when.time ?? null) &&
    (a.when.part ?? null) === (b.when.part ?? null) &&
    (a.when.time ? a.when.kind === b.when.kind : true) &&
    modes(a.modes) === modes(b.modes) &&
    modes(a.routes ?? []) === modes(b.routes ?? []) &&
    modes(a.avoidRoutes ?? []) === modes(b.avoidRoutes ?? [])
  );
}

/**
 * Примітка для підрахунку «Звідки забирають»: без чужих контактів — посилань, ніків Telegram і телефонів.
 * Порожні після цього частини («; ;») прибираємо.
 */
export function pickupNote(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(t\.me|telegram\.me|viber\.me)\/\S+/gi, ' ')
    .replace(/(^|\s)@[A-Za-z0-9_]{3,}/g, ' ')
    .replace(/\+?\d[\d\s()-]{8,}\d/g, ' ')
    .split(';')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part && !/^[\s().,:-]*$/.test(part))
    .join('; ');
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
  /** Час у дорозі авто; типово Google Routes за ключем із середовища, інакше сталий */
  driveTime?: DriveTimeFn;
  /** Дорога містом (Київ, Житомир) з памʼяттю в базі; типово — з середовища */
  cityRoutes?: CityRoutes;
}): Router {
  const { prisma } = deps;
  const understand = deps.understand === undefined ? understandFromEnv() : deps.understand;
  const enabled = deps.enabled ?? (() => isDovedeEnabled());
  const dailyCap = deps.dailyCap ?? (() => dovedeDailyCap());
  const clock = deps.now ?? (() => new Date());
  const access = deps.access ?? dovedeAccessFromEnv();
  const loginFailures = createLoginFailures(() => clock().getTime());
  const driveTime = deps.driveTime ?? driveTimeFromEnv();
  const cityRoutes = deps.cityRoutes ?? cityRoutesFromEnv(prisma);
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

  /**
   * Скільки їде попутка: `times` — години виїзду за Києвом (до шести). За доступом «Доведе», бо за ним стоїть
   * платний сервіс. Сталий час — з маршруту в адмінці; `source` каже, чи врахувано затори.
   */
  r.get('/dovede/drive-time', requireDovedeAccess(access), async (req, res) => {
    const from = String(req.query.from ?? '').trim();
    const to = String(req.query.to ?? '').trim();
    const date = String(req.query.date ?? '').trim();
    const times = [...new Set(String(req.query.times ?? '').split(',').map((t) => t.trim()).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))].slice(0, 6);
    if (!/^[A-Za-z]{2,20}$/.test(from) || !/^[A-Za-z]{2,20}$/.test(to) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'from, to та date (YYYY-MM-DD) обовʼязкові' });
      return;
    }
    let fixedMinutes = DEFAULT_CAR_MINUTES;
    try {
      const route = await prisma.tripRoute.findUnique({ where: { slug: `${from}-${to}` }, select: { carDurationMinutes: true } });
      if (route?.carDurationMinutes) fixedMinutes = route.carDurationMinutes;
    } catch (e) {
      console.error('❌ GET /dovede/drive-time: маршрут не прочитано, беру типовий час:', e);
    }
    const [y, m, d] = date.split('-').map(Number);
    // години питаємо разом: кожна має свій тайм-аут, людина не чекає їх по черзі
    const got = await Promise.all(
      times.map((t) => {
        const [hh, mm] = t.split(':').map(Number);
        return driveTime({ fromCode: from, toCode: to, departAt: kyivWallToUtc(y, m - 1, d, hh, mm), fixedMinutes });
      }),
    );
    const minutes: Record<string, number> = {};
    times.forEach((t, i) => (minutes[t] = got[i].minutes));
    const source: 'traffic' | 'fixed' = got.some((g) => g.source === 'traffic') ? 'traffic' : 'fixed';
    res.set('Cache-Control', 'private, no-store');
    res.json({ fixedMinutes, source, minutes });
  });

  /**
   * Дорога містом між двома точками (Київ, Житомир): з нашої бази, а коли там немає — від Google, і тоді відповідь
   * лягає в базу. `from` / `to` — id відомої точки («zhytomyr.avtovokzal», «kyiv.akadem») або слова людини.
   * Будь-яка невдача — 200 з `{ ok: false, fallback: 'maps' }`: сторінка показує посилання Google Maps.
   * `learn=1` з токеном адміна — навчання (`npm run dovede:crawl`): відповідь та сама й так само лягає в базу, але
   * попит людей не рахується. Без токена адміна прапорець нічого не міняє.
   */
  r.get('/dovede/city-route', requireDovedeAccess(access), async (req, res) => {
    const city = String(req.query.city ?? '').trim();
    const from = String(req.query.from ?? '').trim();
    const to = String(req.query.to ?? '').trim();
    const date = String(req.query.date ?? '').trim();
    const time = String(req.query.time ?? '').trim();
    if ((city !== 'Kyiv' && city !== 'Zhytomyr') || !from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      res.status(400).json({ error: 'city (Kyiv | Zhytomyr), from, to, date (YYYY-MM-DD) і time (HH:MM) обовʼязкові' });
      return;
    }
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    res.set('Cache-Control', 'private, no-store');
    try {
      const learn = String(req.query.learn ?? '') === '1' && isAdminRequest(req);
      res.json(await cityRoutes.find({ city: city as CityCode, from, to, date, time, departAt: kyivWallToUtc(y, m - 1, d, hh, mm) }, learn));
    } catch (e) {
      console.error('❌ GET /dovede/city-route:', e);
      res.json({ ok: false, fallback: 'maps', reason: 'error' });
    }
  });

  /** Адмінка «Місто: що вже знаємо»: лічильники, попит, архів */
  r.get('/admin/dovede/city', requireAdmin, async (_req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json(await cityRoutes.stats());
    } catch (e) {
      console.error('❌ GET /admin/dovede/city:', e);
      res.status(500).json({ error: 'Не вдалося прочитати дані міста' });
    }
  });

  /** Один крок навчання зараз (той самий, що робить таймер) */
  r.post('/admin/dovede/city/learn', requireAdmin, async (_req, res) => {
    try {
      res.json(await cityRoutes.learnTick(5));
    } catch (e) {
      console.error('❌ POST /admin/dovede/city/learn:', e);
      res.status(500).json({ error: 'Не вдалося оновити' });
    }
  });

  /** Обнуляє лічильник попиту «Що питають найчастіше» (після прогону самонавчання). Рядки й збережені дороги лишаються */
  r.post('/admin/dovede/city/demand/reset', requireAdmin, async (_req, res) => {
    try {
      res.json(await cityRoutes.resetDemand());
    } catch (e) {
      console.error('❌ POST /admin/dovede/city/demand/reset:', e);
      res.status(500).json({ error: 'Не вдалося скинути лічильник' });
    }
  });

  /** Скільки днів збережена відповідь вважається свіжою (далі сервер питає Google знову) */
  r.put('/admin/dovede/city/settings', requireAdmin, async (req, res) => {
    const freshDays = req.body?.freshDays;
    if (!isValidFreshDays(freshDays)) {
      res.status(400).json({ error: `freshDays: ціле число від ${CITY_FRESH_DAYS_MIN} до ${CITY_FRESH_DAYS_MAX}` });
      return;
    }
    try {
      res.json({ freshDays: await cityRoutes.setFreshDays(freshDays) });
    } catch (e) {
      console.error('❌ PUT /admin/dovede/city/settings:', e);
      res.status(500).json({ error: 'Не вдалося зберегти' });
    }
  });

  /** Архівує все, що з Google, або повертає з архіву. Нічого не видаляє; дані власника не чіпає */
  r.post('/admin/dovede/city/archive', requireAdmin, async (req, res) => {
    const action = String(req.body?.action ?? '');
    if (action !== 'archive' && action !== 'restore') {
      res.status(400).json({ error: 'action: archive | restore' });
      return;
    }
    try {
      res.json({ action, ...(action === 'archive' ? await cityRoutes.archiveGoogle() : await cityRoutes.restoreGoogle()) });
    } catch (e) {
      console.error('❌ POST /admin/dovede/city/archive:', e);
      res.status(500).json({ error: 'Не вдалося' });
    }
  });

  /**
   * «Звідки забирають попутки»: примітки оголошень водіїв за період, згруповані за напрямком і текстом.
   * Без імен і телефонів; місця в примітках розбирає адмінка тим самим словником, що й сторінка.
   */
  r.get('/admin/dovede/pickups', requireAdmin, async (req, res) => {
    try {
      const days = parseLogDays(req.query.days ?? 90);
      const since = new Date(clock().getTime() - days * 24 * 60 * 60_000);
      const rows = await prisma.viberListing.findMany({ where: { listingType: 'driver', createdAt: { gte: since } }, select: { route: true, notes: true }, take: 20000 });
      const groups = new Map<string, { route: string; note: string; count: number }>();
      const byRoute = new Map<string, { route: string; total: number; withNote: number }>();
      for (const row of rows) {
        const note = pickupNote(row.notes);
        const r0 = byRoute.get(row.route) ?? { route: row.route, total: 0, withNote: 0 };
        r0.total++;
        if (note) r0.withNote++;
        byRoute.set(row.route, r0);
        if (!note) continue;
        const key = `${row.route}|${note.toLowerCase()}`;
        const g = groups.get(key);
        if (g) g.count++;
        else groups.set(key, { route: row.route, note, count: 1 });
      }
      res.set('Cache-Control', 'private, no-store');
      res.json({
        days,
        total: rows.length,
        routes: [...byRoute.values()].sort((a, b) => b.total - a.total),
        notes: [...groups.values()].sort((a, b) => b.count - a.count || a.note.localeCompare(b.note, 'uk')).slice(0, 1000),
      });
    } catch (e) {
      console.error('❌ GET /admin/dovede/pickups:', e);
      res.status(500).json({ error: 'Не вдалося прочитати оголошення' });
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
