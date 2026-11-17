/**
 * Облік реклами «Доведе» (Docs/dovede-roadmap.md, «Облік реклами»): міні-тизер перед табло зупинки після скану
 * наклейки (placement `sticker`) і ролик-вступ /dovede (`dovede`). Браузер шле події перегляду — shown (показали),
 * started (почав грати), completed (досмотрів) — і лише для /dovede: page — відкрив сторінку з доступом (хто саме —
 * адмін, гість із паролем, усі — визначає сервер за заголовками), punched — прокомпостував талон після ролика (доступ
 * не потрібен, хто — так само, якщо заголовок є). Стіна наклейок (/admin/wall, вкладка «Реклама» і святкування
 * «квиток») читає зведення.
 */
import type { PrismaClient } from '@prisma/client';
import { kyivDayHour } from './sticker-scans';

export const AD_PLACEMENTS = ['sticker', 'dovede'] as const;
export const AD_EVENTS = ['shown', 'started', 'completed', 'page', 'punched'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];
export type AdEventName = (typeof AD_EVENTS)[number];
export type AdDevice = 'ios' | 'android' | 'desktop' | 'other';

export interface AdEventInput {
  placement: AdPlacement;
  event: AdEventName;
  viewId: string;
  clientId: string | null;
  video: string | null;
  stopId: string | null;
}

const ID = /^[A-Za-z0-9-]{8,64}$/;
const STOP = /^[A-Za-z0-9_-]{1,40}$/;
const VIDEO = /^[a-z0-9-]{1,40}$/;

/** Тіло POST /ads/events; null — 400 */
export function parseAdEvent(body: unknown): AdEventInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const placement = AD_PLACEMENTS.find((p) => p === b.placement);
  const event = AD_EVENTS.find((e) => e === b.event);
  if (!placement || !event) return null;
  // «відкрив сторінку з доступом» і талон після ролика бувають лише в «Доведе»
  if ((event === 'page' || event === 'punched') && placement !== 'dovede') return null;
  if (typeof b.viewId !== 'string' || !ID.test(b.viewId)) return null;
  const clientId = typeof b.clientId === 'string' && ID.test(b.clientId) ? b.clientId : null;
  const video = typeof b.video === 'string' && VIDEO.test(b.video) ? b.video : null;
  let stopId: string | null = null;
  if (placement === 'sticker') {
    if (typeof b.stopId !== 'string' || !STOP.test(b.stopId)) return null;
    stopId = b.stopId;
  }
  return { placement, event, viewId: b.viewId, clientId, video, stopId };
}

/** Лише клас пристрою з User-Agent — не відбиток */
export function deviceOf(userAgent: unknown): AdDevice {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Macintosh|X11|Linux|CrOS/i.test(ua)) return 'desktop';
  return 'other';
}

