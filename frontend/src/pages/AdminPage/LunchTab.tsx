import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import type { LunchDaySummary } from '@/types';
import './LunchTab.css';

const EXAMPLE_JSON = `{"items":[{"name":"Яйце з кабачковою ікрою","price":40},{"name":"Салат «Овочевий мікс»","price":45},{"name":"Пюре","price":45},{"name":"Котлети курячі","price":70}]}`;

export const LunchTab: React.FC = () => {
  const [summary, setSummary] = useState<LunchDaySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [postToGroup, setPostToGroup] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.getLunchToday();
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const importMenu = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiClient.importLunchMenu({
        rawJson: jsonText.trim(),
        postToGroup,
      });
      if (!postToGroup) {
        setSuccess(`Меню збережено (${res.menuItems.length} позицій).`);
      } else if (res.postError) {
        setSuccess(
          `Меню збережено (${res.menuItems.length}), але пост у групу не вдався: ${res.postError}`
        );
      } else if (res.queued) {
        setSuccess(
          `Меню збережено (${res.menuItems.length}). Повідомлення в черзі — listener надішле в групу за кілька секунд.`
        );
      } else if (res.posted) {
        setSuccess(`Меню збережено (${res.menuItems.length} позицій) і надіслано в групу.`);
      } else {
        setSuccess(`Меню збережено (${res.menuItems.length} позицій).`);
      }
      setJsonText('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка імпорту');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: 'ordering' | 'closed') => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await apiClient.setLunchStatus(status);
      setSuccess(status === 'closed' ? 'День закрито.' : 'День відкрито для замовлень.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка статусу');
    } finally {
      setSaving(false);
    }
  };

  const repost = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiClient.postLunchMenuToGroup();
      if (!res.ok) {
        setSuccess(res.postError || 'Не вдалося надіслати');
      } else if ((res as { queued?: boolean }).queued) {
        setSuccess('Меню в черзі — listener надішле в групу за кілька секунд.');
      } else {
        setSuccess('Меню надіслано в групу.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка посту');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lunch-tab">
      <div className="lunch-tab__head">
        <div>
          <h2 className="lunch-tab__title">Столова — обіди</h2>
          <p className="lunch-tab__sub">
            Група «Обіди для НЕ бідних». Встав JSON з ChatGPT → збережи в БД і (опційно) напиши в групу від свого
            акаунта.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
          Оновити
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <section className="lunch-card">
        <h3 className="lunch-card__title">Імпорт меню (JSON з ChatGPT)</h3>
        <p className="lunch-card__hint">
          Промпт: <code>telegram-user/lunch/CHAT_GPT_PROMPT.md</code>. Формат:{' '}
          <code>{'{"items":[{"name":"...","price":123}]}'}</code>
        </p>
        <textarea
          className="lunch-json"
          rows={10}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          placeholder={EXAMPLE_JSON}
          spellCheck={false}
        />
        <div className="lunch-actions">
          <label className="lunch-check">
            <input
              type="checkbox"
              checked={postToGroup}
              onChange={(e) => setPostToGroup(e.target.checked)}
            />
            Надіслати читабельне меню в Telegram-групу
          </label>
          <Button type="button" onClick={() => void importMenu()} disabled={saving || !jsonText.trim()}>
            {saving ? 'Збереження…' : 'Зберегти меню'}
          </Button>
        </div>
      </section>

      <section className="lunch-card">
        <div className="lunch-card__row">
          <h3 className="lunch-card__title">Сьогодні {summary?.date || '—'}</h3>
          <div className="lunch-actions lunch-actions--tight">
            <span className={`lunch-badge lunch-badge--${summary?.day?.status || 'none'}`}>
              {summary?.day?.status || 'немає дня'}
            </span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void setStatus('ordering')}
              disabled={saving}
            >
              Відкрити
            </Button>
            <Button type="button" variant="secondary" onClick={() => void setStatus('closed')} disabled={saving}>
              Закрити
            </Button>
            <Button type="button" variant="secondary" onClick={() => void repost()} disabled={saving}>
              Повторити пост меню
            </Button>
          </div>
        </div>

        {loading && !summary && <p className="lunch-muted">Завантаження…</p>}

        {summary && (
          <>
            <div className="lunch-totals">
              <div>
                <span className="lunch-muted">До столової</span>
                <strong>{summary.totals.orderUah} грн</strong>
              </div>
              <div>
                <span className="lunch-muted">Оплачено</span>
                <strong>{summary.totals.paidUah} грн</strong>
              </div>
              <div>
                <span className="lunch-muted">Борг</span>
                <strong>{summary.totals.debtUah} грн</strong>
              </div>
              {summary.day?.payeeCard && (
                <div>
                  <span className="lunch-muted">Картка</span>
                  <strong>{summary.day.payeeCard}</strong>
                </div>
              )}
            </div>

            <h4 className="lunch-section-title">Меню ({summary.menuItems.length})</h4>
            {summary.menuItems.length === 0 ? (
              <p className="lunch-muted">Ще немає — встав JSON вище.</p>
            ) : (
              <ul className="lunch-menu-list">
                {summary.menuItems.map((m) => (
                  <li key={m.id}>
                    <span>{m.name}</span>
                    <span>{m.priceUah} грн</span>
                  </li>
                ))}
              </ul>
            )}

            <h4 className="lunch-section-title">Замовлення ({summary.orders.length})</h4>
            {summary.orders.length === 0 ? (
              <p className="lunch-muted">Поки немає.</p>
            ) : (
              <div className="lunch-table-wrap">
                <table className="lunch-table">
                  <thead>
                    <tr>
                      <th>Хто</th>
                      <th>Що</th>
                      <th>Сума</th>
                      <th>Оплачено</th>
                      <th>Борг</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.orders.map((o) => (
                      <tr key={o.id}>
                        <td>{o.displayName}</td>
                        <td className="lunch-dishes">
                          {o.lines.map((l) => l.rawName).join(', ') || o.rawText}
                        </td>
                        <td>{o.totalUah}</td>
                        <td>{o.paidUah}</td>
                        <td className={o.debtUah > 0 ? 'lunch-debt' : ''}>{o.debtUah}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h4 className="lunch-section-title">Борги ({summary.debts.length})</h4>
            {summary.debts.length === 0 ? (
              <p className="lunch-muted">Немає боржників.</p>
            ) : (
              <ul className="lunch-menu-list">
                {summary.debts.map((d) => (
                  <li key={d.id}>
                    <span>{d.displayName}</span>
                    <span className="lunch-debt">{d.debtUah} грн</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
};
