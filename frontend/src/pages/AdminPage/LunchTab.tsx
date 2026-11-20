import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import type { LunchDayPeople, LunchDaySummary, LunchOrderRow, LunchPerson, LunchReparseReport } from '@/types';
import { AdminSectionHeader, AdminSectionNav, ChipGroup, EmptyState, StatTile, StatTiles, StatusPill } from './kit';
import { LunchOcrCompare } from './LunchOcrCompare';
import { LunchPeoplePanel } from './LunchPeoplePanel';
import { LunchReparseReportView } from './LunchReparseReportView';
import { LunchCatalog } from './lunch/LunchCatalog';
import {
  cashCount,
  computeTrayCount,
  conflictNorms,
  dayStatus,
  filterOrders,
  formatOrderDishLabel,
  isLunchSection,
  isOrderFilter,
  isUncheckedPayment,
  kyivTime,
  LUNCH_ADMIN_BASE,
  lunchSections,
  orderFilterCounts,
  orderHasProblem,
  PAYMENT_SOURCE_LABEL,
  splitUnmatched,
  trayRoleLabel,
  type OrderFilter,
} from './lunch/lunchText';
import './SchedulesTab.css';
import './LunchTab.css';

const EXAMPLE_JSON = `{"items":[{"name":"Яйце з кабачковою ікрою","price":40},{"name":"Салат «Овочевий мікс»","price":45},{"name":"Пюре","price":45},{"name":"Котлети курячі","price":70}]}`;

type EditLine = { dishId: number; asWritten: string };
type EditState = {
  orderId: number;
  lines: EditLine[];
  unmatchedParts: string[];
  trayCount: number;
  trayManual: boolean;
  asWrittenDraft: string;
};

type LunchTabProps = {
  /** другий сегмент адреси: '' — «Сьогодні», `menu`, `dishes`, `models` */
  section?: string;
  /** тести передають маленький інтервал опитування задачі порівняння моделей */
  ocrComparePollMs?: number;
};

/**
 * Вкладка «Столова» (`/admin/lunch/<розділ>`): угорі — плитки дня (замовлення, до столової, оплачено, борг, що
 * перевірити, хто писав без замовлення), під ними розділи з власними адресами: «Сьогодні» (стан дня, замовлення
 * рядками з фільтром `?only=`, хто писав у групі, оплати), «Меню» (меню дня, лоток, запасний імпорт JSON-ом),
 * «Страви» (каталог і синоніми), «Моделі» (порівняння моделей розпізнавання). Запити ті самі, що були.
 */
