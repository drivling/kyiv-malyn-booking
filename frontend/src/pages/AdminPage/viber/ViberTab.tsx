import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { formatPhoneDisplay } from '@/utils/constants';
import type { AdminViberListing, TripRoute, ViberListingType } from '@/types';
import { AdminSectionHeader, ChipGroup, EmptyState, StatTile, StatTiles, StatusPill } from '../kit';
import {
  EMPTY_FILTER,
  filterListings,
  ISSUE_LABEL,
  isListingIssue,
  kyivDate,
  listingChannel,
  listingCounts,
  tripDay,
  type ListingFilter,
  type ListingIssue,
} from './viberText';
import '../SchedulesTab.css';
import './ViberTab.css';

type EditForm = {
  rawMessage: string;
  senderName: string;
  listingType: ViberListingType;
  route: string;
  tripRouteId: string;
  date: string;
  departureTime: string;
  seats: string;
  priceUah: string;
  phone: string;
  notes: string;
  isActive: boolean;
};

const formOf = (l: AdminViberListing): EditForm => ({
  rawMessage: l.rawMessage,
  senderName: l.senderName ?? '',
  listingType: l.listingType,
  route: l.route,
  tripRouteId: l.tripRouteId != null ? String(l.tripRouteId) : '',
  date: l.date.slice(0, 10),
  departureTime: l.departureTime ?? '',
  seats: l.seats != null ? String(l.seats) : '',
  priceUah: l.priceUah != null ? String(l.priceUah) : '',
  phone: l.phone,
  notes: l.notes ?? '',
  isActive: l.isActive,
});

const issueHref = (issue: Exclude<ListingIssue, 'none'>) => `/admin/viber?issue=${issue}`;

/**
 * Вкладка «Попутки» (`/admin/viber`): оголошення водіїв і пасажирів з Viber і Telegram-груп. Угорі — плитки по
 * активних (на дошці, сьогодні, без часу, без телефону, без маршруту, автора не сповіщено; «без …» ведуть на
 * `?issue=`), далі фільтри чіпами й одне оголошення — один рядок. Запити й вікна ті самі, що були в AdminPage.
 */
