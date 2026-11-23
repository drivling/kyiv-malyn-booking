/**
 * HTTP: /admin/dzhura/* (auth, прапорці, задачі, експорт) на частковому Prisma-стабі.
 */
import { describe, expect, test } from 'vitest';
import request from 'supertest';
import { listenLocal } from './http-test-server';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { adminAuthToken } from './middleware/require-admin';

type ChatRow = {
  id: number;
  tgChatId: bigint;
  kind: string;
  title: string;
  username: string | null;
  membersCount: number | null;
  isLunchGroup: boolean;
  captureEnabled: boolean;
  relayToSaved: boolean;
  autoReplyEnabled: boolean;
  autoReplyDelaySec: number;
  autoReplyNote: string | null;
  lastMessageAt: Date | null;
  lastCapturedAt: Date | null;
  dialogSyncedAt: Date | null;
  _count: { messages: number };
};

function makeStub() {
  const chats: ChatRow[] = [
    {
      id: 1,
      tgChatId: -5427750954n,
      kind: 'group',
      title: 'Обіди',
      username: null,
      membersCount: 12,
      isLunchGroup: true,
      captureEnabled: true,
      relayToSaved: false,
      autoReplyEnabled: false,
      autoReplyDelaySec: 80,
      autoReplyNote: null,
      lastMessageAt: new Date('2026-09-25T09:00:00Z'),
      lastCapturedAt: new Date('2026-09-25T09:00:01Z'),
      dialogSyncedAt: new Date('2026-09-25T08:00:00Z'),
      _count: { messages: 40 },
    },
    {
      id: 2,
      tgChatId: -1001234567890n,
      kind: 'supergroup',
      title: 'Admin',
      username: null,
      membersCount: 3,
      isLunchGroup: false,
      captureEnabled: false,
      relayToSaved: false,
      autoReplyEnabled: false,
      autoReplyDelaySec: 80,
      autoReplyNote: null,
      lastMessageAt: null,
      lastCapturedAt: null,
      dialogSyncedAt: null,
      _count: { messages: 0 },
    },
    {
      id: 3,
      tgChatId: 777n,
      kind: 'private',
      title: 'Оля',
      username: null,
      membersCount: null,
      isLunchGroup: false,
      captureEnabled: false,
      relayToSaved: false,
      autoReplyEnabled: false,
      autoReplyDelaySec: 80,
      autoReplyNote: null,
      lastMessageAt: null,
      lastCapturedAt: null,
      dialogSyncedAt: null,
      _count: { messages: 0 },
    },
  ];
  const jobs: Array<Record<string, unknown>> = [];
  const updates: Array<{ where: { id: number }; data: Record<string, unknown> }> = [];
  const messageQueries: Array<Record<string, unknown>> = [];
  const queueUpdates: Array<Record<string, unknown>> = [];

  const prisma = {
    lunchOutboundMessage: {
      count: async (args: { where: Record<string, unknown> }) => {
        if (args.where.status === 'failed') return 2;
        if (args.where.nextAttemptAt) return 1;
        return 3;
      },
      updateMany: async (args: Record<string, unknown>) => {
        queueUpdates.push(args);
        return { count: 2 };
      },
    },
    dzhuraState: {
      findUnique: async () => ({
        id: 1,
        heartbeatAt: new Date(Date.now() - 5_000),
        dialogsSyncedAt: new Date('2026-09-25T08:00:00Z'),
        meTgUserId: 438099n,
      }),
    },
    dzhuraChat: {
      findMany: async (args: { where?: { kind?: { in: string[] } } }) =>
        chats.filter((c) => !args.where?.kind || args.where.kind.in.includes(c.kind)),
      findUnique: async (args: { where: { id: number } }) => chats.find((c) => c.id === args.where.id) ?? null,
      update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        updates.push(args);
        const c = chats.find((x) => x.id === args.where.id)!;
        Object.assign(c, args.data);
        return c;
      },
    },
    dzhuraJob: {
      findFirst: async () => null,
      create: async (args: { data: Record<string, unknown> }) => {
        const row = {
          id: jobs.length + 1,
          ...args.data,
          progressJson: null,
          resultJson: null,
          errorText: null,
          createdAt: new Date('2026-09-25T10:00:00Z'),
          startedAt: null,
          finishedAt: null,
          paramsJson: args.data.paramsJson ?? null,
        };
        jobs.push(row);
        return row;
      },
      findUnique: async (args: { where: { id: number } }) => jobs.find((j) => j.id === args.where.id) ?? null,
      findMany: async () => [...jobs].reverse(),
    },
    dzhuraMessage: {
      findMany: async (args: Record<string, unknown>) => [
        (messageQueries.push(args), {
          id: 501,
          tgMessageId: 77n,
          sentAt: new Date('2026-09-25T08:00:00Z'),
          sender: { id: 2, tgUserId: 200n, firstName: 'Костя', lastName: null, username: null, phone: null, isMe: false },
          isOutgoing: false,
          isAutoReply: false,
          text: 'hi',
          mediaKind: null,
          replyToTgMessageId: 70n,
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
            { emoji: '❤️', isMine: true, person: { id: 1, tgUserId: 1n, firstName: 'Сергій', lastName: null, username: 'me', phone: null, isMe: true }, addedAt: new Date('2026-09-25T08:01:00Z'), removedAt: null },
          ],
        }),
      ],
    },
  } as unknown as PrismaClient;

  return { prisma, chats, jobs, updates, messageQueries, queueUpdates };
}

