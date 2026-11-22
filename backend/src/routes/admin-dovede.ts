/**
 * API «Доведе» (Docs/dovede-roadmap.md, фаза 2 і «Доступ»): POST /dovede/understand — текст питання →
 * TripIntent від Claude. Доступ тримає сервер (`dovede/access.ts`): `DOVEDE_PUBLIC=ON` — усім, інакше пароль
 * `DOVEDE_PASSWORD` (GET /dovede/access, POST /dovede/login) або токен адміна. Будь-яка причина, з якої ШІ не
 * відповів (вимкнено, немає ключа, денний ліміт, збій API), повертається з `fallback: 'local'`: сторінка
 * тоді відповідає з місцевого розбору, людина помилки не бачить. GET /admin/dovede/queries — журнал цих питань (лише адмін).
 */
import express, { type Response, type Router } from 'express';
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
import { aiCallsToday, kyivDayStart } from '../dovede/guard';
import { DOVEDE_SETTINGS, SETTING_GROUP_LABEL, confirmNeeded, createDovedeSettings, settingDef, validSettingValue, type DovedeSettings, type SettingDef } from '../dovede/settings';
import { DOVEDE_LOG_ROWS, DOVEDE_LOG_SCAN, parseLogDays, summarizeQueries, toLogItem, type DovedeLogFlag } from '../dovede/log';
import { IntentShapeError, isKnownPlaceId, validateIntent, type TripIntent } from '../dovede/intent';
import { SYNONYM_LIMIT, normalizePhrase, phraseProblem, type DovedeSynonymEntry } from '../dovede/synonyms';
import { understandFromEnv, type UnderstandCity, type UnderstandFn } from '../dovede/understand';
import { korostenPlaceIds } from '../dovede/korosten-prompt';
import type { RouteLike } from '../dovede/prompt';
import { buildStopPlaces, type StopLike } from '../dovede/stopPlaces';
import { DEFAULT_TRANSPORT_CITY } from '../transport-city';
import { DEFAULT_CAR_MINUTES, createDriveTime, type DriveTimeFn } from '../drive-time';
import { CITY_DAILY_CAP_MAX, CITY_DAILY_CAP_MIN, CITY_FRESH_DAYS_MAX, CITY_FRESH_DAYS_MIN, cityRoutesFromEnv, isValidDailyCap, isValidFreshDays, type CityCode, type CityRoutes } from '../dovede/city-route';
import { kyivWallToUtc } from '../viber-listing-expiry';
import { CampaignInputError, createCityCampaigns, type CampaignInput, type CityCampaigns } from '../dovede/city-campaign';
import { createCityQuality, type CityQuality } from '../dovede/city-quality';
import { LEARN_CITIES, LEARN_CITY_CODES, LEARN_CITY_LIST, isLearnCity } from '../dovede/learn-cities';
import { createDovedePageData, type DovedePageData } from '../dovede/page-data';

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