export const ViberTab: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const issueParam = params.get('issue');
  const issue: ListingIssue = isListingIssue(issueParam) ? issueParam : 'none';
  const [listings, setListings] = useState<AdminViberListing[]>([]);
  const [tripRoutes, setTripRoutes] = useState<TripRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState<Omit<ListingFilter, 'issue'>>(EMPTY_FILTER);
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<AdminViberListing | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setListings(await apiClient.getViberListings()); // усі, фільтрація тут
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    apiClient.getTripRoutes().then(setTripRoutes).catch(() => setTripRoutes([]));
  }, [load]);

  const today = kyivDate();
  const counts = useMemo(() => listingCounts(listings, today), [listings, today]);
  const shown = useMemo(() => filterListings(listings, { ...filter, issue }), [listings, filter, issue]);
  const routeById = useMemo(() => new Map(tripRoutes.map((r) => [r.id, r])), [tripRoutes]);
  const filtered = issue !== 'none' || filter.kind || filter.route || filter.date || filter.query || filter.state !== 'active';

  const setIssue = (next: ListingIssue) => {
    const p = new URLSearchParams(params);
    if (next === 'none') p.delete('issue');
    else p.set('issue', next);
    setParams(p, { replace: true });
  };
  const patch = (p: Partial<typeof filter>) => setFilter((f) => ({ ...f, ...p }));
  const reset = () => {
    setFilter(EMPTY_FILTER);
    setIssue('none');
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      // кілька заголовків «[ дата ]» — кілька повідомлень одразу
      if ((message.match(/\[.*?\]/g) || []).length > 1) {
        const result = await apiClient.createViberListingsBulk(message);
        setSuccess(`Створено ${result.created} оголошень з ${result.total}`);
      } else {
        await apiClient.createViberListing({ rawMessage: message });
        setSuccess('Оголошення створено.');
      }
      setMessage('');
      setCreateOpen(false);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка створення');
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('Ви впевнені, що хочете видалити це оголошення?')) return;
    try {
      await apiClient.deleteViberListing(id);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка видалення');
    }
  };

  const deactivate = async (id: number) => {
    try {
      await apiClient.deactivateViberListing(id);
      setSuccess(`Оголошення #${id} знято з дошки.`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка деактивації');
    }
  };

  const openEdit = (l: AdminViberListing) => {
    setEditing(l);
    setForm(formOf(l));
  };
  const closeEdit = () => {
    setEditing(null);
    setForm(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !form) return;
    setError('');
    setSuccess('');
    try {
      await apiClient.updateViberListing(editing.id, {
        rawMessage: form.rawMessage,
        senderName: form.senderName || null,
        listingType: form.listingType,
        route: form.route,
        tripRouteId: form.tripRouteId.trim() ? parseInt(form.tripRouteId, 10) : null,
        date: form.date,
        departureTime: form.departureTime || null,
        seats: form.seats ? parseInt(form.seats, 10) : null,
        priceUah: form.priceUah ? parseInt(form.priceUah, 10) : null,
        phone: form.phone,
        notes: form.notes || null,
        isActive: form.isActive,
      });
      setSuccess('Оголошення оновлено.');
      closeEdit();
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка оновлення');
    }
  };

  const cleanup = async () => {
    if (!window.confirm('Деактивувати всі старі оголошення?')) return;
    setError('');
    setSuccess('');
    try {
      setSuccess((await apiClient.cleanupOldViberListings()).message);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка очищення');
    }
  };

  const issueTile = (key: Exclude<ListingIssue, 'none'>, sub: string) => (
    <StatTile
      label={ISSUE_LABEL[key]}
      value={counts[key]}
      sub={sub}
      tone={counts[key] ? 'warn' : 'default'}
      to={counts[key] && issue !== key ? issueHref(key) : undefined}
    />
  );

  return (
    <div className="tab-content viber-tab">
      <AdminSectionHeader
        title="Попутки з Viber і Telegram"
        purpose="Оголошення водіїв і пасажирів з Viber і Telegram-груп: що зараз на дошці, що розібрано неповно, правка й зняття."
        actions={
          <>
            <button type="button" className="admin-kit-btn" onClick={() => setCreateOpen(true)}>
              Додати з Viber
            </button>
            <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void cleanup()} title="Деактивувати оголошення, чий час уже минув">
              Зняти старі
            </button>
            <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void load()} disabled={loading}>
              Оновити
            </button>
          </>
        }
      />

      <StatTiles label="Активні оголошення">
        <StatTile label="На дошці" value={counts.active} sub={`водіїв ${counts.drivers} · пасажирів ${counts.passengers}`} />
        <StatTile label="Сьогодні" value={counts.today} sub={`Telegram ${counts.telegram} · Viber ${counts.viber}`} />
        {issueTile('notime', 'не видно, коли їде')}
        {issueTile('nophone', 'нема як звʼязатись')}
        {issueTile('noroute', 'не знайдеться «по дорозі»')}
        {issueTile('unnotified', 'не знає про публікацію')}
      </StatTiles>

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <div className="viber-toolbar" role="group" aria-label="Фільтри">
        <ChipGroup
          label="Стан"
          value={filter.state}
          onChange={(state) => patch({ state })}
          options={[
            { value: 'active', label: `Активні ${counts.active}` },
            { value: 'all', label: `Усі ${counts.total}` },
          ]}
        />
        <ChipGroup
          label="Хто"
          value={filter.kind}
          onChange={(kind) => patch({ kind })}
          options={[
            { value: '', label: 'Водії й пасажири' },
            { value: 'driver', label: 'Водії' },
            { value: 'passenger', label: 'Пасажири' },
          ]}
        />
        <ChipGroup
          label="Що не так"
          value={issue}
          onChange={setIssue}
          options={[
            { value: 'none', label: 'Будь-які' },
            ...(Object.keys(ISSUE_LABEL) as Array<Exclude<ListingIssue, 'none'>>).map((k) => ({ value: k, label: ISSUE_LABEL[k] })),
          ]}
        />
      </div>
      <div className="viber-toolbar">
        <input type="search" className="viber-input viber-input--grow" placeholder="Телефон, імʼя, текст" value={filter.query} onChange={(e) => patch({ query: e.target.value })} aria-label="Пошук" />
        <input type="text" className="viber-input" placeholder="Маршрут" value={filter.route} onChange={(e) => patch({ route: e.target.value })} aria-label="Маршрут" />
        <input type="date" className="viber-input" value={filter.date} onChange={(e) => patch({ date: e.target.value })} aria-label="Дата" />
        <ChipGroup
          label="Порядок"
          value={filter.sort}
          onChange={(sort) => patch({ sort })}
          options={[
            { value: 'new', label: 'Нові спочатку' },
            { value: 'trip', label: 'За часом поїздки' },
          ]}
        />
        {filtered && (
          <button type="button" className="admin-kit-linkbtn" onClick={reset}>
            Скинути фільтри
          </button>
        )}
      </div>

      {loading && !listings.length ? (
        <p className="viber-muted" aria-live="polite">
          Завантаження…
        </p>
      ) : shown.length === 0 ? (
        <EmptyState
          action={
            filtered ? (
              <button type="button" className="admin-kit-linkbtn" onClick={reset}>
                Скинути фільтри
              </button>
            ) : undefined
          }
        >
          Оголошень за цими фільтрами немає.
        </EmptyState>
      ) : (
        <>
          <p className="viber-muted viber-count">Показано {shown.length}</p>
          <ul className="viber-rows" aria-label="Оголошення">
            {shown.map((l) => {
              const tr = l.tripRouteId != null ? routeById.get(l.tripRouteId) : undefined;
              const channel = listingChannel(l);
              return (
                <li key={l.id} className={`viber-row${l.isActive ? '' : ' is-off'}`} aria-label={`Оголошення #${l.id}`}>
                  <span className={`viber-kind viber-kind--${l.listingType}`}>{l.listingType === 'driver' ? 'Водій' : 'Пасажир'}</span>
                  <span className="viber-when">
                    <strong>{tripDay(l.date, today)}</strong>
                    {l.departureTime ? <span> {l.departureTime}</span> : <span className="sched-flag">без часу</span>}
                  </span>
                  <span className="viber-what">
                    <span className="viber-route" title={tr?.slug ?? l.route}>
                      {tr ? tr.labelUk : l.route}
                      {tr && tr.corridorTripRouteId ? <span className="viber-muted"> · варіант</span> : null}
                    </span>
                    <span className="sched-tags">
                      {l.seats != null && <span className="sched-tag">місць {l.seats}</span>}
                      {l.priceUah != null && <span className="sched-tag">{l.priceUah} грн</span>}
                      {l.tripRouteId == null && <span className="sched-flag">без маршруту</span>}
                      <span className={`sched-tag viber-channel--${channel}`}>{channel === 'telegram' ? 'Telegram' : 'Viber'}</span>
                    </span>
                    {l.notes ? <span className="viber-notes">{l.notes}</span> : null}
                  </span>
                  <span className="viber-who">
                    {l.phone?.trim() ? <strong>{formatPhoneDisplay(l.phone)}</strong> : <span className="sched-flag">без телефону</span>}
                    <span className="viber-muted">
                      {l.senderName || '—'}
                      {l.sourceChat ? (
                        <>
                          {' · '}
                          {l.sourceUrl ? (
                            <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer">
                              {l.sourceChat}
                              {l.sourceTopicId ? `/${l.sourceTopicId}` : ''} ↗
                            </a>
                          ) : (
                            <>
                              {l.sourceChat}
                              {l.sourceTopicId ? `/${l.sourceTopicId}` : ''}
                            </>
                          )}
                        </>
                      ) : null}
                    </span>
                  </span>
                  <span className="viber-state">
                    <StatusPill tone={l.isActive ? 'ok' : 'off'}>{l.isActive ? 'на дошці' : 'знято'}</StatusPill>
                    <span className={l.authorNotifiedAt ? 'viber-notified' : 'viber-muted'}>
                      {l.authorNotifiedAt
                        ? `автору ✓ ${new Date(l.authorNotifiedAt).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })}`
                        : 'автору не надіслано'}
                    </span>
                  </span>
                  <span className="viber-actions">
                    <span className="viber-muted viber-id">#{l.id}</span>
                    <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => openEdit(l)}>
                      Редагувати
                    </button>
                    {l.isActive && (
                      <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void deactivate(l.id)}>
                        Зняти
                      </button>
                    )}
                    <button type="button" className="admin-kit-linkbtn viber-danger" onClick={() => void remove(l.id)}>
                      Видалити
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {createOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Додати з Viber" onClick={(e) => e.target === e.currentTarget && setCreateOpen(false)}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Додати оголошення з Viber</h2>
              <button type="button" className="close-btn" aria-label="Закрити" onClick={() => setCreateOpen(false)}>
                &times;
              </button>
            </div>
            <form onSubmit={(e) => void create(e)}>
              <label className="viber-field">
                Повідомлення з Viber-чату *
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={'Приклад:\n[ 9 лютого 2026 р. 12:55 ] ⁨Ковальчук Інна⁩: 2 пасажира\nСьогодні (9.02) \nКиїв(академ)-Малин\n18:00-18:30\n0730392680'}
                  rows={10}
                  required
                  className="viber-textarea viber-textarea--mono"
                />
              </label>
              <p className="viber-muted">Можна вставити одразу кілька повідомлень — кожне стане окремим оголошенням.</p>
              <div className="form-actions">
                <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => setCreateOpen(false)}>
                  Скасувати
                </button>
                <button type="submit" className="admin-kit-btn">
                  Створити
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editing && form && (
        <div className="modal" role="dialog" aria-modal="true" aria-label={`Оголошення #${editing.id}`} onClick={(e) => e.target === e.currentTarget && closeEdit()}>
          <div className="modal-content">
            <div className="modal-header">
              <h2>Оголошення #{editing.id}</h2>
              <button type="button" className="close-btn" aria-label="Закрити" onClick={closeEdit}>
                &times;
              </button>
            </div>
            <form onSubmit={(e) => void save(e)} className="viber-form">
              <label className="viber-field">
                Повідомлення (як надійшло)
                <textarea className="viber-textarea" value={form.rawMessage} onChange={(e) => setForm({ ...form, rawMessage: e.target.value })} rows={3} />
              </label>
              <div className="viber-form__grid">
                <Input label="Відправник" value={form.senderName} onChange={(e) => setForm({ ...form, senderName: e.target.value })} />
                <label className="viber-field">
                  Тип
                  <Select
                    value={form.listingType}
                    onChange={(e) => setForm({ ...form, listingType: e.target.value as ViberListingType })}
                    options={[
                      { value: 'driver', label: 'Водій' },
                      { value: 'passenger', label: 'Пасажир' },
                    ]}
                  />
                </label>
                <Input label="Маршрут (як записано)" value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })} />
                <label className="viber-field">
                  Маршрут у каталозі (коридор / варіант)
                  <Select
                    value={form.tripRouteId}
                    onChange={(e) => {
                      const id = e.target.value;
                      const tr = tripRoutes.find((r) => String(r.id) === id);
                      setForm({ ...form, tripRouteId: id, ...(tr ? { route: tr.slug } : {}) });
                    }}
                    options={[
                      { value: '', label: '— не привʼязано —' },
                      ...tripRoutes.map((r) => ({ value: String(r.id), label: `${r.labelUk}${r.corridorTripRouteId ? ' (варіант)' : ' (коридор)'} · ${r.slug}` })),
                    ]}
                  />
                </label>
              </div>
              <p className="viber-muted">
                Для <b>водія</b> варіант (напр. Київ–Малин через Ірпінь) вмикає збіг «по дорозі»: пасажир з Ірпеня до Малина знайде цю поїздку.
                Для пасажира маршрут у каталозі майже не впливає — збіг іде за точками звідки / куди.
              </p>
              <div className="viber-form__grid viber-form__grid--4">
                <label className="viber-field">
                  Дата поїздки
                  <input type="date" className="viber-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
                </label>
                <Input label="Час" value={form.departureTime} onChange={(e) => setForm({ ...form, departureTime: e.target.value })} placeholder="18:00 або 18:00-18:30" />
                <Input label="Місця" type="number" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} placeholder="—" />
                <Input label="Ціна, грн" type="number" value={form.priceUah} onChange={(e) => setForm({ ...form, priceUah: e.target.value })} placeholder="—" />
              </div>
              <Input label="Телефон *" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
              <label className="viber-field">
                Примітки
                <textarea className="viber-textarea" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </label>
              <label className="viber-check">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                На дошці (активне)
              </label>
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
    </div>
  );
};
