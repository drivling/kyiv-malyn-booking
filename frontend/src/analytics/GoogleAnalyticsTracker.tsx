import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { ensureAndTrackPage, gaMeasurementId } from '@/analytics/googleAnalytics';

/**
 * Надсилає page_view при кожній зміні маршруту (GA4 для SPA). Заміна адреси зі станом
 * `{ gaSkip: true }` на тій самій сторінці — службова (зняли utm-мітку QR, stickerScan.ts), не новий
 * перегляд. Повернення на цей запис історії з іншої сторінки («назад») рахується як звичайно.
 */
export function GoogleAnalyticsTracker() {
  const location = useLocation();
  const id = gaMeasurementId();
  const lastPath = useRef<string | null>(null);
  const skip = Boolean((location.state as { gaSkip?: boolean } | null)?.gaSkip);

  useEffect(() => {
    if (!id) return;
    const samePage = lastPath.current === location.pathname;
    lastPath.current = location.pathname;
    if (skip && samePage) return;
    ensureAndTrackPage(location.pathname, location.search, location.hash);
  }, [id, skip, location.pathname, location.search, location.hash]);

  return null;
}
