import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Select } from '@/components/Select';
import { Input } from '@/components/Input';
import { apiClient } from '@/api/client';
import type { TransportDataset, TransportRouteDto, TransportTripDto } from '@/api/transportDataset';
import { broadcastTransportDatasetInvalidate } from '../TransportPage/useTransportDataset';
import {
  autoHeadsign,
  buildSegmentLookup,
  clockAtStop,
  compareTripsByDeparture,
  computeTripTimes,
  nextOppositeDeparture,
  nextTripId,
  parseClockToMinutes,
  FALLBACK_DEFAULT_SEGMENT_SEC,
} from './scheduleEditorTiming';
import type { TripTiming } from '../TransportPage/tripTiming';
import './ScheduleEditorTab.css';

type DirectionMode = 'there' | 'back';

const directionToId: Record<DirectionMode, string> = { there: '1', back: '0' };

interface AddTripForm {
  time: string;
  headsign: string;
  serviceId: string;
}

const SERVICE_OPTIONS = [
  { value: 'everyday', label: 'Щодня' },
  { value: 'weekdays', label: 'Будні' },
];

const EMPTY_ADD_FORM: AddTripForm = { time: '', headsign: '', serviceId: 'everyday' };

/** Значення селекта «Кінцева» для власного тексту таблички */
const OTHER_HEADSIGN = '__other__';

/** Людське розписання маршруту (JSON) → текст для textarea */
function scheduleToText(schedule: unknown): string {
  return schedule == null ? '' : JSON.stringify(schedule, null, 2);
}

