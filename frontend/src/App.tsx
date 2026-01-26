import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { BookingPage } from '@/pages/BookingPage';
import { AdminPage } from '@/pages/AdminPage';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <nav className="app-nav">
          <Link to="/" className="nav-link">
            Бронювання
          </Link>
          <Link to="/admin" className="nav-link">
            Адмін панель
          </Link>
        </nav>

        <Routes>
          <Route path="/" element={<BookingPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
