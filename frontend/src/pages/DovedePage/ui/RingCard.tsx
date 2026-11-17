import type { CSSProperties } from 'react';
import type { StoryLeg } from '../compose/types';
import { RING_COLOR, RING_ORDER, ringLeftBank } from '../data/kyivRing';
import { durationText } from './format';

type RingLeg = Extract<StoryLeg, { kind: 'ring' }>;

const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

function stationsText(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} станція`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} станції`;
  return `${n} станцій`;
}

const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
/** '2026-11-20' → «20 листопада» */
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

// ─── Циферблат ────────────────────────────────────────────────────────────────────────────────
// Кільце — 20 станцій через 18°, як поділки годинника: Святошин на «9 годині» (захід), Почайна на «12» (північ),
// лівий берег — праворуч, Вокзальна — унизу. Кут рахуємо від півночі за годинниковою стрілкою.
const SIZE = 240;
const C = SIZE / 2;
const R = 88;
const STEP = 360 / RING_ORDER.length;
const angleOf = (index: number) => (270 + index * STEP) % 360;
const at = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};
const xy = (deg: number, r: number) => at(deg, r).map((v) => v.toFixed(1)).join(' ');
const INDEX = new Map(RING_ORDER.map((st, i) => [st.id, i]));
/** Дніпро: входить між Почайною й Райдужним, виходить між Березняками й Видубичами; лівий берег лишається праворуч */
const RIVER = `M ${xy(9, 124)} C ${xy(28, 74)} ${xy(96, 60)} ${xy(135, 124)}`;
/** Підписи-орієнтири всередині кільця: чотири сторони світу */
const COMPASS: Array<{ id: string; r: number; anchor: 'start' | 'middle' | 'end'; dy: number }> = [
  { id: 'kyiv.e.sviatoshyn', r: 78, anchor: 'start', dy: 3 },
  { id: 'kyiv.e.pochaina', r: 72, anchor: 'middle', dy: 3 },
  { id: 'kyiv.e.darnytsia', r: 78, anchor: 'end', dy: 3 },
  { id: 'kyiv.e.vokzalna', r: 70, anchor: 'middle', dy: 3 },
];

