import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Alert } from '@/components/Alert';
import './LoginPage.css';

export const LoginPage: React.FC = () => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await apiClient.adminLogin(password);
      if (result.success && result.token) {
        apiClient.setAuthToken(result.token);
        navigate('/admin');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка авторизації');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <h2>🔐 Вхід в адмін панель</h2>
        <form onSubmit={handleSubmit}>
          <Input
            label="Пароль"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Введіть пароль"
            required
            autoFocus
          />
          <Button type="submit" disabled={loading}>
            {loading ? 'Вхід...' : 'Увійти'}
          </Button>
        </form>
        {error && <Alert variant="error">{error}</Alert>}
      </div>
    </div>
  );
};
