import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { usePageSeo } from '@/hooks';
import type { TransportDataset } from '@/api/transportDataset';
import type { StickerWallSnapshot } from '@/types';
import { WallBoard, type WallTab } from './WallBoard';
import { WallCelebration } from './WallCelebration';
import {
  CELEBRATION_MS,
  TAB_ROTATE_MS,
  WALL_POLL_MS,
  buildCelebrations,
  isNightHour,
  isQuietHour,
  loadWallSettings,
  saveWallSettings,
  stopDirectory,
  storeWallKey,
  storedWallKey,
  topStops,
  wallStops,
  type Celebration,
  type WallSettings,
} from './stickerWall';
import { playWallSound, resumeWallSound, unlockWallSound, type WallSound } from './wallSound';
import { enterWallFullscreen, keepScreenAwake } from './wallDevice';
import './StickerWall.css';

const SOUND_BY_KIND: Record<Celebration['kind'], WallSound> = {
  scan: 'scan',
  first: 'milestone',
  milestone: 'milestone',
  record: 'record',
  summary: 'scan',
};
const CONTROLS_MS = 8_000;
const TAB_PAUSE_MS = 60_000;

/**
 * Віджет «Відкриття з QR» на стіну (`/admin/wall?key=…`): телефон горизонтально, екран не гасне,
 * кожні 30 с — свіжий знімок сьогоднішніх сканів; нове відкриття — мелодія й святкування з
 * назвою зупинки й лічильником за сьогодні, потім знову табло. Без меню, підвалу й кнопки «Назад»:
 * дотик до екрана показує кілька налаштувань і ховає їх сам.
 */
