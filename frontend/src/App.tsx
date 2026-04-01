import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { BookingPage } from '@/pages/BookingPage';
import { AdminPage } from '@/pages/AdminPage';
import { LoginPage } from '@/pages/LoginPage';
import { PoputkyPage } from '@/pages/PoputkyPage';
import { LocalTransportPage } from '@/pages/LocalTransportPage';
import { LocalTransportStopBoardPage } from '@/pages/LocalTransportPage/LocalTransportStopBoardPage';
import { UserPage } from '@/pages/UserPage';
import { ProtectedRoute, ProtectedTelegramRoute } from '@/components/ProtectedRoute';
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

function AppContent() {
  return (
    <div className="app">
      <NavBar />
      <Routes>
        <Route path="/" element={<PoputkyPage />} />
        <Route path="/poputky" element={<PoputkyPage />} />
        <Route path="/booking" element={<BookingPage />} />
        <Route path="/localtransport/route/:routeId" element={<LocalTransportPage />} />
        <Route path="/localtransport/stop/:stopSlug" element={<LocalTransportStopBoardPage />} />
        <Route path="/localtransport/stop" element={<LocalTransportStopBoardPage />} />
        <Route path="/localtransport/:fromStop/:toStop" element={<LocalTransportPage />} />
        <Route path="/localtransport" element={<LocalTransportPage />} />
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
