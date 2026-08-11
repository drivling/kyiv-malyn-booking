import React from 'react';
import type { Schedule } from '@/types';

type Props = {
  schedule: Schedule;
  onClose: () => void;
};

export const TrainTicketModal: React.FC<Props> = ({ schedule, onClose }) => {
  const url = schedule.ticketPurchaseUrl?.trim() || '';

  return (
    <div className="mizh-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="mizh-modal mizh-modal--offer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="train-ticket-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mizh-modal-close" onClick={onClose} aria-label="Закрити">
          ×
        </button>
        <h3 id="train-ticket-title">Квиток на електричку</h3>
        <p className="mizh-modal-subtitle">
          Місця на електричку ми не бронюємо. Квиток купується в застосунку або на сайті перевізника.
        </p>
        {schedule.tripNumber ? (
          <p className="mizh-modal-subtitle">
            Рейс <strong>№{schedule.tripNumber}</strong>
            {schedule.departureTime ? ` · відправлення ${schedule.departureTime}` : ''}.
          </p>
        ) : (
          <p className="mizh-modal-subtitle">
            Відправлення о <strong>{schedule.departureTime}</strong>.
          </p>
        )}
        {(schedule.boardingPlace || schedule.alightingPlace) && (
          <p className="mizh-modal-subtitle">
            {[
              schedule.boardingPlace && `Посадка: ${schedule.boardingPlace}`,
              schedule.alightingPlace && `Висадка: ${schedule.alightingPlace}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        {!url && <p className="mizh-modal-subtitle">Посилання на купівлю ще не налаштоване в адмінці.</p>}
        <div className="mizh-card-actions" style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button type="button" className="mizh-card-cta mizh-card-cta--ghost" onClick={onClose}>
            Закрити
          </button>
          {url ? (
            <a className="mizh-card-cta mizh-card-cta--bus" href={url} target="_blank" rel="noopener noreferrer">
              Купити квиток
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
};
