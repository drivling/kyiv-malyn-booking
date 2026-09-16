import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { COMPANY_LEGAL_PATH } from '@/legal/companyLegal';
import { SUPPORT_PATH } from '@/pages/SupportPage';
import { getCurrentSite } from '@/site';
import { apiClient } from '@/api/client';
import { userState } from '@/utils/userState';
import './NavBar.css';

function PersonIcon() {
  return (
    <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="nav-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 8l4 4-4 4M18 12H9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Шапка сайту. На телефоні (≤767px) — один рядок: ліві посилання прокручуються по горизонталі
 * (праворуч — підказка-градієнт, поки є ще), праві дії — іконки з aria-label. Висота шапки —
 * `--app-nav-height` (index.css), від неї рахують висоту сторінки транспорт/адмінка/логін.
 */
export function NavBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const currentUser = userState.get();
  const isAdmin = userState.isAdmin();
  const isTelegramUser = userState.isTelegramUser();
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');

  // Чи є ще посилання праворуч за краєм (лише мобільна прокрутка): вмикає градієнт-підказку
  const leftRef = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);
  useEffect(() => {
    const el = leftRef.current;
    if (!el) return;
    const update = () => setMoreRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 2);
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [pathname]);

  const handleLogout = () => {
    userState.logout();
    apiClient.setAuthToken(null);
    navigate('/mizhgorodski');
  };

  const telegramLabel =
    currentUser?.type === 'telegram' && currentUser.phone
      ? currentUser.phone
      : currentUser?.type === 'telegram' && currentUser.user.first_name
        ? currentUser.user.first_name
        : 'Telegram User';

  return (
    <nav className={`app-nav ${isAdminPath ? 'app-nav--admin' : 'app-nav--bbc'}`} aria-label="Головне меню">
      <div ref={leftRef} className={`nav-left ${moreRight ? 'nav-left--more' : ''}`}>
        <Link to="/mizhgorodski" className="nav-link nav-brand">
          Міжміські
        </Link>
        <Link to="/transport" className="nav-link">
          Транспорт<span className="nav-link-city"> {getCurrentSite().cityNameUkGenitive}</span>
        </Link>
        <Link to={COMPANY_LEGAL_PATH} className="nav-link">
          Про нас
        </Link>
        <Link to={SUPPORT_PATH} className="nav-link">
          Допомога
        </Link>
      </div>

      <div className="nav-right">
        {isAdmin ? (
          <>
            <Link to="/admin" className="nav-link nav-link--admin">
              Адмін панель
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="nav-link nav-button nav-link--icon"
              title="Вийти з адмін панелі"
              aria-label="Вийти"
            >
              <LogoutIcon />
              <span className="nav-link-text">Вийти</span>
            </button>
          </>
        ) : isTelegramUser ? (
          <>
            <Link
              to="/user"
              className="nav-link nav-user-info nav-link--icon"
              title={`Мій профіль: ${telegramLabel}`}
              aria-label={`Мій профіль: ${telegramLabel}`}
            >
              <PersonIcon />
              <span className="nav-link-text">{telegramLabel}</span>
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="nav-link nav-button nav-link--icon"
              title="Вийти з Telegram акаунту"
              aria-label="Вийти"
            >
              <LogoutIcon />
              <span className="nav-link-text">Вийти</span>
            </button>
          </>
        ) : (
          <Link to="/login" className="nav-link nav-link--icon" title="Логін" aria-label="Логін">
            <PersonIcon />
            <span className="nav-link-text">Логін</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
