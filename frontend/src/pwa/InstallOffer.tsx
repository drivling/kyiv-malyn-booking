/**
 * Пропозиція встановити застосунок у смужці стану транспорту: кнопка «Встановити» (Chromium) або підказка
 * для iOS із «Зрозуміло». Що показувати — вирішує installOfferKind() у installPrompt.ts.
 */
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import { dismissInstallHint, promptInstall, type InstallOfferKind } from './installPrompt';

interface Props {
  kind: InstallOfferKind;
  /** Поруч із повідомленням про стан даних — лише кнопка, без пояснення */
  compact?: boolean;
}

export function InstallOffer({ kind, compact = false }: Props) {
  if (kind === 'ios-hint') {
    return (
      <>
        <p className="lt-status-bar-text">Щоб відкривати табло як застосунок: «Поділитися» → «На Початковий екран»</p>
        <button type="button" className="lt-status-bar-btn" onClick={dismissInstallHint}>
          Зрозуміло
        </button>
      </>
    );
  }
  const onInstall = async () => {
    const result = await promptInstall();
    if (result) gaTrackEvent('transport_pwa_install', { result });
  };
  return (
    <>
      {!compact && <p className="lt-status-bar-text">Табло і розклад — як застосунок на телефоні</p>}
      <button type="button" className="lt-status-bar-btn" onClick={() => void onInstall()}>
        Встановити
      </button>
    </>
  );
}
