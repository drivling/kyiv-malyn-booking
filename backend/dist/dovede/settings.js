"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SETTING_GROUP_LABEL = exports.DOVEDE_SETTINGS = exports.GOOGLE_DAILY_MAX = exports.GOOGLE_DAILY_WARN = void 0;
exports.validSettingValue = validSettingValue;
exports.confirmNeeded = confirmNeeded;
exports.settingDef = settingDef;
exports.createDovedeSettings = createDovedeSettings;
/**
 * «Доведе» · налаштування, які власник міняє сам в адмінці (Docs/dovede-admin-roadmap.md, крок 3).
 *
 * Один перелік (`DOVEDE_SETTINGS`): ключ, група, підпис, межі, типове значення зі змінної середовища або з коду.
 * Значення, задані в адмінці, лежать у `DovedeSetting` (ключ → JSON); `null` / немає рядка — типове. Читання — з
 * памʼяті на хвилину (усі ключі разом), запис її скидає, тож нове значення діє за хвилину й без деплою.
 *
 * Вмикачі мають головний вимикач на сервері: якщо змінна середовища каже «вимкнено» (`DOVEDE_ENABLED=0` тощо),
 * адмінка увімкнути не може — рядок показує «вимкнено на сервері». Ключі й паролі тут не живуть ніколи.
 */
const client_1 = require("@prisma/client");
const envInt = (name, code, min = 0) => (env) => {
    const raw = (env[name] ?? '').trim();
    const n = Number(raw);
    return raw && Number.isInteger(n) && n >= min ? { value: n, source: 'env' } : { value: code, source: 'code' };
};
const codeInt = (code) => () => ({ value: code, source: 'code' });
const onByDefault = () => ({ value: true, source: 'code' });
/** «вимкнено на сервері»: змінна має одне з вимикальних значень */
const offWhen = (name, offValues) => (env) => {
    const v = (env[name] ?? '').trim().toLowerCase();
    return offValues.includes(v) ? `${name}=${env[name]?.trim()}` : null;
};
const OFF = ['0', 'false', 'off', 'no'];
/**
 * Денні ліміти запитів до Google (рішення власника 2026-11-22): до 20 000 — без питань; більше теж можна, але з
 * попередженням і підтвердженням. Мільйон — лише запобіжник від зайвих нулів (лічильники в базі — Int).
 */
