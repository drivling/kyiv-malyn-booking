import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import { buildStopPlaces } from '@/pages/DovedePage/nlu/stopPlaces';
import { setStopPlaces } from '@/pages/DovedePage/nlu/places';
import type { RouteLike } from '@/pages/DovedePage/nlu/routes';
import type { StopPlace } from '@/pages/DovedePage/nlu/stopPlaces';
import { getKyivDateString, getKyivMinutesNow } from '@/pages/LocalTransportPage/kyivTime';
import { DEFAULT_TRANSPORT_CITY } from '@/site/transportCity';
import { AdminSectionHeader, ChipGroup, EmptyState, StatTile, StatTiles } from '../../kit';
import { VOICE_PHRASES, type VoicePhrase } from './phrases';
import { clearTakes, getTake, listTakeKeys, saveTake, takeKey, type VoiceCondition } from './recordings';
import { recorderSupported, startRecorder, type RecorderSession } from './recorder';
import { wordErrorRate } from './similarity';
import { compareHeard } from './voiceMatch';
import { startWebSpeech, webSpeechSupported, type WebSpeechSession } from './webSpeech';
import {
  WHISPER_MODES,
  WHISPER_MODELS,
  defaultWhisperMode,
  isWhisperLoaded,
  loadWhisper,
  transcribeWhisper,
  type WhisperMode,
  type WhisperSize,
} from './whisper';
import './voice.css';

/** Результат одного дубля: що почув Web Speech і Whisper (за налаштуванням «розмір · режим») */
interface TakeResult {
  webSpeech?: { text: string; error?: string };
  whisper?: Record<string, { text: string; ms: number }>;
}

const STORAGE_KEY = 'dovede-voice-lab:v1';
const CONDITIONS = [
  { value: 'quiet' as const, label: 'Тиша' },
  { value: 'noise' as const, label: 'Шум' },
];

function readResults(): Record<string, TakeResult> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, TakeResult>) : {};
  } catch {
    return {};
  }
}

