import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SiteContactBlock } from '@/components/SiteContactBlock/SiteContactBlock';
import {
  COMPANY_EDR_INFO_URL,
  companyEdrRecord,
  COMPANY_LEGAL_ADDRESS_UA,
  COMPANY_LEGAL_ADDRESS_SHORT_UA,
  COMPANY_CITY_UA,
  COMPANY_EXECUTIVE_OFFICIAL_TITLE,
  COMPANY_FOOTER_PREFIX,
  COMPANY_FOOTER_SUFFIX,
} from '@/legal/companyLegal';
import { PRIVACY_SECTION_ID, SITE_PUBLIC_DOMAIN, TERMS_SECTION_ID } from '@/legal/sitePublic';
import './privacyPolicyContent.css';
import './CompanyLegalPage.css';

export const CompanyLegalPage: React.FC = () => {
  const location = useLocation();
  const [isFullAddressVisible, setIsFullAddressVisible] = useState(false);

  useEffect(() => {
    const prev = document.title;
    document.title = `Про нас | ${SITE_PUBLIC_DOMAIN}`;
    return () => {
      document.title = prev;
    };
  }, []);

  useEffect(() => {
    const legalHashes = new Set([`#${PRIVACY_SECTION_ID}`, `#${TERMS_SECTION_ID}`]);
    if (!legalHashes.has(location.hash)) return;
    const id = window.requestAnimationFrame(() => {
      const targetId = location.hash.replace('#', '');
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [location.hash, location.pathname]);

  const c = companyEdrRecord;

  return (
    <div className="company-legal-page">
      <div className="company-legal-card company-legal-card--wide">
        <h1 className="company-legal-title">Про нас</h1>

        <div className="company-legal-highlight" aria-labelledby="company-legal-block-title">
          <div className="company-legal-highlight__head">
            <h2 id="company-legal-block-title" className="company-legal-highlight__title">
              Юридична інформація
            </h2>
            <a
              href={COMPANY_EDR_INFO_URL}
              className="company-legal-external company-legal-external--pill"
              target="_blank"
              rel="noopener noreferrer"
            >
              Перевірити в ЄДР / Opendatabot
            </a>
          </div>
          <p className="company-legal-highlight__hint">
            Офіційні реєстраційні дані компанії у публічному державному реєстрі.
          </p>
          <dl className="company-legal-dl company-legal-dl--tight">
            <div>
              <dt>Повна назва</dt>
              <dd>{c.fullNameUa}</dd>
            </div>
            <div>
              <dt>Скорочена назва</dt>
              <dd>{c.shortNameUa}</dd>
            </div>
            <div>
              <dt>Повна назва англійською</dt>
              <dd>{c.fullNameEn}</dd>
            </div>
            <div>
              <dt>Код ЄДРПОУ</dt>
              <dd>{c.edrpou}</dd>
            </div>
            <div>
              <dt>Юридична адреса</dt>
              <dd>
                <div className="company-legal-address-surface">
                  <div className="company-legal-address-row">
                    <div className="company-legal-address-copy">
                      <p className="company-legal-address-short">{COMPANY_LEGAL_ADDRESS_SHORT_UA}</p>
                    </div>
                    <button
                      type="button"
                      className="company-legal-address-toggle"
                      aria-expanded={isFullAddressVisible}
                      aria-controls="company-legal-full-address"
                      onClick={() => setIsFullAddressVisible((prev) => !prev)}
                    >
                      <span>{isFullAddressVisible ? 'Згорнути' : 'Повна адреса'}</span>
                      <span
                        aria-hidden="true"
                        className={`company-legal-address-toggle-icon ${isFullAddressVisible ? 'is-open' : ''}`}
                      >
                        ▾
                      </span>
                    </button>
                  </div>
                  <p
                    id="company-legal-full-address"
                    className={`company-legal-address-full ${isFullAddressVisible ? 'is-visible' : ''}`}
                    aria-hidden={!isFullAddressVisible}
                  >
                    {COMPANY_LEGAL_ADDRESS_UA}
                  </p>
                </div>
              </dd>
            </div>
            <div>
              <dt>Місто</dt>
              <dd>{COMPANY_CITY_UA}</dd>
            </div>
          </dl>
        </div>

        <section className="company-legal-section" aria-labelledby="gov-heading">
          <h2 id="gov-heading" className="company-legal-h2">
            Керівництво
          </h2>
          <dl className="company-legal-dl">
            <div>
              <dt>{COMPANY_EXECUTIVE_OFFICIAL_TITLE}</dt>
              <dd>{c.generalDirectorName}</dd>
            </div>
            <div>
              <dt>Засновник</dt>
              <dd>{c.founderName}</dd>
            </div>
          </dl>
        </section>

        <SiteContactBlock
          className="company-legal-contact-wrap"
          headingId="contact-block-heading"
          title="Контакти"
        />

        <div id={PRIVACY_SECTION_ID} className="company-legal-privacy">
          <h2 className="privacy-policy-title privacy-policy-title--section">Політика конфіденційності</h2>
          <p className="privacy-policy-lead privacy-policy-lead--owner">
            {COMPANY_FOOTER_PREFIX}
            <strong>
              {c.shortNameUa}, код ЄДРПОУ {c.edrpou}
            </strong>
            {COMPANY_FOOTER_SUFFIX}
          </p>
          <p className="privacy-policy-lead">
            Тут просто і прозоро пояснюємо, які дані збирає сайт <strong>{SITE_PUBLIC_DOMAIN}</strong>, на яких
            підставах ми їх обробляємо, як довго зберігаємо та які права має користувач.
          </p>

          <section className="privacy-policy-section" aria-labelledby="privacy-who">
            <h2 id="privacy-who">Хто ми</h2>
            <p>
              Оператор персональних даних — це саме товариство, реквізити якого наведено в розділі «Юридична
              інформація» вище на цій сторінці.
            </p>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-collect">
            <h2 id="privacy-collect">Які дані ми збираємо</h2>
            <ul className="privacy-policy-list">
              <li>
                <strong>Імʼя або нікнейм</strong> — якщо ви вказуєте ці дані у профілі чи формі.
              </li>
              <li>
                <strong>Телефон та email</strong> — для встановлення контакту між користувачами та сервісних повідомлень.
              </li>
              <li>
                <strong>Дані оголошень</strong> — маршрут, час, коментарі та інша інформація, яку ви публікуєте.
              </li>
              <li>
                <strong>Технічні дані і cookie</strong> — IP-адреса, тип пристрою/браузера, мова, дата і час відвідувань,
                технічні журнали, cookie-файли.
              </li>
            </ul>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-why">
            <h2 id="privacy-why">Правові підстави і мета обробки</h2>
            <ul className="privacy-policy-list">
              <li>
                <strong>Згода</strong> — коли ви добровільно надаєте дані у формах, профілі або приймаєте cookie.
              </li>
              <li>
                <strong>Виконання договору</strong> — для надання доступу до функцій платформи та сервісної комунікації.
              </li>
              <li>
                <strong>Законний інтерес</strong> — для безпеки, захисту від шахрайства, стабільної роботи та аналітики.
              </li>
              <li>
                <strong>Мета</strong> — забезпечити роботу платформи, встановлення контакту між користувачами,
                модерацію контенту, підтримку, покращення сервісу та виконання вимог законодавства України.
              </li>
            </ul>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-legal">
            <h2 id="privacy-legal">Передача даних і міжнародна передача</h2>
            <p>
              Ми не продаємо персональні дані. Дані можуть отримувати лише підрядники, які забезпечують роботу сайту:
              хостинг-провайдери та сервіси аналітики (зокрема Google Analytics).
            </p>
            <p>
              У звʼязку з використанням Google Analytics частина технічних даних може передаватися компанії Google LLC
              (США). Така передача здійснюється лише в обсязі, необхідному для аналітики та покращення сервісу.
            </p>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-cookies">
            <h2 id="privacy-cookies">Файли cookie та аналітика</h2>
            <p>
              Cookie потрібні для коректної роботи сайту, збереження базових налаштувань і веб-аналітики. Користуючись
              сайтом, ви погоджуєтеся на використання cookie.
            </p>
            <p>
              Ви можете вимкнути або обмежити cookie у браузері. У такому разі частина функцій може працювати
              некоректно.
            </p>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-retention">
            <h2 id="privacy-retention">Строки зберігання</h2>
            <ul className="privacy-policy-list">
              <li>дані акаунта та оголошень — протягом користування сервісом і до 3 років після видалення;</li>
              <li>звернення до підтримки — до 3 років;</li>
              <li>технічні журнали безпеки — до 12 місяців;</li>
              <li>cookie — до строку дії конкретного cookie або до його видалення користувачем.</li>
            </ul>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-security">
            <h2 id="privacy-security">Захист даних</h2>
            <p>
              Ми застосовуємо розумні організаційні та технічні заходи, щоб уберегти інформацію від втрати,
              несанкціонованого доступу чи зловживання. Жоден вебсервіс не може гарантувати абсолютну безпеку, але
              ми ставимося до захисту даних серйозно.
            </p>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-rights">
            <h2 id="privacy-rights">Ваші права</h2>
            <p>Ви можете:</p>
            <ul className="privacy-policy-list">
              <li>дізнатися, чи обробляємо ми ваші персональні дані та в якому обсязі;</li>
              <li>вимагати виправлення неточних даних;</li>
              <li>в певних випадках — вимагати видалення або обмеження обробки;</li>
              <li>відкликати згоду на обробку, якщо обробка ґрунтується на згоді.</li>
            </ul>
            <p>
              Щоб надіслати запит, напишіть на{' '}
              <a href={`mailto:${c.email}`} className="privacy-policy-link">
                {c.email}
              </a>
              . Ми відповімо протягом розумного строку після перевірки, що запит надходить від вас (інколи можемо
              попросити мінімальні дані для ідентифікації).
            </p>
            <p>
              Надаючи номер телефону на платформі, ви надаєте згоду на контакт щодо користування сервісом та
              домовленостей між користувачами (дзвінок, SMS, повідомлення в месенджері).
            </p>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-age">
            <h2 id="privacy-age">Вікове обмеження</h2>
            <p>
              Сервіс призначений для користувачів віком 18+. Якщо вам менше 18 років, користування можливе лише за
              згодою законного представника.
            </p>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-changes">
            <h2 id="privacy-changes">Зміни до політики</h2>
            <p>
              Ми можемо час від часу оновлювати цей текст — наприклад, якщо з’являться нові функції сайту або зміниться
              законодавство. Актуальна версія для домену <strong>{SITE_PUBLIC_DOMAIN}</strong> завжди в розділі
              «Політика конфіденційності» на цій сторінці.
            </p>
          </section>
        </div>

        <section id={TERMS_SECTION_ID} className="company-legal-section" aria-labelledby="terms-heading">
          <h2 id="terms-heading" className="company-legal-h2">
            Умови користування
          </h2>
          <p>
            Платформа <strong>{SITE_PUBLIC_DOMAIN}</strong> є виключно інформаційним сервісом для встановлення контакту
            між користувачами щодо спільних поїздок. Сервіс не є перевізником, не надає транспортних послуг і не є
            стороною домовленостей між користувачами.
          </p>
          <ul className="privacy-policy-list">
            <li>
              <strong>Відповідальність користувачів:</strong> користувачі самостійно узгоджують умови поїздки, оплату,
              місце зустрічі та інші деталі домовленості.
            </li>
            <li>
              <strong>Власний ризик:</strong> користувачі самостійно оцінюють надійність один одного та відповідають за
              особисту безпеку під час будь-яких взаємодій.
            </li>
            <li>
              <strong>Без гарантій:</strong> сервіс не гарантує доступність платформи, достовірність оголошень,
              фактичне виконання домовленостей чи безпечність поїздок.
            </li>
            <li>
              <strong>Обмеження відповідальності:</strong> у максимальному обсязі, дозволеному законодавством України,
              сервіс не несе відповідальності за дії/бездіяльність користувачів, включно з водіями і пасажирами, а
              також за прямі чи непрямі збитки, повʼязані з використанням платформи.
            </li>
            <li>
              <strong>Правила користування:</strong> заборонено шахрайство, фейкові оголошення, незаконна діяльність,
              порушення прав третіх осіб і розміщення протиправного контенту.
            </li>
            <li>
              <strong>Модерація:</strong> сервіс має право видаляти контент і блокувати користувачів у разі порушення
              цих умов або вимог закону.
            </li>
            <li>
              <strong>Вирішення спорів:</strong> спори вирішуються шляхом переговорів, а за неможливості — у судах
              України за законодавством України.
            </li>
            <li>
              <strong>Вік:</strong> користування сервісом дозволене з 18 років або за згодою законного представника.
            </li>
          </ul>
        </section>

        <section className="company-legal-highlight" aria-labelledby="disclaimer-heading">
          <h2 id="disclaimer-heading" className="company-legal-highlight__title">
            Важливий дисклеймер
          </h2>
          <p>
            Сервіс не несе відповідальності за дії або бездіяльність користувачів, включно з водіями та пасажирами, а
            також за наслідки будь-яких домовленостей між ними. Кожен користувач діє самостійно, на власний ризик і
            під власну відповідальність.
          </p>
        </section>

        <p className="company-legal-back">
          <Link to="/" className="company-legal-back-link">
            На головну
          </Link>
        </p>
      </div>
    </div>
  );
};
