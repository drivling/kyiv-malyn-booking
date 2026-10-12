import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  COLD_START_HOURS,
  fetchGroupMessagesFromDzhura,
  formatSenderLine,
  saveCursors,
  startTelegramImportScheduler,
} from './telegram-dzhura-source';
import { parseTelegramMessages } from './telegram-parser';

const GROUPS = [{ chat: 'PoDoroguem', topicIds: [2, 6] }, { chat: 'Korosten_Kyiv', topicIds: [0] }];
const NOW = new Date('2026-10-12T10:00:00Z');

function msg(tg: number, text: string, topicId: number | null, sentAt = NOW, sender: object | null = null) {
  return { tgMessageId: BigInt(tg), text, topicId, sentAt, sender };
}

function fakePrisma(opts: {
  states?: Array<{ chat: string; topicId: number; lastMessageId: number }>;
  chats?: Record<string, { id: number; captureEnabled: boolean }>;
  messages?: Record<number, ReturnType<typeof msg>[]>;
}) {
  const findMany = vi.fn(async ({ where }: any) => {
    const rows = (opts.messages?.[where.chatId] ?? []).filter((m) => {
      if (where.topicId && m.topicId !== where.topicId) return false;
      if (m.tgMessageId <= where.tgMessageId.gt) return false;
      if (where.sentAt && m.sentAt < where.sentAt.gte) return false;
      return true;
    });
    return rows.sort((a, b) => Number(a.tgMessageId - b.tgMessageId));
  });
  const update = vi.fn(async () => ({}));
  const upsert = vi.fn(async () => ({}));
  const prisma = {
    telegramFetchState: { findMany: async () => opts.states ?? [], upsert },
    dzhuraChat: {
      findFirst: async ({ where }: any) => opts.chats?.[where.username.equals] ?? null,
      update,
    },
    dzhuraMessage: { findMany },
  } as unknown as PrismaClient;
  return { prisma, findMany, update, upsert };
}

describe('formatSenderLine', () => {
  it('ім\'я + @username у форматі парсера', () => {
    expect(formatSenderLine({ firstName: 'Іван', lastName: 'Коваль', username: 'ivan_k' }, ' Їду 12.10 ')).toBe(
      'Іван Коваль|@ivan_k: Їду 12.10',
    );
  });
  it('без імені — @username; без нічого — Невідомий', () => {
    expect(formatSenderLine({ firstName: null, lastName: null, username: 'x' }, 't')).toBe('@x|@x: t');
    expect(formatSenderLine(null, 't')).toBe('Невідомий: t');
  });
});

