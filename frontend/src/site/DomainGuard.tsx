/**
 * Клієнтський двійник серверних 301 у scripts/serve-dist.mjs: адмінка, логін і кабінет
 * живуть тільки на головному домені (віджет Telegram Login прив'язаний до одного домену бота).
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getCurrentSite, isPrimaryOnlyPath, primaryUrl } from './siteConfig';

export const DomainGuard: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (getCurrentSite().isPrimary) return;
    if (!isPrimaryOnlyPath(location.pathname)) return;
    window.location.replace(primaryUrl(location.pathname, location.search));
  }, [location.pathname, location.search]);

  return null;
};
