import React, { useEffect, useMemo, useState } from 'react';
import type { LunchDaySummary } from '@/types';
import { ChipGroup, EmptyState } from '../kit';
import { conflictNorms, filterDishes, type DishFilter } from './lunchText';

/**
 * База страв рядками: назва, ціна, роль лотка, синоніми (перенести / прибрати / додати), «Зберегти». Фільтр «Усі ·
 * Сьогодні в меню · З конфліктом» і пошук за назвою або синонімом. Синонім, що лежить на кількох стравах, червоний.
 */
export const LunchCatalog: React.FC<{
  dishes: LunchDaySummary['dishes'];
  todayIds: ReadonlySet<number>;
  saving: boolean;
  onSave: (id: number, priceUah: number, trayRole: string) => void;
  onAddSynonym: (dishId: number, rawText: string) => void;
  onDeleteSynonym: (synonymId: number) => void;
  onMoveSynonym: (synonymId: number, dishId: number) => void;
}> = ({ dishes, todayIds, saving, onSave, onAddSynonym, onDeleteSynonym, onMoveSynonym }) => {
  const [drafts, setDrafts] = useState<Record<number, { price: string; role: string }>>({});
  const [addDrafts, setAddDrafts] = useState<Record<number, string>>({});
  const [only, setOnly] = useState<DishFilter>('all');
  const [query, setQuery] = useState('');
  const conflicts = useMemo(() => conflictNorms(dishes), [dishes]);
  const sorted = useMemo(() => [...dishes].sort((a, b) => a.name.localeCompare(b.name, 'uk')), [dishes]);
  const shown = useMemo(() => filterDishes(sorted, { only, query, todayIds, conflicts }), [sorted, only, query, todayIds, conflicts]);
  const counts = useMemo(
    () => ({
      all: dishes.length,
      today: dishes.filter((d) => todayIds.has(d.id)).length,
      conflicts: filterDishes(dishes, { only: 'conflicts', query: '', todayIds, conflicts }).length,
    }),
    [dishes, todayIds, conflicts]
  );

  useEffect(() => {
    const next: Record<number, { price: string; role: string }> = {};
    for (const d of dishes) next[d.id] = { price: String(d.priceUah), role: d.trayRole };
    setDrafts(next);
  }, [dishes]);

  const add = (dishId: number) => {
    const val = (addDrafts[dishId] || '').trim();
    if (!val) return;
    onAddSynonym(dishId, val);
    setAddDrafts({ ...addDrafts, [dishId]: '' });
  };

  return (
    <>
      <div className="lunch-toolbar">
        <ChipGroup
          label="Які страви"
          value={only}
          onChange={setOnly}
          options={[
            { value: 'all', label: `Усі ${counts.all}` },
            { value: 'today', label: `Сьогодні в меню ${counts.today}` },
            { value: 'conflicts', label: `З конфліктом ${counts.conflicts}` },
          ]}
        />
        <input
          type="search"
          className="lunch-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Назва або синонім"
          aria-label="Пошук страви"
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState>Страв за цим фільтром немає.</EmptyState>
      ) : (
        <ul className="lunch-rows" aria-label="База страв">
          {shown.map((d) => {
            const draft = drafts[d.id] || { price: String(d.priceUah), role: d.trayRole };
            const addVal = addDrafts[d.id] || '';
            const changed = draft.price !== String(d.priceUah) || draft.role !== d.trayRole;
            return (
              <li key={d.id} className="lunch-dish">
                <div className="lunch-dish__main">
                  <strong>{d.name}</strong>
                  {todayIds.has(d.id) && <span className="sched-tag lunch-tag--ok">сьогодні</span>}
                  <label className="lunch-dish__field">
                    <input
                      type="number"
                      min={1}
                      className="lunch-input lunch-input--sm"
                      aria-label={`Ціна: ${d.name}`}
                      value={draft.price}
                      onChange={(e) => setDrafts({ ...drafts, [d.id]: { ...draft, price: e.target.value } })}
                    />
                    грн
                  </label>
                  <select
                    className="lunch-input"
                    aria-label={`Лоток: ${d.name}`}
                    value={draft.role}
                    onChange={(e) => setDrafts({ ...drafts, [d.id]: { ...draft, role: e.target.value } })}
                  >
                    <option value="soup">суп</option>
                    <option value="second">друге</option>
                    <option value="salad">салат</option>
                  </select>
                  <button
                    type="button"
                    className={`admin-kit-btn${changed ? '' : ' admin-kit-btn--quiet'}`}
                    disabled={saving}
                    onClick={() => onSave(d.id, Number(draft.price), draft.role)}
                  >
                    Зберегти
                  </button>
                </div>
                <div className="lunch-syn-list">
                  {d.synonyms.map((s) => {
                    const conflict = Boolean(s.rawNorm && conflicts.has(s.rawNorm));
                    return (
                      <span
                        key={s.id}
                        className={`lunch-syn-chip${conflict ? ' lunch-syn-chip--conflict' : ''}`}
                        title={conflict ? 'Цей текст є синонімом ще й іншої страви — діє найновіший запис. Видали зайвий.' : undefined}
                      >
                        <span className="lunch-syn-chip__text">{s.rawText}</span>
                        <select
                          className="lunch-syn-move"
                          value=""
                          disabled={saving}
                          aria-label="Перенести синонім"
                          onChange={(e) => {
                            const id = Number(e.target.value);
                            e.target.value = '';
                            if (id) onMoveSynonym(s.id, id);
                          }}
                        >
                          <option value="">на іншу…</option>
                          {sorted
                            .filter((other) => other.id !== d.id)
                            .map((other) => (
                              <option key={other.id} value={other.id}>
                                {other.name}
                              </option>
                            ))}
                        </select>
                        <button type="button" className="lunch-chip-x" disabled={saving} aria-label="Прибрати синонім" onClick={() => onDeleteSynonym(s.id)}>
                          ✕
                        </button>
                      </span>
                    );
                  })}
                  <span className="lunch-syn-add">
                    <input
                      className="lunch-input"
                      placeholder="+ синонім"
                      aria-label={`Новий синонім: ${d.name}`}
                      value={addVal}
                      disabled={saving}
                      onChange={(e) => setAddDrafts({ ...addDrafts, [d.id]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        add(d.id);
                      }}
                    />
                    {addVal.trim() && (
                      <button type="button" className="admin-kit-btn admin-kit-btn--quiet" disabled={saving} onClick={() => add(d.id)}>
                        Додати
                      </button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};
