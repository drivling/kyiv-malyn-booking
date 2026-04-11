import { Link } from 'react-router-dom';
import {
  COMPANY_FOOTER_PREFIX,
  COMPANY_FOOTER_SUFFIX,
  companyFooterLinkLabel,
  COMPANY_LEGAL_PATH,
} from '@/legal/companyLegal';

type SiteOwnerFooterLineProps = {
  paragraphClassName: string;
  linkClassName: string;
};

export function SiteOwnerFooterLine({ paragraphClassName, linkClassName }: SiteOwnerFooterLineProps) {
  return (
    <p className={paragraphClassName}>
      {COMPANY_FOOTER_PREFIX}
      <Link to={COMPANY_LEGAL_PATH} className={linkClassName}>
        {companyFooterLinkLabel()}
      </Link>
      {COMPANY_FOOTER_SUFFIX}
    </p>
  );
}
