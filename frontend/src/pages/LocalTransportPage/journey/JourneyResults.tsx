/**
 * Єдиний список поїздок планувальника: прямі й з пересадками в одному списку (як у Transitous/MOTIS).
 * Картка — час відправлення, ланцюжок ліній, «09:08 → 09:45 · 37 хв»; розгортається в таймлайн з пішими відрізками,
 * очікуваннями, проміжними зупинками й наступними рейсами кожної ділянки.
 */
import React, { useState } from 'react';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import { routeNo } from '@/utils/routeNames';
import { routeColorStyle } from '../routeColors';
import { isVerifiedRoute } from '../routeTiming';
import { formatClock, formatWait, stopsLabel, transfersLabel } from './format';
import { legAlternatives } from './plan';
import type { DirectWalk, Journey, Leg, Place, Timetable, TransitLeg, WalkLeg } from './types';
import './JourneyResults.css';

export interface JourneyResultsProps {
  timetable: Timetable;
  /** Поїздки до показу (зріз journeyWindow) */
  items: Journey[];
  hiddenEarlier: number;
  hiddenLater: number;
  /** Київський «зараз» у хвилинах від півночі — лише коли день пошуку сьогодні, інакше null */
  nowMins: number | null;
  /** Сьогодні поїздок більше немає: це перші поїздки наступного дня */
  nextDay: boolean;
  directWalk: DirectWalk | null;
  placeName: (place: Place) => string;
  /** Куди їде рейс (табличка / кінцева) */
  destinationOf: (leg: TransitLeg) => string;
  /** «через вокзал» для рейсу варіанта шляху; null — основний шлях */
  variantNameOf: (leg: TransitLeg) => string | null;
  onOpenRoute: (leg: TransitLeg) => void;
  onShowEarlier: () => void;
  onShowLater: () => void;
}

const isTransit = (leg: Leg): leg is TransitLeg => leg.kind === 'transit';
const isWalk = (leg: Leg): leg is WalkLeg => leg.kind === 'walk';

function journeyKey(j: Journey): string {
  return `${j.departMins}-${j.arriveMins}-${j.legs.filter(isTransit).map((l) => l.tripId).join('+')}`;
}

function RouteChip({ routeId }: { routeId: string }) {
  const verified = isVerifiedRoute(routeId);
  return (
    <span
      className={`lt-route-num lt-route-num--card ${verified ? 'lt-route-num--verified' : 'lt-route-num--unverified'}`}
      style={routeColorStyle(routeId)}
      title={verified ? 'Час між зупинками — з виміряних даних' : 'Час орієнтовний'}
    >
      №{routeNo(routeId)}
    </span>
  );
}

interface CardProps extends Omit<JourneyResultsProps, 'items' | 'hiddenEarlier' | 'hiddenLater' | 'directWalk' | 'onShowEarlier' | 'onShowLater'> {
  journey: Journey;
  open: boolean;
  onToggle: () => void;
  panelId: string;
}

