import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AdminPage } from '@/pages/AdminPage';
import { LoginPage } from '@/pages/LoginPage';
import { MizhgorodskiPage, CorridorLandingPage, ZubastykPage, AvtostantsiyaPage } from '@/pages/MizhgorodskiPage';
import { LocalTransportPage } from '@/pages/LocalTransportPage';
import { LocalTransportStopBoardPage } from '@/pages/LocalTransportPage/LocalTransportStopBoardPage';
import { LocalTransportSchemePage } from '@/pages/LocalTransportPage/LocalTransportSchemePage';
import { UserPage } from '@/pages/UserPage';
import { CompanyLegalPage } from '@/pages/CompanyLegalPage/CompanyLegalPage';
import { SupportLayout, SupportHub, SupportArticle, SUPPORT_PATH } from '@/pages/SupportPage';
import { StickerWallPage } from '@/pages/StickerWallPage';
import { GoogleAnalyticsTracker } from '@/analytics/GoogleAnalyticsTracker';
import { CookieNotice } from '@/components/CookieNotice/CookieNotice';
import { NavBar } from '@/components/NavBar';
import { ProtectedRoute, ProtectedTelegramRoute } from '@/components/ProtectedRoute';
import { PublicLegalFooter } from '@/components/PublicLegalFooter/PublicLegalFooter';
import { COMPANY_LEGAL_PATH } from '@/legal/companyLegal';
import { PRIVACY_POLICY_PAGE_LINK } from '@/legal/sitePublic';
import { DomainGuard, LocalTransportGate, useFreshBuild, useHomeCityHandoff } from '@/site';
import { useStickerReturn } from '@/pages/LocalTransportPage/stickerReturn';
import { useOutboxSync } from '@/pwa/outbox';
import { UpdateBanner } from '@/pwa/UpdateBanner';
import { useTransportServiceWorker } from '@/pwa/useTransportServiceWorker';
import './App.css';

// «Доведе» (Docs/dovede-roadmap.md): прихована сторінка за паролем запрошених — окремий чанк, не в головному бандлі
const DovedePage = lazy(() => import('@/pages/DovedePage/DovedePage'));

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

function isPublicSitePath(pathname: string): boolean {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return false;
  if (pathname === '/user' || pathname.startsWith('/user/')) return false;
  return true;
}

/** Глобальний підвал з реквізитами та посиланням на політику */
function showGlobalPublicLegalFooter(pathname: string): boolean {
  return isPublicSitePath(pathname);
}

function LocalTransportLegacyRedirect() {
  const location = useLocation();
  const nextPath = location.pathname.replace(/^\/localtransport/, '/transport') || '/transport';
  return <Navigate to={`${nextPath}${location.search}`} replace />;
}

function AppContent() {
  const { pathname } = useLocation();
  useHomeCityHandoff();
  // стара вкладка після деплою сама підтягує нову збірку (src/site/freshBuild.ts)
  useFreshBuild();
  // service worker застосунку «Як доїхати» — лише на /transport* (src/pwa, Docs/transport-pwa-2026-10.md)
  useTransportServiceWorker();
  // люди з QR-наклейок, що повертаються на сайт (stickerReturn.ts)
  useStickerReturn();
  // записи, що чекали на мережу (скани, повернення, факт прибуття) — src/pwa/outbox.ts
  useOutboxSync();
  const showPublicLegalFooter = showGlobalPublicLegalFooter(pathname);
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');
  const isDovede = pathname === '/dovede' || pathname === '/dovede/';
  // Віджет на стіну й «Доведе» — як окремі застосунки: без шапки сайту
  const isWidget = pathname === '/admin/wall' || isDovede;

  return (
    <div className={`app ${isAdminPath ? 'app--admin' : 'app--bbc'}`}>
      <GoogleAnalyticsTracker />
      <DomainGuard />
      {!isWidget && <NavBar />}
      <main className="app-main">
        <Routes>
          <Route path="/" element={<MizhgorodskiPage />} />
          <Route path="/mizhgorodski" element={<MizhgorodskiPage />} />
          <Route path="/mizhgorodski/:corridorSlug" element={<CorridorLandingPage />} />
          {/* Дзеркало 301 зі scripts/serve-dist-rules.mjs (EXACT_REDIRECTS): фільтр «Попутки» вибраний одразу */}
          <Route path="/poputky" element={<Navigate to="/mizhgorodski?type=carpool" replace />} />
          <Route path="/booking" element={<Navigate to="/mizhgorodski" replace />} />
          <Route path="/zubastyk" element={<ZubastykPage />} />
          <Route path="/zubustik" element={<Navigate to="/zubastyk" replace />} />
          <Route path="/avtostantsiya-malyn" element={<AvtostantsiyaPage />} />
          <Route path="/avtostantsiya" element={<Navigate to="/avtostantsiya-malyn" replace />} />
          <Route
            path="/transport/route/:routeId"
            element={<LocalTransportGate><LocalTransportPage /></LocalTransportGate>}
          />
          <Route
            path="/transport/stop/:stopSlug"
            element={<LocalTransportGate><LocalTransportStopBoardPage /></LocalTransportGate>}
          />
          <Route
            path="/transport/stop"
            element={<LocalTransportGate><LocalTransportStopBoardPage /></LocalTransportGate>}
          />
          <Route
            path="/transport/:fromStop/:toStop"
            element={<LocalTransportGate><LocalTransportPage /></LocalTransportGate>}
          />
          <Route
            path="/transport/scheme"
            element={<LocalTransportGate><LocalTransportSchemePage /></LocalTransportGate>}
          />
          <Route path="/transport" element={<LocalTransportGate><LocalTransportPage /></LocalTransportGate>} />
          <Route path="/localtransport/*" element={<LocalTransportLegacyRedirect />} />
          <Route path="/localtransport" element={<LocalTransportLegacyRedirect />} />
          <Route path={COMPANY_LEGAL_PATH} element={<CompanyLegalPage />} />
          <Route path={SUPPORT_PATH} element={<SupportLayout />}>
            <Route index element={<SupportHub />} />
            <Route path=":topicId" element={<SupportArticle />} />
          </Route>
          <Route path="/help" element={<Navigate to={SUPPORT_PATH} replace />} />
          <Route path="/privacy" element={<Navigate to={PRIVACY_POLICY_PAGE_LINK} replace />} />
          <Route path="/privacy-policy" element={<Navigate to={PRIVACY_POLICY_PAGE_LINK} replace />} />
          <Route path="/user" element={<ProtectedTelegramRoute><UserPage /></ProtectedTelegramRoute>} />
          <Route
            path="/dovede"
            element={
              <Suspense fallback={null}>
                <DovedePage />
              </Suspense>
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin/wall" element={<StickerWallPage />} />
          <Route
            path="/admin/:tab?"
            element={
              <ProtectedRoute>
                <AdminPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
      {/* підвал «під катом»: видно лише рядок розробника, решта — за кнопкою «Більше» */}
      {showPublicLegalFooter ? <PublicLegalFooter collapsible /> : null}
      {!pathname.startsWith('/admin') ? <CookieNotice /> : null}
      <UpdateBanner />
    </div>
  );
}

export default App;
