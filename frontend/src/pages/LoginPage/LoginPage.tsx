import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { userState } from '@/utils/userState';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Alert } from '@/components/Alert';
import { TelegramLoginButton } from '@/components/TelegramLoginButton';
import type { TelegramUser } from '@/types';
import './LoginPage.css';

const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'your_bot_username';

/** Парсинг Telegram user з query-параметрів (редірект після data-auth-url) */
function parseTelegramUserFromSearchParams(params: URLSearchParams): TelegramUser | null {
  const id = params.get('id');
  const authDate = params.get('auth_date');
  const hash = params.get('hash');
  const firstName = params.get('first_name');
  if (!id || !authDate || !hash || !firstName) return null;
  const idNum = parseInt(id, 10);
  const authDateNum = parseInt(authDate, 10);
  if (Number.isNaN(idNum) || Number.isNaN(authDateNum)) return null;
  return {
    id: idNum,
    first_name: firstName,
    last_name: params.get('last_name') ?? undefined,
    username: params.get('username') ?? undefined,
    photo_url: params.get('photo_url') ?? undefined,
    auth_date: authDateNum,
    hash,
  };
}

export const LoginPage: React.FC = () => {
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<'admin' | 'telegram'>('telegram');
  const navigate = useNavigate();

  // Обробка повернення з Telegram через redirect (data-auth-url): URL містить ?id=...&first_name=...&hash=...&auth_date=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const telegramUser = parseTelegramUserFromSearchParams(params);
    if (!telegramUser) return;
    userState.loginTelegram(telegramUser, telegramUser.phone || '');
    window.location.replace('/poputky');
  }, []);

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await apiClient.adminLogin(password);
      if (result.success && result.token) {
        userState.loginAdmin(result.token);
        apiClient.setAuthToken(result.token);
        navigate('/admin');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка авторизації');
    } finally {
      setLoading(false);
    }
  };

  const handleTelegramAuth = (user: TelegramUser) => {
    console.log('Telegram user authenticated:', user);
    
    // Пробуємо отримати номер з різних джерел
    const userPhone = phone || user.phone || '';
    
    if (userPhone) {
      userState.loginTelegram(user, userPhone);
    } else {
      userState.loginTelegram(user, '');
    }
    // Редірект на сторінку попуток через replace, щоб не залишати /login в історії.
    // Використовуємо window.location щоб гарантувати повне перезавантаження та оновлення стану в NavBar.
    window.location.replace('/poputky');
  };

  const handlePhoneLogin = () => {
    if (!phone || phone.length < 10) {
      setError('Будь ласка, введіть коректний номер телефону');
      return;
    }
    
    // Створюємо тимчасового користувача без Telegram даних
    const tempUser: TelegramUser = {
      id: 0,
      first_name: 'User',
      auth_date: Date.now(),
      hash: '',
      phone: phone
    };
    
    userState.loginTelegram(tempUser, phone);
    window.location.replace('/poputky');
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <h2>Увійти</h2>
        <span className="login-subtitle">Оберіть спосіб входу</span>

        <div className="login-mode-tabs">
          <button
            className={`mode-tab ${loginMode === 'telegram' ? 'active' : ''}`}
            onClick={() => setLoginMode('telegram')}
          >
            Telegram
          </button>
          <button
            className={`mode-tab ${loginMode === 'admin' ? 'active' : ''}`}
            onClick={() => setLoginMode('admin')}
          >
            Адмін
          </button>
        </div>

        {loginMode === 'admin' ? (
          <form onSubmit={handleAdminSubmit}>
            <Input
              label="Пароль адміністратора"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введіть пароль"
              required
              autoFocus
            />
            <Button type="submit" disabled={loading}>
              {loading ? 'Вхід...' : 'Увійти як адмін'}
            </Button>
          </form>
        ) : (
          <div className="telegram-login-section">
            <p className="login-description">
              Після входу ваш номер автоматично заповнюватиметься при бронюванні
            </p>

            <div className="telegram-login-options">
              <div className="login-option">
                <h3 className="option-title">Вхід через Telegram</h3>
                <p className="option-hint">Безпечно та швидко</p>
                <div className="telegram-widget-container">
                  <TelegramLoginButton
                    botUsername={TELEGRAM_BOT_USERNAME}
                    onAuth={handleTelegramAuth}
                    buttonSize="large"
                    requestAccess={true}
                  />
                </div>
              </div>
              
              <div className="divider">
                <span>або</span>
              </div>
              
              <div className="login-option">
                <h3 className="option-title">Вхід з номером телефону</h3>
                <p className="option-hint">Введіть номер вручну</p>
                <div className="manual-phone-login">
                  <Input
                    label="Номер телефону"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+380501234567"
                    pattern="^[\+\d\s\-\(\)]{10,}$"
                  />
                  <Button onClick={handlePhoneLogin}>
                    Увійти
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {error && <Alert variant="error">{error}</Alert>}
      </div>
    </div>
  );
};
