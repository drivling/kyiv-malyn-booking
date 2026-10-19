/**
 * «Налаштування на цьому пристрої» у блоці «Дані відкриті» на /transport/scheme (Docs/transport-open-data-2026-10.md,
 * фаза 4.3): зберегти часті зупинки у файл, відновити з файлу, очистити все транспортне на пристрої.
 * Без сервера й акаунта — лише localStorage і кеші воркера (transportPrefs.ts).
 */
import React, { useRef, useState } from 'react';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import {
  TRANSPORT_PREFS_FILENAME,
  applyTransportPrefs,
  clearTransportDeviceData,
  collectTransportPrefs,
  parseTransportPrefs,
  readFrequentToStops,
  transportPrefsFileText,
} from './transportPrefs';

type Props = {
  /** Назви зупинок датасету — лише вони імпортуються */
  stopNames: string[];
};

export const TransportPrefsPanel: React.FC<Props> = ({ stopNames }) => {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [clearStep, setClearStep] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const fileRef = useRef<HTMLInputElement>(null);

  const say = (ok: string) => {
    setError('');
    setStatus(ok);
  };
  const fail = (msg: string) => {
    setStatus('');
    setError(msg);
  };

  const onExport = () => {
    const prefs = collectTransportPrefs();
    const blob = new Blob([transportPrefsFileText(prefs)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = TRANSPORT_PREFS_FILENAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    gaTrackEvent('transport_prefs', { action: 'export', count: prefs.frequentToStops.length });
    say(
      prefs.frequentToStops.length
        ? `Збережено ${prefs.frequentToStops.length} частих зупинок у ${TRANSPORT_PREFS_FILENAME}.`
        : `Файл ${TRANSPORT_PREFS_FILENAME} збережено — частих зупинок поки нема.`,
    );
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseTransportPrefs(text, stopNames.length ? stopNames : undefined);
      const merged = applyTransportPrefs(parsed);
      gaTrackEvent('transport_prefs', { action: 'import', count: parsed.frequentToStops.length });
      const skipped = parsed.unknownStops.length ? ` Пропущено невідомих зупинок: ${parsed.unknownStops.length}.` : '';
      say(`Відновлено: ${merged.length} частих зупинок (${merged.join(', ') || '—'}).${skipped}`);
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Не вдалося прочитати файл.');
    }
  };

  const onClear = async () => {
    setClearStep('busy');
    try {
      const r = await clearTransportDeviceData();
      gaTrackEvent('transport_prefs', { action: 'clear', count: r.keys });
      say(`Очищено: записів у браузері — ${r.keys}, кешів — ${r.caches}. Після перезавантаження розділ підтягне дані заново.`);
    } finally {
      setClearStep('idle');
    }
  };

  const frequentCount = readFrequentToStops().length;

  return (
    <div className="lts-prefs" role="group" aria-labelledby="lts-prefs-title">
      <h3 id="lts-prefs-title" className="lts-prefs-title">
        Налаштування на цьому пристрої
      </h3>
      <p className="lts-open-data-text">
        Часті зупинки «Куди» планера{frequentCount ? ` (зараз ${frequentCount})` : ''} живуть лише у вашому браузері — на сервер
        вони не йдуть. Збережіть їх у файл, щоб перенести на новий телефон або лишити собі копію.
      </p>
      <div className="lts-card-actions">
        <button type="button" className="lts-btn" onClick={onExport}>
          Зберегти налаштування у файл
        </button>
        <button type="button" className="lts-btn" onClick={() => fileRef.current?.click()}>
          Відновити з файлу
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="lts-prefs-file"
          aria-label="Файл налаштувань транспорту"
          onChange={onImportFile}
        />
        {clearStep === 'idle' ? (
          <button type="button" className="lts-btn lts-btn--quiet" onClick={() => setClearStep('confirm')}>
            Очистити мої дані на цьому пристрої
          </button>
        ) : (
          <span className="lts-prefs-confirm">
            Прибрати часті зупинки, анонімний ідентифікатор і кеш розділу з цього браузера?{' '}
            <button type="button" className="lts-btn lts-btn--quiet" onClick={onClear} disabled={clearStep === 'busy'}>
              {clearStep === 'busy' ? 'Очищаємо...' : 'Так, очистити'}
            </button>{' '}
            <button type="button" className="lts-btn lts-btn--quiet" onClick={() => setClearStep('idle')} disabled={clearStep === 'busy'}>
              Ні
            </button>
          </span>
        )}
      </div>
      {status && (
        <p className="lts-open-data-meta lts-prefs-status" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="lts-open-data-meta lts-prefs-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
