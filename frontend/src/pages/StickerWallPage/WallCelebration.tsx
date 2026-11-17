import type { CSSProperties } from 'react';
import { WallBadges } from './WallBadges';
import { newcomerHeadline, plural, schemePalette, textOn, type Celebration } from './stickerWall';

const PIECES = 30;
/** Тизер «Крапка»: біле тло, блакитна крапка, темно-бірюзовий текст (video/src/brand/tokens.ts, сторінка /dovede) */
const DOT = '#00aff5';
const INK = '#054752';

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
 * Новий пасажир (`newcomer` — досмотрів тизер, тобто прийшов уперше) — відлуння самого тизера: біле тло, блакитна
 * крапка падає й тричі підскакує («тук-тук-тук» у wallSound.ts), «дзинь» — і кола «ви тут» від крапки.
 */
export function WallCelebration({ celebration: c }: { celebration: Celebration }) {
  const rnd = seeded(c.key);
  const newcomer = c.kind === 'newcomer';
  const palette = newcomer
    ? [DOT, DOT, INK, ...c.lines.map((l) => l.color).filter((x): x is string => !!x), ...schemePalette()]
    : [c.color, ...c.lines.map((l) => l.color).filter((x): x is string => !!x), ...schemePalette(), '#ffffff'];
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
  const fg = newcomer ? INK : textOn(c.color);
  const special = newcomer || c.kind === 'first' || c.kind === 'milestone' || c.kind === 'record';
  // рубіж номера пасажира (10-й, 100-й…) — заголовок більший
  const milestone = newcomer && newcomerHeadline(c.passenger).milestone;
  return (
    <div
      className={`wall-cele wall-cele--${c.kind}`}
      style={{ '--c': newcomer ? DOT : c.color, '--fg': fg } as CSSProperties}
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
        <p className={`wall-cele-headline${special ? ' wall-cele-headline--special' : ''}${milestone ? ' wall-cele-headline--milestone' : ''}`}>{c.headline}</p>
        <h2 className="wall-cele-name">{c.name}</h2>
        <WallBadges lines={c.lines} max={8} />
        {newcomer ? (
          <div className="wall-cele-dot-stage" aria-hidden="true">
            <span className="wall-cele-dot" />
          </div>
        ) : (
          <div className="wall-cele-plus" aria-hidden="true">
            +{c.added}
          </div>
        )}
        <p className="wall-cele-meta">
          {newcomer ? (
            <>
              {c.stopId ? 'уперше тут — досмотрів тизер «Доведе»' : 'досмотріли тизер «Доведе»'} · нових сьогодні{' '}
              <b>{c.newToday ?? c.added}</b>
            </>
          ) : c.stopId ? (
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
