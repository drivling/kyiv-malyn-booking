/**
 * Чисті функції «Джури»: доби Києва → UTC, валідація дат, ім'я файлу експорту, серіалізація BigInt.
 */
import { describe, expect, test } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  DzhuraHttpError,
  addDaysIso,
  bigintReplacer,
  buildChatExport,
  buildMessagesWhere,
  daysBetweenInclusive,
  exportFileName,
  getQueueStats,
  kyivDayRangeUtc,
  kyivMidnightUtc,
  listMessages,
  parseChatPatch,
  parseIsoDate,
  parseJobRequest,
  parseKindsFilter,
  parseMessagesQuery,
  personDisplayName,
  retryFailedSaved,
  validateDateRange,
} from './dzhura';

describe('kyivMidnightUtc / kyivDayRangeUtc', () => {
  test('літній час: північ Києва = 21:00 UTC попереднього дня', () => {
    expect(kyivMidnightUtc('2026-09-25').toISOString()).toBe('2026-09-24T21:00:00.000Z');
  });

  test('зимовий час: північ Києва = 22:00 UTC', () => {
    expect(kyivMidnightUtc('2026-12-01').toISOString()).toBe('2026-11-30T22:00:00.000Z');
  });

  test('день переходу на зимовий час (2026-10-25) і наступний', () => {
    expect(kyivMidnightUtc('2026-10-25').toISOString()).toBe('2026-10-24T21:00:00.000Z');
    expect(kyivMidnightUtc('2026-10-26').toISOString()).toBe('2026-10-25T22:00:00.000Z');
  });

  test('діапазон [from 00:00, to+1 00:00)', () => {
    const { start, endExclusive } = kyivDayRangeUtc('2026-09-01', '2026-09-03');
    expect(start.toISOString()).toBe('2026-08-31T21:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-09-03T21:00:00.000Z');
  });
});

describe('dates', () => {
  test('parseIsoDate приймає лише календарні дати', () => {
    expect(parseIsoDate('2026-02-28')).toBe('2026-02-28');
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('25.09.2026')).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
  });

  test('addDaysIso через кінець місяця і року', () => {
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetweenInclusive('2026-09-01', '2026-09-01')).toBe(1);
    expect(daysBetweenInclusive('2026-01-01', '2026-12-31')).toBe(365);
  });

  test('validateDateRange: порядок і ліміт', () => {
    expect(validateDateRange('2026-09-01', '2026-09-10')).toEqual({ from: '2026-09-01', to: '2026-09-10' });
    expect(() => validateDateRange('2026-09-10', '2026-09-01')).toThrow(DzhuraHttpError);
    expect(() => validateDateRange('2025-01-01', '2026-06-01')).toThrow(/366/);
    expect(() => validateDateRange('x', '2026-09-01')).toThrow(/YYYY-MM-DD/);
  });
});

describe('parsers', () => {
  test('parseKindsFilter', () => {
    expect(parseKindsFilter(undefined)).toEqual(['group', 'supergroup']);
    expect(parseKindsFilter('all')).toBeNull();
    expect(parseKindsFilter('private,junk')).toEqual(['private']);
    expect(parseKindsFilter('junk')).toEqual(['group', 'supergroup']);
  });

  test('parseChatPatch', () => {
    expect(parseChatPatch({ relayToSaved: true })).toEqual({ relayToSaved: true });
    expect(() => parseChatPatch({ captureEnabled: 'yes' })).toThrow(/boolean/);
    expect(() => parseChatPatch({})).toThrow(/Нема що/);
  });

  test('parseJobRequest', () => {
    expect(parseJobRequest({ type: 'sync_dialogs' })).toEqual({ type: 'sync_dialogs' });
    expect(parseJobRequest({ type: 'backfill', chatId: '7', from: '2026-09-01', to: '2026-09-02' })).toEqual({
      type: 'backfill',
      chatId: 7,
      from: '2026-09-01',
      to: '2026-09-02',
    });
    expect(() => parseJobRequest({ type: 'backfill', chatId: 0, from: '2026-09-01', to: '2026-09-02' })).toThrow(/chatId/);
    expect(() => parseJobRequest({ type: 'nope' })).toThrow(/Невідомий/);
  });
});

