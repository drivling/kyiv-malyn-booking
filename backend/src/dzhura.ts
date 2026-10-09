/**
 * «Джура» · фаза 0 — Node-частина: список чатів, статус слухача, задачі, експорт JSON.
 *
 * Дані пише Python-слухач (telegram-user/dzhura/) у таблиці Dzhura*; тут лише читання
 * та керування прапорцями. Telegram-id (BigInt) у відповідях завжди рядки.
 * Правило проєкту: ніколи не «читати» за власника і нічого не писати у захоплені чати —
 * Node у Telegram не ходить взагалі.
 */
import type { PrismaClient, Prisma } from '@prisma/client';

export const DZHURA_EXPORT_LIMIT = 50_000;
export const DZHURA_HEARTBEAT_FRESH_MS = 60_000;
export const DZHURA_MAX_BACKFILL_DAYS = 366;
export const DZHURA_KYIV_TZ = 'Europe/Kyiv';
export const DZHURA_GROUP_KINDS = ['group', 'supergroup'] as const;

export type DzhuraChatKind = 'group' | 'supergroup' | 'private' | 'channel';
export type DzhuraJobType = 'sync_dialogs' | 'backfill';

export class DzhuraHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'DzhuraHttpError';
  }
}

/** BigInt → string для res.json / JSON.stringify */
export const bigintReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' → те саме або null, якщо не дата календаря */
export function parseIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = ISO_DATE_RE.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}

function kyivOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DZHURA_KYIV_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Північ Києва для календарної дати → UTC-момент (враховує літній/зимовий час) */
export function kyivMidnightUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  let offset = kyivOffsetMinutes(new Date(naive));
  let guess = naive - offset * 60_000;
  offset = kyivOffsetMinutes(new Date(guess));
  guess = naive - offset * 60_000;
  return new Date(guess);
}

/** Доби Києва [from 00:00, to+1 00:00) */
export function kyivDayRangeUtc(from: string, to: string): { start: Date; endExclusive: Date } {
  return { start: kyivMidnightUtc(from), endExclusive: kyivMidnightUtc(addDaysIso(to, 1)) };
}

/** Перевірити діапазон дат із query/body; кидає DzhuraHttpError(400) */
export function validateDateRange(fromRaw: unknown, toRaw: unknown): { from: string; to: string } {
  const from = parseIsoDate(fromRaw);
  const to = parseIsoDate(toRaw);
  if (!from || !to) throw new DzhuraHttpError(400, 'Потрібні дати from і to у форматі YYYY-MM-DD');
  if (to < from) throw new DzhuraHttpError(400, 'Дата «до» раніша за дату «від»');
  if (daysBetweenInclusive(from, to) > DZHURA_MAX_BACKFILL_DAYS) {
    throw new DzhuraHttpError(400, `Період не більше ${DZHURA_MAX_BACKFILL_DAYS} днів`);
  }
  return { from, to };
}

