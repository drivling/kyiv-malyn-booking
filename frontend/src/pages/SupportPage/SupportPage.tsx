import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SiteContactBlock } from '@/components/SiteContactBlock/SiteContactBlock';
import {
  COMPANY_LEGAL_PATH,
} from '@/legal/companyLegal';
import {
  PRIVACY_POLICY_PAGE_LINK,
  REFERRAL_PROMO_PAGE_LINK,
  SITE_PUBLIC_DOMAIN,
  TERMS_PAGE_LINK,
} from '@/legal/sitePublic';
import {
  SUPPORT_SECTION,
  TELEGRAM_BOT_START_URL,
  TELEGRAM_BOT_URL,
  TELEGRAM_BOT_USERNAME,
} from './supportContent';
import './SupportPage.css';

type Topic = {
  id: string;
  title: string;
  blurb: string;
  href: string;
};

const TOPICS: Topic[] = [
  {
    id: 't-start',
    title: 'З чого почати',
    blurb: 'Номер у боті, меню, перші кроки',
    href: `#${SUPPORT_SECTION.START}`,
  },
  {
    id: 't-bot',
    title: 'Telegram-бот',
    blurb: 'Команди, попутки, бронювання, inline',
    href: `#${SUPPORT_SECTION.BOT}`,
  },
  {
    id: 't-site',
    title: 'Сайт',
    blurb: 'Попутки, маршрутки, транспорт Малина',
    href: `#${SUPPORT_SECTION.SITE}`,
  },
  {
    id: 't-referral',
    title: 'Приведи друга',
    blurb: 'Бонуси, фото, виплати',
    href: `#${SUPPORT_SECTION.BOT_REFERRAL}`,
  },
  {
    id: 't-faq',
    title: 'Часті питання',
    blurb: 'Бот мовчить, немає кнопок, бонуси',
    href: `#${SUPPORT_SECTION.FAQ}`,
  },
  {
    id: 't-contact',
    title: 'Контакти',
    blurb: 'Телефон, email, Telegram',
    href: `#${SUPPORT_SECTION.CONTACT}`,
  },
];

const BOT_COMMANDS: Array<{ cmd: string; desc: string }> = [
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

const INLINE_QUERIES: Array<{ q: string; desc: string }> = [
  { q: '(порожньо)', desc: 'Меню: друг · попутки сьогодні · допомога · бронювання' },
  { q: 'ref_share', desc: 'Персональне посилання «Приведи друга»' },
  { q: 'rides_today', desc: 'Оголошення на сьогодні (до 20 карток)' },
  { q: 'rides завтра / rides київ', desc: 'Попутки з підказкою дати або маршруту' },
  { q: 'help', desc: 'Короткий список команд' },
  { q: 'book', desc: 'Посилання на бронювання в боті' },
  { q: 'share_listing_123', desc: 'Поділитися своїм оголошенням #123' },
];

const FAQ_PLAIN: Array<{ q: string; aText: string }> = [
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
      'Так: попутки на /poputky, маршрутки на /booking. Підтвердження бронювання, нагадування і бонуси акції зручніше отримувати в Telegram-боті.',
  },
];

const FAQ_ITEMS: Array<{ q: string; a: ReactNode }> = [
  {
    q: FAQ_PLAIN[0].q,
    a: (
      <>
        Відкрийте @{TELEGRAM_BOT_USERNAME}, натисніть «Розблокувати» (якщо бот у чорному списку), потім{' '}
        <code>/start</code>. Без чату з ботом не приходять підтвердження бронювань і повідомлення про бонуси.
      </>
    ),
  },
  {
    q: FAQ_PLAIN[1].q,
    a: (
      <>
        Потрібен номер у боті (кнопка «Поділитися контактом»). Кнопки з’являються лише при <strong>точному</strong>{' '}
        співпадінні маршруту, дати й часу (±45 хв) з вашим оголошенням водія або пасажира.
      </>
    ),
  },
  {
    q: FAQ_PLAIN[2].q,
    a: (
      <>
        Наберіть <code>@{TELEGRAM_BOT_USERNAME}</code> у полі повідомлення будь-якого чату. Має з’явитися меню або
        картки. Якщо порожньо — оновіть Telegram або спробуйте з іншого чату. Для персонального посилання спочатку
        зробіть <code>/start</code> у боті.
      </>
    ),
  },
  {
    q: FAQ_PLAIN[3].q,
    a: (
      <>
        Потрібні два фото через <code>/confirmride</code> і схвалення модератором. Само-запрошення з одного Telegram
        на два номери блокується. Якщо бот заблоковано — виплати заморожені, доки не зробите{' '}
        <code>/start</code> знову. Умови акції:{' '}
        <Link to={REFERRAL_PROMO_PAGE_LINK}>на сторінці «Про нас»</Link>.
      </>
    ),
  },
  {
    q: FAQ_PLAIN[4].q,
    a: (
      <>
        Команда <code>/cancel</code> у боті — список ваших бронювань і попуток з кнопками скасування.
      </>
    ),
  },
  {
    q: FAQ_PLAIN[5].q,
    a: (
      <>
        Так: попутки на <Link to="/poputky">/poputky</Link>, маршрутки на <Link to="/booking">/booking</Link>. Але
        підтвердження бронювання, нагадування за день і бонуси акції зручніше отримувати в Telegram-боті.
      </>
    ),
  },
];

