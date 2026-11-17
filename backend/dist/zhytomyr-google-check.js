"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.minutesAgree = minutesAgree;
exports.checkSpans = checkSpans;
exports.spanVerdict = spanVerdict;
exports.googleRides = googleRides;
exports.directionChecks = directionChecks;
exports.buildCheckReport = buildCheckReport;
/**
 * Звірка маршрутів Житомира із zt.rozklad.in.ua з Google (Docs/dovede-roadmap.md, «Житомир зі свого сайту»;
 * вимога власника: «кожну циферку перевірити через Google»). Чисті функції: що спитати і як оцінити відповідь.
 *
 * Питаємо Google Routes (TRANSIT) дорогу між двома нашими зупинками одного напрямку й дивимось, чи є серед
 * варіантів наша лінія, і чи збігаються хвилини. Спершу — три великі відрізки кожного напрямку (вони й
 * вирішують, чи маршрут «звірено»), далі — кожен перегін між сусідніми зупинками.
 */
const korosten_osm_1 = require("./korosten-osm");
const korosten_google_1 = require("./korosten-google");
/** Допуск на хвилини: ± 2 хв або 30 % — що більше */
function minutesAgree(ours, google) {
    return Math.abs(ours - google) <= Math.max(2, Math.round(ours * 0.3));
}
/** Зупинки з надійною координатою (OSM, Google, підказка) — між ними є що питати */
const solid = (s) => s != null && s.source !== 'interpolated';
function checkSpans(routes, stops) {
    const byId = new Map(stops.map((s) => [s.id, s]));
    const thirds = [];
    const hops = [];
    for (const r of routes.routes) {
        for (const d of r.directions) {
            const chain = d.stops.map((s, i) => ({ ...s, i, at: byId.get(s.id) })).filter((s) => solid(s.at));
            const span = (a, b, level) => ({
                key: `${d.dirId}:${a.id}:${b.id}`,
                number: r.number,
                dirId: d.dirId,
                from: { id: a.id, name: a.name, lat: a.at.lat, lng: a.at.lng },
                to: { id: b.id, name: b.name, lat: b.at.lat, lng: b.at.lng },
                minutes: b.minutes - a.minutes,
                stops: b.i - a.i,
                level,
            });
            if (chain.length >= 4) {
                const cut = [0, Math.round((chain.length - 1) / 3), Math.round(((chain.length - 1) * 2) / 3), chain.length - 1];
                for (let k = 0; k < 3; k++)
                    if (cut[k] < cut[k + 1])
                        thirds.push(span(chain[cut[k]], chain[cut[k + 1]], 'thirds'));
            }
            for (let k = 0; k + 1 < chain.length; k++) {
                // перегін лише між справді сусідніми зупинками: якщо між ними є зупинка без координати — це не перегін
                if (chain[k + 1].i === chain[k].i + 1)
                    hops.push(span(chain[k], chain[k + 1], 'hop'));
            }
        }
    }
    return [...thirds, ...hops];
}
/** Номер із зірочкою на сайті («18*») — різновид того ж маршруту: у Google це «18» */
const sameLine = (ours, google) => (0, korosten_google_1.normalizeLine)(ours.replace(/\*/g, '')) === (0, korosten_google_1.normalizeLine)(google.replace(/\*/g, ''));
function spanVerdict(span, alternatives, checkedAt) {
    const ours = { minutes: span.minutes, stops: span.stops };
    const rides = alternatives.flat();
    const mine = rides.filter((r) => sameLine(span.number, r.line));
    if (!mine.length) {
        const otherLines = [...new Set(rides.map((r) => r.line).filter(Boolean))].sort();
        return { verdict: 'unknown', ours, ...(otherLines.length ? { otherLines } : {}), checkedAt };
    }
    // серед поїздок нашою лінією — та, що найближча за хвилинами (Google може посадити на сусідній зупинці)
    const best = [...mine].sort((a, b) => Math.abs(a.minutes - span.minutes) - Math.abs(b.minutes - span.minutes))[0];
    const off = (lat, lng, p) => (lat == null || lng == null ? null : Math.round((0, korosten_osm_1.distanceM)({ lat, lng }, p)));
    const google = { minutes: best.minutes, stops: best.stops, fromStop: best.fromStop, toStop: best.toStop, fromOffM: off(best.fromLat, best.fromLng, span.from), toOffM: off(best.toLat, best.toLng, span.to) };
    // Google посадив чи висадив далі ніж за 250 м від нашої зупинки — це інший відрізок, хвилини не порівнюємо
    const sameEnds = (google.fromOffM ?? 0) <= 250 && (google.toOffM ?? 0) <= 250;
    const agree = sameEnds && minutesAgree(span.minutes, best.minutes) && (best.stops == null || Math.abs(best.stops - span.stops) <= Math.max(1, Math.round(span.stops * 0.2)));
    return { verdict: agree ? 'match' : 'differs', ours, google, checkedAt };
}
/** Кроки транспорту з відповіді Google Routes (усі альтернативи) */
function googleRides(body) {
    const routes = body?.routes ?? [];
    return routes.map((r) => (r.legs ?? [])
        .flatMap((l) => l.steps ?? [])
        .filter((s) => s.transitDetails)
        .map((s) => {
        const t = s.transitDetails;
        const dep = t.stopDetails?.departureStop;
        const arr = t.stopDetails?.arrivalStop;
        return {
            line: (t.transitLine?.nameShort ?? t.transitLine?.name ?? '').trim(),
            minutes: Math.max(1, Math.round((Number(String(s.staticDuration ?? '').replace(/s$/, '')) || 0) / 60)),
            stops: t.stopCount ?? null,
            fromStop: dep?.name?.trim() ?? '',
            toStop: arr?.name?.trim() ?? '',
            fromLat: dep?.location?.latLng?.latitude ?? null,
            fromLng: dep?.location?.latLng?.longitude ?? null,
            toLat: arr?.location?.latLng?.latitude ?? null,
            toLng: arr?.location?.latLng?.longitude ?? null,
        };
    }));
}
/**
 * Вердикт напрямку — за трьома великими відрізками: усі збігаються → checked; хоч один розходиться → differs;
 * Google не знає жодного → unknown; ще не питали — pending.
 */
