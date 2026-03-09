import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const STOPS_COORDS_URL = '/data/stops_coords.json';

interface RouteMapProps {
  /** Зупинки, які входять до маршруту в поточному напрямку (виключені не показуються) */
  stopNames: string[];
  /** Перша зупинка в напрямку (from) */
  startStopName?: string;
  /** Остання зупинка в напрямку (to) */
  endStopName?: string;
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
const startIcon = createCircleIcon('#2563eb', 18);
const endIcon = createCircleIcon('#f97316', 18);

export const RouteMap: React.FC<RouteMapProps> = ({
  stopNames,
  startStopName,
  endStopName,
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
          {stopsWithCoords.map((n) => {
            const isStart = n === startStopName;
            const isEnd = n === endStopName;
            const icon = isStart ? startIcon : isEnd ? endIcon : defaultIcon;
            return (
              <Marker key={n} position={coords.stops[n] as [number, number]} icon={icon}>
                <Popup>{n}</Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
};
