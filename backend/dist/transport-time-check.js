"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.differs = differs;
exports.timeCandidates = timeCandidates;
/** «Різне»: більше за 2 хв і за 20 % від меншого */
function differs(a, b) {
    return Math.abs(a - b) > Math.max(2, 0.2 * Math.min(a, b));
}
const sameNo = (s) => s.toLowerCase().replace(/[-\s]/g, '').replace(/b/g, 'б');
const round1 = (v) => Math.round(v * 10) / 10;
/** Відрізки напрямку від зупинки `from` до `to` за назвами (поспіль); null — пари в цьому напрямку нема */
function stretch(spans, from, to) {
    const i = spans.findIndex((s) => s.fromName === from);
    if (i < 0)
        return null;
    for (let j = i; j < spans.length; j++)
        if (spans[j].toName === to)
            return spans.slice(i, j + 1);
    return null;
}
function timeCandidates(report, rows) {
    const out = [];
    for (const row of rows) {
        // Google мусив поїхати нашою лінією — інакше його хвилини не про наш маршрут
        const nos = row.routeNo ? [row.routeNo] : row.routes;
        const googleMin = row.routeNo && row.googleMin !== undefined ? row.googleMin : null;
        for (const route of report.routes) {
            if (!nos.some((n) => sameNo(n) === sameNo(route.routeNo)))
                continue;
            for (const d of route.directions) {
                const part = stretch(d.spans, row.from, row.to);
                if (!part)
                    continue;
                const ourMin = round1(part.reduce((n, s) => n + s.ourSec, 0) / 60);
                const gps = part.every((s) => s.gpsSec !== null) ? round1(part.reduce((n, s) => n + (s.gpsSec ?? 0), 0) / 60) : null;
                const weak = part.some((s) => s.confidence !== 'ok');
                let verdict;
                if (gps === null) {
                    if (googleMin === null || !differs(googleMin, ourMin))
                        continue;
                    verdict = 'google_only';
                }
                else if (!differs(gps, ourMin))
                    verdict = 'ok';
                else
                    verdict = googleMin !== null && !differs(googleMin, gps) ? 'recalc' : 'gps';
                out.push({ routeNo: route.routeNo, direction: d.direction, from: row.from, to: row.to, ourMin, gpsMin: gps, googleMin, verdict, weak });
            }
        }
    }
    const rank = { recalc: 0, gps: 1, google_only: 2, ok: 3 };
    const gap = (c) => Math.abs((c.gpsMin ?? c.googleMin ?? c.ourMin) - c.ourMin);
    return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || gap(b) - gap(a) || a.routeNo.localeCompare(b.routeNo, 'uk', { numeric: true }));
}
