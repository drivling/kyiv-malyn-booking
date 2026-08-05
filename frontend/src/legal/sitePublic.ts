import { COMPANY_LEGAL_PATH } from '@/legal/companyLegal';

/** Домен сервісу (для згадок у текстах) */
export const SITE_PUBLIC_DOMAIN = 'malin.kiev.ua';

/** Публічний help-center */
export const SUPPORT_PAGE_PATH = '/support';

/** id розділу політики на сторінці «Про нас» */
export const PRIVACY_SECTION_ID = 'privacy-policy';
export const TERMS_SECTION_ID = 'terms-of-use';
export const REFERRAL_PROMO_SECTION_ID = 'referral-promo';

/** Посилання на розділ політики конфіденційності (одна сторінка з «Про нас») */
export const PRIVACY_POLICY_PAGE_LINK = `${COMPANY_LEGAL_PATH}#${PRIVACY_SECTION_ID}`;
export const TERMS_PAGE_LINK = `${COMPANY_LEGAL_PATH}#${TERMS_SECTION_ID}`;
export const REFERRAL_PROMO_PAGE_LINK = `${COMPANY_LEGAL_PATH}#${REFERRAL_PROMO_SECTION_ID}`;
export const SUPPORT_PAGE_LINK = SUPPORT_PAGE_PATH;
export const SUPPORT_BOT_GUIDE_LINK = `${SUPPORT_PAGE_PATH}/bot`;
export const SUPPORT_FAQ_LINK = `${SUPPORT_PAGE_PATH}/faq`;
export const SUPPORT_CONTACT_LINK = `${SUPPORT_PAGE_PATH}/contact`;
