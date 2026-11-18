import type { CSSProperties, ReactNode } from 'react';
import type { CityStep, StoryLeg } from '../compose/types';
import { RIDE_COLOR, RIDE_NAME, funicularWay, rideLook, stationName, type RideLook } from '../compose/cityTransit';
import { checkedAgo, durationText, stopsText } from './format';

type CityRide = Extract<StoryLeg, { kind: 'cityRide' }>;

/** Маленькі силуети виду транспорту (декор: вид названо й словом) */
function Glyph({ look }: { look: RideLook }) {
  const common = { width: 26, height: 26, viewBox: '0 0 26 26', 'aria-hidden': true, focusable: false } as const;
  switch (look) {
    case 'trolleybus':
      return (
        <svg {...common}>
          <path d="M9 2 L12 7 M17 2 L14 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="5" y="7" width="16" height="14" rx="3" fill="currentColor" />
          <rect x="7.5" y="9.5" width="11" height="5" rx="1" fill="#fff" opacity=".85" />
          <circle cx="9" cy="22.5" r="1.6" fill="currentColor" />
          <circle cx="17" cy="22.5" r="1.6" fill="currentColor" />
        </svg>
      );
    case 'tram':
    case 'speedTram':
      return (
        <svg {...common}>
          <path d="M9 4 L13 7 L17 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
          <rect x="6" y="7" width="14" height="14" rx={look === 'speedTram' ? 5 : 2} fill="currentColor" />
          <rect x="8.5" y="9.5" width="9" height="5" rx="1" fill="#fff" opacity=".85" />
          <path d="M4 24 H22" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case 'minibus':
      return (
        <svg {...common}>
          <path d="M4 18 V10 Q4 7 7 7 H16 L21 12 V18 Z" fill="currentColor" />
          <path d="M16.5 8.5 L19.5 12 H16.5 Z" fill="#fff" opacity=".85" />
          <rect x="6" y="9" width="8" height="3.5" rx="0.8" fill="#fff" opacity=".85" />
          <circle cx="8" cy="19.5" r="2" fill="currentColor" />
          <circle cx="17" cy="19.5" r="2" fill="currentColor" />
        </svg>
      );
    case 'funicular':
      return (
        <svg {...common}>
          <path d="M2 22 L24 6" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9 13 L17 7.5 L19 11 L11 16.5 Z" fill="currentColor" />
        </svg>
      );
    case 'rail':
      return (
        <svg {...common}>
          <rect x="6" y="3" width="14" height="17" rx="4" fill="currentColor" />
          <rect x="8.5" y="6" width="9" height="5" rx="1" fill="#fff" opacity=".85" />
          <path d="M8 24 L10 20 M18 24 L16 20" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case 'subway':
      return (
        <svg {...common}>
          <circle cx="13" cy="13" r="10" fill="currentColor" />
          <text x="13" y="17.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">
            М
          </text>
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="4" y="5" width="18" height="15" rx="3" fill="currentColor" />
          <rect x="6.5" y="7.5" width="13" height="5" rx="1" fill="#fff" opacity=".85" />
          <circle cx="8.5" cy="21.5" r="1.8" fill="currentColor" />
          <circle cx="17.5" cy="21.5" r="1.8" fill="currentColor" />
        </svg>
      );
  }
}

function Facts({ s, look }: { s: CityStep; look: RideLook }) {
  const facts = [
    look !== 'funicular' && s.headsign ? `у бік «${look === 'speedTram' ? stationName(s.headsign) : s.headsign}»` : null,
    look !== 'funicular' && s.stops ? stopsText(s.stops) : null,
    `≈ ${durationText(s.minutes)}`,
    s.headwayMin ? `кожні ≈ ${s.headwayMin} хв` : null,
  ].filter(Boolean);
  return <p className="dv-ride__facts">{facts.join(' · ')}</p>;
}

/** Табличка маршруту: вид словом, номер великим; форма й колір — за видом */
function Sign({ s, look }: { s: CityStep; look: RideLook }) {
  return (
    <span className="dv-ride__sign" aria-label={`${RIDE_NAME[look]} ${s.line ?? ''}`.trim()}>
      <Glyph look={look} />
      <span className="dv-ride__kind">{look === 'speedTram' ? 'швидкісний' : RIDE_NAME[look]}</span>
      {s.line && look !== 'funicular' ? <b>{s.line}</b> : null}
    </span>
  );
}

/** Швидкісний трамвай: окрема лінія зі станціями — схема «як у вагоні», крапка на кожну зупинку */
function SpeedLine({ s }: { s: CityStep }) {
  const n = Math.max(1, Math.min(s.stops ?? 1, 14));
  return (
    <ol className="dv-ride__line" aria-label={`від «${stationName(s.fromStop)}» до «${stationName(s.toStop)}»`}>
      {Array.from({ length: n + 1 }, (_, k) => (
        <li key={k} className={k === 0 || k === n ? 'is-end' : undefined} style={{ '--dv-k': k } as CSSProperties}>
          <span className="dv-ride__dot" aria-hidden="true" />
          {k === 0 ? <span className="dv-ride__st">{stationName(s.fromStop)}</span> : k === n ? <span className="dv-ride__st">{stationName(s.toStop)}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** Фунікулер: схил із двома станціями, вагончик на рейці, стрілка вгору чи вниз */
function Funicular({ l }: { l: CityRide }) {
  const way = funicularWay(l.city, l.step);
  const from = way?.from ?? l.step.fromStop ?? 'станція';
  const to = way?.to ?? l.step.toStop ?? 'станція';
  return (
    <div className={`dv-ride__hill${way && !way.up ? ' is-down' : ''}`}>
      <svg viewBox="0 0 240 110" role="img" aria-label={`Фунікулер ${way ? (way.up ? 'вгору' : 'вниз') : ''}: «${from}» → «${to}»`.replace('  ', ' ')}>
        <path className="dv-ride__slope" d="M0 110 L0 96 Q60 92 120 56 T240 14 L240 110 Z" />
        <path className="dv-ride__track" d="M28 92 L212 22" />
        <path className="dv-ride__track dv-ride__track--rail" d="M28 98 L212 28" />
        <rect className="dv-ride__house" x="6" y="84" width="34" height="18" rx="2" />
        <rect className="dv-ride__house" x="200" y="8" width="34" height="18" rx="2" />
        <g className="dv-ride__cab">
          <rect x="-16" y="-11" width="32" height="18" rx="3" transform="rotate(-21)" />
          <rect className="dv-ride__win" x="-11" y="-8" width="9" height="6" rx="1" transform="rotate(-21)" />
          <rect className="dv-ride__win" x="2" y="-8" width="9" height="6" rx="1" transform="rotate(-21)" />
        </g>
      </svg>
      <p className="dv-ride__ends">
        <span>
          <small>{way ? (way.up ? 'нижня станція' : 'верхня станція') : 'звідки'}</small>
          {from}
        </span>
        <span aria-hidden="true" className="dv-ride__arrow">
          {way ? (way.up ? '↗' : '↙') : '→'}
        </span>
        <span>
          <small>{way ? (way.up ? 'верхня станція' : 'нижня станція') : 'куди'}</small>
          {to}
        </span>
      </p>
    </div>
  );
}

/**
 * Одна поїздка з відповіді сервера (Docs/dovede-roadmap.md, «Картки видів транспорту в дорозі містом»): автобус,
 * маршрутка, тролейбус (дроти над карткою), трамвай (рейки під табличкою), швидкісний трамвай (своя лінія зі
 * станціями), фунікулер (схил), приміська електричка. Звідки дані — не пишемо (рішення власника 2026-11-17): лише
 * «перевірено N днів тому» в останній поїздці відповіді.
 */
export function CityRideCard({ l }: { l: CityRide }) {
  const s = l.step;
  const look = rideLook(s);
  let body: ReactNode;
  if (look === 'funicular') body = <Funicular l={l} />;
  else
    body = (
      <>
        <div className="dv-ride__top">
          <Sign s={s} look={look} />
          <p className="dv-ride__stops">
            <b>{look === 'speedTram' ? stationName(s.fromStop) : s.fromStop ?? 'зупинка'}</b>
            <span aria-hidden="true"> → </span>
            <span className="dv-sr-only">до</span>
            <b>{look === 'speedTram' ? stationName(s.toStop) : s.toStop ?? 'зупинка'}</b>
          </p>
        </div>
        {look === 'speedTram' ? <SpeedLine s={s} /> : null}
      </>
    );
  return (
    <div className={`dv-ride dv-ride--${look}`} style={{ '--dv-rc': RIDE_COLOR[look] } as CSSProperties}>
      {body}
      <Facts s={s} look={look} />
      {s.agency ? <p className="dv-ride__agency">{s.agency}</p> : null}
      {l.checkedAt || l.mapsUrl ? (
        <div className="dv-ride__foot">
          {l.checkedAt ? <small>перевірено {checkedAgo(l.checkedAt)} · час приблизний</small> : <span />}
          {l.mapsUrl ? (
            <a className="dv-city__maps" href={l.mapsUrl} target="_blank" rel="noopener noreferrer">
              Google Maps ↗
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
