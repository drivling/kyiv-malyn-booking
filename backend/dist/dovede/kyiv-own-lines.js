"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.along = exports.clock = exports.NEAR_LINE_M = void 0;
exports.normLineNo = normLineNo;
exports.isWeekend = isWeekend;
exports.projectOnDir = projectOnDir;
exports.offsetAt = offsetAt;
exports.kptDirsFor = kptDirsFor;
exports.departures = departures;
exports.kptStepInfo = kptStepInfo;
exports.taxiFor = taxiFor;
exports.withKyivOwnLines = withKyivOwnLines;
/**
 * «Доведе» · дорога Києвом бере свої дані (Docs/dovede-learning-roadmap.md, крок 8б).
 *
 * Відповідь Google (щойно отримана чи збережена) лишається основою: пішки, пересадки, приміські автобуси. Але де
 * поїздка йде лінією «Київпастрансу» (вид і номер збігаються з KYIV_KPT), інтервал о цій годині, хвилини поїздки й
 * «останній о …» беремо зі свого розкладу; де маршруткою з переліку міста — свою частоту відправлення. Як метро й
 * кільцева електричка: свої дані мають перевагу, без згадки джерела. Чисті функції.
 *
 * У розкладі КПТ рейс має лише 2–8 контрольних точок, тож місце посадки ставимо на ламану між ними (за координатами
 * зупинок Google), а хвилини до нього ділимо пропорційно відстані. Немає координат — лише інтервал (без «останній о»,
 * без хвилин поїздки).
 */
