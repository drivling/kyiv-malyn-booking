import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import type { LunchDaySummary, LunchOrderRow } from '@/types';
import './LunchTab.css';

const EXAMPLE_JSON = `{"items":[{"name":"Яйце з кабачковою ікрою","price":40},{"name":"Салат «Овочевий мікс»","price":45},{"name":"Пюре","price":45},{"name":"Котлети курячі","price":70}]}`;

const TRAY_ROLE_LABEL: Record<string, string> = {
  soup: 'суп',
  second: 'друге',
  salad: 'салат',
};

function splitUnmatched(text: string | null | undefined): string[] {
  if (!text || !text.trim()) return [];
  return text
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function computeTrayCount(roles: Array<{ trayRole?: string | null; qty?: number | null }>): number {
  if (!roles.length) return 0;
  let soupQty = 0;
  let hasSecond = false;
  for (const l of roles) {
    const role = l.trayRole || 'second';
    const qty = l.qty && l.qty > 0 ? l.qty : 1;
    if (role === 'soup') soupQty += qty;
    else if (role === 'second') hasSecond = true;
  }
  let trays = soupQty + (hasSecond ? 1 : 0);
  if (roles.length === 1) trays = Math.max(trays, 1);
  return trays;
}

function formatOrderDishLabel(
  line: LunchOrderRow['lines'][number],
  dishById: Map<number, { id: number; name: string; priceUah: number }>
): string {
  const dish = line.dishId != null ? dishById.get(line.dishId) : undefined;
  const name = dish?.name || line.menuItemName || line.rawName || '?';
  const price = line.lineTotalUah ?? dish?.priceUah ?? line.unitPriceUah;
  const qty = line.qty > 1 ? `×${line.qty} ` : '';
  const miss = line.unavailable ? ' (немає сьогодні)' : '';
  return `${qty}${name} — ${price} грн${miss}`;
}

type EditLine = { dishId: number; asWritten: string };
type EditState = {
  orderId: number;
  lines: EditLine[];
  unmatchedParts: string[];
  trayCount: number;
  trayManual: boolean;
  asWrittenDraft: string;
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
  const [addDishId, setAddDishId] = useState('');
  const [trayPriceDraft, setTrayPriceDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.getLunchToday();
      setSummary(data);
      setTrayPriceDraft(String(data.trayPriceUah ?? 5));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dishById = useMemo(() => {
    const m = new Map<number, { id: number; name: string; priceUah: number; trayRole?: string }>();
    for (const d of summary?.dishes || []) m.set(d.id, d);
    for (const item of summary?.menuItems || []) {
      if (item.dishId && !m.has(item.dishId)) {
        m.set(item.dishId, {
          id: item.dishId,
          name: item.name,
          priceUah: item.priceUah,
          trayRole: item.trayRole,
        });
      }
    }
    return m;
  }, [summary?.dishes, summary?.menuItems]);

  const todayDishIds = useMemo(() => {
    const s = new Set<number>();
    for (const item of summary?.menuItems || []) {
      if (item.dishId) s.add(item.dishId);
    }
    return s;
  }, [summary?.menuItems]);

  const addDishOptions = useMemo(() => {
    const dishes = [...(summary?.dishes || [])].sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    return {
      today: dishes.filter((d) => todayDishIds.has(d.id)),
      rest: dishes.filter((d) => !todayDishIds.has(d.id)),
    };
  }, [summary?.dishes, todayDishIds]);

  const trayPrice = summary?.trayPriceUah ?? 5;

  const autoTrayFromEdit = useMemo(() => {
    if (!edit) return 0;
    return computeTrayCount(
      edit.lines.map((l) => ({ trayRole: dishById.get(l.dishId)?.trayRole, qty: 1 }))
    );
  }, [edit, dishById]);

  const editPreviewFood = useMemo(() => {
    if (!edit) return 0;
    return edit.lines.reduce((s, l) => s + (dishById.get(l.dishId)?.priceUah || 0), 0);
  }, [edit, dishById]);

  const editTrayCount = edit ? (edit.trayManual ? edit.trayCount : autoTrayFromEdit) : 0;
  const editPreviewTotal = editPreviewFood + editTrayCount * trayPrice;

  const startEdit = (o: LunchOrderRow) => {
    const lines = o.lines
      .map((l) => {
        let dishId = l.dishId != null && l.dishId > 0 ? l.dishId : 0;
        if (!dishId && l.menuItemName) {
          for (const d of dishById.values()) {
            if (d.name === l.menuItemName) {
              dishId = d.id;
              break;
            }
          }
        }
        if (!dishId) return null;
        return {
          dishId,
          asWritten: l.rawName && l.rawName !== l.menuItemName ? l.rawName : '',
        };
      })
      .filter((x): x is EditLine => x != null);
    setEdit({
      orderId: o.id,
      lines,
      unmatchedParts: splitUnmatched(o.unmatchedText),
      trayCount: o.trayCount ?? 0,
      trayManual: Boolean(o.trayCountManual),
      asWrittenDraft: '',
    });
    setAddDishId('');
    setError('');
    setSuccess('');
  };

  const cancelEdit = () => {
    setEdit(null);
    setAddDishId('');
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
        lines: edit.lines.map((l) => ({
          dishId: l.dishId,
          asWritten: l.asWritten,
          qty: 1,
        })),
        unmatchedText,
        trayCount: edit.trayManual ? edit.trayCount : null,
      });
      const tg =
        res.telegramError
          ? ` Відповідь у групі не підправлено: ${res.telegramError}`
          : res.hasReply
            ? ' Відповідь у групі поставлено в чергу на правку.'
            : res.telegramQueued
              ? ' Уточнення в групу в черзі.'
              : ' (немає id вашої відповіді — у групу не підправлено.)';
      setSuccess(`Замовлення оновлено.${tg}`);
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
      const noticeN = res.notices?.length ?? 0;
      const extra = noticeN ? ` Сповіщено ${noticeN} осіб про страви, яких немає сьогодні.` : '';
      if (!postToGroup) {
        setSuccess(`Меню збережено (${res.menuItems.length} позицій).${extra}`);
      } else if (res.postError) {
        setSuccess(
          `Меню збережено (${res.menuItems.length}), але пост у групу не вдався: ${res.postError}${extra}`
        );
      } else if (res.queued) {
        setSuccess(
          `Меню збережено (${res.menuItems.length}). Повідомлення в черзі — listener надішле в групу за кілька секунд.${extra}`
        );
      } else if (res.posted) {
        setSuccess(`Меню збережено (${res.menuItems.length} позицій) і надіслано в групу.${extra}`);
      } else {
        setSuccess(`Меню збережено (${res.menuItems.length} позицій).${extra}`);
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

  const saveTrayPrice = async () => {
    const n = Number(trayPriceDraft);
    if (!Number.isFinite(n) || n < 0) {
      setError('Некоректна ціна лотка');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiClient.updateLunchSettings(n);
      setSuccess(`Ціна лотка: ${n} грн.`);
      if (res.summary) setSummary(res.summary);
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка ціни лотка');
    } finally {
      setSaving(false);
    }
  };

  const applySummary = (next?: LunchDaySummary) => {
    if (next) setSummary(next);
    else void load();
  };

  const saveDish = async (dishId: number, priceUah: number, trayRole: string) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiClient.updateLunchDish(dishId, { priceUah, trayRole });
      setSuccess('Страву оновлено.');
      applySummary(res.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка страви');
    } finally {
      setSaving(false);
    }
  };

  const addSynonym = async (dishId: number, rawText: string) => {
    const raw = rawText.trim();
    if (!raw) {
      setError('Порожній синонім');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiClient.addLunchDishSynonym(dishId, raw);
      setSuccess('Синонім додано.');
      applySummary(res.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка синоніма');
    } finally {
      setSaving(false);
    }
  };

  const deleteSynonym = async (synonymId: number) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiClient.deleteLunchDishSynonym(synonymId);
      setSuccess('Синонім прибрано.');
      applySummary(res.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка синоніма');
    } finally {
      setSaving(false);
    }
  };

  const moveSynonym = async (synonymId: number, dishId: number) => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiClient.moveLunchDishSynonym(synonymId, dishId);
      setSuccess('Синонім перенесено.');
      applySummary(res.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка переносу синоніма');
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
            акаунта. Каталог страв не обнуляється — імпорт лише вмикає доступні на сьогодні.
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
          (меню лишається) і парсить заново. «Ітог у групу» — імʼя, страви, лотки, сума. Чуже повідомлення людини
          в Telegram не редагується; підправляється ваша відповідь «Не розпізнав», якщо її id збережено.
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
              <p className="lunch-muted">
                Ще немає — встав JSON вище. До появи меню замовлення приймаються з учорашнього, а в редагуванні
                можна додати страву з каталогу.
              </p>
            ) : (
              <ul className="lunch-menu-list">
                {summary.menuItems.map((m) => (
                  <li key={m.id}>
                    <span>
                      {m.name}{' '}
                      <span className="lunch-muted">({TRAY_ROLE_LABEL[m.trayRole || 'second'] || m.trayRole})</span>
                    </span>
                    <span>{m.priceUah} грн</span>
                  </li>
                ))}
              </ul>
            )}
            <ul className="lunch-menu-list" style={{ marginTop: 8, maxHeight: 'none' }}>
              <li className="lunch-menu-tray">
                <span>Лоток</span>
                <span className="lunch-tray-edit">
                  <input
                    type="number"
                    min={0}
                    className="lunch-input lunch-input--sm"
                    value={trayPriceDraft}
                    onChange={(e) => setTrayPriceDraft(e.target.value)}
                  />
                  <span>грн</span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => void saveTrayPrice()}
                  >
                    Зберегти ціну лотка
                  </Button>
                </span>
              </li>
            </ul>

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
                      <th>Лотки</th>
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
                        <tr
                          className={
                            o.unmatchedText || o.lines.some((l) => l.unavailable)
                              ? 'lunch-row--warn'
                              : undefined
                          }
                        >
                          <td>{o.displayName}</td>
                          <td className="lunch-dishes">
                            {o.lines.length > 0 ? (
                              <ul className="lunch-dish-list">
                                {o.lines.map((l, idx) => (
                                  <li
                                    key={`${o.id}-${l.dishId ?? l.menuItemId ?? 'x'}-${idx}`}
                                    className={l.unavailable ? 'lunch-dish--miss' : undefined}
                                  >
                                    {formatOrderDishLabel(l, dishById)}
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
                          <td>
                            {o.trayCount > 0
                              ? `${o.trayCount} × ${trayPrice} = ${o.trayTotalUah} грн`
                              : '—'}
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
                            <td colSpan={8}>
                              <div className="lunch-edit">
                                <div className="lunch-edit__col">
                                  <strong>Страви</strong>
                                  <ul className="lunch-edit-list">
                                    {edit.lines.length === 0 && (
                                      <li className="lunch-muted">Порожньо — додай з каталогу нижче</li>
                                    )}
                                    {edit.lines.map((line, idx) => {
                                      const item = dishById.get(line.dishId);
                                      return (
                                        <li key={`${line.dishId}-${idx}`}>
                                          <span>
                                            {item?.name || `#${line.dishId}`}
                                            {item ? ` — ${item.priceUah} грн` : ''}
                                            {line.asWritten ? (
                                              <span className="lunch-muted"> ({line.asWritten})</span>
                                            ) : null}
                                          </span>
                                          <button
                                            type="button"
                                            className="lunch-chip-x"
                                            onClick={() =>
                                              setEdit({
                                                ...edit,
                                                lines: edit.lines.filter((_, i) => i !== idx),
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
                                      value={addDishId}
                                      onChange={(e) => setAddDishId(e.target.value)}
                                      disabled={!addDishOptions.today.length && !addDishOptions.rest.length}
                                    >
                                      <option value="">Додати страву…</option>
                                      {addDishOptions.today.length > 0 && (
                                        <option disabled>── сьогодні ──</option>
                                      )}
                                      {addDishOptions.today.map((d) => (
                                        <option key={`t-${d.id}`} value={d.id}>
                                          {d.name} — {d.priceUah} грн
                                        </option>
                                      ))}
                                      {addDishOptions.rest.length > 0 && (
                                        <option disabled>── каталог ──</option>
                                      )}
                                      {addDishOptions.rest.map((d) => (
                                        <option key={`c-${d.id}`} value={d.id}>
                                          {d.name} — {d.priceUah} грн
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      className="lunch-input"
                                      placeholder="як писала людина"
                                      value={edit.asWrittenDraft}
                                      onChange={(e) => setEdit({ ...edit, asWrittenDraft: e.target.value })}
                                    />
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      disabled={!addDishId}
                                      onClick={() => {
                                        const id = Number(addDishId);
                                        if (!id) return;
                                        setEdit({
                                          ...edit,
                                          lines: [
                                            ...edit.lines,
                                            { dishId: id, asWritten: edit.asWrittenDraft.trim() },
                                          ],
                                          asWrittenDraft: '',
                                        });
                                        setAddDishId('');
                                      }}
                                    >
                                      Додати
                                    </Button>
                                  </div>
                                  <label className="lunch-check">
                                    <input
                                      type="checkbox"
                                      checked={edit.trayManual}
                                      onChange={(e) =>
                                        setEdit({
                                          ...edit,
                                          trayManual: e.target.checked,
                                          trayCount: e.target.checked ? editTrayCount : autoTrayFromEdit,
                                        })
                                      }
                                    />
                                    Лотки вручну
                                  </label>
                                  <div className="lunch-tray-edit">
                                    <span>Лотки:</span>
                                    <input
                                      type="number"
                                      min={0}
                                      className="lunch-input lunch-input--sm"
                                      disabled={!edit.trayManual}
                                      value={edit.trayManual ? edit.trayCount : autoTrayFromEdit}
                                      onChange={(e) =>
                                        setEdit({
                                          ...edit,
                                          trayCount: Number(e.target.value) || 0,
                                          trayManual: true,
                                        })
                                      }
                                    />
                                    <span>
                                      × {trayPrice} = {editTrayCount * trayPrice} грн
                                    </span>
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
                                              asWrittenDraft: edit.asWrittenDraft || part,
                                            })
                                          }
                                        >
                                          ✕
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                  <p className="lunch-card__hint">
                                    Хрестик прибирає фрагмент і підставляє його в «як писала людина».
                                    {editingOrder.hasReply
                                      ? ' Вашу відповідь у групі буде підправлено.'
                                      : ' Id відповіді немає — чуже повідомлення людини редагувати не можна.'}
                                  </p>
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

      <section className="lunch-card">
        <h3 className="lunch-card__title">База страв ({summary?.dishes?.length || 0})</h3>
        <p className="lunch-card__hint">
          Каталог не стирається щодня. Роль лотка: суп — окремий лоток на порцію; друге — один спільний; салат —
          без лотка (крім єдиної страви в заказі). Синоніми впливають на розпізнавання замовлень — хибні можна
          прибрати або перенести на іншу страву.
        </p>
        {!summary?.dishes?.length ? (
          <p className="lunch-muted">Порожньо — зʼявиться після першого імпорту меню.</p>
        ) : (
          <CatalogTable
            dishes={summary.dishes}
            saving={saving}
            onSave={saveDish}
            onAddSynonym={addSynonym}
            onDeleteSynonym={deleteSynonym}
            onMoveSynonym={moveSynonym}
          />
        )}
      </section>
    </div>
  );
};

const CatalogTable: React.FC<{
  dishes: LunchDaySummary['dishes'];
  saving: boolean;
  onSave: (id: number, priceUah: number, trayRole: string) => void;
  onAddSynonym: (dishId: number, rawText: string) => void;
  onDeleteSynonym: (synonymId: number) => void;
  onMoveSynonym: (synonymId: number, dishId: number) => void;
}> = ({ dishes, saving, onSave, onAddSynonym, onDeleteSynonym, onMoveSynonym }) => {
  const [drafts, setDrafts] = useState<Record<number, { price: string; role: string }>>({});
  const [addDrafts, setAddDrafts] = useState<Record<number, string>>({});
  useEffect(() => {
    const next: Record<number, { price: string; role: string }> = {};
    for (const d of dishes) next[d.id] = { price: String(d.priceUah), role: d.trayRole };
    setDrafts(next);
  }, [dishes]);

  return (
    <div className="lunch-table-wrap">
      <table className="lunch-table">
        <thead>
          <tr>
            <th>Страва</th>
            <th>Ціна</th>
            <th>Лоток</th>
            <th>Синоніми</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {dishes.map((d) => {
            const draft = drafts[d.id] || { price: String(d.priceUah), role: d.trayRole };
            const addVal = addDrafts[d.id] || '';
            return (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>
                  <input
                    type="number"
                    min={1}
                    className="lunch-input lunch-input--sm"
                    value={draft.price}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [d.id]: { ...draft, price: e.target.value } })
                    }
                  />
                </td>
                <td>
                  <select
                    className="lunch-input"
                    value={draft.role}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [d.id]: { ...draft, role: e.target.value } })
                    }
                  >
                    <option value="soup">суп</option>
                    <option value="second">друге</option>
                    <option value="salad">салат</option>
                  </select>
                </td>
                <td className="lunch-synonyms">
                  {d.synonyms.length > 0 ? (
                    <div className="lunch-syn-list">
                      {d.synonyms.map((s) => (
                        <span key={s.id} className="lunch-syn-chip">
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
                            {dishes
                              .filter((other) => other.id !== d.id)
                              .map((other) => (
                                <option key={other.id} value={other.id}>
                                  {other.name}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            className="lunch-chip-x"
                            disabled={saving}
                            aria-label="Прибрати синонім"
                            onClick={() => onDeleteSynonym(s.id)}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="lunch-muted">—</span>
                  )}
                  <div className="lunch-syn-add">
                    <input
                      className="lunch-input"
                      placeholder="додати синонім"
                      value={addVal}
                      disabled={saving}
                      onChange={(e) => setAddDrafts({ ...addDrafts, [d.id]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        if (!addVal.trim()) return;
                        onAddSynonym(d.id, addVal);
                        setAddDrafts({ ...addDrafts, [d.id]: '' });
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      className="lunch-pay-btn"
                      disabled={saving || !addVal.trim()}
                      onClick={() => {
                        if (!addVal.trim()) return;
                        onAddSynonym(d.id, addVal);
                        setAddDrafts({ ...addDrafts, [d.id]: '' });
                      }}
                    >
                      Додати
                    </Button>
                  </div>
                </td>
                <td>
                  <Button
                    type="button"
                    variant="secondary"
                    className="lunch-pay-btn"
                    disabled={saving}
                    onClick={() => onSave(d.id, Number(draft.price), draft.role)}
                  >
                    Зберегти
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
