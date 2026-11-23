"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sameLineNo = void 0;
exports.ownTimetable = ownTimetable;
const korostenPlaces_1 = require("./korostenPlaces");
/** «2-Б», «2б», «2b» — той самий номер (як `sameNo` у nlu/routes.ts сторінки) */
const sameLineNo = (s) => s.toLowerCase().replace(/[-\s]/g, '').replace(/b/g, 'б');
exports.sameLineNo = sameLineNo;
function runsOn(serviceId, dayType) {
    const s = serviceId ?? 'everyday';
    if (s === 'everyday')
        return true;
    return dayType === 'weekday' ? s === 'weekdays' : s === 'weekends';
}
function ownTimetable(dataset) {
    const routeOf = new Map();
    for (const r of dataset.routes) {
        if (r.unreliable)
            continue;
        routeOf.set((0, exports.sameLineNo)(r.id), r.id);
        if (r.shortName)
            routeOf.set((0, exports.sameLineNo)(r.shortName), r.id);
    }
    // година відправлення кожного рейсу за маршрутом і типом дня
    const hoursOf = new Map();
    const all = new Map();
    for (const t of dataset.trips) {
        const h = Number(String(t.departureTime ?? '').split(':')[0]);
        if (!Number.isInteger(h))
            continue;
        for (const day of ['weekday', 'saturday', 'sunday']) {
            if (!runsOn(t.serviceId, day))
                continue;
            const k = `${t.routeId}|${day}`;
            if (!hoursOf.has(k))
                hoursOf.set(k, new Set());
            hoursOf.get(k).add(h);
            all.set(day, [...(all.get(day) ?? []), h]);
        }
    }
    const stops = dataset.stops.map((s) => ({ id: s.id, name: s.name }));
    return {
        lineRuns(line, dayType, hour) {
            const id = routeOf.get((0, exports.sameLineNo)(line));
            if (!id)
                return null;
            const hs = hoursOf.get(`${id}|${dayType}`);
            return Boolean(hs && (hs.has(hour) || hs.has(hour - 1) || hs.has(hour + 1)));
        },
        hours(dayType) {
            const hs = all.get(dayType);
            return hs?.length ? { first: Math.min(...hs), last: Math.max(...hs) } : null;
        },
        isOwnStop(name) {
            return (0, korostenPlaces_1.korostenStopForName)(stops, name, 'contains') != null;
        },
    };
}