describe('fetchGroupMessagesFromDzhura', () => {
  it('бере лише нові (> курсору) повідомлення потрібного топіка, курсор = max id', async () => {
    const { prisma } = fakePrisma({
      states: [{ chat: 'PoDoroguem', topicId: 2, lastMessageId: 10 }],
      chats: { PoDoroguem: { id: 1, captureEnabled: true } },
      messages: {
        1: [
          msg(9, 'старе', 2),
          msg(11, 'Київ-Малин 12.10 о 15:00', 2),
          msg(12, 'інший топік', 6),
          msg(14, 'ще одне Київ-Малин', 2),
        ],
      },
    });
    const r = await fetchGroupMessagesFromDzhura(prisma, [GROUPS[0]], { now: NOW });
    expect(r.text).toContain('Київ-Малин 12.10 о 15:00');
    expect(r.text).toContain('ще одне Київ-Малин');
    expect(r.text).not.toContain('старе');
    expect(r.cursors).toContainEqual({ chat: 'PoDoroguem', topicId: 2, lastMessageId: 14 });
    // топік 6 без курсору: бере все в межах cold start
    expect(r.cursors).toContainEqual({ chat: 'PoDoroguem', topicId: 6, lastMessageId: 12 });
    // провенанс: група, топік і id кожного повідомлення
    expect(r.items.map((i) => [i.chat, i.topicId, i.messageId])).toEqual([
      ['PoDoroguem', 2, 11],
      ['PoDoroguem', 2, 14],
      ['PoDoroguem', 6, 12],
    ]);
    expect(r.items[0].line).toBe('Невідомий: Київ-Малин 12.10 о 15:00');
  });

  it('cold start: без курсору ігнорує повідомлення старші за COLD_START_HOURS', async () => {
    const old = new Date(NOW.getTime() - (COLD_START_HOURS + 1) * 3_600_000);
    const { prisma } = fakePrisma({
      chats: { Korosten_Kyiv: { id: 2, captureEnabled: true } },
      messages: { 2: [msg(1, 'давно', null, old), msg(2, 'свіже оголошення', null)] },
    });
    const r = await fetchGroupMessagesFromDzhura(prisma, [GROUPS[1]], { now: NOW });
    expect(r.text).not.toContain('давно');
    expect(r.text).toContain('свіже оголошення');
    expect(r.cursors).toEqual([{ chat: 'Korosten_Kyiv', topicId: 0, lastMessageId: 2 }]);
  });

  it('медіа без підпису рухає курсор, але не потрапляє в текст', async () => {
    const { prisma } = fakePrisma({
      chats: { Korosten_Kyiv: { id: 2, captureEnabled: true } },
      messages: { 2: [msg(5, '', null)] },
    });
    const r = await fetchGroupMessagesFromDzhura(prisma, [GROUPS[1]], { now: NOW });
    expect(r.text).toBe('');
    expect(r.cursors).toEqual([{ chat: 'Korosten_Kyiv', topicId: 0, lastMessageId: 5 }]);
  });

  it('невідома група → missingGroups; вимкнене «Читати» вмикається', async () => {
    const { prisma, update } = fakePrisma({ chats: { Korosten_Kyiv: { id: 2, captureEnabled: false } } });
    const r = await fetchGroupMessagesFromDzhura(prisma, GROUPS, { now: NOW });
    expect(r.missingGroups).toEqual(['PoDoroguem']);
    expect(r.enabledGroups).toEqual(['Korosten_Kyiv']);
    expect(update).toHaveBeenCalledWith({ where: { id: 2 }, data: { captureEnabled: true } });
    expect(r.text).toBe('');
  });

  it('вивід парситься parseTelegramMessages', async () => {
    const { prisma } = fakePrisma({
      chats: { PoDoroguem: { id: 1, captureEnabled: true } },
      messages: {
        1: [
          msg(1, 'Їду Київ-Малин сьогодні о 15:00, 3 місця, 0501234567', 2, NOW, {
            firstName: 'Іван', lastName: null, username: 'ivan',
          }),
        ],
      },
    });
    const r = await fetchGroupMessagesFromDzhura(prisma, [GROUPS[0]], { now: NOW });
    expect(r.text).toMatch(/^Іван\|@ivan: /);
    const parsed = parseTelegramMessages(r.text);
    expect(parsed.every((p) => p.telegramUsername === '@ivan' || p.telegramUsername === 'ivan')).toBe(true);
  });
});

describe('saveCursors', () => {
  it('upsert по (chat, topicId)', async () => {
    const { prisma, upsert } = fakePrisma({});
    await saveCursors(prisma, [{ chat: 'PoDoroguem', topicId: 2, lastMessageId: 7 }]);
    expect(upsert).toHaveBeenCalledWith({
      where: { chat_topicId: { chat: 'PoDoroguem', topicId: 2 } },
      create: { chat: 'PoDoroguem', topicId: 2, lastMessageId: 7 },
      update: { lastMessageId: 7 },
    });
  });
});

describe('startTelegramImportScheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('intervalMin = 0 вимикає планувальник', () => {
    expect(startTelegramImportScheduler(async () => ({ success: true, created: 0, total: 0 }), { intervalMin: 0 })).toBeNull();
  });

  it('запускає імпорт, не накладає тіки і переживає помилку', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const run = vi
      .fn()
      .mockImplementationOnce(() => new Promise((res) => { release = () => res({ success: true, created: 0, total: 0 }); }))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ success: true, created: 0, total: 0 });
    const log = vi.fn();
    const s = startTelegramImportScheduler(run, { intervalMin: 1, firstDelayMs: 1000, log })!;
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000); // перший ще висить → тік пропущено
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2); // кидає — логується, не падає
    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(3);
    s.stop();
  });
});
