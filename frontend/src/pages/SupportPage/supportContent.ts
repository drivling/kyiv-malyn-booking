/** Константи й каталог тем help-center (mobile-first IA) */
export const SUPPORT_PATH = '/support';

export type SupportTopicId =
  | 'start'
  | 'travel'
  | 'bot'
  | 'site'
  | 'referral'
  | 'faq'
  | 'contact';

export type SupportTopic = {
  id: SupportTopicId;
  title: string;
  blurb: string;
  /** Короткий заголовок для чипів на мобілці */
  shortTitle: string;
};

export const SUPPORT_TOPICS: SupportTopic[] = [
  {
    id: 'start',
    title: 'З чого почати',
    shortTitle: 'Старт',
    blurb: 'Номер у боті, меню, перші кроки',
  },
  {
    id: 'travel',
    title: 'Як доїхати до Малина',
    shortTitle: 'Доїхати',
    blurb: 'Попутка, маршрутка, Київ / Житомир / Коростень',
  },
  {
    id: 'bot',
    title: 'Telegram-бот',
    shortTitle: 'Бот',
    blurb: 'Команди, попутки, бронювання, inline',
  },
  {
    id: 'site',
    title: 'Сайт',
    shortTitle: 'Сайт',
    blurb: 'Попутки, маршрутки, транспорт Малина',
  },
  {
    id: 'referral',
    title: 'Приведи друга',
    shortTitle: 'Акція',
    blurb: 'Бонуси, фото, виплати',
  },
  {
    id: 'faq',
    title: 'Часті питання',
    shortTitle: 'FAQ',
    blurb: 'Бот мовчить, немає кнопок, бонуси',
  },
  {
    id: 'contact',
    title: 'Контакти',
    shortTitle: 'Контакти',
    blurb: 'Телефон, email, Telegram',
  },
];

/** Підрозділи довгої статті про бота (TOC) */
export const BOT_TOC: Array<{ id: string; label: string }> = [
  { id: 'bot-menu', label: 'Меню й команди' },
  { id: 'bot-rides', label: 'Попутки' },
  { id: 'bot-inline', label: 'Inline у чатах' },
  { id: 'bot-book', label: 'Бронювання' },
  { id: 'bot-referral', label: 'Приведи друга' },
  { id: 'bot-confirm', label: 'Фото поїздки' },
];

/** Старі якорі односторінкової версії → нова стаття */
export const LEGACY_HASH_TO_TOPIC: Record<string, SupportTopicId> = {
  start: 'start',
  travel: 'travel',
  bot: 'bot',
  'bot-menu': 'bot',
  'bot-rides': 'bot',
  'bot-inline': 'bot',
  'bot-book': 'bot',
  'bot-referral': 'referral',
  'bot-confirm': 'bot',
  site: 'site',
  faq: 'faq',
  contact: 'contact',
};

export function supportTopicPath(id: SupportTopicId): string {
  return `${SUPPORT_PATH}/${id}`;
}

export function isSupportTopicId(value: string | undefined): value is SupportTopicId {
  return SUPPORT_TOPICS.some((t) => t.id === value);
}

export const TELEGRAM_BOT_USERNAME =
  import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'malin_kiev_ua_bot';

export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;
export const TELEGRAM_BOT_START_URL = `${TELEGRAM_BOT_URL}?start=`;

export const BOT_COMMANDS: Array<{ cmd: string; desc: string }> = [
  { cmd: '/start', desc: 'Головне меню та реєстрація номера' },
  { cmd: '/help', desc: 'Повна довідка в чаті з ботом' },
  { cmd: '/book', desc: 'Нове бронювання маршрутки' },
  { cmd: '/mybookings', desc: 'Мої бронювання' },
  { cmd: '/allrides', desc: 'Усі активні попутки + фільтри + швидкі дії' },
  { cmd: '/adddriverride', desc: 'Додати поїздку як водій' },
  { cmd: '/addpassengerride', desc: 'Шукаю поїздку як пасажир' },
  { cmd: '/mydriverrides', desc: 'Мої оголошення водія (і поділитися в чат)' },
  { cmd: '/mypassengerrides', desc: 'Мої заявки пасажира' },
  { cmd: '/cancel', desc: 'Скасувати бронювання або оголошення попуток' },
  { cmd: '/invite', desc: 'Акція «Приведи друга» — посилання і запрошення' },
  { cmd: '/confirmride', desc: 'Підтвердити поїздку двома фото (для бонусів)' },
];

