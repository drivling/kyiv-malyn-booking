"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DOVEDE_MODEL = void 0;
exports.dovedeModelName = dovedeModelName;
exports.makeAnthropicClient = makeAnthropicClient;
exports.createUnderstand = createUnderstand;
exports.understandFromEnv = understandFromEnv;
/**
 * «Доведе» — виклик Claude: текст питання → TripIntent (Docs/dovede-roadmap.md, фаза 2).
 * Той самий спосіб, що в автовідповіді Джури (`telegram-user/dzhura/autoreply.py`): structured output за
 * JSON-схемою, серверний fallback на випадок відмови класифікатора. Системний промпт незмінний і кешується.
 * Будь-який збій тут не помилка для людини: сторінка відповідає з місцевого розбору.
 */
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const intent_1 = require("./intent");
const prompt_1 = require("./prompt");
const stopPlaces_1 = require("./stopPlaces");
exports.DEFAULT_DOVEDE_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 8000;
/** Лише claude-*: значення з env не має відкривати довільну модель */
function dovedeModelName(raw) {
    const v = (raw ?? '').trim();
    return v.startsWith('claude-') ? v : exports.DEFAULT_DOVEDE_MODEL;
}
function makeAnthropicClient(apiKey, workspaceId) {
    const workspace = (workspaceId ?? '').trim();
    return new sdk_1.default({
        apiKey,
        // ключ рівня організації приймається лише з id воркспейсу (як у lunch/ocr_menu.py)
        defaultHeaders: workspace ? { 'anthropic-workspace-id': workspace } : undefined,
    });
}
function usageOf(u) {
    return {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    };
}
function createUnderstand(deps) {
    const model = dovedeModelName(deps.model);
    const clock = deps.clock ?? Date.now;
    // Промпт будується один раз на список зупинок: той самий масив — той самий рядок, кеш Claude не збивається
    let built = null;
    const promptFor = (stops, routes) => {
        if (!built || built.stops !== stops || built.routes !== routes) {
            built = {
                stops,
                routes,
                system: (0, prompt_1.buildSystemPrompt)(stops ?? [], routes ?? []),
                stopIds: new Set((0, stopPlaces_1.buildStopPlaces)(stops ?? []).map((e) => e.place.id)),
                routeIds: new Set((routes ?? []).map((r) => r.id)),
            };
        }
        return built;
    };
    return async (text, now, stops, routes, synonyms) => {
        const { system, stopIds, routeIds } = promptFor(stops, routes);
        const started = clock();
        const base = { model, promptVersion: prompt_1.PROMPT_VERSION };
        const fail = (failure, message, usage) => ({
            ok: false,
            failure,
            message: message.slice(0, 300),
            latencyMs: clock() - started,
            usage,
            ...base,
        });
        try {
            const resp = await deps.client.beta.messages.create({
                model,
                max_tokens: MAX_TOKENS,
                betas: [FALLBACK_BETA],
                fallbacks: 'default',
                system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
                output_config: { effort: 'low', format: { type: 'json_schema', schema: intent_1.INTENT_SCHEMA } },
                messages: [{ role: 'user', content: (0, prompt_1.buildUserText)(text, now, synonyms) }],
            }, { timeout: TIMEOUT_MS, maxRetries: 1 });
            const usage = usageOf(resp.usage);
            // відповідати могла запасна модель — у журнал пишемо ту, що справді відповіла
            const served = { ...base, model: resp.model || model };
            if (resp.stop_reason === 'refusal')
                return { ...fail('refusal', 'модель відмовилась розбирати питання', usage), ...served };
            if (resp.stop_reason === 'max_tokens')
                return { ...fail('max_tokens', 'відповідь моделі обрізано', usage), ...served };
            const block = resp.content.find((b) => b.type === 'text');
            const raw = block && block.type === 'text' ? block.text : '';
            let intent;
            try {
                intent = (0, intent_1.validateIntent)(JSON.parse(raw), stopIds, routeIds);
            }
            catch (e) {
                const why = e instanceof intent_1.IntentShapeError ? e.message : 'відповідь — не JSON';
                return { ...fail('invalid', why, usage), ...served };
            }
            return { ok: true, intent, latencyMs: clock() - started, usage, ...served };
        }
        catch (e) {
            if (e instanceof sdk_1.default.APIConnectionTimeoutError)
                return fail('timeout', 'Claude не відповів вчасно');
            if (e instanceof sdk_1.default.RateLimitError)
                return fail('rate_limited', e.message);
            if (e instanceof sdk_1.default.AuthenticationError || e instanceof sdk_1.default.PermissionDeniedError)
                return fail('auth', e.message);
            if (e instanceof sdk_1.default.APIError)
                return fail('api_error', `${e.status ?? ''} ${e.message}`.trim());
            return fail('api_error', e instanceof Error ? e.message : String(e));
        }
    };
}
/** Клієнт із середовища; null — ключа немає, сторінка працює на місцевому розборі */
function understandFromEnv(env = process.env) {
    const key = (env.ANTHROPIC_API_KEY ?? '').trim();
    if (!key)
        return null;
    return createUnderstand({ client: makeAnthropicClient(key, env.ANTHROPIC_WORKSPACE_ID), model: env.DOVEDE_MODEL });
}
