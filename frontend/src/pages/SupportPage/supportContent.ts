/** Константи сторінки підтримки (публічний help-center) */
export const SUPPORT_PATH = '/support';

export const SUPPORT_SECTION = {
  START: 'start',
  BOT: 'bot',
  BOT_MENU: 'bot-menu',
  BOT_RIDES: 'bot-rides',
  BOT_INLINE: 'bot-inline',
  BOT_BOOK: 'bot-book',
  BOT_REFERRAL: 'bot-referral',
  BOT_CONFIRM: 'bot-confirm',
  SITE: 'site',
  FAQ: 'faq',
  CONTACT: 'contact',
} as const;

export const TELEGRAM_BOT_USERNAME =
  import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'malin_kiev_ua_bot';

export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
export const TELEGRAM_BOT_START_URL = `${TELEGRAM_BOT_URL}?start=`;
