import { SiteOwnerFooterLine } from '@/components/SiteOwnerFooterLine/SiteOwnerFooterLine';
import './PublicLegalFooter.css';

export const PublicLegalFooter: React.FC = () => {
  return (
    <footer className="public-legal-footer" role="contentinfo">
      <div className="public-legal-footer-inner">
        <SiteOwnerFooterLine
          paragraphClassName="public-legal-footer-line"
          linkClassName="public-legal-footer-link"
        />
      </div>
    </footer>
  );
};
