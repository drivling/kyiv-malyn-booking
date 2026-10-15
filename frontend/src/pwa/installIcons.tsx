/**
 * Іконки для покрокової підказки «як встановити» (InstallOffer): намальовані так, як людина бачить їх на
 * телефоні — «Поділитися» в Safari (квадрат зі стрілкою вгору), «На Початковий екран» (плюс у квадраті),
 * меню Chrome (три крапки). Усі декоративні: aria-hidden, сенс несе текст кроку.
 */
const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path d="M12 14.5V3.5" {...STROKE} />
      <path d="M8.5 7 12 3.5 15.5 7" {...STROKE} />
      <path d="M8.5 10.5H7a2 2 0 0 0-2 2v6.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V12.5a2 2 0 0 0-2-2h-1.5" {...STROKE} />
    </svg>
  );
}

export function AddToHomeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" {...STROKE} />
      <path d="M12 8.2v7.6M8.2 12h7.6" {...STROKE} />
    </svg>
  );
}

export function MenuDotsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="5.5" r="1.9" fill="currentColor" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" />
      <circle cx="12" cy="18.5" r="1.9" fill="currentColor" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path d="M5 12.5 10 17.5 19 7" {...STROKE} />
    </svg>
  );
}
