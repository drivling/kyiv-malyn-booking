/**
 * Права панель редактора карти: список зупинок з пошуком, вибором (спільним із маркерами) і
 * перейменуванням прямо в рядку. Прокрутка до обраної — лише всередині панелі, без стрибка сторінки.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { displayNameForStopKey, getStopKey, type StopsCatalog } from '../LocalTransportPage/stopCatalog';
import type { RouteStop } from './mapEditorModel';
import { MAX_STOP_NAME_LENGTH, filterStopIds, normalizeStopName } from './stopRename';

export type StopSelectSource = 'list' | 'keyboard';

export interface StopsPanelProps {
  mode: 'coords' | 'direction';
  /** Зупинки для показу (режим координат; панель фільтрує сама) */
  stopIds: string[];
  catalog?: StopsCatalog;
  coords: Record<string, [number, number]>;
  /** Назви з бази — «було: …», бейдж «не збережено», revert */
  dbNameById: Map<string, string>;
  /** Рядок «Також оновиться при збереженні: …» для перейменованих */
  propagationByStopId: Map<string, string | null>;
  selectedStopId: string | null;
  editingStopId: string | null;
  /** Зростає при виборі зі списку/клавіатури — тригер прокрутки до рядка */
  panNonce: number;
  isExcluded: (id: string) => boolean;
  isTechnical: (id: string) => boolean;
  hasArticle: (id: string) => boolean;
  onSelect: (id: string, source: StopSelectSource) => void;
  onStartEdit: (id: string) => void;
  onCancelEdit: () => void;
  /** Повертає текст помилки валідації або null, якщо назву застосовано */
  onApplyRename: (id: string, raw: string) => string | null;
  onRevert: (id: string) => void;
  /** Режим напрямку: впорядковані і виключені зупинки маршруту */
  orderedStops?: RouteStop[];
  excludedStops?: RouteStop[];
  directionTitle?: string;
  onOpenOrderModal?: (id: string) => void;
}

interface StopRowProps {
  id: string;
  name: string;
  dbName?: string;
  coords?: [number, number];
  order?: string;
  selected: boolean;
  editing: boolean;
  excluded: boolean;
  technical: boolean;
  hasArticle: boolean;
  propagation: string | null;
  showCoords: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onApplyRename: (raw: string) => string | null;
  onRevert: () => void;
  onOpenOrderModal?: () => void;
  rowRef: (el: HTMLLIElement | null) => void;
}

const preventBlur = (e: React.MouseEvent) => e.preventDefault();

const StopRow: React.FC<StopRowProps> = ({
  id,
  name,
  dbName,
  coords,
  order,
  selected,
  editing,
  excluded,
  technical,
  hasArticle,
  propagation,
  showCoords,
  onSelect,
  onStartEdit,
  onCancelEdit,
  onApplyRename,
  onRevert,
  onOpenOrderModal,
  rowRef,
}) => {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameBtnRef = useRef<HTMLButtonElement>(null);
  const wasEditingRef = useRef(false);

  useEffect(() => {
    if (editing) {
      setDraft(name);
      setError(null);
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (wasEditingRef.current) {
      nameBtnRef.current?.focus();
    }
    wasEditingRef.current = editing;
  }, [editing, name]);

  const renamed = dbName !== undefined && dbName !== name;
  const errorId = `map-editor-stop-error-${id}`;

  const apply = () => {
    const err = onApplyRename(draft);
    if (err) {
      setError(err);
      inputRef.current?.focus();
    }
  };
  const cancel = () => {
    setError(null);
    onCancelEdit();
  };

  const className = [
    'map-editor-stop-item',
    selected ? 'map-editor-stop-item--selected' : '',
    excluded ? 'map-editor-stop-item--excluded' : '',
    renamed ? 'map-editor-stop-item--renamed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li ref={rowRef} className={className} aria-current={selected ? 'true' : undefined}>
      <div className="map-editor-stop-main">
        {order != null && <span className="map-editor-stop-order">{order}</span>}
        {editing ? (
          <div className="map-editor-stop-edit">
            <input
              ref={inputRef}
              type="text"
              className="map-editor-stop-edit-input"
              aria-label="Нова назва зупинки"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              value={draft}
              maxLength={MAX_STOP_NAME_LENGTH + 20}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  apply();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancel();
                }
              }}
              onBlur={() => {
                if (normalizeStopName(draft) === name) cancel();
                else apply();
              }}
            />
            <button
              type="button"
              className="map-editor-stop-icon-btn map-editor-stop-icon-btn--ok"
              aria-label="Зберегти назву"
              title="Зберегти назву (Enter)"
              onMouseDown={preventBlur}
              onClick={apply}
            >
              ✓
            </button>
            <button
              type="button"
              className="map-editor-stop-icon-btn"
              aria-label="Скасувати"
              title="Скасувати (Esc)"
              onMouseDown={preventBlur}
              onClick={cancel}
            >
              ✕
            </button>
          </div>
        ) : (
          <>
            <button
              ref={nameBtnRef}
              type="button"
              className="map-editor-stop-name-btn"
              title={selected ? 'Перейменувати' : 'Вибрати зупинку'}
              onClick={() => (selected ? onStartEdit() : onSelect())}
            >
              {name}
            </button>
            {selected && (
              <button
                type="button"
                className="map-editor-stop-icon-btn"
                aria-label="Перейменувати"
                title="Перейменувати (Enter)"
                onClick={onStartEdit}
              >
                ✎
              </button>
            )}
            {renamed && (
              <button
                type="button"
                className="map-editor-stop-icon-btn"
                aria-label="Повернути назву з бази"
                title={`Повернути назву з бази: ${dbName}`}
                onClick={onRevert}
              >
                ↶
              </button>
            )}
            {selected && onOpenOrderModal && (
              <button type="button" className="map-editor-stop-text-btn" onClick={onOpenOrderModal}>
                Порядок…
              </button>
            )}
          </>
        )}
      </div>
      {error && (
        <span id={errorId} role="alert" className="map-editor-stop-error">
          {error}
        </span>
      )}
      <div className="map-editor-stop-meta">
        <code className="map-editor-stop-id">{id}</code>
        {showCoords && coords && (
          <span className="map-editor-stop-coords">
            {coords[0].toFixed(6)}, {coords[1].toFixed(6)}
          </span>
        )}
        {technical && <span className="map-editor-stop-badge map-editor-stop-badge--tech">техн.</span>}
        {excluded && <span className="map-editor-stop-badge">виключена</span>}
        {renamed && <span className="map-editor-stop-badge map-editor-stop-badge--unsaved">не збережено</span>}
      </div>
      {renamed && <p className="map-editor-stop-was">було: {dbName}</p>}
      {renamed && propagation && <p className="map-editor-stop-propagation">{propagation}</p>}
      {renamed && hasArticle && (
        <p className="map-editor-stop-note">
          SEO-стаття має власну назву — оновіть <code>name</code> у <code>frontend/src/content/stops/{id}.ts</code>
        </p>
      )}
    </li>
  );
};