export const LunchTab: React.FC<LunchTabProps> = ({ section = '', ocrComparePollMs }) => {
  const [params, setParams] = useSearchParams();
  const onlyParam = params.get('only');
  const only: OrderFilter = isOrderFilter(onlyParam) ? onlyParam : 'all';
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
  const [people, setPeople] = useState<LunchDayPeople | null>(null);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [notifyGroup, setNotifyGroup] = useState(true);
  const [busyTgUserId, setBusyTgUserId] = useState<string | null>(null);
  const [report, setReport] = useState<{ title: string; data: LunchReparseReport } | null>(null);

  /** Хто писав у групі (з «Джури»). Не критично для вкладки — помилку лише ігноруємо. */
  const loadPeople = useCallback(async () => {
    setPeopleLoading(true);
    try {
      setPeople(await apiClient.getLunchDayPeople());
    } catch {
      setPeople(null);
    } finally {
      setPeopleLoading(false);
    }
  }, []);

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
    void loadPeople();
  }, [loadPeople]);

  useEffect(() => {
    void load();
  }, [load]);

  const dishById = useMemo(() => {
    const m = new Map<number, { id: number; name: string; priceUah: number; trayRole?: string }>();
    for (const d of summary?.dishes || []) m.set(d.id, d);
    for (const item of summary?.menuItems || []) {
      if (item.dishId && !m.has(item.dishId)) {
        m.set(item.dishId, { id: item.dishId, name: item.name, priceUah: item.priceUah, trayRole: item.trayRole });
      }
    }
    return m;
  }, [summary?.dishes, summary?.menuItems]);

  const todayDishIds = useMemo(() => {
    const s = new Set<number>();
    for (const item of summary?.menuItems || []) if (item.dishId) s.add(item.dishId);
    return s;
  }, [summary?.menuItems]);

  const addDishOptions = useMemo(() => {
    const dishes = [...(summary?.dishes || [])].sort((a, b) => a.name.localeCompare(b.name, 'uk'));
    return { today: dishes.filter((d) => todayDishIds.has(d.id)), rest: dishes.filter((d) => !todayDishIds.has(d.id)) };
  }, [summary?.dishes, todayDishIds]);

  const orders = useMemo(() => summary?.orders ?? [], [summary]);
  const counts = useMemo(() => orderFilterCounts(orders), [orders]);
  const shownOrders = useMemo(() => filterOrders(orders, only), [orders, only]);
  // Скільки страв мають синонім, що лежить ще й на іншій страві (те саме число, що в фільтрі «З конфліктом»)
  const conflictCount = useMemo(() => {
    const norms = conflictNorms(summary?.dishes ?? []);
    return (summary?.dishes ?? []).filter((d) => d.synonyms.some((x) => x.rawNorm && norms.has(x.rawNorm))).length;
  }, [summary?.dishes]);
  const trayPrice = summary?.trayPriceUah ?? 5;

  const autoTrayFromEdit = useMemo(() => {
    if (!edit) return 0;
    return computeTrayCount(edit.lines.map((l) => ({ trayRole: dishById.get(l.dishId)?.trayRole, qty: 1 })));
  }, [edit, dishById]);

  const editPreviewFood = useMemo(() => {
    if (!edit) return 0;
    return edit.lines.reduce((s, l) => s + (dishById.get(l.dishId)?.priceUah || 0), 0);
  }, [edit, dishById]);

  if (!isLunchSection(section)) return <Navigate to={LUNCH_ADMIN_BASE} replace />;

  const editTrayCount = edit ? (edit.trayManual ? edit.trayCount : autoTrayFromEdit) : 0;
  const editPreviewTotal = editPreviewFood + editTrayCount * trayPrice;

  const setOnly = (next: OrderFilter) => {
    const p = new URLSearchParams(params);
    if (next === 'all') p.delete('only');
    else p.set('only', next);
    setParams(p, { replace: true });
  };

  const begin = () => {
    setSaving(true);
    setError('');
    setSuccess('');
  };

  const applySummary = (next?: LunchDaySummary) => {
    if (next) setSummary(next);
    else void load();
  };

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
        return { dishId, asWritten: l.rawName && l.rawName !== l.menuItemName ? l.rawName : '' };
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
    begin();
    try {
      const unmatchedText = edit.unmatchedParts.length > 0 ? edit.unmatchedParts.join('; ') : null;
      const res = await apiClient.updateLunchOrder(edit.orderId, {
        lines: edit.lines.map((l) => ({ dishId: l.dishId, asWritten: l.asWritten, qty: 1 })),
        unmatchedText,
        trayCount: edit.trayManual ? edit.trayCount : null,
      });
      const tg = res.telegramError
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
    begin();
    try {
      const res = await apiClient.importLunchMenu({ rawJson: jsonText.trim(), postToGroup });
      const noticeN = res.notices?.length ?? 0;
      const extra = noticeN ? ` Сповіщено ${noticeN} осіб про страви, яких немає сьогодні.` : '';
      const n = res.menuItems.length;
      if (!postToGroup) setSuccess(`Меню збережено (${n} позицій).${extra}`);
      else if (res.postError) setSuccess(`Меню збережено (${n}), але пост у групу не вдався: ${res.postError}${extra}`);
      else if (res.queued) setSuccess(`Меню збережено (${n}). Повідомлення в черзі — listener надішле в групу за кілька секунд.${extra}`);
      else if (res.posted) setSuccess(`Меню збережено (${n} позицій) і надіслано в групу.${extra}`);
      else setSuccess(`Меню збережено (${n} позицій).${extra}`);
      setJsonText('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка імпорту');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: 'ordering' | 'closed') => {
    begin();
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
    begin();
    try {
      const res = await apiClient.postLunchMenuToGroup();
      if (!res.ok) setSuccess(res.postError || 'Не вдалося надіслати');
      else if ((res as { queued?: boolean }).queued) setSuccess('Меню в черзі — listener надішле в групу за кілька секунд.');
      else setSuccess('Меню надіслано в групу.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка посту');
    } finally {
      setSaving(false);
    }
  };

  const reparse = async () => {
    if (
      !window.confirm(
        'Розібрати весь день заново? Усі замовлення й оплати дня (разом з вашими ручними правками) буде скинуто й прочитано з групи наново. Меню лишається.'
      )
    )
      return;
    begin();
    try {
      const res = await apiClient.reparseLunchToday();
      const r = res.reparse || {};
      setSuccess(
        `День розібрано знову: повідомлень ${r.scanned ?? 0}, замовлень ${r.orders ?? 0}, оплат ${r.payments ?? 0}, підсумків ${r.summaries ?? 0}, пропущено ${r.skipped ?? 0}.`
      );
      setReport({ title: 'Розбір поточного дня', data: r });
      setEdit(null);
      if (res.summary) setSummary(res.summary);
      else await load();
      void loadPeople();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка повторного розбору');
    } finally {
      setSaving(false);
    }
  };

  /** Розібрати одну людину: або за Telegram id (панель «Писали в групі»), або за учасником з замовлень. */
  const reparsePerson = async (who: { tgUserId: string } | { participantId: number }, label: string) => {
    begin();
    setBusyTgUserId('tgUserId' in who ? who.tgUserId : null);
    try {
      const res = await apiClient.reparseLunchPerson(who, { notify: notifyGroup });
      const r = res.reparse || {};
      const name = r.person?.name || label;
      if ((r.orders ?? 0) + (r.payments ?? 0) === 0) {
        setError(`${name}: нічого схожого на замовлення чи оплату не знайдено — деталі у звіті нижче.`);
      } else if (r.placeholder) {
        setSuccess(`${name}: повідомлення знайдено, але страви не збіглись з меню — додано порожнім рядком, натисни «Редагувати».`);
      } else {
        setSuccess(`${name}: розібрано — замовлень ${r.orders ?? 0}, оплат ${r.payments ?? 0}.`);
      }
      setReport({ title: `Розбір: ${name}`, data: r });
      setEdit(null);
      if (res.summary) setSummary(res.summary);
      else await load();
      void loadPeople();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка розбору людини');
    } finally {
      setBusyTgUserId(null);
      setSaving(false);
    }
  };

  const removeOrder = async (o: LunchOrderRow) => {
    if (!window.confirm(`Прибрати замовлення «${o.displayName}» з сьогоднішнього дня? Оплати лишаться.`)) return;
    begin();
    try {
      const res = await apiClient.deleteLunchOrder(o.id);
      setSuccess(`Замовлення «${o.displayName}» прибрано.`);
      setEdit(null);
      if (res.summary) setSummary(res.summary);
      else await load();
      void loadPeople();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка видалення замовлення');
    } finally {
      setSaving(false);
    }
  };

  const markPaid = async (participantId: number, debtUah: number) => {
    if (debtUah <= 0) return;
    begin();
    try {
      const res = await apiClient.payLunchDebt(participantId);
      const tg = res.telegramError
        ? ` «Оплатив» у групі не дописано: ${res.telegramError}`
        : res.hasReply
          ? ' «✅ Оплатив» у відповіді в групі поставлено в чергу на правку.'
          : ' (нашої відповіді в групі немає — там нічого не змінено.)';
      setSuccess(`Оплату зараховано: ${res.payment.amountUah} грн (борг тепер ${res.payment.debt} грн).${tg}`);
      if (res.summary) setSummary(res.summary);
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка оплати');
    } finally {
      setSaving(false);
    }
  };

  const postTotals = async () => {
    begin();
    try {
      const res = await apiClient.postLunchTotals();
      if (!res.ok) setError(res.postError || 'Не вдалося надіслати підсумок');
      else if (res.queued) setSuccess('Підсумок у черзі — listener надішле в групу за кілька секунд.');
      else setSuccess('Підсумок надіслано в групу.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка посту підсумку');
    } finally {
      setSaving(false);
    }
  };

  const saveTrayPrice = async () => {
    const n = Number(trayPriceDraft);
    if (!trayPriceDraft.trim() || !Number.isFinite(n) || n < 0) {
      setError('Некоректна ціна лотка');
      return;
    }
    begin();
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

  const catalogAction = async (run: () => Promise<{ summary?: LunchDaySummary }>, ok: string, fail: string) => {
    begin();
    try {
      const res = await run();
      setSuccess(ok);
      applySummary(res.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : fail);
    } finally {
      setSaving(false);
    }
  };

  const addSynonym = (dishId: number, rawText: string) => {
    const raw = rawText.trim();
    if (!raw) {
      setError('Порожній синонім');
      return;
    }
    void catalogAction(() => apiClient.addLunchDishSynonym(dishId, raw), 'Синонім додано.', 'Помилка синоніма');
  };

  const editingOrder = summary?.orders.find((o) => o.id === edit?.orderId) || null;
  const status = dayStatus(summary?.day?.status);
  const debtors = counts.debt;
  const cash = cashCount(orders);
  const trays = orders.reduce((s, o) => s + (o.trayCount || 0), 0);
  const peopleWithout = people?.people.filter((p) => !p.hasOrder).length ?? 0;
  const unchecked = (summary?.payments ?? []).filter((p) => isUncheckedPayment(p.source)).length;

  const editPanel = (o: LunchOrderRow) =>
    edit && editingOrder ? (
      <div className="lunch-edit" aria-label={`Правка: ${o.displayName}`}>
        <div className="lunch-edit__col">
          <strong>Страви</strong>
          <ul className="lunch-edit-list">
            {edit.lines.length === 0 && <li className="lunch-muted">Порожньо — додай з каталогу нижче</li>}
            {edit.lines.map((line, idx) => {
              const item = dishById.get(line.dishId);
              return (
                <li key={`${line.dishId}-${idx}`}>
                  <span>
                    {item?.name || `#${line.dishId}`}
                    {item ? ` — ${item.priceUah} грн` : ''}
                    {line.asWritten ? <span className="lunch-muted"> ({line.asWritten})</span> : null}
                  </span>
                  <button
                    type="button"
                    className="lunch-chip-x"
                    aria-label="Прибрати страву"
                    onClick={() => setEdit({ ...edit, lines: edit.lines.filter((_, i) => i !== idx) })}
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
              aria-label="Додати страву"
              onChange={(e) => setAddDishId(e.target.value)}
              disabled={!addDishOptions.today.length && !addDishOptions.rest.length}
            >
              <option value="">Додати страву…</option>
              {addDishOptions.today.length > 0 && <option disabled>── сьогодні ──</option>}
              {addDishOptions.today.map((d) => (
                <option key={`t-${d.id}`} value={d.id}>
                  {d.name} — {d.priceUah} грн
                </option>
              ))}
              {addDishOptions.rest.length > 0 && <option disabled>── каталог ──</option>}
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
            <button
              type="button"
              className="admin-kit-btn admin-kit-btn--quiet"
              disabled={!addDishId}
              onClick={() => {
                const id = Number(addDishId);
                if (!id) return;
                setEdit({ ...edit, lines: [...edit.lines, { dishId: id, asWritten: edit.asWrittenDraft.trim() }], asWrittenDraft: '' });
                setAddDishId('');
              }}
            >
              Додати
            </button>
          </div>
          <div className="lunch-tray-edit">
            <label className="lunch-check">
              <input
                type="checkbox"
                checked={edit.trayManual}
                onChange={(e) =>
                  setEdit({ ...edit, trayManual: e.target.checked, trayCount: e.target.checked ? editTrayCount : autoTrayFromEdit })
                }
              />
              Лотки вручну:
            </label>
            <input
              type="number"
              min={0}
              className="lunch-input lunch-input--sm"
              aria-label="Лотки"
              disabled={!edit.trayManual}
              value={edit.trayManual ? edit.trayCount : autoTrayFromEdit}
              onChange={(e) => setEdit({ ...edit, trayCount: Number(e.target.value) || 0, trayManual: true })}
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
            {edit.unmatchedParts.length === 0 && <li className="lunch-muted">Немає</li>}
            {edit.unmatchedParts.map((part, idx) => (
              <li key={`${part}-${idx}`}>
                <span>{part}</span>
                <button
                  type="button"
                  className="lunch-chip-x"
                  aria-label="Прибрати фрагмент"
                  onClick={() =>
                    setEdit({
                      ...edit,
                      unmatchedParts: edit.unmatchedParts.filter((_, i) => i !== idx),
                      asWrittenDraft: edit.asWrittenDraft || part,
                    })
                  }
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="lunch-muted">
            Хрестик прибирає фрагмент і підставляє його в «як писала людина».
            {editingOrder.hasReply
              ? ' Вашу відповідь у групі буде підправлено.'
              : ' Id відповіді немає — чуже повідомлення людини редагувати не можна.'}
          </p>
          <details className="lunch-raw" open>
            <summary>Оригінал повідомлення (тільки читання)</summary>
            <pre>{editingOrder.rawText}</pre>
          </details>
        </div>
        <div className="lunch-edit-actions">
          <button type="button" className="admin-kit-btn" onClick={() => void saveEdit()} disabled={saving}>
            {saving ? 'Збереження…' : 'Зберегти'}
          </button>
          <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={cancelEdit} disabled={saving}>
            Скасувати
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className="lunch-tab">
      <AdminSectionHeader
        title="Столова"
        purpose="Обіди групи «Обіди для НЕ бідних»: меню дня, хто що замовив і хто ще винен, база страв для розпізнавання."
        actions={
          <button type="button" className="admin-kit-btn" onClick={() => void load()} disabled={loading}>
            Оновити
          </button>
        }
      />

      {summary && (
        <StatTiles label={`День ${summary.date}`}>
          <StatTile label="Замовлень" value={orders.length} sub={`лотків ${trays}`} />
          <StatTile label="До столової" value={`${summary.totals.orderUah} грн`} />
          <StatTile
            label="Оплачено"
            value={`${summary.totals.paidUah} грн`}
            sub={`оплат ${summary.payments.length}${unchecked ? ` · без перевірки ${unchecked}` : ''}`}
          />
          <StatTile
            label="Борг"
            value={`${summary.totals.debtUah} грн`}
            sub={`людей ${debtors}${cash ? ` · готівкою ${cash}` : ''}`}
            tone={summary.totals.debtUah > 0 ? 'warn' : 'default'}
            to={debtors ? `${LUNCH_ADMIN_BASE}?only=debt` : undefined}
          />
          <StatTile
            label="Перевірити"
            value={counts.problems}
            sub="не розпізнано / немає в меню"
            tone={counts.problems ? 'warn' : 'default'}
            to={counts.problems ? `${LUNCH_ADMIN_BASE}?only=problems` : undefined}
          />
          <StatTile label="Писали без замовлення" value={peopleWithout} sub="у групі сьогодні" tone={peopleWithout ? 'warn' : 'default'} />
        </StatTiles>
      )}

      <AdminSectionNav
        base={LUNCH_ADMIN_BASE}
        sections={lunchSections({ menu: summary?.menuItems.length ?? 0, conflicts: conflictCount })}
        label="Розділи «Столова»"
      />

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}
      {loading && !summary && <p className="lunch-muted">Завантаження…</p>}

      {section === '' && summary && (
        <>
          <div className="lunch-daybar" role="group" aria-label="День">
            <strong>Сьогодні {summary.date}</strong>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            {summary.day?.payeeCard && <span className="lunch-muted">картка {summary.day.payeeCard}</span>}
            <span className="lunch-daybar__actions">
              {summary.day?.status === 'ordering' ? (
                <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void setStatus('closed')} disabled={saving}>
                  Закрити день
                </button>
              ) : (
                <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void setStatus('ordering')} disabled={saving}>
                  Відкрити день
                </button>
              )}
              <button
                type="button"
                className="admin-kit-btn admin-kit-btn--quiet"
                onClick={() => void postTotals()}
                disabled={saving}
                title="Підсумок у групу: імʼя, страви, лотки, сума"
              >
                Ітог у групу
              </button>
              <button
                type="button"
                className="admin-kit-btn admin-kit-btn--quiet lunch-danger"
                onClick={() => void reparse()}
                disabled={saving}
                title="Скидає всі замовлення й оплати дня разом з ручними правками й читає групу заново. Загубилась одна людина — «Розібрати» біля неї."
              >
                Розібрати весь день заново
              </button>
            </span>
          </div>

          <section className="lunch-block" aria-labelledby="lunch-orders-title">
            <div className="lunch-block__head">
              <h3 id="lunch-orders-title">Замовлення</h3>
              <span className="lunch-muted">загубилась одна людина — «Розібрати» біля неї, решту не чіпає</span>
            </div>
            <ChipGroup
              label="Які замовлення"
              value={only}
              onChange={setOnly}
              options={[
                { value: 'all', label: `Усі ${counts.all}` },
                { value: 'problems', label: `Перевірити ${counts.problems}` },
                { value: 'debt', label: `Винні ${counts.debt}` },
              ]}
            />
            {shownOrders.length === 0 ? (
              <EmptyState>{orders.length === 0 ? 'Замовлень поки немає.' : 'За цим фільтром нікого.'}</EmptyState>
            ) : (
              <ul className="lunch-rows" aria-label="Замовлення">
                {shownOrders.map((o) => {
                  const problem = orderHasProblem(o);
                  const missing = o.lines.filter((l) => l.unavailable);
                  return (
                    <li key={o.id} className={`lunch-order${problem ? ' is-problem' : ''}${edit?.orderId === o.id ? ' is-open' : ''}`} aria-label={o.displayName}>
                      <div className="lunch-order__row">
                        <span className="lunch-order__who">
                          <strong>{o.displayName}</strong>
                          {o.cashPromised && o.debtUah > 0 && (
                            <span className="lunch-cash" title="Написав(ла), що віддасть готівкою">
                              {' '}
                              💵
                            </span>
                          )}
                        </span>
                        <span className="lunch-order__what">
                          {o.lines.length > 0
                            ? o.lines.map((l, idx) => (
                                <span key={`${l.dishId ?? l.menuItemId ?? 'x'}-${idx}`} className={l.unavailable ? 'lunch-dish--miss' : undefined}>
                                  {idx > 0 ? ' · ' : ''}
                                  {formatOrderDishLabel(l, dishById)}
                                </span>
                              ))
                            : '—'}
                          <span className="sched-tags lunch-order__tags">
                            {o.trayCount > 0 && (
                              <span className="sched-tag">
                                лотки {o.trayCount} × {trayPrice} = {o.trayTotalUah} грн
                              </span>
                            )}
                            {missing.length > 0 && (
                              <span className="sched-flag">немає сьогодні: {missing.map((l) => l.menuItemName || l.rawName).join(', ')}</span>
                            )}
                            {o.unmatchedText?.trim() && (
                              <span className="sched-flag" title={o.unmatchedText}>
                                не розпізнано: {o.unmatchedText}
                              </span>
                            )}
                          </span>
                          {o.rawText ? (
                            <details className="lunch-raw">
                              <summary>оригінал</summary>
                              <pre>{o.rawText}</pre>
                            </details>
                          ) : null}
                        </span>
                        <span className="lunch-order__money">
                          <strong>{o.totalUah} грн</strong>
                          {o.debtUah > 0 ? (
                            <>
                              <span className="lunch-debt">винен {o.debtUah}</span>
                              {o.paidUah > 0 ? <span className="lunch-muted">оплачено {o.paidUah}</span> : null}
                            </>
                          ) : (
                            <span className="lunch-paid">оплачено ✓</span>
                          )}
                        </span>
                        <span className="lunch-order__actions">
                          {o.debtUah > 0 && (
                            <button type="button" className="admin-kit-btn" disabled={saving} onClick={() => void markPaid(o.participantId, o.debtUah)}>
                              Оплатив
                            </button>
                          )}
                          <button type="button" className="admin-kit-btn admin-kit-btn--quiet" disabled={saving} onClick={() => (edit?.orderId === o.id ? cancelEdit() : startEdit(o))}>
                            Редагувати
                          </button>
                          <button
                            type="button"
                            className="admin-kit-btn admin-kit-btn--quiet"
                            disabled={saving}
                            title="Заново знайти й розібрати повідомлення цієї людини за сьогодні (інших не чіпає)"
                            onClick={() => void reparsePerson({ participantId: o.participantId }, o.displayName)}
                          >
                            Розібрати
                          </button>
                          <button
                            type="button"
                            className="admin-kit-linkbtn lunch-danger"
                            disabled={saving}
                            title="Прибрати замовлення з дня (оплати лишаються)"
                            onClick={() => void removeOrder(o)}
                          >
                            Прибрати
                          </button>
                        </span>
                      </div>
                      {edit?.orderId === o.id && editPanel(o)}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {report && <LunchReparseReportView title={report.title} report={report.data} onClose={() => setReport(null)} />}

          <LunchPeoplePanel
            data={people}
            loading={peopleLoading}
            busyTgUserId={busyTgUserId}
            disabled={saving}
            notify={notifyGroup}
            onNotifyChange={setNotifyGroup}
            onReparse={(person: LunchPerson) => void reparsePerson({ tgUserId: person.tgUserId }, person.name)}
            onRefresh={() => void loadPeople()}
          />

          <section className="lunch-block" aria-labelledby="lunch-payments-title">
            <div className="lunch-block__head">
              <h3 id="lunch-payments-title">Оплати</h3>
              <span className="lunch-muted">жовте — суму ніхто не бачив (посилання на чек або «скинула» без суми)</span>
            </div>
            {summary.payments.length === 0 ? (
              <EmptyState>Оплат ще немає.</EmptyState>
            ) : (
              <ul className="lunch-rows" aria-label="Оплати за день">
                {summary.payments.map((p) => (
                  <li key={p.id} className="lunch-payment">
                    <span className="lunch-muted">{kyivTime(p.createdAt)}</span>
                    <strong>{p.displayName}</strong>
                    <span className={isUncheckedPayment(p.source) ? 'sched-flag' : 'sched-tag'} title={p.rawText}>
                      {PAYMENT_SOURCE_LABEL[p.source ?? 'text']}
                    </span>
                    <span className="lunch-payment__sum">{p.amountUah} грн</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {section === 'menu' && summary && (
        <>
          <section className="lunch-block" aria-labelledby="lunch-menu-title">
            <div className="lunch-block__head">
              <h3 id="lunch-menu-title">Меню на {summary.date}</h3>
              <span className="lunch-muted">фото меню в групі читає Claude і додає страви саме; JSON — запасний шлях</span>
              <button type="button" className="admin-kit-btn admin-kit-btn--quiet lunch-block__action" onClick={() => void repost()} disabled={saving}>
                Повторити пост меню
              </button>
            </div>
            {summary.menuItems.length === 0 ? (
              <EmptyState>
                Меню ще немає. До його появи замовлення приймаються з учорашнього, а в правці замовлення можна додати страву з каталогу.
              </EmptyState>
            ) : (
              <ul className="lunch-rows" aria-label="Меню дня">
                {summary.menuItems.map((m) => (
                  <li key={m.id} className="lunch-menu-row">
                    <span>{m.name}</span>
                    <span className="sched-tag">{trayRoleLabel(m.trayRole)}</span>
                    <span className="lunch-payment__sum">{m.priceUah} грн</span>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="lunch-tray-edit lunch-tray-price"
              onSubmit={(e) => {
                e.preventDefault();
                void saveTrayPrice();
              }}
            >
              <label>
                Лоток коштує
                <input
                  type="number"
                  min={0}
                  className="lunch-input lunch-input--sm"
                  value={trayPriceDraft}
                  onChange={(e) => setTrayPriceDraft(e.target.value)}
                />
                грн
              </label>
              <button
                type="submit"
                className="admin-kit-btn"
                disabled={saving || trayPriceDraft.trim() === String(summary.trayPriceUah ?? 5)}
              >
                Зберегти ціну лотка
              </button>
            </form>
          </section>

          <details className="lunch-block lunch-import" open={summary.menuItems.length === 0}>
            <summary>Вставити меню JSON-ом (з ChatGPT)</summary>
            <p className="lunch-muted">
              Промпт: <code>telegram-user/lunch/CHAT_GPT_PROMPT.md</code>. Формат: <code>{'{"items":[{"name":"...","price":123}]}'}</code>. Каталог
              страв не обнуляється — імпорт лише вмикає доступні на сьогодні.
            </p>
            <textarea
              className="lunch-json"
              rows={8}
              aria-label="Меню JSON"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder={EXAMPLE_JSON}
              spellCheck={false}
            />
            <div className="lunch-actions">
              <label className="lunch-check">
                <input type="checkbox" checked={postToGroup} onChange={(e) => setPostToGroup(e.target.checked)} />
                Надіслати читабельне меню в Telegram-групу
              </label>
              <button type="button" className="admin-kit-btn" onClick={() => void importMenu()} disabled={saving || !jsonText.trim()}>
                {saving ? 'Збереження…' : 'Зберегти меню'}
              </button>
            </div>
          </details>
        </>
      )}

      {section === 'dishes' && summary && (
        <section className="lunch-block" aria-labelledby="lunch-dishes-title">
          <div className="lunch-block__head">
            <h3 id="lunch-dishes-title">База страв</h3>
            <span className="lunch-muted">
              каталог не стирається щодня; лоток: суп — окремий на порцію, друге — один спільний, салат — без лотка (крім єдиної
              страви); синоніми вчать розпізнавання, червоні лежать на кількох стравах — зайвий прибрати
            </span>
          </div>
          {!summary.dishes.length ? (
            <EmptyState>Порожньо — зʼявиться після першого меню.</EmptyState>
          ) : (
            <LunchCatalog
              dishes={summary.dishes}
              todayIds={todayDishIds}
              saving={saving}
              onSave={(id, priceUah, trayRole) =>
                void catalogAction(() => apiClient.updateLunchDish(id, { priceUah, trayRole }), 'Страву оновлено.', 'Помилка страви')
              }
              onAddSynonym={addSynonym}
              onDeleteSynonym={(id) => void catalogAction(() => apiClient.deleteLunchDishSynonym(id), 'Синонім прибрано.', 'Помилка синоніма')}
              onMoveSynonym={(id, dishId) =>
                void catalogAction(() => apiClient.moveLunchDishSynonym(id, dishId), 'Синонім перенесено.', 'Помилка переносу синоніма')
              }
            />
          )}
        </section>
      )}

      {section === 'models' && <LunchOcrCompare defaultDate={summary?.date} pollIntervalMs={ocrComparePollMs} />}
    </div>
  );
};