function upsertMeta(name: string, content: string): () => void {
  let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  const created = !el;
  const prev = el?.getAttribute('content') ?? null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return () => {
    if (!el) return;
    if (created) el.remove();
    else if (prev != null) el.setAttribute('content', prev);
  };
}

function upsertJsonLd(id: string, data: object): () => void {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  const created = !el;
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
  return () => {
    if (created) el?.remove();
    else if (el) el.textContent = '';
  };
}

export const SupportPage: React.FC = () => {
  const location = useLocation();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [botSearch, setBotSearch] = useState('');

  useEffect(() => {
    const prev = document.title;
    document.title = `Допомога | Telegram-бот і FAQ | ${SITE_PUBLIC_DOMAIN}`;
    const restoreDesc = upsertMeta(
      'description',
      'Довідка malin.kiev.ua: як користуватися Telegram-ботом @malin_kiev_ua_bot (попутки, бронювання, inline, акція «Приведи друга»), FAQ і контакти.'
    );
    const restoreLd = upsertJsonLd('support-faq-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ_PLAIN.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.aText,
        },
      })),
    });
    return () => {
      document.title = prev;
      restoreDesc();
      restoreLd();
    };
  }, []);

  useEffect(() => {
    if (!location.hash) return;
    const id = window.requestAnimationFrame(() => {
      document.getElementById(location.hash.replace('#', ''))?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [location.hash, location.pathname]);

  const filteredCommands = useMemo(() => {
    const q = botSearch.trim().toLowerCase();
    if (!q) return BOT_COMMANDS;
    return BOT_COMMANDS.filter(
      (c) => c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
    );
  }, [botSearch]);

  return (
    <div className="support-page">
      <header className="support-hero">
        <p className="support-hero__eyebrow">Центр допомоги · {SITE_PUBLIC_DOMAIN}</p>
        <h1 className="support-hero__title">Чим допомогти?</h1>
        <p className="support-hero__lead">
          Попутки, маршрутки й акції — у Telegram-боті та на сайті. Нижче зібрані інструкції у стилі довідкового
          центру: оберіть тему або одразу відкрийте бота.
        </p>
        <div className="support-hero__actions">
          <a
            className="support-btn support-btn--primary"
            href={TELEGRAM_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Відкрити @{TELEGRAM_BOT_USERNAME}
          </a>
          <a className="support-btn support-btn--ghost" href={`#${SUPPORT_SECTION.BOT}`}>
            Інструкція по боту
          </a>
          <a className="support-btn support-btn--ghost" href={`#${SUPPORT_SECTION.CONTACT}`}>
            Контакти
          </a>
        </div>
      </header>

      <nav className="support-topics" aria-label="Розділи допомоги">
        {TOPICS.map((t) => (
          <a key={t.id} className="support-topic" href={t.href}>
            <span className="support-topic__title">{t.title}</span>
            <span className="support-topic__blurb">{t.blurb}</span>
          </a>
        ))}
      </nav>

      <div className="support-body">
        <section id={SUPPORT_SECTION.START} className="support-section" aria-labelledby="support-start-h">
          <h2 id="support-start-h">З чого почати</h2>
          <ol className="support-steps">
            <li>
              Відкрийте{' '}
              <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
                @{TELEGRAM_BOT_USERNAME}
              </a>{' '}
              і натисніть <strong>Start</strong> (або <code>/start</code>).
            </li>
            <li>
              <strong>Поділіться номером телефону</strong> кнопкою «Поділитися контактом». Без номера не працюють
              бронювання, персональні кнопки в <code>/allrides</code> і виплати акції.
            </li>
            <li>
              Знизу з’явиться меню: <strong>Маршрутки · Попутки · Акції · Довідка</strong>.
            </li>
            <li>
              На сайті можна одразу перейти до{' '}
              <Link to="/poputky">попуток</Link>, <Link to="/booking">маршруток</Link> або{' '}
              <Link to="/localtransport">транспорту Малина</Link> — а бот тримати відкритим для підтверджень.
            </li>
          </ol>
          <div className="support-callout">
            <p>
              <strong>Підказка.</strong> Якщо прийшли з сайту попуток — deep-link одразу запускає сценарій водія або
              пасажира:{' '}
              <a href={`${TELEGRAM_BOT_START_URL}driver`}>водій</a>
              {' · '}
              <a href={`${TELEGRAM_BOT_START_URL}passenger`}>пасажир</a>
              {' · '}
              <a href={`${TELEGRAM_BOT_START_URL}view`}>перегляд</a>.
            </p>
          </div>
        </section>

        <section id={SUPPORT_SECTION.BOT} className="support-section" aria-labelledby="support-bot-h">
          <h2 id="support-bot-h">Telegram-бот — повна інструкція</h2>
          <p className="support-lead">
            Бот — основний канал для бронювань маршруток, оголошень попуток, швидких збігів водій↔пасажир, акції
            «Приведи друга» і шарингу в групи через inline. Сайт зручний для огляду; бот — для дій і сповіщень.
          </p>

          <div className="support-subnav" aria-label="Підрозділи бота">
            <a href={`#${SUPPORT_SECTION.BOT_MENU}`}>Меню й команди</a>
            <a href={`#${SUPPORT_SECTION.BOT_RIDES}`}>Попутки</a>
            <a href={`#${SUPPORT_SECTION.BOT_INLINE}`}>Inline у чатах</a>
            <a href={`#${SUPPORT_SECTION.BOT_BOOK}`}>Бронювання</a>
            <a href={`#${SUPPORT_SECTION.BOT_REFERRAL}`}>Приведи друга</a>
            <a href={`#${SUPPORT_SECTION.BOT_CONFIRM}`}>Фото поїздки</a>
          </div>

          <div id={SUPPORT_SECTION.BOT_MENU} className="support-block">
            <h3>Меню й команди</h3>
            <p>
              Нижнє меню дублює найчастіші сценарії. Усі команди можна набрати текстом. Повний список також у{' '}
              <code>/help</code> після реєстрації номера.
            </p>
            <label className="support-filter">
              <span className="support-filter__label">Пошук команди</span>
              <input
                type="search"
                value={botSearch}
                onChange={(e) => setBotSearch(e.target.value)}
                placeholder="напр. allrides або скасувати"
                autoComplete="off"
              />
            </label>
            <div className="support-table-wrap">
              <table className="support-table">
                <thead>
                  <tr>
                    <th>Команда</th>
                    <th>Що робить</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCommands.map((c) => (
                    <tr key={c.cmd}>
                      <td>
                        <code>{c.cmd}</code>
                      </td>
                      <td>{c.desc}</td>
                    </tr>
                  ))}
                  {filteredCommands.length === 0 && (
                    <tr>
                      <td colSpan={2}>Нічого не знайдено — спробуйте інше слово.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div id={SUPPORT_SECTION.BOT_RIDES} className="support-block">
            <h3>Попутки в боті (<code>/allrides</code>)</h3>
            <ul className="support-list">
              <li>
                Показує <strong>активні</strong> оголошення водіїв і пасажирів (Київ, Житомир, Коростень ↔ Малин).
              </li>
              <li>
                <strong>Фільтри:</strong> майбутні, усі, сьогодні, завтра, своя дата; для майбутніх — ранок / день /
                вечір.
              </li>
              <li>
                Водії з Telegram: окрема картка з посиланням <strong>«Забронювати»</strong> (
                <code>start=book_viber_ID</code>) — запит на підтвердження (1 година).
              </li>
              <li>
                Якщо у вас є власне оголошення з <strong>точним</strong> збігом маршруту, дати й часу — з’являються
                кнопки швидкого запиту до другої сторони.
              </li>
              <li>
                Кнопка <strong>«Поділитися попутками в чат»</strong> відкриває inline і вставляє список у{' '}
                <em>поточний</em> чат (група, сім’я, сусіди).
              </li>
              <li>
                Після публікації поїздки водієм (<code>/adddriverride</code>) — кнопка «Поділитися оголошенням». У{' '}
                <code>/mydriverrides</code> — те саме для кожного активного оголошення.
              </li>
            </ul>
            <p>
              Додати оголошення: <code>/adddriverride</code> або <code>/addpassengerride</code> (маршрут → дата → час
              → місця/примітка → телефон уже з профілю).
            </p>
          </div>

          <div id={SUPPORT_SECTION.BOT_INLINE} className="support-block">
            <h3>Inline: @{TELEGRAM_BOT_USERNAME} у будь-якому чаті</h3>
            <p>
              Не обов’язково відкривати бот: у полі повідомлення наберіть{' '}
              <code>@{TELEGRAM_BOT_USERNAME}</code>, оберіть картку — Telegram надішле готовий текст у чат.
            </p>
            <ol className="support-steps">
              <li>Відкрийте груповий або особистий чат.</li>
              <li>
                У полі вводу: <code>@{TELEGRAM_BOT_USERNAME}</code> (або лише <code>@</code> і виберіть бота).
              </li>
              <li>Побачите підказку (placeholder) і список карток — тапніть потрібну.</li>
            </ol>
            <div className="support-table-wrap">
              <table className="support-table">
                <thead>
                  <tr>
                    <th>Запит після @бот</th>
                    <th>Результат</th>
                  </tr>
                </thead>
                <tbody>
                  {INLINE_QUERIES.map((row) => (
                    <tr key={row.q}>
                      <td>
                        <code>{row.q}</code>
                      </td>
                      <td>{row.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="support-callout">
              <p>
                <strong>Кнопки в боті, що відкривають inline:</strong> «Поділитися з другом» у{' '}
                <code>/invite</code>; «Поділитися оголошенням» після додавання поїздки; «Поділитися попутками» у{' '}
                <code>/allrides</code>. Якщо потрібен номер — картка <code>setup_phone</code> веде в бот поділитися
                контактом, потім можна повернутися до попуток у чат.
              </p>
            </div>
          </div>

          <div id={SUPPORT_SECTION.BOT_BOOK} className="support-block">
            <h3>Бронювання маршруток і запити до водіїв</h3>
            <ul className="support-list">
              <li>
                <code>/book</code> — напрямок → дата → рейс → місця (як на сайті бронювання).
              </li>
              <li>
                <code>/mybookings</code> — ваші бронювання; нагадування за день до поїздки приходять у цей же чат.
              </li>
              <li>
                Запит до водія попутки: посилання з <code>/allrides</code> або{' '}
                <code>{TELEGRAM_BOT_START_URL}book_viber_123</code> — водій отримує сповіщення і має 1 годину на
                підтвердження.
              </li>
              <li>
                Deep-link <code>?start=book</code> відкриває сценарій бронювання одразу з картки inline.
              </li>
            </ul>
            <p>
              На сайті той самий сценарій маршруток:{' '}
              <Link to="/booking">malin.kiev.ua/booking</Link>. Без Telegram ви не отримаєте автоматичне
              підтвердження в чат — тоді краще уточнити телефоном (див. контакти нижче).
            </p>
          </div>

          <div id={SUPPORT_SECTION.BOT_REFERRAL} className="support-block">
            <h3>Акція «Приведи друга»</h3>
            <p>
              Команда <code>/invite</code>: умови, ваше персональне посилання, кнопки «Поділитися» (inline),
              «Копіювати посилання», запрошення за номером / @username, статистика.
            </p>
            <ul className="support-list">
              <li>
                Друг відкриває посилання → <code>/start</code> → ділиться номером → додає попутку як водій або
                пасажир.
              </li>
              <li>
                Типові бонуси (деталі й ліміти — у{' '}
                <Link to={REFERRAL_PROMO_PAGE_LINK}>офіційних умовах</Link>): участь ~10 грн, підтверджені поїздки
                пасажира ~20 грн (і запрошувачу, і другу), кваліфікація водія ~40 грн.
              </li>
              <li>
                Виплата — після модерації фото. Поки бот заблоковано користувачем, невиплачені бонуси на паузі.
              </li>
              <li>
                <strong>Не можна:</strong> запросити «себе» другим номером з того самого Telegram-акаунта —
                зв’язок блокується, бонуси заморожуються до рішення адміністратора.
              </li>
            </ul>
          </div>

          <div id={SUPPORT_SECTION.BOT_CONFIRM} className="support-block">
            <h3>Підтвердження поїздки фото (<code>/confirmride</code>)</h3>
            <ol className="support-steps">
              <li>Оберіть поїздку зі списку (або почніть сценарій з меню Акції).</li>
              <li>
                Надішліть <strong>фото 1</strong> — старт (місце відправлення). Можна як фото або як файл-зображення.
              </li>
              <li>
                Надішліть <strong>фото 2</strong> — прибуття. Альбом одразу двох фото бот попередить — краще по
                одному.
              </li>
              <li>Виконайте крок із постом у Facebook (як просить бот).</li>
              <li>Модератор схвалить або відхилить; при відхиленні — причина в боті, можна надіслати нові фото.</li>
            </ol>
            <p className="support-muted">
              Ліміт: не більшеше 2 підтверджень на день на людину. Скасувати очікування фото — кнопка «Скасувати» під
              підказкою бота.
            </p>
          </div>
        </section>

        <section id={SUPPORT_SECTION.SITE} className="support-section" aria-labelledby="support-site-h">
          <h2 id="support-site-h">Сайт — розділи сервісу</h2>
          <p className="support-lead">
            Структура як у великих сервісів попуток: окремі «колекції» допомоги під продукт. Зараз коротко, куди
            йти на сайті; детальні FAQ по веб-формах розширимо пізніше.
          </p>
          <div className="support-site-grid">
            <article className="support-site-card">
              <h3>Попутки</h3>
              <p>Перегляд і публікація оголошень водій / пасажир, запит до водія з сайту.</p>
              <Link to="/poputky">Відкрити попутки →</Link>
            </article>
            <article className="support-site-card">
              <h3>Маршрутки</h3>
              <p>Розклад і бронювання місць Київ / Житомир / Коростень ↔ Малин.</p>
              <Link to="/booking">Бронювання →</Link>
            </article>
            <article className="support-site-card">
              <h3>Транспорт Малина</h3>
              <p>Місцеві маршрути й зупинки (карта, табло зупинки).</p>
              <Link to="/localtransport">Локальний транспорт →</Link>
            </article>
            <article className="support-site-card">
              <h3>Про нас і умови</h3>
              <p>Юридичні реквізити, політика, умови, умови акції «Приведи друга».</p>
              <Link to={COMPANY_LEGAL_PATH}>Про нас →</Link>
              <span className="support-site-card__links">
                <Link to={PRIVACY_POLICY_PAGE_LINK}>Політика</Link>
                {' · '}
                <Link to={TERMS_PAGE_LINK}>Умови</Link>
                {' · '}
                <Link to={REFERRAL_PROMO_PAGE_LINK}>Акція</Link>
              </span>
            </article>
          </div>
        </section>

        <section id={SUPPORT_SECTION.FAQ} className="support-section" aria-labelledby="support-faq-h">
          <h2 id="support-faq-h">Часті питання</h2>
          <div className="support-faq">
            {FAQ_ITEMS.map((item, i) => {
              const open = openFaq === i;
              return (
                <div key={item.q} className={`support-faq__item${open ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="support-faq__q"
                    aria-expanded={open}
                    onClick={() => setOpenFaq(open ? null : i)}
                  >
                    {item.q}
                    <span className="support-faq__chev" aria-hidden="true">
                      {open ? '−' : '+'}
                    </span>
                  </button>
                  {open && <div className="support-faq__a">{item.a}</div>}
                </div>
              );
            })}
          </div>
        </section>

        <section id={SUPPORT_SECTION.CONTACT} className="support-section" aria-labelledby="support-contact-h">
          <h2 id="support-contact-h">Контакти</h2>
          <p className="support-lead">
            Пишіть у бот або на контакти компанії. Для питань по бронюванню маршрутки зручно вказати дату й напрямок.
          </p>
          <p>
            Telegram:{' '}
            <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
              @{TELEGRAM_BOT_USERNAME}
            </a>
          </p>
          <SiteContactBlock title="" headingId="support-contact-details" />
        </section>
      </div>
    </div>
  );
};
