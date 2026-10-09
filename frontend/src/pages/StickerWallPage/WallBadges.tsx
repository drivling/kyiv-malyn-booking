import { SCHEME_PALETTE, textOn, type WallLine } from './stickerWall';

/** Плашки номерів ліній у кольорах схеми (як на наклейці) */
export function WallBadges({ lines, max = 6 }: { lines: WallLine[]; max?: number }) {
  if (!lines.length) return null;
  const shown = lines.slice(0, max);
  return (
    <span className="wall-badges" aria-label={`Маршрути ${lines.map((l) => `№${l.routeId}`).join(', ')}`}>
      {shown.map((l) => {
        const bg = l.color ?? SCHEME_PALETTE[0] ?? '#2a78d6';
        return (
          <span key={l.routeId} className="wall-badge" style={{ background: bg, color: textOn(bg) }} aria-hidden="true">
            {l.routeId}
          </span>
        );
      })}
      {lines.length > shown.length && (
        <span className="wall-badge wall-badge--more" aria-hidden="true">
          +{lines.length - shown.length}
        </span>
      )}
    </span>
  );
}
