import type { CSSProperties } from 'react';
import type { CityRoute, CityStep, StoryLeg } from '../compose/types';
import { cityModeName } from '../compose/narrate';
import { checkedAgo, durationText, metersText, stopsText } from './format';

type CityLeg = Extract<StoryLeg, { kind: 'city' }>;

/** Колір лінії від сервера — лише шістнадцятковий; інакше нейтральний */
function lineColor(step: CityStep): string | undefined {
  return step.color && /^#[0-9a-f]{6}$/i.test(step.color) ? step.color : undefined;
}

/**
 * Коли це звіряли. Звідки дані — не пишемо: усе, що в картці, — дані «Доведе» (рішення власника 2026-11-17:
 * «не приписуй „за даними Google“ — це мої дані тепер»).
 */
function sourceNote(r: CityRoute): string {
  return `перевірено ${checkedAgo(r.fetchedAt)}`;
}

/** Один транспорт: табличка маршруту, як за лобовим склом, і рядок «звідки → куди» */
function Ride({ s }: { s: CityStep }) {
  const facts = [
    s.headsign ? `у бік «${s.headsign}»` : null,
    s.stops ? stopsText(s.stops) : null,
    `≈ ${durationText(s.minutes)}`,
    s.headwayMin ? `кожні ≈ ${s.headwayMin} хв` : null,
  ].filter(Boolean);
  return (
    <li className="dv-city__ride" style={{ '--dv-cc': lineColor(s) } as CSSProperties}>
      <span className="dv-city__plate" aria-label={`${cityModeName(s.mode)} ${s.line ?? ''}`.trim()}>
        <small>{cityModeName(s.mode)}</small>
        <b>{s.line || '—'}</b>
      </span>
      <div className="dv-city__way">
        <p className="dv-city__stops">
          <b>{s.fromStop ?? 'зупинка'}</b>
          <span aria-hidden="true"> → </span>
          <span className="dv-sr-only">до</span>
          <b>{s.toStop ?? 'зупинка'}</b>
        </p>
        <p className="dv-city__facts">{facts.join(' · ')}</p>
        {s.agency ? <p className="dv-city__agency">{s.agency}</p> : null}
      </div>
    </li>
  );
}

/**
 * Дорога містом (Київ, Житомир) до місця, названого словами (Docs/dovede-roadmap.md, «Місто»). Кроки дав сервер:
 * зі своєї бази. Джерело в картці не називаємо — лише коли це звіряли (рішення власника 2026-11-17).
 */
export function CityLegCard({ l }: { l: CityLeg }) {
  if (!l.route) {
    return (
      <div className="dv-kyiv">
        <span className="dv-kyiv__head">{l.cityName}</span>
        <span>
          Далі містом: {l.fromLabel} → {l.toLabel}
        </span>
        <a href={l.mapsUrl} target="_blank" rel="noopener noreferrer">
          Маршрут у Google Maps ↗
        </a>
      </div>
    );
  }
  const r = l.route;
  const walkOnly = r.steps.every((s) => s.kind === 'walk');
  return (
    <div className="dv-city">
      <p className="dv-city__head">
        <span>{l.cityName}</span>
        {l.fromLabel} → {l.toLabel}
      </p>
      <ol className="dv-city__steps">
        {r.steps.map((s, i) =>
          s.kind === 'walk' ? (
            <li key={i} className="dv-city__walk">
              Пішки {s.meters ? `${metersText(s.meters)}, ` : ''}≈ {durationText(s.minutes)}
            </li>
          ) : (
            <Ride key={i} s={s} />
          ),
        )}
      </ol>
      <div className="dv-city__foot">
        <p className="dv-city__sum">
          {walkOnly ? 'Пішки' : 'Разом'} ≈ {durationText(r.minutes)}
          <small>{sourceNote(r)} · час приблизний</small>
        </p>
        <span className="dv-city__links">
          <a className="dv-city__maps" href={l.mapsUrl} target="_blank" rel="noopener noreferrer">
            Google Maps ↗
          </a>
        </span>
      </div>
    </div>
  );
}
