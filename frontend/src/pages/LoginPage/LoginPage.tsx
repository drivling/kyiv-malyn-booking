import { useState } from 'react';
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

export const LoginPage: React.FC = () => {
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<'admin' | 'telegram'>('admin');
  const navigate = useNavigate();

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
    
    // Якщо номер телефону вже вказаний
    if (phone) {
      userState.loginTelegram(user, phone);
      navigate('/', { state: { telegramPhone: phone } });
    } else {
      // Перенаправляємо на головну з даними користувача
      // Користувач має ввести номер на сторінці бронювання
      userState.loginTelegram(user, '');
      navigate('/', { state: { telegramUser: user } });
    }
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
    navigate('/', { state: { telegramPhone: phone } });
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <h2>🔐 Авторизація</h2>
        
        <div className="login-mode-tabs">
          <button
            className={`mode-tab ${loginMode === 'admin' ? 'active' : ''}`}
            onClick={() => setLoginMode('admin')}
          >
            👨‍💼 Адмін панель
          </button>
          <button
            className={`mode-tab ${loginMode === 'telegram' ? 'active' : ''}`}
            onClick={() => setLoginMode('telegram')}
          >
            📱 Вхід через Telegram
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
              Увійдіть через Telegram щоб автоматично заповнювати номер телефону при бронюванні
            </p>
            
            <div className="telegram-login-options">
              <div className="telegram-widget-container">
                <TelegramLoginButton
                  botUsername={TELEGRAM_BOT_USERNAME}
                  onAuth={handleTelegramAuth}
                  buttonSize="large"
                  requestAccess={true}
                />
              </div>
              
              <div className="divider">
                <span>або</span>
              </div>
              
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
                  Увійти з номером
                </Button>
              </div>
            </div>
          </div>
        )}
        
        {error && <Alert variant="error">{error}</Alert>}
      </div>
    </div>
  );
};
