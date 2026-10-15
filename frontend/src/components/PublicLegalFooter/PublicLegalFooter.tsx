import { Link } from 'react-router-dom';
import { SiteOwnerFooterLine } from '@/components/SiteOwnerFooterLine/SiteOwnerFooterLine';
import {
  COMPANY_DEVELOPER_PREFIX,
  COMPANY_FOOTER_SUFFIX,
  COMPANY_SHORT_NAME_UA,
  COMPANY_SITE_URL,
} from '@/legal/companyLegal';
import {
  PRIVACY_POLICY_PAGE_LINK,
  REFERRAL_PROMO_PAGE_LINK,
  TERMS_PAGE_LINK,
} from '@/legal/sitePublic';
import { SUPPORT_PATH } from '@/pages/SupportPage';
import './PublicLegalFooter.css';

export const PublicLegalFooter: React.FC = () => {
  return (
    <footer className="public-legal-footer" role="contentinfo">
      <div className="public-legal-footer-inner">
        <p className="public-legal-footer-line public-legal-footer-links">
          <Link to={SUPPORT_PATH} className="public-legal-footer-link">
            Допомога
          </Link>
          {' · '}
          <Link to={PRIVACY_POLICY_PAGE_LINK} className="public-legal-footer-link">
            Політика конфіденційності
          </Link>
          {' · '}
          <Link to={TERMS_PAGE_LINK} className="public-legal-footer-link">
            Умови користування
          </Link>
          {' · '}
          <Link to={REFERRAL_PROMO_PAGE_LINK} className="public-legal-footer-link">
            Акція «Приведи друга»
          </Link>
        </p>
        <SiteOwnerFooterLine
          paragraphClassName="public-legal-footer-line"
          linkClassName="public-legal-footer-link"
        />
        {/* Той самий власник, інший сайт: звичайне посилання без nofollow (SEO-план 4.6) */}
        <p className="public-legal-footer-line">
          {COMPANY_DEVELOPER_PREFIX}
          <a href={COMPANY_SITE_URL} className="public-legal-footer-link">
            {COMPANY_SHORT_NAME_UA}
          </a>
          {COMPANY_FOOTER_SUFFIX}
        </p>
      </div>
    </footer>
  );
};