export const StopsPanel: React.FC<StopsPanelProps> = ({
  mode,
  stopIds,
  catalog,
  coords,
  dbNameById,
  propagationByStopId,
  selectedStopId,
  editingStopId,
  panNonce,
  isExcluded,
  isTechnical,
  hasArticle,
  onSelect,
  onStartEdit,
  onCancelEdit,
  onApplyRename,
  onRevert,
  orderedStops,
  excludedStops,
  directionTitle,
  onOpenOrderModal,
}) => {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const filtered = useMemo(
    () => (mode === 'coords' ? filterStopIds(stopIds, catalog, query) : stopIds),
    [mode, stopIds, catalog, query]
  );

  // Прокрутка до обраного рядка — лише всередині панелі (не scrollIntoView: сторінка не стрибає)
  useEffect(() => {
    if (!selectedStopId) return;
    const list = listRef.current;
    const row = rowRefs.current.get(selectedStopId);
    if (!list || !row) return;
    const lr = list.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    if (rr.top < lr.top) list.scrollTop -= lr.top - rr.top + 8;
    else if (rr.bottom > lr.bottom) list.scrollTop += rr.bottom - lr.bottom + 8;
  }, [selectedStopId, panNonce]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!filtered.length) return;
      const idx = selectedStopId ? filtered.indexOf(selectedStopId) : -1;
      const next =
        e.key === 'ArrowDown' ? (idx + 1) % filtered.length : idx <= 0 ? filtered.length - 1 : idx - 1;
      onSelect(filtered[next], 'keyboard');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedStopId && filtered.includes(selectedStopId)) onStartEdit(selectedStopId);
      else if (filtered.length) onSelect(filtered[0], 'keyboard');
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  };

  const rowRefFor = (id: string) => (el: HTMLLIElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  };

  const renderRow = (id: string, extra: { order?: string; excluded?: boolean; technical?: boolean } = {}) => (
    <StopRow
      key={id}
      id={id}
      name={displayNameForStopKey(id, catalog)}
      dbName={dbNameById.get(id)}
      coords={coords[id]}
      order={extra.order}
      selected={id === selectedStopId}
      editing={id === editingStopId}
      excluded={extra.excluded ?? isExcluded(id)}
      technical={extra.technical ?? isTechnical(id)}
      hasArticle={hasArticle(id)}
      propagation={propagationByStopId.get(id) ?? null}
      showCoords={mode === 'coords'}
      onSelect={() => onSelect(id, 'list')}
      onStartEdit={() => onStartEdit(id)}
      onCancelEdit={onCancelEdit}
      onApplyRename={(raw) => onApplyRename(id, raw)}
      onRevert={() => onRevert(id)}
      onOpenOrderModal={onOpenOrderModal ? () => onOpenOrderModal(id) : undefined}
      rowRef={rowRefFor(id)}
    />
  );

  if (mode === 'direction' && !orderedStops) {
    return (
      <div ref={listRef} className="map-editor-list">
        <p className="map-editor-hint">Виберіть маршрут для редагування порядку зупинок.</p>
      </div>
    );
  }

  return (
    <div ref={listRef} className="map-editor-list">
      {mode === 'coords' ? (
        <>
          <h3 className="map-editor-list-title">
            Зупинки{' '}
            <span className="map-editor-list-count" aria-live="polite">
              {query ? `${filtered.length} з ${stopIds.length}` : stopIds.length}
            </span>
          </h3>
          <input
            type="search"
            className="map-editor-search"
            aria-label="Пошук зупинки"
            placeholder="Назва або st_…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            autoComplete="off"
          />
          <ul className="map-editor-stops-list">{filtered.map((id) => renderRow(id))}</ul>
        </>
      ) : (
        <>
          <h3 className="map-editor-list-title">{directionTitle}</h3>
          <ul className="map-editor-stops-list">
            {(orderedStops ?? []).map((s, idx) =>
              renderRow(getStopKey(s), { order: `${idx + 1}.`, excluded: false, technical: Boolean(s.map_only) })
            )}
            {(excludedStops ?? []).length > 0 && (
              <li className="map-editor-stop-item map-editor-stop-item--excluded-header">Виключені (-1):</li>
            )}
            {(excludedStops ?? []).map((s) =>
              renderRow(getStopKey(s), { order: '—', excluded: true, technical: Boolean(s.map_only) })
            )}
          </ul>
        </>
      )}
    </div>
  );
};
