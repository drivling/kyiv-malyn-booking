import { useMemo, useState } from 'react';
import type { StickerSide } from '@/types';
import { filterStopRows, sortStopRows, type StopSort, type StopStatRow } from './scanStats';

const SIDE_SHORT: Record<StickerSide, string> = { a: 'Б1', b: 'Б2', s: 'Одна' };
const SIDE_ORDER: StickerSide[] = ['a', 'b', 's'];

function shortDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });
}

/**
 * Список усіх зупинок для наклейок (ліва колонка вкладки): пошук, сортування, «лише з наклейками»;
 * у рядку — лінії, відкриття по наклейках (Б1 / Б2 / одна), за 7 днів і дата останнього друку.
 * Клік обирає зупинку для редактора друку праворуч.
 */
export function StickerStopList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: StopStatRow[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StopSort>('popular');
  const [onlyWithStickers, setOnlyWithStickers] = useState(false);
  const shown = useMemo(
    () => sortStopRows(filterStopRows(rows, { query, onlyWithStickers }), sort),
    [rows, query, onlyWithStickers, sort]
  );

  return (
    <section className="sticker-stops" aria-labelledby="sticker-stops-title">
      <h3 id="sticker-stops-title">Зупинки</h3>
      <input
        type="search"
        className="sticker-stops-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Пошук зупинки"
        aria-label="Пошук зупинки"
      />
      <div className="sticker-stops-tools">
        <select value={sort} onChange={(e) => setSort(e.target.value as StopSort)} aria-label="Сортування зупинок">
          <option value="popular">Популярні</option>
          <option value="recent">Нещодавні скани</option>
          <option value="name">За назвою</option>
        </select>
        <label>
          <input type="checkbox" checked={onlyWithStickers} onChange={(e) => setOnlyWithStickers(e.target.checked)} />
          Лише з наклейками
        </label>
      </div>
      <p className="sticker-tab-muted">
        {shown.length} з {rows.length}
      </p>
      <ul className="sticker-stops-list">
        {shown.map((r) => {
          const sides = SIDE_ORDER.filter((k) => r.sides[k] !== undefined || r.printedSides.includes(k));
          return (
            <li key={r.stopId}>
              <button
                type="button"
                className="sticker-stops-row"
                aria-pressed={r.stopId === selectedId}
                onClick={() => onSelect(r.stopId)}
              >
                <span className="sticker-stops-name">{r.name}</span>
                <span className="sticker-stops-total">
                  <strong>{r.total}</strong>
                  {r.last7d > 0 && <span className="sticker-tab-muted"> · +{r.last7d} за 7 дн</span>}
                </span>
                <span className="sticker-stops-lines">
                  {r.lines.map((l) => (
                    <span key={l.routeId} className="sticker-stops-badge" style={{ background: l.color ?? '#1b1f2a' }}>
                      {l.routeId}
                    </span>
                  ))}
                </span>
                <span className="sticker-stops-meta">
                  {sides.map((k) => `${SIDE_SHORT[k]} ${r.sides[k] ?? 0}`).join(' · ')}
                  {r.lastPrintAt && <span className="sticker-stops-printed"> друк {shortDate(r.lastPrintAt)}</span>}
                </span>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="sticker-tab-muted">Нічого не знайдено</li>}
      </ul>
    </section>
  );
}
