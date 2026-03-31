import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
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
const fromIcon = createCircleIcon('#1967d2', 18);
const toIcon = createCircleIcon('#ea4335', 18);

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
}) => {
  const lineColor = dark ? ROUTE_LINE_GREEN : ROUTE_LINE_COLOR;
  const segmentColor = dark ? FROM_TO_SEGMENT_GREEN : FROM_TO_SEGMENT_COLOR;
  const fromI = dark ? fromIconGreen : fromIcon;
  const toI = dark ? toIconBlue : toIcon;
  const [coords, setCoords] = useState<CoordsData | null>(null);
  const [mounted, setMounted] = useState(false);

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

  if (!mounted) return null;

  const center = coords?.center ?? MALYN_CENTER;
  const stopsRecord = coords?.stops ?? {};
  const stopsWithCoords = stopNames.length > 0 ? stopNames.filter((n) => stopsRecord[n]) : [];
  const positions = stopsWithCoords.map((n) => stopsRecord[n] as [number, number]);
  const namesForMarkers = (markerStopNames != null && markerStopNames.length > 0 ? markerStopNames : stopNames).filter(
    (n) => stopsRecord[n]
  );
  const showRouteLine = routeId && (VERIFIED_ROUTE_IDS as readonly string[]).includes(routeId) && positions.length >= 2;
  const hasAnyStops = positions.length > 0;

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
      <h3 className="lt-map-heading">Карта маршруту</h3>
      <div className="lt-map-container">
        <MapContainer
          center={center}
          zoom={13}
          className="lt-map"
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url={dark ? LIGHT_TILES : LIGHT_TILES}
          />
          {showBounds && <MapBounds stopNames={boundsStopNames} stops={stopsRecord} padding={boundsPadding} />}
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
              <Marker key={n} position={stopsRecord[n] as [number, number]} icon={icon}>
                <Popup>{n}{isFrom ? ' (З)' : isTo ? ' (До)' : ''}</Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
};
