import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import type { LunchDaySummary, LunchOrderRow } from '@/types';
import './LunchTab.css';

const EXAMPLE_JSON = `{"items":[{"name":"Яйце з кабачковою ікрою","price":40},{"name":"Салат «Овочевий мікс»","price":45},{"name":"Пюре","price":45},{"name":"Котлети курячі","price":70}]}`;

function splitUnmatched(text: string | null | undefined): string[] {
  if (!text || !text.trim()) return [];
  return text
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Підпис рядка замовлення як у формі «Редагувати»: назва з меню + ціна */
function formatOrderDishLabel(
  line: LunchOrderRow['lines'][number],
  menuById: Map<number, { id: number; name: string; priceUah: number }>
): string {
  const item = line.menuItemId != null ? menuById.get(line.menuItemId) : undefined;
  const name = item?.name || line.menuItemName || line.rawName || '?';
  const price = line.lineTotalUah ?? item?.priceUah ?? line.unitPriceUah;
  const qty = line.qty > 1 ? `×${line.qty} ` : '';
  return `${qty}${name} — ${price} грн`;
}

type EditState = {
  orderId: number;
  menuItemIds: number[];
  unmatchedParts: string[];
};

export const LunchTab: React.FC = () => {
  const [summary, setSummary] = useState<LunchDaySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [postToGroup, setPostToGroup] = useState(true);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [addMenuId, setAddMenuId] = useState('');

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

  const menuById = useMemo(() => {
    const m = new Map<number, { id: number; name: string; priceUah: number }>();
    for (const item of summary?.menuItems || []) m.set(item.id, item);
    return m;
  }, [summary?.menuItems]);

  const editPreviewTotal = useMemo(() => {
    if (!edit) return 0;
    return edit.menuItemIds.reduce((s, id) => s + (menuById.get(id)?.priceUah || 0), 0);
  }, [edit, menuById]);

  const startEdit = (o: LunchOrderRow) => {
    const ids = o.lines.map((l) => l.menuItemId).filter((id): id is number => id != null && id > 0);
    setEdit({
      orderId: o.id,
      menuItemIds: ids,
      unmatchedParts: splitUnmatched(o.unmatchedText),
    });
    setAddMenuId('');
    setError('');
    setSuccess('');
  };

  const cancelEdit = () => {
    setEdit(null);
    setAddMenuId('');
  };

  const saveEdit = async () => {
    if (!edit) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const unmatchedText =
        edit.unmatchedParts.length > 0 ? edit.unmatchedParts.join('; ') : null;
      const res = await apiClient.updateLunchOrder(edit.orderId, {
        menuItemIds: edit.menuItemIds,
        unmatchedText,
      });
      setSuccess('Замовлення оновлено. Оригінальний текст повідомлення збережено.');
      setEdit(null);
      if (res.summary) setSummary(res.summary);
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка збереження замовлення');
    } finally {
      setSaving(false);
    }
  };

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

  const reparse = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiClient.reparseLunchToday();
      const r = res.reparse || {};
      setSuccess(
        `День розібрано знову: повідомлень ${r.scanned ?? 0}, замовлень ${r.orders ?? 0}, оплат ${r.payments ?? 0}, підсумків ${r.summaries ?? 0}, пропущено ${r.skipped ?? 0}.`
      );
      setEdit(null);
      if (res.summary) setSummary(res.summary);
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка повторного розбору');
    } finally {
      setSaving(false);
    }
  };

  const markPaid = async (participantId: number, debtUah: number) => {
    if (debtUah <= 0) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiClient.payLunchDebt(participantId);
      setSuccess(`Оплату зараховано: ${res.payment.amountUah} грн (борг тепер ${res.payment.debt} грн).`);
      if (res.summary) setSummary(res.summary);
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка оплати');
    } finally {
      setSaving(false);
    }
  };

  const postTotals = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiClient.postLunchTotals();
      if (!res.ok) {
        setError(res.postError || 'Не вдалося надіслати підсумок');
      } else if (res.queued) {
        setSuccess('Підсумок у черзі — listener надішле в групу за кілька секунд.');
      } else {
        setSuccess('Підсумок надіслано в групу.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка посту підсумку');
    } finally {
      setSaving(false);
    }
  };

  const editingOrder = summary?.orders.find((o) => o.id === edit?.orderId) || null;

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
            <Button type="button" onClick={() => void reparse()} disabled={saving}>
              {saving ? 'Розбір…' : 'Розібрати поточний день'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void postTotals()} disabled={saving}>
              Ітог у групу
            </Button>
          </div>
        </div>
        <p className="lunch-card__hint" style={{ marginTop: 4 }}>
          «Розібрати поточний день» — знову читає повідомлення з групи за сьогодні, скидає замовлення/оплати
          (меню лишається) і парсить заново. «Ітог у групу» — імʼя, страви, сума (без судочків). Оригінал
          повідомлення завжди зберігається — можна правити страви вручну.
        </p>

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
                      <th>Не розпізнано</th>
                      <th>Сума</th>
                      <th>Оплачено</th>
                      <th>Борг</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.orders.map((o) => (
                      <React.Fragment key={o.id}>
                        <tr className={o.unmatchedText ? 'lunch-row--warn' : undefined}>
                          <td>{o.displayName}</td>
                          <td className="lunch-dishes">
                            {o.lines.length > 0 ? (
                              <ul className="lunch-dish-list">
                                {o.lines.map((l, idx) => (
                                  <li key={`${o.id}-${l.menuItemId ?? 'x'}-${idx}`}>
                                    {formatOrderDishLabel(l, menuById)}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              '—'
                            )}
                            {o.rawText ? (
                              <details className="lunch-raw">
                                <summary>оригінал</summary>
                                <pre>{o.rawText}</pre>
                              </details>
                            ) : null}
                          </td>
                          <td className="lunch-unmatched">
                            {o.unmatchedText ? (
                              <span title={o.unmatchedText}>{o.unmatchedText}</span>
                            ) : (
                              <span className="lunch-muted">—</span>
                            )}
                          </td>
                          <td>{o.totalUah}</td>
                          <td>{o.paidUah}</td>
                          <td className={o.debtUah > 0 ? 'lunch-debt' : ''}>{o.debtUah}</td>
                          <td className="lunch-row-actions">
                            <Button
                              type="button"
                              variant="secondary"
                              className="lunch-pay-btn"
                              disabled={saving}
                              onClick={() => startEdit(o)}
                            >
                              Редагувати
                            </Button>
                            {o.debtUah > 0 ? (
                              <Button
                                type="button"
                                variant="secondary"
                                className="lunch-pay-btn"
                                disabled={saving}
                                onClick={() => void markPaid(o.participantId, o.debtUah)}
                              >
                                Оплатив
                              </Button>
                            ) : (
                              <span className="lunch-muted">✓</span>
                            )}
                          </td>
                        </tr>
                        {edit?.orderId === o.id && editingOrder && (
                          <tr className="lunch-edit-row">
                            <td colSpan={7}>
                              <div className="lunch-edit">
                                <div className="lunch-edit__col">
                                  <strong>Страви з меню</strong>
                                  <ul className="lunch-edit-list">
                                    {edit.menuItemIds.length === 0 && (
                                      <li className="lunch-muted">Порожньо — додай з меню нижче</li>
                                    )}
                                    {edit.menuItemIds.map((id, idx) => {
                                      const item = menuById.get(id);
                                      return (
                                        <li key={`${id}-${idx}`}>
                                          <span>
                                            {item?.name || `#${id}`}
                                            {item ? ` — ${item.priceUah} грн` : ''}
                                          </span>
                                          <button
                                            type="button"
                                            className="lunch-chip-x"
                                            onClick={() =>
                                              setEdit({
                                                ...edit,
                                                menuItemIds: edit.menuItemIds.filter((_, i) => i !== idx),
                                              })
                                            }
                                          >
                                            ✕
                                          </button>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                  <div className="lunch-edit-add">
                                    <select
                                      value={addMenuId}
                                      onChange={(e) => setAddMenuId(e.target.value)}
                                      disabled={!summary.menuItems.length}
                                    >
                                      <option value="">Додати страву…</option>
                                      {summary.menuItems.map((m) => (
                                        <option key={m.id} value={m.id}>
                                          {m.name} — {m.priceUah} грн
                                        </option>
                                      ))}
                                    </select>
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      disabled={!addMenuId}
                                      onClick={() => {
                                        const id = Number(addMenuId);
                                        if (!id) return;
                                        setEdit({
                                          ...edit,
                                          menuItemIds: [...edit.menuItemIds, id],
                                        });
                                        setAddMenuId('');
                                      }}
                                    >
                                      Додати
                                    </Button>
                                  </div>
                                  <p className="lunch-edit-total">
                                    Нова сума: <strong>{editPreviewTotal} грн</strong>
                                  </p>
                                </div>
                                <div className="lunch-edit__col">
                                  <strong>Не розпізнано (можна прибрати)</strong>
                                  <ul className="lunch-edit-list">
                                    {edit.unmatchedParts.length === 0 && (
                                      <li className="lunch-muted">Немає</li>
                                    )}
                                    {edit.unmatchedParts.map((part, idx) => (
                                      <li key={`${part}-${idx}`}>
                                        <span>{part}</span>
                                        <button
                                          type="button"
                                          className="lunch-chip-x"
                                          onClick={() =>
                                            setEdit({
                                              ...edit,
                                              unmatchedParts: edit.unmatchedParts.filter(
                                                (_, i) => i !== idx
                                              ),
                                            })
                                          }
                                        >
                                          ✕
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                  <details className="lunch-raw lunch-raw--open">
                                    <summary>Оригінал повідомлення (тільки читання)</summary>
                                    <pre>{editingOrder.rawText}</pre>
                                  </details>
                                </div>
                                <div className="lunch-edit-actions">
                                  <Button type="button" onClick={() => void saveEdit()} disabled={saving}>
                                    {saving ? 'Збереження…' : 'Зберегти'}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={cancelEdit}
                                    disabled={saving}
                                  >
                                    Скасувати
                                  </Button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
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
