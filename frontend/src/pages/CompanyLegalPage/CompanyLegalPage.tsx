import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SiteContactBlock } from '@/components/SiteContactBlock/SiteContactBlock';
import {
  companyEdrRecord,
  COMPANY_CITY_UA,
  COMPANY_EXECUTIVE_OFFICIAL_TITLE,
  COMPANY_FOOTER_PREFIX,
  COMPANY_FOOTER_SUFFIX,
} from '@/legal/companyLegal';
import { PRIVACY_SECTION_ID, SITE_PUBLIC_DOMAIN } from '@/legal/sitePublic';
import './privacyPolicyContent.css';
import './CompanyLegalPage.css';

export const CompanyLegalPage: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    const prev = document.title;
    document.title = `Про нас | ${SITE_PUBLIC_DOMAIN}`;
    return () => {
      document.title = prev;
    };
  }, []);

  useEffect(() => {
    if (location.hash !== `#${PRIVACY_SECTION_ID}`) return;
    const id = window.requestAnimationFrame(() => {
      document.getElementById(PRIVACY_SECTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [location.hash, location.pathname]);

  const c = companyEdrRecord;

  return (
    <div className="company-legal-page">
      <div className="company-legal-card company-legal-card--wide">
        <h1 className="company-legal-title">Про нас</h1>

        <div className="company-legal-highlight" aria-labelledby="company-legal-block-title">
          <h2 id="company-legal-block-title" className="company-legal-highlight__title">
            Юридична інформація
          </h2>
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
            Далі пояснюємо, які дані може збирати сайт <strong>{SITE_PUBLIC_DOMAIN}</strong>, навіщо ми це робимо та
            як ви можете скористатися своїми правами. Формулюємо простою мовою, без зайвої бюрократичної
            термінології.
          </p>

          <section className="privacy-policy-section" aria-labelledby="privacy-who">
            <h2 id="privacy-who">Хто ми</h2>
            <p>
              Оператор персональних даних — це саме товариство, реквізити якого наведено в розділі «Юридична
              інформація» вище на цій сторінці.
            </p>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-collect">
            <h2 id="privacy-collect">Які дані ми можемо збирати</h2>
            <ul className="privacy-policy-list">
              <li>
                <strong>Ім’я або псевдонім</strong> — якщо ви вказуєте їх у формах, чатах або профілі (наприклад,
                ім’я в Telegram).
              </li>
              <li>
                <strong>Адреса електронної пошти</strong> — якщо ви залишаєте її для зворотного зв’язку або
                реєстрації.
              </li>
              <li>
                <strong>Номер телефону</strong> — якщо ви вводите його у формах бронювання, оголошень попуток або
                інших місцях, де потрібен контакт.
              </li>
              <li>
                <strong>Технічні дані та cookies</strong> — наприклад, тип браузера, мова інтерфейсу, приблизний
                регіон (якщо його передає пристрій), час відвідування. Частина з цього надходить автоматично під час
                роботи сайту.
              </li>
              <li>
                <strong>Знеособлена аналітика</strong> — якщо ми підключаємо інструменти на кшталт Google Analytics,
                вони можуть фіксувати загальну статистику відвідувань (сторінки, тривалість сесії тощо) без
                ідентифікації конкретної особи там, де це налаштовано відповідно до правил сервісу.
              </li>
            </ul>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-why">
            <h2 id="privacy-why">Навіщо ми обробляємо дані</h2>
            <ul className="privacy-policy-list">
              <li>
                <strong>Зв’язок із вами</strong> — відповісти на запит, підтвердити бронювання, надіслати важливе
                повідомлення щодо сервісу; за потреби ми можемо зателефонувати, надіслати SMS або повідомлення в
                месенджері на номер, який ви залишили, якщо це потрібно саме для цих цілей і в межах надання
                сервісу.
              </li>
              <li>
                <strong>Надання та покращення сервісу</strong> — щоб форми, розклади та інші функції працювали
                стабільно і зручно.
              </li>
              <li>
                <strong>Аналітика</strong> — зрозуміти, як користуються сайтом, і зробити його зручнішим (за
                наявності відповідних інструментів).
              </li>
            </ul>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-legal">
            <h2 id="privacy-legal">Передача даних третім особам</h2>
            <p>
              Ми <strong>не продаємо</strong> ваші персональні дані і <strong>не передаємо</strong> їх третім особам
              для їхнього маркетингу. Доступ можуть мати лише ті підрядники або сервіси, які потрібні для технічної
              роботи сайту (хостинг, аналітика тощо), у межах їхніх угод про обробку даних і лише в обсязі,
              необхідному для функціонування сервісу.
            </p>
            <p>
              Виняток — випадки, коли ми зобов’язані надати інформацію на законних підставах (наприклад, за рішенням
              суду або запитом уповноважених державних органів відповідно до чинного законодавства України).
            </p>
          </section>

          <section className="privacy-policy-section" aria-labelledby="privacy-cookies">
            <h2 id="privacy-cookies">Файли cookie та аналітика</h2>
            <p>
              Сайт може використовувати файли cookie та подібні технології, щоб запам’ятовувати налаштування,
              підтримувати сесію або збирати знеособлену статистику. Якщо підключено <strong>Google Analytics</strong>{' '}
              або інші сервіси аналітики, вони працюють згідно з політиками конфіденційності відповідних компаній; ми
              намагаємося використовувати лише ті режими, що відповідають вимогам щодо захисту даних.
            </p>
            <p>Ви можете вимкнути або обмежити cookie в налаштуваннях свого браузера.</p>
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
              Якщо ви залишили номер телефону під час користування сервісом, ми можемо зв’язатися з вами дзвінком,
              SMS або через месенджер лише у зв’язку з наданням цього сервісу — наприклад, щоб уточнити бронювання,
              оголошення або відповісти на ваш запит. Номер не використовується для сторонньої реклами чи розсилок
              несервісного характеру без вашої окремої згоди.
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

        <p className="company-legal-back">
          <Link to="/" className="company-legal-back-link">
            На головну
          </Link>
        </p>
      </div>
    </div>
  );
};
