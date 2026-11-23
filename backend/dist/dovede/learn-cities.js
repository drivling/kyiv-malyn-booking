"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEARN_CITY_LIST = exports.OWN_DATASET_CITY_CODES = exports.isLearnCity = exports.LEARN_CITY_CODES = exports.LEARN_CITIES = void 0;
exports.learnCity = learnCity;
exports.learnCityByPlaceId = learnCityByPlaceId;
exports.byLearnCity = byLearnCity;
exports.LEARN_CITIES = [
    {
        code: 'Kyiv',
        name: 'Київ',
        genitive: 'Києва',
        placeId: 'city.Kyiv',
        arrivalPoints: ['kyiv.akadem', 'kyiv.sviatoshyn', 'kyiv.zhytomyrska', 'kyiv.pas', 'kyiv.borshch'],
        defaultOrigins: ['kyiv.akadem', 'kyiv.pas'],
        maxDepth: 1,
    },
    {
        code: 'Zhytomyr',
        name: 'Житомир',
        genitive: 'Житомира',
        placeId: 'city.Zhytomyr',
        arrivalPoints: ['zhytomyr.avtovokzal'],
        defaultOrigins: ['zhytomyr.avtovokzal'],
        maxDepth: 2,
    },
    {
        // свій датасет лишається головним: сервер питають лише про місця без зупинки (крок 3 плану навчання)
        code: 'Korosten',
        name: 'Коростень',
        genitive: 'Коростеня',
        placeId: 'city.Korosten',
        arrivalPoints: ['korosten.vokzal'],
        defaultOrigins: ['korosten.vokzal'],
        // обхід углиб давав лише наші ж зупинки з відповідей Google (аналіз 2026-11-23)
        maxDepth: 0,
        ownDataset: true,
    },
];
exports.LEARN_CITY_CODES = exports.LEARN_CITIES.map((c) => c.code);
const isLearnCity = (value) => typeof value === 'string' && exports.LEARN_CITY_CODES.includes(value);
exports.isLearnCity = isLearnCity;
function learnCity(code) {
    return exports.LEARN_CITIES.find((c) => c.code === code);
}
/** Міста з власним датасетом міського транспорту */
exports.OWN_DATASET_CITY_CODES = exports.LEARN_CITIES.filter((c) => c.ownDataset).map((c) => c.code);
/** Місто за id місця з розбору сторінки («city.Kyiv»); null — не місто навчання */
function learnCityByPlaceId(placeId) {
    return exports.LEARN_CITIES.find((c) => c.placeId === placeId)?.code ?? null;
}
/** «Kyiv | Zhytomyr» — для текстів помилок */
exports.LEARN_CITY_LIST = exports.LEARN_CITY_CODES.join(' | ');
/** Значення за кодом міста з реєстру: `byLearnCity((c) => c.name)` → `{ Kyiv: 'Київ', Zhytomyr: 'Житомир' }` */
function byLearnCity(pick) {
    return Object.fromEntries(exports.LEARN_CITIES.map((c) => [c.code, pick(c)]));
}
