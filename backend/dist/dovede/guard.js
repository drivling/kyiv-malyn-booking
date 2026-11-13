"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DOVEDE_DAILY_CAP = void 0;
exports.isDovedeEnabled = isDovedeEnabled;
exports.dovedeDailyCap = dovedeDailyCap;
exports.kyivDayStart = kyivDayStart;
exports.aiCallsToday = aiCallsToday;
const arrival_reports_1 = require("../arrival-reports");
exports.DEFAULT_DOVEDE_DAILY_CAP = 300;
function isDovedeEnabled(env = process.env) {
    const v = (env.DOVEDE_ENABLED ?? '').trim().toLowerCase();
    return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}
function dovedeDailyCap(env = process.env) {
    const raw = (env.DOVEDE_DAILY_CAP ?? '').trim();
    if (!raw)
        return exports.DEFAULT_DOVEDE_DAILY_CAP;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : exports.DEFAULT_DOVEDE_DAILY_CAP;
}
/** Початок поточної київської доби як момент часу */
function kyivDayStart(now) {
    const { mins } = (0, arrival_reports_1.kyivClock)(now);
    const d = new Date(now.getTime() - mins * 60000);
    d.setUTCSeconds(0, 0);
    return d;
}
/** Скільки разів сьогодні (за Києвом) уже кликали Claude */
async function aiCallsToday(prisma, now) {
    return prisma.dovedeQuery.count({ where: { aiCalled: true, createdAt: { gte: kyivDayStart(now) } } });
}
