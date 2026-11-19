"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ringStation = ringStation;
exports.ringStationOf = ringStationOf;
exports.ringPlace = ringPlace;
exports.matchRing = matchRing;
const kyivMetro_1 = require("./kyivMetro");
const kyivRingData_1 = require("./kyivRingData");
const normalize_1 = require("./normalize");
const BY_ID = new Map(kyivRingData_1.RING_STATIONS.map((st) => [st.id, st]));
const BY_METRO = new Map(kyivRingData_1.RING_STATIONS.filter((st) => st.metro).map((st) => [st.metro, st]));
function ringStation(id) {
    return BY_ID.get(id);
}
/** Станція кільця для точки Києва: вона сама або та, що біля цієї станції метро */
function ringStationOf(pointId) {
    return BY_ID.get(pointId) ?? BY_METRO.get(pointId);
}
/** Станція як місце словника: «Київ · ст. Куренівка» */
function ringPlace(id) {
    const st = BY_ID.get(id);
    return st ? { id: st.id, city: 'Kyiv', label: `ст. ${st.name}`, stems: [] } : undefined;
}
/** Назви станцій без метро; довші — першими. Сама назва `strict`-станції не рахується — лише її форми з `said` */
const VARIANTS = kyivRingData_1.RING_STATIONS.filter((st) => !st.metro)
    .flatMap((station) => [...(station.strict ? [] : [station.name]), ...station.said].map((n) => ({ station, words: (0, normalize_1.tokenize)(n).map((t) => t.n) })))
    .sort((a, b) => b.words.length - a.words.length);
/** Станція кільця, назва якої починається зі слова `i` («Київ-Волинський» — два слова: дефіс ділить) */
function matchRing(toks, i) {
    let best = null;
    for (const v of VARIANTS) {
        if (best && v.words.length < best.words.length)
            break;
        if (!v.words.every((w, k) => toks[i + k] && (0, kyivMetro_1.wordFits)(w, toks[i + k].n, v.words.length > 1)))
            continue;
        if (v.words.every((w, k) => toks[i + k].n === w))
            return { station: v.station, end: i + v.words.length - 1, marked: false };
        best ?? (best = v);
    }
    return best ? { station: best.station, end: i + best.words.length - 1, marked: false } : null;
}
