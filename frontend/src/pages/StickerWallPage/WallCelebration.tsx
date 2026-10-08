import type { CSSProperties } from 'react';
import { WallBadges } from './WallBadges';
import { SCHEME_PALETTE, plural, textOn, type Celebration } from './stickerWall';

const PIECES = 30;

/** Детерміноване «випадкове» число з ключа святкування — конфеті різне, але стабільне між рендерами */
function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * Святкування нового відкриття: екран заливає колір лінії зупинки, від центру розходяться кола
 * «як від QR», летять конфеті в кольорах схеми; назва зупинки, лінії, «+1» і скільки вже сьогодні.
 */
export function WallCelebration({ celebration: c }: { celebration: Celebration }) {
  const rnd = seeded(c.key);
  const palette = [c.color, ...c.lines.map((l) => l.color).filter((x): x is string => !!x), ...SCHEME_PALETTE, '#ffffff'];
  const pieces = Array.from({ length: PIECES }, (_, i) => {
    const angle = rnd() * Math.PI * 2;
    const dist = 28 + rnd() * 34;
    return {
      i,
      style: {
        '--dx': `${Math.cos(angle) * dist}vw`,
        '--dy': `${Math.sin(angle) * dist}vh`,
        '--rot': `${Math.round(rnd() * 720 - 360)}deg`,
        '--delay': `${Math.round(rnd() * 350)}ms`,
        '--size': `${0.45 + rnd() * 0.7}em`,
        background: palette[Math.floor(rnd() * palette.length)],
        borderRadius: rnd() > 0.5 ? '50%' : '0.15em',
      } as CSSProperties,
    };
  });
  const fg = textOn(c.color);
  const special = c.kind === 'first' || c.kind === 'milestone' || c.kind === 'record';
  return (
    <div
      className={`wall-cele wall-cele--${c.kind}`}
      style={{ '--c': c.color, '--fg': fg } as CSSProperties}
      role="status"
      aria-live="assertive"
      aria-label={`${c.headline}: ${c.name}`}
    >
      <div className="wall-cele-bg" aria-hidden="true" />
      <div className="wall-cele-rings" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="wall-cele-confetti" aria-hidden="true">
        {pieces.map((p) => (
          <span key={p.i} style={p.style} />
        ))}
      </div>
      <div className="wall-cele-body">
        <p className={`wall-cele-headline${special ? ' wall-cele-headline--special' : ''}`}>{c.headline}</p>
        <h2 className="wall-cele-name">{c.name}</h2>
        <WallBadges lines={c.lines} max={8} />
        <div className="wall-cele-plus" aria-hidden="true">
          +{c.added}
        </div>
        <p className="wall-cele-meta">
          {c.stopId ? (
            <>
              сьогодні вже <b>{c.stopToday}</b> {plural(c.stopToday, ['відкриття', 'відкриття', 'відкриттів'])}
              {c.rank > 0 && <> · №{c.rank} серед зупинок</>} · усього {c.totalAfter}
            </>
          ) : (
            <>
              усього сьогодні <b>{c.totalAfter}</b>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
