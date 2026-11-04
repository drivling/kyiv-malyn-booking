/**
 * Тарифи, що згадуються в текстах сайту (FAQ, статті, лендинги). Таблиці розкладу беруть ціну з бази
 * (Schedule.priceUah), тож тут лише слова навколо неї.
 *
 * Маршрутка Малин ↔ Київ: з 4 листопада 2026 — 310 грн за місце в обидва боки (було 280; туди й назад 620
 * замість 560). Джерело: перевізник, ІнфоМалин 03.11.2026.
 * Міняючи: backend/src/schedule-price.ts (дефолт), міграція Schedule.priceUah, знімок
 * frontend/scripts/data/corridor-schedules.snapshot.json, цей файл.
 */
export const KYIV_MALYN_FARE_UAH = 310;
export const KYIV_MALYN_FARE_PREVIOUS_UAH = 280;
/** Дата набуття чинності, для тексту «з 4 листопада 2026». */
export const KYIV_MALYN_FARE_SINCE = '4 листопада 2026';
/** Туди й назад. */
export const KYIV_MALYN_FARE_ROUND_TRIP_UAH = KYIV_MALYN_FARE_UAH * 2;
