/** Шлях сторінки з повними реквізитами з ЄДР */
export const COMPANY_LEGAL_PATH = '/about';

/** Коротка назва з ЄДР (для підвалу та згадок на сайті) */
export const COMPANY_SHORT_NAME_UA = 'ТОВ «Технології»';

/** Місто реєстрації / розташування для відображення на сайті */
export const COMPANY_CITY_UA = 'Малин, Україна';
export const COMPANY_LEGAL_ADDRESS_SHORT_UA = 'м. Малин, Житомирська обл.';
export const COMPANY_LEGAL_ADDRESS_UA =
  '11601, Україна, Житомирська обл., Коростенський р-н, м. Малин, вул. Володимирська, буд. 28А, кв. 12';
export const COMPANY_EDR_INFO_URL = 'https://opendatabot.com/c/46288273';

/** Посада керівника згідно зі статутом (єдиний виконавчий орган — генеральний директор) */
export const COMPANY_EXECUTIVE_OFFICIAL_TITLE = 'Генеральний директор';

export const companyEdrRecord = {
  shortNameUa: COMPANY_SHORT_NAME_UA,
  fullNameUa: 'ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ «Компанія Технології»',
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

/** Людськочитаний формат українського мобільного (+380 …) */
export function companyPhoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('380')) {
    return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  }
  if (d.length === 10 && d.startsWith('0')) {
    return `+38 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
  }
  return phone.startsWith('+') ? phone : `+${d}`;
}
