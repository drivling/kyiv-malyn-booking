import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { formatPhoneDisplay } from '@/utils/constants';
import type { PersonWithCounts, PhoneLookupReport, RefreshPersonNamesResponse } from '@/types';
import { AdminSectionHeader, ChipGroup, EmptyState, StatTile, StatTiles } from '../kit';
import {
  filterPersons,
  isPersonsFilter,
  PERSONS_FILTER_OPTIONS,
  PERSONS_SORT_OPTIONS,
  personsFilterCounts,
  sortPersons,
  type PersonsFilterMode,
  type PersonsSort,
} from '../personsFilter';
import '../SchedulesTab.css';
import './PersonsTab.css';

type EditForm = {
  phone: string;
  fullName: string;
  telegramChatId: string;
  telegramUserId: string;
  telegramUsername: string;
  telegramPromoSentAt: string; // datetime-local або '' — обнулити
  telegramReminderSentAt: string;
  phoneBlocked: boolean;
  phoneBlockReason: string;
};

/** Скільки рядків малюємо за раз — у базі тисячі людей */
const PAGE = 200;

const toDateTimeLocal = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: '2-digit' }) : '';

const formOf = (p: PersonWithCounts): EditForm => ({
  phone: p.phoneNormalized,
  fullName: p.fullName ?? '',
  telegramChatId: p.telegramChatId ?? '',
  telegramUserId: p.telegramUserId ?? '',
  telegramUsername: p.telegramUsername ?? '',
  telegramPromoSentAt: toDateTimeLocal(p.telegramPromoSentAt),
  telegramReminderSentAt: toDateTimeLocal(p.telegramReminderSentAt),
  phoneBlocked: p.phoneBlockedAt != null,
  phoneBlockReason: p.phoneBlockReason ?? '',
});

/** Поле правки з кнопкою «Обнулити» поруч */
const ClearableField: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }> = ({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}) => (
  <label className="persons-field">
    {label}
    <span className="persons-field__row">
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => onChange('')} disabled={!value}>
        Обнулити
      </button>
    </span>
  </label>
);

/**
 * Вкладка «Дані» (`/admin/data`): люди в базі. Угорі — «Хто це» за телефоном і плитки (усього, у боті, без імені,
 * заблоковані, заархівовані), далі фільтр чіпами (`?only=`), сортування, пошук; одна людина — один рядок. Масові дії
 * з іменами й номерами — у згортці. Правка, архів і видалення — ті самі вікна й запити, що були.
 */
