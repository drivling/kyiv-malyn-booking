import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Select } from '@/components/Select';
import { Input } from '@/components/Input';
import { apiClient } from '@/api/client';
import type { TransportDataset, TransportTripDto } from '@/api/transportDataset';
import {
  buildSegmentLookup,
  compareTripsByDeparture,
  computeStopArrivalClock,
  nextTripId,
  parseClockToMinutes,
  FALLBACK_DEFAULT_SEGMENT_SEC,
} from './scheduleEditorTiming';
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

export const ScheduleEditorTab: React.FC = () => {
  const [baseDataset, setBaseDataset] = useState<TransportDataset | null>(null);
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

  const loadFromDb = useCallback(async () => {
    setLoading(true);
    setError('');
    setStatusMsg('');
    try {
      const dataset = await apiClient.getTransportDataset();
      setBaseDataset(dataset);
      setTrips(dataset.trips);
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
    if (!window.confirm('Завантажити з бази? Несхоронені зміни графіка буде втрачено.')) return;
    await loadFromDb();
  }, [loadFromDb]);

  const handleSaveToDb = useCallback(async () => {
    if (!baseDataset) return;
    if (
      !window.confirm(
        'Зберегти графік у базу? Несхоронені правки інших вкладок (карта, зупинки) не торкаються — береться те, що вже в базі.'
      )
    ) {
      return;
    }
    setSaving(true);
    setError('');
    setStatusMsg('');
    try {
      const merged: TransportDataset = { ...baseDataset, trips };
      const result = await apiClient.putTransportDataset(merged);
      setBaseDataset(merged);
      setStatusMsg(`Збережено: ${result.counts.trips} рейсів`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося зберегти графік у базу');
    } finally {
      setSaving(false);
    }
  }, [baseDataset, trips]);

  const routeOptions = useMemo(() => {
    if (!baseDataset) return [];
    return [...baseDataset.routes]
      .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10))
      .map((r) => ({ value: r.id, label: `№${r.id} — ${r.fromName || '?'} → ${r.toName || '?'}` }));
  }, [baseDataset]);

  const selectedRouteObj = useMemo(
    () => baseDataset?.routes.find((r) => r.id === selectedRoute) ?? null,
    [baseDataset, selectedRoute]
  );

  const stopNameById = useMemo(() => {
    const map = new Map<string, string>();
    baseDataset?.stops.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [baseDataset]);

  const orderedStopIds = useMemo(() => {
    if (!baseDataset || !selectedRoute) return [];
    const orderKey = directionMode === 'there' ? 'orderThere' : 'orderBack';
    return baseDataset.routeStops
      .filter((rs) => rs.routeId === selectedRoute && (rs[orderKey] ?? -1) > 0)
      .sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0))
      .map((rs) => rs.stopId);
  }, [baseDataset, selectedRoute, directionMode]);

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
      };
      setTrips((prev) => [...prev, newTrip]);
      setAddModalOpen(false);
    },
    [addForm, selectedRoute, trips, directionId]
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

  if (error || !baseDataset) {
    return (
      <div className="schedule-editor-error">
        <p>{error || 'Не вдалося завантажити дані'}</p>
        <Button type="button" onClick={loadFromDb}>
          Спробувати ще раз
        </Button>
      </div>
    );
  }

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

      {statusMsg && <p className="schedule-editor-hint">{statusMsg}</p>}
      <p className="schedule-editor-hint">
        Час на зупинці = час відправлення рейсу + сума тривалостей перегонів (сегментів). Сегменти тут не
        редагуються — правте їх у «Редакторі карти» кнопкою «Перерахувати час».
      </p>

      <div className="schedule-editor-toolbar">
        <Button type="button" variant="secondary" onClick={openAddModal} disabled={!selectedRoute}>
          + Додати рейс
        </Button>
        <span className="schedule-editor-count">{tripsForDirection.length} рейсів</span>
      </div>

      {orderedStopIds.length === 0 ? (
        <p className="schedule-editor-hint">У цього маршруту немає зупинок для обраного напрямку.</p>
      ) : tripsForDirection.length === 0 ? (
        <p className="schedule-editor-hint">Рейсів ще немає. Натисніть «+ Додати рейс», щоб створити перший.</p>
      ) : (
        <div className="schedule-editor-grid-wrap">
          <table className="schedule-editor-grid">
            <thead>
              <tr>
                <th className="schedule-editor-corner">Зупинка</th>
                {tripsForDirection.map((t) => (
                  <th key={t.id} className="schedule-editor-trip-head">
                    <input
                      type="time"
                      className="schedule-editor-time-input"
                      value={(t.departureTime || '').slice(0, 5)}
                      onChange={(e) => handleTimeChange(t.id, e.target.value)}
                    />
                    <input
                      type="text"
                      className="schedule-editor-headsign-input"
                      value={t.headsign || ''}
                      placeholder="кінцева"
                      onChange={(e) => updateTrip(t.id, { headsign: e.target.value })}
                    />
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
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedStopIds.map((stopId, idx) => (
                <tr key={stopId}>
                  <td className="schedule-editor-stop-name">{stopNameById.get(stopId) || stopId}</td>
                  {tripsForDirection.map((t) => {
                    const clock = computeStopArrivalClock(
                      t.departureTime,
                      segmentLookup,
                      selectedRoute,
                      orderedStopIds,
                      idx,
                      defaultSec
                    );
                    return (
                      <td key={t.id} className="schedule-editor-cell">
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
