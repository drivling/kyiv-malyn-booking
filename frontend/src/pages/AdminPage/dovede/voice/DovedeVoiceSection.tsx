import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import { buildStopPlaces } from '@/pages/DovedePage/nlu/stopPlaces';
import { setStopPlaces } from '@/pages/DovedePage/nlu/places';
import type { RouteLike } from '@/pages/DovedePage/nlu/routes';
import type { StopPlace } from '@/pages/DovedePage/nlu/stopPlaces';
import { getKyivDateString, getKyivMinutesNow } from '@/pages/LocalTransportPage/kyivTime';
import { startWebSpeech, webSpeechSupported, type WebSpeechSession } from '@/pages/DovedePage/voice/webSpeech';
import { DEFAULT_TRANSPORT_CITY } from '@/site/transportCity';
import { AdminSectionHeader, ChipGroup, EmptyState, StatTile, StatTiles } from '../../kit';
import { VOICE_PHRASES, type VoicePhrase } from './phrases';
import { clearTakes, getTake, listTakeKeys, saveTake, takeKey, type VoiceCondition } from './recordings';
import { recorderSupported, startRecorder, type RecorderSession } from './recorder';
import { wordErrorRate } from './similarity';
import { compareHeard } from './voiceMatch';
import './voice.css';

/** Що почув Web Speech у дублі (старі результати могли ще мати `whisper` — його більше не показуємо) */
interface TakeResult {
  webSpeech?: { text: string; error?: string };
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

const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)} %` : '—');

/**
 * Розділ «Голос» (/admin/dovede/voice) — лабораторія (Docs/dovede-voice-roadmap.md): адмін читає фрази, Web Speech
 * слухає дубль, а таблиця показує, чи розбір розпізнаного тексту збігся з розбором набраної фрази. Звук кожного дубля
 * лежить лише в IndexedDB цього браузера — на ньому ж потім порівняємо хмарне розпізнавання (фаза 2). Whisper у
 * браузері прибрано: на живому прогоні він програв (21–31 % проти 77 %), а бібліотека тягнула ≈ 27 МБ і завантаження з
 * nuget.org у кожному `npm ci`.
 */
const DovedeVoiceSection: React.FC = () => {
  const [condition, setCondition] = useState<VoiceCondition>('quiet');
  const [results, setResults] = useState<Record<string, TakeResult>>(readResults);
  const [recorded, setRecorded] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stops, setStops] = useState<StopPlace[]>([]);
  const [routes, setRoutes] = useState<RouteLike[]>([]);
  const session = useRef<{ rec: RecorderSession; ws: WebSpeechSession | null; n: number } | null>(null);
  const hasWebSpeech = webSpeechSupported();

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

  const update = useCallback((key: string, patch: (r: TakeResult) => TakeResult) => {
    setResults((prev) => {
      const next = { ...prev, [key]: patch(prev[key] ?? {}) };
      writeResults(next);
      return next;
    });
  }, []);

  const toggleRecord = async (p: VoicePhrase) => {
    const key = takeKey(p.n, condition);
    if (session.current && session.current.n === p.n) {
      const s = session.current;
      session.current = null;
      setRecording(null);
      setBusy(key);
      s.ws?.stop();
      const blob = await s.rec.stop();
      const ws = s.ws ? await s.ws.result : null;
      update(key, () => ({ webSpeech: ws ?? undefined }));
      if (await saveTake({ key, n: p.n, condition, blob, at: Date.now() })) setRecorded((prev) => new Set(prev).add(key));
      setBusy(null);
      return;
    }
    if (session.current) return;
    setError(null);
    try {
      const ws = hasWebSpeech ? startWebSpeech() : null;
      const rec = await startRecorder();
      session.current = { rec, ws, n: p.n };
      setRecording(p.n);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Мікрофон недоступний');
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
        return r ? [{ n: p.n, condition: c, spoken: p.spoken, ref: p.ref, webSpeech: r.webSpeech ?? null }] : [];
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
        const ws = results[takeKey(p.n, condition)]?.webSpeech;
        return {
          p,
          ws: ws ? { ...ws, match: ws.text ? compareHeard(p.ref, ws.text, now, stops, routes).match : false, wer: wordErrorRate(p.spoken, ws.text) } : null,
        };
      }),
    [results, condition, now, stops, routes],
  );

  const main = rows.filter((r) => !r.p.optional);
  const wsRows = main.filter((r) => r.ws);
  const matched = wsRows.filter((r) => r.ws?.match).length;
  const recordedCount = main.filter((r) => recorded.has(takeKey(r.p.n, condition))).length;

  const unsupported = !recorderSupported();
  let group = '';

  return (
    <div className="dv-voice">
      <AdminSectionHeader
        title="Голос"
        purpose="Лабораторія розпізнавання української: читайте фрази вголос — Web Speech слухає, а розбір порівнюється з набраною фразою. Звук лишається в цьому браузері (для порівняння з хмарою потім)."
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
        <StatTile label="Web Speech: розбір збігся" value={pct(matched, wsRows.length)} sub={`${matched} з ${wsRows.length}`} />
      </StatTiles>

      <section className="dv-voice-controls" aria-label="Налаштування лабораторії">
        <div>
          <span className="dv-voice-label">Умови запису</span>
          <ChipGroup label="Умови запису" options={CONDITIONS} value={condition} onChange={setCondition} />
        </div>
        <p className="dv-voice-status" role="status">
          {error ? `Помилка: ${error}` : !hasWebSpeech ? 'Цей браузер не вміє Web Speech: записуємо лише звук.' : null}
        </p>
      </section>

      {unsupported ? <EmptyState>Цей браузер не дає доступу до мікрофона: потрібні https і MediaRecorder.</EmptyState> : null}

      <table className="dv-voice-table">
        <thead>
          <tr>
            <th scope="col">№</th>
            <th scope="col">Читати вголос</th>
            <th scope="col">Запис</th>
            <th scope="col">Web Speech</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, ws }) => {
            const key = takeKey(p.n, condition);
            const head = p.group !== group ? ((group = p.group), <tr key={`g${p.n}`} className="dv-voice-group"><th colSpan={4}>{p.group}</th></tr>) : null;
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
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const Heard: React.FC<{ heard: { text: string; error?: string; match: boolean; wer: number | null } | null }> = ({ heard }) => {
  if (!heard) return <span className="dv-voice-none">—</span>;
  if (!heard.text) return <span className="dv-voice-bad">{heard.error ? `нічого (${heard.error})` : 'нічого не почув'}</span>;
  return (
    <span className="dv-voice-heard">
      <span className={heard.match ? 'dv-voice-ok' : 'dv-voice-bad'} aria-label={heard.match ? 'розбір збігся' : 'розбір не збігся'}>
        {heard.match ? '✓' : '✗'}
      </span>{' '}
      {heard.text}
      <small>{heard.wer != null ? `слів не так: ${Math.round(heard.wer * 100)} %` : ''}</small>
    </span>
  );
};

export default DovedeVoiceSection;
