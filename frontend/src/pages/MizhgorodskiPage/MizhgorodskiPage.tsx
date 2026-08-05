import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BookingCity } from '@/utils/constants';
import { BOOKING_CITY_LABELS, BOOKING_FROM_TO, getDirectionFromCities } from '@/utils/constants';
import {
  CORRIDORS,
  citiesFromCorridor,
  cityLabel,
  corridorFromCity,
  todayISO,
  type CorridorId,
  type TransportFilter,
} from './mizhUtils';
import './MizhgorodskiPage.css';

const VALID_CITIES: BookingCity[] = ['Kyiv', 'Malyn', 'Zhytomyr', 'Korosten'];

function parseCity(value: string | null): BookingCity | '' {
  if (!value) return '';
  return VALID_CITIES.includes(value as BookingCity) ? (value as BookingCity) : '';
}

export const MizhgorodskiPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialFrom = parseCity(searchParams.get('from')) || 'Kyiv';
  const initialTo = parseCity(searchParams.get('to')) || 'Malyn';
  const initialDate = searchParams.get('date') || todayISO();

  const [fromCity, setFromCity] = useState<BookingCity>(
    getDirectionFromCities(initialFrom || 'Kyiv', initialTo || 'Malyn') ? (initialFrom as BookingCity) : 'Kyiv'
  );
  const [toCity, setToCity] = useState<BookingCity>(
    getDirectionFromCities(initialFrom || 'Kyiv', initialTo || 'Malyn') ? (initialTo as BookingCity) : 'Malyn'
  );
  const [date, setDate] = useState(initialDate);
  const [transport, setTransport] = useState<TransportFilter>('all');
  const [hasSearched, setHasSearched] = useState(
    Boolean(searchParams.get('from') && searchParams.get('to'))
  );

  const activeCorridor: CorridorId | null = useMemo(() => {
    return corridorFromCity(fromCity === 'Malyn' ? toCity : fromCity);
  }, [fromCity, toCity]);

  const fromOptions = (Object.entries(BOOKING_CITY_LABELS) as [BookingCity, string][]).map(([value, label]) => ({
    value,
    label,
  }));

  const toOptions = BOOKING_FROM_TO.filter((p) => p.from === fromCity).map((p) => ({
    value: p.to,
    label: BOOKING_CITY_LABELS[p.to],
  }));

  const applySearch = (nextFrom = fromCity, nextTo = toCity, nextDate = date) => {
    if (!getDirectionFromCities(nextFrom, nextTo)) return;
    setSearchParams(
      {
        from: nextFrom,
        to: nextTo,
        date: nextDate,
      },
      { replace: true }
    );
    setHasSearched(true);
  };

  const handleCorridor = (corridor: CorridorId) => {
    const fromMalyn = fromCity === 'Malyn';
    const { from, to } = citiesFromCorridor(corridor, fromMalyn);
    setFromCity(from);
    setToCity(to);
    applySearch(from, to, date);
  };

  const handleSwap = () => {
    const nextFrom = toCity;
    const nextTo = fromCity;
    if (!getDirectionFromCities(nextFrom, nextTo)) return;
    setFromCity(nextFrom);
    setToCity(nextTo);
    applySearch(nextFrom, nextTo, date);
  };

  const handleFromChange = (value: BookingCity) => {
    setFromCity(value);
    const stillValid = BOOKING_FROM_TO.some((p) => p.from === value && p.to === toCity);
    if (!stillValid) {
      const first = BOOKING_FROM_TO.find((p) => p.from === value);
      if (first) setToCity(first.to);
    }
  };

  return (
    <div className="mizh-page">
      <header className="mizh-hero">
        <div className="mizh-hero-inner">
          <div className="mizh-hero-top">
            <div>
              <h1 className="mizh-brand">Міжміські</h1>
              <p className="mizh-brand-sub">
                Попутки та маршрутки Малин — Київ, Житомир, Коростень в одному пошуку
              </p>
            </div>
            <button type="button" className="mizh-offer-btn" disabled title="Зʼявиться в наступній ітерації">
              Запропонувати поїздку
            </button>
          </div>

          <form
            className="mizh-search"
            onSubmit={(e) => {
              e.preventDefault();
              applySearch();
            }}
          >
            <div className="mizh-corridors" role="group" aria-label="Коридори">
              {CORRIDORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`mizh-corridor-chip ${activeCorridor === c.id ? 'mizh-corridor-chip--active' : ''}`}
                  onClick={() => handleCorridor(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="mizh-search-row">
              <label className="mizh-field">
                <span className="mizh-field-label">Звідки</span>
                <select
                  className="mizh-field-control"
                  value={fromCity}
                  onChange={(e) => handleFromChange(e.target.value as BookingCity)}
                >
                  {fromOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="mizh-swap-btn"
                onClick={handleSwap}
                aria-label="Поміняти місцями"
                title="Поміняти місцями"
              >
                ⇄
              </button>

              <label className="mizh-field">
                <span className="mizh-field-label">Куди</span>
                <select
                  className="mizh-field-control"
                  value={toCity}
                  onChange={(e) => setToCity(e.target.value as BookingCity)}
                >
                  {toOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mizh-field">
                <span className="mizh-field-label">Коли</span>
                <input
                  type="date"
                  className="mizh-field-control"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>

              <button type="submit" className="mizh-search-submit">
                Шукати
              </button>
            </div>
            <p className="mizh-search-hint">Усі маршрути проходять через Малин — оберіть коридор чипом або міста вручну.</p>
          </form>
        </div>
      </header>

      <div className="mizh-body">
        <div className="mizh-toolbar">
          <div className="mizh-transport-tabs" role="tablist" aria-label="Тип транспорту">
            {(
              [
                { id: 'all', label: 'Усі' },
                { id: 'carpool', label: 'Попутки' },
                { id: 'bus', label: 'Маршрутки' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={transport === tab.id}
                className={`mizh-transport-tab ${transport === tab.id ? 'mizh-transport-tab--active' : ''}`}
                onClick={() => setTransport(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="mizh-stats">
            {hasSearched ? (
              <>
                {cityLabel(fromCity)} → {cityLabel(toCity)} · {date}
              </>
            ) : (
              'Оберіть маршрут і натисніть «Шукати»'
            )}
          </div>
        </div>

        <section className="mizh-placeholder" aria-live="polite">
          <h2>Результати зʼявляться тут</h2>
          <p>
            Ітерація 1: оболонка сторінки, навігація та пошуковий блок у стилі BlaBlaCar.
            Далі — обʼєднаний список попуток і маршруток з різними картками.
          </p>
          {hasSearched && (
            <div className="mizh-placeholder-meta">
              <span className="mizh-pill">{cityLabel(fromCity)} → {cityLabel(toCity)}</span>
              <span className="mizh-pill">{date}</span>
              <span className="mizh-pill">
                {transport === 'all' ? 'Усі' : transport === 'carpool' ? 'Попутки' : 'Маршрутки'}
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
