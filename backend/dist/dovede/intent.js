"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntentShapeError = exports.INTENT_SCHEMA = exports.DETAIL_CITY_IDS = void 0;
exports.isKnownPlaceId = isKnownPlaceId;
exports.validateIntent = validateIntent;
/**
 * «Доведе» — контракт TripIntent на сервері (Docs/dovede-roadmap.md, «Контракти»). Той самий, що у
 * `frontend/src/pages/DovedePage/nlu/types.ts`. Claude повертає його як structured output; `validateIntent`
 * не довіряє відповіді: чужі id місць переносить у `unknown`, зайве відкидає. Чисел розкладу тут немає.
 */
const gazetteer_1 = require("./gazetteer");
const kyivMetroData_1 = require("./kyivMetroData");
const landmarks_1 = require("./landmarks");
const streets_1 = require("./streets");
const LANDMARK_IDS = new Set(landmarks_1.MALYN_LANDMARKS.map((l) => l.id));
const METRO_IDS = new Set(kyivMetroData_1.METRO_STATIONS.map((s) => s.id));
const STREET_IDS = new Set(streets_1.MALYN_STREETS.map((s) => s.id));
/** `street.x` або `street.x:20` — номер будинку браузер дописує до id сам (frontend nlu/streets.ts) */
const STREET_ID_RE = /^(street\.[a-z0-9-]+)(?::[0-9]{1,3}[а-яіїєa-z]?)?$/;
function isStreetId(id) {
    const m = STREET_ID_RE.exec(id);
    return m != null && STREET_IDS.has(m[1]);
}
/** Чи це місце, яке знає «Доведе»: кураторський словник, зупинка міста, вулиця (з будинком чи без), орієнтир, станція метро Києва */
function isKnownPlaceId(id, stopIds) {
    return (0, gazetteer_1.placeById)(id) != null || stopIds?.has(id) === true || isStreetId(id) || LANDMARK_IDS.has(id) || METRO_IDS.has(id);
}
/** Міста, всередині яких «Доведе» шукає дорогу до місця, названого словами (dovede/city-route.ts) */
exports.DETAIL_CITY_IDS = new Set(['city.Kyiv', 'city.Zhytomyr']);
const INTENTS = ['trip', 'schedule', 'route', 'price', 'contact', 'other'];
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
                detail: {
                    anyOf: [
                        { type: 'string', description: 'лише з city.Kyiv або city.Zhytomyr: місце в цьому місті, якого немає у списках, у називному відмінку' },
                        { type: 'null' },
                    ],
                },
            },
            required: ['id', 'text', 'detail'],
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
        routes: { type: 'array', items: { type: 'string', description: 'id маршруту міського автобуса зі списку маршрутів' } },
        avoidRoutes: { type: 'array', items: { type: 'string', description: 'id маршруту, яким людина їхати не хоче («крім сімки»)' } },
        unknown: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'string', enum: CONFIDENCE },
    },
    required: ['intent', 'from', 'to', 'when', 'modes', 'routes', 'avoidRoutes', 'unknown', 'confidence'],
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
 * `routeIds` — id маршрутів міста; маршрут поза списком просто відкидається.
 */
function validateIntent(raw, stopIds, routeIds) {
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
        if (!isKnownPlaceId(id, stopIds)) {
            pushUnknown(text || id.slice(0, MAX_TEXT));
            return null;
        }
        const detail = exports.DETAIL_CITY_IDS.has(id) ? clip(p.detail) : '';
        return { id, text: text || id, ...(detail.length >= 2 ? { detail } : {}) };
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
    const routes = [];
    if (Array.isArray(o.routes)) {
        for (const r of o.routes) {
            if (typeof r === 'string' && routeIds?.has(r) && !routes.includes(r))
                routes.push(r);
        }
    }
    // заборона сильніша: маршрут, якого просили уникати, серед бажаних не лишається
    const avoidRoutes = [];
    if (Array.isArray(o.avoidRoutes)) {
        for (const r of o.avoidRoutes) {
            if (typeof r === 'string' && routeIds?.has(r) && !avoidRoutes.includes(r))
                avoidRoutes.push(r);
        }
    }
    for (const r of avoidRoutes) {
        const at = routes.indexOf(r);
        if (at >= 0)
            routes.splice(at, 1);
    }
    let intent = oneOf(INTENTS, o.intent, 'trip');
    // «питання про маршрут» без жодного відомого маршруту — звичайне питання про дорогу
    if (intent === 'route' && !routes.length)
        intent = 'trip';
    let confidence = oneOf(CONFIDENCE, o.confidence, 'low');
    // місце відкинуто або не назване — «high» бути не може (крім питання про сам маршрут: йому місце не потрібне)
    if (confidence === 'high' && (unknown.length > 0 || (!to && intent !== 'route')))
        confidence = 'medium';
    return { intent, from, to, when, modes, ...(routes.length ? { routes } : {}), ...(avoidRoutes.length ? { avoidRoutes } : {}), unknown, confidence };
}
