import { useMemo, useState } from 'react';
import type { StickerSide } from '@/types';
import { ChipGroup } from '../kit';
import { filterStopRows, sortStopRows, stopFilterCounts, type StopFilter, type StopSort, type StopStatRow } from './scanStats';
import { routeNo } from '@/utils/routeNames';
import { textColorOn } from '@/pages/LocalTransportPage/routeColors';

const SIDE_SHORT: Record<StickerSide, string> = { a: 'Б1', b: 'Б2', s: 'Одна' };
const SIDE_ORDER: StickerSide[] = ['a', 'b', 's'];

function shortDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });
}

/**
 * Список усіх зупинок для наклейок (ліва колонка вкладки): фільтр «усі / з наклейками / мовчать / без наклейки»
 * (у адресі `?only=`), пошук, сортування; у рядку — лінії, відкриття по наклейках (Б1 / Б2 / одна), за 7 днів,
 * дата останнього друку й позначка «мовчить N дн». Клік обирає зупинку для редактора друку праворуч.
 */
export function StickerStopList({
  rows,
  selectedId,
  onSelect,
  only,
  onOnly,
}: {
  rows: StopStatRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  only: StopFilter;
  onOnly: (f: StopFilter) => void;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StopSort>('popular');
  const counts = useMemo(() => stopFilterCounts(rows), [rows]);
  const shown = useMemo(() => sortStopRows(filterStopRows(rows, { query, only }), sort), [rows, query, only, sort]);
  const filters = [
    { value: 'all' as const, label: `Усі ${counts.all}` },
    { value: 'stickers' as const, label: `З наклейками ${counts.stickers}` },
    { value: 'silent' as const, label: `Мовчать ${counts.silent}` },
    { value: 'none' as const, label: `Без наклейки ${counts.none}` },
  ];

  return (
    <section className="sticker-stops" aria-labelledby="sticker-stops-title">
      <div className="sticker-stops-head">
        <h3 id="sticker-stops-title">Зупинки</h3>
        <select value={sort} onChange={(e) => setSort(e.target.value as StopSort)} aria-label="Сортування зупинок">
          <option value="popular">Популярні</option>
          <option value="recent">Нещодавні скани</option>
          <option value="name">За назвою</option>
        </select>
      </div>
      <ChipGroup label="Які зупинки" options={filters} value={only} onChange={onOnly} />
      <input
        type="search"
        className="sticker-stops-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Пошук серед ${shown.length}`}
        aria-label="Пошук зупинки"
      />
      <ul className="sticker-stops-list">
        {shown.map((r) => {
          const sides = SIDE_ORDER.filter((k) => r.sides[k] !== undefined || r.printedSides.includes(k));
          return (
            <li key={r.stopId}>
              <button
                type="button"
                className={`sticker-stops-row${r.silent.length ? ' is-silent' : ''}`}
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
                    <span
                      key={l.routeId}
                      className="sticker-stops-badge"
                      style={{ background: l.color ?? '#1b1f2a', color: textColorOn(l.color ?? '#1b1f2a') }}
                    >
                      {routeNo(l.routeId)}
                    </span>
                  ))}
                  {!r.lines.length && <span className="sticker-tab-muted">ліній уже немає</span>}
                </span>
                <span className="sticker-stops-meta">
                  {sides.map((k) => `${SIDE_SHORT[k]} ${r.sides[k] ?? 0}`).join(' · ')}
                  {r.lastPrintAt && <span className="sticker-stops-printed"> друк {shortDate(r.lastPrintAt)}</span>}
                </span>
                {r.silent.length > 0 && (
                  <span className="sticker-stops-flag">
                    мовчить {r.silent.map((x) => `${SIDE_SHORT[x.side]} ${x.days} дн`).join(' · ')} — перевірте на місці
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="sticker-tab-muted sticker-stops-none">Нічого не знайдено</li>}
      </ul>
    </section>
  );
}
