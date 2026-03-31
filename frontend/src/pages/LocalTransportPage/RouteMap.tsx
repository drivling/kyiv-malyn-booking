import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { VERIFIED_ROUTE_IDS } from './routeTiming';

const STOPS_COORDS_URL = '/data/stops_coords.json';

interface RouteMapProps {
  /** Номер маршруту (для перевірених малюємо лінію) */
  routeId?: string;
  /** Усі точки маршруту в порядку (для полілінії, включно з технічними для поворотів) */
  stopNames: string[];
  /** Якщо задано — маркери тільки для цих зупинок; технічні (map_only) не показуються */
  markerStopNames?: string[];
  /** Зупинка «З» (підсвічується окремо) */
  fromStopName?: string;
  /** Зупинка «До» (підсвічується окремо) */
  toStopName?: string;
  /** Темна тема + зелена лінія (як Jakdojade) */
  dark?: boolean;
  /** Клік по зупинці: вибрати як "Звідси" */
  onPickFromStop?: (stopName: string) => void;
  /** Клік по зупинці: вибрати як "ПО" */
  onPickToStop?: (stopName: string) => void;
  /** Поміняти "З" та "ПО" місцями */
  onSwapStops?: () => void;
  /** Часті кінцеві зупинки для швидкого вибору "ПО" */
  frequentToStops?: string[];
  /** Тап по маркеру зупинки (наприклад розгорнути mobile sheet карти) */
  onStopMarkerActivate?: () => void;
  /** Стан mobile bottom-sheet: при зміні викликається invalidateSize для коректних тайлів */
  mapSheetSnap?: 'collapsed' | 'mid' | 'full' | null;
}

interface CoordsData {
  center: [number, number];
  stops: Record<string, [number, number]>;
}

function MapBounds({
  stopNames,
  stops,
  padding = [30, 30],
}: {
  stopNames: string[];
  stops: Record<string, [number, number]>;
  padding?: [number, number];
}) {
  const map = useMap();
  useEffect(() => {
    const withCoords = stopNames.filter((n) => stops[n]);
    if (withCoords.length >= 1) {
      const bounds = withCoords.map((n) => stops[n] as [number, number]);
      map.fitBounds(bounds as [number, number][], { padding, maxZoom: 16 });
    }
  }, [map, stopNames, stops, padding]);
  return null;
}

function MapViewportEvents({ onViewportChange }: { onViewportChange: () => void }) {
  useMapEvents({
    move: onViewportChange,
    zoom: onViewportChange,
    resize: onViewportChange,
  });
  return null;
}

/**
 * Після показу карти з display:none / анімації висоти (mobile sheet) Leaflet має нульовий розмір —
 * тайли сірі, частина підписів не дорисовується. invalidateSize + відкладені повтори це виправляють.
 */
function MapSizeAfterLayout({
  sheetSnap,
}: {
  sheetSnap?: 'collapsed' | 'mid' | 'full' | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (sheetSnap === undefined || sheetSnap === null) return;
    if (sheetSnap === 'collapsed') return;

    const refresh = () => {
      map.invalidateSize({ animate: false, pan: false });
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) {
          layer.redraw();
        }
      });
    };

    refresh();
    const t1 = window.setTimeout(refresh, 50);
    const t2 = window.setTimeout(refresh, 230);
    const t3 = window.setTimeout(refresh, 450);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [map, sheetSnap]);
  return null;
}

