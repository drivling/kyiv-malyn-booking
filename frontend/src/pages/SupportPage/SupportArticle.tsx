import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { SiteContactBlock } from '@/components/SiteContactBlock/SiteContactBlock';
import { usePageSeo } from '@/hooks';
import { COMPANY_LEGAL_PATH } from '@/legal/companyLegal';
import {
  PRIVACY_POLICY_PAGE_LINK,
  REFERRAL_PROMO_PAGE_LINK,
  SITE_PUBLIC_DOMAIN,
  TERMS_PAGE_LINK,
} from '@/legal/sitePublic';
import {
  BOT_COMMANDS,
  BOT_TOC,
  FAQ_PLAIN,
  INLINE_QUERIES,
  SUPPORT_PATH,
  SUPPORT_TOPICS,
  TELEGRAM_BOT_START_URL,
  TELEGRAM_BOT_URL,
  TELEGRAM_BOT_USERNAME,
  TRAVEL_FAQ,
  PRICES_FAQ,
  PRICES_TOC,
  CITY_TRANSPORT_FAQ,
  CITY_TRANSPORT_TOC,
  isSupportTopicId,
  supportTopicPath,
  type SupportTopicId,
} from './supportContent';
import { CORRIDOR_LANDINGS, corridorPath } from '@/pages/MizhgorodskiPage/corridorLandings';

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

const FAQ_UI: Array<{ q: string; a: ReactNode }> = [
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
        на два номери блокується. Якщо бот заблоковано — виплати заморожені, доки не зробите <code>/start</code>{' '}
        знову. Умови акції: <Link to={REFERRAL_PROMO_PAGE_LINK}>на сторінці «Про нас»</Link>.
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
        Так: міжміський пошук попуток і маршруток на <Link to="/mizhgorodski">/mizhgorodski</Link>, міський
        транспорт — <Link to="/transport">/transport</Link>. Але
        підтвердження бронювання, нагадування за день і бонуси акції зручніше отримувати в Telegram-боті.
      </>
    ),
  },
];

const META: Record<SupportTopicId, { title: string; description: string }> = {
  start: {
    title: `З чого почати | Допомога | ${SITE_PUBLIC_DOMAIN}`,
    description: 'Перші кроки в Telegram-боті malin.kiev.ua: Start, номер телефону, меню.',
  },
  travel: {
    title: `Як доїхати до Малина | Попутка й маршрутка | ${SITE_PUBLIC_DOMAIN}`,
    description:
      'Як доїхати до Малина з Києва, Житомира чи Коростеня: попутки, маршрутки, живий пошук на malin.kiev.ua.',
  },
  prices: {
    title: `Скільки коштує маршрутка Малин — Київ | Ціни попуток | ${SITE_PUBLIC_DOMAIN}`,
    description:
      'Скільки коштує маршрутка й попутка Малин ↔ Київ, Житомир, Коростень. Чому в Google часто 450–600₴ і як не плутати з локальними рейсами. Академмістечко, Святошин.',
  },
  transport: {
    title: `Транспорт Малина | Розклад міських маршруток | ${SITE_PUBLIC_DOMAIN}`,
    description:
      'Як їздити міськими маршрутками в Малині: планер З → До, табло зупинок, розклад ліній. Живий гід замість постів у Facebook.',
  },
  bot: {
    title: `Telegram-бот | Допомога | ${SITE_PUBLIC_DOMAIN}`,
    description:
      'Повна інструкція @malin_kiev_ua_bot: команди, /allrides, inline, бронювання, підтвердження фото.',
  },
  site: {
    title: `Сайт | Допомога | ${SITE_PUBLIC_DOMAIN}`,
    description: 'Розділи сайту malin.kiev.ua: міжміські попутки й маршрутки, транспорт Малина, про нас.',
  },
  referral: {
    title: `Приведи друга | Допомога | ${SITE_PUBLIC_DOMAIN}`,
    description: 'Акція «Приведи друга»: /invite, бонуси, фото /confirmride, виплати.',
  },
  faq: {
    title: `Часті питання | Допомога | ${SITE_PUBLIC_DOMAIN}`,
    description: 'FAQ: бот не відповідає, немає кнопок у /allrides, inline, бонуси акції.',
  },
  contact: {
    title: `Контакти | Допомога | ${SITE_PUBLIC_DOMAIN}`,
    description: 'Контакти malin.kiev.ua: Telegram-бот, телефон, email.',
  },
};

