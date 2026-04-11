import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  companyEdrRecord,
  companyPhoneTelHref,
  COMPANY_EXECUTIVE_OFFICIAL_TITLE,
} from '@/legal/companyLegal';
import './CompanyLegalPage.css';

export const CompanyLegalPage: React.FC = () => {
  useEffect(() => {
    const prev = document.title;
    document.title = 'Про нас — реквізити · ЄДР';
    return () => {
      document.title = prev;
    };
  }, []);

  const c = companyEdrRecord;
  const tel = companyPhoneTelHref(c.phone);

  return (
    <div className="company-legal-page">
      <div className="company-legal-card">
        <h1 className="company-legal-title">Про нас</h1>

        <section className="company-legal-section" aria-labelledby="name-heading">
          <h2 id="name-heading" className="company-legal-h2">
            Найменування
          </h2>
          <dl className="company-legal-dl">
            <div>
              <dt>Повна назва</dt>
              <dd>{c.fullNameUa}</dd>
            </div>
            <div>
              <dt>Коротка назва (скорочене найменування)</dt>
              <dd>{c.shortNameUa}</dd>
            </div>
            <div>
              <dt>Повна назва англійською</dt>
              <dd>{c.fullNameEn}</dd>
            </div>
            <div>
              <dt>Організаційно-правова форма</dt>
              <dd>{c.legalForm}</dd>
            </div>
            <div>
              <dt>Код ЄДРПОУ</dt>
              <dd>{c.edrpou}</dd>
            </div>
          </dl>
        </section>

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

        <section className="company-legal-section" aria-labelledby="contact-heading">
          <h2 id="contact-heading" className="company-legal-h2">
            Контактна інформація
          </h2>
          <dl className="company-legal-dl">
            <div>
              <dt>Електронна пошта</dt>
              <dd>
                <a href={`mailto:${c.email}`} className="company-legal-external">
                  {c.email}
                </a>
              </dd>
            </div>
            <div>
              <dt>Телефон</dt>
              <dd>
                {tel ? (
                  <a href={tel} className="company-legal-external">
                    +{c.phone.replace(/^\+?/, '')}
                  </a>
                ) : (
                  c.phone
                )}
              </dd>
            </div>
          </dl>
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