export const INLINE_QUERIES: Array<{ q: string; desc: string }> = [
  { q: '(порожньо)', desc: 'Меню: друг · попутки сьогодні · допомога · бронювання' },
  { q: 'ref_share', desc: 'Персональне посилання «Приведи друга»' },
  { q: 'rides_today', desc: 'Оголошення на сьогодні (до 20 карток)' },
  { q: 'rides завтра / rides київ', desc: 'Попутки з підказкою дати або маршруту' },
  { q: 'help', desc: 'Короткий список команд' },
  { q: 'book', desc: 'Посилання на бронювання в боті' },
  { q: 'share_listing_123', desc: 'Поділитися своїм оголошенням #123' },
];

export const TRAVEL_FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Як доїхати до Малина з Києва?',
    a: 'Попутка або маршрутка: відкрийте напрямок Київ — Малин на malin.kiev.ua або пошук з містами Київ → Малин. У Києві орієнтуйтеся на ст. м. Академмістечко / Святошин залежно від рейсу.',
  },
  {
    q: 'Де шукати попутку Малин — Київ?',
    a: 'На сторінці міжміських або в Telegram-боті @malin_kiev_ua_bot. Фільтр «Попутки» показує лише оголошення водіїв і пасажирів.',
  },
  {
    q: 'Чи є маршрутки на Житомир і Коростень?',
    a: 'Так. Усі підтримувані міжміські маршрути проходять через Малин: Київ, Житомир, Коростень — в обидва боки.',
  },
  {
    q: 'Чим ви кращі за новини з «розкладом»?',
    a: 'Новинні статті швидко застарівають. У нас живий пошук: актуальні оголошення й рейси на обрану дату з бронюванням.',
  },
];

export const FAQ_PLAIN: Array<{ q: string; aText: string }> = [
  {
    q: 'Бот не відповідає / «заблоковано»',
    aText:
      'Відкрийте @malin_kiev_ua_bot, натисніть «Розблокувати» (якщо бот у чорному списку), потім /start. Без чату з ботом не приходять підтвердження бронювань і повідомлення про бонуси.',
  },
  {
    q: 'У /allrides немає кнопок «швидких дій»',
    aText:
      'Потрібен номер у боті (кнопка «Поділитися контактом»). Кнопки з’являються лише при точному співпадінні маршруту, дати й часу (±45 хв) з вашим оголошенням водія або пасажира.',
  },
  {
    q: 'Inline (@бот) нічого не показує',
    aText:
      'Наберіть @malin_kiev_ua_bot у полі повідомлення будь-якого чату. Має з’явитися меню або картки. Для персонального посилання спочатку зробіть /start у боті.',
  },
  {
    q: 'Бонус «Приведи друга» не нарахувався',
    aText:
      'Потрібні два фото через /confirmride і схвалення модератором. Само-запрошення з одного Telegram на два номери блокується. Умови акції — на сторінці Про нас.',
  },
  {
    q: 'Як скасувати оголошення або бронювання?',
    aText: 'Команда /cancel у боті — список ваших бронювань і попуток з кнопками скасування.',
  },
  {
    q: 'Чи можна користуватися лише сайтом?',
    aText:
      'Так: міжміський пошук попуток і маршруток на /mizhgorodski, міський транспорт на /transport. Підтвердження бронювання, нагадування і бонуси акції зручніше отримувати в Telegram-боті.',
  },
];
