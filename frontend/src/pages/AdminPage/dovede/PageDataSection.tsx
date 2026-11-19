import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import type { DovedePageDataItem } from '@/types';
import { METRO_STATIONS, type MetroLine } from '@/pages/DovedePage/nlu/kyivMetroData';
import { METRO_LINE, METRO_SERVICE, METRO_SHUTTLE_DEFAULT, type MetroShuttle } from '@/pages/DovedePage/data/kyivMetroService';
import { RING_TRAINS } from '@/pages/DovedePage/data/kyivRing';
import { EXAMPLES_DEFAULT, KOROSTEN_EXAMPLES_DEFAULT } from '@/pages/DovedePage/data/examples';

const LINES: MetroLine[] = ['M1', 'M2', 'M3'];
const stationName = (id: string) => METRO_STATIONS.find((s) => s.id === id)?.name ?? id;
const onLine = (line: MetroLine) => METRO_STATIONS.filter((s) => s.line === line);
const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const fromHhmm = (v: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '');

/** Станції замінника: від `after` (поїзди ще доходять) до `end` у той чи інший бік лінії, без `after` */
function shuttleStations(line: MetroLine, after: string, end: string): string[] {
  const ids = onLine(line).map((s) => s.id);
  const a = ids.indexOf(after);
  const b = ids.indexOf(end);
  if (a < 0 || b < 0 || a === b) return [];
  return b > a ? ids.slice(a + 1, b + 1) : ids.slice(b, a);
}

/** Кінцева станція дільниці замінника — найдальша від `after` */
const shuttleEnd = (sh: MetroShuttle): string => {
  const ids = onLine(sh.line).map((s) => s.id);
  const a = ids.indexOf(sh.after);
  const idx = sh.stations.map((s) => ids.indexOf(s)).filter((i) => i >= 0);
  if (!idx.length) return sh.after;
  return ids[idx.some((i) => i > a) ? Math.max(...idx) : Math.min(...idx)];
};

const Source: React.FC<{ item: DovedePageDataItem | undefined; busy: boolean; onReset: () => void }> = ({ item, busy, onReset }) => (
  <p className="admin-kit-setting-source">
    {item?.changed ? (
      <>
        <span>змінено в адмінці{item.updatedAt ? ` ${when(item.updatedAt)}` : ''}</span>
        <button type="button" className="admin-kit-linkbtn" disabled={busy} onClick={onReset}>
          Скинути до типового з коду
        </button>
      </>
    ) : (
      <span>типове з коду</span>
    )}
  </p>
);