function ArticleChrome({
  topicId,
  toc,
  children,
}: {
  topicId: SupportTopicId;
  toc?: Array<{ id: string; label: string }>;
  children: ReactNode;
}) {
  const topic = SUPPORT_TOPICS.find((t) => t.id === topicId)!;
  const idx = SUPPORT_TOPICS.findIndex((t) => t.id === topicId);
  const prev = idx > 0 ? SUPPORT_TOPICS[idx - 1] : null;
  const next = idx >= 0 && idx < SUPPORT_TOPICS.length - 1 ? SUPPORT_TOPICS[idx + 1] : null;

  return (
    <article className="support-article">
      <nav className="support-breadcrumb" aria-label="Шлях">
        <Link to={SUPPORT_PATH}>Допомога</Link>
        <span aria-hidden="true">/</span>
        <span>{topic.title}</span>
      </nav>
      <h1 className="support-article__title">{topic.title}</h1>
      <p className="support-article__dek">{topic.blurb}</p>

      {toc && toc.length > 0 && (
        <details className="support-article-toc">
          <summary>На цій сторінці</summary>
          <ul>
            {toc.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`}>{item.label}</a>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="support-article__body">{children}</div>

      <nav className="support-pager" aria-label="Сусідні теми">
        {prev ? (
          <Link to={supportTopicPath(prev.id)} className="support-pager__link support-pager__link--prev">
            <span className="support-pager__label">Назад</span>
            <span className="support-pager__title">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link to={supportTopicPath(next.id)} className="support-pager__link support-pager__link--next">
            <span className="support-pager__label">Далі</span>
            <span className="support-pager__title">{next.title}</span>
          </Link>
        ) : (
          <Link to={SUPPORT_PATH} className="support-pager__link support-pager__link--next">
            <span className="support-pager__label">Усі теми</span>
            <span className="support-pager__title">Центр допомоги</span>
          </Link>
        )}
      </nav>
    </article>
  );
}

function StartArticle() {
  return (
    <ArticleChrome topicId="start">
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
          На сайті можна одразу перейти до <Link to="/mizhgorodski">міжміських попуток і маршруток</Link> або{' '}
          <Link to="/transport">транспорту Малина</Link> — а бот
          тримати відкритим для підтверджень.
        </li>
      </ol>
      <div className="support-callout">
        <p>
          <strong>Підказка.</strong> Deep-link з сайту:{' '}
          <a href={`${TELEGRAM_BOT_START_URL}driver`}>водій</a>
          {' · '}
          <a href={`${TELEGRAM_BOT_START_URL}passenger`}>пасажир</a>
          {' · '}
          <a href={`${TELEGRAM_BOT_START_URL}view`}>перегляд</a>.
        </p>
      </div>
      <p className="support-muted">
        Далі:{' '}
        <Link to={supportTopicPath('bot')}>повна інструкція по боту</Link> або{' '}
        <Link to={supportTopicPath('faq')}>часті питання</Link>.
      </p>
    </ArticleChrome>
  );
}

function BotArticle() {
  const [botSearch, setBotSearch] = useState('');
  const filteredCommands = useMemo(() => {
    const q = botSearch.trim().toLowerCase();
    if (!q) return BOT_COMMANDS;
    return BOT_COMMANDS.filter(
      (c) => c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
    );
  }, [botSearch]);

  return (
    <ArticleChrome topicId="bot" toc={BOT_TOC}>
      <p className="support-lead">
        Бот — основний канал для бронювань, попуток, збігів водій↔пасажир, акції «Приведи друга» і шарингу в групи.
        Сайт зручний для огляду; бот — для дій і сповіщень.
      </p>

      <section id="bot-menu" className="support-block">
        <h2>Меню й команди</h2>
        <p>
          Нижнє меню дублює найчастіші сценарії. Повний список також у <code>/help</code> після реєстрації номера.
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
      </section>

      <section id="bot-rides" className="support-block">
        <h2>Попутки (<code>/allrides</code>)</h2>
        <ul className="support-list">
          <li>
            Активні оголошення водіїв і пасажирів (Київ, Житомир, Коростень ↔ Малин).
          </li>
          <li>
            Фільтри: майбутні, усі, сьогодні, завтра, своя дата; для майбутніх — ранок / день / вечір.
          </li>
          <li>
            Водії з Telegram: картка з <strong>«Забронювати»</strong> (
            <code>start=book_viber_ID</code>) — 1 година на підтвердження.
          </li>
          <li>
            Точний збіг з вашим оголошенням → кнопки швидкого запиту до другої сторони.
          </li>
          <li>
            «Поділитися попутками в чат» — inline у <em>поточний</em> чат.
          </li>
          <li>
            Після <code>/adddriverride</code> і в <code>/mydriverrides</code> — «Поділитися оголошенням».
          </li>
        </ul>
      </section>

      <section id="bot-inline" className="support-block">
        <h2>Inline: @{TELEGRAM_BOT_USERNAME}</h2>
        <ol className="support-steps">
          <li>У будь-якому чаті наберіть <code>@{TELEGRAM_BOT_USERNAME}</code>.</li>
          <li>Оберіть картку — текст піде в чат без відкриття бота.</li>
        </ol>
        <div className="support-table-wrap">
          <table className="support-table">
            <thead>
              <tr>
                <th>Запит</th>
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
            Кнопки в боті: «Поділитися з другом» (<code>/invite</code>), «Поділитися оголошенням», «Поділитися
            попутками» в <code>/allrides</code>.
          </p>
        </div>
      </section>

      <section id="bot-book" className="support-block">
        <h2>Бронювання</h2>
        <ul className="support-list">
          <li>
            <code>/book</code> — напрямок → дата → рейс → місця.
          </li>
          <li>
            <code>/mybookings</code> — ваші бронювання; нагадування за день у цей чат.
          </li>
          <li>
            Запит до водія: <code>{TELEGRAM_BOT_START_URL}book_viber_123</code>.
          </li>
          <li>
            Сайт: <Link to="/mizhgorodski">/mizhgorodski</Link>. Без Telegram підтвердження в чат не прийде.
          </li>
        </ul>
      </section>

      <section id="bot-referral" className="support-block">
        <h2>Акція в боті</h2>
        <p>
          Коротко тут; повна стаття —{' '}
          <Link to={supportTopicPath('referral')}>Приведи друга</Link>. Команда <code>/invite</code>, фото —{' '}
          <code>/confirmride</code>.
        </p>
      </section>

      <section id="bot-confirm" className="support-block">
        <h2>Фото поїздки (<code>/confirmride</code>)</h2>
        <ol className="support-steps">
          <li>Оберіть поїздку.</li>
          <li>Фото 1 — старт; фото 2 — прибуття (краще по одному, не альбомом).</li>
          <li>Крок із Facebook, як просить бот.</li>
          <li>Модерація: схвалення або причина відхилення в боті.</li>
        </ol>
        <p className="support-muted">Ліміт: до 2 підтверджень на день. Скасувати — кнопка під підказкою бота.</p>
      </section>
    </ArticleChrome>
  );
}

function TravelArticle() {
  useEffect(() => {
    return upsertJsonLd('support-travel-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: TRAVEL_FAQ.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    });
  }, []);

  return (
    <ArticleChrome topicId="travel">
      <p className="support-lead">
        <strong>Коротко:</strong> до Малина з Києва, Житомира чи Коростеня найзручніше доїхати попуткою або
        маршруткою. Актуальні поїздки на обрану дату — у живому пошуку на{' '}
        <Link to="/mizhgorodski">міжміських</Link>, а не в застарілих новинних «розкладах».
      </p>

      <h2>Три способи</h2>
      <ol className="support-list">
        <li>
          <strong>Попутка</strong> — оголошення водія або заявка пасажира на конкретну дату. Безкоштовно
          розмістити можна на сайті або в боті.
        </li>
        <li>
          <strong>Маршрутка</strong> — регулярний рейс з фіксованим розкладом (таблиця на сторінці напрямку):
          оберіть час у пошуку й забронюйте місце; підтвердження зручно отримати в @{TELEGRAM_BOT_USERNAME}.
        </li>
        <li>
          <strong>Telegram-бот</strong> —{' '}
          <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
            @{TELEGRAM_BOT_USERNAME}
          </a>
          : пошук, бронювання, нагадування.
        </li>
      </ol>

      <h2>Напрямки (всі через Малин)</h2>
      <p>
        На кожній сторінці напрямку — <strong>розклад маршруток</strong> з годинами відправлення (з бази
        бронювання) плюс посилання на попутки.
      </p>
      <ul className="support-list">
        {CORRIDOR_LANDINGS.map((c) => (
          <li key={c.slug}>
            <Link to={corridorPath(c.slug)}>
              {c.fromLabel} → {c.toLabel}
            </Link>
            {' — '}
            розклад, попутка, FAQ.
          </li>
        ))}
      </ul>
      <p>
        Живий пошук з фільтрами:{' '}
        <Link to="/mizhgorodski">malin.kiev.ua/mizhgorodski</Link>. Ціни —{' '}
        <Link to={supportTopicPath('prices')}>скільки коштує Малин — Київ</Link>. Містом —{' '}
        <Link to="/transport">транспорт Малина</Link> і гід{' '}
        <Link to={supportTopicPath('transport')}>як їздити містом</Link>.
      </p>

      <h2>Часті питання</h2>
      <div className="support-faq">
        {TRAVEL_FAQ.map((item) => (
          <div key={item.q} className="support-faq__item is-open">
            <div className="support-faq__q" role="heading" aria-level={3}>
              {item.q}
            </div>
            <div className="support-faq__a">{item.a}</div>
          </div>
        ))}
      </div>
    </ArticleChrome>
  );
}

function PricesArticle() {
  useEffect(() => {
    return upsertJsonLd('support-prices-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: PRICES_FAQ.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    });
  }, []);

  return (
    <ArticleChrome topicId="prices" toc={PRICES_TOC}>
      <div className="support-article-flow support-article-flow--transport">
        <p className="support-lead">
          <strong>Коротко.</strong>
          <br />
          Питання «скільки коштує маршрутка Київ — Малин?» у пошуку часто відповідають цифрами{' '}
          <strong>450–600₴</strong> з агрегаторів автобусів.
        </p>
        <p className="support-lead support-lead--follow">
          Для Малина це майже завжди <em>інший</em> продукт.
          <br />
          Локальна маршрутка Малин ↔ Київ у нашій базі — <strong>280 грн</strong> за місце; попутки —
          ціна водія в картці. Дивіться пошук на{' '}
          <Link to="/mizhgorodski">malin.kiev.ua/mizhgorodski</Link>.
        </p>

        <section className="support-block" aria-labelledby="prices-short">
          <h2 id="prices-short">Чому Google показує 450–600₴</h2>
          <p>
            Огляди ШІ й сайти на кшталт Tickets.ua / Busfor добретують <strong>міжміські автобусні
            квитки</strong> — часто інші рейси, інші точки посадки, інший тариф.
          </p>
          <p>
            Люди з Малина зазвичай шукають <strong>локальну маршрутку</strong> (Академмістечко /
            Святошин) або <strong>попутку</strong> від водія.
          </p>
          <div className="support-callout support-callout--stack">
            <p className="support-callout__title">Три різні «ціни»</p>
            <ul className="support-list support-list--compact">
              <li>
                <strong>Автобус з агрегатора</strong> — часто від ~450–600₴ (те, що любить цитувати
                ШІ).
              </li>
              <li>
                <strong>Локальна маршрутка</strong> Малин ↔ Київ — <strong>280 грн</strong> у базі
                malin.kiev.ua.
              </li>
              <li>
                <strong>Попутка</strong> — ціну ставить водій у картці (часто орієнтир ~200–250₴).
              </li>
            </ul>
          </div>
        </section>

        <section className="support-block" aria-labelledby="prices-kyiv">
          <h2 id="prices-kyiv">Малин ↔ Київ</h2>
          <p>
            Напрямки:{' '}
            <Link to="/mizhgorodski/malyn-kyiv">Малин → Київ</Link>
            {' · '}
            <Link to="/mizhgorodski/kyiv-malyn">Київ → Малин</Link>.
          </p>

          <div className="support-fare-chip" aria-label="Тариф маршрутки 280 гривень">
            <span className="support-fare-chip__label">Маршрутка Малин ↔ Київ</span>
            <span className="support-fare-chip__amount">
              280<span aria-hidden>₴</span>
            </span>
            <span className="support-fare-chip__meta">за місце · у базі розкладу</span>
          </div>

          <div className="support-how-grid">
            <article className="support-how-card">
              <h3>Маршрутка</h3>
              <p>
                Регулярні рейси з бронюванням місця на сайті / у боті — тариф <strong>280 грн</strong>.
              </p>
              <p>
                У Києві орієнтири: <strong>ст. м. Академмістечко</strong> (часто через Ірпінь) або{' '}
                <strong>Святошин</strong> (частина рейсів через Бучу).
              </p>
              <p className="support-how-card__hint">
                Не порівнюйте «в лоб» з квитком 600₴ на центральний автовокзал Києва — це різні
                поїздки.
              </p>
            </article>
            <article className="support-how-card">
              <h3>Попутка</h3>
              <p>
                Оголошення водія на конкретну дату. Ціна — у картці (або «за домовленістю»).
              </p>
              <p>
                У живих оголошеннях коридору Малин — Київ часто фігурує орієнтир близько{' '}
                <strong>200–250₴</strong> за місце.
              </p>
              <p className="support-how-card__hint">
                Це не прайс-лист: дивіться поїздку на свою дату в пошуку.
              </p>
            </article>
            <article className="support-how-card">
              <h3>Час у дорозі</h3>
              <p>Орієнтовно 1,5–2 години залежно від трафіку й маршруту (Ірпінь / Буча).</p>
              <p>
                Точний час відправлення — у розкладі маршруток і в оголошенні попутки.
              </p>
              <p className="support-how-card__hint">
                Як доїхати загалом — <Link to={supportTopicPath('travel')}>гід «до Малина»</Link>.
              </p>
            </article>
          </div>

          <aside className="support-callout support-callout--note">
            <p>
              <strong>Що зробити зараз.</strong> Відкрийте пошук{' '}
              <Link to="/mizhgorodski?from=Malyn&to=Kyiv">Малин → Київ</Link> або{' '}
              <Link to="/mizhgorodski?from=Kyiv&to=Malyn">Київ → Малин</Link>, порівняйте попутки й
              маршрутки на дату — і побачите реальні суми, а не «середнє по інтернету».
            </p>
          </aside>
        </section>

        <section className="support-block" aria-labelledby="prices-other">
          <h2 id="prices-other">Житомир і Коростень</h2>
          <p>
            Ціну маршрутки на Житомир / Коростень у базі <strong>ще уточнюємо</strong> — з’явиться в
            картках рейсів, щойно зафіксуємо.
          </p>
          <p>
            Попутка = ціна водія в оголошенні. Порівняйте варіанти в пошуку.
          </p>
          <ul className="support-hub-chips">
            <li>
              <Link to="/mizhgorodski/malyn-zhytomyr">Малин → Житомир</Link>
              <span>попутка + маршрутка</span>
            </li>
            <li>
              <Link to="/mizhgorodski/zhytomyr-malyn">Житомир → Малин</Link>
              <span>попутка + маршрутка</span>
            </li>
            <li>
              <Link to="/mizhgorodski/malyn-korosten">Малин → Коростень</Link>
              <span>попутка + маршрутка</span>
            </li>
            <li>
              <Link to="/mizhgorodski/korosten-malyn">Коростень → Малин</Link>
              <span>попутка + маршрутка</span>
            </li>
          </ul>
        </section>

        <section className="support-block" aria-labelledby="prices-faq">
          <h2 id="prices-faq">Часті питання</h2>
          <div className="support-faq">
            {PRICES_FAQ.map((item) => (
              <div key={item.q} className="support-faq__item is-open">
                <div className="support-faq__q" role="heading" aria-level={3}>
                  {item.q}
                </div>
                <div className="support-faq__a">{item.a}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ArticleChrome>
  );
}

function TransportArticle() {
  useEffect(() => {
    return upsertJsonLd('support-transport-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: CITY_TRANSPORT_FAQ.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    });
  }, []);

  return (
    <ArticleChrome topicId="transport" toc={CITY_TRANSPORT_TOC}>
      <div className="support-article-flow support-article-flow--transport">
        <p className="support-lead">
          <strong>Коротко.</strong>
          <br />
          У Малині нарешті можна відкрити телефон і побачити, <em>коли</em> підійде міська маршрутка —
          не лише «десь поїде».
        </p>
        <p className="support-lead support-lead--follow">
          Планер, табло зупинок і сторінки ліній — на{' '}
          <Link to="/transport">malin.kiev.ua/transport</Link>.
          <br />
          Між містами — окрема історія:{' '}
          <Link to={supportTopicPath('travel')}>як доїхати до Малина</Link>.
        </p>

        <section className="support-block" aria-labelledby="city-why">
          <h2 id="city-why">Чому це взагалі з’явилось</h2>

          <p>
            Спробуйте в пошуку: «Малин розклад маршруток».
          </p>
          <p>
            З великою ймовірністю випадуть <strong>міжміські</strong> таблиці — автостанція, рейси на
            Київ чи Житомир, новини на кшталт Polissya.today.
          </p>
          <p>
            Це корисно, якщо ви їдете <em>з міста</em>.
            <br />
            І майже марно, якщо треба з БАМу до лікарні чи з вокзалу на Соборну.
          </p>

          <div className="support-callout support-callout--stack">
            <p className="support-callout__title">Де жив міський графік роками</p>
            <ul className="support-list support-list--compact">
              <li>пост міськради у Facebook;</li>
              <li>переказ у місцевих новинах («з понеділка новий розклад…»);</li>
              <li>фото папірця на зупинці;</li>
              <li>питання в чатах: «а №5 ще ходить?».</li>
            </ul>
            <p>
              Навіть набір на data.gov.ua — це архів для чиновників, а не табло для людини з сумкою й
              дитиною.
            </p>
            <p>
              Тож люди орієнтувалися «на око»: вийти раніше, почекати довше, спитати у водія.
            </p>
          </div>

          <p>
            Ми зібрали зупинки, лінії й відправлення в один сервіс — щоб розклад Малина можна було{' '}
            <strong>знайти</strong>, відкрити з телефону й поділитися посиланням.
          </p>
          <p>
            Офіційні зміни схеми чи графіка окремої лінії лишаються джерелом правди для перевізників.
            <br />
            Наша задача — щоб щоденна поїздка не починалася з археології в стрічці новин.
          </p>
        </section>

        <section className="support-block" aria-labelledby="city-how">
          <h2 id="city-how">Три способи користуватися</h2>

          <div className="support-how-grid">
            <article className="support-how-card">
              <h3>1. Планер «З → До»</h3>
              <p>
                На <Link to="/transport">/transport</Link> оберіть дві зупинки (або тицьніть на
                карті) і натисніть «Знайти».
              </p>
              <p>Побачите прямі маршрути й найближче відправлення.</p>
              <p className="support-how-card__hint">«Як мені доїхати звідси туди містом?»</p>
            </article>

            <article className="support-how-card">
              <h3>2. Табло зупинки</h3>
              <p>
                <Link to="/transport/stop">/transport/stop</Link> — відправлення з конкретної точки
                на дату й орієнтовний час.
              </p>
              <p>Зручно вдома перед виходом і прямо на зупинці.</p>
              <p className="support-how-card__hint">У багатьох зупинок є картка «Про зупинку».</p>
            </article>

            <article className="support-how-card">
              <h3>3. Сторінка маршруту</h3>
              <p>
                <Link to="/transport">Каталог ліній</Link> → № маршруту.
              </p>
              <p>Напрямки «Туди / Назад», список зупинок, таблиця рейсів, проїзд.</p>
              <p className="support-how-card__hint">Коли вже стоїте на лінії й питаєте «куди вона везе?».</p>
            </article>
          </div>

          <aside className="support-callout support-callout--note" aria-label="Підказка">
            <p>
              <strong>Підказка.</strong> Міжміський бот @{TELEGRAM_BOT_USERNAME} бронює рейси Київ /
              Житомир / Коростень.
            </p>
            <p>Міський транспорт — на сайті. Бот тут не замінює табло зупинки.</p>
          </aside>
        </section>

        <section className="support-block" aria-labelledby="city-hubs">
          <h2 id="city-hubs">Зручні точки в місті</h2>
          <p>
            Не обов’язково знати всі коди зупинок.
            <br />
            Ось кілька «якорів», з яких зручно починати — далі планер або табло підкажуть решту.
          </p>

          <ul className="support-hub-chips">
            <li>
              <Link to="/transport/stop/st_0019">Залізничний вокзал</Link>
              <span>пересадка з поїзда</span>
            </li>
            <li>
              <Link to="/transport/stop/st_0054">Малинівський круг</Link>
              <span>центр ↔ схід</span>
            </li>
            <li>
              <Link to="/transport/stop/st_0070">пл. Соборна (біля РБК)</Link>
              <span>центр міста</span>
            </li>
            <li>
              <Link to="/transport/stop/st_0035">Лікарня</Link>
              <span>медицина</span>
            </li>
            <li>
              <Link to="/transport/stop/st_0072">Поліклініка</Link>
              <span>медицина</span>
            </li>
            <li>
              <Link to="/transport/stop/st_0062">Огієнка 65 (БАМ)</Link>
              <span>східний сектор</span>
            </li>
          </ul>

          <p>
            Повний каталог ліній і карта — на <Link to="/transport">транспорті Малина</Link>.
          </p>
        </section>

        <section className="support-block" aria-labelledby="city-fare">
          <h2 id="city-fare">Проїзд</h2>
          <div className="support-fare-chip" aria-label="Тариф 20 гривень">
            <span className="support-fare-chip__label">Тариф у сервісі</span>
            <span className="support-fare-chip__amount">
              20<span aria-hidden>₴</span>
            </span>
            <span className="support-fare-chip__meta">за поїздку · біля № лінії</span>
          </div>
          <p>
            Якщо виконком змінить тариф окремим рішенням — орієнтуйтеся на офіційне повідомлення.
            <br />
            Ми підтягнемо цифру в інтерфейсі.
          </p>
        </section>

        <section className="support-block" aria-labelledby="city-faq">
          <h2 id="city-faq">Часті питання</h2>
          <div className="support-faq">
            {CITY_TRANSPORT_FAQ.map((item) => (
              <div key={item.q} className="support-faq__item is-open">
                <div className="support-faq__q" role="heading" aria-level={3}>
                  {item.q}
                </div>
                <div className="support-faq__a">{item.a}</div>
              </div>
            ))}
          </div>
        </section>

        <aside className="support-callout support-callout--note">
          <p>
            Приїхали з Києва чи Житомира і далі треба містом?
          </p>
          <p>
            Спочатку <Link to={supportTopicPath('travel')}>міжміський гід</Link>, потім цей — і
            відкритий <Link to="/transport">планер</Link>.
          </p>
        </aside>
      </div>
    </ArticleChrome>
  );
}

function SiteArticle() {
  return (
    <ArticleChrome topicId="site">
      <p className="support-lead">
        Короткі «двері» в розділи сайту. Між містами —{' '}
        <Link to={supportTopicPath('travel')}>Як доїхати до Малина</Link>
        {' · '}
        <Link to={supportTopicPath('prices')}>Скільки коштує</Link>; містом —{' '}
        <Link to={supportTopicPath('transport')}>Транспорт Малина</Link>.
      </p>
      <div className="support-site-grid">
        <article className="support-site-card">
          <h2>Міжміські</h2>
          <p>Попутки й маршрутки Малин ↔ Київ, Житомир, Коростень — один пошук.</p>
          <Link to="/mizhgorodski">Відкрити →</Link>
        </article>
        <article className="support-site-card">
          <h2>Транспорт Малина</h2>
          <p>Планер, табло зупинок, розклад ліній — гід у допомозі.</p>
          <Link to="/transport">Відкрити →</Link>
          <span className="support-site-card__links">
            <Link to={supportTopicPath('transport')}>Як їздити містом</Link>
          </span>
        </article>
        <article className="support-site-card">
          <h2>Про нас</h2>
          <p>Реквізити, політика, умови, акція.</p>
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
    </ArticleChrome>
  );
}

function ReferralArticle() {
  return (
    <ArticleChrome topicId="referral">
      <p className="support-lead">
        Команда <code>/invite</code>: умови, персональне посилання, «Поділитися» (inline), копіювання, запрошення за
        номером / @username, статистика.
      </p>
      <ul className="support-list">
        <li>
          Друг: посилання → <code>/start</code> → номер → попутка як водій або пасажир.
        </li>
        <li>
          Бонуси (деталі — у <Link to={REFERRAL_PROMO_PAGE_LINK}>офіційних умовах</Link>): участь ~10 грн, поїздки
          пасажира ~20 грн (обом), кваліфікація водія ~40 грн.
        </li>
        <li>Виплата після модерації фото. Блок бота → бонуси на паузі, доки не <code>/start</code>.</li>
        <li>
          <strong>Не можна</strong> запросити себе другим номером з того самого Telegram.
        </li>
      </ul>
      <p>
        Підтвердження поїздки: <Link to={`${supportTopicPath('bot')}#bot-confirm`}>/confirmride у гайді бота</Link>.
      </p>
    </ArticleChrome>
  );
}

function FaqArticle() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    return upsertJsonLd('support-faq-jsonld', {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ_PLAIN.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.aText },
      })),
    });
  }, []);

  return (
    <ArticleChrome topicId="faq">
      <div className="support-faq">
        {FAQ_UI.map((item, i) => {
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
      <p className="support-muted">
        Не знайшли відповідь? <Link to={supportTopicPath('contact')}>Контакти</Link>.
      </p>
    </ArticleChrome>
  );
}

function ContactArticle() {
  return (
    <ArticleChrome topicId="contact">
      <p className="support-lead">
        Пишіть у бот або на контакти компанії. Для бронювання маршрутки зручно вказати дату й напрямок.
      </p>
      <p>
        Telegram:{' '}
        <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
          @{TELEGRAM_BOT_USERNAME}
        </a>
      </p>
      <SiteContactBlock title="" headingId="support-contact-details" />
    </ArticleChrome>
  );
}

export function SupportArticle() {
  const { topicId } = useParams<{ topicId: string }>();
  const location = useLocation();

  const seo = useMemo(() => {
    if (!isSupportTopicId(topicId)) {
      return {
        title: `Допомога | ${SITE_PUBLIC_DOMAIN}`,
        canonicalUrl: `https://${SITE_PUBLIC_DOMAIN}${SUPPORT_PATH}`,
      };
    }
    const meta = META[topicId];
    return {
      title: meta.title,
      description: meta.description,
      canonicalUrl: `https://${SITE_PUBLIC_DOMAIN}${supportTopicPath(topicId)}`,
    };
  }, [topicId]);

  usePageSeo(seo);

  useEffect(() => {
    if (!location.hash) return;
    const id = window.requestAnimationFrame(() => {
      document.getElementById(location.hash.replace('#', ''))?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [location.hash, topicId]);

  if (!isSupportTopicId(topicId)) {
    return <Navigate to={SUPPORT_PATH} replace />;
  }

  switch (topicId) {
    case 'start':
      return <StartArticle />;
    case 'travel':
      return <TravelArticle />;
    case 'prices':
      return <PricesArticle />;
    case 'transport':
      return <TransportArticle />;
    case 'bot':
      return <BotArticle />;
    case 'site':
      return <SiteArticle />;
    case 'referral':
      return <ReferralArticle />;
    case 'faq':
      return <FaqArticle />;
    case 'contact':
      return <ContactArticle />;
    default:
      return <Navigate to={SUPPORT_PATH} replace />;
  }
}