describe('export helpers', () => {
  test('exportFileName — лише ASCII, кирилиця → chat-<id>', () => {
    expect(exportFileName({ id: 3, title: 'Admin Chat #1' }, '2026-09-01', '2026-09-30')).toBe(
      'dzhura-admin-chat-1-2026-09-01_2026-09-30.json',
    );
    expect(exportFileName({ id: 3, title: 'Обіди для НЕ бідних' }, '2026-09-01', '2026-09-30')).toBe(
      'dzhura-chat-3-2026-09-01_2026-09-30.json',
    );
  });

  test('bigintReplacer', () => {
    expect(JSON.stringify({ a: 10n, b: [1n], c: 'x' }, bigintReplacer)).toBe('{"a":"10","b":["1"],"c":"x"}');
  });

  test('personDisplayName', () => {
    expect(personDisplayName({ firstName: 'Костя', lastName: 'Іванов', username: 'k', tgUserId: 1n })).toBe('Костя Іванов');
    expect(personDisplayName({ firstName: null, lastName: null, username: 'k', tgUserId: 1n })).toBe('@k');
    expect(personDisplayName({ firstName: null, lastName: null, username: null, tgUserId: 42n })).toBe('42');
  });
});

describe('messages query', () => {
  test('parseMessagesQuery: значення за замовчуванням і межі', () => {
    expect(parseMessagesQuery({})).toEqual({ from: null, to: null, q: '', beforeId: null, limit: 50 });
    expect(parseMessagesQuery({ q: '  привіт ', beforeId: '77', limit: '500', from: '2026-09-01', to: '2026-09-02' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-02',
      q: 'привіт',
      beforeId: 77,
      limit: 200,
    });
    expect(() => parseMessagesQuery({ from: '2026-09-01' })).toThrow(/обидві дати/);
    expect(() => parseMessagesQuery({ beforeId: '0' })).toThrow(/beforeId/);
    expect(() => parseMessagesQuery({ q: 'x'.repeat(201) })).toThrow(/довший/);
    expect(parseMessagesQuery({ limit: 'abc' }).limit).toBe(50);
  });

  test('buildMessagesWhere: чат, період, курсор, пошук по тексту й автору', () => {
    const where = buildMessagesWhere(5, { from: '2026-09-25', to: '2026-09-25', q: 'кост', beforeId: 900, limit: 50 });
    expect(where.chatId).toBe(5);
    expect(where.id).toEqual({ lt: 900 });
    expect((where.sentAt as { gte: Date }).gte.toISOString()).toBe('2026-09-24T21:00:00.000Z');
    expect(where.OR).toHaveLength(2);
    expect(where.OR?.[0]).toEqual({ text: { contains: 'кост', mode: 'insensitive' } });
    const plain = buildMessagesWhere(5, { from: null, to: null, q: '', beforeId: null, limit: 50 });
    expect(plain).toEqual({ chatId: 5 });
  });

  test('listMessages: курсор nextBeforeId лише коли є ще', async () => {
    const mk = (id: number) => ({
      id,
      tgMessageId: BigInt(id),
      sentAt: new Date(2026, 8, 25, 10, id % 60),
      sender: null,
      isOutgoing: id % 2 === 0,
      text: `m${id}`,
      mediaKind: null,
      replyToTgMessageId: null,
      editedAt: null,
      deletedAt: null,
      source: 'live',
      reactions: [],
      reactionsJson: null,
    });
    const rows = [mk(30), mk(29), mk(28)];
    const prisma = {
      dzhuraChat: { findUnique: async () => ({ id: 5 }) },
      dzhuraMessage: { findMany: async (args: { take: number }) => rows.slice(0, args.take) },
    } as unknown as PrismaClient;
    const page = await listMessages(prisma, 5, { from: null, to: null, q: '', beforeId: null, limit: 2 });
    expect(page.messages.map((m) => m.id)).toEqual([30, 29]);
    expect(page.nextBeforeId).toBe(29);
    expect(page.messages[0].tgMessageId).toBe('30');
    const last = await listMessages(prisma, 5, { from: null, to: null, q: '', beforeId: null, limit: 5 });
    expect(last.nextBeforeId).toBeNull();
  });

  test('getQueueStats / retryFailedSaved', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const prisma = {
      lunchOutboundMessage: {
        count: async (args: { where: Record<string, unknown> }) => {
          calls.push(args.where);
          return args.where.status === 'failed' ? 4 : args.where.nextAttemptAt ? 1 : 6;
        },
        updateMany: async (args: Record<string, unknown>) => {
          calls.push(args);
          return { count: 4 };
        },
      },
    } as unknown as PrismaClient;
    const now = new Date('2026-09-25T12:00:00Z');
    expect(await getQueueStats(prisma, now)).toEqual({ pending: 6, retrying: 1, failed24h: 4 });
    expect(calls.every((c) => (c as { target?: string }).target === 'saved')).toBe(true);
    expect(await retryFailedSaved(prisma, now)).toBe(4);
    const upd = calls[3] as { where: { createdAt: { gte: Date } }; data: Record<string, unknown> };
    expect(upd.where.createdAt.gte.toISOString()).toBe('2026-09-18T12:00:00.000Z');
    expect(upd.data).toEqual({ status: 'pending', attempts: 0, nextAttemptAt: null, errorText: null });
  });
});