function directionChecks(routes, spans, verdicts) {
    const out = [];
    for (const r of routes.routes) {
        for (const d of r.directions) {
            const count = (level) => {
                const c = { match: 0, differs: 0, unknown: 0, pending: 0 };
                for (const s of spans)
                    if (s.dirId === d.dirId && s.level === level)
                        c[verdicts[s.key]?.verdict ?? 'pending']++;
                return c;
            };
            const thirds = count('thirds');
            const total = thirds.match + thirds.differs + thirds.unknown + thirds.pending;
            const status = !total || thirds.pending === total ? 'pending' : thirds.differs ? 'differs' : thirds.match && !thirds.unknown && !thirds.pending ? 'checked' : thirds.match ? 'differs' : thirds.pending ? 'pending' : 'unknown';
            out.push({ dirId: d.dirId, number: r.number, name: d.name, status, thirds, hops: count('hop') });
        }
    }
    return out;
}
const STATUS_UK = { checked: 'збігається', differs: 'розходиться', unknown: 'Google не знає', pending: 'ще не звірено' };
function buildCheckReport(routes, stops, spans, verdicts) {
    const dirs = directionChecks(routes, spans, verdicts);
    const n = (s) => dirs.filter((d) => d.status === s).length;
    const src = (s) => stops.stops.filter((x) => x.source === s).length;
    const lines = [
        '# Житомир: маршрути із zt.rozklad.in.ua проти Google',
        '',
        'Файл згенеровано (`npm run zhytomyr:snapshot` у `backend/`) — руками не редагувати.',
        '',
        `Знімок сайту: ${routes.fetchedAt}. Маршрутів — ${routes.routes.length}, напрямків — ${dirs.length}.`,
        '',
        `Зупинки: з OpenStreetMap — ${src('osm')}, з Google — ${src('google')}, підказки — ${src('hint')}, приблизно між сусідами — ${src('interpolated')}, без координат — ${stops.missing.length}.`,
        '',
        `Напрямки: збігається — ${n('checked')}, розходиться — ${n('differs')}, Google не знає — ${n('unknown')}, ще не звірено — ${n('pending')}.`,
        '',
        'Вердикт напрямку — за трьома великими відрізками (третини маршруту): допуск ± 2 хв або 30 %, зупинки посадки й висадки Google — у межах 250 м від наших. Перегони — кожна пара сусідніх зупинок.',
        '',
        '| Маршрут | Напрямок | Вердикт | Третини: збіг / розх. / не знає / чекає | Перегони: збіг / розх. / не знає / чекає |',
        '|---|---|---|---|---|',
        ...dirs.map((d) => `| ${d.number} | ${d.name} | ${STATUS_UK[d.status]} | ${d.thirds.match} / ${d.thirds.differs} / ${d.thirds.unknown} / ${d.thirds.pending} | ${d.hops.match} / ${d.hops.differs} / ${d.hops.unknown} / ${d.hops.pending} |`),
        '',
        '## Де цифри розходяться (великі відрізки)',
        '',
    ];
    const diffs = spans.filter((s) => s.level === 'thirds' && verdicts[s.key]?.verdict === 'differs');
    if (!diffs.length)
        lines.push('Немає.');
    for (const s of diffs) {
        const g = verdicts[s.key].google;
        lines.push(`- №${s.number}, «${s.from.name}» → «${s.to.name}»: наше — ${s.minutes} хв, ${s.stops} зуп.; Google — ${g.minutes} хв, ${g.stops ?? '?'} зуп. («${g.fromStop}» → «${g.toStop}», від наших зупинок ${g.fromOffM ?? '?'} м і ${g.toOffM ?? '?'} м)`);
    }
    lines.push('', '## Де Google нашої лінії не пропонує (великі відрізки)', '');
    const unknown = spans.filter((s) => s.level === 'thirds' && verdicts[s.key]?.verdict === 'unknown');
    if (!unknown.length)
        lines.push('Немає.');
    for (const s of unknown)
        lines.push(`- №${s.number}, «${s.from.name}» → «${s.to.name}»: Google пропонує ${verdicts[s.key].otherLines?.join(', ') || 'лише пішки'}`);
    return `${lines.join('\n')}\n`;
}
