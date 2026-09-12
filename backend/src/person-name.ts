/**
 * Ім'я людини у повідомленнях іншим людям та у зверненнях до адресата.
 *
 * Правило: у всіх каналах (бот, Telethon-помічник, SMS) показуємо лише перше слово
 * імені — без прізвища. Повне ім'я лишається в БД (Person.fullName, ViberListing.senderName)
 * і у сповіщеннях адміну.
 */

/** Лише перше слово імені: «Іван Петренко» → «Іван»; порожнє → null. */
export function firstNameOnly(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first || null;
}

/** Ім'я для показу людині: перше слово, або fallback («Водій», «Пасажир», «Друже»…). */
export function displayName(name: string | null | undefined, fallback: string): string {
  return firstNameOnly(name) ?? fallback;
}