describe('buildChatExport', () => {
  const me = { id: 1, tgUserId: 1n, firstName: 'Сергій', lastName: null, username: 'me', phone: null, isMe: true };
  const kostya = { id: 2, tgUserId: 200n, firstName: 'Костя', lastName: null, username: null, phone: '+380501112233', isMe: false };
  const chat = { id: 5, tgChatId: -1001234567890n, kind: 'supergroup', title: 'Admin', username: null };

  function stub(rows: unknown[]): PrismaClient {
    return {
      dzhuraChat: { findUnique: async () => chat },
      dzhuraMessage: { findMany: async () => rows },
    } as unknown as PrismaClient;
  }

  test('серіалізує повідомлення, авторів і реакції; BigInt → string', async () => {
    const rows = [
      {
        tgMessageId: 10n,
        sentAt: new Date('2026-09-25T08:00:00Z'),
        sender: kostya,
        isOutgoing: false,
        text: 'Привіт',
        mediaKind: null,
        replyToTgMessageId: null,
        topicId: null,
        forwardFromName: null,
        forwardFromTgId: null,
        forwardDate: null,
        editedAt: null,
        editHistoryJson: null,
        reactionsJson: { '❤️': 1 },
        deletedAt: null,
        source: 'live',
        reactions: [
          { emoji: '❤️', person: me, isMine: true, addedAt: new Date('2026-09-25T08:01:00Z'), removedAt: null },
        ],
      },
    ];
    const out = await buildChatExport(stub(rows), 5, '2026-09-25', '2026-09-25', new Date('2026-09-25T10:00:00Z'));
    expect(out.chat).toEqual({ id: 5, tgChatId: '-1001234567890', kind: 'supergroup', title: 'Admin', username: null });
    expect(out.range).toEqual({ from: '2026-09-25', to: '2026-09-25', timezone: 'Europe/Kyiv' });
    expect(out.persons.map((p) => p.tgUserId).sort()).toEqual(['1', '200']);
    expect(out.messages[0].sender).toEqual({ tgUserId: '200', name: 'Костя', username: null, phone: '+380501112233' });
    expect(out.messages[0].reactions[0]).toEqual({
      emoji: '❤️',
      by: { tgUserId: '1', name: 'Сергій' },
      isMine: true,
      addedAt: '2026-09-25T08:01:00.000Z',
      removedAt: null,
    });
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  test('413 понад ліміт', async () => {
    const rows = Array.from({ length: 50_001 }, (_, i) => ({
      tgMessageId: BigInt(i),
      sentAt: new Date(),
      sender: null,
      isOutgoing: false,
      text: '',
      mediaKind: null,
      replyToTgMessageId: null,
      topicId: null,
      forwardFromName: null,
      forwardFromTgId: null,
      forwardDate: null,
      editedAt: null,
      editHistoryJson: null,
      reactionsJson: null,
      deletedAt: null,
      source: 'live',
      reactions: [],
    }));
    await expect(buildChatExport(stub(rows), 5, '2026-09-01', '2026-09-30')).rejects.toMatchObject({ status: 413 });
  });

  test('404 коли чату нема', async () => {
    const prisma = { dzhuraChat: { findUnique: async () => null } } as unknown as PrismaClient;
    await expect(buildChatExport(prisma, 9, '2026-09-01', '2026-09-30')).rejects.toMatchObject({ status: 404 });
  });
});
