import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { DovedeSettingView } from '@/types';
import { AdminSectionHeader, SettingRow } from '../kit';

const GROUP_ORDER: DovedeSettingView['group'][] = ['ai', 'google', 'learning'];

/**
 * Розділ «Налаштування» (Docs/dovede-admin-roadmap.md, крок 3): ліміти, вмикачі й параметри фонового навчання, які
 * власник міняє сам, без деплою. Кожне значення — типове (змінна на сервері чи код) або задане тут; «Скинути до
 * типового» повертає типове. Вмикач, вимкнений на сервері, тут не вмикається. Нове значення діє протягом хвилини.
 */
export const DovedeSettingsSection: React.FC = () => {
  const [items, setItems] = useState<DovedeSettingView[] | null>(null);
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    apiClient
      .getDovedeSettings()
      .then((r) => {
        setItems(r.items);
        setGroups(r.groups);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити налаштування'));
  }, []);

  useEffect(() => load(), [load]);

  const save = async (s: DovedeSettingView, value: number | boolean | null) => {
    setBusy(s.key);
    setNote('');
    try {
      const next = await apiClient.setDovedeSetting(s.key, value);
      setItems((list) => (list ? list.map((x) => (x.key === next.key ? next : x)) : list));
      setNote(value === null ? `«${s.label}» — знову типове: ${typeof next.value === 'boolean' ? (next.value ? 'увімкнено' : 'вимкнено') : next.value}.` : `Збережено: «${s.label}». Діє протягом хвилини.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="dovede-settings">
      <AdminSectionHeader title="Налаштування" purpose="Ліміти, вмикачі й фонове навчання — без деплою. Нове значення діє протягом хвилини." />
      {error ? <p className="dovede-log-error">{error}</p> : null}
      {note ? (
        <p className="dovede-log-note" role="status">
          {note}
        </p>
      ) : null}
      {!items && !error ? <p className="dovede-log-empty">Завантажую…</p> : null}
      {items
        ? GROUP_ORDER.map((g) => {
            const rows = items.filter((s) => s.group === g);
            if (!rows.length) return null;
            return (
              <div key={g} className="admin-kit-settings" role="group" aria-label={groups[g] ?? g}>
                <h3>{groups[g] ?? g}</h3>
                {rows.map((s) => (
                  <SettingRow key={s.key} s={s} busy={busy === s.key} onSave={(v) => save(s, v)} />
                ))}
              </div>
            );
          })
        : null}
    </section>
  );
};