/** dzhura-<ascii-slug|chat-id>-<from>_<to>.json (лише ASCII — заголовок Content-Disposition) */
export function exportFileName(chat: { id: number; title: string }, from: string, to: string): string {
  const slug = (chat.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `dzhura-${slug || `chat-${chat.id}`}-${from}_${to}.json`;
}

export interface DzhuraChatDto {
  id: number;
  tgChatId: string;
  kind: DzhuraChatKind;
  title: string;
  username: string | null;
  membersCount: number | null;
  isLunchGroup: boolean;
  captureEnabled: boolean;
  relayToSaved: boolean;
  lastMessageAt: string | null;
  lastCapturedAt: string | null;
  dialogSyncedAt: string | null;
  messagesCount: number;
}

type ChatRowWithCount = Prisma.DzhuraChatGetPayload<{ include: { _count: { select: { messages: true } } } }>;

export function serializeChat(row: ChatRowWithCount): DzhuraChatDto {
  return {
    id: row.id,
    tgChatId: row.tgChatId.toString(),
    kind: row.kind as DzhuraChatKind,
    title: row.title,
    username: row.username,
    membersCount: row.membersCount,
    isLunchGroup: row.isLunchGroup,
    captureEnabled: row.captureEnabled,
    relayToSaved: row.relayToSaved,
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    lastCapturedAt: row.lastCapturedAt ? row.lastCapturedAt.toISOString() : null,
    dialogSyncedAt: row.dialogSyncedAt ? row.dialogSyncedAt.toISOString() : null,
    messagesCount: row._count.messages,
  };
}

/** ?kind=group,supergroup (default) | all | private … */
export function parseKindsFilter(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return [...DZHURA_GROUP_KINDS];
  if (raw.trim() === 'all') return null;
  const kinds = raw
    .split(',')
    .map((k) => k.trim())
    .filter((k): k is DzhuraChatKind => ['group', 'supergroup', 'private', 'channel'].includes(k));
  return kinds.length ? kinds : [...DZHURA_GROUP_KINDS];
}

export async function listChats(prisma: PrismaClient, kinds: string[] | null): Promise<DzhuraChatDto[]> {
  const rows = await prisma.dzhuraChat.findMany({
    where: kinds ? { kind: { in: kinds } } : {},
    orderBy: [{ captureEnabled: 'desc' }, { lastMessageAt: 'desc' }, { title: 'asc' }],
    include: { _count: { select: { messages: true } } },
  });
  return rows.map(serializeChat);
}

/** Черга дублів у «Обране» (рядки LunchOutboundMessage з target='saved') */
export interface DzhuraQueueStats {
  /** очікують надсилання (разом із тими, що чекають ретраю) */
  pending: number;
  /** з них — чекають повторної спроби після помилки */
  retrying: number;
  /** остаточно невдалі за останню добу */
  failed24h: number;
}

export interface DzhuraStatusDto {
  listenerWanted: boolean;
  heartbeatAt: string | null;
  heartbeatFresh: boolean;
  dialogsSyncedAt: string | null;
  meTgUserId: string | null;
  queue: DzhuraQueueStats;
}

export const DZHURA_QUEUE_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function getQueueStats(prisma: PrismaClient, now: Date = new Date()): Promise<DzhuraQueueStats> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [pending, retrying, failed24h] = await Promise.all([
    prisma.lunchOutboundMessage.count({ where: { target: 'saved', status: 'pending' } }),
    prisma.lunchOutboundMessage.count({ where: { target: 'saved', status: 'pending', nextAttemptAt: { gt: now } } }),
    prisma.lunchOutboundMessage.count({ where: { target: 'saved', status: 'failed', createdAt: { gte: dayAgo } } }),
  ]);
  return { pending, retrying, failed24h };
}

/** Повернути невдалі дублі за останній тиждень у чергу (attempts=0, одразу) */
export async function retryFailedSaved(prisma: PrismaClient, now: Date = new Date()): Promise<number> {
  const res = await prisma.lunchOutboundMessage.updateMany({
    where: { target: 'saved', status: 'failed', createdAt: { gte: new Date(now.getTime() - DZHURA_QUEUE_RETRY_WINDOW_MS) } },
    data: { status: 'pending', attempts: 0, nextAttemptAt: null, errorText: null },
  });
  return res.count;
}

export async function getStatus(
  prisma: PrismaClient,
  listenerWanted: boolean,
  now: Date = new Date(),
): Promise<DzhuraStatusDto> {
  const [state, queue] = await Promise.all([
    prisma.dzhuraState.findUnique({ where: { id: 1 } }),
    getQueueStats(prisma, now),
  ]);
  const heartbeatAt = state?.heartbeatAt ?? null;
  return {
    listenerWanted,
    heartbeatAt: heartbeatAt ? heartbeatAt.toISOString() : null,
    heartbeatFresh: Boolean(heartbeatAt && now.getTime() - heartbeatAt.getTime() < DZHURA_HEARTBEAT_FRESH_MS),
    dialogsSyncedAt: state?.dialogsSyncedAt ? state.dialogsSyncedAt.toISOString() : null,
    meTgUserId: state?.meTgUserId != null ? state.meTgUserId.toString() : null,
    queue,
  };
}

