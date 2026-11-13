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

export const DOVEDE_MAX_TEXT = 300;

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
    modes(a.modes) === modes(b.modes)
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
    let local: TripIntent | null = null;
    if (body.local != null) {
      try {
        local = validateIntent(body.local);
      } catch (e) {
        if (!(e instanceof IntentShapeError)) throw e;
      }
    }
    const localIntent = local ? (local as unknown as Prisma.InputJsonValue) : undefined;
    const at = clock();

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

      const result = await understand(text, kyivClock(at));
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
