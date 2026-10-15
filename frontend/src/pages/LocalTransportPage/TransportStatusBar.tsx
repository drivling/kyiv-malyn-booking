/**
 * Смужка стану даних під міні-навігацією транспорту (Docs/transport-pwa-2026-10.md, фаза 2):
 * «Без мережі — розклад станом на …» або «Сервер не відповідає — показуємо збережений розклад …» з кнопкою
 * «Оновити». Записи, що чекають у outbox (Docs/transport-offline-writes-2026-10.md, фаза 4), дописуються до
 * цих повідомлень («· 2 записи чекають на мережу»), а коли мережа є і помилок нема — стають окремим рядком із
 * кнопкою «Надіслати». Тут же — пропозиція встановити застосунок (InstallOffer). Коли все гаразд і пропонувати
 * нема чого — нічого. Під пререндером не рендериться: у статичному HTML не має бути стану конкретного браузера.
 */
import { InstallOffer } from '@/pwa/InstallOffer';
import { useInstallOffer } from '@/pwa/installPrompt';
import { flushOutbox, useOutboxPending } from '@/pwa/outbox';
import { isPrerendering } from '@/utils/prerender';
import { formatDataAsOf } from './dataAsOf';
import type { DatasetSource } from './dataset/useTransportDataset';
import { pendingOutboxLabel } from './outboxLabel';

export interface TransportStatusBarProps {
  online: boolean;
  source: DatasetSource | null;
  /** ISO-мітка даних (revision або час копії) */
  dataAsOf: string | null;
  error: string;
  onRetry: () => void;
}

export function TransportStatusBar({ online, source, dataAsOf, error, onRetry }: TransportStatusBarProps) {
  const offer = useInstallOffer();
  const pending = useOutboxPending();
  if (isPrerendering()) return null;
  const asOf = formatDataAsOf(dataAsOf);
  const asOfText = asOf ? ` станом на ${asOf}` : '';
  const pendingText = pending > 0 ? pendingOutboxLabel(pending) : '';
  const pendingSuffix = pendingText ? ` · ${pendingText}` : '';
  let message: string | null = null;
  let retry = false;
  let sendNow = false;
  if (!online) {
    message = `Без мережі — розклад${asOfText}${pendingSuffix}`;
  } else if (source && source !== 'network' && error) {
    message = `Сервер не відповідає — показуємо збережений розклад${asOfText}${pendingSuffix}`;
    retry = true;
  } else if (pendingText) {
    // мережа є, датасет прийшов, а черга не порожня — сервер відповідав 5xx або прохід ще не спрацював
    message = pendingText;
    sendNow = true;
  }
  if (!message && !offer) return null;
  return (
    <div className={`lt-status-bar${message ? ' lt-status-bar--warn' : ''}`} role={message ? 'status' : undefined}>
      {message && <p className="lt-status-bar-text">{message}</p>}
      {retry && (
        <button type="button" className="lt-status-bar-btn" onClick={onRetry}>
          Оновити
        </button>
      )}
      {sendNow && (
        <button type="button" className="lt-status-bar-btn" onClick={() => void flushOutbox()}>
          Надіслати
        </button>
      )}
      {offer && <InstallOffer kind={offer} compact={Boolean(message)} />}
    </div>
  );
}
