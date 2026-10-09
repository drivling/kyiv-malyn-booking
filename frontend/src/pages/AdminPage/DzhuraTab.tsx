import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import type { DzhuraChatRow, DzhuraJob, DzhuraMessageRow, DzhuraStatus } from '@/types';
import './DzhuraTab.css';

/**
 * «Джура» · фаза 0 — які чати читає userbot, дата останнього повідомлення,
 * експорт історії за період у JSON, довантаження історії з Telegram.
 * Слухач ніколи не ставить «прочитано» і не пише в ці чати — лише дублює у «Обране» власника.
 */

const KIND_LABEL: Record<string, string> = {
  group: 'група',
  supergroup: 'супергрупа',
  private: 'особистий',
  channel: 'канал',
};

const DEFAULT_POLL_MS = 1500;
const STATUS_REFRESH_MS = 30_000;
const MESSAGES_PAGE = 50;
const SHOW_PRIVATE_KEY = 'dzhura.showPrivate';

const MEDIA_LABEL: Record<string, string> = {
  photo: 'фото',
  video: 'відео',
  video_note: 'відеоповідомлення',
  voice: 'голосове',
  audio: 'аудіо',
  sticker: 'стікер',
  gif: 'gif',
  document: 'файл',
  contact: 'контакт',
  geo: 'геолокація',
  poll: 'опитування',
  other: 'медіа',
};

function reactionsText(m: DzhuraMessageRow): string {
  if (m.reactionsCounts && Object.keys(m.reactionsCounts).length) {
    return Object.entries(m.reactionsCounts)
      .map(([emoji, n]) => `${emoji.startsWith('custom:') ? '◆' : emoji}${n > 1 ? ` ${n}` : ''}`)
      .join(' ');
  }
  if (m.reactions.length) return m.reactions.map((r) => (r.emoji.startsWith('custom:') ? '◆' : r.emoji)).join(' ');
  return '';
}

function readShowPrivate(): boolean {
  try {
    return localStorage.getItem(SHOW_PRIVATE_KEY) === '1';
  } catch {
    return false;
  }
}

type MessagesPanel = {
  chatId: number;
  /** текст у полі пошуку */
  q: string;
  /** пошук, за яким завантажено список */
  appliedQ: string;
  items: DzhuraMessageRow[];
  nextBeforeId: number | null;
  loading: boolean;
  error: string | null;
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoToday(): string {
  return toIsoDate(new Date());
}

function isoMonthStart(): string {
  const d = new Date();
  return toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

function secondsSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 1000));
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Невідома помилка';
}

function jobProgressText(job: DzhuraJob | undefined): string | null {
  if (!job) return null;
  const p = (job.progress ?? {}) as Record<string, unknown>;
  const r = (job.result ?? {}) as Record<string, unknown>;
  if (job.status === 'pending') return 'У черзі до слухача…';
  if (job.status === 'running') {
    const scanned = Number(p.scanned ?? 0);
    const stored = Number(p.stored ?? 0);
    const flood = p.floodWait ? ` · пауза Telegram ${String(p.floodWait)} с` : '';
    return `Довантажуємо: переглянуто ${scanned}, збережено ${stored}${flood}`;
  }
  if (job.status === 'done') {
    return `Готово: нових ${Number(r.stored ?? 0)}, оновлено ${Number(r.updated ?? 0)} (переглянуто ${Number(r.scanned ?? 0)})`;
  }
  if (job.status === 'failed') return `Не вдалося: ${job.errorText || 'помилка слухача'}`;
  return null;
}

type Props = {
  /** Інтервал опитування задач (тести передають маленький) */
  pollIntervalMs?: number;
};