const korosten_osm_1 = require("../korosten-osm");
const kyiv_kpt_data_1 = require("./kyiv-kpt-data");
const kyiv_taxi_data_1 = require("./kyiv-taxi-data");
/** Зупинка Google далі від ламаної контрольних точок — це не наша лінія чи не той напрямок */
exports.NEAR_LINE_M = 500;
/** Свої хвилини поїздки беремо, лише коли вони в межах розумного від Google (ламана — не дорога) */
const RIDE_RATIO = [0.4, 2.5];
/** «останній о …» показуємо, коли останній рейс за годину від посадки або вже пішов */
const LAST_SOON_MIN = 60;
/** Перший рейс ще не скоро — кажемо, коли піде */
const FIRST_LATER_MIN = 30;
const LAT_TO_CYR = { A: 'А', B: 'В', C: 'С', D: 'Д', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х' };
/** «30ka» = «30КА» = «30ка»: верхній регістр, латиниця-двійник → кирилиця, без пробілів */
function normLineNo(s) {
    return s
        .trim()
        .toUpperCase()
        .replace(/[A-Z]/g, (c) => LAT_TO_CYR[c] ?? c)
        .replace(/[\s-]+/g, '');
}
const clock = (mins) => {
    const m = ((Math.round(mins) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
exports.clock = clock;
function isWeekend(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return wd === 0 || wd === 6;
}
/** Найближча точка ламаної контрольних точок (плоска проєкція — місто невелике) */
function projectOnDir(dir, p) {
    const pts = dir.points;
    if (pts.length < 2)
        return null;
    const k = Math.cos((p.lat * Math.PI) / 180) * 111195;
    const xy = (lat, lng) => [(lng - p.lng) * k, (lat - p.lat) * 111195];
    let best = null;
    for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = xy(pts[i][1], pts[i][2]);
        const [bx, by] = xy(pts[i + 1][1], pts[i + 1][2]);
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        const off = Math.hypot(ax + t * dx, ay + t * dy);
        if (!best || off < best.off)
            best = { off, seg: i, frac: t };
    }
    return best;
}
/** Хвилини від першої точки до місця на ламаній за рейсами цієї години (найближча година, що є в розкладі) */
function offsetAt(dir, at, hour) {
    const hours = Object.keys(dir.run).map(Number);
    if (!hours.length)
        return 0;
    const h = hours.reduce((a, b) => (Math.abs(b - hour) < Math.abs(a - hour) ? b : a));
    const run = dir.run[String(h)];
    const a = run[at.seg] ?? 0;
    const b = run[at.seg + 1] ?? a;
    return a + (b - a) * at.frac;
}
/** Позиція вздовж ламаної (для порядку посадка → висадка) */
const along = (dir, at) => {
    let m = 0;
    for (let i = 0; i < at.seg; i++)
        m += (0, korosten_osm_1.distanceM)({ lat: dir.points[i][1], lng: dir.points[i][2] }, { lat: dir.points[i + 1][1], lng: dir.points[i + 1][2] });
    const a = dir.points[at.seg];
    const b = dir.points[at.seg + 1];
    return m + at.frac * (0, korosten_osm_1.distanceM)({ lat: a[1], lng: a[2] }, { lat: b[1], lng: b[2] });
};
exports.along = along;
const words = (s) => new Set(s
    .toLowerCase()
    .replace(/[«»"'’ʼ().,]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !/^(вулиця|вул|станція|метро|площа|просп|проспект)$/.test(w)));
/** Напрямок за написом на табличці Google: слова кінцевої збігаються з назвою останньої точки чи кінцем назви маршруту */
function headsignFits(dir, headsign) {
    const want = words(headsign);
    if (!want.size)
        return false;
    const last = dir.points[dir.points.length - 1]?.[0] ?? '';
    const tail = dir.name.split(/\s+[-–—]\s+/).pop() ?? '';
    const have = new Set([...words(last), ...words(tail)]);
    for (const w of want)
        for (const h of have)
            if (h.startsWith(w.slice(0, 5)) || w.startsWith(h.slice(0, 5)))
                return true;
    return false;
}
/** Напрямки лінії КПТ для кроку Google: за координатами зупинок, інакше за написом, інакше всі основні */
function kptDirsFor(step, at, data = kyiv_kpt_data_1.KYIV_KPT) {
    if (step.kind !== 'transit' || !step.line || !step.mode)
        return [];
    const no = normLineNo(step.line);
    const all = data.dirs.filter((d) => d.mode === step.mode && normLineNo(d.no) === no);
    // основні набори точок (`/0`) — повні рейси; короткі рейси до посадки можуть не доїжджати
    const main = all.filter((d) => d.id.endsWith('/0'));
    if (!main.length)
        return [];
    if (at.from && at.to) {
        const fits = main
            .map((dir) => ({ dir, from: projectOnDir(dir, at.from), to: projectOnDir(dir, at.to) }))
            .filter((m) => !!m.from && !!m.to && m.from.off <= exports.NEAR_LINE_M && m.to.off <= exports.NEAR_LINE_M && (0, exports.along)(m.dir, m.from) < (0, exports.along)(m.dir, m.to))
            .sort((a, b) => a.from.off + a.to.off - (b.from.off + b.to.off));
        if (fits.length)
            return [fits[0]];
    }
    const byHeadsign = step.headsign ? main.filter((d) => headsignFits(d, step.headsign)) : [];
    return (byHeadsign.length === 1 ? byHeadsign : main).map((dir) => ({ dir, from: null, to: null }));
}
/** Відправлення напрямку в цей тип дня; ті, що після півночі (понад 1440), — і на початку цієї доби (рейси вчорашнього вечора) */
function departures(dir, weekend) {
    const own = weekend ? dir.we : dir.wd;
    const night = own.filter((d) => d >= 1440).map((d) => d - 1440);
    return night.length ? [...night, ...own].sort((a, b) => a - b) : own;
}
/** Що знає свій розклад про крок лінією КПТ, якщо людина стає на зупинку о `boardAt` (хвилини доби) */
function kptStepInfo(matches, boardAt, date, googleMinutes) {
    if (!matches.length)
        return null;
    const weekend = isWeekend(date);
    const infos = [];
    for (const m of matches) {
        const deps = departures(m.dir, weekend);
        if (!deps.length)
            continue;
        const hour = Math.floor(boardAt / 60);
        const offset = m.from ? offsetAt(m.dir, m.from, hour) : 0;
        const at = deps.map((d) => d + offset);
        const next = at.findIndex((t) => t >= boardAt);
        const info = {};
        if (next >= 0) {
            const gaps = [next > 0 ? at[next] - at[next - 1] : null, next + 1 < at.length ? at[next + 1] - at[next] : null].filter((g) => g != null && g > 0);
            if (gaps.length)
                info.headwayMin = Math.max(1, Math.round(gaps.reduce((n, g) => n + g, 0) / gaps.length));
        }
        if (m.from) {
            // точні години — лише коли знаємо, де посадка на лінії
            if (next < 0) {
                info.gone = true;
                info.lastDeparts = (0, exports.clock)(at[at.length - 1]);
            }
            else if (at[at.length - 1] - boardAt <= LAST_SOON_MIN) {
                info.lastDeparts = (0, exports.clock)(at[at.length - 1]);
            }
            else if (next === 0 && at[0] - boardAt >= FIRST_LATER_MIN) {
                info.firstDeparts = (0, exports.clock)(at[0]);
            }
            if (m.to) {
                const ride = Math.round(offsetAt(m.dir, m.to, hour) - offset);
                if (ride >= 1 && ride >= googleMinutes * RIDE_RATIO[0] && ride <= googleMinutes * RIDE_RATIO[1])
                    info.minutes = ride;
            }
        }
        infos.push(info);
    }
    // нічого свого не сказали (без координат посадки й після останнього рейсу від кінцевої) — крок лишається як дав Google
    const said = infos.filter((i) => Object.keys(i).length > 0);
    if (!said.length)
        return null;
    if (infos.length === 1)
        return said[0];
    // напрямок не визначили — беремо рідший інтервал (чесніше про очікування), без годин і хвилин
    const hw = infos.map((i) => i.headwayMin).filter((h) => h != null);
    return hw.length ? { headwayMin: Math.max(...hw) } : null;
}
/** Маршрутка з переліку міста: та, якої немає серед ліній КПТ цього виду */
function taxiFor(step, kpt = kyiv_kpt_data_1.KYIV_KPT, taxi = kyiv_taxi_data_1.KYIV_TAXI) {
    if (step.kind !== 'transit' || !step.line || (step.mode !== 'SHARE_TAXI' && step.mode !== 'BUS'))
        return null;
    const no = normLineNo(step.line);
    if (step.mode === 'BUS' && kpt.dirs.some((d) => d.mode === 'BUS' && normLineNo(d.no) === no))
        return null;
    return taxi.routes.find((r) => normLineNo(r.no) === no) ?? null;
}
/** Кроки Google → ті самі кроки, де лінії КПТ і маршрутки несуть свої дані (`own: true`); загальний час — з поправкою */
function withKyivOwnLines(input, data = {}) {
    const kpt = data.kpt ?? kyiv_kpt_data_1.KYIV_KPT;
    const taxi = data.taxi ?? kyiv_taxi_data_1.KYIV_TAXI;
    let t = Number(input.time.slice(0, 2)) * 60 + Number(input.time.slice(3, 5));
    let delta = 0;
    const steps = input.steps.map((s) => {
        const boardAt = t;
        let out = s;
        if (s.kind === 'transit') {
            const at = { from: s.fromStop ? input.stopAt?.(s.fromStop) : null, to: s.toStop ? input.stopAt?.(s.toStop) : null };
            const info = kptStepInfo(kptDirsFor(s, at, kpt), boardAt, input.date, s.minutes);
            if (info) {
                const rest = { ...s };
                delete rest.headwayMax;
                out = { ...rest, own: true, ...info };
                if (info.headwayMin == null)
                    delete out.headwayMin;
                if (info.minutes != null)
                    delta += info.minutes - s.minutes;
            }
            else {
                const tx = taxiFor(s, kpt, taxi);
                if (tx?.every) {
                    out = { ...s, own: true, headwayMin: tx.every[0], ...(tx.every[1] !== tx.every[0] ? { headwayMax: tx.every[1] } : {}) };
                    if (tx.every[1] === tx.every[0])
                        delete out.headwayMax;
                }
            }
        }
        t += out.minutes;
        return out;
    });
    return { steps, minutes: Math.max(1, input.minutes + delta) };
}
