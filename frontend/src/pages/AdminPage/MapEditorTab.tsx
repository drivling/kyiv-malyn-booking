import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/Button';
import { Select } from '@/components/Select';
import './MapEditorTab.css';

const TRANSPORT_URL = '/data/malyn_transport.json';
const STOPS_COORDS_URL = '/data/stops_coords.json';

const MARKER_EXCLUDED_COLOR = '#1e3a5f';

interface StopsCoordsData {
  center: [number, number];
  stops: Record<string, [number, number]>;
}

interface RouteStop {
  name: string;
  order_there?: number;
  order_back?: number;
  /** Точка тільки для карти й розрахунку (не показується в списку зупинок для пасажирів) */
  map_only?: boolean;
}

interface SupplementRoute {
  from?: string;
  to?: string;
}

interface TransportData {
  source?: string;
  records?: unknown[];
  supplement?: {
    stops?: {
      stops_by_route?: Record<string, RouteStop[] | string[]>;
    };
    routes?: Record<string, SupplementRoute>;
  };
  [key: string]: unknown;
}

function getRouteStopsWithOrder(
  sbr: Record<string, RouteStop[] | string[]> | undefined,
  routeId: string
): RouteStop[] {
  const routeStops = sbr?.[routeId];
  if (!Array.isArray(routeStops) || routeStops.length === 0) return [];
  const first = routeStops[0];
  if (typeof first === 'object' && 'order_there' in first) {
    return routeStops as RouteStop[];
  }
  const names = routeStops as unknown as string[];
  return names.map((name, i) => ({
    name,
    order_there: i + 1,
    order_back: names.length - i,
  }));
}

/** Наступний індекс для технічної зупинки маршруту (назва "№{routeId} т.{n}") */
function nextTechnicalStopIndex(routeStops: RouteStop[], routeId: string): number {
  const prefix = `№${routeId} т.`;
  let max = 0;
  routeStops.forEach((s) => {
    if (s.map_only && s.name.startsWith(prefix)) {
      const num = parseInt(s.name.slice(prefix.length), 10);
      if (!Number.isNaN(num) && num > max) max = num;
    }
  });
  return max + 1;
}

function createMarkerIcon(color: string, orderLabel?: string) {
  const label = orderLabel != null ? `<span class="map-editor-marker-label">${orderLabel}</span>` : '';
  return L.divIcon({
    className: 'map-editor-marker',
    html: `<span class="map-editor-marker-pin" style="background-color:${color}"><span class="map-editor-marker-inner">${label}</span></span>`,
    iconSize: [32, 42],
    iconAnchor: [16, 42],
  });
}

const defaultIcon = createMarkerIcon('#3388ff');
const excludedIcon = createMarkerIcon(MARKER_EXCLUDED_COLOR, '−');

function DraggableMarker({
  name,
  position,
  onPositionChange,
  excluded,
}: {
  name: string;
  position: [number, number];
  onPositionChange: (name: string, lat: number, lng: number) => void;
  excluded?: boolean;
}) {
  const markerRef = useRef<L.Marker | null>(null);

  const eventHandlers = useMemo(
    () => ({
      dragend() {
        const marker = markerRef.current;
        if (marker != null) {
          const latlng = marker.getLatLng();
          onPositionChange(name, latlng.lat, latlng.lng);
        }
      },
    }),
    [name, onPositionChange]
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });
    }
  }, []);

  return (
    <Marker
      ref={markerRef}
      position={position}
      draggable
      icon={excluded ? excludedIcon : defaultIcon}
      eventHandlers={eventHandlers}
    >
      <Popup>
        Перетягніть маркер для зміни позиції: {name}
        {excluded && <span className="map-editor-popup-excluded"> (виключена)</span>}
      </Popup>
    </Marker>
  );
}

function ClickableMarker({
  name,
  position,
  onClick,
  excluded,
  order,
}: {
  name: string;
  position: [number, number];
  onClick: (name: string) => void;
  excluded?: boolean;
  order?: number;
}) {
  const icon = excluded
    ? createMarkerIcon(MARKER_EXCLUDED_COLOR, '−')
    : createMarkerIcon('#3388ff', order != null ? String(order) : undefined);
  return (
    <Marker
      position={position}
      draggable={false}
      icon={icon}
      eventHandlers={{ click: () => onClick(name) }}
    >
      <Popup>
        <button type="button" className="map-editor-marker-popup-btn" onClick={() => onClick(name)}>
          Редагувати порядок: {name}
        </button>
      </Popup>
    </Marker>
  );
}


function MapBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) {
      map.fitBounds(positions as [number, number][], { padding: [30, 30], maxZoom: 16 });
    } else if (positions.length === 1) {
      map.setView(positions[0], 16);
    }
  }, [map, positions]);
  return null;
}

function MapCenterTracker({ onCenterChange }: { onCenterChange: (lat: number, lng: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const update = () => {
      const c = map.getCenter();
      onCenterChange(c.lat, c.lng);
    };
    update();
    map.on('moveend', update);
    return () => {
      map.off('moveend', update);
    };
  }, [map, onCenterChange]);
  return null;
}

type EditorMode = 'coords' | 'direction';

export const MapEditorTab: React.FC = () => {
  const [transportData, setTransportData] = useState<TransportData | null>(null);
  const [coordsData, setCoordsData] = useState<StopsCoordsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<string>('');
  const [editorMode, setEditorMode] = useState<EditorMode>('coords');
  const [directionMode, setDirectionMode] = useState<'there' | 'back'>('there');
  const [mounted, setMounted] = useState(false);
  const [modalStop, setModalStop] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const handleMapCenterChange = useCallback((lat: number, lng: number) => {
    setMapCenter([lat, lng]);
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(TRANSPORT_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Transport')))),
      fetch(STOPS_COORDS_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Coords')))),
    ])
      .then(([transport, coords]) => {
        setTransportData(transport);
        setCoordsData(coords);
      })
      .catch((err) => setError(err.message || 'Не вдалося завантажити дані'))
      .finally(() => setLoading(false));
  }, []);

  const routeOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Всі зупинки / виберіть маршрут' }];
    const sbr = transportData?.supplement?.stops?.stops_by_route;
    if (sbr) {
      Object.keys(sbr)
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
        .forEach((id) => opts.push({ value: id, label: `Маршрут №${id}` }));
    }
    return opts;
  }, [transportData]);

  const displayedStops = useMemo(() => {
    if (!coordsData) return [];
    const allStops = Object.keys(coordsData.stops);
    if (!selectedRoute) return allStops;
    const routeStops = getRouteStopsWithOrder(transportData?.supplement?.stops?.stops_by_route, selectedRoute);
    const routeStopNames = new Set(routeStops.map((s) => s.name));
    return allStops.filter((n) => routeStopNames.has(n));
  }, [coordsData, transportData, selectedRoute]);

  const isTechnicalStop = useCallback(
    (name: string) => {
      if (!selectedRoute || !transportData) return false;
      const routeStops = getRouteStopsWithOrder(transportData.supplement?.stops?.stops_by_route, selectedRoute);
      return routeStops.some((s) => s.name === name && s.map_only);
    },
    [selectedRoute, transportData]
  );

  const routeStopsForDirection = useMemo(() => {
    if (!selectedRoute || !transportData) return [];
    return getRouteStopsWithOrder(transportData.supplement?.stops?.stops_by_route, selectedRoute);
  }, [selectedRoute, transportData]);

  const routeEndpoints = useMemo(() => {
    if (!selectedRoute || !transportData) return { from: '?', to: '?' };
    const r = transportData.supplement?.routes?.[selectedRoute];
    return { from: r?.from ?? '?', to: r?.to ?? '?' };
  }, [selectedRoute, transportData]);

  const orderedStopsForDirection = useMemo(() => {
    const orderKey = directionMode === 'there' ? 'order_there' : 'order_back';
    return [...routeStopsForDirection]
      .filter((s) => {
        const o = s[orderKey];
        return typeof o === 'number' && o > 0;
      })
      .sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0));
  }, [routeStopsForDirection, directionMode]);

  const isStopExcludedInAnyDirection = useCallback(
    (name: string) => {
      const stop = routeStopsForDirection.find((s) => s.name === name);
      if (!stop) return false;
      return stop.order_there === -1 || stop.order_back === -1;
    },
    [routeStopsForDirection]
  );

  const handlePositionChange = useCallback(
    (name: string, lat: number, lng: number) => {
      setCoordsData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stops: {
            ...prev.stops,
            [name]: [lat, lng],
          },
        };
      });
    },
    []
  );

  const handleAddTechnicalStop = useCallback(() => {
    if (!selectedRoute || !transportData || !coordsData) return;
    const sbr = transportData.supplement?.stops?.stops_by_route;
    const routeStops = getRouteStopsWithOrder(sbr, selectedRoute);
    if (routeStops.length === 0) return;
    const name = `№${selectedRoute} т.${nextTechnicalStopIndex(routeStops, selectedRoute)}`;
    const maxThere = Math.max(0, ...routeStops.map((s) => s.order_there ?? 0).filter((n) => n > 0));
    const maxBack = Math.max(0, ...routeStops.map((s) => s.order_back ?? 0).filter((n) => n > 0));
    const firstWithCoords = displayedStops.map((n) => coordsData.stops[n]).find(Boolean);
    const position: [number, number] = mapCenter ?? (firstWithCoords as [number, number]) ?? coordsData.center;
    setCoordsData((prev) =>
      prev
        ? { ...prev, stops: { ...prev.stops, [name]: position } }
        : prev
    );
    const newStop: RouteStop = {
      name,
      order_there: maxThere + 1,
      order_back: maxBack + 1,
      map_only: true,
    };
    setTransportData({
      ...transportData,
      supplement: {
        ...transportData.supplement,
        stops: {
          ...transportData.supplement?.stops,
          stops_by_route: {
            ...transportData.supplement?.stops?.stops_by_route,
            [selectedRoute]: [...routeStops, newStop],
          },
        },
      },
    });
  }, [selectedRoute, transportData, coordsData, mapCenter, displayedStops]);

  const handleDownloadCoords = useCallback(() => {
    if (!coordsData) return;
    const blob = new Blob([JSON.stringify(coordsData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stops_coords.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [coordsData]);

  const handleStopOrderChange = useCallback(
    (stopName: string, newOrder: number) => {
      if (!transportData || !selectedRoute) return;
      const sbr = transportData.supplement?.stops?.stops_by_route;
      if (!sbr?.[selectedRoute]) return;
      const routeStops = [...(sbr[selectedRoute] as RouteStop[])];
      const orderKey = directionMode === 'there' ? 'order_there' : 'order_back';
      const stopIdx = routeStops.findIndex((s) => s.name === stopName);
      if (stopIdx < 0) return;
      const oldOrder = routeStops[stopIdx][orderKey] ?? 0;
      if (newOrder === -1) {
        routeStops[stopIdx] = { ...routeStops[stopIdx], [orderKey]: -1 };
      } else {
        const swapIdx = routeStops.findIndex((s) => (s[orderKey] ?? 0) === newOrder);
        routeStops[stopIdx] = { ...routeStops[stopIdx], [orderKey]: newOrder };
        if (swapIdx >= 0 && swapIdx !== stopIdx) {
          routeStops[swapIdx] = { ...routeStops[swapIdx], [orderKey]: oldOrder };
        }
      }
      setTransportData({
        ...transportData,
        supplement: {
          ...transportData.supplement,
          stops: {
            ...transportData.supplement?.stops,
            stops_by_route: {
              ...transportData.supplement?.stops?.stops_by_route,
              [selectedRoute]: routeStops,
            },
          },
        },
      });
      setModalStop(null);
    },
    [transportData, selectedRoute, directionMode]
  );

  /** Скопіювати зупинку (за назвою) в інший маршрут — додати в кінець, порядок потім підправити в редакторі */
  const handleCopyStopToRoute = useCallback(
    (stopName: string, targetRouteId: string) => {
      if (!transportData || !selectedRoute || targetRouteId === selectedRoute) return;
      const sbr = transportData.supplement?.stops?.stops_by_route;
      const sourceStop = routeStopsForDirection.find((s) => s.name === stopName);
      if (!sourceStop) return;
      const targetStopsRaw = sbr?.[targetRouteId];
      if (!targetStopsRaw || !Array.isArray(targetStopsRaw)) return;
      const targetStops: RouteStop[] =
        targetStopsRaw.length > 0 && typeof targetStopsRaw[0] === 'object' && 'name' in targetStopsRaw[0]
          ? [...(targetStopsRaw as RouteStop[])]
          : (targetStopsRaw as string[]).map((name, i) => ({
              name,
              order_there: i + 1,
              order_back: targetStopsRaw.length - i,
            }));
      if (targetStops.some((s) => s.name === stopName)) return;
      const maxThere = Math.max(0, ...targetStops.map((s) => s.order_there ?? 0).filter((n) => n > 0));
      const maxBack = Math.max(0, ...targetStops.map((s) => s.order_back ?? 0).filter((n) => n > 0));
      const newEntry: RouteStop = {
        name: stopName,
        order_there: maxThere + 1,
        order_back: maxBack + 1,
        ...(sourceStop.map_only !== undefined && { map_only: sourceStop.map_only }),
      };
      setTransportData({
        ...transportData,
        supplement: {
          ...transportData.supplement,
          stops: {
            ...transportData.supplement?.stops,
            stops_by_route: {
              ...transportData.supplement?.stops?.stops_by_route,
              [targetRouteId]: [...targetStops, newEntry],
            },
          },
        },
      });
      setModalStop(null);
    },
    [transportData, selectedRoute, routeStopsForDirection]
  );

  const handleDownloadTransport = useCallback(() => {
    if (!transportData) return;
    const blob = new Blob([JSON.stringify(transportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'malyn_transport.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [transportData]);

  const positions = useMemo(
    () => displayedStops.map((n) => coordsData?.stops[n]).filter(Boolean) as [number, number][],
    [displayedStops, coordsData]
  );

  if (loading) {
    return <div className="map-editor-loading">Завантаження...</div>;
  }

  if (error || !coordsData) {
    return (
      <div className="map-editor-error">
        {error || 'Дані не завантажені'}
      </div>
    );
  }

  const directionEditorActive = editorMode === 'direction' && selectedRoute;

  return (
    <div className="tab-content map-editor-tab">
      <div className="map-editor-mode-switch">
        <div className="map-editor-mode-btns">
          <button
            type="button"
            className={`map-editor-mode-btn ${editorMode === 'coords' ? 'map-editor-mode-btn--active' : ''}`}
            onClick={() => setEditorMode('coords')}
          >
            Редактор координат
          </button>
          <button
            type="button"
            className={`map-editor-mode-btn ${editorMode === 'direction' ? 'map-editor-mode-btn--active' : ''}`}
            onClick={() => setEditorMode('direction')}
            disabled={!selectedRoute}
            title={!selectedRoute ? 'Спочатку виберіть маршрут' : ''}
          >
            Редактор напрямку
          </button>
        </div>
      </div>

      <div className="map-editor-controls">
        <div className="map-editor-select">
          <Select
            label="Маршрут"
            options={routeOptions}
            value={selectedRoute}
            onChange={(e) => setSelectedRoute(e.target.value)}
          />
        </div>
        {editorMode === 'coords' && (
          <div className="map-editor-actions">
            <Button
              type="button"
              onClick={handleAddTechnicalStop}
              disabled={!selectedRoute}
              title={!selectedRoute ? 'Спочатку виберіть маршрут' : 'Додати точку тільки для карти (map_only)'}
            >
              + Техн. зупинка
            </Button>
            <Button onClick={handleDownloadCoords}>
              ⬇ Завантажити stops_coords.json
            </Button>
          </div>
        )}
      </div>

      {editorMode === 'coords' && (
        <p className="map-editor-hint">
          Перетягніть маркер для уточнення позиції. «+ Техн. зупинка» — точка тільки для карти (map_only), коротка назва типу №9 т.1.
          Темно-синій — виключена (order = -1). Завантажте обидва JSON і замініть у <code>public/data/</code>.
        </p>
      )}

      {directionEditorActive && (
        <div className="map-editor-direction-controls">
          <div className="map-editor-direction-switch">
            <span className="map-editor-direction-label">Напрямок:</span>
            <button
              type="button"
              className={`map-editor-direction-btn ${directionMode === 'there' ? 'map-editor-direction-btn--active' : ''}`}
              onClick={() => setDirectionMode('there')}
              title={`На ${routeEndpoints.to}`}
            >
              → {routeEndpoints.to}
            </button>
            <button
              type="button"
              className={`map-editor-direction-btn ${directionMode === 'back' ? 'map-editor-direction-btn--active' : ''}`}
              onClick={() => setDirectionMode('back')}
              title={`На ${routeEndpoints.from}`}
            >
              ← {routeEndpoints.from}
            </button>
          </div>
          <Button onClick={handleDownloadTransport}>
            ⬇ Завантажити malyn_transport.json
          </Button>
        </div>
      )}

      {directionEditorActive && (
        <p className="map-editor-hint">
          Натисніть на маркер, щоб змінити номер зупинки по напрямку або виключити (-1). Темно-синій — виключена.
        </p>
      )}

      <div className="map-editor-layout">
        <div className="map-editor-map">
          {mounted && (
            <MapContainer
              center={coordsData.center}
              zoom={13}
              className="map-editor-map-container"
              scrollWheelZoom
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapBounds positions={positions} />
              <MapCenterTracker onCenterChange={handleMapCenterChange} />
              {editorMode === 'coords'
                ? displayedStops.map((name) => {
                    const pos = coordsData.stops[name];
                    if (!pos) return null;
                    return (
                      <DraggableMarker
                        key={name}
                        name={name}
                        position={pos}
                        onPositionChange={handlePositionChange}
                        excluded={selectedRoute ? isStopExcludedInAnyDirection(name) : false}
                      />
                    );
                  })
                : directionEditorActive &&
                  displayedStops.map((name) => {
                    const pos = coordsData.stops[name];
                    if (!pos) return null;
                    const stop = routeStopsForDirection.find((s) => s.name === name);
                    const orderKey = directionMode === 'there' ? 'order_there' : 'order_back';
                    const order = stop?.[orderKey];
                    const excluded = order === -1;
                    return (
                      <ClickableMarker
                        key={name}
                        name={name}
                        position={pos}
                        onClick={setModalStop}
                        excluded={excluded}
                        order={excluded ? undefined : (order as number)}
                      />
                    );
                  })}
            </MapContainer>
          )}
        </div>
        <div className="map-editor-list">
          {editorMode === 'coords' ? (
            <>
              <h3 className="map-editor-list-title">Зупинки ({displayedStops.length})</h3>
              <ul className="map-editor-stops-list">
                {displayedStops.map((name) => {
                  const pos = coordsData.stops[name];
                  const excluded = selectedRoute ? isStopExcludedInAnyDirection(name) : false;
                  const technical = isTechnicalStop(name);
                  return (
                    <li key={name} className={`map-editor-stop-item ${excluded ? 'map-editor-stop-item--excluded' : ''}`}>
                      <span className="map-editor-stop-name">{name}</span>
                      {pos && (
                        <span className="map-editor-stop-coords">
                          {pos[0].toFixed(6)}, {pos[1].toFixed(6)}
                        </span>
                      )}
                      {technical && <span className="map-editor-stop-badge map-editor-stop-badge--tech">техн.</span>}
                      {excluded && <span className="map-editor-stop-badge">виключена</span>}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : editorMode === 'direction' ? (
            directionEditorActive ? (
              <>
                <h3 className="map-editor-list-title">
                  Порядок зупинок ({directionMode === 'there' ? `→ ${routeEndpoints.to}` : `← ${routeEndpoints.from}`})
                </h3>
                <ul className="map-editor-stops-list map-editor-stops-list--ordered">
                  {orderedStopsForDirection.map((s, idx) => (
                    <li key={s.name} className="map-editor-stop-item">
                      <span className="map-editor-stop-order">{idx + 1}.</span>
                      <span className="map-editor-stop-name">{s.name}</span>
                      {s.map_only && <span className="map-editor-stop-badge map-editor-stop-badge--tech">техн.</span>}
                    </li>
                  ))}
                  {routeStopsForDirection.filter((s) => (directionMode === 'there' ? s.order_there : s.order_back) === -1).length > 0 && (
                    <li className="map-editor-stop-item map-editor-stop-item--excluded-header">Виключені (-1):</li>
                  )}
                  {routeStopsForDirection
                    .filter((s) => (directionMode === 'there' ? s.order_there : s.order_back) === -1)
                    .map((s) => (
                      <li key={s.name} className="map-editor-stop-item map-editor-stop-item--excluded">
                        <span className="map-editor-stop-order">—</span>
                        <span className="map-editor-stop-name">{s.name}</span>
                      </li>
                    ))}
                </ul>
              </>
            ) : (
              <p className="map-editor-hint">Виберіть маршрут для редагування порядку зупинок.</p>
            )
          ) : null}
        </div>
      </div>

      {modalStop && directionEditorActive && (
        <div className="map-editor-modal-overlay" onClick={() => setModalStop(null)}>
          <div className="map-editor-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="map-editor-modal-title">Зупинка: {modalStop}</h3>
            <p className="map-editor-modal-hint">Номер по напрямку або -1 (виключити):</p>
            <div className="map-editor-modal-options">
              {Array.from({ length: Math.max(routeStopsForDirection.length, 20) }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className="map-editor-modal-opt"
                  onClick={() => handleStopOrderChange(modalStop, n)}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                className="map-editor-modal-opt map-editor-modal-opt--exclude"
                onClick={() => handleStopOrderChange(modalStop, -1)}
              >
                -1 (виключити)
              </button>
            </div>
            <p className="map-editor-modal-hint map-editor-modal-copy-heading">Скопіювати зупинку в маршрут:</p>
            <div className="map-editor-modal-copy-routes">
              {routeOptions
                .filter((o) => o.value && o.value !== selectedRoute)
                .map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="map-editor-modal-opt map-editor-modal-opt--copy"
                    onClick={() => handleCopyStopToRoute(modalStop, o.value)}
                  >
                    {o.label}
                  </button>
                ))}
            </div>
            <button type="button" className="map-editor-modal-close" onClick={() => setModalStop(null)}>
              Скасувати
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