export function StickerWallPage({ pollMs = WALL_POLL_MS }: { pollMs?: number }) {
  usePageSeo({
    title: 'Віджет · Відкриття з QR | malin.kiev.ua',
    canonicalUrl: 'https://malin.kiev.ua/admin/wall',
    robots: 'noindex, nofollow',
  });
  const [params, setParams] = useSearchParams();
  const urlKey = params.get('key');
  const [key, setKey] = useState<string | null>(() => urlKey || storedWallKey());
  const [keyProblem, setKeyProblem] = useState('');
  const [dataset, setDataset] = useState<TransportDataset | null>(null);
  const [snapshot, setSnapshot] = useState<StickerWallSnapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [started, setStarted] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const [awake, setAwake] = useState(false);
  const [settings, setSettings] = useState<WallSettings>(loadWallSettings);
  const [queue, setQueue] = useState<Celebration[]>([]);
  const [tab, setTab] = useState<WallTab>('top');
  const [tabCycle, setTabCycle] = useState(0);
  const [controls, setControls] = useState(false);

  const cursor = useRef<number | null>(null);
  const day = useRef<string | null>(null);
  const startedRef = useRef(false);
  const tabPausedUntil = useRef(0);
  const dir = useMemo(() => stopDirectory(dataset), [dataset]);
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const stops = useMemo(() => wallStops(snapshot, dir), [snapshot, dir]);

  // Ключ: з адреси (і запам'ятати), інакше збережений, інакше — для адміна з його сесії
  useEffect(() => {
    if (urlKey) {
      storeWallKey(urlKey);
      setKey(urlKey);
    }
  }, [urlKey]);
  useEffect(() => {
    if (key || !apiClient.getAuthToken()) return;
    let cancelled = false;
    apiClient
      .getStickerWallKey()
      .then(({ key: k }) => {
        if (cancelled) return;
        storeWallKey(k);
        setKey(k);
        setParams({ key: k }, { replace: true });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, setParams]);

  // Назви й кольори ліній — з публічного датасету; оновлюємо раз на годину
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiClient
        .getTransportDataset()
        .then((d) => !cancelled && setDataset(d))
        .catch(() => {});
    void load();
    const t = window.setInterval(load, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const poll = useCallback(async () => {
    if (!key) return;
    try {
      const snap = await apiClient.getStickerWall(key, cursor.current ?? 0);
      setOffline(false);
      setKeyProblem('');
      const fresh = cursor.current === null || day.current !== snap.day;
      if (!fresh && snap.events.length && startedRef.current) {
        const items = buildCelebrations(snap, wallStops(snap, dirRef.current));
        setQueue((q) => [...q, ...items]);
      }
      cursor.current = snap.lastId;
      day.current = snap.day;
      setSnapshot(snap);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 403 || /403|Invalid wall key/i.test(String((e as Error).message))) {
        setKeyProblem('Посилання застаріло — відкрийте нове в адмінці («Наклейки зупинок» → «Віджет на стіну»).');
      } else setOffline(true);
    }
  }, [key]);

  useEffect(() => {
    if (!key) return;
    void poll();
    const t = window.setInterval(() => void poll(), pollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        resumeWallSound();
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, poll, pollMs]);

  // Годинник і «N хв тому»
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  // Автоперемикання вкладок (після ручного вибору — пауза на хвилину)
  useEffect(() => {
    const t = window.setInterval(() => {
      if (Date.now() < tabPausedUntil.current) return;
      setTab((x) => (x === 'top' ? 'growing' : 'top'));
      setTabCycle((n) => n + 1);
    }, TAB_ROTATE_MS);
    return () => window.clearInterval(t);
  }, []);

  const quiet = settings.quietNights && isQuietHour(now);
  const soundOn = settings.sound && soundReady && !quiet;
  const current = queue[0] ?? null;
  // зміна налаштування звуку не має перезапускати святкування, тому — через ref
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;

  // Черга святкувань: мелодія на початку кожного, через CELEBRATION_MS — наступне або табло
  useEffect(() => {
    if (!current) return;
    if (soundOnRef.current) playWallSound(SOUND_BY_KIND[current.kind]);
    const t = window.setTimeout(() => setQueue((q) => q.slice(1)), CELEBRATION_MS);
    return () => window.clearTimeout(t);
  }, [current]);

  useEffect(() => {
    if (!controls) return;
    const t = window.setTimeout(() => setControls(false), CONTROLS_MS);
    return () => window.clearTimeout(t);
  }, [controls, settings]);

  useEffect(() => {
    document.body.classList.add('wall-mode');
    const meta = document.querySelector('meta[name="theme-color"]');
    const prev = meta?.getAttribute('content') ?? null;
    meta?.setAttribute('content', '#0f1420');
    return () => {
      document.body.classList.remove('wall-mode');
      if (meta && prev) meta.setAttribute('content', prev);
    };
  }, []);

  const releaseAwake = useRef<() => void>(() => {});
  useEffect(() => () => releaseAwake.current(), []);

  const start = () => {
    const ok = unlockWallSound();
    setSoundReady(ok);
    if (ok && settings.sound) playWallSound('hello');
    void enterWallFullscreen();
    releaseAwake.current = keepScreenAwake(setAwake);
    startedRef.current = true;
    setStarted(true);
  };

  const update = (patch: Partial<WallSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveWallSettings(next);
  };

  const testCelebration = () => {
    const top = topStops(stops, 1)[0];
    const total = snapshot?.total ?? 0;
    setQueue((q) => [
      ...q,
      {
        key: `test-${Date.now()}`,
        kind: 'scan',
        headline: 'Перевірка святкування',
        stopId: top?.stopId ?? 'test',
        name: top?.name ?? 'Тестова зупинка',
        lines: top?.lines ?? [],
        color: top?.color ?? '#2a78d6',
        added: 1,
        stopToday: top?.today ?? 0,
        rank: top ? 1 : 0,
        totalAfter: total,
      },
    ]);
    setControls(false);
  };

  if (!key) {
    return (
      <div className="wall wall--message">
        <div className="wall-card">
          <p className="wall-brand-name">МАЛИН</p>
          <h1>Віджет «Відкриття з QR»</h1>
          <p>Відкрийте посилання з адмінки: «Наклейки зупинок» → «Віджет на стіну» (QR-код для телефона).</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`wall${isNightHour(now) ? ' wall--night' : ''}`}
      onClick={() => started && !current && setControls((v) => !v)}
    >
      <WallBoard
        snapshot={snapshot}
        stops={stops}
        now={now}
        tab={tab}
        onTab={(t) => {
          tabPausedUntil.current = Date.now() + TAB_PAUSE_MS;
          setTab(t);
          setTabCycle((n) => n + 1);
        }}
        tabCycle={tabCycle}
        awake={awake}
        offline={offline}
        soundOn={soundOn}
      />
      {keyProblem && <p className="wall-problem">{keyProblem}</p>}
      {current && <WallCelebration key={current.key} celebration={current} />}
      {controls && !current && (
        <div className="wall-controls" onClick={(e) => e.stopPropagation()} role="group" aria-label="Налаштування віджета">
          <button type="button" aria-pressed={settings.sound} onClick={() => update({ sound: !settings.sound })}>
            {settings.sound ? '♪ Звук увімкнено' : '🔇 Без звуку'}
          </button>
          <button type="button" aria-pressed={settings.quietNights} onClick={() => update({ quietNights: !settings.quietNights })}>
            🌙 Тихо вночі (22–08): {settings.quietNights ? 'так' : 'ні'}
          </button>
          <button type="button" onClick={testCelebration}>
            ✨ Перевірити
          </button>
          <button type="button" onClick={() => void enterWallFullscreen()}>
            ⛶ На весь екран
          </button>
        </div>
      )}
      {!started && (
        <div className="wall-start" onClick={(e) => e.stopPropagation()}>
          <div className="wall-card">
            <p className="wall-brand-name">МАЛИН</p>
            <h1>Віджет «Відкриття з QR»</h1>
            <p>
              Поверніть телефон горизонтально й торкніться «Почати»: екран не гаситиметься, а кожне нове відкриття
              наклейки віджет покаже й зіграє мелодію.
            </p>
            <button type="button" className="wall-start-btn" onClick={start}>
              Почати
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
