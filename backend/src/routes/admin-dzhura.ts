/**
 * Адмін-API «Джури» (/admin/dzhura/*): чати, прапорці, задачі для слухача, експорт JSON.
 * У Telegram звідси не ходимо — все через таблиці Dzhura*, які обробляє Python-слухач.
 */
import express, { type Router, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/require-admin';
import { isLunchListenerWanted } from '../lunch-listener';
import {
  DzhuraHttpError,
  bigintReplacer,
  buildChatExport,
  createJob,
  exportFileName,
  getJob,
  getStatus,
  listChats,
  listJobs,
  listMessages,
  parseChatPatch,
  parseJobRequest,
  parseKindsFilter,
  parseMessagesQuery,
  retryFailedSaved,
  updateChatFlags,
  validateDateRange,
} from '../dzhura';

function sendError(res: Response, where: string, e: unknown): void {
  if (e instanceof DzhuraHttpError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  console.error(`❌ ${where}:`, e);
  res.status(500).json({ error: 'Внутрішня помилка' });
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new DzhuraHttpError(400, 'Некоректний id');
  return id;
}

export function createAdminDzhuraRouter(deps: { prisma: PrismaClient; listenerWanted?: () => boolean }): Router {
  const { prisma } = deps;
  const listenerWanted = deps.listenerWanted ?? isLunchListenerWanted;
  const r = express.Router();

  /** Стан слухача: чи взагалі має працювати і чи живий (heartbeat < 60 с) */
  r.get('/admin/dzhura/status', requireAdmin, async (_req, res) => {
    try {
      res.json(await getStatus(prisma, listenerWanted()));
    } catch (e) {
      sendError(res, 'GET /admin/dzhura/status', e);
    }
  });

  /** Список чатів (за замовчуванням групи й супергрупи; ?kind=all — усе) */
  r.get('/admin/dzhura/chats', requireAdmin, async (req, res) => {
    try {
      res.json(await listChats(prisma, parseKindsFilter(req.query.kind)));
    } catch (e) {
      sendError(res, 'GET /admin/dzhura/chats', e);
    }
  });

  /** Прапорці «Читати» / «В Обране» */
  r.patch('/admin/dzhura/chats/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      res.json(await updateChatFlags(prisma, id, parseChatPatch(req.body)));
    } catch (e) {
      sendError(res, 'PATCH /admin/dzhura/chats/:id', e);
    }
  });

  /** Перегляд збережених повідомлень: новіші першими, ?from&to, ?q, курсор ?beforeId */
  r.get('/admin/dzhura/chats/:id/messages', requireAdmin, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const page = await listMessages(prisma, id, parseMessagesQuery(req.query as Record<string, unknown>));
      res.json(page);
    } catch (e) {
      sendError(res, 'GET /admin/dzhura/chats/:id/messages', e);
    }
  });

  /** Повернути невдалі дублі в «Обране» (за тиждень) у чергу */
  r.post('/admin/dzhura/queue/retry-failed', requireAdmin, async (_req, res) => {
    try {
      const requeued = await retryFailedSaved(prisma);
      res.json({ requeued });
    } catch (e) {
      sendError(res, 'POST /admin/dzhura/queue/retry-failed', e);
    }
  });

  /** Експорт повідомлень чату за період (доби Києва) у JSON-файл */
  r.get('/admin/dzhura/chats/:id/export', requireAdmin, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      const { from, to } = validateDateRange(req.query.from, req.query.to);
      const payload = await buildChatExport(prisma, id, from, to);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${exportFileName(payload.chat, from, to)}"`);
      res.send(JSON.stringify(payload, bigintReplacer, 2));
    } catch (e) {
      sendError(res, 'GET /admin/dzhura/chats/:id/export', e);
    }
  });

  /** Задача для слухача: {type:'sync_dialogs'} | {type:'backfill', chatId, from, to} */
  r.post('/admin/dzhura/jobs', requireAdmin, async (req, res) => {
    try {
      const job = await createJob(prisma, parseJobRequest(req.body));
      res.status(201).json({ job });
    } catch (e) {
      sendError(res, 'POST /admin/dzhura/jobs', e);
    }
  });

  r.get('/admin/dzhura/jobs', requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 50);
      res.json(await listJobs(prisma, limit));
    } catch (e) {
      sendError(res, 'GET /admin/dzhura/jobs', e);
    }
  });

  r.get('/admin/dzhura/jobs/:id', requireAdmin, async (req, res) => {
    try {
      res.json(await getJob(prisma, parseId(req.params.id)));
    } catch (e) {
      sendError(res, 'GET /admin/dzhura/jobs/:id', e);
    }
  });

  return r;
}
