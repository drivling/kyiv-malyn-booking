"use strict";
/**
 * Ім'я людини у повідомленнях іншим людям та у зверненнях до адресата.
 *
 * Правило: у всіх каналах (бот, Telethon-помічник, SMS) показуємо лише перше слово
 * імені — без прізвища. Повне ім'я лишається в БД (Person.fullName, ViberListing.senderName)
 * і у сповіщеннях адміну.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.firstNameOnly = firstNameOnly;
exports.displayName = displayName;
/** Лише перше слово імені: «Іван Петренко» → «Іван»; порожнє → null. */
function firstNameOnly(name) {
    const first = (name ?? '').trim().split(/\s+/)[0];
    return first || null;
}
/** Ім'я для показу людині: перше слово, або fallback («Водій», «Пасажир», «Друже»…). */
function displayName(name, fallback) {
    return firstNameOnly(name) ?? fallback;
}