function createCircleIcon(color: string, size = 16) {
  return L.divIcon({
    className: 'lt-map-marker',
    html: `<span style="
      display:inline-block;
      width:${size}px;
      height:${size}px;
      border-radius:999px;
      background:${color};
      border:2px solid #ffffff;
      box-shadow:0 1px 3px rgba(0,0,0,0.4);
    "></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const defaultIcon = createCircleIcon('#1a73e8', 14);
const fromIcon = createCircleIcon('#34a853', 18);
const toIcon = createCircleIcon('#1a73e8', 18);

const fromIconGreen = createCircleIcon('#8ab4f8', 18);
const toIconBlue = createCircleIcon('#f28b82', 18);

const ROUTE_LINE_COLOR = '#1a73e8'; // синій — весь маршрут
const ROUTE_LINE_GREEN = '#8ab4f8';
const FROM_TO_SEGMENT_COLOR = '#FF8C00'; // жовтогарячий — тільки ділянка між обраними точками З → До
const FROM_TO_SEGMENT_GREEN = '#FF6600';

function createArrowIcon(angleDeg: number, color: string) {
  return L.divIcon({
    className: 'lt-map-arrow',
    html: `<span style="
      display:inline-block;
      width:0;
      height:0;
      border-left:5px solid transparent;
      border-right:5px solid transparent;
      border-bottom:8px solid ${color};
      transform:rotate(${angleDeg}deg);
    "></span>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

const LIGHT_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Центр Малина — fallback коли координати ще не завантажились */
const MALYN_CENTER: [number, number] = [50.768, 29.242];

export const RouteMap: React.FC<RouteMapProps> = ({
  routeId,
  stopNames,
  markerStopNames,
  fromStopName,
  toStopName,
  dark = false,
  onPickFromStop,
  onPickToStop,
  onSwapStops,
  frequentToStops = [],
  onStopMarkerActivate,
  mapSheetSnap,
}) => {
  const lineColor = dark ? ROUTE_LINE_GREEN : ROUTE_LINE_COLOR;
  const segmentColor = dark ? FROM_TO_SEGMENT_GREEN : FROM_TO_SEGMENT_COLOR;
  const fromI = dark ? fromIconGreen : fromIcon;
  const toI = dark ? toIconBlue : toIcon;
  const [coords, setCoords] = useState<CoordsData | null>(null);
  const [mounted, setMounted] = useState(false);
  const [selectedStopOnMap, setSelectedStopOnMap] = useState<string>('');
  const [radialPosition, setRadialPosition] = useState<{ x: number; y: number } | null>(null);
  const [mapRef, setMapRef] = useState<L.Map | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    fetch(STOPS_COORDS_URL)
      .then((r) => r.json())
      .then(setCoords)
      .catch(() => setCoords(null));
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      // Власні іконки, тому дефолтні URL можна не задавати
      L.Icon.Default.mergeOptions({});
    }
  }, []);

  const center = coords?.center ?? MALYN_CENTER;
  const stopsRecord = coords?.stops ?? {};
  const stopsWithCoords = stopNames.length > 0 ? stopNames.filter((n) => stopsRecord[n]) : [];
  const positions = stopsWithCoords.map((n) => stopsRecord[n] as [number, number]);
  const namesForMarkers = (markerStopNames != null && markerStopNames.length > 0 ? markerStopNames : stopNames).filter(
    (n) => stopsRecord[n]
  );
  const showRouteLine = routeId && (VERIFIED_ROUTE_IDS as readonly string[]).includes(routeId) && positions.length >= 2;
  const hasAnyStops = positions.length > 0;
  const hasBothStops = Boolean(fromStopName && toStopName);
  const hasOneStop = Boolean((fromStopName && !toStopName) || (!fromStopName && toStopName));
  const secondStepHint = fromStopName && !toStopName
    ? 'Обрано "Звідси". Тепер виберіть куди їхати.'
    : toStopName && !fromStopName
      ? 'Обрано "ПО". Тепер виберіть звідки їхати.'
      : '';
  const filteredFrequentToStops = frequentToStops.filter((n) => n && n !== fromStopName && n !== toStopName).slice(0, 3);

  useEffect(() => {
    const stops = coords?.stops ?? {};
    if (!selectedStopOnMap || !mapRef || !stops[selectedStopOnMap]) {
      setRadialPosition(null);
      return;
    }
    const [lat, lng] = stops[selectedStopOnMap];
    const p = mapRef.latLngToContainerPoint([lat, lng]);
    setRadialPosition({ x: p.x, y: p.y });
  }, [selectedStopOnMap, mapRef, coords]);

  if (!mounted) return null;

  const updateRadialPosition = () => {
    if (!selectedStopOnMap || !mapRef || !stopsRecord[selectedStopOnMap]) return;
    const [lat, lng] = stopsRecord[selectedStopOnMap];
    const p = mapRef.latLngToContainerPoint([lat, lng]);
    setRadialPosition({ x: p.x, y: p.y });
  };

  // Ділянка між зупинками «З» та «До» — індекси в порядку маршруту (по повному списку для лінії)
  const fromIdx = fromStopName ? stopsWithCoords.indexOf(fromStopName) : -1;
  const toIdx = toStopName ? stopsWithCoords.indexOf(toStopName) : -1;
  const hasFromToSegment =
    showRouteLine && fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx;
  const segmentStart = hasFromToSegment ? Math.min(fromIdx, toIdx) : 0;
  const segmentEnd = hasFromToSegment ? Math.max(fromIdx, toIdx) + 1 : 0;
  const fromToPositions = hasFromToSegment ? positions.slice(segmentStart, segmentEnd) : [];

  // Зум: якщо вибрано З і До — підлаштовуємо видиму область під цю ділянку з невеликим відступом
  const boundsStopNames = hasFromToSegment
    ? stopsWithCoords.slice(segmentStart, segmentEnd)
    : stopsWithCoords;
  const boundsPadding: [number, number] = hasFromToSegment ? [50, 50] : [30, 30];
  const showBounds = boundsStopNames.length >= 1;

  return (
    <div className={`lt-map-wrapper ${dark ? 'lt-map-wrapper--dark' : ''}`}>
      <div className="lt-direction-strip" aria-label="Обрані зупинки">
        <span className="lt-direction-strip__from">З {fromStopName || '—'}</span>
        <button
          type="button"
          className="lt-direction-strip__swap"
          onClick={onSwapStops}
          disabled={!hasBothStops}
          title="Поміняти місцями"
          aria-label="Поміняти місцями З та ПО"
        >
          ⇄
        </button>
        <span className="lt-direction-strip__to">ПО {toStopName || '—'}</span>
      </div>
      {hasOneStop && secondStepHint && (
        <p className="lt-direction-strip__hint">{secondStepHint}</p>
      )}
      <h3 className="lt-map-heading">Карта маршруту</h3>
      <div className="lt-map-container">
        <MapContainer
          center={center}
          zoom={13}
          className="lt-map"
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
          ref={setMapRef}
          whenReady={updateRadialPosition}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url={dark ? LIGHT_TILES : LIGHT_TILES}
            updateWhenIdle={false}
            keepBuffer={2}
          />
          {mapSheetSnap !== undefined ? <MapSizeAfterLayout sheetSnap={mapSheetSnap} /> : null}
          {showBounds && <MapBounds stopNames={boundsStopNames} stops={stopsRecord} padding={boundsPadding} />}
          <MapViewportEvents onViewportChange={updateRadialPosition} />
          {hasAnyStops && showRouteLine && (
            <>
              {/* Весь маршрут — зелений */}
              <Polyline
                positions={positions}
                pathOptions={{
                  color: lineColor,
                  weight: 5,
                  opacity: 1,
                }}
              />
              {/* Ділянка між обраними З і До — жовтогарячий поверх */}
              {hasFromToSegment && fromToPositions.length >= 2 && (
                <Polyline
                  positions={fromToPositions}
                  pathOptions={{
                    color: segmentColor,
                    weight: 8,
                    opacity: 1,
                  }}
                />
              )}
              {positions.map((_, i) => {
                if (i === positions.length - 1) return null;
                const a = positions[i];
                const b = positions[i + 1];
                const midLat = (a[0] + b[0]) / 2;
                const midLng = (a[1] + b[1]) / 2;
                const angleDeg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
                return (
                  <Marker
                    key={`arrow-${i}`}
                    position={[midLat, midLng]}
                    icon={createArrowIcon(angleDeg, lineColor)}
                    zIndexOffset={0}
                  />
                );
              })}
            </>
          )}
          {hasAnyStops && namesForMarkers.map((n) => {
            const isFrom = n === fromStopName;
            const isTo = n === toStopName;
            const icon = isFrom ? fromI : isTo ? toI : defaultIcon;
            return (
              <Marker
                key={n}
                position={stopsRecord[n] as [number, number]}
                icon={icon}
                eventHandlers={{
                  click: () => {
                    setSelectedStopOnMap(n);
                    onStopMarkerActivate?.();
                  },
                }}
              >
                <Popup>
                  <div className="lt-stop-popup">
                    <div className="lt-stop-popup__title">
                      {n}
                      {isFrom ? ' (З)' : isTo ? ' (ПО)' : ''}
                    </div>
                    <div className="lt-stop-popup__actions">
                      <button type="button" onClick={() => onPickFromStop?.(n)}>З</button>
                      <button type="button" onClick={() => onPickToStop?.(n)}>ПО</button>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
        {selectedStopOnMap && radialPosition && (
          <div
            className="lt-radial-picker"
            style={{ left: radialPosition.x, top: radialPosition.y }}
            role="group"
            aria-label="Швидкий вибір З або ПО"
          >
            <button
              type="button"
              className="lt-radial-picker__btn lt-radial-picker__btn--from"
              onClick={() => {
                onPickFromStop?.(selectedStopOnMap);
                setSelectedStopOnMap('');
              }}
            >
              З
            </button>
            <button
              type="button"
              className="lt-radial-picker__btn lt-radial-picker__btn--to"
              onClick={() => {
                onPickToStop?.(selectedStopOnMap);
                setSelectedStopOnMap('');
              }}
            >
              ПО
            </button>
          </div>
        )}
      </div>
      {selectedStopOnMap && (
        <div className="lt-stop-sheet" role="dialog" aria-label="Вибір ролі зупинки">
          <div className="lt-stop-sheet__header">
            <strong>{selectedStopOnMap}</strong>
            <button type="button" onClick={() => setSelectedStopOnMap('')} aria-label="Закрити">
              ✕
            </button>
          </div>
          <div className="lt-stop-sheet__actions">
            <button
              type="button"
              className="lt-stop-sheet__btn lt-stop-sheet__btn--from"
              onClick={() => {
                onPickFromStop?.(selectedStopOnMap);
                setSelectedStopOnMap('');
              }}
            >
              Звідси (З)
            </button>
            <button
              type="button"
              className="lt-stop-sheet__btn lt-stop-sheet__btn--to"
              onClick={() => {
                onPickToStop?.(selectedStopOnMap);
                setSelectedStopOnMap('');
              }}
            >
              Сюди (ПО)
            </button>
          </div>
          {filteredFrequentToStops.length > 0 && (
            <div className="lt-stop-sheet__history">
              <span>Часто їду в…</span>
              <div className="lt-stop-sheet__chips">
                {filteredFrequentToStops.map((stop) => (
                  <button
                    key={stop}
                    type="button"
                    className="lt-stop-sheet__chip"
                    onClick={() => {
                      onPickToStop?.(stop);
                      setSelectedStopOnMap('');
                    }}
                  >
                    {stop}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
