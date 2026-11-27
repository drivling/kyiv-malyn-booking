"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LINE_KINDS = void 0;
exports.lineKind = lineKind;
exports.kyivLinesReport = kyivLinesReport;
exports.kptLineRunsAt = kptLineRunsAt;
const kyiv_kpt_data_1 = require("./kyiv-kpt-data");
const kyiv_taxi_data_1 = require("./kyiv-taxi-data");
const kyiv_own_lines_1 = require("./kyiv-own-lines");
exports.LINE_KINDS = ['kpt', 'taxi', 'metro', 'ring', 'rail', 'funicular', 'none'];
const isRail = (mode) => /RAIL|TRAIN/.test(mode) && !/LIGHT_RAIL/.test(mode);
/** Що це за лінія для нас: своя (КПТ, маршрутка з переліку, метро, кільцева, фунікулер) чи немає в наших даних */
function lineKind(step, kpt = kyiv_kpt_data_1.KYIV_KPT, taxi = kyiv_taxi_data_1.KYIV_TAXI) {
    const mode = String(step.mode ?? '').toUpperCase();
    const line = String(step.line ?? '');
    if (mode === 'SUBWAY')
        return { kind: 'metro' };
    if (mode === 'FUNICULAR' || /фунікулер/i.test(line))
        return { kind: 'funicular' };
    if (isRail(mode))
        return /city express/i.test(line) || /^E[12]\b/.test(String(step.headsign ?? '')) ? { kind: 'ring' } : { kind: 'rail' };
    const no = (0, kyiv_own_lines_1.normLineNo)(line);
    const dir = kpt.dirs.find((d) => d.mode === mode && (0, kyiv_own_lines_1.normLineNo)(d.no) === no);
    if (dir)
        return { kind: 'kpt', name: dir.name };
    const tx = (0, kyiv_own_lines_1.taxiFor)({ kind: 'transit', minutes: 0, mode, line }, kpt, taxi);
    if (tx)
        return { kind: 'taxi', name: tx.name };
    return { kind: 'none' };
}
/** Звіт по збережених відповідях Google (не в архіві) */
function kyivLinesReport(rows, kpt = kyiv_kpt_data_1.KYIV_KPT, taxi = kyiv_taxi_data_1.KYIV_TAXI) {
    const byLine = new Map();
    const roads = new Set();
    for (const r of rows) {
        const pair = `${r.fromKey}|${r.toKey}`;
        roads.add(pair);
        const steps = Array.isArray(r.steps) ? r.steps : [];
        for (const s of steps) {
            if (s?.kind !== 'transit' || !s.line)
                continue;
            const mode = String(s.mode ?? 'BUS').toUpperCase();
            const key = `${mode}|${s.line.trim()}`;
            let u = byLine.get(key);
            if (!u) {
                const k = lineKind(s, kpt, taxi);
                u = { mode, line: s.line.trim(), kind: k.kind, rides: 0, roads: 0, pairs: new Set(), ...(k.name ? { name: k.name } : {}) };
                byLine.set(key, u);
            }
            u.rides++;
            u.pairs.add(pair);
        }
    }
    const byKind = Object.fromEntries(exports.LINE_KINDS.map((k) => [k, { lines: 0, rides: 0 }]));
    const lines = [];
    for (const { pairs, ...u } of byLine.values()) {
        u.roads = pairs.size;
        byKind[u.kind].lines++;
        byKind[u.kind].rides += u.rides;
        lines.push(u);
    }
    lines.sort((a, b) => b.rides - a.rides || a.line.localeCompare(b.line, 'uk', { numeric: true }));
    return { roads: roads.size, lines, byKind };
}
/**
 * Чи ходить лінія КПТ (вид + номер) цього типу дня близько до цієї години: відправлення від першої точки будь-якого
 * напрямку за 90 хв до початку години … до її кінця (рейс, що вирушив раніше, ще в дорозі). null — такої лінії КПТ нема
 */
function kptLineRunsAt(mode, line, dayType, hour, kpt = kyiv_kpt_data_1.KYIV_KPT) {
    const no = (0, kyiv_own_lines_1.normLineNo)(line);
    const dirs = kpt.dirs.filter((d) => d.mode === String(mode).toUpperCase() && (0, kyiv_own_lines_1.normLineNo)(d.no) === no);
    if (!dirs.length)
        return null;
    const from = hour * 60 - 90;
    const to = hour * 60 + 59;
    const weekend = dayType === 'saturday' || dayType === 'sunday';
    return dirs.some((d) => (weekend ? d.we : d.wd).some((t) => (t >= from && t <= to) || (t >= 1440 && t - 1440 >= from && t - 1440 <= to)));
}