async function app(prisma: PrismaClient) {
  return listenLocal(createApp({ prisma, adminPassword: 'x' }));
}

const auth = { Authorization: adminAuthToken('x') };

describe('/admin/dzhura', () => {
  test('401 без токена', async () => {
    const { prisma } = makeStub();
    await request(await app(prisma)).get('/admin/dzhura/chats').expect(401);
    await request(await app(prisma)).get('/admin/dzhura/status').expect(401);
  });

  test('GET status: heartbeat свіжий, BigInt як рядок', async () => {
    const { prisma } = makeStub();
    const res = await request(await app(prisma)).get('/admin/dzhura/status').set(auth).expect(200);
    expect(res.body.heartbeatFresh).toBe(true);
    expect(res.body.meTgUserId).toBe('438099');
    expect(typeof res.body.listenerWanted).toBe('boolean');
    expect(res.body.queue).toEqual({ pending: 3, retrying: 1, failed24h: 2 });
  });

  test('GET messages: сторінка з пошуком і курсором, BigInt як рядки', async () => {
    const { prisma, messageQueries } = makeStub();
    const a = await app(prisma);
    const res = await request(a).get('/admin/dzhura/chats/2/messages?q=hi&limit=20').set(auth).expect(200);
    expect(res.body.nextBeforeId).toBeNull();
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toMatchObject({
      id: 501,
      tgMessageId: '77',
      replyToTgMessageId: '70',
      sender: { tgUserId: '200', name: 'Костя' },
      reactions: [{ emoji: '❤️', by: 'Сергій', isMine: true }],
      reactionsCounts: { '❤️': 1 },
    });
    const args = messageQueries[0] as { where: { OR?: unknown[]; chatId: number }; take: number };
    expect(args.where.chatId).toBe(2);
    expect(args.where.OR).toHaveLength(2);
    expect(args.take).toBe(21);

    await request(a).get('/admin/dzhura/chats/2/messages?beforeId=abc').set(auth).expect(400);
    await request(a).get('/admin/dzhura/chats/2/messages?from=2026-09-01').set(auth).expect(400);
    await request(a).get('/admin/dzhura/chats/99/messages').set(auth).expect(404);
  });

  test('POST queue/retry-failed повертає невдалі дублі в чергу', async () => {
    const { prisma, queueUpdates } = makeStub();
    const res = await request(await app(prisma)).post('/admin/dzhura/queue/retry-failed').set(auth).expect(200);
    expect(res.body).toEqual({ requeued: 2 });
    expect(queueUpdates[0]).toMatchObject({
      where: { target: 'saved', status: 'failed' },
      data: { status: 'pending', attempts: 0, nextAttemptAt: null, errorText: null },
    });
  });

  test('GET chats: групи за замовчуванням, з лічильником', async () => {
    const { prisma } = makeStub();
    const res = await request(await app(prisma)).get('/admin/dzhura/chats').set(auth).expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 1, tgChatId: '-5427750954', isLunchGroup: true, messagesCount: 40 });
  });

  test('PATCH: групу обідів не можна перестати читати', async () => {
    const { prisma } = makeStub();
    const res = await request(await app(prisma))
      .patch('/admin/dzhura/chats/1')
      .set(auth)
      .send({ captureEnabled: false })
      .expect(400);
    expect(res.body.error).toMatch(/обідів/);
  });

  test('PATCH: ввімкнути читання і дубль; вимкнення читання скидає дубль', async () => {
    const { prisma, updates } = makeStub();
    const a = await app(prisma);
    const on = await request(a)
      .patch('/admin/dzhura/chats/2')
      .set(auth)
      .send({ captureEnabled: true, relayToSaved: true })
      .expect(200);
    expect(on.body).toMatchObject({ id: 2, captureEnabled: true, relayToSaved: true });
    await request(a).patch('/admin/dzhura/chats/2').set(auth).send({ captureEnabled: false }).expect(200);
    expect(updates[1].data).toEqual({ captureEnabled: false, relayToSaved: false, autoReplyEnabled: false });
    await request(a).patch('/admin/dzhura/chats/2').set(auth).send({}).expect(400);
    await request(a).patch('/admin/dzhura/chats/99').set(auth).send({ relayToSaved: true }).expect(404);
  });

  test('PATCH автовідповідь: лише особистий чат із «Читати»; секунди й підказка', async () => {
    const { prisma, updates } = makeStub();
    const a = await app(prisma);
    const list = await request(a).get('/admin/dzhura/chats?kind=all').set(auth).expect(200);
    expect(list.body[2]).toMatchObject({ id: 3, autoReplyEnabled: false, autoReplyDelaySec: 80, autoReplyNote: null });

    // група — ні; особистий без «Читати» — ні
    const group = await request(a).patch('/admin/dzhura/chats/1').set(auth).send({ autoReplyEnabled: true }).expect(400);
    expect(group.body.error).toMatch(/особистих/);
    const noCapture = await request(a).patch('/admin/dzhura/chats/3').set(auth).send({ autoReplyEnabled: true }).expect(400);
    expect(noCapture.body.error).toMatch(/Читати/);

    const on = await request(a)
      .patch('/admin/dzhura/chats/3')
      .set(auth)
      .send({ captureEnabled: true, autoReplyEnabled: true, autoReplyDelaySec: 120, autoReplyNote: '  подруга, жартуємо  ' })
      .expect(200);
    expect(on.body).toMatchObject({
      captureEnabled: true,
      autoReplyEnabled: true,
      autoReplyDelaySec: 120,
      autoReplyNote: 'подруга, жартуємо',
    });

    for (const bad of [4, 3601, 80.5, '80']) {
      await request(a).patch('/admin/dzhura/chats/3').set(auth).send({ autoReplyDelaySec: bad }).expect(400);
    }
    await request(a).patch('/admin/dzhura/chats/3').set(auth).send({ autoReplyNote: 'x'.repeat(2001) }).expect(400);
    const cleared = await request(a).patch('/admin/dzhura/chats/3').set(auth).send({ autoReplyNote: '' }).expect(200);
    expect(cleared.body.autoReplyNote).toBeNull();

    // без «Читати» відповідати нема з чого: галочка знімається разом із читанням, секунди лишаються
    const off = await request(a).patch('/admin/dzhura/chats/3').set(auth).send({ captureEnabled: false }).expect(200);
    expect(off.body).toMatchObject({ captureEnabled: false, autoReplyEnabled: false, autoReplyDelaySec: 120 });
    expect(updates.at(-1)?.data).toEqual({ captureEnabled: false, relayToSaved: false, autoReplyEnabled: false });
  });

  test('POST jobs autoreply_preview: особистий чат із «Читати» і ключем Claude', async () => {
    const { prisma, chats } = makeStub();
    const a = await app(prisma);
    const prevKey = process.env.ANTHROPIC_API_KEY;
    const send = (chatId: number) => request(a).post('/admin/dzhura/jobs').set(auth).send({ type: 'autoreply_preview', chatId });
    try {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      expect((await send(1).expect(400)).body.error).toMatch(/особистих/);
      expect((await send(3).expect(400)).body.error).toMatch(/Читати/);
      chats[2].captureEnabled = true;
      const ok = await send(3).expect(201);
      expect(ok.body.job).toMatchObject({ type: 'autoreply_preview', status: 'pending', params: { chatId: 3 } });
      expect((await request(a).get('/admin/dzhura/status').set(auth).expect(200)).body.autoReplyAvailable).toBe(true);

      delete process.env.ANTHROPIC_API_KEY;
      expect((await send(3).expect(400)).body.error).toMatch(/ANTHROPIC_API_KEY/);
      expect((await request(a).get('/admin/dzhura/status').set(auth).expect(200)).body.autoReplyAvailable).toBe(false);
      await send(99).expect(404);
    } finally {
      if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevKey;
    }
  });

  test('POST jobs: sync_dialogs і backfill з валідацією', async () => {
    const { prisma, jobs } = makeStub();
    const a = await app(prisma);
    const sync = await request(a).post('/admin/dzhura/jobs').set(auth).send({ type: 'sync_dialogs' }).expect(201);
    expect(sync.body.job).toMatchObject({ id: 1, type: 'sync_dialogs', status: 'pending', params: null });

    const bf = await request(a)
      .post('/admin/dzhura/jobs')
      .set(auth)
      .send({ type: 'backfill', chatId: 2, from: '2026-09-01', to: '2026-09-07' })
      .expect(201);
    expect(bf.body.job.params).toEqual({ chatId: 2, from: '2026-09-01', to: '2026-09-07' });
    expect(jobs).toHaveLength(2);

    await request(a).post('/admin/dzhura/jobs').set(auth).send({ type: 'backfill', chatId: 2, from: '2026-09-07', to: '2026-09-01' }).expect(400);
    await request(a).post('/admin/dzhura/jobs').set(auth).send({ type: 'backfill', chatId: 99, from: '2026-09-01', to: '2026-09-02' }).expect(404);
    await request(a).post('/admin/dzhura/jobs').set(auth).send({ type: 'weird' }).expect(400);

    const got = await request(a).get('/admin/dzhura/jobs/2').set(auth).expect(200);
    expect(got.body.type).toBe('backfill');
    await request(a).get('/admin/dzhura/jobs/42').set(auth).expect(404);
  });

  test('POST jobs post_items / avatars: лише звичайна група, у відповіді без base64, повтор частини — 409', async () => {
    const { prisma, jobs } = makeStub();
    const a = await app(prisma);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]).toString('base64');
    const body = { type: 'post_items', chatId: 2, batch: 'osbb-test', seq: 0, items: [{ kind: 'photo', jpegBase64: jpeg }, { kind: 'text', html: 'x' }] };
    const res = await request(a).post('/admin/dzhura/jobs').set(auth).send(body).expect(201);
    expect(res.body.job.params).toEqual({ chatId: 2, batch: 'osbb-test', seq: 0, silent: true, itemsCount: 2, photos: 1 });
    expect((jobs[0].paramsJson as { items: unknown[] }).items).toHaveLength(2);

    await request(a).post('/admin/dzhura/jobs').set(auth).send({ ...body, chatId: 1 }).expect(400);
    await request(a).post('/admin/dzhura/jobs').set(auth).send({ ...body, chatId: 3 }).expect(400);
    await request(a).post('/admin/dzhura/jobs').set(auth).send({ ...body, chatId: 99 }).expect(404);

    const av = await request(a).post('/admin/dzhura/jobs').set(auth).send({ type: 'avatars', chatId: 2 }).expect(201);
    expect(av.body.job.params).toEqual({ chatId: 2 });

    const imp = await request(a)
      .post('/admin/dzhura/jobs')
      .set(auth)
      .send({ type: 'import_history', chatId: 2, text: '22.11.26, 14:12 - Ksu: hi\n', dryRun: true })
      .expect(201);
    expect(imp.body.job.params).toEqual({ chatId: 2, fileName: 'WhatsApp Chat.txt', dryRun: true, textChars: 26, mediaCount: 0 });
    await request(a).post('/admin/dzhura/jobs').set(auth).send({ type: 'import_history', chatId: 1, text: 'x' }).expect(400);
    const part = await request(a)
      .post('/admin/dzhura/jobs')
      .set(auth)
      .send({ type: 'import_history', chatId: 2, stage: 'media', importId: '42', media: [{ name: 'IMG-1.jpg', jpegBase64: jpeg }] })
      .expect(201);
    expect(part.body.job.params).toEqual({ chatId: 2, stage: 'media', importId: '42', mediaCount: 1 });
    const scan = await request(a).post('/admin/dzhura/jobs').set(auth).send({ type: 'scan_ids', chatId: 2 }).expect(201);
    expect(scan.body.job.params).toEqual({ chatId: 2 });

    (prisma as unknown as { dzhuraJob: { findFirst: () => Promise<unknown> } }).dzhuraJob.findFirst = async () => ({ id: 5, status: 'done' });
    const dup = await request(a).post('/admin/dzhura/jobs').set(auth).send(body).expect(409);
    expect(dup.body.error).toMatch(/опублікована.*№5/);
  });

  test('POST jobs: 409 коли така сама вже в черзі', async () => {
    const { prisma } = makeStub();
    (prisma as unknown as { dzhuraJob: { findFirst: () => Promise<unknown> } }).dzhuraJob.findFirst = async () => ({
      id: 7,
      type: 'sync_dialogs',
      status: 'running',
      paramsJson: null,
    });
    const res = await request(await app(prisma)).post('/admin/dzhura/jobs').set(auth).send({ type: 'sync_dialogs' }).expect(409);
    expect(res.body.error).toMatch(/№7/);
  });

  test('GET export: файл JSON із заголовками, BigInt як рядки', async () => {
    const { prisma } = makeStub();
    const res = await request(await app(prisma))
      .get('/admin/dzhura/chats/2/export?from=2026-09-25&to=2026-09-25')
      .set(auth)
      .expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="dzhura-admin-2026-09-25_2026-09-25.json"');
    const body = JSON.parse(res.text);
    expect(body.project).toBe('dzhura');
    expect(body.messages[0]).toMatchObject({ tgMessageId: '77', replyToTgMessageId: '70', sender: { tgUserId: '200' } });
    await request(await app(prisma)).get('/admin/dzhura/chats/2/export?from=bad&to=2026-09-25').set(auth).expect(400);
  });
});
