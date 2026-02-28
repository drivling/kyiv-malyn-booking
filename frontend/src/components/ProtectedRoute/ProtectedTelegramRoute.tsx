import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { userState } from '@/utils/userState';

interface ProtectedTelegramRouteProps {
  children: React.ReactNode;
}

/** Захист роуту: тільки для користувачів, залогінених через Telegram. Інакше — редірект на /login */
export const ProtectedTelegramRoute: React.FC<ProtectedTelegramRouteProps> = ({ children }) => {
  const navigate = useNavigate();
  const isTelegramUser = userState.isTelegramUser();

  useEffect(() => {
    if (!isTelegramUser) {
      navigate('/login', { replace: true });
    }
  }, [isTelegramUser, navigate]);

  if (!isTelegramUser) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '50vh',
        color: '#666',
        fontSize: 14,
      }}>
        Перенаправлення на логін...
      </div>
    );
  }

  return <>{children}</>;
};
