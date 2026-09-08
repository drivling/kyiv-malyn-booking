import { COMPANY_LEGAL_PATH } from '@/legal/companyLegal';
import { getCurrentSite, SITE_DOMAINS } from '@/site/siteConfig';

/** Головний домен сервісу (канонікали, згадки за замовчуванням) */
export const SITE_PUBLIC_DOMAIN = 'malin.kiev.ua';

/** Домен, на якому користувач зараз (malin.kiev.ua або korosten.kiev.ua) */
export function currentSiteDomain(): string {
  return getCurrentSite().domain;
}

/** Один Telegram-бот на всі домени сервісу */
export const TELEGRAM_BOT_USERNAME =
  import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'malin_kiev_ua_bot';
export const TELEGRAM_BOT_URL = `https://t.me/${TELEGRAM_BOT_USERNAME}`;

/** Усі домени сервісу одним рядком: «malin.kiev.ua і korosten.kiev.ua» */
export function siteDomainsLabel(): string {
  if (SITE_DOMAINS.length < 2) return SITE_DOMAINS[0] ?? SITE_PUBLIC_DOMAIN;
  return `${SITE_DOMAINS.slice(0, -1).join(', ')} і ${SITE_DOMAINS[SITE_DOMAINS.length - 1]}`;
}

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
