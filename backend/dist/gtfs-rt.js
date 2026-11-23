"use strict";
/**
 * GTFS Realtime: позиції машин зі стрічки (FeedMessage → entity → vehicle). Мінімальний читач protobuf без
 * залежностей — лише поля, які нам потрібні (https://gtfs.org/realtime/reference/):
 *   FeedMessage  { 1 header { 1 version, 3 timestamp }, 2 entity[] }
 *   FeedEntity   { 1 id, 4 vehicle }
 *   VehiclePosition { 1 trip { 1 trip_id, 5 route_id, 6 direction_id }, 2 position { 1 lat, 2 lng, 3 bearing, 5 speed },
 *                     5 timestamp, 8 vehicle { 1 id, 2 label, 3 license_plate } }
 * Держномер (license_plate) не читаємо взагалі.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.readMessage = readMessage;
exports.parseVehiclePositions = parseVehiclePositions;
exports.encodeVehiclePositions = encodeVehiclePositions;
function readVarint(b, at) {
    let result = 0;
    let mul = 1;
    let i = at;
    for (;;) {
        if (i >= b.length)
            throw new Error('GTFS-RT: обірваний varint');
        const c = b[i++];
        result += (c & 0x7f) * mul;
        if (c < 0x80)
            return [result, i];
        mul *= 128;
        if (mul > 2 ** 63)
            throw new Error('GTFS-RT: задовгий varint');
    }
}
/** Поля одного повідомлення: номер → список значень (у порядку появи) */
function readMessage(b) {
    const out = new Map();
    let i = 0;
    while (i < b.length) {
        const [key, next] = readVarint(b, i);
        i = next;
        const num = Math.floor(key / 8);
        const wire = key % 8;
        let f;
        if (wire === 0) {
            const [v, n] = readVarint(b, i);
            i = n;
            f = { wire, num: v };
        }
        else if (wire === 1) {
            f = { wire, bytes: b.subarray(i, i + 8) };
            i += 8;
        }
        else if (wire === 2) {
            const [len, n] = readVarint(b, i);
            f = { wire, bytes: b.subarray(n, n + len) };
            i = n + len;
        }
        else if (wire === 5) {
            f = { wire, bytes: b.subarray(i, i + 4) };
            i += 4;
        }
        else {
            throw new Error(`GTFS-RT: невідомий тип поля ${wire}`);
        }
        if (i > b.length)
            throw new Error('GTFS-RT: обірване поле');
        const list = out.get(num);
        if (list)
            list.push(f);
        else
            out.set(num, [f]);
    }
    return out;
}
const first = (m, n) => m.get(n)?.[0];
const text = (m, n) => {
    const f = first(m, n);
    return f?.wire === 2 && f.bytes ? new TextDecoder().decode(f.bytes) : null;
};
const sub = (m, n) => {
    const f = first(m, n);
    return f?.wire === 2 && f.bytes ? readMessage(f.bytes) : null;
};
const float = (m, n) => {
    const f = m ? first(m, n) : undefined;
    if (f?.wire !== 5 || !f.bytes || f.bytes.length < 4)
        return null;
    return new DataView(f.bytes.buffer, f.bytes.byteOffset, 4).getFloat32(0, true);
};
const uint = (m, n) => {
    const f = m ? first(m, n) : undefined;
    return f?.wire === 0 ? (f.num ?? null) : null;
};
/** Тіло стрічки → машини з маршрутом, координатами й часом; решту сутностей (оновлення рейсів, оголошення) пропускаємо */
function parseVehiclePositions(body) {
    const top = readMessage(body);
    const header = sub(top, 1);
    const headerTs = uint(header, 3);
    const vehicles = [];
    for (const e of top.get(2) ?? []) {
        if (e.wire !== 2 || !e.bytes)
            continue;
        const entity = readMessage(e.bytes);
        const vp = sub(entity, 4);
        if (!vp)
            continue;
        const trip = sub(vp, 1);
        const pos = sub(vp, 2);
        const veh = sub(vp, 8);
        const routeId = trip ? text(trip, 5) : null;
        const lat = float(pos, 1);
        const lng = float(pos, 2);
        const ts = uint(vp, 5) ?? headerTs;
        const vehicleId = (veh ? text(veh, 1) : null) ?? text(entity, 1);
        if (!routeId || !vehicleId || lat == null || lng == null || !ts || (lat === 0 && lng === 0))
            continue;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180)
            continue;
        vehicles.push({ routeId, vehicleId, label: (veh ? text(veh, 2) : null) ?? '', lat, lng, bearing: float(pos, 3), speed: float(pos, 5), at: new Date(ts * 1000) });
    }
    return { version: header ? text(header, 1) : null, at: headerTs ? new Date(headerTs * 1000) : null, vehicles };
}
// ── запис (для тестів): той самий формат у байти ─────────────────────────────────────────────────────────────────
function varint(n) {
    const out = [];
    let v = n;
    while (v >= 0x80) {
        out.push((v % 128) | 0x80);
        v = Math.floor(v / 128);
    }
    out.push(v);
    return out;
}
const fieldVarint = (num, v) => [...varint(num * 8), ...varint(v)];
const fieldBytes = (num, bytes) => [...varint(num * 8 + 2), ...varint(bytes.length), ...bytes];
const fieldText = (num, s) => fieldBytes(num, [...new TextEncoder().encode(s)]);
const fieldFloat = (num, v) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    return [...varint(num * 8 + 5), ...b];
};
/** Стрічка з машин — для тестів і локальних перевірок */
function encodeVehiclePositions(feed) {
    const ts = Math.floor(feed.at.getTime() / 1000);
    const out = [...fieldBytes(1, [...fieldText(1, '2.0'), ...fieldVarint(3, ts)])];
    feed.vehicles.forEach((v, i) => {
        const pos = [...fieldFloat(1, v.lat), ...fieldFloat(2, v.lng), ...(v.bearing != null ? fieldFloat(3, v.bearing) : []), ...(v.speed != null ? fieldFloat(5, v.speed) : [])];
        const vp = [...fieldBytes(1, fieldText(5, v.routeId)), ...fieldBytes(2, pos), ...fieldVarint(5, Math.floor(v.at.getTime() / 1000)), ...fieldBytes(8, [...fieldText(1, v.vehicleId), ...fieldText(2, v.label)])];
        out.push(...fieldBytes(2, [...fieldText(1, String(i)), ...fieldBytes(4, vp)]));
    });
    return Uint8Array.from(out);
}
