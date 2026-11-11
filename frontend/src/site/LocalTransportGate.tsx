/**
 * Локальний транспорт існує не в кожному місті (галочка «є локальний транспорт» в адмінці):
 * там, де його ще нема (напр. Коростень), показуємо заглушку «скоро» замість планувальника.
 * Адмін може переглянути транспорт міста до запуску (?city=, фаза 6 плану Коростеня):
 * тоді сторінки відкриваються зі смугою «Перегляд».
 */
import { useEffect } from 'react';
import { LocalTransportSoon } from '@/pages/LocalTransportPage/LocalTransportSoon';
import { TransportPreviewBanner } from './TransportPreviewBanner';
import { rememberTransportPreview, transportPreviewCity } from './transportCity';
import { useSiteLocalTransport } from './useSiteLocalTransport';

export const LocalTransportGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { enabled, loading } = useSiteLocalTransport();
  const previewCity = transportPreviewCity();

  useEffect(() => {
    rememberTransportPreview();
  }, []);

  if (previewCity) {
    return (
      <>
        <TransportPreviewBanner city={previewCity} />
        {children}
      </>
    );
  }

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
