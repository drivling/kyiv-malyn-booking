"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.phoneLabel = exports.zubastykPhones = exports.ZUBASTYK_PHONES_MAX = exports.ZUBASTYK_PHONES_KEY = exports.ZUBASTYK_PHONES_DEFAULT = void 0;
exports.phoneDigits = phoneDigits;
exports.parseZubastykPhones = parseZubastykPhones;
exports.createZubastykPhonesStore = createZubastykPhonesStore;
exports.resetZubastykPhonesForTests = resetZubastykPhonesForTests;
/** Типові телефони; останній — резервний */
exports.ZUBASTYK_PHONES_DEFAULT = [
    { digits: '380931920008', label: '093 192 00 08' },
    { digits: '380961420008', label: '096 142 00 08' },
    { digits: '380661620008', label: '066 162 00 08' },
    { digits: '380931701835', label: '093 170 18 35', note: 'резервний' },
];
exports.ZUBASTYK_PHONES_KEY = 'zubastyk.phones';
exports.ZUBASTYK_PHONES_MAX = 6;
let current = exports.ZUBASTYK_PHONES_DEFAULT;
/** Телефони, що діють зараз (типові або з адмінки) */
const zubastykPhones = () => current;
exports.zubastykPhones = zubastykPhones;
/** Номер як його пишуть люди: «093 192 00 08», «+380 93 192-00-08» → 380931920008; null — не номер України */
function phoneDigits(raw) {
    const d = String(raw).replace(/\D/g, '');
    if (/^0\d{9}$/.test(d))
        return `38${d}`;
    if (/^380\d{9}$/.test(d))
        return d;
    return null;
}
/** 380931920008 → «093 192 00 08» */
const phoneLabel = (digits) => {
    const l = `0${digits.slice(3)}`;
    return `${l.slice(0, 3)} ${l.slice(3, 6)} ${l.slice(6, 8)} ${l.slice(8, 10)}`;
};
exports.phoneLabel = phoneLabel;
/**
 * Список з адмінки → телефони (номер і примітка; підпис будуємо самі). Кидає RangeError з поясненням.
 * Приймає `[{ phone | digits, note? }]`.
 */
function parseZubastykPhones(v) {
    if (!Array.isArray(v) || !v.length || v.length > exports.ZUBASTYK_PHONES_MAX)
        throw new RangeError(`від 1 до ${exports.ZUBASTYK_PHONES_MAX} номерів`);
    const out = [];
    for (const [i, item] of v.entries()) {
        const o = (item ?? {});
        const raw = typeof o.phone === 'string' ? o.phone : typeof o.digits === 'string' ? o.digits : '';
        const digits = phoneDigits(raw);
        if (!digits)
            throw new RangeError(`номер ${i + 1}: потрібен номер України, як 093 192 00 08`);
        if (out.some((p) => p.digits === digits))
            throw new RangeError(`номер ${(0, exports.phoneLabel)(digits)} — двічі`);
        const note = typeof o.note === 'string' ? o.note.replace(/\s+/g, ' ').trim() : '';
        if (note.length > 30)
            throw new RangeError(`номер ${i + 1}: примітка до 30 знаків`);
        out.push({ digits, label: (0, exports.phoneLabel)(digits), ...(note ? { note } : {}) });
    }
    return out;
}
const isPhoneList = (v) => {
    try {
        parseZubastykPhones(v);
        return true;
    }
    catch {
        return false;
    }
};
function createZubastykPhonesStore(prisma) {
    let updatedAt = null;
    let changed = false;
    /** Прочитати з бази в памʼять; помилка — лишаються попередні */
    async function refresh() {
        try {
            const row = await prisma.siteSetting.findUnique({ where: { key: exports.ZUBASTYK_PHONES_KEY } });
            const stored = row?.value?.phones;
            if (row && isPhoneList(stored)) {
                current = parseZubastykPhones(stored);
                changed = true;
                updatedAt = row.updatedAt;
            }
            else {
                current = exports.ZUBASTYK_PHONES_DEFAULT;
                changed = false;
                updatedAt = row?.updatedAt ?? null;
            }
        }
        catch (e) {
            console.error('❌ zubastyk-phones: не прочитано, лишаю попередні:', e instanceof Error ? e.message : e);
        }
    }
    function view() {
        return { phones: current, changed, updatedAt: updatedAt?.toISOString() ?? null, defaults: exports.ZUBASTYK_PHONES_DEFAULT };
    }
    /** Задати (null — повернути типові з коду); кидає RangeError */
    async function set(list) {
        const phones = list === null ? null : parseZubastykPhones(list);
        const value = (phones ? { phones } : {});
        await prisma.siteSetting.upsert({ where: { key: exports.ZUBASTYK_PHONES_KEY }, create: { key: exports.ZUBASTYK_PHONES_KEY, value }, update: { value } });
        await refresh();
        return view();
    }
    /** Оновлювати памʼять раз на `minutes` хвилин (0 — ні); повертає зупинку */
    function startSync(minutes = 5) {
        void refresh();
        if (!(minutes > 0))
            return () => undefined;
        const t = setInterval(() => void refresh(), minutes * 60000);
        t.unref();
        return () => clearInterval(t);
    }
    return { refresh, view, set, startSync };
}
/** Для тестів: повернути типові в памʼять */
function resetZubastykPhonesForTests() {
    current = exports.ZUBASTYK_PHONES_DEFAULT;
}
