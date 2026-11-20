import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { formatPhoneDisplay } from '@/utils/constants';
import type { BehaviorPromoScenarioKey, ViberAnalyticsPromoScenariosResponse, ViberClientBehavior } from '@/types';
import { AdminSectionHeader, AdminSectionNav, ChipGroup, EmptyState, StatusPill } from '../kit';
import {
  CHANNEL_FILTERS,
  firstOf,
  isPromoSection,
  PROFILE_LABEL,
  PROMO_ADMIN_BASE,
  promoSections,
  REMINDER_FILTERS,
  shortDate,
  type ChannelFilter,
  type ReminderFilter,
} from './promoText';
import '../SchedulesTab.css';
import './PromoTab.css';

type PersonRow = { id: number; phoneNormalized: string; fullName: string | null };
type ReminderRow = PersonRow & { telegramReminderSentAt: string | null };
type ChannelResults = {
  sent: Array<{ phone: string; fullName: string | null; via?: 'telegram' | 'sms' }>;
  notFound: Array<{ phone: string; fullName: string | null }>;
  smsSent?: number;
};
type ReminderResults = { sent: number; failed: number; total: number; message: string; blocked: PersonRow[] };

const LIST_LIMIT = 50;

const who = (p: { fullName: string | null; phone?: string; phoneNormalized?: string }) => (
  <>
    <strong>{p.fullName || '—'}</strong> <span className="promo-muted">{formatPhoneDisplay(p.phone ?? p.phoneNormalized ?? '')}</span>
  </>
);

/**
 * Вкладка «Реклама» (`/admin/promo/<розділ>`): «Реклама каналу» — людям без бота (через особистий акаунт, за потреби
 * SMS), «Нагадування в боті» — тим, хто вже в боті (нагадування й «Приведи друга»), «Постійні клієнти» — профілі з
 * історії поїздок і персональна реклама. Перед розсиланням усім — підтвердження з кількістю людей.
 */