export const ScheduleEditorTab: React.FC = () => {
  const [baseDataset, setBaseDataset] = useState<TransportDataset | null>(null);
  const [routes, setRoutes] = useState<TransportRouteDto[]>([]);
  const [trips, setTrips] = useState<TransportTripDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [selectedRoute, setSelectedRoute] = useState('');
  const [directionMode, setDirectionMode] = useState<DirectionMode>('there');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddTripForm>(EMPTY_ADD_FORM);
  const [addError, setAddError] = useState('');
  /** Чернетки JSON-розкладу по маршрутах (текст у textarea) і помилки парсингу */
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, string>>({});
  const [scheduleErrors, setScheduleErrors] = useState<Record<string, string>>({});
  /** Рейси, для яких табличка редагується як текст («Інше…»), а не береться з кінцевої */
  const [customHeadsign, setCustomHeadsign] = useState<Record<string, boolean>>({});

  const loadFromDb = useCallback(async () => {
    setLoading(true);
    setError('');
    setStatusMsg('');
    try {
      const dataset = await apiClient.getTransportDataset();
      setBaseDataset(dataset);
      setRoutes(dataset.routes);
      setTrips(dataset.trips);
      setScheduleDrafts({});
      setScheduleErrors({});
      setCustomHeadsign({});
      setSelectedRoute((prev) => {
        if (prev && dataset.routes.some((r) => r.id === prev)) return prev;
        const sorted = [...dataset.routes].sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
        return sorted[0]?.id ?? '';
      });
      setStatusMsg('Завантажено з бази');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося завантажити дані з бази');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFromDb();
  }, [loadFromDb]);

  const handleReloadFromDb = useCallback(async () => {
    if (!window.confirm('Завантажити з бази? Несхоронені зміни графіка та даних маршрутів буде втрачено.')) return;
    await loadFromDb();
  }, [loadFromDb]);

  const scheduleHasErrors = useMemo(
    () => Object.values(scheduleErrors).some((e) => Boolean(e)),
    [scheduleErrors]
  );

  const handleSaveToDb = useCallback(async () => {
    if (!baseDataset) return;
    if (scheduleHasErrors) {
      setError('Виправте JSON розкладу маршруту перед збереженням.');
      return;
    }
    if (
      !window.confirm(
        'Зберегти графік і дані маршрутів у базу? Несхоронені правки інших вкладок (карта, зупинки) не торкаються — береться те, що вже в базі.'
      )
    ) {
      return;
    }
    setSaving(true);
    setError('');
    setStatusMsg('');
    try {
      const merged: TransportDataset = { ...baseDataset, routes, trips };
      const result = await apiClient.putTransportDataset(merged);
      setBaseDataset(merged);
      broadcastTransportDatasetInvalidate();
      setStatusMsg(`Збережено: ${result.counts.routes} маршрутів, ${result.counts.trips} рейсів`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося зберегти графік у базу');
    } finally {
      setSaving(false);
    }
  }, [baseDataset, routes, trips, scheduleHasErrors]);

  const routeOptions = useMemo(() => {
    return [...routes]
      .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10))
      .map((r) => ({
        value: r.id,
        label: `№${r.id} — ${r.fromName || '?'} → ${r.toName || '?'}${r.unreliable ? ' · приховано' : ''}`,
      }));
  }, [routes]);

  const selectedRouteObj = useMemo(
    () => routes.find((r) => r.id === selectedRoute) ?? null,
    [routes, selectedRoute]
  );

  const updateRoute = useCallback((routeId: string, patch: Partial<TransportRouteDto>) => {
    setRoutes((prev) => prev.map((r) => (r.id === routeId ? { ...r, ...patch } : r)));
  }, []);

  const handleScheduleTextChange = useCallback(
    (routeId: string, text: string) => {
      setScheduleDrafts((prev) => ({ ...prev, [routeId]: text }));
      if (!text.trim()) {
        setScheduleErrors((prev) => ({ ...prev, [routeId]: '' }));
        updateRoute(routeId, { schedule: null });
        return;
      }
      try {
        const parsed: unknown = JSON.parse(text);
        setScheduleErrors((prev) => ({ ...prev, [routeId]: '' }));
        updateRoute(routeId, { schedule: parsed });
      } catch (err) {
        setScheduleErrors((prev) => ({
          ...prev,
          [routeId]: `Некоректний JSON: ${err instanceof Error ? err.message : String(err)}`,
        }));
      }
    },
    [updateRoute]
  );

  const stopNameById = useMemo(() => {
    const map = new Map<string, string>();
    baseDataset?.stops.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [baseDataset]);

  /** Ланцюжок напрямку з технічними точками — для розрахунку часу */
  const chainStopIds = useMemo(() => {
    if (!baseDataset || !selectedRoute) return [];
    const orderKey = directionMode === 'there' ? 'orderThere' : 'orderBack';
    return baseDataset.routeStops
      .filter((rs) => rs.routeId === selectedRoute && (rs[orderKey] ?? -1) > 0)
      .sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0))
      .map((rs) => rs.stopId);
  }, [baseDataset, selectedRoute, directionMode]);

  /** Пасажирські зупинки напрямку — рядки таблиці та селекти «З»/«Кінцева» */
  const passengerStopIds = useMemo(() => {
    if (!baseDataset) return [];
    const mapOnly = new Set(
      baseDataset.routeStops.filter((rs) => rs.routeId === selectedRoute && rs.mapOnly).map((rs) => rs.stopId)
    );
    return chainStopIds.filter((id) => !mapOnly.has(id));
  }, [baseDataset, selectedRoute, chainStopIds]);

  const routeStopCount = useMemo(
    () =>
      baseDataset
        ? baseDataset.routeStops.filter((rs) => rs.routeId === selectedRoute && !rs.mapOnly).length
        : 0,
    [baseDataset, selectedRoute]
  );

  const routeTripCount = useMemo(
    () => trips.filter((t) => t.routeId === selectedRoute).length,
    [trips, selectedRoute]
  );

  const directionId = directionToId[directionMode];

  const tripsForDirection = useMemo(
    () =>
      trips
        .filter((t) => t.routeId === selectedRoute && t.directionId === directionId)
        .sort(compareTripsByDeparture),
    [trips, selectedRoute, directionId]
  );

  const segmentLookup = useMemo(
    () => buildSegmentLookup(baseDataset?.segments ?? []),
    [baseDataset]
  );

  const defaultSec = useMemo(() => {
    const raw = Number(baseDataset?.meta.defaultSec);
    return Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_DEFAULT_SEGMENT_SEC;
  }, [baseDataset]);

  const timingByTrip = useMemo(() => {
    const map = new Map<string, TripTiming | null>();
    for (const t of tripsForDirection) {
      map.set(t.id, computeTripTimes(t, segmentLookup, selectedRoute, chainStopIds, defaultSec));
    }
    return map;
  }, [tripsForDirection, segmentLookup, selectedRoute, chainStopIds, defaultSec]);

  const stopName = useCallback((id: string | null | undefined) => (id ? stopNameById.get(id) || id : ''), [stopNameById]);
  const lastPassengerStopId = passengerStopIds[passengerStopIds.length - 1] ?? null;
  const tripStartIndex = (t: TransportTripDto) => (t.startStopId ? passengerStopIds.indexOf(t.startStopId) : 0);
  const tripEndIndex = (t: TransportTripDto) =>
    t.endStopId ? passengerStopIds.indexOf(t.endStopId) : passengerStopIds.length - 1;
  /** Табличка відрізняється від назви фактичної кінцевої → показуємо текстове поле */
  const isCustomHeadsign = (t: TransportTripDto) => {
    if (customHeadsign[t.id] != null) return customHeadsign[t.id];
    const plate = (t.headsign || '').trim();
    return !!plate && plate !== stopName(t.endStopId || lastPassengerStopId).trim();
  };

  const updateTrip = useCallback((tripId: string, patch: Partial<TransportTripDto>) => {
    setTrips((prev) => prev.map((t) => (t.id === tripId ? { ...t, ...patch } : t)));
  }, []);

  const handleTimeChange = useCallback(
    (tripId: string, value: string) => {
      updateTrip(tripId, { departureTime: value ? `${value}:00` : null });
    },
    [updateTrip]
  );

  const handleDeleteTrip = useCallback((tripId: string) => {
    if (!window.confirm(`Видалити рейс ${tripId}?`)) return;
    setTrips((prev) => prev.filter((t) => t.id !== tripId));
  }, []);

  const openAddModal = useCallback(() => {
    const defaultHeadsign =
      (directionMode === 'there' ? selectedRouteObj?.toName : selectedRouteObj?.fromName) || '';
    setAddForm({ time: '', headsign: defaultHeadsign, serviceId: 'everyday' });
    setAddError('');
    setAddModalOpen(true);
  }, [directionMode, selectedRouteObj]);

  const handleAddTrip = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (parseClockToMinutes(addForm.time) == null) {
        setAddError('Вкажіть коректний час (ГГ:ХХ)');
        return;
      }
      const id = nextTripId(selectedRoute, trips);
      const newTrip: TransportTripDto = {
        id,
        routeId: selectedRoute,
        serviceId: addForm.serviceId,
        headsign: addForm.headsign.trim(),
        directionId,
        departureTime: `${addForm.time}:00`,
        blockId: null,
        wheelchairAccessible: '',
        bikesAllowed: '',
        startStopId: null,
        endStopId: null,
        arrivalTime: null,
      };
      setTrips((prev) => [...prev, newTrip]);
      setAddModalOpen(false);
    },
    [addForm, selectedRoute, trips, directionId]
  );

  /** Селект «Кінцева»: зупинка → endStopId + автотабличка; порожньо → остання; «Інше…» → текст */
  const handleEndChange = useCallback(
    (t: TransportTripDto, value: string) => {
      if (value === OTHER_HEADSIGN) {
        setCustomHeadsign((prev) => ({ ...prev, [t.id]: true }));
        return;
      }
      const prevEndName = stopName(t.endStopId || lastPassengerStopId) || null;
      const nextEndId = value || null;
      const nextEndName = stopName(nextEndId || lastPassengerStopId);
      updateTrip(t.id, { endStopId: nextEndId, headsign: autoHeadsign(t.headsign, prevEndName, nextEndName) });
      setCustomHeadsign((prev) => ({ ...prev, [t.id]: false }));
    },
    [stopName, lastPassengerStopId, updateTrip]
  );

  const directionLabel = useCallback(
    (mode: DirectionMode) => {
      if (!selectedRouteObj) return mode === 'there' ? 'Туди' : 'Назад';
      const { fromName, toName } = selectedRouteObj;
      return mode === 'there' ? `${fromName || '?'} → ${toName || '?'}` : `${toName || '?'} → ${fromName || '?'}`;
    },
    [selectedRouteObj]
  );

  if (loading) {
    return <div className="schedule-editor-loading">Завантаження...</div>;
  }

  if (error && !baseDataset) {
    return (
      <div className="schedule-editor-error">
        <p>{error}</p>
        <Button type="button" onClick={loadFromDb}>
          Спробувати ще раз
        </Button>
      </div>
    );
  }

  if (!baseDataset) {
    return (
      <div className="schedule-editor-error">
        <p>Не вдалося завантажити дані</p>
        <Button type="button" onClick={loadFromDb}>
          Спробувати ще раз
        </Button>
      </div>
    );
  }

  const scheduleText =
    selectedRouteObj
      ? (scheduleDrafts[selectedRouteObj.id] ?? scheduleToText(selectedRouteObj.schedule))
      : '';
  const scheduleError = selectedRouteObj ? scheduleErrors[selectedRouteObj.id] || '' : '';

  return (
    <div className="tab-content schedule-editor-tab">
      <div className="schedule-editor-controls">
        <div className="schedule-editor-select">
          <Select
            label="Маршрут"
            value={selectedRoute}
            onChange={(e) => setSelectedRoute(e.target.value)}
            options={routeOptions}
          />
        </div>
        <div className="schedule-editor-direction-switch">
          <button
            type="button"
            className={`schedule-editor-direction-btn ${directionMode === 'there' ? 'schedule-editor-direction-btn--active' : ''}`}
            onClick={() => setDirectionMode('there')}
          >
            {directionLabel('there')}
          </button>
          <button
            type="button"
            className={`schedule-editor-direction-btn ${directionMode === 'back' ? 'schedule-editor-direction-btn--active' : ''}`}
            onClick={() => setDirectionMode('back')}
          >
            {directionLabel('back')}
          </button>
        </div>
        <div className="schedule-editor-actions">
          <Button type="button" onClick={handleSaveToDb} disabled={saving}>
            {saving ? 'Збереження…' : 'Зберегти в базу'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleReloadFromDb} disabled={loading || saving}>
            Завантажити з бази
          </Button>
        </div>
      </div>

      {error && <p className="schedule-editor-error">{error}</p>}
      {statusMsg && <p className="schedule-editor-hint">{statusMsg}</p>}
      <p className="schedule-editor-hint">
        Час на зупинці = час відправлення рейсу + сума тривалостей перегонів (сегментів). «З» / «Кінцева»
        роблять рейс скороченим: на інших зупинках він не показується (сайт, табло, GTFS). «Прибуття» —
        фіксований час на кінцевій: якщо перегони не вкладаються, вони стискаються пропорційно лише для
        цього рейсу (бейдж ×0.78); із запасом — час за перегонами. Сегменти правте у «Редакторі карти»
        кнопкою «Перерахувати час».
      </p>

      {selectedRouteObj && (
        <section className="schedule-editor-route-panel" aria-labelledby="schedule-editor-route-panel-h">
          <div className="schedule-editor-route-panel-head">
            <h3 id="schedule-editor-route-panel-h" className="schedule-editor-route-panel-title">
              Маршрут №{selectedRouteObj.id}
            </h3>
            <span className="schedule-editor-count">
              {routeTripCount} рейсів · {routeStopCount} зупинок
            </span>
          </div>
          <label
            className={`admin-checkbox schedule-editor-route-flag ${selectedRouteObj.unreliable ? 'schedule-editor-route-flag--on' : ''}`}
          >
            <input
              type="checkbox"
              checked={selectedRouteObj.unreliable === true}
              onChange={(e) => updateRoute(selectedRouteObj.id, { unreliable: e.target.checked })}
            />
            <span>
              Ненадійний маршрут — приховати на сайті (список маршрутів, планер, сторінка маршруту, табло
              зупинок, SEO/AEO-сторінки, sitemap, GTFS)
            </span>
          </label>
          {selectedRouteObj.unreliable && (
            <p className="schedule-editor-hint">
              Прихований маршрут лишається в базі та адмінці. Статичні сторінки зупинок і sitemap
              перегенеруються під час наступного деплою фронтенду.
            </p>
          )}
          <div className="schedule-editor-route-grid">
            <Input
              label="Кінцева «звідки» (fromName)"
              type="text"
              value={selectedRouteObj.fromName ?? ''}
              onChange={(e) => updateRoute(selectedRouteObj.id, { fromName: e.target.value })}
            />
            <Input
              label="Кінцева «куди» (toName)"
              type="text"
              value={selectedRouteObj.toName ?? ''}
              onChange={(e) => updateRoute(selectedRouteObj.id, { toName: e.target.value })}
            />
            <Input
              label="Джерело (sourceUrl)"
              type="url"
              value={selectedRouteObj.sourceUrl ?? ''}
              placeholder="https://…"
              onChange={(e) => updateRoute(selectedRouteObj.id, { sourceUrl: e.target.value })}
            />
          </div>
          <label className="schedule-editor-route-field">
            <span className="schedule-editor-field-label">Схема руху (scheme)</span>
            <textarea
              className="schedule-editor-textarea"
              rows={2}
              value={selectedRouteObj.scheme ?? ''}
              onChange={(e) => updateRoute(selectedRouteObj.id, { scheme: e.target.value })}
            />
          </label>
          <label className="schedule-editor-route-field">
            <span className="schedule-editor-field-label">Примітка (note)</span>
            <textarea
              className="schedule-editor-textarea"
              rows={2}
              value={selectedRouteObj.note ?? ''}
              onChange={(e) => updateRoute(selectedRouteObj.id, { note: e.target.value })}
            />
          </label>
          <label className="schedule-editor-route-field">
            <span className="schedule-editor-field-label">
              Людське розписання з міськради (schedule, JSON: schedule_entries, lunch_break, note)
            </span>
            <textarea
              className={`schedule-editor-textarea schedule-editor-textarea--mono ${scheduleError ? 'schedule-editor-textarea--error' : ''}`}
              rows={6}
              value={scheduleText}
              placeholder="Порожньо — без людського розписання"
              spellCheck={false}
              onChange={(e) => handleScheduleTextChange(selectedRouteObj.id, e.target.value)}
            />
            {scheduleError && <span className="schedule-editor-field-error">{scheduleError}</span>}
          </label>
        </section>
      )}

      <div className="schedule-editor-toolbar">
        <Button type="button" variant="secondary" onClick={openAddModal} disabled={!selectedRoute}>
          + Додати рейс
        </Button>
        <span className="schedule-editor-count">{tripsForDirection.length} рейсів</span>
      </div>

      {passengerStopIds.length === 0 ? (
        <p className="schedule-editor-hint">У цього маршруту немає зупинок для обраного напрямку.</p>
      ) : tripsForDirection.length === 0 ? (
        <p className="schedule-editor-hint">Рейсів ще немає. Натисніть «+ Додати рейс», щоб створити перший.</p>
      ) : (
        <div className="schedule-editor-grid-wrap">
          <table className="schedule-editor-grid">
            <thead>
              <tr>
                <th className="schedule-editor-corner">Зупинка</th>
                {tripsForDirection.map((t) => {
                  const timing = timingByTrip.get(t.id) ?? null;
                  const startIdx = tripStartIndex(t);
                  const endIdx = tripEndIndex(t);
                  const startOptions = passengerStopIds.filter((_, i) => i > 0 && i < endIdx);
                  const endOptions = passengerStopIds.filter(
                    (_, i) => i > startIdx && i < passengerStopIds.length - 1
                  );
                  const custom = isCustomHeadsign(t);
                  const endSelectValue = t.endStopId ?? (custom ? OTHER_HEADSIGN : '');
                  const oppositeHint = t.arrivalTime ? null : nextOppositeDeparture(trips, t);
                  return (
                    <th key={t.id} className="schedule-editor-trip-head">
                      <input
                        type="time"
                        className="schedule-editor-time-input"
                        value={(t.departureTime || '').slice(0, 5)}
                        onChange={(e) => handleTimeChange(t.id, e.target.value)}
                        title="Відправлення з першої обслуговуваної зупинки"
                      />
                      <span className="schedule-editor-head-label">З</span>
                      <select
                        className="schedule-editor-stop-select"
                        value={t.startStopId ?? ''}
                        onChange={(e) => updateTrip(t.id, { startStopId: e.target.value || null })}
                        title="Перша обслуговувана зупинка"
                      >
                        <option value="">(перша)</option>
                        {startOptions.map((id) => (
                          <option key={id} value={id}>
                            {stopName(id)}
                          </option>
                        ))}
                      </select>
                      <span className="schedule-editor-head-label">Кінцева</span>
                      <select
                        className="schedule-editor-stop-select"
                        value={endSelectValue}
                        onChange={(e) => handleEndChange(t, e.target.value)}
                        title="Остання обслуговувана зупинка; «Інше…» — власний текст таблички"
                      >
                        <option value="">(остання)</option>
                        {endOptions.map((id) => (
                          <option key={id} value={id}>
                            {stopName(id)}
                          </option>
                        ))}
                        <option value={OTHER_HEADSIGN}>Інше…</option>
                      </select>
                      {custom && (
                        <input
                          type="text"
                          className="schedule-editor-headsign-input"
                          value={t.headsign || ''}
                          placeholder="табличка"
                          onChange={(e) => updateTrip(t.id, { headsign: e.target.value })}
                        />
                      )}
                      <span className="schedule-editor-head-label">Прибуття</span>
                      <input
                        type="time"
                        className="schedule-editor-time-input"
                        value={(t.arrivalTime || '').slice(0, 5)}
                        disabled={!t.departureTime}
                        title={
                          t.departureTime
                            ? 'Фіксований час на кінцевій: перегони рейсу стискаються, щоб встигнути'
                            : 'Спочатку задайте час відправлення'
                        }
                        onChange={(e) =>
                          updateTrip(t.id, { arrivalTime: e.target.value ? `${e.target.value}:00` : null })
                        }
                      />
                      {timing?.arrivalIgnored && (
                        <span className="schedule-editor-factor schedule-editor-factor--error">
                          прибуття ≤ відправлення
                        </span>
                      )}
                      {timing && !timing.arrivalIgnored && timing.factor < 1 && (
                        <span
                          className={`schedule-editor-factor ${timing.factor < 0.5 ? 'schedule-editor-factor--warn' : ''}`}
                          title="Перегони цього рейсу стиснуто, щоб встигнути до часу прибуття"
                        >
                          ×{timing.factor.toFixed(2)}
                        </span>
                      )}
                      {oppositeHint && (
                        <button
                          type="button"
                          className="schedule-editor-hint-btn"
                          onClick={() => updateTrip(t.id, { arrivalTime: `${oppositeHint}:00` })}
                          title="Підставити як час прибуття (виїзд зворотного рейсу з кінцевої)"
                        >
                          ↩ зворотний о {oppositeHint}
                        </button>
                      )}
                      <select
                        className="schedule-editor-service-select"
                        value={t.serviceId || 'everyday'}
                        onChange={(e) => updateTrip(t.id, { serviceId: e.target.value })}
                      >
                        {SERVICE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="schedule-editor-delete-btn"
                        onClick={() => handleDeleteTrip(t.id)}
                        title={`Видалити рейс ${t.id}`}
                      >
                        ×
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {passengerStopIds.map((stopId) => (
                <tr key={stopId}>
                  <td className="schedule-editor-stop-name">{stopName(stopId)}</td>
                  {tripsForDirection.map((t) => {
                    const timing = timingByTrip.get(t.id) ?? null;
                    const clock = clockAtStop(timing, stopId);
                    const unserved = timing != null && clock == null;
                    return (
                      <td
                        key={t.id}
                        className={`schedule-editor-cell ${unserved ? 'schedule-editor-cell--unserved' : ''}`}
                        title={unserved ? 'Рейс тут не зупиняється' : undefined}
                      >
                        {clock ?? '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addModalOpen && (
        <div className="schedule-editor-modal-overlay" onClick={() => setAddModalOpen(false)}>
          <form
            className="schedule-editor-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAddTrip}
          >
            <h3 className="schedule-editor-modal-title">Новий рейс — {directionLabel(directionMode)}</h3>
            <Input
              label="Час відправлення"
              type="time"
              value={addForm.time}
              onChange={(e) => setAddForm((f) => ({ ...f, time: e.target.value }))}
              error={addError || undefined}
              autoFocus
            />
            <Input
              label="Кінцева (headsign)"
              type="text"
              value={addForm.headsign}
              onChange={(e) => setAddForm((f) => ({ ...f, headsign: e.target.value }))}
            />
            <Select
              label="Календар"
              value={addForm.serviceId}
              onChange={(e) => setAddForm((f) => ({ ...f, serviceId: e.target.value }))}
              options={SERVICE_OPTIONS}
            />
            <div className="schedule-editor-modal-buttons">
              <Button type="submit">Додати</Button>
              <Button type="button" variant="secondary" onClick={() => setAddModalOpen(false)}>
                Скасувати
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
