/**
 * Смужка стану даних під міні-навігацією транспорту (Docs/transport-pwa-2026-10.md, фаза 2):
 * «Без мережі — розклад станом на …» або «Сервер не відповідає — показуємо збережений розклад …» з кнопкою
 * «Оновити». Коли все гаразд — нічого (окрім дітей: кнопка «Встановити застосунок» з фази 3).
 * Під пререндером не рендериться: у статичному HTML не має бути стану конкретного браузера.
 */
import type { ReactNode } from 'react';
import { isPrerendering } from '@/utils/prerender';
import { formatDataAsOf } from './dataAsOf';
import type { DatasetSource } from './dataset/useTransportDataset';

export interface TransportStatusBarProps {
  online: boolean;
  source: DatasetSource | null;
  /** ISO-мітка даних (revision або час копії) */
  dataAsOf: string | null;
  error: string;
  onRetry: () => void;
  children?: ReactNode;
}

export function TransportStatusBar({ online, source, dataAsOf, error, onRetry, children }: TransportStatusBarProps) {
  if (isPrerendering()) return null;
  const asOf = formatDataAsOf(dataAsOf);
  const asOfText = asOf ? ` станом на ${asOf}` : '';
  let message: string | null = null;
  let retry = false;
  if (!online) {
    message = `Без мережі — розклад${asOfText}`;
  } else if (source && source !== 'network' && error) {
    message = `Сервер не відповідає — показуємо збережений розклад${asOfText}`;
    retry = true;
  }
  if (!message && !children) return null;
  return (
    <div className={`lt-status-bar${message ? ' lt-status-bar--warn' : ''}`} role="status">
      {message && <p className="lt-status-bar-text">{message}</p>}
      {retry && (
        <button type="button" className="lt-status-bar-btn" onClick={onRetry}>
          Оновити
        </button>
      )}
      {children}
    </div>
  );
}
