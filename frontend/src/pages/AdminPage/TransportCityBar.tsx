import React from 'react';
import { TRANSPORT_CITY_PARAM, isDefaultTransportCity, transportCityOptions } from '@/site/transportCity';
import './TransportCityBar.css';

/**
 * Вибір міста над транспортними вкладками адмінки. Для не-головного міста — яскравий банер, щоб Малин не
 * відредагувати замість Коростеня й навпаки, і посилання на перегляд публічних сторінок міста до запуску.
 */
export const TransportCityBar: React.FC<{ city: string; onChange: (city: string) => void }> = ({ city, onChange }) => {
  const options = transportCityOptions();
  const other = !isDefaultTransportCity(city);
  const name = options.find((o) => o.cityCode === city)?.name ?? city;
  return (
    <div className={`transport-city-bar${other ? ' transport-city-bar--other' : ''}`} role="region" aria-label="Місто транспорту">
      <label className="transport-city-bar-select">
        <span>Місто транспорту</span>
        <select value={city} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.cityCode} value={o.cityCode}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      {other && (
        <>
          <strong className="transport-city-bar-banner">Редагуєте: {name.toUpperCase()}</strong>
          <a
            className="transport-city-bar-preview"
            href={`/transport?${TRANSPORT_CITY_PARAM}=${encodeURIComponent(city)}`}
            target="_blank"
            rel="noreferrer"
          >
            Переглянути сторінки міста ↗
          </a>
        </>
      )}
    </div>
  );
};