function JourneyCard({ journey, open, onToggle, panelId, timetable, nowMins, nextDay, placeName, destinationOf, variantNameOf, onOpenRoute }: CardProps) {
  const transit = journey.legs.filter(isTransit);
  const first = transit[0];
  const duration = Math.max(0, Math.round(journey.arriveMins - journey.departMins));

  // Підпис під часом: відлік від поточного часу (не від часу пошуку) і лише для сьогодні
  let timeLabel = 'відправлення';
  let timeLabelMod = '';
  if (nextDay) {
    timeLabel = 'наступного дня';
    timeLabelMod = 'lt-journey-time-label--wrapped';
  } else if (nowMins != null) {
    const delta = Math.round(journey.departMins - nowMins);
    if (delta >= 0) {
      timeLabel = `через ${formatWait(delta)}`;
      timeLabelMod = 'lt-journey-time-label--soon';
    } else {
      timeLabel = 'вже вирушив';
    }
  }

  const later = first ? legAlternatives(timetable, first, 2) : [];
  const laterLabel = later.map((a) => formatClock(a.depMins)).join(' · ');
  const direct = transit.length === 1 ? destinationOf(first) : null;
  const variant = transit.length === 1 ? variantNameOf(first) : null;
  const walkSummary = journey.walkMeters > 0 ? `пішки ${journey.walkMeters} м` : '';

  const ariaLabel = [
    transit.length === 1 ? `Маршрут №${routeNo(first.routeId)} до ${direct}` : `Маршрути ${transit.map((l) => `№${routeNo(l.routeId)}`).join(', ')}`,
    variant ? `іншим шляхом: ${variant}` : '',
    `відправлення ${formatClock(journey.departMins)}`,
    `прибуття ${formatClock(journey.arriveMins)}`,
    `${duration} хвилин`,
    journey.transfers > 0 ? transfersLabel(journey.transfers) : '',
    walkSummary,
    timeLabel !== 'відправлення' ? timeLabel : '',
    laterLabel ? `далі ${laterLabel}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li className="lt-journey">
      <button type="button" className="lt-journey-head" aria-expanded={open} aria-controls={panelId} aria-label={ariaLabel} onClick={onToggle}>
        <span className="lt-journey-time">
          <span className="lt-journey-time-value">{formatClock(journey.departMins)}</span>
          <span className={`lt-journey-time-label ${timeLabelMod}`}>{timeLabel}</span>
        </span>
        <span className="lt-journey-main">
          <span className="lt-journey-chips">
            {transit.map((leg, i) => (
              <React.Fragment key={leg.tripId}>
                {i > 0 && (
                  <span className="lt-journey-sep" aria-hidden>
                    ›
                  </span>
                )}
                <RouteChip routeId={leg.routeId} />
              </React.Fragment>
            ))}
            {direct ? (
              <span className="lt-journey-destination">
                <span aria-hidden>→ </span>
                {direct}
              </span>
            ) : null}
          </span>
          <span className="lt-journey-times">
            {formatClock(journey.departMins)} → {formatClock(journey.arriveMins)} · {duration} хв
            {journey.transfers > 0 ? ` · ${transfersLabel(journey.transfers)}` : ''}
            {walkSummary ? ` · ${walkSummary}` : ''}
          </span>
          {variant ? <span className="lt-journey-variant">іншим шляхом: {variant}</span> : null}
          {laterLabel ? <span className="lt-journey-next">далі {laterLabel}</span> : null}
        </span>
        <span className="lt-journey-chevron" aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <ol className="lt-journey-steps" id={panelId}>
          {journey.legs.map((leg, i) => {
            const prev = journey.legs[i - 1];
            const gap = prev ? Math.round(leg.depMins - prev.arrMins) : 0;
            return (
              <React.Fragment key={`${i}-${leg.kind}`}>
                {gap > 0 && <li className="lt-journey-step lt-journey-step--wait">Очікування {formatWait(gap)}</li>}
                {isWalk(leg) ? (
                  <li className="lt-journey-step lt-journey-step--walk">
                    <span className="lt-journey-step-title">
                      Пішки {leg.meters} м · {Math.max(1, Math.round(leg.arrMins - leg.depMins))} хв
                    </span>
                    <span className="lt-journey-step-sub">
                      {placeName(leg.from)} → {placeName(leg.to)}
                    </span>
                  </li>
                ) : (
                  <RideStep leg={leg} timetable={timetable} placeName={placeName} destinationOf={destinationOf} variantNameOf={variantNameOf} onOpenRoute={onOpenRoute} />
                )}
              </React.Fragment>
            );
          })}
        </ol>
      )}
    </li>
  );
}

function RideStep({
  leg,
  timetable,
  placeName,
  destinationOf,
  variantNameOf,
  onOpenRoute,
}: Pick<JourneyResultsProps, 'timetable' | 'placeName' | 'destinationOf' | 'variantNameOf' | 'onOpenRoute'> & { leg: TransitLeg }) {
  const variant = variantNameOf(leg);
  const alternatives = legAlternatives(timetable, leg, 3);
  const middle = leg.stopIds.slice(1, -1);
  const hops = leg.stopIds.length - 1;
  return (
    <li className="lt-journey-step lt-journey-step--ride">
      <span className="lt-journey-step-title">
        <RouteChip routeId={leg.routeId} /> <span className="lt-journey-step-dest">→ {destinationOf(leg)}</span>
      </span>
      <span className="lt-journey-step-sub">
        {formatClock(leg.depMins)} {placeName({ stopId: leg.boardStopId })} → {formatClock(leg.arrMins)} {placeName({ stopId: leg.alightStopId })}
      </span>
      <span className="lt-journey-step-sub">
        {stopsLabel(hops)} · {Math.max(1, Math.round(leg.arrMins - leg.depMins))} хв{variant ? ` · іншим шляхом: ${variant}` : ''}
      </span>
      {alternatives.length > 0 && (
        <span className="lt-journey-step-sub lt-journey-step-next">Наступні: {alternatives.map((a) => formatClock(a.depMins)).join(' · ')}</span>
      )}
      {middle.length > 0 && (
        <details className="lt-journey-stops">
          <summary>Проміжні зупинки ({middle.length})</summary>
          <ul>
            {middle.map((id, i) => (
              <li key={id}>
                {formatClock(leg.stopTimes[i + 1])} {placeName({ stopId: id })}
              </li>
            ))}
          </ul>
        </details>
      )}
      <button
        type="button"
        className="lt-journey-open-route"
        onClick={() => {
          gaTrackEvent('transport_journey_leg_click', { route_id: leg.routeId });
          onOpenRoute(leg);
        }}
      >
        Розклад маршруту №{routeNo(leg.routeId)}
      </button>
    </li>
  );
}

export const JourneyResults: React.FC<JourneyResultsProps> = (props) => {
  const { items, hiddenEarlier, hiddenLater, directWalk, onShowEarlier, onShowLater, ...card } = props;
  const { nextDay } = card;
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="lt-journeys">
      {nextDay && (
        <p className="lt-journeys-note" role="status">
          Сьогодні рейсів пізніше немає · перші поїздки наступного дня
        </p>
      )}
      {directWalk && (
        <p className="lt-journeys-walk" role="note">
          Пішки напряму — {directWalk.minutes} хв ({directWalk.meters} м)
        </p>
      )}
      {hiddenEarlier > 0 && (
        <button type="button" className="lt-journeys-more" onClick={onShowEarlier}>
          Показати раніші
        </button>
      )}
      <ul className="lt-journey-list">
        {items.map((journey) => {
          const key = journeyKey(journey);
          const open = openKey === key;
          return (
            <JourneyCard
              key={key}
              {...card}
              journey={journey}
              open={open}
              panelId={`lt-journey-${key}`}
              onToggle={() => {
                if (!open) {
                  gaTrackEvent('transport_journey_open', { transfers: journey.transfers, legs: journey.legs.length });
                }
                setOpenKey(open ? null : key);
              }}
            />
          );
        })}
      </ul>
      {hiddenLater > 0 && (
        <button type="button" className="lt-journeys-more" onClick={onShowLater}>
          Показати пізніші
        </button>
      )}
    </div>
  );
};
