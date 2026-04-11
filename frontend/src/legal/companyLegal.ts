/** Шлях сторінки з повними реквізитами з ЄДР */
export const COMPANY_LEGAL_PATH = '/about';

/** Коротка назва з ЄДР (для підвалу та згадок на сайті) */
export const COMPANY_SHORT_NAME_UA = 'ТОВ «Технології»';

/** Посада керівника згідно зі статутом (єдиний виконавчий орган — генеральний директор) */
export const COMPANY_EXECUTIVE_OFFICIAL_TITLE = 'Генеральний директор';

export const companyEdrRecord = {
  shortNameUa: COMPANY_SHORT_NAME_UA,
  fullNameUa: 'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ "Компанія Технології"',
  fullNameEn: 'LIMITED LIABILITY COMPANY "Technologies"',
  legalForm: 'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ',
  edrpou: '46288273',
  generalDirectorName: 'Меренков Сергій Іванович',
  founderName: 'Меренков Сергій Іванович',
  email: 'mer.sergei@me.com',
  phone: '380679551952',
} as const;

/** Текст підвалу до клікабельної частини (назва + ЄДРПОУ) */
export const COMPANY_FOOTER_PREFIX = 'Власник сайту та сервісу — ';

/** Текст після клікабельної частини */
export const COMPANY_FOOTER_SUFFIX = '.';

export function companyFooterLinkLabel(): string {
  return `${companyEdrRecord.shortNameUa}, код ЄДРПОУ ${companyEdrRecord.edrpou}`;
}

export function companyPhoneTelHref(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits ? `tel:+${digits.replace(/^\+?/, '')}` : '';
}
