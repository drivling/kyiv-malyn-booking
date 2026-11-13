"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOVEDE_LOG_ROWS = exports.DOVEDE_LOG_SCAN = exports.DOVEDE_LOG_DAYS = void 0;
exports.finalIntent = finalIntent;
exports.flagsOf = flagsOf;
exports.toLogItem = toLogItem;
exports.summarizeQueries = summarizeQueries;
exports.parseLogDays = parseLogDays;
exports.DOVEDE_LOG_DAYS = [1, 7, 30, 90];
/** Скільки рядків за період читаємо для зведення і скільки останніх віддаємо в таблицю */
exports.DOVEDE_LOG_SCAN = 5000;
exports.DOVEDE_LOG_ROWS = 300;
function asIntent(v) {
    if (!v || typeof v !== 'object')
        return null;
    const i = v;
    return typeof i.intent === 'string' && i.when != null && Array.isArray(i.unknown) ? i : null;
}
/** Остаточне розуміння питання: Claude, а коли його не було — браузер */
function finalIntent(row) {
    return asIntent(row.aiIntent) ?? asIntent(row.localIntent);
}
function flagsOf(row) {
    const flags = [];
    if (row.status !== 'ok')
        flags.push('fail');
    if (row.agree === false)
        flags.push('disagree');
    const intent = finalIntent(row);
    if (intent) {
        if (intent.unknown.length > 0)
            flags.push('unknown');
        // «куди їде №5» місць не потребує
        const needsPlaces = intent.intent === 'trip' || intent.intent === 'schedule' || intent.intent === 'price';
        if (needsPlaces && (!intent.from || !intent.to))
            flags.push('no_place');
        if (intent.intent === 'other')
            flags.push('other');
    }
    return flags;
}
function toLogItem(row) {
    return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        text: row.text,
        status: row.status,
        aiCalled: row.aiCalled,
        agree: row.agree,
        latencyMs: row.latencyMs,
        model: row.model,
        promptVersion: row.promptVersion,
        error: row.error,
        local: asIntent(row.localIntent),
        ai: asIntent(row.aiIntent),
        flags: flagsOf(row),
    };
}
function median(values) {
    if (values.length === 0)
        return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
function summarizeQueries(rows, topN = 30) {
    const byStatus = new Map();
    const unknown = new Map();
    const latencies = [];
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let aiCalls = 0;
    let aiOk = 0;
    let agreed = 0;
    let disagreed = 0;
    let withUnknown = 0;
    let noPlace = 0;
    for (const row of rows) {
        byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
        if (row.aiCalled) {
            aiCalls++;
            if (row.status === 'ok') {
                aiOk++;
                if (row.latencyMs != null)
                    latencies.push(row.latencyMs);
            }
        }
        tokens.input += row.inputTokens ?? 0;
        tokens.output += row.outputTokens ?? 0;
        tokens.cacheRead += row.cacheReadTokens ?? 0;
        tokens.cacheWrite += row.cacheWriteTokens ?? 0;
        if (row.agree === true)
            agreed++;
        if (row.agree === false)
            disagreed++;
        const flags = flagsOf(row);
        if (flags.includes('unknown'))
            withUnknown++;
        if (flags.includes('no_place'))
            noPlace++;
        for (const raw of finalIntent(row)?.unknown ?? []) {
            const word = typeof raw === 'string' ? raw.trim() : '';
            if (!word)
                continue;
            const key = word.toLowerCase();
            const hit = unknown.get(key);
            if (hit)
                hit.count++;
            else
                unknown.set(key, { word, count: 1, example: row.text });
        }
    }
    return {
        total: rows.length,
        aiCalls,
        aiOk,
        aiFailed: aiCalls - aiOk,
        agreed,
        disagreed,
        withUnknown,
        noPlace,
        medianLatencyMs: median(latencies),
        tokens,
        byStatus: [...byStatus].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
        topUnknown: [...unknown.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'uk')).slice(0, topN),
    };
}
function parseLogDays(raw) {
    const n = Number(raw);
    return exports.DOVEDE_LOG_DAYS.includes(n) ? n : 7;
}
