"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntentShapeError = exports.INTENT_SCHEMA = void 0;
exports.validateIntent = validateIntent;
/**
 * «Доведе» — контракт TripIntent на сервері (Docs/dovede-roadmap.md, «Контракти»). Той самий, що у
 * `frontend/src/pages/DovedePage/nlu/types.ts`. Claude повертає його як structured output; `validateIntent`
 * не довіряє відповіді: чужі id місць переносить у `unknown`, зайве відкидає. Чисел розкладу тут немає.
 */
const gazetteer_1 = require("./gazetteer");
const INTENTS = ['trip', 'schedule', 'price', 'contact', 'other'];
const MODES = ['marshrutka', 'elektrichka', 'poputka', 'city_bus'];
const KINDS = ['depart', 'arrive', 'any'];
const PARTS = ['morning', 'day', 'evening'];
const CONFIDENCE = ['high', 'medium', 'low'];
const PLACE_REF_SCHEMA = {
    anyOf: [
        {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'id зі словника місць, точно як у списку' },
                text: { type: 'string', description: 'як це місце назвала людина' },
            },
            required: ['id', 'text'],
            additionalProperties: false,
        },
        { type: 'null' },
    ],
};
/** Схема відповіді Claude. Незмінна між запитами — частина кешованого префікса. Id місць — рядок, а не enum. */
exports.INTENT_SCHEMA = {
    type: 'object',
    properties: {
        intent: { type: 'string', enum: INTENTS },
        from: PLACE_REF_SCHEMA,
        to: PLACE_REF_SCHEMA,
        when: {
            type: 'object',
            properties: {
                day: { type: 'string', description: "'today', 'tomorrow' або дата 'YYYY-MM-DD'" },
                time: { anyOf: [{ type: 'string', description: "'HH:MM' за Києвом" }, { type: 'null' }] },
                kind: { type: 'string', enum: KINDS },
                part: { anyOf: [{ type: 'string', enum: PARTS }, { type: 'null' }] },
            },
            required: ['day', 'time', 'kind', 'part'],
            additionalProperties: false,
        },
        modes: { type: 'array', items: { type: 'string', enum: MODES } },
        unknown: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'string', enum: CONFIDENCE },
    },
    required: ['intent', 'from', 'to', 'when', 'modes', 'unknown', 'confidence'],
    additionalProperties: false,
};
const DAY_RE = /^(today|tomorrow|\d{4}-\d{2}-\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TEXT = 80;
function oneOf(list, v, fallback) {
    return typeof v === 'string' && list.includes(v) ? v : fallback;
}
function clip(v) {
    return typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '';
}
class IntentShapeError extends Error {
}
exports.IntentShapeError = IntentShapeError;
/**
 * Перевіряє й чистить намір (від Claude або від браузера). Місце з id, якого немає в словнику, стає `null`,
 * а його текст потрапляє в `unknown` — складальник покаже «не знаю, де це», а не вигадану зупинку.
 * `stopIds` — id зупинок із розкладу міста (`buildStopPlaces`), теж дозволені в from / to.
 */
function validateIntent(raw, stopIds) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new IntentShapeError('намір — не обʼєкт');
    const o = raw;
    const unknown = [];
    const pushUnknown = (s) => {
        if (s && !unknown.includes(s) && unknown.length < 8)
            unknown.push(s);
    };
    if (Array.isArray(o.unknown))
        o.unknown.forEach((u) => pushUnknown(clip(u)));
    const place = (v) => {
        if (!v || typeof v !== 'object')
            return null;
        const p = v;
        const id = typeof p.id === 'string' ? p.id.trim() : '';
        const text = clip(p.text);
        if (!(0, gazetteer_1.placeById)(id) && !stopIds?.has(id)) {
            pushUnknown(text || id.slice(0, MAX_TEXT));
            return null;
        }
        return { id, text: text || id };
    };
    const from = place(o.from);
    const to = place(o.to);
    const w = (o.when && typeof o.when === 'object' ? o.when : {});
    const when = {
        day: typeof w.day === 'string' && DAY_RE.test(w.day) ? w.day : 'today',
        kind: oneOf(KINDS, w.kind, 'depart'),
    };
    if (typeof w.time === 'string' && TIME_RE.test(w.time))
        when.time = w.time;
    if (typeof w.part === 'string' && PARTS.includes(w.part))
        when.part = w.part;
    const modes = [];
    if (Array.isArray(o.modes)) {
        for (const m of o.modes) {
            if (typeof m === 'string' && MODES.includes(m) && !modes.includes(m))
                modes.push(m);
        }
    }
    let confidence = oneOf(CONFIDENCE, o.confidence, 'low');
    // місце відкинуто або не назване — «high» бути не може
    if (confidence === 'high' && (unknown.length > 0 || !to))
        confidence = 'medium';
    return { intent: oneOf(INTENTS, o.intent, 'trip'), from, to, when, modes, unknown, confidence };
}