type Counts = { shown: number; started: number; completed: number };
type AccessCounts = { admin: number; guest: number; public: number };
export interface AdWallView {
  viewId: string;
  placement: AdPlacement;
  /** page — вхід на /dovede з доступом, view — перегляд ролика */
  kind: 'view' | 'page';
  stopId: string | null;
  device: string | null;
  /** Останні 4 символи анонімного id браузера — щоб бачити, що це та сама людина */
  who: string | null;
  /** Номер пасажира з наклейок (StickerPerson у місті стіни), якщо цей браузер приходив із наклейки */
  number: number | null;
  /** Скільки разів цей браузер уже бачив рекламу до цього перегляду (повернувся) */
  seenBefore: number;
  access: string | null;
  at: string;
  started: boolean;
  completed: boolean;
  /** Лише «Доведе»: прокомпостував талон після ролика */
  punched: boolean;
}
export interface AdWallSnapshot {
  now: string;
  day: string;
  sticker: { today: Counts; total: Counts; people: number };
  dovede: {
    /** punched — прокомпостували талон після ролика */
    today: Counts & { pages: number; punched: number };
    total: Counts & { pages: number; punched: number };
    /** Входи на /dovede за 91 день і сьогодні — хто: адмін, гість із паролем, усі (відкрито) */
    access: AccessCounts;
    todayAccess: AccessCounts;
    people: number;
  };
  views: AdWallView[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 91;
const LIMIT = 30;

/**
 * Зведення для стіни: сьогодні (київська доба) і за 91 день — показали / почали / досмотріли, входи на /dovede (хто),
 * унікальні браузери (люди — за першою подією кожного перегляду, як «хто» у списку), і 30 останніх переглядів. Подій небагато — читаються сирими рядками.
 * Наклейки — лише міста стіни (`cityCode`), «Доведе» — завжди.
 */
export async function adWallSnapshot(prisma: PrismaClient, opts: { cityCode: string; now?: Date }): Promise<AdWallSnapshot> {
  const now = opts.now ?? new Date();
  const day = kyivDayHour(now).day;
  const rows = await prisma.adEvent.findMany({
    where: {
      createdAt: { gte: new Date(now.getTime() - WINDOW_DAYS * DAY_MS) },
      OR: [{ placement: 'sticker', cityCode: opts.cityCode }, { placement: 'dovede' }],
    },
    orderBy: { id: 'asc' },
  });

  const zero = (): Counts => ({ shown: 0, started: 0, completed: 0 });
  const sticker = { today: zero(), total: zero(), people: 0 };
  const noAccess = (): AccessCounts => ({ admin: 0, guest: 0, public: 0 });
  const dovede = { today: { ...zero(), pages: 0, punched: 0 }, total: { ...zero(), pages: 0, punched: 0 }, access: noAccess(), todayAccess: noAccess(), people: 0 };
  const people = { sticker: new Set<string>(), dovede: new Set<string>() };
  const views = new Map<string, AdWallView>();
  const viewClient = new Map<string, string>();
  const seenByClient = new Map<string, Set<string>>();

  for (const r of rows) {
    const placement = r.placement as AdPlacement;
    const isToday = kyivDayHour(r.createdAt).day === day;
    if (r.event === 'page') {
      dovede.total.pages++;
      if (isToday) dovede.today.pages++;
      if (r.access === 'admin' || r.access === 'guest' || r.access === 'public') {
        dovede.access[r.access]++;
        if (isToday) dovede.todayAccess[r.access]++;
      }
    } else if (r.event === 'punched') {
      dovede.total.punched++;
      if (isToday) dovede.today.punched++;
    } else if (r.event === 'shown' || r.event === 'started' || r.event === 'completed') {
      const bucket = placement === 'sticker' ? sticker : dovede;
      bucket.total[r.event]++;
      if (isToday) bucket.today[r.event]++;
    }
    let v = views.get(r.viewId);
    if (!v) {
      // людина — браузер першої події перегляду: та сама, що «хто» у списку
      if (r.clientId) (placement === 'sticker' ? people.sticker : people.dovede).add(r.clientId);
      const before = r.clientId ? (seenByClient.get(r.clientId)?.size ?? 0) : 0;
      if (r.clientId && r.event !== 'page') {
        const set = seenByClient.get(r.clientId) ?? new Set<string>();
        set.add(r.viewId);
        seenByClient.set(r.clientId, set);
      }
      v = {
        viewId: r.viewId,
        placement,
        kind: r.event === 'page' ? 'page' : 'view',
        stopId: r.stopId,
        device: r.device,
        who: r.clientId ? r.clientId.slice(-4) : null,
        number: null,
        seenBefore: before,
        access: r.access,
        at: r.createdAt.toISOString(),
        started: false,
        completed: false,
        punched: false,
      };
      views.set(r.viewId, v);
      if (r.clientId) viewClient.set(r.viewId, r.clientId);
    }
    if (r.event === 'started') v.started = true;
    if (r.event === 'completed') {
      v.started = true;
      v.completed = true;
    }
    if (r.event === 'punched') {
      v.punched = true;
      // хто компостував (адмін, гість) — якщо перегляд сам цього не знав
      v.access ??= r.access;
    }
  }
  sticker.people = people.sticker.size;
  dovede.people = people.dovede.size;

  const latest = [...views.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, LIMIT);
  // номер пасажира з наклейок — порядок появи людини в місті стіни (src/sticker-people.ts)
  const clients = [...new Set(latest.map((v) => viewClient.get(v.viewId)).filter((c): c is string => !!c))];
  if (clients.length) {
    const persons = await prisma.stickerPerson.findMany({ where: { cityCode: opts.cityCode }, select: { id: true, clientId: true } });
    const numberOf = new Map([...persons].sort((a, b) => a.id - b.id).map((p, i) => [p.clientId, i + 1]));
    for (const v of latest) {
      const c = viewClient.get(v.viewId);
      v.number = (c && numberOf.get(c)) || null;
    }
  }

  return {
    now: now.toISOString(),
    day,
    sticker,
    dovede,
    views: latest,
  };
}
