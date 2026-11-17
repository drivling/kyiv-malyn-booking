import type { CSSProperties } from 'react';
import { WallBadges } from './WallBadges';
import { WallTalon } from './WallTalon';
import { newcomerHeadline, plural, schemePalette, seeded, textOn, type Celebration, type WallTicket } from './stickerWall';

const PIECES = 30;
/** Тизер «Крапка»: біле тло, блакитна крапка, темно-бірюзовий текст (video/src/brand/tokens.ts, сторінка /dovede) */
const DOT = '#00aff5';
const INK = '#054752';
/** Штамп «щасливий» і щелепа компостера на талоні */
const STAMP_RED = '#c62828';
const DEVICE: Record<string, string> = { ios: 'iPhone', android: 'Android', desktop: 'компʼютер' };
const WHO: Record<string, string> = { admin: 'адмін', guest: 'гість із паролем' };

/** Підпис під талоном: що дивився, з чого, хто (адмін, гість, пасажир із наклейок), скільки квитків сьогодні */
function ticketMeta(t: WallTicket): string[] {
  return [
    t.watched ? 'досмотрів ролик' : 'ролик не завантажився',
    t.device ? DEVICE[t.device] ?? null : null,
    t.access ? WHO[t.access] ?? null : null,
    t.passenger ? `пасажир № ${t.passenger} з наклейок` : null,
  ].filter((x): x is string => !!x);
}

/**
 * Святкування нового відкриття: екран заливає колір лінії зупинки, від центру розходяться кола
 * «як від QR», летять конфеті в кольорах схеми; назва зупинки, лінії, «+1» і скільки вже сьогодні.
 * Новий пасажир (`newcomer` — досмотрів тизер, тобто прийшов уперше) — відлуння самого тизера: біле тло, блакитна
 * крапка падає й тричі підскакує («тук-тук-тук» у wallSound.ts), «дзинь» — і кола «ви тут» від крапки.
 * Квиток (`ticket` — на /dovede подивилися ролик і прокомпостували талон) — той самий талон, що на сайті: компостер
 * пробиває три дірки, штамп «щасливий» («клац», «тук» і «дзинь» у wallSound.ts), тоді конфеті.
 */
export function WallCelebration({ celebration: c }: { celebration: Celebration }) {
  const rnd = seeded(c.key);
  const newcomer = c.kind === 'newcomer';
  const ticket = c.kind === 'ticket' ? c.ticket ?? null : null;
  const white = newcomer || c.kind === 'ticket';
  const palette = ticket
    ? [DOT, DOT, INK, STAMP_RED, '#ffd34d', ...schemePalette()]
    : newcomer
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
  const fg = white ? INK : textOn(c.color);
  const special = white || c.kind === 'first' || c.kind === 'milestone' || c.kind === 'record';
  // рубіж номера пасажира (10-й, 100-й…) — заголовок більший
  const milestone = newcomer && newcomerHeadline(c.passenger).milestone;
  return (
    <div
      className={`wall-cele wall-cele--${c.kind}`}
      style={{ '--c': white ? DOT : c.color, '--fg': fg } as CSSProperties}
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
        {ticket ? (
          <>
            <h2 className="wall-sr">Квиток «Доведе»</h2>
            <WallTalon ticket={ticket} />
            <p className="wall-cele-meta">
              {ticketMeta(ticket).join(' · ')} ·{' '}
              <span className="wall-cele-nowrap">
                квитків сьогодні <b>{ticket.today}</b>
              </span>
            </p>
          </>
        ) : (
          <WallCeleBody c={c} newcomer={newcomer} />
        )}
      </div>
    </div>
  );
}

function WallCeleBody({ c, newcomer }: { c: Celebration; newcomer: boolean }) {
  return (
    <>
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
    </>
  );
}
