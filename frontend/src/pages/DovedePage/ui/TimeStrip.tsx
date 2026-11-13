import type { Story } from '../compose/types';
import { stripSegments } from './stripSegments';

/**
 * Міні-смуга часу для згорнутих варіантів (Docs/dovede-roadmap.md, фаза 3): усі варіанти на одній шкалі
 * `from…to`, тож видно, який раніше виїжджає і де довше чекати. Декоративна — текст поруч каже те саме.
 */
export function TimeStrip({ story, from, to }: { story: Story; from: number; to: number }) {
  const span = Math.max(1, to - from);
  const pct = (m: number) => `${Math.min(100, Math.max(0, ((m - from) / span) * 100)).toFixed(2)}%`;
  return (
    <span className="dv-strip" aria-hidden="true">
      {stripSegments(story).map((s, i) => (
        <span
          key={i}
          className={`dv-strip__seg dv-strip__seg--${s.cls}`}
          style={{ ...s.style, left: pct(s.start), width: `${Math.max(1.5, ((Math.min(s.end, to) - Math.max(s.start, from)) / span) * 100).toFixed(2)}%` }}
        />
      ))}
    </span>
  );
}
