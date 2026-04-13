/** Той самий ключ, що й у CookieNotice — згода на cookies (включно з аналітикою) */
export const COOKIE_NOTICE_STORAGE_KEY = 'malin_kiev_ua_cookie_notice_v1';

export const COOKIE_CONSENT_GRANTED_EVENT = 'malin:cookie-consent-granted';

export function hasCookieConsent(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function dispatchCookieConsentGranted(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(COOKIE_CONSENT_GRANTED_EVENT));
}
