import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { BookingPage } from '@/pages/BookingPage';
import { AdminPage } from '@/pages/AdminPage';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiClient } from '@/api/client';
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
        <Route path="/" element={<BookingPage />} />
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
  const isAuthenticated = !!apiClient.getAuthToken();

  const handleLogout = () => {
    apiClient.setAuthToken(null);
    navigate('/');
  };

  return (
    <nav className="app-nav">
      <Link to="/" className="nav-link">
        Бронювання
      </Link>
      {isAuthenticated ? (
        <>
          <Link to="/admin" className="nav-link">
            Адмін панель
          </Link>
          <button 
            onClick={handleLogout} 
            className="nav-link"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Вийти
          </button>
        </>
      ) : (
        <Link to="/admin" className="nav-link">
          Адмін панель
        </Link>
      )}
    </nav>
  );
}

export default App;