// ---------- messages (перегляд в адмінці) ----------

export const DZHURA_MESSAGES_PAGE = 50;
export const DZHURA_MESSAGES_PAGE_MAX = 200;
export const DZHURA_SEARCH_MAX_LEN = 200;

export interface DzhuraMessagesQuery {
  from: string | null;
  to: string | null;
  q: string;
  beforeId: number | null;
  limit: number;
}

/** ?from&to (обидві або жодної), ?q (пошук по тексту/автору), ?beforeId (курсор), ?limit */
export function parseMessagesQuery(query: Record<string, unknown>): DzhuraMessagesQuery {
  const hasFrom = typeof query.from === 'string' && query.from.trim() !== '';
  const hasTo = typeof query.to === 'string' && query.to.trim() !== '';
  let from: string | null = null;
  let to: string | null = null;
  if (hasFrom || hasTo) {
    if (!hasFrom || !hasTo) throw new DzhuraHttpError(400, 'Потрібні обидві дати from і to або жодної');
    const range = validateDateRange(query.from, query.to);
    from = range.from;
    to = range.to;
  }
  const qRaw = typeof query.q === 'string' ? query.q.trim() : '';
  if (qRaw.length > DZHURA_SEARCH_MAX_LEN) throw new DzhuraHttpError(400, `Пошуковий запит довший за ${DZHURA_SEARCH_MAX_LEN} символів`);
  let beforeId: number | null = null;
  if (query.beforeId !== undefined && query.beforeId !== '') {
    const n = Number(query.beforeId);
    if (!Number.isInteger(n) || n <= 0) throw new DzhuraHttpError(400, 'Некоректний beforeId');
    beforeId = n;
  }
  const limitRaw = Number(query.limit ?? DZHURA_MESSAGES_PAGE);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, DZHURA_MESSAGES_PAGE_MAX) : DZHURA_MESSAGES_PAGE;
  return { from, to, q: qRaw, beforeId, limit };
}

export interface DzhuraMessageDto {
  id: number;
  tgMessageId: string;
  sentAt: string;
  sender: { tgUserId: string; name: string; username: string | null } | null;
  isOutgoing: boolean;
  text: string;
  mediaKind: string | null;
  replyToTgMessageId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  source: string;
  reactions: Array<{ emoji: string; by: string | null; isMine: boolean }>;
  reactionsCounts: Record<string, number> | null;
}

export interface DzhuraMessagesPage {
  messages: DzhuraMessageDto[];
  /** id для наступної сторінки (?beforeId=), null — це остання */
  nextBeforeId: number | null;
}

export function buildMessagesWhere(chatId: number, mq: DzhuraMessagesQuery): Prisma.DzhuraMessageWhereInput {
  const where: Prisma.DzhuraMessageWhereInput = { chatId };
  if (mq.from && mq.to) {
    const { start, endExclusive } = kyivDayRangeUtc(mq.from, mq.to);
    where.sentAt = { gte: start, lt: endExclusive };
  }
  if (mq.beforeId) where.id = { lt: mq.beforeId };
  if (mq.q) {
    const contains = { contains: mq.q, mode: 'insensitive' as const };
    where.OR = [
      { text: contains },
      { sender: { is: { OR: [{ firstName: contains }, { lastName: contains }, { username: contains }] } } },
    ];
  }
  return where;
}

