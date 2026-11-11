import { exitTransportPreview, transportCityOptions } from './transportCity';
import './TransportPreviewBanner.css';

/**
 * Смуга над сторінками транспорту, коли адмін переглядає місто до запуску (?transportCity=, фаза 6 плану
 * Коростеня). Вихід — звичайна сторінка сайту: чистимо перегляд і перезавантажуємо без параметра, щоб кеші
 * датасету й номерів маршрутів не лишились від міста перегляду.
 */
export const TransportPreviewBanner: React.FC<{ city: string }> = ({ city }) => {
  const name = transportCityOptions().find((o) => o.cityCode === city)?.name ?? city;
  const exit = () => {
    exitTransportPreview();
    window.location.assign(window.location.pathname);
  };
  return (
    <div className="lt-preview-banner" role="status">
      <span>
        Перегляд транспорту: <strong>{name}</strong> — ще не опубліковано, бачите лише ви
      </span>
      <button type="button" className="lt-preview-banner-exit" onClick={exit}>
        Вийти з перегляду
      </button>
    </div>
  );
};
