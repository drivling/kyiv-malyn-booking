/**
 * Картка «Встановіть «Як доїхати» на телефон» під міні-навігацією транспорту
 * (Docs/transport-pwa-2026-10.md, «Картка встановлення»). Люди не розуміли коротку смужку й не знаходили
 * «Поділитися → На Початковий екран» на iPhone — тому тут іконка застосунку, одне речення навіщо, і кроки
 * з намальованими іконками саме тих кнопок, які треба натиснути:
 *   - Chromium з beforeinstallprompt — кнопка «Встановити» (системний діалог; рідний банер Chrome теж лишається);
 *   - iPhone / iPad (Safari) — три кроки: «Поділитися» → «На Початковий екран» → «Додати»;
 *   - Android без події (банер закрили або ще зарано) — меню ⋮ → «Додати на головний екран».
 * Хрестик ховає картку на 30 днів (localStorage). Що показувати — вирішує installOfferKind() у installPrompt.ts.
 */
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import { AddToHomeIcon, CheckIcon, MenuDotsIcon, ShareIcon } from './installIcons';
import { dismissInstallHint, promptInstall, type InstallOfferKind } from './installPrompt';

interface Props {
  kind: InstallOfferKind;
}

const APP_ICON = '/icons/yak-doikhaty-192.png';

function Step({ no, icon, children }: { no: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="lt-install-step">
      <span className="lt-install-step-no" aria-hidden="true">
        {no}
      </span>
      <span className="lt-install-step-icon">{icon}</span>
      <span className="lt-install-step-text">{children}</span>
    </li>
  );
}

export function InstallOffer({ kind }: Props) {
  const onInstall = async () => {
    const result = await promptInstall();
    if (result) gaTrackEvent('transport_pwa_install', { result });
  };

  return (
    <section className="lt-install" aria-label="Встановлення застосунку">
      <div className="lt-install-head">
        <img className="lt-install-icon" src={APP_ICON} alt="" width="48" height="48" />
        <div className="lt-install-copy">
          <p className="lt-install-title">Встановіть «Як доїхати» на телефон</p>
          <p className="lt-install-lead">
            Табло і розклад відкриваються без інтернету — одним дотиком з головного екрана, як звичайний застосунок.
          </p>
        </div>
        <button type="button" className="lt-install-close" aria-label="Приховати на місяць" onClick={dismissInstallHint}>
          ×
        </button>
      </div>

      {kind === 'prompt' && (
        <button type="button" className="lt-install-btn" onClick={() => void onInstall()}>
          Встановити
        </button>
      )}

      {kind === 'ios-hint' && (
        <ol className="lt-install-steps" aria-label="Як встановити на iPhone">
          <Step no={1} icon={<ShareIcon />}>
            Натисніть <b>«Поділитися»</b> — квадрат зі стрілкою внизу екрана Safari
          </Step>
          <Step no={2} icon={<AddToHomeIcon />}>
            Прогорніть список і оберіть <b>«На Початковий екран»</b>
          </Step>
          <Step no={3} icon={<CheckIcon />}>
            Натисніть <b>«Додати»</b> — іконка зі схемою маршрутів з'явиться поруч з іншими застосунками
          </Step>
        </ol>
      )}

      {kind === 'android-hint' && (
        <ol className="lt-install-steps" aria-label="Як встановити на Android">
          <Step no={1} icon={<MenuDotsIcon />}>
            Відкрийте меню <b>⋮</b> у правому верхньому куті Chrome
          </Step>
          <Step no={2} icon={<AddToHomeIcon />}>
            Оберіть <b>«Додати на головний екран»</b> або <b>«Встановити застосунок»</b>
          </Step>
        </ol>
      )}
    </section>
  );
}
