/**
 * Локальний транспорт існує не в кожному місті (галочка «є локальний транспорт» в адмінці):
 * там, де його ще нема (напр. Коростень), показуємо заглушку «скоро» замість планувальника.
 */
import { LocalTransportSoon } from '@/pages/LocalTransportPage/LocalTransportSoon';
import { useSiteLocalTransport } from './useSiteLocalTransport';

export const LocalTransportGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { enabled, loading } = useSiteLocalTransport();

  if (loading) {
    return (
      <div className="lt-page">
        <div className="lt-container">
          <p className="lt-loading">Завантаження...</p>
        </div>
      </div>
    );
  }

  return enabled ? <>{children}</> : <LocalTransportSoon />;
};