export async function listMessages(prisma: PrismaClient, chatId: number, mq: DzhuraMessagesQuery): Promise<DzhuraMessagesPage> {
  const chat = await prisma.dzhuraChat.findUnique({ where: { id: chatId } });
  if (!chat) throw new DzhuraHttpError(404, 'Чат не знайдено');
  const rows = await prisma.dzhuraMessage.findMany({
    where: buildMessagesWhere(chatId, mq),
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    take: mq.limit + 1,
    include: { sender: true, reactions: { where: { removedAt: null }, include: { person: true }, orderBy: { id: 'asc' } } },
  });
  const hasMore = rows.length > mq.limit;
  const page = hasMore ? rows.slice(0, mq.limit) : rows;
  const messages: DzhuraMessageDto[] = page.map((m) => ({
    id: m.id,
    tgMessageId: m.tgMessageId.toString(),
    sentAt: m.sentAt.toISOString(),
    sender: m.sender
      ? { tgUserId: m.sender.tgUserId.toString(), name: personDisplayName(m.sender), username: m.sender.username }
      : null,
    isOutgoing: m.isOutgoing,
    text: m.text,
    mediaKind: m.mediaKind,
    replyToTgMessageId: m.replyToTgMessageId != null ? m.replyToTgMessageId.toString() : null,
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
    source: m.source,
    reactions: m.reactions.map((r) => ({
      emoji: r.emoji,
      by: r.person ? personDisplayName(r.person) : null,
      isMine: r.isMine,
    })),
    reactionsCounts: asCounts(m.reactionsJson),
  }));
  return { messages, nextBeforeId: hasMore ? page[page.length - 1].id : null };
}

