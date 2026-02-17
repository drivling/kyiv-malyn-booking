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
  const [loginMode, setLoginMode] = useState<'admin' | 'telegram'>('telegram');
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
    
    // Пробуємо отримати номер з різних джерел
    const userPhone = phone || user.phone || '';
    
    if (userPhone) {
      // Якщо номер є - зберігаємо і перенаправляємо
      userState.loginTelegram(user, userPhone);
      navigate('/', { state: { telegramPhone: userPhone } });
    } else {
      // Якщо номера немає - зберігаємо користувача без номера
      // і показуємо повідомлення що потрібно ввести номер
      userState.loginTelegram(user, '');
      navigate('/', { state: { 
        telegramUser: user,
        needPhone: true 
      } });
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
            className={`mode-tab ${loginMode === 'telegram' ? 'active' : ''}`}
            onClick={() => setLoginMode('telegram')}
          >
            📱 Вхід через Telegram
          </button>
          <button
            className={`mode-tab ${loginMode === 'admin' ? 'active' : ''}`}
            onClick={() => setLoginMode('admin')}
          >
            👨‍💼 Адмін панель
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
              💡 Після входу ваш номер автоматично заповнюватиметься при бронюванні
            </p>
            
            <div className="telegram-login-options">
              <div className="login-option">
                <h3 className="option-title">🔐 Вхід через Telegram</h3>
                <p className="option-hint">Безпечний та швидкий спосіб</p>
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
                <h3 className="option-title">📱 Вхід з номером телефону</h3>
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
