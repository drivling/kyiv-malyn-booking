import { useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { COOKIE_CONSENT_GRANTED_EVENT, hasCookieConsent } from '@/analytics/cookieConsent';
import { ensureAndTrackPage, gaMeasurementId } from '@/analytics/googleAnalytics';

/**
 * Після згоди на cookies: ініціалізує GA4 і надсилає page_view на кожну зміну маршруту (SPA).
 */
export function GoogleAnalyticsTracker() {
  const location = useLocation();
  const id = gaMeasurementId();

  const track = useCallback(() => {
    if (!id) return;
    if (!hasCookieConsent()) return;
    ensureAndTrackPage(location.pathname, location.search, location.hash);
  }, [id, location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!id) return;
    const onConsent = () => track();
    window.addEventListener(COOKIE_CONSENT_GRANTED_EVENT, onConsent);
    return () => window.removeEventListener(COOKIE_CONSENT_GRANTED_EVENT, onConsent);
  }, [id, track]);

  useEffect(() => {
    track();
  }, [track]);

  return null;
}