function asCounts(v: unknown): Record<string, number> | null {
  const rec = asRecord(v);
  if (!rec) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(rec)) {
    if (typeof n === 'number' && n > 0) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

export interface DzhuraChatPatch {
  captureEnabled?: boolean;
  relayToSaved?: boolean;
}

export function parseChatPatch(body: unknown): DzhuraChatPatch {
  const b = (body ?? {}) as Record<string, unknown>;
  const patch: DzhuraChatPatch = {};
  if ('captureEnabled' in b) {
    if (typeof b.captureEnabled !== 'boolean') throw new DzhuraHttpError(400, 'captureEnabled має бути boolean');
    patch.captureEnabled = b.captureEnabled;
  }
  if ('relayToSaved' in b) {
    if (typeof b.relayToSaved !== 'boolean') throw new DzhuraHttpError(400, 'relayToSaved має бути boolean');
    patch.relayToSaved = b.relayToSaved;
  }
  if (!('captureEnabled' in patch) && !('relayToSaved' in patch)) {
    throw new DzhuraHttpError(400, 'Нема що змінювати');
  }
  return patch;
}

export async function updateChatFlags(prisma: PrismaClient, chatId: number, patch: DzhuraChatPatch): Promise<DzhuraChatDto> {
  const existing = await prisma.dzhuraChat.findUnique({ where: { id: chatId } });
  if (!existing) throw new DzhuraHttpError(404, 'Чат не знайдено');
  if (existing.isLunchGroup && patch.captureEnabled === false) {
    throw new DzhuraHttpError(400, 'Групу обідів читаємо завжди — вимкнути не можна');
  }
  const data: Prisma.DzhuraChatUpdateInput = {};
  if (patch.captureEnabled !== undefined) data.captureEnabled = patch.captureEnabled;
  if (patch.relayToSaved !== undefined) data.relayToSaved = patch.relayToSaved;
  // Без читання нема куди дублювати.
  const nextCapture = patch.captureEnabled ?? existing.captureEnabled;
  if (!nextCapture) data.relayToSaved = false;
  const row = await prisma.dzhuraChat.update({
    where: { id: chatId },
    data,
    include: { _count: { select: { messages: true } } },
  });
  return serializeChat(row);
}

export interface DzhuraJobDto {
  id: number;
  type: DzhuraJobType;
  status: 'pending' | 'running' | 'done' | 'failed';
  params: Record<string, unknown> | null;
  progress: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  errorText: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

type JobRow = Prisma.DzhuraJobGetPayload<Record<string, never>>;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function serializeJob(row: JobRow): DzhuraJobDto {
  return {
    id: row.id,
    type: row.type as DzhuraJobType,
    status: row.status as DzhuraJobDto['status'],
    params: asRecord(row.paramsJson),
    progress: asRecord(row.progressJson),
    result: asRecord(row.resultJson),
    errorText: row.errorText,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

export type DzhuraJobRequest =
  | { type: 'sync_dialogs' }
  | { type: 'backfill'; chatId: number; from: string; to: string };

export function parseJobRequest(body: unknown): DzhuraJobRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.type === 'sync_dialogs') return { type: 'sync_dialogs' };
  if (b.type === 'backfill') {
    const chatId = Number(b.chatId);
    if (!Number.isInteger(chatId) || chatId <= 0) throw new DzhuraHttpError(400, 'Потрібен chatId');
    const { from, to } = validateDateRange(b.from, b.to);
    return { type: 'backfill', chatId, from, to };
  }
  throw new DzhuraHttpError(400, 'Невідомий тип задачі');
}

export async function createJob(prisma: PrismaClient, req: DzhuraJobRequest): Promise<DzhuraJobDto> {
  if (req.type === 'backfill') {
    const chat = await prisma.dzhuraChat.findUnique({ where: { id: req.chatId } });
    if (!chat) throw new DzhuraHttpError(404, 'Чат не знайдено');
  }
  const params: Prisma.InputJsonValue | undefined =
    req.type === 'backfill' ? { chatId: req.chatId, from: req.from, to: req.to } : undefined;

  const active = await prisma.dzhuraJob.findFirst({
    where: { type: req.type, status: { in: ['pending', 'running'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (active) {
    const sameParams =
      req.type === 'sync_dialogs' ||
      JSON.stringify(asRecord(active.paramsJson) ?? {}) === JSON.stringify(params ?? {});
    if (sameParams) {
      throw new DzhuraHttpError(409, `Така задача вже виконується (№${active.id})`);
    }
  }
  const row = await prisma.dzhuraJob.create({
    data: { type: req.type, status: 'pending', ...(params !== undefined ? { paramsJson: params } : {}) },
  });
  return serializeJob(row);
}

export async function listJobs(prisma: PrismaClient, limit: number): Promise<DzhuraJobDto[]> {
  const rows = await prisma.dzhuraJob.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map(serializeJob);
}

export async function getJob(prisma: PrismaClient, id: number): Promise<DzhuraJobDto> {
  const row = await prisma.dzhuraJob.findUnique({ where: { id } });
  if (!row) throw new DzhuraHttpError(404, 'Задачу не знайдено');
  return serializeJob(row);
}

// ---------- export ----------

export interface DzhuraExportPerson {
  tgUserId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  isMe: boolean;
}

export interface DzhuraExportPayload {
  project: 'dzhura';
  version: 1;
  exportedAt: string;
  chat: { id: number; tgChatId: string; kind: string; title: string; username: string | null };
  range: { from: string; to: string; timezone: string };
  persons: DzhuraExportPerson[];
  messages: Array<{
    tgMessageId: string;
    sentAt: string;
    sender: { tgUserId: string; name: string; username: string | null; phone: string | null } | null;
    isOutgoing: boolean;
    text: string;
    mediaKind: string | null;
    replyToTgMessageId: string | null;
    topicId: number | null;
    forward: { name: string | null; tgId: string | null; date: string | null } | null;
    editedAt: string | null;
    editHistory: unknown;
    reactionsCounts: unknown;
    deletedAt: string | null;
    source: string;
    reactions: Array<{
      emoji: string;
      by: { tgUserId: string; name: string } | null;
      isMine: boolean;
      addedAt: string;
      removedAt: string | null;
    }>;
  }>;
}

type PersonRow = Prisma.DzhuraPersonGetPayload<Record<string, never>>;

export function personDisplayName(p: Pick<PersonRow, 'firstName' | 'lastName' | 'username' | 'tgUserId'>): string {
  const full = [p.firstName, p.lastName].filter((s) => s && s.trim()).join(' ').trim();
  if (full) return full;
  if (p.username) return `@${p.username}`;
  return p.tgUserId.toString();
}

export async function buildChatExport(
  prisma: PrismaClient,
  chatId: number,
  from: string,
  to: string,
  now: Date = new Date(),
): Promise<DzhuraExportPayload> {
  const chat = await prisma.dzhuraChat.findUnique({ where: { id: chatId } });
  if (!chat) throw new DzhuraHttpError(404, 'Чат не знайдено');
  const { start, endExclusive } = kyivDayRangeUtc(from, to);

  const rows = await prisma.dzhuraMessage.findMany({
    where: { chatId, sentAt: { gte: start, lt: endExclusive } },
    orderBy: [{ sentAt: 'asc' }, { tgMessageId: 'asc' }],
    take: DZHURA_EXPORT_LIMIT + 1,
    include: { sender: true, reactions: { include: { person: true }, orderBy: { id: 'asc' } } },
  });
  if (rows.length > DZHURA_EXPORT_LIMIT) {
    throw new DzhuraHttpError(413, `Понад ${DZHURA_EXPORT_LIMIT} повідомлень — звузьте період`);
  }

  const persons = new Map<string, DzhuraExportPerson>();
  const addPerson = (p: PersonRow | null | undefined) => {
    if (!p) return;
    const key = p.tgUserId.toString();
    if (!persons.has(key)) {
      persons.set(key, {
        tgUserId: key,
        firstName: p.firstName,
        lastName: p.lastName,
        username: p.username,
        phone: p.phone,
        isMe: p.isMe,
      });
    }
  };

  const messages = rows.map((m) => {
    addPerson(m.sender);
    for (const r of m.reactions) addPerson(r.person);
    return {
      tgMessageId: m.tgMessageId.toString(),
      sentAt: m.sentAt.toISOString(),
      sender: m.sender
        ? {
            tgUserId: m.sender.tgUserId.toString(),
            name: personDisplayName(m.sender),
            username: m.sender.username,
            phone: m.sender.phone,
          }
        : null,
      isOutgoing: m.isOutgoing,
      text: m.text,
      mediaKind: m.mediaKind,
      replyToTgMessageId: m.replyToTgMessageId != null ? m.replyToTgMessageId.toString() : null,
      topicId: m.topicId,
      forward:
        m.forwardFromName || m.forwardFromTgId != null || m.forwardDate
          ? {
              name: m.forwardFromName,
              tgId: m.forwardFromTgId != null ? m.forwardFromTgId.toString() : null,
              date: m.forwardDate ? m.forwardDate.toISOString() : null,
            }
          : null,
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      editHistory: m.editHistoryJson ?? null,
      reactionsCounts: m.reactionsJson ?? null,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
      source: m.source,
      reactions: m.reactions.map((r) => ({
        emoji: r.emoji,
        by: r.person ? { tgUserId: r.person.tgUserId.toString(), name: personDisplayName(r.person) } : null,
        isMine: r.isMine,
        addedAt: r.addedAt.toISOString(),
        removedAt: r.removedAt ? r.removedAt.toISOString() : null,
      })),
    };
  });

  return {
    project: 'dzhura',
    version: 1,
    exportedAt: now.toISOString(),
    chat: {
      id: chat.id,
      tgChatId: chat.tgChatId.toString(),
      kind: chat.kind,
      title: chat.title,
      username: chat.username,
    },
    range: { from, to, timezone: DZHURA_KYIV_TZ },
    persons: [...persons.values()],
    messages,
  };
}