/** Значення понад м'яку межу без `confirm: true`: 409 і текст попередження — адмінка покаже його й спитає ще раз */
function unconfirmed(res: Response, def: SettingDef): void {
  res.status(409).json({ error: def.warn ?? `Понад ${def.warnAbove} — потрібне підтвердження`, confirm: 'required', warnAbove: def.warnAbove });
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
  /** Налаштування з адмінки (розділ «Налаштування»); той самий обʼєкт, що в `cityRoutes` (index.ts) */
  settings?: DovedeSettings;
  /** Кампанії навчання міста; той самий обʼєкт, що веде фонова задача (index.ts) */
  campaigns?: CityCampaigns;
  /** Звіт якості навчання (підозрілі дороги) */
  quality?: CityQuality;
  /** Дані сторінки, які власник міняє сам (метро-замінник, години й тариф метро) */
  pageData?: DovedePageData;
}): Router {
  const { prisma } = deps;
  const understand = deps.understand === undefined ? understandFromEnv() : deps.understand;
  const clock = deps.now ?? (() => new Date());
  const settings = deps.settings ?? createDovedeSettings({ prisma, now: clock });
  // ШІ-розбір і його денний ліміт — з налаштувань адмінки (головний вимикач DOVEDE_ENABLED — там же); у тестах — заглушки
  const enabled = async (): Promise<boolean> => (deps.enabled ? deps.enabled() : settings.bool('ai.enabled'));
  const dailyCap = async (): Promise<number> => (deps.dailyCap ? deps.dailyCap() : settings.int('ai.dailyCap'));
  const access = deps.access ?? dovedeAccessFromEnv();
  const loginFailures = createLoginFailures(() => clock().getTime());
  const driveTime = deps.driveTime ?? createDriveTime({ key: () => (process.env.GOOGLE_MAPS_API_KEY ?? '').trim() || null, dailyCap: () => settings.int('drive.dailyCap') });
  const cityRoutes = deps.cityRoutes ?? cityRoutesFromEnv(prisma, settings);
  const campaigns = deps.campaigns ?? createCityCampaigns({ prisma, cityRoutes, settings, now: clock });
  const quality = deps.quality ?? createCityQuality(prisma);
  const pageData = deps.pageData ?? createDovedePageData({ prisma, now: clock });
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
  type CityData = { at: number; key: string; stops: StopLike[]; ids: Set<string>; routes: RouteLike[]; routeIds: Set<string> };
  // окремо для кожного міста питань: Малин (з коридорами) і Коростень (етап 2)
  const cityCaches = new Map<UnderstandCity, CityData>();
  const cityData = async (at: Date, city: UnderstandCity = 'Malyn'): Promise<{ stops: StopLike[]; ids: Set<string>; routes: RouteLike[]; routeIds: Set<string> }> => {
    const cityCache = cityCaches.get(city) ?? null;
    if (cityCache && at.getTime() - cityCache.at < STOPS_TTL_MS) return cityCache;
    const cityCode = city === 'Korosten' ? 'Korosten' : DEFAULT_TRANSPORT_CITY;
    try {
      const [stopRows, routeRows] = await Promise.all([
        prisma.transportStop.findMany({ where: { cityCode }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
        // «ненадійні» маршрути сайт не показує — і Claude про них не знає
        prisma.transportRoute.findMany({
          where: { cityCode, unreliable: false },
          select: { id: true, shortName: true, fromName: true, toName: true },
          orderBy: { id: 'asc' },
        }),
      ]);
      const routes: RouteLike[] = routeRows.map((r) => ({ id: r.id, no: r.shortName.trim() || r.id, fromName: r.fromName.trim(), toName: r.toName.trim() }));
      const key = JSON.stringify([stopRows, routes]);
      if (cityCache && cityCache.key === key) {
        cityCache.at = at.getTime();
        return cityCache;
      }
      const ids = city === 'Korosten' ? korostenPlaceIds(stopRows) : new Set(buildStopPlaces(stopRows).map((e) => e.place.id));
      const next: CityData = { at: at.getTime(), key, stops: stopRows, ids, routes, routeIds: new Set(routes.map((r) => r.id)) };
      cityCaches.set(city, next);
      return next;
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

  /** Дані сторінки, змінені в адмінці (крок 11): лише змінені ключі; решта — типові з коду сторінки */
  r.get('/dovede/page-data', requireDovedeAccess(access), async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json({ values: await pageData.values() });
  });

  r.get('/admin/dovede/page-data', requireAdmin, async (_req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json({ items: await pageData.list() });
    } catch (e) {
      console.error('❌ GET /admin/dovede/page-data:', e);
      res.status(500).json({ error: 'Не вдалося прочитати дані сторінки' });
    }
  });

  /** `{ key, value }` — змінити; `{ key, reset: true }` — повернути типове з коду */
  r.put('/admin/dovede/page-data', requireAdmin, async (req, res) => {
    const b = (req.body ?? {}) as { key?: unknown; value?: unknown; reset?: unknown };
    if (typeof b.key !== 'string' || (b.reset !== true && !('value' in b))) {
      res.status(400).json({ error: 'потрібні key і value (або reset: true)' });
      return;
    }
    try {
      res.json(await pageData.set(b.key, b.value, b.reset === true));
    } catch (e) {
      if (e instanceof RangeError) {
        res.status(400).json({ error: e.message });
        return;
      }
      console.error('❌ PUT /admin/dovede/page-data:', e);
      res.status(500).json({ error: 'Не вдалося зберегти' });
    }
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
    if (!isLearnCity(city) || !from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      res.status(400).json({ error: `city (${LEARN_CITY_LIST}), from, to, date (YYYY-MM-DD) і time (HH:MM) обовʼязкові` });
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

  /** Міста навчання (реєстр `learn-cities.ts`): адмінка бере список звідси, а не з власного переліку */
  r.get('/admin/dovede/city/cities', requireAdmin, (_req, res) => {
    res.json({ cities: LEARN_CITIES.map((c) => ({ code: c.code, name: c.name, genitive: c.genitive })) });
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
  // ── Кампанії навчання міста (Docs/dovede-admin-roadmap.md, крок 6) ─────────────────────────────────────────────
  // Заготовки → оцінка (скільки запитів до Google) → власник погоджує бюджет → сервер обходить сам (city-campaign.ts)

  r.get('/admin/dovede/city/campaigns/presets', requireAdmin, (_req, res) => {
    res.json({ presets: campaigns.presets() });
  });

  const campaignInput = (body: unknown): CampaignInput => {
    const b = (body ?? {}) as Record<string, unknown>;
    return {
      preset: String(b.preset ?? ''),
      city: String(b.city ?? ''),
      ...(b.options && typeof b.options === 'object' ? { options: b.options as CampaignInput['options'] } : {}),
      ...(b.budget !== undefined ? { budget: b.budget as number } : {}),
      ...(b.dailyBudget !== undefined ? { dailyBudget: b.dailyBudget as number } : {}),
    };
  };

  r.post('/admin/dovede/city/campaigns/preview', requireAdmin, async (req, res) => {
    try {
      res.json(await campaigns.preview(campaignInput(req.body)));
    } catch (e) {
      if (e instanceof CampaignInputError) {
        res.status(400).json({ error: e.message });
        return;
      }
      console.error('❌ POST /admin/dovede/city/campaigns/preview:', e);
      res.status(500).json({ error: 'Не вдалося оцінити' });
    }
  });

  r.post('/admin/dovede/city/campaigns', requireAdmin, async (req, res) => {
    try {
      res.status(201).json(await campaigns.create(campaignInput(req.body)));
    } catch (e) {
      if (e instanceof CampaignInputError) {
        res.status(400).json({ error: e.message });
        return;
      }
      console.error('❌ POST /admin/dovede/city/campaigns:', e);
      res.status(500).json({ error: 'Не вдалося запустити' });
    }
  });

  r.get('/admin/dovede/city/campaigns', requireAdmin, async (_req, res) => {
    try {
      res.json(await campaigns.list());
    } catch (e) {
      console.error('❌ GET /admin/dovede/city/campaigns:', e);
      res.status(500).json({ error: 'Не вдалося завантажити' });
    }
  });

  r.get('/admin/dovede/city/campaigns/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'Невірний id' });
      return;
    }
    try {
      const c = await campaigns.get(id);
      if (!c) {
        res.status(404).json({ error: 'Такої кампанії немає' });
        return;
      }
      res.json(c);
    } catch (e) {
      console.error('❌ GET /admin/dovede/city/campaigns/:id:', e);
      res.status(500).json({ error: 'Не вдалося завантажити' });
    }
  });

  r.post('/admin/dovede/city/campaigns/:id/action', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const b = (req.body ?? {}) as { action?: unknown; budget?: number; dailyBudget?: number };
    const act = b.action;
    if (!Number.isInteger(id) || id < 1 || !(act === 'pause' || act === 'resume' || act === 'cancel' || act === 'extend' || act === 'archive')) {
      res.status(400).json({ error: 'action: pause | resume | cancel | extend | archive' });
      return;
    }
    try {
      const r2 = await campaigns.action(id, act, { budget: b.budget, dailyBudget: b.dailyBudget });
      if (r2 === null) res.status(404).json({ error: 'Такої кампанії немає' });
      else if (typeof r2 === 'string') res.status(409).json({ error: r2 });
      else res.json(r2);
    } catch (e) {
      console.error('❌ POST /admin/dovede/city/campaigns/:id/action:', e);
      res.status(500).json({ error: 'Не вдалося' });
    }
  });

  /** Звіт якості (крок 8): підозрілі дороги в базі; `?city=Kyiv|Zhytomyr`, без нього — обидва міста */
  r.get('/admin/dovede/city/quality', requireAdmin, async (req, res) => {
    const raw = String(req.query.city ?? '');
    if (raw && !isLearnCity(raw)) {
      res.status(400).json({ error: `city: ${LEARN_CITY_CODES.join(' або ')}` });
      return;
    }
    try {
      res.json(await quality.report(raw && isLearnCity(raw) ? raw : undefined));
    } catch (e) {
      console.error('❌ GET /admin/dovede/city/quality:', e);
      res.status(500).json({ error: 'Не вдалося зібрати звіт' });
    }
  });

  /** «Нормально» у звіті якості: `{ city, key, ok }` — місце більше не показується серед підозрілих (ok: false — знову) */
  r.post('/admin/dovede/city/place/ok', requireAdmin, async (req, res) => {
    const b = (req.body ?? {}) as { city?: unknown; key?: unknown; ok?: unknown };
    if (!isLearnCity(b.city) || typeof b.key !== 'string' || !b.key.trim() || typeof b.ok !== 'boolean') {
      res.status(400).json({ error: `city (${LEARN_CITY_LIST}), key і ok (true | false) обовʼязкові` });
      return;
    }
    try {
      const done = await quality.markOk(b.city, b.key.trim(), b.ok);
      if (!done) {
        res.status(404).json({ error: 'Такого місця серед збережених доріг немає' });
        return;
      }
      res.json({ city: b.city, key: b.key.trim(), ok: b.ok });
    } catch (e) {
      console.error('❌ POST /admin/dovede/city/place/ok:', e);
      res.status(500).json({ error: 'Не вдалося' });
    }
  });

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
    const body = (req.body ?? {}) as { freshDays?: unknown; dailyCap?: unknown; confirm?: unknown };
    const hasFresh = 'freshDays' in body;
    const hasCap = 'dailyCap' in body;
    if (!hasFresh && !hasCap) {
      res.status(400).json({ error: 'потрібне freshDays або dailyCap' });
      return;
    }
    if (hasFresh && !isValidFreshDays(body.freshDays)) {
      res.status(400).json({ error: `freshDays: ціле число від ${CITY_FRESH_DAYS_MIN} до ${CITY_FRESH_DAYS_MAX}` });
      return;
    }
    // dailyCap: null — повернути ліміт зі змінної середовища
    if (hasCap && body.dailyCap !== null && !isValidDailyCap(body.dailyCap)) {
      res.status(400).json({ error: `dailyCap: ціле число від ${CITY_DAILY_CAP_MIN} до ${CITY_DAILY_CAP_MAX} або null` });
      return;
    }
    const capDef = settingDef('city.dailyCap')!;
    if (hasCap && confirmNeeded(capDef, body.dailyCap) && body.confirm !== true) {
      unconfirmed(res, capDef);
      return;
    }
    try {
      const out: { freshDays?: number; dailyCap?: number } = {};
      if (hasFresh) out.freshDays = await cityRoutes.setFreshDays(body.freshDays as number);
      if (hasCap) out.dailyCap = await cityRoutes.setDailyCap(body.dailyCap as number | null);
      res.json(out);
    } catch (e) {
      console.error('❌ PUT /admin/dovede/city/settings:', e);
      res.status(500).json({ error: 'Не вдалося зберегти' });
    }
  });

  /**
   * Розділ «Налаштування»: усі налаштування «Доведе» з тим, що діє зараз, типовим (змінна середовища чи код), що задав
   * власник і чи вимкнено вмикач на сервері. Ключів і паролів тут немає.
   */
  r.get('/admin/dovede/settings', requireAdmin, async (_req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json({ items: await settings.all(), groups: SETTING_GROUP_LABEL });
    } catch (e) {
      console.error('❌ GET /admin/dovede/settings:', e);
      res.status(500).json({ error: 'Не вдалося прочитати налаштування' });
    }
  });

  /** Одне налаштування: `{ key, value }`; `value: null` — повернути типове. Межі — з переліку `DOVEDE_SETTINGS` */
  r.put('/admin/dovede/settings', requireAdmin, async (req, res) => {
    const body = (req.body ?? {}) as { key?: unknown; value?: unknown; confirm?: unknown };
    const def = typeof body.key === 'string' ? DOVEDE_SETTINGS.find((d) => d.key === body.key) : undefined;
    if (!def) {
      res.status(400).json({ error: 'key: невідоме налаштування' });
      return;
    }
    if (!('value' in body) || (body.value !== null && !validSettingValue(def, body.value))) {
      res.status(400).json({ error: def.kind === 'bool' ? 'value: true, false або null' : `value: ціле від ${def.min} до ${def.max} або null` });
      return;
    }
    // понад м'яку межу (запити до Google понад 20 000 на день) — лише після попередження в адмінці
    if (confirmNeeded(def, body.value) && body.confirm !== true) {
      unconfirmed(res, def);
      return;
    }
    try {
      res.json(await settings.set(def.key, body.value as number | boolean | null));
    } catch (e) {
      console.error('❌ PUT /admin/dovede/settings:', e);
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

  /** Місця словами зі збереженими дорогами й місця в архіві — щоб прибрати одне місце з неправильною відповіддю */
  /** Дороги одного місця: `?city=Kyiv|Zhytomyr&key=<ключ місця>` (розгортка в «Місця») */
  r.get('/admin/dovede/city/place/routes', requireAdmin, async (req, res) => {
    const city = String(req.query.city ?? '');
    const key = String(req.query.key ?? '').trim();
    if (!isLearnCity(city) || !key || key.length > 200) {
      res.status(400).json({ error: `city (${LEARN_CITY_LIST}) і key обовʼязкові` });
      return;
    }
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json({ routes: await cityRoutes.placeRouteList(city, key) });
    } catch (e) {
      console.error('❌ GET /admin/dovede/city/place/routes:', e);
      res.status(500).json({ error: 'Не вдалося прочитати дороги місця' });
    }
  });

  /** Що питають люди: `?city=Kyiv|Zhytomyr&only=unanswered` — усі пари (до 500), найчастіші першими */
  r.get('/admin/dovede/city/demand', requireAdmin, async (req, res) => {
    const city = String(req.query.city ?? '');
    const only = String(req.query.only ?? '');
    if ((city && !isLearnCity(city)) || (only && only !== 'unanswered')) {
      res.status(400).json({ error: `city: ${LEARN_CITY_LIST}; only: unanswered` });
      return;
    }
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json({ demand: await cityRoutes.demandList(city ? (city as CityCode) : null, only === 'unanswered') });
    } catch (e) {
      console.error('❌ GET /admin/dovede/city/demand:', e);
      res.status(500).json({ error: 'Не вдалося прочитати попит' });
    }
  });

  r.get('/admin/dovede/city/places', requireAdmin, async (_req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      res.json({ places: await cityRoutes.places() });
    } catch (e) {
      console.error('❌ GET /admin/dovede/city/places:', e);
      res.status(500).json({ error: 'Не вдалося прочитати місця' });
    }
  });

  /**
   * Архів одного місця або повернення з нього: `{ city, key, action: archive | restore }`. Дороги цього місця не
   * видаляються; поки воно в архіві, сервер про нього не відповідає й Google не питає.
   */
  r.post('/admin/dovede/city/place/archive', requireAdmin, async (req, res) => {
    const city = String(req.body?.city ?? '');
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    const action = String(req.body?.action ?? '');
    if (!isLearnCity(city) || (action !== 'archive' && action !== 'restore')) {
      res.status(400).json({ error: `city: ${LEARN_CITY_LIST}, action: archive | restore` });
      return;
    }
    try {
      const done = action === 'archive' ? await cityRoutes.archivePlace(city, key) : await cityRoutes.restorePlace(city, key);
      if (!done) {
        res.status(400).json({ error: 'key: місце словами (не id точки посадки чи станції метро)' });
        return;
      }
      res.json({ action, ...done });
    } catch (e) {
      console.error('❌ POST /admin/dovede/city/place/archive:', e);
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
    const body = (req.body ?? {}) as { text?: unknown; local?: unknown; city?: unknown };
    // Коростень (етап 2): свій промпт і свої зупинки; будь-що інше — Малин, як і раніше
    const askCity: UnderstandCity = body.city === 'Korosten' ? 'Korosten' : 'Malyn';
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
    const city = await cityData(at, askCity);
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
      if (!(await enabled())) {
        await log({ text, localIntent, status: 'disabled' });
        res.status(503).json({ fallback: 'local', reason: 'disabled' });
        return;
      }
      if (!understand) {
        await log({ text, localIntent, status: 'no_key' });
        res.status(503).json({ fallback: 'local', reason: 'no_key' });
        return;
      }
      if ((await aiCallsToday(prisma, at)) >= (await dailyCap())) {
        await log({ text, localIntent, status: 'cap' });
        res.status(429).json({ fallback: 'local', reason: 'cap' });
        return;
      }

      // синоніми з адмінки ведуть до місць Малина — Коростеню вони не потрібні
      const result = await understand(text, kyivClock(at), city.stops, city.routes, askCity === 'Korosten' ? [] : await synonyms(at), askCity);
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
        enabled: await enabled(),
        hasKey: understand != null,
        dailyCap: await dailyCap(),
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
