import { useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ensureAndTrackPage, gaMeasurementId } from '@/analytics/googleAnalytics';

/** Надсилає page_view при кожній зміні маршруту (GA4 для SPA). */
export function GoogleAnalyticsTracker() {
  const location = useLocation();
  const id = gaMeasurementId();

  const track = useCallback(() => {
    if (!id) return;
    ensureAndTrackPage(location.pathname, location.search, location.hash);
  }, [id, location.pathname, location.search, location.hash]);

  useEffect(() => {
    track();
  }, [track]);

  return null;
}