exports.GOOGLE_DAILY_WARN = 20000;
exports.GOOGLE_DAILY_MAX = 1000000;
const GOOGLE_DAILY_WARN_TEXT = 'Понад 20 000 запитів до Google на день. Перевірте квоту проєкту в Google Cloud (понад неї Google сам відповість «квоту вичерпано») і бюджет: запити понад безкоштовний місячний обсяг платні.';
exports.DOVEDE_SETTINGS = [
    {
        key: 'ai.enabled',
        group: 'ai',
        kind: 'bool',
        label: 'Розбір питань через ШІ',
        help: 'Вимкнено — сторінка відповідає лише за своїм словником (як без мережі).',
        defaultFrom: onByDefault,
        masterOff: offWhen('DOVEDE_ENABLED', OFF),
    },
    {
        key: 'ai.dailyCap',
        group: 'ai',
        kind: 'int',
        label: 'Викликів ШІ на день',
        help: 'Скільки разів за київську добу можна спитати Claude. 0 — лише словник.',
        unit: 'на день',
        min: 0,
        max: 5000,
        defaultFrom: envInt('DOVEDE_DAILY_CAP', 300),
    },
    {
        key: 'city.enabled',
        group: 'google',
        kind: 'bool',
        label: 'Дорога містом (Київ, Житомир)',
        help: 'Вимкнено — до місця в місті лише кнопка Google Maps, база й Google не питаються.',
        defaultFrom: onByDefault,
        masterOff: offWhen('DOVEDE_CITY_ROUTES', ['off']),
    },
    {
        key: 'city.dailyCap',
        group: 'google',
        kind: 'int',
        label: 'Запитів до Google на день',
        help: 'Люди й навчання разом. 0 — Google не питати зовсім.',
        unit: 'на день',
        min: 0,
        max: exports.GOOGLE_DAILY_MAX,
        warnAbove: exports.GOOGLE_DAILY_WARN,
        warn: GOOGLE_DAILY_WARN_TEXT,
        defaultFrom: envInt('DOVEDE_CITY_DAILY_CAP', 150),
    },
    {
        key: 'city.freshDays',
        group: 'google',
        kind: 'int',
        label: 'Збережена відповідь свіжа, днів',
        help: 'Старішу відповідь сервер не віддає, а питає Google знову.',
        unit: 'днів',
        min: 1,
        max: 365,
        defaultFrom: codeInt(30),
    },
    {
        key: 'city.own',
        group: 'google',
        kind: 'bool',
        label: 'Власні дані Житомира',
        help: 'Пряма поїздка Житомиром — за розкладом із вашого сайту, без бази й Google.',
        defaultFrom: onByDefault,
        masterOff: offWhen('DOVEDE_CITY_OWN', ['0']),
    },
    {
        key: 'drive.dailyCap',
        group: 'google',
        kind: 'int',
        label: 'Час авто: запитів до Google на день',
        help: 'Для попуток — скільки авто в дорозі з заторами. Понад ліміт — сталий час маршруту.',
        unit: 'на день',
        min: 0,
        max: exports.GOOGLE_DAILY_MAX,
        warnAbove: exports.GOOGLE_DAILY_WARN,
        warn: GOOGLE_DAILY_WARN_TEXT,
        defaultFrom: envInt('DRIVE_TIME_DAILY_CAP', 200),
    },
    {
        key: 'google.backoffMin',
        group: 'google',
        kind: 'int',
        label: 'Пауза після відмови Google, хв',
        help: 'Google відповів «квота» (429) чи «немає доступу» (403) — стільки хвилин не питаємо зовсім.',
        unit: 'хв',
        min: 1,
        max: 120,
        defaultFrom: codeInt(10),
    },
    {
        key: 'learn.refresh',
        group: 'learning',
        kind: 'bool',
        label: 'Фонове оновлення застарілих відповідей',
        help: 'Сервер сам перепитує збережені відповіді, що ось-ось застаріють.',
        defaultFrom: onByDefault,
        masterOff: offWhen('DOVEDE_CITY_REFRESH', ['0']),
    },
    {
        key: 'learn.sharePct',
        group: 'learning',
        kind: 'int',
        label: 'Навчанню — частка денного ліміту Google, %',
        help: 'Фонове навчання зупиняється, коли за день витрачено стільки відсотків ліміту; решта — людям.',
        unit: '%',
        min: 0,
        max: 100,
        defaultFrom: codeInt(50),
    },
    {
        key: 'learn.batch',
        group: 'learning',
        kind: 'int',
        label: 'Пар за один крок навчання',
        help: 'Скільки запитів до Google робить фонове навчання за раз (раз на годину).',
        min: 1,
        max: 20,
        defaultFrom: codeInt(3),
    },
    {
        key: 'learn.retryDays',
        group: 'learning',
        kind: 'int',
        label: 'Не перепитувати пару без дороги, днів',
        help: 'Google не знайшов дороги — навчання не чіпає цю пару стільки днів (людина питає як завжди).',
        unit: 'днів',
        min: 1,
        max: 90,
        defaultFrom: codeInt(7),
    },
];
exports.SETTING_GROUP_LABEL = { ai: 'ШІ (Claude)', google: 'Google', learning: 'Фонове навчання' };
const BY_KEY = new Map(exports.DOVEDE_SETTINGS.map((d) => [d.key, d]));
const TTL_MS = 60000;
/** Значення, яке приймає адмінка для цього ключа (без перетворень); null — повернути типове */
function validSettingValue(def, v) {
    if (def.kind === 'bool')
        return typeof v === 'boolean';
    return typeof v === 'number' && Number.isInteger(v) && v >= (def.min ?? 0) && v <= (def.max ?? Number.MAX_SAFE_INTEGER);
}
/** Значення понад м'яку межу: адмінка попереджає, запис іде лише з `confirm: true` */
function confirmNeeded(def, v) {
    return def.kind === 'int' && def.warnAbove != null && typeof v === 'number' && v > def.warnAbove;
}
function settingDef(key) {
    return BY_KEY.get(key);
}
function createDovedeSettings(deps) {
    const { prisma } = deps;
    const env = deps.env ?? process.env;
    const now = deps.now ?? (() => new Date());
    let memo = null;
    async function rows() {
        const at = now().getTime();
        if (memo && at - memo.at >= 0 && at - memo.at < TTL_MS)
            return memo.rows;
        try {
            const list = await prisma.dovedeSetting.findMany();
            memo = { at, rows: new Map(list.map((r) => [r.key, { value: r.value, updatedAt: r.updatedAt }])) };
            return memo.rows;
        }
        catch (e) {
            console.error('❌ dovede settings: не прочитано, беру попередні:', e instanceof Error ? e.message : e);
            return memo?.rows ?? new Map();
        }
    }
    function viewOf(def, stored) {
        const dflt = def.defaultFrom(env);
        const lockedBy = def.masterOff?.(env) ?? null;
        const own = stored && validSettingValue(def, stored.value) ? stored.value : null;
        const value = lockedBy ? false : own ?? dflt.value;
        return {
            key: def.key,
            group: def.group,
            kind: def.kind,
            label: def.label,
            help: def.help,
            ...(def.unit ? { unit: def.unit } : {}),
            ...(def.min != null ? { min: def.min } : {}),
            ...(def.max != null ? { max: def.max } : {}),
            ...(def.warnAbove != null ? { warnAbove: def.warnAbove, warn: def.warn ?? '' } : {}),
            value,
            default: dflt.value,
            defaultSource: dflt.source,
            stored: own,
            updatedAt: own != null && stored?.updatedAt instanceof Date ? stored.updatedAt.toISOString() : null,
            lockedBy,
        };
    }
    async function view(key) {
        const def = BY_KEY.get(key);
        if (!def)
            throw new RangeError(`невідоме налаштування: ${key}`);
        return viewOf(def, (await rows()).get(key));
    }
    /** Число, що діє зараз (адмінка → змінна → код) */
    async function int(key) {
        return (await view(key)).value;
    }
    /** Вмикач, що діє зараз (вимкнено на сервері — завжди false) */
    async function bool(key) {
        return (await view(key)).value;
    }
    async function all() {
        const map = await rows();
        return exports.DOVEDE_SETTINGS.map((d) => viewOf(d, map.get(d.key)));
    }
    /** Задати значення з адмінки; null — повернути типове (рядок лишається з null — історія коли міняли) */
    async function set(key, value) {
        const def = BY_KEY.get(key);
        if (!def)
            throw new RangeError(`невідоме налаштування: ${key}`);
        if (value !== null && !validSettingValue(def, value)) {
            throw new RangeError(def.kind === 'bool' ? `${key}: true або false` : `${key}: ціле від ${def.min} до ${def.max}`);
        }
        const json = value === null ? client_1.Prisma.DbNull : value;
        await prisma.dovedeSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
        memo = null;
        return view(key);
    }
    return { int, bool, view, all, set };
}