/** Автобус замість метро: вимкнено — поїзди їздять усюди; увімкнено — лінія, дільниця, номер, час */
const ShuttleRow: React.FC<{ item: DovedePageDataItem | undefined; busy: boolean; onSave: (v: unknown, reset?: boolean) => void }> = ({ item, busy, onSave }) => {
  const current = (item?.changed ? (item.value as MetroShuttle | null) : METRO_SHUTTLE_DEFAULT) ?? null;
  const [on, setOn] = useState(current !== null);
  const base = current ?? METRO_SHUTTLE_DEFAULT ?? { line: 'M3' as MetroLine, after: 'kyiv.m.vydubychi', stations: ['kyiv.m.slavutych'], bus: '', hopSeconds: 200, waitSeconds: 300 };
  const [line, setLine] = useState<MetroLine>(base.line);
  const [after, setAfter] = useState(base.after);
  const [end, setEnd] = useState(shuttleEnd(base));
  const [bus, setBus] = useState(base.bus);
  // хвилини для людини; поле не чіпали — лишаються точні секунди (200 с ≠ 3,3 хв × 60)
  const hopText = String(Math.round((base.hopSeconds / 60) * 10) / 10);
  const waitText = String(Math.round(base.waitSeconds / 60));
  const [hopMin, setHopMin] = useState(hopText);
  const [waitMin, setWaitMin] = useState(waitText);

  useEffect(() => {
    setOn(current !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- лише коли прийшло нове значення з сервера
  }, [item?.updatedAt, item?.changed]);

  const stations = useMemo(() => shuttleStations(line, after, end), [line, after, end]);
  const hop = hopMin === hopText ? base.hopSeconds : Math.round(Number(hopMin.replace(',', '.')) * 60);
  const wait = waitMin === waitText ? base.waitSeconds : Math.round(Number(waitMin.replace(',', '.')) * 60);
  const valid = !on || (stations.length > 0 && /^[\p{L}\d-]{1,10}$/u.test(bus.trim()) && hop >= 30 && hop <= 1800 && wait >= 0 && wait <= 3600);

  const save = () => onSave(on ? { line, after, stations, bus: bus.trim(), hopSeconds: hop, waitSeconds: wait, checkedAt: new Date().toISOString().slice(0, 10) } : null);
  const lineStations = onLine(line);

  return (
    <div className="admin-kit-setting">
      <div className="admin-kit-setting-text">
        <label htmlFor="dv-pd-shuttle-on">{item?.label ?? 'Автобус замість метро'}</label>
        <p>{item?.help}</p>
        <p>
          Зараз:{' '}
          {current
            ? `${METRO_LINE[current.line].no}: після «${stationName(current.after)}» до «${stationName(shuttleEnd(current))}» — автобус №${current.bus} (станцій ${current.stations.length})`
            : 'метро їздить усюди'}
          .
        </p>
      </div>
      <div>
        <label className="admin-kit-switch">
          <input id="dv-pd-shuttle-on" type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> автобус замість метро
        </label>
        {on ? (
          <div className="dv-pd-grid">
            <label>
              Лінія
              <select
                value={line}
                onChange={(e) => {
                  const l = e.target.value as MetroLine;
                  setLine(l);
                  const ids = onLine(l).map((s) => s.id);
                  setAfter(ids[0]);
                  setEnd(ids[ids.length - 1]);
                }}
              >
                {LINES.map((l) => (
                  <option key={l} value={l}>
                    {METRO_LINE[l].no} — {METRO_LINE[l].name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Поїзди доходять до
              <select value={after} onChange={(e) => setAfter(e.target.value)}>
                {lineStations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Автобус їде до
              <select value={end} onChange={(e) => setEnd(e.target.value)}>
                {lineStations.map((s) => (
                  <option key={s.id} value={s.id} disabled={s.id === after}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Автобус №
              <input value={bus} onChange={(e) => setBus(e.target.value)} aria-invalid={!/^[\p{L}\d-]{1,10}$/u.test(bus.trim())} />
            </label>
            <label>
              Хв на перегін
              <input type="number" inputMode="decimal" step="0.5" min={0.5} max={30} value={hopMin} onChange={(e) => setHopMin(e.target.value)} aria-invalid={!(hop >= 30 && hop <= 1800)} />
            </label>
            <label>
              Чекати автобус, хв
              <input type="number" inputMode="numeric" min={0} max={60} value={waitMin} onChange={(e) => setWaitMin(e.target.value)} aria-invalid={!(wait >= 0 && wait <= 3600)} />
            </label>
          </div>
        ) : null}
        {on && stations.length ? <p className="admin-kit-setting-source">Автобусом: {stations.map(stationName).join(', ')}.</p> : null}
        <div className="admin-kit-setting-form">
          <button type="button" className="admin-kit-btn" disabled={busy || !valid} onClick={save}>
            Зберегти
          </button>
        </div>
        <Source item={item} busy={busy} onReset={() => onSave(null, true)} />
      </div>
    </div>
  );
};

/** Години входу й тариф метро */
const ServiceRow: React.FC<{ item: DovedePageDataItem | undefined; busy: boolean; onSave: (v: unknown, reset?: boolean) => void }> = ({ item, busy, onSave }) => {
  const cur = (item?.changed ? (item.value as { openMins: number; closeMins: number; fareUah: number }) : null) ?? { openMins: METRO_SERVICE.openMins, closeMins: METRO_SERVICE.closeMins, fareUah: METRO_SERVICE.fareUah };
  const [open, setOpen] = useState(hhmm(cur.openMins));
  const [close, setClose] = useState(hhmm(cur.closeMins % 1440));
  const [fare, setFare] = useState(String(cur.fareUah));
  useEffect(() => {
    setOpen(hhmm(cur.openMins));
    setClose(hhmm(cur.closeMins % 1440));
    setFare(String(cur.fareUah));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- лише коли прийшло нове значення з сервера
  }, [item?.updatedAt, item?.changed]);
  const o = fromHhmm(open);
  // закриття «00:00» — це кінець доби
  const c = fromHhmm(close) || 1440;
  const f = Number(fare);
  const valid = Number.isFinite(o) && Number.isFinite(c) && c > o && Number.isInteger(f) && f >= 0 && f <= 500;
  return (
    <div className="admin-kit-setting">
      <div className="admin-kit-setting-text">
        <label htmlFor="dv-pd-open">{item?.label ?? 'Години й тариф метро'}</label>
        <p>{item?.help}</p>
      </div>
      <div>
        <div className="dv-pd-grid">
          <label>
            Вхід з
            <input id="dv-pd-open" type="time" value={open} onChange={(e) => setOpen(e.target.value)} />
          </label>
          <label>
            Закриття
            <input type="time" value={close} onChange={(e) => setClose(e.target.value)} />
          </label>
          <label>
            Тариф, грн
            <input type="number" inputMode="numeric" min={0} max={500} value={fare} onChange={(e) => setFare(e.target.value)} aria-invalid={!(Number.isInteger(f) && f >= 0 && f <= 500)} />
          </label>
        </div>
        <div className="admin-kit-setting-form">
          <button type="button" className="admin-kit-btn" disabled={busy || !valid} onClick={() => onSave({ openMins: o, closeMins: c, fareUah: f })}>
            Зберегти
          </button>
        </div>
        <Source item={item} busy={busy} onReset={() => onSave(null, true)} />
      </div>
    </div>
  );
};

type RingExtra = { from: string; fromTime?: string; to: string };

/** Дні додаткових рейсів «Д» з розкладу (`kyivRingTimetable.json`); null — у розкладі їх немає */
const RING_EXTRA_DEFAULT: RingExtra | null = (() => {
  const t = RING_TRAINS.find((x) => x.extra && x.from && x.to);
  return t && t.from && t.to ? { from: t.from, to: t.to, ...(t.fromMins ? { fromTime: hhmm(t.fromMins) } : {}) } : null;
})();

const dayMonth = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long' });

/** Додаткові рейси міської електрички: вимкнено — їх немає; увімкнено — з дати (і часу першого дня) до дати */
const RingExtraRow: React.FC<{ item: DovedePageDataItem | undefined; busy: boolean; onSave: (v: unknown, reset?: boolean) => void }> = ({ item, busy, onSave }) => {
  const current = item?.changed ? (item.value as RingExtra | null) : RING_EXTRA_DEFAULT;
  const base = current ?? RING_EXTRA_DEFAULT ?? { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) };
  const [on, setOn] = useState(current !== null);
  const [from, setFrom] = useState(base.from);
  const [fromTime, setFromTime] = useState(base.fromTime ?? '');
  const [to, setTo] = useState(base.to);
  const valid = !on || (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= from);
  return (
    <div className="admin-kit-setting">
      <div className="admin-kit-setting-text">
        <label htmlFor="dv-pd-ring-on">{item?.label ?? 'Додаткові рейси міської електрички'}</label>
        <p>{item?.help}</p>
        <p>
          Зараз: {current ? `з ${dayMonth(current.from)}${current.fromTime ? ` (з ${current.fromTime})` : ''} до ${dayMonth(current.to)} включно` : 'додаткових рейсів немає'}.
        </p>
      </div>
      <div>
        <label className="admin-kit-switch">
          <input id="dv-pd-ring-on" type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> додаткові рейси «Д» ходять
        </label>
        {on ? (
          <div className="dv-pd-grid">
            <label>
              З дати
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              Першого дня з
              <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
            </label>
            <label>
              До дати включно
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={!(to >= from)} />
            </label>
          </div>
        ) : null}
        <div className="admin-kit-setting-form">
          <button type="button" className="admin-kit-btn" disabled={busy || !valid} onClick={() => onSave(on ? { from, to, ...(fromTime ? { fromTime } : {}) } : null)}>
            Зберегти
          </button>
        </div>
        <Source item={item} busy={busy} onReset={() => onSave(null, true)} />
      </div>
    </div>
  );
};

type Examples = { malyn?: string[]; korosten?: string[] };
const lines = (t: string) =>
  t
    .split('\n')
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
const listOk = (l: string[]) => l.length >= 1 && l.length <= 10 && l.every((x) => x.length >= 3 && x.length <= 120);

/** Приклади питань: по одному в рядку, окремо для сторінки Малина й Коростеня */
const ExamplesRow: React.FC<{ item: DovedePageDataItem | undefined; busy: boolean; onSave: (v: unknown, reset?: boolean) => void }> = ({ item, busy, onSave }) => {
  const stored = (item?.changed ? (item.value as Examples) : null) ?? {};
  const [malyn, setMalyn] = useState((stored.malyn ?? EXAMPLES_DEFAULT).join('\n'));
  const [korosten, setKorosten] = useState((stored.korosten ?? KOROSTEN_EXAMPLES_DEFAULT).join('\n'));
  const m = lines(malyn);
  const k = lines(korosten);
  const valid = listOk(m) && listOk(k);
  return (
    <div className="admin-kit-setting">
      <div className="admin-kit-setting-text">
        <label htmlFor="dv-pd-examples-malyn">{item?.label ?? 'Приклади питань на сторінці'}</label>
        <p>{item?.help}</p>
        <p>По одному питанню в рядку, до 10; так, як написала б людина. Натиснута кнопка одразу питає — перевірте, що сторінка його розуміє.</p>
      </div>
      <div>
        <div className="dv-pd-grid dv-pd-grid--wide">
          <label>
            Малин (і Київ, Житомир)
            <textarea id="dv-pd-examples-malyn" rows={6} value={malyn} onChange={(e) => setMalyn(e.target.value)} aria-invalid={!listOk(m)} />
          </label>
          <label>
            Коростень
            <textarea rows={4} value={korosten} onChange={(e) => setKorosten(e.target.value)} aria-invalid={!listOk(k)} />
          </label>
        </div>
        <div className="admin-kit-setting-form">
          <button type="button" className="admin-kit-btn" disabled={busy || !valid} onClick={() => onSave({ malyn: m, korosten: k })}>
            Зберегти
          </button>
        </div>
        <Source item={item} busy={busy} onReset={() => onSave(null, true)} />
      </div>
    </div>
  );
};

/**
 * «Дані сторінки» в розділі «Налаштування» (Docs/dovede-admin-roadmap.md, крок 11): те, що змінюється в житті й раніше
 * потребувало коду та деплою. Сторінка «Доведе» читає змінене при відкритті (`GET /dovede/page-data`); «Скинути до
 * типового» повертає значення з коду сторінки.
 */
export const PageDataSection: React.FC = () => {
  const [items, setItems] = useState<DovedePageDataItem[] | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiClient
      .getDovedePageData()
      .then((r) => {
        setItems(r.items);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити дані сторінки'));
  }, []);
  useEffect(() => load(), [load]);

  const save = async (key: string, value: unknown, reset = false) => {
    setBusy(true);
    setNote('');
    setError('');
    try {
      const next = await apiClient.setDovedePageData(key, value, reset);
      setItems((list) => (list ? list.map((x) => (x.key === key ? next : x)) : list));
      setNote(reset ? `«${next.label}» — знову типове з коду.` : `Збережено: «${next.label}». Нові відкриття сторінки бачать це протягом хвилини.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти');
    } finally {
      setBusy(false);
    }
  };

  const by = (key: string) => items?.find((x) => x.key === key);
  return (
    <div className="admin-kit-settings" role="group" aria-label="Дані сторінки">
      <h3>Дані сторінки</h3>
      {error ? (
        <p className="dovede-log-error dv-pd-msg" role="alert">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="dovede-log-note dv-pd-msg" role="status">
          {note}
        </p>
      ) : null}
      {!items && !error ? <p className="dovede-log-empty dv-pd-msg">Завантажую…</p> : null}
      {items ? (
        <>
          <ShuttleRow key={`sh-${by('metro.shuttle')?.updatedAt ?? 'code'}`} item={by('metro.shuttle')} busy={busy} onSave={(v, reset) => void save('metro.shuttle', v, reset)} />
          <ServiceRow item={by('metro.service')} busy={busy} onSave={(v, reset) => void save('metro.service', v, reset)} />
          <RingExtraRow key={`ring-${by('ring.extra')?.updatedAt ?? 'code'}`} item={by('ring.extra')} busy={busy} onSave={(v, reset) => void save('ring.extra', v, reset)} />
          <ExamplesRow key={`ex-${by('examples')?.updatedAt ?? 'code'}`} item={by('examples')} busy={busy} onSave={(v, reset) => void save('examples', v, reset)} />
        </>
      ) : null}
    </div>
  );
};
