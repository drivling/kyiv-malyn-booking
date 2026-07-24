/** First technical placeholder phone for persons known only by Telegram @username. */
export const TECHNICAL_PHONE_PREFIX = '380010000000';

/** Telegram @username: 5–32 chars, letter first, then letters/digits/underscore. */
const TELEGRAM_USERNAME_RE = /^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/;

export function normalizeTelegramUsername(raw: string): string {
  return raw.trim().replace(/^@/, '');
}

export function formatTelegramUsernameForDisplay(raw: string): string {
  const username = normalizeTelegramUsername(raw);
  return username ? `@${username}` : '';
}

export function isTelegramUsernameContact(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return TELEGRAM_USERNAME_RE.test(value.trim());
}

/** Placeholder phones allocated for username-only contacts (380010000000, 380010000001, …). */
export function isTechnicalPlaceholderPhone(phone: string | null | undefined): boolean {
  if (!phone?.trim()) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('3800100') && digits.length === 12;
}

/** Public t.me profile link (https://t.me/username, without @). */
export function telegramUsernameToProfileUrl(username: string): string {
  const normalized = normalizeTelegramUsername(username);
  return normalized ? `https://t.me/${normalized}` : '';
}

export function formatTelegramContactHtmlLink(value: string): string {
  const username = normalizeTelegramUsername(value);
  const display = `@${username}`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<a href="${telegramUsernameToProfileUrl(username)}">${display}</a>`;
}
