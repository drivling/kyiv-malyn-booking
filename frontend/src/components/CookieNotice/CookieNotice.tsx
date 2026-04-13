import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { COOKIE_NOTICE_STORAGE_KEY } from '@/analytics/cookieConsent';
import { PRIVACY_POLICY_PAGE_LINK } from '@/legal/sitePublic';
import './CookieNotice.css';

export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage.getItem(COOKIE_NOTICE_STORAGE_KEY) !== '1') {
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(COOKIE_NOTICE_STORAGE_KEY, '1');
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
          Сайт використовує cookies та Google Analytics згідно з{' '}
          <Link to={PRIVACY_POLICY_PAGE_LINK} className="cookie-notice__link">
            політикою конфіденційності
          </Link>
          . Продовжуючи перегляд, ви погоджуєтеся з цим.
        </p>
        <button type="button" className="cookie-notice__btn" onClick={dismiss}>
          Зрозуміло
        </button>
      </div>
    </div>
  );
}