export const PersonsTab: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const onlyParam = params.get('only');
  const only: PersonsFilterMode = isPersonsFilter(onlyParam) ? onlyParam : 'all';
  const [persons, setPersons] = useState<PersonWithCounts[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [sort, setSort] = useState<PersonsSort>('new');
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<PersonWithCounts | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [archiving, setArchiving] = useState<PersonWithCounts | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [namesBusy, setNamesBusy] = useState(false);
  const [namesResult, setNamesResult] = useState<RefreshPersonNamesResponse | null>(null);
  const [usernamesBusy, setUsernamesBusy] = useState(false);
  const [usernamesSummary, setUsernamesSummary] = useState('');
  const [phoneCheckBusy, setPhoneCheckBusy] = useState(false);
  const [phoneCheckSummary, setPhoneCheckSummary] = useState('');
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupReport, setLookupReport] = useState<PhoneLookupReport | null>(null);
  const [lookupError, setLookupError] = useState('');

  const load = useCallback(async (search: string) => {
    setLoading(true);
    setError('');
    try {
      setPersons(await apiClient.getPersons(search || undefined));
      setSearched(search);
      setLimit(PAGE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження персон');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const counts = useMemo(() => personsFilterCounts(persons), [persons]);
  const shown = useMemo(() => sortPersons(filterPersons(persons, only), sort), [persons, only, sort]);
  const changes = useMemo(() => new Map((namesResult?.changes ?? []).map((c) => [c.personId, c])), [namesResult]);

  const setOnly = (next: PersonsFilterMode) => {
    const p = new URLSearchParams(params);
    if (next === 'all') p.delete('only');
    else p.set('only', next);
    setParams(p, { replace: true });
    setLimit(PAGE);
  };
  const begin = () => {
    setError('');
    setSuccess('');
  };

  const openEdit = (p: PersonWithCounts) => {
    setEditing(p);
    setForm(formOf(p));
  };
  const closeEdit = () => {
    setEditing(null);
    setForm(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !form) return;
    begin();
    try {
      await apiClient.updatePerson(editing.id, {
        phone: form.phone.trim() || undefined,
        fullName: form.fullName.trim() || null,
        telegramChatId: form.telegramChatId.trim() || null,
        telegramUserId: form.telegramUserId.trim() || null,
        telegramUsername: form.telegramUsername.trim() || null,
        telegramPromoSentAt: form.telegramPromoSentAt.trim() ? new Date(form.telegramPromoSentAt.trim()).toISOString() : null,
        telegramReminderSentAt: form.telegramReminderSentAt.trim() ? new Date(form.telegramReminderSentAt.trim()).toISOString() : null,
        phoneBlocked: form.phoneBlocked,
        phoneBlockReason: form.phoneBlockReason.trim() || null,
      });
      setSuccess('Персону оновлено. Повʼязані бронювання та Viber-оголошення оновлено за потреби.');
      closeEdit();
      void load(searched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка оновлення');
    }
  };

  const remove = async (p: PersonWithCounts) => {
    const warn = `Видалити персону #${p.id}? Це також видалить залежні записи: бронювання (${p._count.bookings}), Viber-оголошення (${p._count.viberListings}) та аналітичні події ViberRide. Дію не можна скасувати.`;
    if (!window.confirm(warn)) return;
    setDeletingId(p.id);
    begin();
    try {
      const r = await apiClient.deletePerson(p.id);
      if (editing?.id === p.id) closeEdit();
      setSuccess(
        `Персону #${r.id} видалено. Видалено записів: бронювань — ${r.deleted.bookings}, Viber-оголошень — ${r.deleted.viberListings}, ViberRide подій — ${r.deleted.viberRideEvents}.`
      );
      await load(searched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка видалення персони');
    } finally {
      setDeletingId(null);
    }
  };

  const archive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archiving) return;
    const reason = archiveReason.trim();
    if (reason.length < 3) return;
    setArchiveBusy(true);
    begin();
    try {
      const r = await apiClient.archivePersonData(archiving.id, reason);
      const c = r.counts;
      setSuccess(
        `Дані персони #${r.personId} заархівовано (архів #${r.archiveId}). ` +
          `Видалено: бронювань — ${c.bookings}, Viber-оголошень — ${c.viberListings}, ViberRide подій — ${c.viberRideEvents}. ` +
          `Виплачені нарахування збережено та знеособлено: ${c.referralRewardsKeptPaid}. Номер лишився в базі із забороною.`
      );
      setArchiving(null);
      if (editing?.id === r.personId) closeEdit();
      await load(searched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка архівації даних персони');
    } finally {
      setArchiveBusy(false);
    }
  };

  const refreshNames = async (opts?: { onlyEmpty?: boolean; onlyLatin?: boolean }) => {
    setNamesBusy(true);
    begin();
    setNamesResult(null);
    try {
      const r = await apiClient.refreshPersonNames(opts);
      setNamesResult(r);
      setSuccess(`Перевірено ${r.total}: оновлено ${r.updated}, пропущено ${r.skipped}.${r.errors?.length ? ` Помилки: ${r.errors.length}.` : ''}`);
      if (r.updated > 0) void load(searched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка оновлення імен');
    } finally {
      setNamesBusy(false);
    }
  };

  const checkUsernames = async () => {
    setUsernamesBusy(true);
    begin();
    setUsernamesSummary('');
    try {
      const r = await apiClient.checkPersonUsernames();
      setUsernamesSummary(`Перевірено ${r.total} без бота, оновлено @username: ${r.updated}.${r.errors?.length ? ` Помилки: ${r.errors.length}.` : ''}`);
      if (r.updated > 0) void load(searched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка перевірки номерів');
    } finally {
      setUsernamesBusy(false);
    }
  };

  const phoneCheck = async () => {
    if (!shown.length) return;
    setPhoneCheckBusy(true);
    begin();
    setPhoneCheckSummary('');
    try {
      const r = await apiClient.analyzePhonesViaPhoneCheck(shown.map((p) => p.phoneNormalized));
      const found = r.results.filter((x) => x.hasData);
      setPhoneCheckSummary(`phonecheck.top: перевірено ${r.total}, дані знайдено для ${found.length}.${found.length ? ' Файл з відповідями завантажено.' : ''}`);
      if (found.length) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(found, null, 2)], { type: 'application/json;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `phonecheck-top-results-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка аналізу через phonecheck.top');
    } finally {
      setPhoneCheckBusy(false);
    }
  };

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = lookupPhone.trim();
    if (!phone) {
      setLookupError('Вкажіть номер телефону');
      return;
    }
    setLookupBusy(true);
    setLookupError('');
    setLookupReport(null);
    try {
      setLookupReport(await apiClient.lookupPhone(phone));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Помилка пошуку за телефоном');
    } finally {
      setLookupBusy(false);
    }
  };

  const filterOptions = PERSONS_FILTER_OPTIONS.map((o) => ({ value: o.value, label: `${o.label} ${counts[o.value]}` }));

  return (
    <div className="tab-content persons-tab">
      <AdminSectionHeader
        title="Люди в базі"
        purpose="Кожен, хто бронював, давав оголошення чи писав боту: контакти, Telegram, заборони, архів."
        actions={
          <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void load(searched)} disabled={loading}>
            Оновити
          </button>
        }
      />

      <form className="persons-lookup" onSubmit={(e) => void lookup(e)} aria-label="Хто це">
        <strong>Хто це?</strong>
        <input value={lookupPhone} onChange={(e) => setLookupPhone(e.target.value)} placeholder="+380XXXXXXXXX" aria-label="Телефон для пошуку" />
        <button type="submit" className="admin-kit-btn" disabled={lookupBusy}>
          {lookupBusy ? 'Пошук…' : 'Знайти'}
        </button>
        <span className="persons-muted">база, Telegram, Opendatabot (ФОП), phonecheck.top</span>
      </form>
      {lookupError && <Alert variant="error">{lookupError}</Alert>}
      {lookupReport && (
        <div className="persons-lookup__result">
          {lookupReport.suggestedName && (
            <p>
              Ймовірно: <strong>{lookupReport.suggestedName}</strong>
              {lookupReport.opendatabot.shortName && lookupReport.opendatabot.shortName !== lookupReport.suggestedName ? (
                <span className="persons-muted"> · ФОП: {lookupReport.opendatabot.shortName}</span>
              ) : null}
              {lookupReport.person ? <span className="persons-muted"> · у базі #{lookupReport.person.id}</span> : null}
            </p>
          )}
          <details>
            <summary>Детальний звіт</summary>
            <textarea readOnly rows={14} value={lookupReport.reportText} aria-label="Детальний звіт" />
          </details>
          <button type="button" className="admin-kit-linkbtn" onClick={() => setLookupReport(null)}>
            Сховати
          </button>
        </div>
      )}

      <StatTiles label="Люди в базі">
        <StatTile label={searched ? `Знайдено за «${searched}»` : 'Усього'} value={counts.all} />
        <StatTile label="У боті" value={counts.bot} sub={`без бота ${counts.nobot}`} />
        <StatTile label="Без імені" value={counts.noname} tone={counts.noname ? 'warn' : 'default'} to={counts.noname && only !== 'noname' ? '/admin/data?only=noname' : undefined} />
        <StatTile
          label="Заблоковані"
          value={counts.blocked}
          sub={`повернулися ${counts.returned}`}
          tone={counts.returned ? 'error' : 'default'}
          to={counts.blocked && only !== 'blocked' ? '/admin/data?only=blocked' : undefined}
        />
        <StatTile label="Заархівовані" value={counts.archived} />
      </StatTiles>

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <ChipGroup label="Кого показати" value={only} onChange={setOnly} options={filterOptions} />
      <form
        className="persons-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void load(query.trim());
        }}
      >
        <input
          type="search"
          className="persons-input persons-input--grow"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Телефон або імʼя — Enter шукає в базі"
          aria-label="Пошук по телефону або імені"
        />
        <button type="submit" className="admin-kit-btn" disabled={loading}>
          Шукати
        </button>
        {searched && (
          <button
            type="button"
            className="admin-kit-linkbtn"
            onClick={() => {
              setQuery('');
              void load('');
            }}
          >
            Усі люди
          </button>
        )}
        <select className="persons-input" value={sort} onChange={(e) => setSort(e.target.value as PersonsSort)} aria-label="Сортування">
          {PERSONS_SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </form>

      <details className="persons-tools">
        <summary>Масові дії з іменами й номерами</summary>
        <div className="persons-tools__buttons">
          <button
            type="button"
            className="admin-kit-btn admin-kit-btn--quiet"
            disabled={namesBusy}
            onClick={() => void refreshNames()}
            title="Пошук імен через бота (якщо підключений) або ваш акаунт. Оновлює імʼя, якщо нове довше й кирилицею або було порожнім."
          >
            {namesBusy ? 'Оновлення…' : 'Оновити імена всім'}
          </button>
          <button type="button" className="admin-kit-btn admin-kit-btn--quiet" disabled={namesBusy} onClick={() => void refreshNames({ onlyEmpty: true })}>
            Лише без імені
          </button>
          <button type="button" className="admin-kit-btn admin-kit-btn--quiet" disabled={namesBusy} onClick={() => void refreshNames({ onlyLatin: true })}>
            Лише латиницею
          </button>
          <button
            type="button"
            className="admin-kit-btn admin-kit-btn--quiet"
            disabled={usernamesBusy}
            onClick={() => void checkUsernames()}
            title="Люди без бота: знайти @username через ResolvePhone (ваш акаунт)"
          >
            {usernamesBusy ? 'Перевірка…' : 'Знайти @username'}
          </button>
          <button
            type="button"
            className="admin-kit-btn admin-kit-btn--quiet"
            disabled={phoneCheckBusy || !shown.length}
            onClick={() => void phoneCheck()}
            title="Показані телефони — через phonecheck.top, відповіді файлом"
          >
            {phoneCheckBusy ? 'Аналіз…' : `phonecheck.top (${shown.length})`}
          </button>
        </div>
        {usernamesSummary && <p className="persons-muted">{usernamesSummary}</p>}
        {phoneCheckSummary && <p className="persons-muted">{phoneCheckSummary}</p>}
      </details>

      {loading && !persons.length ? (
        <p className="persons-muted">Завантаження…</p>
      ) : shown.length === 0 ? (
        <EmptyState
          action={
            only !== 'all' || searched ? (
              <button
                type="button"
                className="admin-kit-linkbtn"
                onClick={() => {
                  setOnly('all');
                  setQuery('');
                  if (searched) void load('');
                }}
              >
                Показати всіх
              </button>
            ) : undefined
          }
        >
          Нікого за цим вибором.
        </EmptyState>
      ) : (
        <>
          <ul className="persons-rows" aria-label="Люди">
            {shown.slice(0, limit).map((p) => {
              const change = changes.get(p.id);
              return (
                <li key={p.id} className={`persons-row${p.dataArchivedAt ? ' is-archived' : p.phoneBlockedAt ? ' is-blocked' : ''}`} aria-label={`Персона #${p.id}`}>
                  <span className="persons-who">
                    <strong>{p.fullName || <span className="persons-muted">без імені</span>}</strong>
                    <span className="persons-phone">{formatPhoneDisplay(p.phoneNormalized)}</span>
                    {p.telegramUsername ? <span className="persons-muted">@{p.telegramUsername.replace(/^@/, '')}</span> : null}
                  </span>
                  <span className="sched-tags persons-tags">
                    {p.telegramChatId ? (
                      <span className="sched-tag persons-tag--ok" title={`chatId ${p.telegramChatId}`}>
                        у боті
                      </span>
                    ) : p.telegramUserId ? (
                      <span className="sched-tag" title={`userId ${p.telegramUserId}`}>
                        Telegram id
                      </span>
                    ) : null}
                    {p._count.bookings > 0 && <span className="sched-tag">бронювань {p._count.bookings}</span>}
                    {p._count.viberListings > 0 && <span className="sched-tag">оголошень {p._count.viberListings}</span>}
                    {p.telegramPromoSentAt && <span className="sched-tag">промо {shortDate(p.telegramPromoSentAt)}</span>}
                    {p.telegramReminderSentAt && <span className="sched-tag">нагадування {shortDate(p.telegramReminderSentAt)}</span>}
                    {p.phoneBlockedAt && (
                      <span className="sched-flag persons-flag--error" title={p.phoneBlockReason ?? undefined}>
                        заборона {shortDate(p.phoneBlockedAt)}
                      </span>
                    )}
                    {(p.blockedAttemptCount ?? 0) > 0 && (
                      <span className="sched-flag">
                        повернувся {p.blockedAttemptCount}×{p.blockedAttemptAt ? `, ${shortDate(p.blockedAttemptAt)}` : ''}
                      </span>
                    )}
                    {p.dataArchivedAt && <span className="sched-tag">архів {shortDate(p.dataArchivedAt)}</span>}
                    {change && (
                      <span className="sched-tag persons-tag--change">
                        {change.oldName ?? '—'} → {change.newName ?? '—'}
                        {change.source ? ` (${change.source === 'bot' ? 'бот' : 'ваш акаунт'})` : ''}
                      </span>
                    )}
                  </span>
                  <span className="persons-actions">
                    <span className="persons-muted persons-id">#{p.id}</span>
                    <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => openEdit(p)} disabled={deletingId === p.id}>
                      Редагувати
                    </button>
                    <button
                      type="button"
                      className="admin-kit-btn admin-kit-btn--quiet"
                      onClick={() => {
                        setArchiving(p);
                        setArchiveReason('');
                      }}
                      disabled={deletingId === p.id || Boolean(p.dataArchivedAt)}
                      title="Зняти JSON-знімок усіх даних і видалити їх з робочих таблиць"
                    >
                      Архівувати
                    </button>
                    <button type="button" className="admin-kit-linkbtn persons-danger" onClick={() => void remove(p)} disabled={deletingId === p.id}>
                      {deletingId === p.id ? 'Видалення…' : 'Видалити'}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {shown.length > limit && (
            <button type="button" className="admin-kit-btn admin-kit-btn--quiet persons-more" onClick={() => setLimit((n) => n + PAGE)}>
              Показати ще {Math.min(PAGE, shown.length - limit)} з {shown.length - limit}
            </button>
          )}
        </>
      )}

      {editing && form && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={`Персона #${editing.id}`} onClick={(e) => e.target === e.currentTarget && closeEdit()}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Персона #{editing.id}</h2>
              <button type="button" className="close-btn" aria-label="Закрити" onClick={closeEdit}>
                &times;
              </button>
            </div>
            <p className="modal-hint">При зміні телефону або імені оновляться повʼязані записи в бронюваннях та Viber-оголошеннях.</p>
            <form onSubmit={(e) => void save(e)} className="persons-form">
              <div className="persons-form__grid">
                <label className="persons-field">
                  Телефон (нормалізований)
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="380931701835" required />
                </label>
                <label className="persons-field">
                  Імʼя
                  <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Іван Петренко" />
                </label>
                <ClearableField label="Telegram ChatId" value={form.telegramChatId} onChange={(v) => setForm({ ...form, telegramChatId: v })} />
                <ClearableField label="Telegram UserId" value={form.telegramUserId} onChange={(v) => setForm({ ...form, telegramUserId: v })} />
                <ClearableField label="@username" value={form.telegramUsername} onChange={(v) => setForm({ ...form, telegramUsername: v })} placeholder="@username" />
                <ClearableField
                  label="Промо відправлено (обнулити — щоб реклама пішла знову)"
                  type="datetime-local"
                  value={form.telegramPromoSentAt}
                  onChange={(v) => setForm({ ...form, telegramPromoSentAt: v })}
                />
                <ClearableField
                  label="Нагадування в боті"
                  type="datetime-local"
                  value={form.telegramReminderSentAt}
                  onChange={(v) => setForm({ ...form, telegramReminderSentAt: v })}
                />
              </div>
              <label className="persons-check">
                <input type="checkbox" checked={form.phoneBlocked} onChange={(e) => setForm({ ...form, phoneBlocked: e.target.checked })} />
                <span>
                  Заборонено використовувати номер — нові бронювання й оголошення не створюються, активні оголошення ховаються з
                  сайту, SMS і Telegram-сповіщення вимикаються. Наявні бронювання лишаються; зняття галочки не повертає оголошення на
                  сайт.
                </span>
              </label>
              {form.phoneBlocked && (
                <label className="persons-field">
                  Причина заборони
                  <textarea rows={3} value={form.phoneBlockReason} onChange={(e) => setForm({ ...form, phoneBlockReason: e.target.value })} placeholder="Скарга від… / що саме сталося" />
                </label>
              )}
              <div className="form-actions">
                <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={closeEdit}>
                  Скасувати
                </button>
                <button type="submit" className="admin-kit-btn">
                  Зберегти
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {archiving && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label={`Архівувати #${archiving.id}`}
          onClick={(e) => e.target === e.currentTarget && setArchiving(null)}
        >
          <div className="modal-content">
            <div className="modal-header">
              <h2>Архівувати всі дані персони #{archiving.id}</h2>
              <button type="button" className="close-btn" aria-label="Закрити" onClick={() => setArchiving(null)}>
                &times;
              </button>
            </div>
            <p className="modal-hint">
              {formatPhoneDisplay(archiving.phoneNormalized)}
              {archiving.fullName ? ` · ${archiving.fullName}` : ''} · бронювань: {archiving._count.bookings}, Viber-оголошень:{' '}
              {archiving._count.viberListings}
            </p>
            <Alert variant="warning">
              Усі записи буде збережено в архів як JSON-знімок і видалено з робочих таблиць — поїздки зникнуть із сайту. Номер
              лишиться в базі як носій заборони й автоматично отримає галочку «Заборонено». Виплачені реферальні нарахування
              збережуться знеособленими, щоб звіт про виплати не змінився. Бронювання інших людей, створені з оголошень цієї
              персони, втратять звʼязок з оголошенням. Дію не можна скасувати.
            </Alert>
            <form onSubmit={(e) => void archive(e)}>
              <label className="persons-field">
                Причина архівації *
                <textarea rows={3} value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} placeholder="Скарга від… / дата й суть звернення" required />
              </label>
              <div className="form-actions">
                <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => setArchiving(null)}>
                  Скасувати
                </button>
                <button type="submit" className="admin-kit-btn persons-btn--danger" disabled={archiveBusy || archiveReason.trim().length < 3}>
                  {archiveBusy ? 'Архівація…' : 'Архівувати'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
