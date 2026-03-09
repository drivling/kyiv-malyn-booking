import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const STOPS_COORDS_URL = '/data/stops_coords.json';

/** Маршрути з перевіреною трасою — на карті малюється пунктир і стрілочки напрямку */
const VERIFIED_ROUTE_IDS = ['5', '11'];

interface RouteMapProps {
  /** Номер маршруту (для перевірених малюємо лінію) */
  routeId?: string;
  /** Зупинки, які входять до маршруту в поточному напрямку (виключені не показуються) */
  stopNames: string[];
  /** Зупинка «З» (підсвічується окремо) */
  fromStopName?: string;
  /** Зупинка «До» (підсвічується окремо) */
  toStopName?: string;
}

interface CoordsData {
  center: [number, number];
  stops: Record<string, [number, number]>;
}

function MapBounds({ stopNames, stops }: { stopNames: string[]; stops: Record<string, [number, number]> }) {
  const map = useMap();
  useEffect(() => {
    const withCoords = stopNames.filter((n) => stops[n]);
    if (withCoords.length > 1) {
      const bounds = withCoords.map((n) => stops[n] as [number, number]);
      map.fitBounds(bounds as [number, number][], { padding: [30, 30], maxZoom: 15 });
    }
  }, [map, stopNames, stops]);
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

const defaultIcon = createCircleIcon('#00A86B', 14);
const fromIcon = createCircleIcon('#2563eb', 18);
const toIcon = createCircleIcon('#f97316', 18);

function createArrowIcon(angleDeg: number) {
  return L.divIcon({
    className: 'lt-map-arrow',
    html: `<span style="
      display:inline-block;
      width:0;
      height:0;
      border-left:5px solid transparent;
      border-right:5px solid transparent;
      border-bottom:8px solid rgba(0,0,0,0.25);
      transform:rotate(${angleDeg}deg);
    "></span>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

export const RouteMap: React.FC<RouteMapProps> = ({
  routeId,
  stopNames,
  fromStopName,
  toStopName,
}) => {
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

  if (!mounted || !coords || stopNames.length === 0) return null;

  const stopsWithCoords = stopNames.filter((n) => coords.stops[n]);
  const positions = stopsWithCoords.map((n) => coords.stops[n] as [number, number]);
  const showRouteLine = routeId && VERIFIED_ROUTE_IDS.includes(routeId) && positions.length >= 2;

  return (
    <div className="lt-map-wrapper">
      <h3 className="lt-map-heading">Карта маршруту</h3>
      <div className="lt-map-container">
        <MapContainer
          center={coords.center}
          zoom={13}
          className="lt-map"
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapBounds stopNames={stopNames} stops={coords.stops} />
          {showRouteLine && (
            <>
              <Polyline
                positions={positions}
                pathOptions={{
                  color: 'rgba(0,0,0,0.25)',
                  weight: 2,
                  opacity: 0.8,
                  dashArray: '6, 8',
                }}
              />
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
                    icon={createArrowIcon(angleDeg)}
                    zIndexOffset={0}
                  />
                );
              })}
            </>
          )}
          {stopsWithCoords.map((n) => {
            const isFrom = n === fromStopName;
            const isTo = n === toStopName;
            const icon = isFrom ? fromIcon : isTo ? toIcon : defaultIcon;
            return (
              <Marker key={n} position={coords.stops[n] as [number, number]} icon={icon}>
                <Popup>{n}{isFrom ? ' (З)' : isTo ? ' (До)' : ''}</Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
};