export const PromoTab: React.FC<{ section?: string }> = ({ section = '' }) => {
  // реклама каналу
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('no_communication');
  const [channelPersons, setChannelPersons] = useState<PersonRow[] | null>(null);
  const [channelResults, setChannelResults] = useState<ChannelResults | null>(null);
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelError, setChannelError] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactBusy, setContactBusy] = useState(false);
  const [contactOk, setContactOk] = useState('');
  // нагадування в боті
  const [reminderFilter, setReminderFilter] = useState<ReminderFilter>('all');
  const [reminderPersons, setReminderPersons] = useState<ReminderRow[] | null>(null);
  const [reminderResults, setReminderResults] = useState<ReminderResults | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderError, setReminderError] = useState('');
  const [reminderOk, setReminderOk] = useState('');
  const [viaUserBusy, setViaUserBusy] = useState(false);
  const [viaUserMessage, setViaUserMessage] = useState('');
  const [viaUserError, setViaUserError] = useState('');
  // постійні клієнти
  const [clients, setClients] = useState<ViberClientBehavior[]>([]);
  const [clientsPage, setClientsPage] = useState(0);
  const [clientsPages, setClientsPages] = useState(0);
  const [clientsTotal, setClientsTotal] = useState(0);
  const [scenarios, setScenarios] = useState<ViberAnalyticsPromoScenariosResponse | null>(null);
  const [clientsBusy, setClientsBusy] = useState(false);
  const [clientsError, setClientsError] = useState('');
  const [clientsOk, setClientsOk] = useState('');
  const [sendStatus, setSendStatus] = useState<{ key?: string; done?: boolean; error?: string }>({});

  const loadChannel = useCallback(async (f: ChannelFilter) => {
    setChannelError('');
    try {
      setChannelPersons(await apiClient.getChannelPromoPersons(f));
    } catch (err) {
      setChannelError(err instanceof Error ? err.message : 'Помилка завантаження');
    }
  }, []);

  const loadReminders = useCallback(async (f: ReminderFilter) => {
    setReminderError('');
    try {
      setReminderPersons(await apiClient.getTelegramReminderPersons(f));
    } catch (err) {
      setReminderError(err instanceof Error ? err.message : 'Помилка завантаження списку для нагадувань');
    }
  }, []);

  useEffect(() => {
    void loadChannel(channelFilter);
  }, [loadChannel, channelFilter]);

  useEffect(() => {
    void loadReminders(reminderFilter);
  }, [loadReminders, reminderFilter]);

  if (!isPromoSection(section)) return <Navigate to={PROMO_ADMIN_BASE} replace />;

  const channelCount = channelPersons?.length ?? null;
  const botCount = reminderPersons?.length ?? null;

  const sendChannel = async (first5: boolean) => {
    const n = channelPersons?.length ?? 0;
    if (!first5 && !window.confirm(`Надіслати рекламу каналу ${n} людям? Кому не дійде в Telegram, може піти платне SMS.`)) return;
    setChannelBusy(true);
    setChannelError('');
    setChannelResults(null);
    try {
      setChannelResults(
        await apiClient.sendChannelPromo(first5 ? { filter: channelFilter, limit: 5, delaysMs: [5000, 10000, 15000, 25000] } : { filter: channelFilter })
      );
      await loadChannel(channelFilter);
    } catch (err) {
      setChannelError(err instanceof Error ? err.message : 'Помилка відправки');
    } finally {
      setChannelBusy(false);
    }
  };

  const createContact = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = contactPhone.trim();
    const name = contactName.trim();
    if (!phone || !name) {
      setChannelError('Заповніть телефон та імʼя');
      return;
    }
    setContactBusy(true);
    setChannelError('');
    setContactOk('');
    try {
      await apiClient.createPerson(phone, name);
      setContactOk(`Контакт «${name}» створено.`);
      setContactPhone('');
      setContactName('');
      void loadChannel(channelFilter);
    } catch (err) {
      setChannelError(err instanceof Error ? err.message : 'Помилка створення контакту');
    } finally {
      setContactBusy(false);
    }
  };

  const sendToBot = async (kind: 'reminder' | 'referral') => {
    const n = reminderPersons?.length ?? 0;
    const what = kind === 'reminder' ? 'нагадування' : 'персональне «Приведи друга»';
    if (!window.confirm(`Надіслати ${what} ${n} людям у боті?`)) return;
    setReminderError('');
    setReminderOk('');
    setReminderResults(null);
    setViaUserMessage('');
    setViaUserError('');
    setReminderBusy(true);
    try {
      const result =
        kind === 'reminder'
          ? await apiClient.sendTelegramReminders({ filter: reminderFilter })
          : await apiClient.sendReferralPromo({ filter: reminderFilter });
      setReminderOk(
        result.message ||
          `${kind === 'reminder' ? 'Нагадування' : 'Промо «Приведи друга»'} відправлено: ${result.sent}/${result.total}, помилок: ${result.failed}`
      );
      setReminderResults({ sent: result.sent, failed: result.failed, total: result.total, message: result.message, blocked: result.blocked ?? [] });
      await loadReminders(reminderFilter);
    } catch (err) {
      setReminderError(err instanceof Error ? err.message : 'Помилка відправки');
    } finally {
      setReminderBusy(false);
    }
  };

  const remindViaUser = async () => {
    if (!reminderResults?.blocked.length) return;
    setViaUserError('');
    setViaUserMessage('');
    setViaUserBusy(true);
    try {
      const result = await apiClient.sendReminderViaUserAccount(reminderResults.blocked.map((p) => p.phoneNormalized));
      setViaUserMessage(result.message ?? `Відправлено: ${result.sent}, помилок: ${result.failed}`);
    } catch (err) {
      setViaUserError(err instanceof Error ? err.message : 'Помилка відправки');
    } finally {
      setViaUserBusy(false);
    }
  };

  const importAnalytics = async () => {
    setClientsError('');
    setClientsOk('');
    try {
      const r = await apiClient.importViberAnalytics();
      const msg =
        r.message ||
        `Імпортовано ${r.importedNow} нових записів з ${r.totalSource} (вже було: ${r.alreadyImported}).` +
          (typeof r.totalListings === 'number' && typeof r.totalEvents === 'number'
            ? ` Загалом у ViberListing: ${r.totalListings}, у ViberRideEvent (аналітика): ${r.totalEvents}.`
            : '');
      if (!r.success) setClientsError(msg);
      else
        setClientsOk(
          msg + (typeof r.deletedSourceOld === 'number' ? ` Видалено з джерела записів старіших за місяць: ${r.deletedSourceOld}.` : '')
        );
    } catch (err) {
      setClientsError(err instanceof Error ? err.message : 'Помилка імпорту аналітики');
    }
  };

  const loadClients = async (page: number) => {
    setClientsError('');
    setClientsBusy(true);
    try {
      const [result, sc] = await Promise.all([
        apiClient.getViberAnalyticsSummary({ page, pageSize: 50, minRides: 3 }),
        page === 1 || !scenarios ? apiClient.getViberAnalyticsPromoScenarios() : Promise.resolve(scenarios),
      ]);
      setClients((prev) => (page === 1 ? result.clients : [...prev, ...result.clients]));
      setClientsPage(result.page);
      setClientsPages(result.totalPages);
      setClientsTotal(result.total);
      setScenarios(sc);
      if (page === 1 && result.total === 0) setClientsOk('Поки що немає достатньо даних для поведінкових профілів.');
    } catch (err) {
      setClientsError(err instanceof Error ? err.message : 'Помилка завантаження аналітики');
    } finally {
      setClientsBusy(false);
    }
  };

  const sendPersonPromo = async (c: ViberClientBehavior, key: BehaviorPromoScenarioKey) => {
    const rowKey = `${c.phoneNormalized}:${key}`;
    setSendStatus({ key: rowKey });
    setClientsOk('');
    try {
      const r = await apiClient.sendViberAnalyticsPersonPromo(c.phoneNormalized, key, c.routes[0]?.route);
      if (r.success) {
        setSendStatus({ key: rowKey, done: true });
        setClientsOk(`Реклама відправлена (${r.sentVia === 'bot' ? 'бот' : 'ваш акаунт'}).`);
      } else setSendStatus({ key: rowKey, error: r.error ?? 'Помилка відправки' });
    } catch (err) {
      setSendStatus({ key: rowKey, error: err instanceof Error ? err.message : 'Помилка відправки' });
    }
  };

  const channelList = firstOf(channelPersons ?? [], LIST_LIMIT);
  const reminderList = firstOf(reminderPersons ?? [], LIST_LIMIT);

  return (
    <div className="tab-content promo-tab">
      <AdminSectionHeader
        title="Реклама"
        purpose="Розсилки людям з бази: про канал — тим, хто без бота; нагадування й «Приведи друга» — тим, хто в боті; персонально — постійним клієнтам."
      />
      <AdminSectionNav base={PROMO_ADMIN_BASE} sections={promoSections({ channel: channelCount, bot: botCount })} label="Розділи «Реклама»" />

      {section === '' && (
        <section className="promo-block" aria-labelledby="promo-channel-title">
          <div className="promo-block__head">
            <h3 id="promo-channel-title">Реклама каналу</h3>
            <span className="promo-muted">люди без Telegram-бота; пише особистий акаунт, де не вийде — платне SMS; дата комунікації ставиться після відправки</span>
          </div>
          {channelError && <Alert variant="error">{channelError}</Alert>}
          {contactOk && <Alert variant="success">{contactOk}</Alert>}
          <div className="promo-toolbar">
            <ChipGroup label="Кому" value={channelFilter} onChange={setChannelFilter} options={CHANNEL_FILTERS} />
            <span className="promo-actions">
              <button type="button" className="admin-kit-btn" disabled={channelBusy || !channelCount} onClick={() => void sendChannel(false)}>
                {channelBusy ? 'Відправка…' : `Надіслати всім ${channelCount ?? ''}`.trim()}
              </button>
              <button
                type="button"
                className="admin-kit-btn admin-kit-btn--quiet"
                disabled={channelBusy || !channelCount}
                onClick={() => void sendChannel(true)}
                title="Першим 5 з паузою 5, 10, 15, 25 с між відправками"
              >
                Перші 5 з паузою
              </button>
              <button type="button" className="admin-kit-btn admin-kit-btn--quiet" disabled={channelBusy} onClick={() => void loadChannel(channelFilter)}>
                Оновити
              </button>
            </span>
          </div>

          {channelResults && (
            <div className="promo-results" aria-label="Результат розсилки">
              <div className="sched-tags">
                <span className="sched-tag promo-tag--ok">доставлено {channelResults.sent.length}</span>
                {channelResults.smsSent ? <span className="sched-flag">платних SMS {channelResults.smsSent}</span> : null}
                <span className={channelResults.notFound.length ? 'sched-flag' : 'sched-tag'}>не знайдено в Telegram {channelResults.notFound.length}</span>
              </div>
              <ul className="promo-rows">
                {channelResults.sent.map((r, i) => (
                  <li key={`s-${i}`} className="promo-row">
                    <span>{who(r)}</span>
                    <span className="sched-tag">{r.via === 'sms' ? 'SMS (платно)' : 'Telegram'}</span>
                  </li>
                ))}
                {channelResults.notFound.map((r, i) => (
                  <li key={`n-${i}`} className="promo-row">
                    <span>{who(r)}</span>
                    <span className="sched-flag">не знайдено в Telegram</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {channelPersons == null ? (
            <p className="promo-muted">Завантаження…</p>
          ) : channelPersons.length === 0 ? (
            <EmptyState>За цим вибором нікого немає.</EmptyState>
          ) : (
            <>
              <p className="promo-muted promo-count">Підходить {channelPersons.length}</p>
              <ul className="promo-rows promo-rows--grid" aria-label="Кому піде реклама каналу">
                {channelList.shown.map((p) => (
                  <li key={p.id} className="promo-row">
                    <span>{who(p)}</span>
                    <span className="promo-muted">#{p.id}</span>
                  </li>
                ))}
              </ul>
              {channelList.more > 0 && <p className="promo-muted">…і ще {channelList.more}</p>}
            </>
          )}

          <details className="promo-contact">
            <summary>Додати контакт вручну</summary>
            <form onSubmit={(e) => void createContact(e)} className="promo-contact__form">
              <label>
                Телефон
                <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+380931701835" required />
              </label>
              <label>
                Імʼя
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Петро Коваленко" required />
              </label>
              <button type="submit" className="admin-kit-btn" disabled={contactBusy}>
                {contactBusy ? 'Збереження…' : 'Створити контакт'}
              </button>
            </form>
          </details>
        </section>
      )}

      {section === 'reminders' && (
        <section className="promo-block" aria-labelledby="promo-reminders-title">
          <div className="promo-block__head">
            <h3 id="promo-reminders-title">Нагадування в боті</h3>
            <span className="promo-muted">люди, що вже підключили бота; «Приведи друга» — кожному своє посилання ?start=ref_…</span>
          </div>
          {reminderError && <Alert variant="error">{reminderError}</Alert>}
          {reminderOk && <Alert variant="success">{reminderOk}</Alert>}
          <div className="promo-toolbar">
            <ChipGroup label="Кому" value={reminderFilter} onChange={setReminderFilter} options={REMINDER_FILTERS} />
            <span className="promo-actions">
              <button type="button" className="admin-kit-btn" disabled={reminderBusy || !botCount} onClick={() => void sendToBot('reminder')}>
                {reminderBusy ? 'Відправка…' : `Нагадати всім ${botCount ?? ''}`.trim()}
              </button>
              <button type="button" className="admin-kit-btn admin-kit-btn--quiet" disabled={reminderBusy || !botCount} onClick={() => void sendToBot('referral')}>
                Приведи друга (персонально)
              </button>
              <button type="button" className="admin-kit-btn admin-kit-btn--quiet" disabled={reminderBusy} onClick={() => void loadReminders(reminderFilter)}>
                Оновити
              </button>
            </span>
          </div>

          {reminderResults && reminderResults.blocked.length > 0 && (
            <div className="promo-results" aria-label="Заблокували бота">
              <div className="promo-results__head">
                <span className="sched-flag">заблокували бота {reminderResults.blocked.length}</span>
                <button type="button" className="admin-kit-btn admin-kit-btn--quiet" disabled={viaUserBusy} onClick={() => void remindViaUser()}>
                  {viaUserBusy ? 'Відправка…' : 'Нагадати їм від мого імені'}
                </button>
                {viaUserMessage && <span className="promo-ok">{viaUserMessage}</span>}
              </div>
              {viaUserError && <Alert variant="error">{viaUserError}</Alert>}
              <ul className="promo-rows">
                {reminderResults.blocked.map((p) => (
                  <li key={p.id} className="promo-row">
                    <span>{who(p)}</span>
                    <span className="promo-muted">#{p.id}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {reminderPersons == null ? (
            <p className="promo-muted">Завантаження…</p>
          ) : reminderPersons.length === 0 ? (
            <EmptyState>За цим вибором нікого немає.</EmptyState>
          ) : (
            <>
              <p className="promo-muted promo-count">Підходить {reminderPersons.length}</p>
              <ul className="promo-rows promo-rows--grid" aria-label="Кому піде нагадування">
                {reminderList.shown.map((p) => (
                  <li key={p.id} className="promo-row">
                    <span>{who(p)}</span>
                    <span className="promo-muted">{p.telegramReminderSentAt ? `нагадували ${shortDate(p.telegramReminderSentAt)}` : 'ще не нагадували'}</span>
                  </li>
                ))}
              </ul>
              {reminderList.more > 0 && <p className="promo-muted">…і ще {reminderList.more}</p>}
            </>
          )}
        </section>
      )}

      {section === 'regulars' && (
        <section className="promo-block" aria-labelledby="promo-regulars-title">
          <div className="promo-block__head">
            <h3 id="promo-regulars-title">Постійні клієнти</h3>
            <span className="promo-muted">профілі з історії поїздок (ViberRide, від 3 поїздок): маршрути, звички, ідеї й персональна реклама</span>
          </div>
          {clientsError && <Alert variant="error">{clientsError}</Alert>}
          {clientsOk && <Alert variant="success">{clientsOk}</Alert>}
          <div className="promo-toolbar">
            <span className="promo-actions promo-actions--left">
              <button type="button" className="admin-kit-btn" disabled={clientsBusy} onClick={() => void loadClients(1)}>
                {clientsBusy ? 'Аналіз…' : clients.length ? 'Оновити профілі' : 'Показати профілі'}
              </button>
              <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void importAnalytics()} title="Перенести нові записи ViberRide в аналітичну таблицю">
                Імпортувати нові поїздки
              </button>
            </span>
            {clientsTotal > 0 && (
              <span className="promo-muted">
                показано {clients.length} з {clientsTotal}
              </span>
            )}
          </div>
          {clients.length === 0 ? (
            <EmptyState>Профілі ще не завантажені — «Показати профілі».</EmptyState>
          ) : (
            <ul className="promo-rows" aria-label="Постійні клієнти">
              {clients.map((c) => {
                const keys = scenarios?.scenarioKeysByProfile[c.profileRole] ?? [];
                const canSend = !(c.communicationFailed && !c.hasTelegramBot);
                return (
                  <li key={c.phoneNormalized} className="promo-client">
                    <div className="promo-client__head">
                      <span>{who(c)}</span>
                      <span className="sched-tags">
                        <span className="sched-tag">поїздок {c.totalRides}</span>
                        <span className="sched-tag">{PROFILE_LABEL[c.profileRole]}</span>
                        <span className="sched-tag">
                          {shortDate(c.firstRideDate)} — {shortDate(c.lastRideDate)}
                        </span>
                        {c.hasTelegramBot ? <StatusPill tone="ok">у боті</StatusPill> : null}
                        {!canSend && <span className="sched-flag">комунікація не вдалася</span>}
                      </span>
                    </div>
                    <div className="promo-client__routes promo-muted">
                      {c.routes.slice(0, 3).map((r) => `${r.route} (${r.count})`).join(' · ')}
                    </div>
                    <p className="promo-client__summary">{c.behaviorSummary}</p>
                    {c.recommendations.length > 0 && (
                      <details className="promo-client__ideas">
                        <summary>Ідеї ({c.recommendations.length})</summary>
                        <ul>
                          {c.recommendations.map((rec, i) => (
                            <li key={i}>{rec}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {keys.length > 0 && (
                      <div className="promo-client__send">
                        {keys.map((key) => {
                          const label = scenarios?.scenarios.find((s) => s.key === key)?.label ?? key;
                          const rowKey = `${c.phoneNormalized}:${key}`;
                          const mine = sendStatus.key === rowKey;
                          const sending = mine && !sendStatus.done && !sendStatus.error;
                          return (
                            <span key={key} className="promo-client__scenario">
                              <button
                                type="button"
                                className="admin-kit-btn admin-kit-btn--quiet"
                                disabled={!canSend || sending}
                                onClick={() => void sendPersonPromo(c, key)}
                                title={!canSend ? 'Невдала комунікація — контакт не знайдено в Telegram' : undefined}
                              >
                                {sending ? '…' : mine && sendStatus.done ? `✓ ${label}` : label}
                              </button>
                              {mine && sendStatus.error && <span className="promo-error">{sendStatus.error}</span>}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {clientsPage > 0 && clientsPage < clientsPages && (
            <button type="button" className="admin-kit-btn admin-kit-btn--quiet promo-more" disabled={clientsBusy} onClick={() => void loadClients(clientsPage + 1)}>
              Завантажити ще
            </button>
          )}
        </section>
      )}
    </div>
  );
};