function writeResults(results: Record<string, TakeResult>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  } catch {
    /* сховище недоступне — результати лишаться на екрані до перезавантаження */
  }
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)} %` : '—');

/**
 * Розділ «Голос» (/admin/dovede/voice) — лабораторія (Docs/dovede-voice-roadmap.md, Ф1·1): адмін читає фрази, Web
 * Speech і Whisper (у браузері) слухають один і той самий дубль, а таблиця показує, чи розбір розпізнаного тексту
 * збігся з розбором набраної фрази. Звук лежить лише в IndexedDB цього браузера.
 */
const DovedeVoiceSection: React.FC = () => {
  const [size, setSize] = useState<WhisperSize>('base');
  const [mode, setMode] = useState<WhisperMode>(defaultWhisperMode);
  const [condition, setCondition] = useState<VoiceCondition>('quiet');
  const [useWebSpeech, setUseWebSpeech] = useState(webSpeechSupported());
  const [results, setResults] = useState<Record<string, TakeResult>>(readResults);
  const [recorded, setRecorded] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState<number | null>(null);
  const [status, setStatus] = useState<{ kind: 'idle' | 'loading' | 'ready' | 'error'; text?: string }>({ kind: 'idle' });
  const [busy, setBusy] = useState<string | null>(null);
  const [stops, setStops] = useState<StopPlace[]>([]);
  const [routes, setRoutes] = useState<RouteLike[]>([]);
  const session = useRef<{ rec: RecorderSession; ws: WebSpeechSession | null; n: number } | null>(null);
  const config = `${size}-${mode}`;

  // Словник сторінки: зупинки й маршрути Малина (як у DovedePage) — розбір тут той самий
  useEffect(() => {
    let alive = true;
    apiClient
      .getTransportDataset({ city: DEFAULT_TRANSPORT_CITY })
      .then((d) => {
        if (!alive) return;
        const index = buildStopPlaces(d.stops.map((s) => ({ id: s.id, name: s.name })));
        setStopPlaces(index);
        setStops(index);
        setRoutes(
          d.routes
            .filter((r) => !r.unreliable)
            .map((r) => ({ id: r.id, no: (r.shortName ?? '').trim() || r.id, fromName: (r.fromName ?? '').trim(), toName: (r.toName ?? '').trim() })),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void listTakeKeys().then((keys) => {
      if (alive) setRecorded(new Set(keys));
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setStatus(isWhisperLoaded(size, mode) ? { kind: 'ready' } : { kind: 'idle' });
  }, [size, mode]);

  const update = useCallback((key: string, patch: (r: TakeResult) => TakeResult) => {
    setResults((prev) => {
      const next = { ...prev, [key]: patch(prev[key] ?? {}) };
      writeResults(next);
      return next;
    });
  }, []);

  const load = async () => {
    setStatus({ kind: 'loading', text: '0 МБ' });
    try {
      await loadWhisper(size, mode, (p) => setStatus({ kind: 'loading', text: `${p.loadedMb.toFixed(0)} з ${p.totalMb.toFixed(0)} МБ` }));
      setStatus({ kind: 'ready' });
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const runWhisper = useCallback(
    async (key: string, blob: Blob) => {
      try {
        const out = await transcribeWhisper(size, mode, blob);
        update(key, (r) => ({ ...r, whisper: { ...r.whisper, [config]: out } }));
      } catch (e) {
        update(key, (r) => ({ ...r, whisper: { ...r.whisper, [config]: { text: `⚠ ${e instanceof Error ? e.message : String(e)}`, ms: 0 } } }));
      }
    },
    [size, mode, config, update],
  );

  const toggleRecord = async (p: VoicePhrase) => {
    const key = takeKey(p.n, condition);
    if (session.current && session.current.n === p.n) {
      // стоп
      const s = session.current;
      session.current = null;
      setRecording(null);
      setBusy(key);
      s.ws?.stop();
      const blob = await s.rec.stop();
      const ws = s.ws ? await s.ws.result : null;
      update(key, (r) => ({ ...r, webSpeech: ws ?? undefined, whisper: undefined }));
      if (await saveTake({ key, n: p.n, condition, blob, at: Date.now() })) setRecorded((prev) => new Set(prev).add(key));
      if (isWhisperLoaded(size, mode)) await runWhisper(key, blob);
      setBusy(null);
      return;
    }
    if (session.current) return;
    try {
      const ws = useWebSpeech && webSpeechSupported() ? startWebSpeech() : null;
      const rec = await startRecorder();
      session.current = { rec, ws, n: p.n };
      setRecording(p.n);
    } catch (e) {
      setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Мікрофон недоступний' });
    }
  };

  const play = async (key: string) => {
    const take = await getTake(key);
    if (!take) return;
    const url = URL.createObjectURL(take.blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    void audio.play();
  };

  const rerunAll = async () => {
    setBusy('all');
    for (const p of VOICE_PHRASES) {
      const key = takeKey(p.n, condition);
      if (!recorded.has(key)) continue;
      const take = await getTake(key);
      if (take) await runWhisper(key, take.blob);
    }
    setBusy(null);
  };

  const erase = async () => {
    if (!window.confirm('Стерти всі записи й результати лабораторії в цьому браузері?')) return;
    await clearTakes();
    setRecorded(new Set());
    setResults({});
    writeResults({});
  };

  const exportJson = () => {
    const rows = VOICE_PHRASES.flatMap((p) =>
      (['quiet', 'noise'] as const).flatMap((c) => {
        const r = results[takeKey(p.n, c)];
        return r ? [{ n: p.n, condition: c, spoken: p.spoken, ref: p.ref, webSpeech: r.webSpeech ?? null, whisper: r.whisper ?? null }] : [];
      }),
    );
    const blob = new Blob([JSON.stringify({ at: new Date().toISOString(), device: navigator.userAgent, rows }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dovede-voice-lab-${getKyivDateString()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const now = useMemo(() => ({ date: getKyivDateString(), mins: getKyivMinutesNow() }), []);

  const rows = useMemo(
    () =>
      VOICE_PHRASES.map((p) => {
        const r = results[takeKey(p.n, condition)];
        const ws = r?.webSpeech;
        const wh = r?.whisper?.[config];
        return {
          p,
          ws: ws ? { ...ws, match: ws.text ? compareHeard(p.ref, ws.text, now, stops, routes).match : false, wer: wordErrorRate(p.spoken, ws.text) } : null,
          wh: wh ? { ...wh, match: wh.text && !wh.text.startsWith('⚠') ? compareHeard(p.ref, wh.text, now, stops, routes).match : false, wer: wordErrorRate(p.spoken, wh.text) } : null,
        };
      }),
    [results, condition, config, now, stops, routes],
  );

  const main = rows.filter((r) => !r.p.optional);
  const wsRows = main.filter((r) => r.ws);
  const whRows = main.filter((r) => r.wh && !r.wh.text.startsWith('⚠'));
  const recordedCount = main.filter((r) => recorded.has(takeKey(r.p.n, condition))).length;

  const unsupported = !recorderSupported();
  let group = '';

  return (
    <div className="dv-voice">
      <AdminSectionHeader
        title="Голос"
        purpose="Лабораторія розпізнавання української: читайте фрази вголос — Web Speech і Whisper у браузері слухають один дубль, а розбір порівнюється з набраною фразою. Звук лишається в цьому браузері."
        actions={
          <>
            <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={exportJson}>
              Зберегти результати (JSON)
            </button>
            <button type="button" className="admin-kit-dangerbtn" onClick={() => void erase()}>
              Стерти записи
            </button>
          </>
        }
      />

      <StatTiles label="Підсумок">
        <StatTile label="Записано" value={recordedCount} sub={`з ${main.length}`} />
        <StatTile label="Web Speech: розбір збігся" value={pct(wsRows.filter((r) => r.ws?.match).length, wsRows.length)} sub={`${wsRows.filter((r) => r.ws?.match).length} з ${wsRows.length}`} />
        <StatTile label={`Whisper ${size}: розбір збігся`} value={pct(whRows.filter((r) => r.wh?.match).length, whRows.length)} sub={`${whRows.filter((r) => r.wh?.match).length} з ${whRows.length}`} />
        <StatTile label="Whisper: час на фразу" value={median(whRows.map((r) => r.wh!.ms)) ?? '—'} sub="мс (медіана)" />
      </StatTiles>

      <section className="dv-voice-controls" aria-label="Налаштування лабораторії">
        <div>
          <span className="dv-voice-label">Умови запису</span>
          <ChipGroup label="Умови запису" options={CONDITIONS} value={condition} onChange={setCondition} />
        </div>
        <div>
          <span className="dv-voice-label">Whisper — розмір</span>
          <ChipGroup
            label="Розмір Whisper"
            options={(Object.keys(WHISPER_MODELS) as WhisperSize[]).map((s) => ({ value: s, label: `${WHISPER_MODELS[s].label} · ≈ ${WHISPER_MODES[mode].approxMb[s]} МБ` }))}
            value={size}
            onChange={setSize}
          />
        </div>
        <div>
          <span className="dv-voice-label">Whisper — режим</span>
          <ChipGroup label="Режим Whisper" options={(Object.keys(WHISPER_MODES) as WhisperMode[]).map((m) => ({ value: m, label: WHISPER_MODES[m].label }))} value={mode} onChange={setMode} />
        </div>
        <div className="dv-voice-model">
          <button type="button" className="admin-kit-btn" onClick={() => void load()} disabled={status.kind === 'loading' || status.kind === 'ready'}>
            {status.kind === 'ready' ? 'Модель готова' : `Завантажити модель ≈ ${WHISPER_MODES[mode].approxMb[size]} МБ`}
          </button>
          <span className="dv-voice-status" role="status">
            {status.kind === 'loading' ? `Завантажую… ${status.text}` : null}
            {status.kind === 'error' ? `Помилка: ${status.text}` : null}
            {status.kind === 'idle' ? 'Модель ще не завантажена: без неї працює лише Web Speech.' : null}
          </span>
          <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void rerunAll()} disabled={status.kind !== 'ready' || busy !== null || !recordedCount}>
            Прогнати Whisper по всіх записах
          </button>
          <label className="dv-voice-check">
            <input type="checkbox" checked={useWebSpeech} disabled={!webSpeechSupported()} onChange={(e) => setUseWebSpeech(e.target.checked)} /> Web Speech слухає одночасно
            {!webSpeechSupported() ? ' (цей браузер не вміє)' : ''}
          </label>
        </div>
      </section>

      {unsupported ? <EmptyState>Цей браузер не дає доступу до мікрофона: потрібні https і MediaRecorder.</EmptyState> : null}

      <table className="dv-voice-table">
        <thead>
          <tr>
            <th scope="col">№</th>
            <th scope="col">Читати вголос</th>
            <th scope="col">Запис</th>
            <th scope="col">Web Speech</th>
            <th scope="col">Whisper {size}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, ws, wh }) => {
            const key = takeKey(p.n, condition);
            const head = p.group !== group ? ((group = p.group), <tr key={`g${p.n}`} className="dv-voice-group"><th colSpan={5}>{p.group}</th></tr>) : null;
            return (
              <React.Fragment key={p.n}>
                {head}
                <tr className={recording === p.n ? 'is-recording' : undefined}>
                  <td>{p.n}</td>
                  <td>
                    <strong>{p.spoken}</strong>
                    <small>набирають: {p.ref}</small>
                  </td>
                  <td className="dv-voice-actions">
                    <button type="button" className="admin-kit-btn" onClick={() => void toggleRecord(p)} disabled={unsupported || (recording !== null && recording !== p.n) || (busy !== null && recording !== p.n)} aria-pressed={recording === p.n}>
                      {recording === p.n ? '■ Стоп' : recorded.has(key) ? '● Ще раз' : '● Записати'}
                    </button>
                    {recorded.has(key) ? (
                      <button type="button" className="admin-kit-linkbtn" onClick={() => void play(key)} aria-label={`Прослухати запис ${p.n}`}>
                        ▶
                      </button>
                    ) : null}
                  </td>
                  <td>
                    <Heard heard={ws} />
                  </td>
                  <td>
                    <Heard heard={wh} ms />
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const Heard: React.FC<{ heard: { text: string; error?: string; match: boolean; wer: number | null; ms?: number } | null; ms?: boolean }> = ({ heard, ms }) => {
  if (!heard) return <span className="dv-voice-none">—</span>;
  if (!heard.text) return <span className="dv-voice-bad">{heard.error ? `нічого (${heard.error})` : 'нічого не почув'}</span>;
  return (
    <span className="dv-voice-heard">
      <span className={heard.match ? 'dv-voice-ok' : 'dv-voice-bad'} aria-label={heard.match ? 'розбір збігся' : 'розбір не збігся'}>
        {heard.match ? '✓' : '✗'}
      </span>{' '}
      {heard.text}
      <small>
        {heard.wer != null ? `слів не так: ${Math.round(heard.wer * 100)} %` : ''}
        {ms && heard.ms ? ` · ${heard.ms} мс` : ''}
      </small>
    </span>
  );
};

export default DovedeVoiceSection;
