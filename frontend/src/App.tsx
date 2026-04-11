import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { BookingPage } from '@/pages/BookingPage';
import { AdminPage } from '@/pages/AdminPage';
import { LoginPage } from '@/pages/LoginPage';
import { PoputkyPage } from '@/pages/PoputkyPage';
import { LocalTransportPage } from '@/pages/LocalTransportPage';
import { LocalTransportStopBoardPage } from '@/pages/LocalTransportPage/LocalTransportStopBoardPage';
import { UserPage } from '@/pages/UserPage';
import { CompanyLegalPage } from '@/pages/CompanyLegalPage/CompanyLegalPage';
import { ProtectedRoute, ProtectedTelegramRoute } from '@/components/ProtectedRoute';
import { PublicLegalFooter } from '@/components/PublicLegalFooter/PublicLegalFooter';
import { COMPANY_LEGAL_PATH } from '@/legal/companyLegal';
import { apiClient } from '@/api/client';
import { userState } from '@/utils/userState';
import './App.css';

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

/** Глобальний підвал з реквізитами; на головній / попутках свій об’єднаний підвал у PoputkyPage */
function showGlobalPublicLegalFooter(pathname: string): boolean {
  if (!isPublicSitePath(pathname)) return false;
  if (pathname === '/' || pathname === '/poputky') return false;
  return true;
}

function AppContent() {
  const { pathname } = useLocation();
  const showPublicLegalFooter = showGlobalPublicLegalFooter(pathname);

  return (
    <div className="app">
      <NavBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<PoputkyPage />} />
          <Route path="/poputky" element={<PoputkyPage />} />
          <Route path="/booking" element={<BookingPage />} />
          <Route path="/localtransport/route/:routeId" element={<LocalTransportPage />} />
          <Route path="/localtransport/stop/:stopSlug" element={<LocalTransportStopBoardPage />} />
          <Route path="/localtransport/stop" element={<LocalTransportStopBoardPage />} />
          <Route path="/localtransport/:fromStop/:toStop" element={<LocalTransportPage />} />
          <Route path="/localtransport" element={<LocalTransportPage />} />
          <Route path={COMPANY_LEGAL_PATH} element={<CompanyLegalPage />} />
          <Route path="/user" element={<ProtectedTelegramRoute><UserPage /></ProtectedTelegramRoute>} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
      {showPublicLegalFooter ? <PublicLegalFooter /> : null}
    </div>
  );
}

function NavBar() {
  const navigate = useNavigate();
  const currentUser = userState.get();
  const isAdmin = userState.isAdmin();
  const isTelegramUser = userState.isTelegramUser();

  const handleLogout = () => {
    userState.logout();
    apiClient.setAuthToken(null);
    navigate('/');
  };

  return (
    <nav className="app-nav">
      <div className="nav-left">
        <Link to="/" className="nav-link">
          🚗 Попутки
        </Link>
        <Link to="/booking" className="nav-link">
          🚌 Маршрутки
        </Link>
        <Link to="/localtransport" className="nav-link">
          🚏 Транспорт Малина
        </Link>
        <Link to={COMPANY_LEGAL_PATH} className="nav-link">
          Про нас
        </Link>
      </div>

      <div className="nav-right">
        {isAdmin ? (
          <>
            <Link to="/admin" className="nav-link">
              👨‍💼 Адмін панель
            </Link>
            <button 
              onClick={handleLogout} 
              className="nav-link nav-button"
              title="Вийти з адмін панелі"
            >
              🚪 Вийти
            </button>
          </>
        ) : isTelegramUser ? (
          <>
            <Link to="/user" className="nav-link nav-user-info">
              {currentUser?.type === 'telegram' && currentUser.phone ? (
                <>📱 {currentUser.phone}</>
              ) : currentUser?.type === 'telegram' && currentUser.user.first_name ? (
                <>👤 {currentUser.user.first_name}</>
              ) : (
                <>👤 Telegram User</>
              )}
            </Link>
            <button 
              onClick={handleLogout} 
              className="nav-link nav-button"
              title="Вийти з Telegram акаунту"
            >
              Вийти
            </button>
          </>
        ) : (
          <Link to="/login" className="nav-link">
            🔑 Логін
          </Link>
        )}
      </div>
    </nav>
  );
}

export default App;