export const DzhuraTab: React.FC<Props> = ({ pollIntervalMs = DEFAULT_POLL_MS }) => {
  const [status, setStatus] = useState<DzhuraStatus | null>(null);
  const [chats, setChats] = useState<DzhuraChatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [syncJob, setSyncJob] = useState<DzhuraJob | null>(null);
  const [historyChatId, setHistoryChatId] = useState<number | null>(null);
  const [range, setRange] = useState<{ from: string; to: string }>({ from: isoMonthStart(), to: isoToday() });
  const [backfillJobs, setBackfillJobs] = useState<Record<number, DzhuraJob>>({});
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [showPrivate, setShowPrivate] = useState<boolean>(readShowPrivate);
  const [chatQuery, setChatQuery] = useState('');
  const [messagesPanel, setMessagesPanel] = useState<MessagesPanel | null>(null);
  const [retryingQueue, setRetryingQueue] = useState(false);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_PRIVATE_KEY, showPrivate ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [showPrivate]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [st, rows] = await Promise.all([apiClient.getDzhuraStatus(), apiClient.getDzhuraChats('all')]);
      setStatus(st);
      setChats(rows);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => {
      apiClient
        .getDzhuraStatus()
        .then(setStatus)
        .catch(() => undefined);
    }, STATUS_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  const watchJob = useCallback(
    (jobId: number, apply: (job: DzhuraJob) => void) => {
      const schedule = () => {
        const t = setTimeout(async () => {
          timersRef.current.delete(t);
          try {
            const job = await apiClient.getDzhuraJob(jobId);
            apply(job);
            if (job.status === 'pending' || job.status === 'running') schedule();
          } catch (e) {
            setError(errorMessage(e));
          }
        }, pollIntervalMs);
        timersRef.current.add(t);
      };
      schedule();
    },
    [pollIntervalMs],
  );

  const loadMessages = useCallback(async (chatId: number, q: string, beforeId: number | null) => {
    setMessagesPanel((p) => {
      const same = p !== null && p.chatId === chatId;
      return {
        chatId,
        q: same ? p.q : q,
        appliedQ: q,
        items: same && beforeId ? p.items : [],
        nextBeforeId: same && beforeId ? p.nextBeforeId : null,
        loading: true,
        error: null,
      };
    });
    try {
      const page = await apiClient.getDzhuraMessages(chatId, { q: q || undefined, beforeId, limit: MESSAGES_PAGE });
      setMessagesPanel((p) =>
        p && p.chatId === chatId
          ? { ...p, items: beforeId ? [...p.items, ...page.messages] : page.messages, nextBeforeId: page.nextBeforeId, loading: false }
          : p,
      );
    } catch (e) {
      setMessagesPanel((p) => (p && p.chatId === chatId ? { ...p, loading: false, error: errorMessage(e) } : p));
    }
  }, []);

  const handleRetryQueue = async () => {
    setError(null);
    setSuccess(null);
    setRetryingQueue(true);
    try {
      const { requeued } = await apiClient.retryDzhuraQueue();
      setSuccess(requeued ? `Повернуто в чергу: ${requeued}` : 'Невдалих дублів за тиждень немає');
      setStatus(await apiClient.getDzhuraStatus());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRetryingQueue(false);
    }
  };

  const handleSyncDialogs = async () => {
    setError(null);
    setSuccess(null);
    try {
      const { job } = await apiClient.createDzhuraJob({ type: 'sync_dialogs' });
      setSyncJob(job);
      watchJob(job.id, (j) => {
        setSyncJob(j);
        if (j.status === 'done') {
          setSuccess('Список чатів оновлено');
          void load();
        } else if (j.status === 'failed') {
          setError(`Оновлення списку не вдалося: ${j.errorText || 'помилка слухача'}`);
        }
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const toggleFlag = async (chat: DzhuraChatRow, patch: { captureEnabled?: boolean; relayToSaved?: boolean }) => {
    setError(null);
    setSuccess(null);
    setSavingId(chat.id);
    const prev = chats;
    setChats((rows) => rows.map((r) => (r.id === chat.id ? { ...r, ...patch } : r)));
    try {
      const updated = await apiClient.updateDzhuraChat(chat.id, patch);
      setChats((rows) => rows.map((r) => (r.id === chat.id ? updated : r)));
    } catch (e) {
      setChats(prev);
      setError(errorMessage(e));
    } finally {
      setSavingId(null);
    }
  };

  const rangeError = (): string | null => {
    if (!range.from || !range.to) return 'Вкажіть обидві дати';
    if (range.to < range.from) return 'Дата «до» раніша за дату «від»';
    return null;
  };

  const handleExport = async (chat: DzhuraChatRow) => {
    const err = rangeError();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSuccess(null);
    setExportingId(chat.id);
    try {
      const { blob, fileName } = await apiClient.downloadDzhuraExport(chat.id, range.from, range.to);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccess(`Файл ${fileName} завантажено`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExportingId(null);
    }
  };

  const handleBackfill = async (chat: DzhuraChatRow) => {
    const err = rangeError();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const { job } = await apiClient.createDzhuraJob({ type: 'backfill', chatId: chat.id, from: range.from, to: range.to });
      setBackfillJobs((m) => ({ ...m, [chat.id]: job }));
      watchJob(job.id, (j) => {
        setBackfillJobs((m) => ({ ...m, [chat.id]: j }));
        if (j.status === 'done') void load();
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const renderStatus = () => {
    if (!status) return null;
    if (!status.listenerWanted) {
      return (
        <span className="dzhura-status dzhura-status--off">
          Слухач вимкнений на сервері (LUNCH_LISTENER_ENABLED або немає сесії) — Джура не читає
        </span>
      );
    }
    if (status.heartbeatFresh) {
      const ago = secondsSince(status.heartbeatAt);
      return (
        <span className="dzhura-status dzhura-status--ok">
          Слухач активний{ago !== null ? ` · ${ago} с тому` : ''}
        </span>
      );
    }
    return (
      <span className="dzhura-status dzhura-status--bad">
        Слухач не відповідає (останній сигнал: {formatDateTime(status.heartbeatAt)})
      </span>
    );
  };

  const renderQueue = () => {
    const q = status?.queue;
    if (!q || (q.pending === 0 && q.failed24h === 0)) return null;
    const parts = [`${q.pending} очікує`];
    if (q.retrying) parts.push(`${q.retrying} на повторі`);
    if (q.failed24h) parts.push(`${q.failed24h} невдалих за добу`);
    return (
      <span className={`dzhura-queue${q.failed24h ? ' dzhura-queue--warn' : ''}`}>
        Черга в Обране: {parts.join(' · ')}
      </span>
    );
  };

  const syncBusy = syncJob !== null && (syncJob.status === 'pending' || syncJob.status === 'running');
  const privateCount = chats.filter((c) => c.kind === 'private').length;
  const chatQueryNorm = chatQuery.trim().toLowerCase();
  const visibleChats = chats.filter((c) => {
    if (c.kind === 'private' && !showPrivate && !c.captureEnabled) return false;
    if (!chatQueryNorm) return true;
    return c.title.toLowerCase().includes(chatQueryNorm) || (c.username ?? '').toLowerCase().includes(chatQueryNorm);
  });

  return (
    <div className="dzhura-tab">
      <div className="dzhura-tab__head">
        <div>
          <h2 className="dzhura-tab__title">Джура · читання чатів</h2>
          <p className="dzhura-tab__sub">
            Фаза 0: слухаємо обрані групи з вашого акаунта, пишемо всю переписку й реакції в базу і за бажанням
            дублюємо чужі повідомлення у ваше «Обране». {renderStatus()} {renderQueue()}
          </p>
        </div>
        <div className="dzhura-actions dzhura-actions--tight">
          {status?.queue && status.queue.failed24h > 0 && (
            <Button variant="secondary" onClick={() => void handleRetryQueue()} disabled={retryingQueue}>
              {retryingQueue ? 'Повертаємо…' : 'Повторити невдалі'}
            </Button>
          )}
          <Button variant="secondary" onClick={handleSyncDialogs} disabled={syncBusy}>
            {syncBusy ? 'Оновлюємо список…' : 'Оновити список чатів'}
          </Button>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            Оновити
          </Button>
        </div>
      </div>

      <Alert variant="info">
        Слухач ніколи не ставить «прочитано» і нічого не пише в ці чати — колеги не бачать, що повідомлення
        прочитано. Дубль іде лише у ваше «Обране» (Saved Messages). Медіа не пересилаються, зберігаємо тільки
        текст і тип вкладення.
      </Alert>

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <section className="dzhura-card">
        <h3 className="dzhura-card__title">Чати</h3>
        <p className="dzhura-card__hint">
          «Читати» — зберігати в базу. «В Обране» — дублювати чужі повідомлення й реакції у Saved Messages.
          Група обідів читається завжди (лунч-бот працює на тих самих повідомленнях). Особисті чати, які вже
          читаються, показані завжди; решту вмикає перемикач.
        </p>
        <div className="dzhura-filters">
          <input
            type="search"
            className="dzhura-input"
            aria-label="Пошук чату"
            placeholder="Назва або @нік"
            value={chatQuery}
            onChange={(e) => setChatQuery(e.target.value)}
          />
          <label className="dzhura-check dzhura-check--inline">
            <input type="checkbox" checked={showPrivate} onChange={(e) => setShowPrivate(e.target.checked)} />
            <span>Показати особисті чати{privateCount ? ` (${privateCount})` : ''}</span>
          </label>
        </div>

        {loading && chats.length === 0 ? (
          <p className="dzhura-muted">Завантаження…</p>
        ) : chats.length === 0 ? (
          <p className="dzhura-muted">
            Список порожній. Натисніть «Оновити список чатів» — слухач підтягне чати вашого акаунта.
          </p>
        ) : visibleChats.length === 0 ? (
          <p className="dzhura-muted">Нічого не знайдено за цим фільтром.</p>
        ) : (
          <div className="dzhura-table-wrap">
            <table className="dzhura-table">
              <thead>
                <tr>
                  <th>Чат</th>
                  <th>Читати</th>
                  <th>В Обране</th>
                  <th>Останнє повідомлення</th>
                  <th>Збережено</th>
                  <th>Дії</th>
                </tr>
              </thead>
              <tbody>
                {visibleChats.map((chat) => {
                  const saving = savingId === chat.id;
                  const job = backfillJobs[chat.id];
                  const jobBusy = job && (job.status === 'pending' || job.status === 'running');
                  const historyOpen = historyChatId === chat.id;
                  const messagesOpen = messagesPanel !== null && messagesPanel.chatId === chat.id;
                  return (
                    <React.Fragment key={chat.id}>
                      <tr className={chat.captureEnabled ? 'dzhura-row--active' : undefined}>
                        <td>
                          <div className="dzhura-chat-title">{chat.title}</div>
                          <div className="dzhura-chat-meta">
                            <span className="dzhura-badge">{KIND_LABEL[chat.kind] ?? chat.kind}</span>
                            {chat.isLunchGroup && <span className="dzhura-badge dzhura-badge--lunch">група обідів</span>}
                            {chat.membersCount != null && <span>{chat.membersCount} уч.</span>}
                            {chat.username && <span>@{chat.username}</span>}
                          </div>
                        </td>
                        <td>
                          <label className="dzhura-check" title={chat.isLunchGroup ? 'Група обідів — читаємо завжди' : undefined}>
                            <input
                              type="checkbox"
                              aria-label={`Читати: ${chat.title}`}
                              checked={chat.captureEnabled}
                              disabled={chat.isLunchGroup || saving}
                              onChange={(e) => void toggleFlag(chat, { captureEnabled: e.target.checked })}
                            />
                          </label>
                        </td>
                        <td>
                          <label
                            className="dzhura-check"
                            title={!chat.captureEnabled ? 'Спершу ввімкніть «Читати»' : undefined}
                          >
                            <input
                              type="checkbox"
                              aria-label={`В Обране: ${chat.title}`}
                              checked={chat.relayToSaved}
                              disabled={!chat.captureEnabled || saving}
                              onChange={(e) => void toggleFlag(chat, { relayToSaved: e.target.checked })}
                            />
                          </label>
                        </td>
                        <td className="dzhura-nowrap">{formatDateTime(chat.lastMessageAt)}</td>
                        <td className="dzhura-nowrap">
                          {chat.messagesCount}
                          {chat.lastCapturedAt && (
                            <span className="dzhura-muted"> · {formatDateTime(chat.lastCapturedAt)}</span>
                          )}
                        </td>
                        <td>
                          <div className="dzhura-row-actions">
                            <Button
                              variant="secondary"
                              aria-expanded={messagesOpen}
                              aria-label={`Повідомлення: ${chat.title}`}
                              onClick={() => {
                                if (messagesOpen) setMessagesPanel(null);
                                else void loadMessages(chat.id, '', null);
                              }}
                            >
                              Повідомлення
                            </Button>
                            <Button
                              variant="secondary"
                              aria-expanded={historyOpen}
                              onClick={() => setHistoryChatId(historyOpen ? null : chat.id)}
                            >
                              Історія…
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {messagesOpen && messagesPanel && (
                        <tr className="dzhura-messages-row">
                          <td colSpan={6}>
                            <form
                              className="dzhura-messages__search"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void loadMessages(chat.id, messagesPanel.q.trim(), null);
                              }}
                            >
                              <input
                                type="search"
                                className="dzhura-input"
                                aria-label={`Пошук у повідомленнях: ${chat.title}`}
                                placeholder="Текст або автор"
                                value={messagesPanel.q}
                                onChange={(e) => setMessagesPanel((p) => (p ? { ...p, q: e.target.value } : p))}
                              />
                              <Button type="submit" variant="secondary" disabled={messagesPanel.loading}>
                                Знайти
                              </Button>
                              <span className="dzhura-muted">Новіші першими · те, що вже збережено в базі</span>
                            </form>
                            {messagesPanel.error && <p className="dzhura-job dzhura-job--failed">{messagesPanel.error}</p>}
                            {messagesPanel.items.length === 0 && !messagesPanel.loading && !messagesPanel.error ? (
                              <p className="dzhura-muted">
                                {messagesPanel.appliedQ ? 'Нічого не знайдено' : 'Повідомлень ще немає'}
                              </p>
                            ) : (
                              <ul className="dzhura-messages" aria-label={`Повідомлення чату ${chat.title}`}>
                                {messagesPanel.items.map((m) => (
                                  <li
                                    key={m.id}
                                    className={`dzhura-msg${m.isOutgoing ? ' dzhura-msg--out' : ''}${m.deletedAt ? ' dzhura-msg--deleted' : ''}`}
                                  >
                                    <span className="dzhura-msg__time">{formatDateTime(m.sentAt)}</span>
                                    <span className="dzhura-msg__sender">{m.isOutgoing ? 'ви' : m.sender?.name ?? '—'}</span>
                                    <span className="dzhura-msg__text">
                                      {m.mediaKind && (
                                        <span className="dzhura-badge">{MEDIA_LABEL[m.mediaKind] ?? m.mediaKind}</span>
                                      )}{' '}
                                      {m.text}
                                    </span>
                                    <span className="dzhura-msg__meta">
                                      {reactionsText(m) && <span className="dzhura-msg__reactions">{reactionsText(m)}</span>}
                                      {m.editedAt && <span className="dzhura-muted">(змінено)</span>}
                                      {m.deletedAt && <span className="dzhura-muted">(видалено)</span>}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {messagesPanel.loading && <p className="dzhura-muted">Завантаження…</p>}
                            {messagesPanel.nextBeforeId !== null && !messagesPanel.loading && (
                              <Button
                                variant="secondary"
                                onClick={() => void loadMessages(chat.id, messagesPanel.appliedQ, messagesPanel.nextBeforeId)}
                              >
                                Показати ще
                              </Button>
                            )}
                          </td>
                        </tr>
                      )}
                      {historyOpen && (
                        <tr className="dzhura-history-row">
                          <td colSpan={6}>
                            <div className="dzhura-history">
                              <label className="dzhura-field">
                                <span>Від</span>
                                <input
                                  id={`dzhura-from-${chat.id}`}
                                  type="date"
                                  className="dzhura-input"
                                  value={range.from}
                                  max={range.to || undefined}
                                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                                />
                              </label>
                              <label className="dzhura-field">
                                <span>До</span>
                                <input
                                  id={`dzhura-to-${chat.id}`}
                                  type="date"
                                  className="dzhura-input"
                                  value={range.to}
                                  min={range.from || undefined}
                                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                                />
                              </label>
                              <Button
                                variant="primary"
                                onClick={() => void handleExport(chat)}
                                disabled={exportingId === chat.id}
                              >
                                {exportingId === chat.id ? 'Готуємо файл…' : 'Вигрузити JSON'}
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => void handleBackfill(chat)}
                                disabled={Boolean(jobBusy)}
                                title="Слухач підтягне повідомлення за період з Telegram у базу (без дублів у Обране)"
                              >
                                {jobBusy ? 'Довантажуємо…' : 'Довантажити з Telegram'}
                              </Button>
                              {job && (
                                <span
                                  className={`dzhura-job dzhura-job--${job.status}`}
                                  role="status"
                                  aria-live="polite"
                                >
                                  {jobProgressText(job)}
                                </span>
                              )}
                            </div>
                            <p className="dzhura-muted dzhura-history__hint">
                              Дати — доби за Києвом, включно. JSON містить повідомлення, авторів (ім'я, нік, телефон, якщо
                              Telegram його віддав) і реакції. Довантаження не пересилає нічого в Обране.
                            </p>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {syncJob && syncJob.status === 'failed' && (
          <p className="dzhura-muted">Останнє оновлення списку: {syncJob.errorText || 'помилка'}</p>
        )}
        {status?.dialogsSyncedAt && (
          <p className="dzhura-muted">Список чатів синхронізовано: {formatDateTime(status.dialogsSyncedAt)}</p>
        )}
      </section>
    </div>
  );
};
