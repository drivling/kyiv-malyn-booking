import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Combobox } from '@/components/Combobox';
import type { TransportData } from './types';
import {
  buildRoutesFromData,
  buildStopsList,
  buildStopDepartures,
  formatMinsClock,
} from './stopDepartures';
import { LocalTransportSubNav } from './LocalTransportSubNav';
import { isVerifiedRoute } from './routeTiming';
import './LocalTransportPage.css';

const DATA_URL = '/data/malyn_transport.json';

/** Як у LocalTransportPage — узгодження назви з URL і списком */
function normalizeStopNameForMatch(s: string): string {
  let t = s
    .replace(/^з-д\s+/i, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();
  t = t.replace(/^["«»]|["«»]$/g, '').trim();
  t = t.replace(/Проектор/gi, 'Прожектор');
  return t;
}

function findMatchingStop(urlValue: string, names: string[]): string | null {
  if (!urlValue) return null;
  if (names.includes(urlValue)) return urlValue;
  const norm = (s: string) => s.replace(/["«»]/g, '"').replace(/Проектор/gi, 'Прожектор');
  const nUrl = norm(urlValue);
  let found =
    names.find((n) => norm(n) === nUrl) ??
    names.find((n) => n.includes('Прожектор') && urlValue.includes('Проектор')) ??
    null;
  if (found) return found;
  const normalizedInput = normalizeStopNameForMatch(urlValue);
  if (!normalizedInput) return null;
  return (
    names.find((n) => normalizeStopNameForMatch(n) === normalizedInput) ??
    names.find((n) => norm(n) === normalizedInput) ??
    null
  );
}

function formatDateUrl(date: Date): string {
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = String(date.getFullYear()).slice(-2);
  return `${d.toString().padStart(2, '0')}.${m.toString().padStart(2, '0')}.${y}`;
}

function parseDateUrl(s: string): Date | null {
  const m = s?.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  const [, day, month, year] = m;
  const y = year.length === 2 ? 2000 + parseInt(year, 10) : parseInt(year, 10);
  const d = new Date(y, parseInt(month, 10) - 1, parseInt(day, 10));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Браузерний `<input type="time">`: HH:mm:ss; Safari/локалі — крапка замість двокрапки; Unicode.
 * Для стану й URL завжди `HH:mm`.
 */
function normalizeTimeInput(s: string): string {
  if (!s?.trim()) return '';
  let x = s.trim();
  x = x.replace(/[\u200B-\u200D\uFEFF]/g, '');
  x = x.replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
  x = x.replace(/\s/g, '');
  let m = x.match(/^(\d{1,2})[\u003A\uFF1A\uFE55\uFF0E\.](\d{2})(?::\d{2})?/);
  if (!m && /^\d{4}$/.test(x)) {
    m = [x, x.slice(0, 2), x.slice(2)] as unknown as RegExpMatchArray;
  }
  if (!m) return '';
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

/** Хвилини з опівночі (опорний час для табло). */
function parseClockToMins(s: string): number {
  const t = normalizeTimeInput(s);
  if (t) {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 3 && digits.length <= 4) {
    const pad = digits.length === 3 ? `0${digits}` : digits;
    const h = Math.min(23, parseInt(pad.slice(0, 2), 10));
    const min = Math.min(59, parseInt(pad.slice(2), 10));
    if (!Number.isNaN(h) && !Number.isNaN(min)) return h * 60 + min;
  }
  return 0;
}

/** Поточний час у Києві (хвилини від півночі) — як у LocalTransportPage */
function getKyivMinutesNow(): number {
  const str = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
  });
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

function getKyivCalendarDate(): { d: number; m: number; y: number } {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, mo, d] = s.split('-').map((x) => parseInt(x, 10));
  return { d, m: mo, y };
}

/** Чи обрана дата в полі збігається з «сьогодні» за календарем Києва */
function isSearchDateTodayKyiv(searchDateStr: string): boolean {
  const m = searchDateStr?.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return false;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  const k = getKyivCalendarDate();
  return day === k.d && month === k.m && year === k.y;
}

export const LocalTransportStopBoardPage: React.FC = () => {
  const { stopSlug } = useParams<{ stopSlug?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [data, setData] = useState<TransportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const dParam = searchParams.get('d') ?? '';
  const hParam = searchParams.get('h') ?? '';

  const [searchDate, setSearchDate] = useState(() => dParam || formatDateUrl(new Date()));
  const [searchTime, setSearchTime] = useState(() => {
    const fromUrl = hParam ? normalizeTimeInput(hParam) : '';
    if (fromUrl) return fromUrl;
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  });

  const [selectedStop, setSelectedStop] = useState('');
  /** Показати повний день замість «з обраного часу» */
  const [showFullDay, setShowFullDay] = useState(false);
  /** Оновлення «через N хв» раз на хвилину (київський час) */
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const kyivNowMins = useMemo(() => getKyivMinutesNow(), [nowTick]);

  useEffect(() => {
    fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: TransportData) => {
        if (!json?.records) throw new Error('Невірний формат даних');
        setData(json);
      })
      .catch((err) => setError(err.message || 'Не вдалося завантажити дані'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (dParam) setSearchDate(dParam);
  }, [dParam]);

  useEffect(() => {
    if (!hParam) return;
    const n = normalizeTimeInput(hParam);
    if (n) setSearchTime(n);
  }, [hParam]);

  const routes = useMemo(() => (data ? buildRoutesFromData(data) : []), [data]);
  const stopsByRoute = data?.supplement?.stops?.stops_by_route;
  const stops = useMemo(() => buildStopsList(routes, stopsByRoute), [routes, stopsByRoute]);

  const decodedSlug = stopSlug ? decodeURIComponent(stopSlug) : '';
  const matchedStopName = useMemo(() => {
    if (!decodedSlug || !stops.length) return '';
    return findMatchingStop(decodedSlug, stops) ?? '';
  }, [decodedSlug, stops]);

  useEffect(() => {
    if (matchedStopName) setSelectedStop(matchedStopName);
  }, [matchedStopName]);

  useEffect(() => {
    setShowFullDay(false);
  }, [matchedStopName]);

  const referenceMins = useMemo(() => parseClockToMins(searchTime), [searchTime]);

  const departures = useMemo(() => {
    if (!selectedStop || !stopsByRoute) return [];
    return buildStopDepartures(selectedStop, routes, stopsByRoute);
  }, [selectedStop, routes, stopsByRoute]);

  /** За замовчуванням — лише рейси з обраного часу або пізніше (як «наступні відправлення»). */
  const visibleDepartures = useMemo(() => {
    if (!departures.length || showFullDay) return departures;
    return departures.filter((r) => r.departureMins >= referenceMins);
  }, [departures, showFullDay, referenceMins]);

  /** Підсвітка: у режимі «з часу» — перший рядок; у «весь день» — перший ≥ часу. */
  const highlightIndex = useMemo(() => {
    if (!visibleDepartures.length) return -1;
    if (!showFullDay) return 0;
    const idx = visibleDepartures.findIndex((r) => r.departureMins >= referenceMins);
    return idx >= 0 ? idx : -1;
  }, [visibleDepartures, showFullDay, referenceMins]);

  const syncUrl = (stop: string, date: string, time: string) => {
    const params = new URLSearchParams();
    if (date) params.set('d', date.trim());
    const hNorm = normalizeTimeInput(time);
    if (hNorm) params.set('h', hNorm);
    const search = params.toString() ? `?${params.toString()}` : '';
    const pathname = stop ? `/localtransport/stop/${encodeURIComponent(stop)}` : '/localtransport/stop';
    navigate({ pathname, search }, { replace: true });
  };

  const handleStopChange = (v: string) => {
    setSelectedStop(v);
    setShowFullDay(false);
    const t = normalizeTimeInput(searchTime);
    setSearchTime(t);
    syncUrl(v, searchDate, t);
  };

  const handleDateTimeApply = () => {
    setShowFullDay(false);
    const d = searchDate.trim();
    const t = normalizeTimeInput(searchTime);
    setSearchDate(d);
    setSearchTime(t || searchTime);
    if (selectedStop) syncUrl(selectedStop, d, t);
    else {
      const params = new URLSearchParams();
      if (d) params.set('d', d);
      if (t) params.set('h', t);
      const search = params.toString() ? `?${params.toString()}` : '';
      navigate({ pathname: '/localtransport/stop', search }, { replace: true });
    }
  };

  const fare = data?.supplement?.fare ? `${data.supplement.fare.amount} грн` : null;

  if (loading) {
    return (
      <div className="lt-page lt-theme-jakdojade lt-layout-dark">
        <div className="lt-container">
          <p className="lt-loading">Завантаження...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="lt-page lt-theme-jakdojade lt-layout-dark">
        <div className="lt-container">
          <div className="lt-error">
            <p>{error || 'Дані не завантажені'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lt-page lt-theme-jakdojade lt-layout-dark">
      <div className="lt-container lt-split-layout">
        <div className="lt-panel">
          <header className="lt-header lt-header--jakdojade">
            <h1 className="lt-title">Як доїхати</h1>
            <p className="lt-subtitle">Малин · місцевий транспорт</p>
          </header>

          <LocalTransportSubNav searchDate={searchDate} searchTime={searchTime} />

          <section className="lt-stop-board-intro lt-stop-board-intro--jd" aria-labelledby="lt-stop-board-h">
            <h2 id="lt-stop-board-h" className="lt-section-title lt-stop-board-title lt-stop-board-title--jd">
              Розклад з зупинки
            </h2>
            <p className="lt-stop-board-lead">
              Наступні відправлення в усіх напрямках. Якщо дата збігається з сьогоднішньою (Київ), зліва — зворотний
              відлік «через скільки хвилин» до відправлення. Натисніть картку, щоб відкрити маршрут.
            </p>
          </section>

          <div className="lt-search lt-search--jakdojade lt-stop-board-search">
            <div className="lt-from-to-block">
              <div className="lt-from-to-row lt-stop-board-row">
                <div className="lt-from-to-cell lt-from-to-cell--from" style={{ flex: 1 }}>
                  <label className="lt-from-to-label lt-from-to-label--with-icon">
                    <span className="lt-from-to-dot lt-from-to-dot--from" aria-hidden /> Зупинка
                  </label>
                  <Combobox
                    label=""
                    options={[{ value: '', label: '— Оберіть зупинку —' }, ...stops.map((s) => ({ value: s, label: s }))]}
                    value={selectedStop}
                    onChange={handleStopChange}
                    placeholder="Наприклад Малинівка"
                    emptyMessage="Зупинок не знайдено"
                    clearable
                  />
                </div>
              </div>
              <div className="lt-datetime-row">
                <div className="lt-datetime-field">
                  <label className="lt-datetime-label">Дата</label>
                  <input
                    type="text"
                    className="lt-datetime-input"
                    value={searchDate}
                    onChange={(e) => setSearchDate(e.target.value)}
                    placeholder="ДД.ММ.РР"
                    maxLength={8}
                  />
                </div>
                <div className="lt-datetime-field">
                  <label className="lt-datetime-label">Орієнтовний час</label>
                  <input
                    type="time"
                    step={60}
                    className="lt-datetime-input"
                    value={searchTime}
                    onChange={(e) => setSearchTime(normalizeTimeInput(e.target.value))}
                    title="Підказка: список відсортований за часом; перший рейс після цього часу підсвічується"
                  />
                </div>
                <button type="button" className="lt-search-btn" onClick={handleDateTimeApply}>
                  Застосувати
                </button>
              </div>
            </div>
          </div>

          {!selectedStop ? (
            <p className="lt-empty lt-stop-board-empty">Оберіть зупинку, щоб побачити розклад відправлень.</p>
          ) : departures.length === 0 ? (
            <p className="lt-empty">Для цієї зупинки немає розкладу в даних.</p>
          ) : visibleDepartures.length === 0 && !showFullDay ? (
            <section className="lt-stop-board" aria-labelledby="lt-stop-board-table-h">
              <div className="lt-stop-board-meta">
                <h3 id="lt-stop-board-table-h" className="lt-stop-board-table-title">
                  {selectedStop}
                </h3>
                {parseDateUrl(searchDate) && (
                  <span className="lt-stop-board-date">
                    {searchDate}
                    {fare && <span className="lt-stop-board-fare"> · Проїзд {fare}</span>}
                  </span>
                )}
              </div>
              <p className="lt-empty">
                Після {searchTime} на цій зупинці в розкладі немає відправлень.
              </p>
              <button type="button" className="lt-stop-board-show-all-btn" onClick={() => setShowFullDay(true)}>
                Показати весь день
              </button>
            </section>
          ) : (
            <section className="lt-stop-board" aria-labelledby="lt-stop-board-table-h">
              <div className="lt-stop-board-meta">
                <h3 id="lt-stop-board-table-h" className="lt-stop-board-table-title">
                  {selectedStop}
                </h3>
                {parseDateUrl(searchDate) && (
                  <span className="lt-stop-board-date">
                    {searchDate}
                    {fare && <span className="lt-stop-board-fare"> · Проїзд {fare}</span>}
                  </span>
                )}
              </div>
              <div className="lt-stop-board-toolbar">
                <label className="lt-stop-board-checkbox">
                  <input
                    type="checkbox"
                    checked={showFullDay}
                    onChange={(e) => setShowFullDay(e.target.checked)}
                  />
                  <span>Показати весь день (усі відправлення з 00:00)</span>
                </label>
              </div>
              <p className="lt-stop-board-hint">
                {showFullDay
                  ? `Повний день. Орієнтовний час ${searchTime} — найближчий рейс після нього виділено.`
                  : `Лише рейси з ${searchTime} або пізніше. Зворотний відлік — якщо обрана дата збігається з сьогоднішньою (Київ).`}
              </p>
              <div className="lt-jd-cards" role="list">
                {visibleDepartures.map((row, i) => {
                  const isNext = highlightIndex >= 0 && i === highlightIndex;
                  const qs = new URLSearchParams();
                  qs.set('stop', selectedStop);
                  qs.set('dir', row.direction);
                  const depClock = formatMinsClock(row.departureMins);
                  qs.set('time', depClock);
                  if (searchDate) qs.set('d', searchDate);
                  qs.set('h', depClock);
                  const toRoute = `/localtransport/route/${row.routeId}?${qs.toString()}`;
                  const todayKyiv = isSearchDateTodayKyiv(searchDate);
                  const deltaMins = row.departureMins - kyivNowMins;
                  const aria = `Маршрут ${row.routeId}, відправлення ${depClock}, ${row.destination}`;
                  return (
                    <Link
                      key={`${row.tripId}-${row.departureMins}-${i}`}
                      className={`lt-jd-card ${isNext ? 'lt-jd-card--next' : ''}`}
                      to={toRoute}
                      role="listitem"
                      aria-label={aria}
                    >
                      <div className="lt-jd-card__countdown" aria-hidden>
                        {todayKyiv ? (
                          deltaMins > 0 ? (
                            <>
                              <span className="lt-jd-card__countdown-label">Відправлення через</span>
                              <div className="lt-jd-card__countdown-big">
                                <span className="lt-jd-card__countdown-num">{deltaMins}</span>
                                <span className="lt-jd-card__countdown-unit">хв</span>
                              </div>
                            </>
                          ) : deltaMins === 0 ? (
                            <span className="lt-jd-card__countdown-now">Зараз</span>
                          ) : (
                            <span className="lt-jd-card__countdown-past">Вже минуло</span>
                          )
                        ) : (
                          <>
                            <span className="lt-jd-card__countdown-label">Відправлення о</span>
                            <div className="lt-jd-card__countdown-big lt-jd-card__countdown-big--static">
                              <span className="lt-jd-card__countdown-time">{depClock}</span>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="lt-jd-card__body">
                        <div className="lt-jd-card__route-row">
                          <span
                            className={`lt-jd-card__route-num ${isVerifiedRoute(row.routeId) ? 'lt-jd-card__route-num--verified' : ''}`}
                          >
                            №{row.routeId}
                          </span>
                          <span className="lt-jd-card__route-arrow" aria-hidden>
                            →
                          </span>
                          <span className="lt-jd-card__destination">{row.destination}</span>
                        </div>
                        <div className="lt-jd-card__time-line">
                          <span className="lt-jd-card__pill lt-jd-card__pill--dep">{depClock}</span>
                          <span className="lt-jd-card__pill-hint">відправлення з зупинки</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <footer className="lt-footer">
            <a
              href="https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36"
              target="_blank"
              rel="noopener noreferrer"
            >
              data.gov.ua
            </a>
            {' · '}
            <a href="tel:+380687771590">(068) 77-71-590</a>
          </footer>
        </div>
        <div className="lt-map-column">
          <div className="lt-stop-board-map-placeholder" aria-hidden />
        </div>
      </div>
    </div>
  );
};
