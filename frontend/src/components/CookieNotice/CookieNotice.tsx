import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PRIVACY_POLICY_PAGE_LINK } from '@/legal/sitePublic';
import './CookieNotice.css';

const STORAGE_KEY = 'malin_kiev_ua_cookie_notice_v1';

export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) !== '1') {
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <div className="cookie-notice" role="dialog" aria-live="polite" aria-label="Повідомлення про cookies">
      <div className="cookie-notice__inner">
        <p className="cookie-notice__text">
          Ми використовуємо cookies для покращення роботи сайту. Детальніше — у{' '}
          <Link to={PRIVACY_POLICY_PAGE_LINK} className="cookie-notice__link">
            політиці конфіденційності
          </Link>{' '}
          на сторінці «Про нас».
        </p>
        <button type="button" className="cookie-notice__btn" onClick={dismiss}>
          Зрозуміло
        </button>
      </div>
    </div>
  );
}
