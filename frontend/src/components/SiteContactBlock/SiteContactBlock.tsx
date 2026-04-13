import {
  companyEdrRecord,
  companyPhoneDisplay,
  companyPhoneTelHref,
  COMPANY_CITY_UA,
} from '@/legal/companyLegal';
import './SiteContactBlock.css';

type SiteContactBlockProps = {
  className?: string;
  headingId?: string;
  /** Заголовок секції; якщо порожньо — блок без h2 */
  title?: string;
  compact?: boolean;
};

export function SiteContactBlock({
  className = '',
  headingId = 'site-contact-heading',
  title = 'Контакти',
  compact = false,
}: SiteContactBlockProps) {
  const tel = companyPhoneTelHref(companyEdrRecord.phone);
  const phoneLabel = companyPhoneDisplay(companyEdrRecord.phone);
  const email = companyEdrRecord.email;

  return (
    <section
      className={`site-contact-block ${compact ? 'site-contact-block--compact' : ''} ${className}`.trim()}
      aria-labelledby={title ? headingId : undefined}
    >
      {title ? (
        <h2 id={headingId} className="site-contact-block__title">
          {title}
        </h2>
      ) : null}
      <dl className="site-contact-block__dl">
        <div>
          <dt>Електронна пошта</dt>
          <dd>
            <a href={`mailto:${email}`} className="site-contact-block__link">
              {email}
            </a>
          </dd>
        </div>
        <div>
          <dt>Телефон</dt>
          <dd>
            {tel ? (
              <a href={tel} className="site-contact-block__link">
                {phoneLabel}
              </a>
            ) : (
              phoneLabel
            )}
          </dd>
        </div>
        <div>
          <dt>Місто</dt>
          <dd>{COMPANY_CITY_UA}</dd>
        </div>
      </dl>
    </section>
  );
}