function Dial({ l }: { l: RingLeg }) {
  const { ride } = l;
  const a0 = angleOf(INDEX.get(ride.from.id)!);
  const hops = ride.stops.length - 1;
  const sweep = hops * STEP * (ride.dir === 'cw' ? 1 : -1);
  const a1 = a0 + sweep;
  const color = ride.extra ? RING_COLOR.extra : RING_COLOR.main;
  const onRide = new Set(ride.stops.map((s) => s.station.id));
  const arc = `M ${xy(a0, R)} A ${R} ${R} 0 ${Math.abs(sweep) > 180 ? 1 : 0} ${sweep > 0 ? 1 : 0} ${xy(a1, R)}`;
  // стрілка-напрямок навколо номера рейсу: три чверті кола з вістрям у бік руху
  const cw = ride.dir === 'cw';
  const spin = `M ${xy(cw ? 200 : 160, 31)} A 31 31 0 1 ${cw ? 1 : 0} ${xy(cw ? 110 : 250, 31)}`;
  const [tx, ty] = at(cw ? 110 : 250, 31);
  // вістря дивиться вздовж руху: дотична до кола в його кінці
  const tipTurn = cw ? 110 : 70;
  return (
    <svg
      className="dv-ring__dial"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Схема кільця: від «${ride.from.name}» до «${ride.to.name}» ${cw ? 'за годинниковою стрілкою' : 'проти годинникової стрілки'}`}
      style={{ '--dv-ring-c': color, '--dv-ring-a0': `${a0}deg`, '--dv-ring-a1': `${a1}deg` } as CSSProperties}
    >
      <defs>
        <radialGradient id="dv-ring-face" cx="42%" cy="34%" r="78%">
          <stop offset="0" stopColor="#fffdf6" />
          <stop offset="0.7" stopColor="#f6f0df" />
          <stop offset="1" stopColor="#e6dcc3" />
        </radialGradient>
        <linearGradient id="dv-ring-bezel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f6f8" />
          <stop offset="0.35" stopColor="#9aa7b0" />
          <stop offset="0.6" stopColor="#e9eef1" />
          <stop offset="1" stopColor="#6c7b85" />
        </linearGradient>
        <linearGradient id="dv-ring-glass" x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="dv-ring-clip">
          <circle cx={C} cy={C} r="109" />
        </clipPath>
      </defs>
      {/* корпус: сталевий обідок і емальований циферблат */}
      <circle cx={C} cy={C} r="116" fill="url(#dv-ring-bezel)" />
      <circle cx={C} cy={C} r="110.5" fill="#55636c" />
      <circle cx={C} cy={C} r="109" fill="url(#dv-ring-face)" />
      <g clipPath="url(#dv-ring-clip)" aria-hidden="true">
        {/* Дніпро: між Почайною й Райдужним на півночі, між Березняками й Видубичами на півдні */}
        <path className="dv-ring__river" d={RIVER} />
        <path className="dv-ring__river-mid" d={RIVER} />
        <text className="dv-ring__river-name" x={at(58, 62)[0].toFixed(1)} y={at(58, 62)[1].toFixed(1)} transform={`rotate(66 ${xy(58, 62)})`} textAnchor="middle">
          Дніпро
        </text>
      </g>
      {/* колія й поділки-станції */}
      <circle className="dv-ring__track" cx={C} cy={C} r={R} />
      <g aria-hidden="true">
        {RING_ORDER.map((st, i) => {
          const a = angleOf(i);
          return <path key={st.id} className={`dv-ring__tick${onRide.has(st.id) ? ' is-on' : ''}`} d={`M ${xy(a, R + 3)} L ${xy(a, R + 11)}`} />;
        })}
        {COMPASS.map((c) => {
          const [x, y] = at(angleOf(INDEX.get(c.id)!), c.r);
          return (
            <text key={c.id} className="dv-ring__compass" x={x.toFixed(1)} y={(y + c.dy).toFixed(1)} textAnchor={c.anchor}>
              {RING_ORDER[INDEX.get(c.id)!].name}
            </text>
          );
        })}
      </g>
      {/* поїздка: дуга від посадки до виходу, стрілка годинника їде слідом */}
      <path className="dv-ring__arc" d={arc} pathLength={1} />
      <g className="dv-ring__hand" aria-hidden="true">
        <path d={`M ${C} ${C + 12} L ${C - 3.2} ${C} L ${C} ${C - R + 13} L ${C + 3.2} ${C} Z`} />
      </g>
      <circle className="dv-ring__from" cx={at(a0, R)[0].toFixed(1)} cy={at(a0, R)[1].toFixed(1)} r="6.5" />
      <g className="dv-ring__to">
        <circle cx={at(a1, R)[0].toFixed(1)} cy={at(a1, R)[1].toFixed(1)} r="8" />
        <circle cx={at(a1, R)[0].toFixed(1)} cy={at(a1, R)[1].toFixed(1)} r="3" />
      </g>
      {/* вісь: номер рейсу й напрямок */}
      <circle className="dv-ring__hub" cx={C} cy={C} r="26" />
      <g className="dv-ring__spin" aria-hidden="true">
        <path d={spin} />
        <path d="M -5 -4.5 L 4 0 L -5 4.5 Z" transform={`translate(${tx.toFixed(1)} ${ty.toFixed(1)}) rotate(${tipTurn})`} />
      </g>
      <text className="dv-ring__mark" x={C} y={C - 53} textAnchor="middle" aria-hidden="true">
        KYIV CITY EXPRESS
      </text>
      <text className="dv-ring__no" x={C} y={C + 7} textAnchor="middle">
        {ride.train}
      </text>
      {/* скло */}
      <circle cx={C} cy={C} r="109" fill="url(#dv-ring-glass)" pointerEvents="none" />
    </svg>
  );
}

/**
 * Міська електричка Києва в історії (Docs/dovede-roadmap.md, «Міська електричка Києва»): станційний годинник, у
 * якого замість цифр — 20 станцій кільця. Дуга показує поїздку, стрілка йде за нею в бік руху («за годинниковою
 * стрілкою» тут буквально), через скло тече Дніпро. Під годинником — дві таблички платформ з часом за розкладом,
 * унизу — картонний квиток з ціною. Додаткові рейси між берегами — сині, як на схемі перевізника.
 */
export function RingCard({ l }: { l: RingLeg }) {
  const { ride } = l;
  const hops = ride.stops.length - 1;
  const cw = ride.dir === 'cw';
  // поїздка буває і з правого берега на правий через лівий (Почайна → Видубичі) — це теж через Дніпро
  const crosses = new Set(ride.stops.map((s) => ringLeftBank(s.station.id))).size > 1;
  const color = ride.extra ? RING_COLOR.extra : RING_COLOR.main;
  return (
    <div className={`dv-ring${ride.extra ? ' dv-ring--extra' : ''}`} style={{ '--dv-ring-c': color } as CSSProperties}>
      <div className="dv-ring__head">
        <span className="dv-ring__brand">Міська електричка</span>
        <span className="dv-ring__dir">
          рейс <b>{ride.train}</b> · {cw ? 'за годинниковою стрілкою' : 'проти годинникової стрілки'}
        </span>
      </div>
      {ride.extra ? (
        <p className="dv-ring__extra">
          Додатковий рейс між берегами{ride.validTo ? ` — курсує до ${dayMonth(ride.validTo)}` : ''}
        </p>
      ) : null}
      {l.walkBeforeMin ? <p className="dv-ring__walk">Від метро до платформи «{ride.from.name}» — ≈ {durationText(l.walkBeforeMin)} пішки</p> : null}
      <Dial l={l} />
      <div className="dv-ring__plates">
        <div className="dv-ring__plate">
          <small>посадка</small>
          <b>{ride.from.name}</b>
          <time>{hhmm(l.depMins)}</time>
        </div>
        <span className="dv-ring__run" aria-hidden="true">
          <i />
        </span>
        <div className="dv-ring__plate dv-ring__plate--to">
          <small>вийти</small>
          <b>{ride.to.name}</b>
          <time>{hhmm(l.arrMins)}</time>
        </div>
      </div>
      <p className="dv-ring__count">
        {stationsText(hops)} · {durationText(l.arrMins - l.depMins)} у дорозі{crosses ? ' · через Дніпро' : ''}
      </p>
      {hops > 1 ? (
        <details className="dv-ring__stops">
          <summary>Усі зупинки рейсу</summary>
          <ol>
            {ride.stops.map((s) => (
              <li key={s.station.id}>
                <time>{hhmm(s.mins)}</time> {s.station.name}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {l.walkAfterMin ? <p className="dv-ring__walk">Від платформи «{ride.to.name}» до метро — ≈ {durationText(l.walkAfterMin)} пішки</p> : null}
      <div className="dv-ring__foot">
        <span className="dv-ring__ticket" aria-label={`Квиток — ${l.priceUah} гривень`}>
          <b>{l.priceUah}</b>
          <small>грн</small>
        </span>
        <p className="dv-ring__facts">
          {l.later.length ? `Наступні: ${l.later.map(hhmm).join(' · ')}` : 'Далі цього дня рейсів немає'}
          <small>за розкладом · квиток у застосунку «Укрзалізниці» чи «Київ Цифровий»</small>
        </p>
        <a className="dv-ring__maps" href={l.mapsUrl} target="_blank" rel="noopener noreferrer">
          Google Maps ↗
        </a>
      </div>
    </div>
  );
}
