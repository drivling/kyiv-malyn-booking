import { Link } from 'react-router-dom';
import { SiteOwnerFooterLine } from '@/components/SiteOwnerFooterLine/SiteOwnerFooterLine';
import { PRIVACY_POLICY_PAGE_LINK } from '@/legal/sitePublic';
import './PublicLegalFooter.css';

export const PublicLegalFooter: React.FC = () => {
  return (
    <footer className="public-legal-footer" role="contentinfo">
      <div className="public-legal-footer-inner">
        <p className="public-legal-footer-line public-legal-footer-links">
          <Link to={PRIVACY_POLICY_PAGE_LINK} className="public-legal-footer-link">
            Політика конфіденційності
          </Link>
        </p>
        <SiteOwnerFooterLine
          paragraphClassName="public-legal-footer-line"
          linkClassName="public-legal-footer-link"
        />
      </div>
    </footer>
  );
};
