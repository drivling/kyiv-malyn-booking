/**
 * «Доведе» — виклик Claude: текст питання → TripIntent (Docs/dovede-roadmap.md, фаза 2).
 * Той самий спосіб, що в автовідповіді Джури (`telegram-user/dzhura/autoreply.py`): structured output за
 * JSON-схемою, серверний fallback на випадок відмови класифікатора. Системний промпт незмінний і кешується.
 * Будь-який збій тут не помилка для людини: сторінка відповідає з місцевого розбору.
 */
import Anthropic from '@anthropic-ai/sdk';
import { INTENT_SCHEMA, IntentShapeError, validateIntent, type TripIntent } from './intent';
import type { DovedeSynonymEntry } from './synonyms';
import { PROMPT_VERSION, buildSystemPrompt, buildUserText, type KyivNow, type RouteLike } from './prompt';
import { buildStopPlaces, type StopLike } from './stopPlaces';

export const DEFAULT_DOVEDE_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 8000;

export type UnderstandFailure = 'refusal' | 'max_tokens' | 'invalid' | 'timeout' | 'rate_limited' | 'auth' | 'api_error';

export interface UnderstandUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type UnderstandResult =
  | { ok: true; intent: TripIntent; model: string; latencyMs: number; usage: UnderstandUsage; promptVersion: string }
  | { ok: false; failure: UnderstandFailure; message: string; model: string; latencyMs: number; usage?: UnderstandUsage; promptVersion: string };

/** `stops` — зупинки міста з бази: Claude бачить їх усі, а `validateIntent` дозволяє їхні id */
export type UnderstandFn = (text: string, now: KyivNow, stops?: StopLike[], routes?: RouteLike[], synonyms?: DovedeSynonymEntry[]) => Promise<UnderstandResult>;

/** Лише claude-*: значення з env не має відкривати довільну модель */
export function dovedeModelName(raw: string | undefined | null): string {
  const v = (raw ?? '').trim();
  return v.startsWith('claude-') ? v : DEFAULT_DOVEDE_MODEL;
}

/** Мінімум, який нам потрібен від SDK, — щоб у тестах підставляти заглушку без мережі */
export interface DovedeMessagesClient {
  beta: { messages: { create: Anthropic['beta']['messages']['create'] } };
}

export function makeAnthropicClient(apiKey: string, workspaceId?: string | null): Anthropic {
  const workspace = (workspaceId ?? '').trim();
  return new Anthropic({
    apiKey,
    // ключ рівня організації приймається лише з id воркспейсу (як у lunch/ocr_menu.py)
    defaultHeaders: workspace ? { 'anthropic-workspace-id': workspace } : undefined,
  });
}

function usageOf(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): UnderstandUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

export function createUnderstand(deps: { client: DovedeMessagesClient; model?: string | null; clock?: () => number }): UnderstandFn {
  const model = dovedeModelName(deps.model);
  const clock = deps.clock ?? Date.now;
  // Промпт будується один раз на список зупинок: той самий масив — той самий рядок, кеш Claude не збивається
  let built: { stops: StopLike[] | undefined; routes: RouteLike[] | undefined; system: string; stopIds: Set<string>; routeIds: Set<string> } | null = null;
  const promptFor = (stops: StopLike[] | undefined, routes: RouteLike[] | undefined) => {
    if (!built || built.stops !== stops || built.routes !== routes) {
      built = {
        stops,
        routes,
        system: buildSystemPrompt(stops ?? [], routes ?? []),
        stopIds: new Set(buildStopPlaces(stops ?? []).map((e) => e.place.id)),
        routeIds: new Set((routes ?? []).map((r) => r.id)),
      };
    }
    return built;
  };

  return async (text, now, stops, routes, synonyms) => {
    const { system, stopIds, routeIds } = promptFor(stops, routes);
    const started = clock();
    const base = { model, promptVersion: PROMPT_VERSION };
    const fail = (failure: UnderstandFailure, message: string, usage?: UnderstandUsage): UnderstandResult => ({
      ok: false,
      failure,
      message: message.slice(0, 300),
      latencyMs: clock() - started,
      usage,
      ...base,
    });
    try {
      const resp = await deps.client.beta.messages.create(
        {
          model,
          max_tokens: MAX_TOKENS,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema: INTENT_SCHEMA } },
          messages: [{ role: 'user', content: buildUserText(text, now, synonyms) }],
        },
        { timeout: TIMEOUT_MS, maxRetries: 1 },
      );
      const usage = usageOf(resp.usage);
      // відповідати могла запасна модель — у журнал пишемо ту, що справді відповіла
      const served = { ...base, model: resp.model || model };
      if (resp.stop_reason === 'refusal') return { ...fail('refusal', 'модель відмовилась розбирати питання', usage), ...served };
      if (resp.stop_reason === 'max_tokens') return { ...fail('max_tokens', 'відповідь моделі обрізано', usage), ...served };
      const block = resp.content.find((b) => b.type === 'text');
      const raw = block && block.type === 'text' ? block.text : '';
      let intent: TripIntent;
      try {
        intent = validateIntent(JSON.parse(raw), stopIds, routeIds);
      } catch (e) {
        const why = e instanceof IntentShapeError ? e.message : 'відповідь — не JSON';
        return { ...fail('invalid', why, usage), ...served };
      }
      return { ok: true, intent, latencyMs: clock() - started, usage, ...served };
    } catch (e) {
      if (e instanceof Anthropic.APIConnectionTimeoutError) return fail('timeout', 'Claude не відповів вчасно');
      if (e instanceof Anthropic.RateLimitError) return fail('rate_limited', e.message);
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return fail('auth', e.message);
      if (e instanceof Anthropic.APIError) return fail('api_error', `${e.status ?? ''} ${e.message}`.trim());
      return fail('api_error', e instanceof Error ? e.message : String(e));
    }
  };
}

/** Клієнт із середовища; null — ключа немає, сторінка працює на місцевому розборі */
export function understandFromEnv(env: NodeJS.ProcessEnv = process.env): UnderstandFn | null {
  const key = (env.ANTHROPIC_API_KEY ?? '').trim();
  if (!key) return null;
  return createUnderstand({ client: makeAnthropicClient(key, env.ANTHROPIC_WORKSPACE_ID), model: env.DOVEDE_MODEL });
}
