import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';

/**
 * Тиха перевірка адміна для таємних сторінок (перша — «Доведе», Docs/dovede-roadmap.md).
 * На відміну від ProtectedRoute не показує форму входу: не-адмін бачить порожню сторінку, як на будь-якій
 * неіснуючій адресі, а lazy-чанк сторінки навіть не завантажується. Справжній захист — requireAdmin на бекенді.
 */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(() => (apiClient.getAuthToken() ? null : false));

  useEffect(() => {
    if (allowed !== null) return;
    let alive = true;
    apiClient
      .checkAdminAuth()
      .then(() => alive && setAllowed(true))
      .catch(() => alive && setAllowed(false));
    return () => {
      alive = false;
    };
  }, [allowed]);

  return allowed ? <>{children}</> : null;
}
