import React, { useEffect, useRef } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Що саме на карті: «З: Центр · До: Вокзал» або назва маршруту */
  subtitle?: string;
  children: React.ReactNode;
};

/**
 * Карта на телефоні: повноекранний шар за кнопкою «Карта» замість триступеневого нижнього аркуша.
 * Результати лишаються на сторінці, карта — на весь екран із кнопкою «Готово»; Escape закриває,
 * прокрутка сторінки під шаром блокується, фокус повертається на кнопку, що відкрила карту.
 */
export function LocalTransportMapOverlay({ open, onClose, subtitle, children }: Props) {
  const doneRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    doneRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="lt-map-overlay" role="dialog" aria-modal="true" aria-label="Карта">
      <div className="lt-map-overlay__head">
        <div className="lt-map-overlay__title">
          <strong>Карта</strong>
          {subtitle && <span className="lt-map-overlay__subtitle">{subtitle}</span>}
        </div>
        <button ref={doneRef} type="button" className="lt-btn lt-btn--primary" onClick={onClose}>
          Готово
        </button>
      </div>
      <div className="lt-map-overlay__body">{children}</div>
    </div>
  );
}
