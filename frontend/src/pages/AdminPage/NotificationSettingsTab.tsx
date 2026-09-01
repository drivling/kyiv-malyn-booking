import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { formatPhoneDisplay } from '@/utils/constants';
import type {
  NotificationSettings,
  NotificationSettingsPatch,
  NotificationSettingsUsage,
  SmsMatchTypeThreshold,
} from '@/types';
import './NotificationSettingsTab.css';

type Draft = {
  smsFallbackEnabled: boolean;
  smsMatchEnabled: boolean;
  smsAuthorConfirmationEnabled: boolean;
  smsBookingReminderEnabled: boolean;
  smsInactivityReminderEnabled: boolean;
  smsMatchTypeThreshold: SmsMatchTypeThreshold;
  smsDailyCap: string;
  smsMonthlyCap: string;
  turboSmsSender: string;
};

const THRESHOLD_OPTIONS: Array<{ value: SmsMatchTypeThreshold; label: string }> = [
  { value: 'exact', label: 'Лише точні (±45 хв)' },
  { value: 'exact_approximate', label: 'Точні + приблизні (±2 год)' },
  { value: 'all', label: 'Усі збіги (вкл. «того ж дня»)' },
];

const USE_CASE_LABEL: Record<string, string> = {
  match: 'збіг пари',
  authorConfirmation: 'підтвердження автору',
  bookingReminder: 'нагадування',
  inactivityReminder: 'реактивація',
};

function toDraft(s: NotificationSettings): Draft {
  return {
    smsFallbackEnabled: s.smsFallbackEnabled,
    smsMatchEnabled: s.smsMatchEnabled,
    smsAuthorConfirmationEnabled: s.smsAuthorConfirmationEnabled,
    smsBookingReminderEnabled: s.smsBookingReminderEnabled,
    smsInactivityReminderEnabled: s.smsInactivityReminderEnabled,
    smsMatchTypeThreshold: s.smsMatchTypeThreshold,
    smsDailyCap: String(s.smsDailyCap),
    smsMonthlyCap: String(s.smsMonthlyCap),
    turboSmsSender: s.turboSmsSender ?? '',
  };
}

export const NotificationSettingsTab: React.FC = () => {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [usage, setUsage] = useState<NotificationSettingsUsage | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, u] = await Promise.all([
        apiClient.getNotificationSettings(),
        apiClient.getNotificationSettingsUsage().catch(() => null),
      ]);
      setSettings(s);
      setDraft(toDraft(s));
      setUsage(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося завантажити налаштування');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback((up: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...up } : d));
  }, []);

  const save = useCallback(async () => {
    if (!settings || !draft) return;
    const body: NotificationSettingsPatch = {};
    if (draft.smsFallbackEnabled !== settings.smsFallbackEnabled)
      body.smsFallbackEnabled = draft.smsFallbackEnabled;
    if (draft.smsMatchEnabled !== settings.smsMatchEnabled)
      body.smsMatchEnabled = draft.smsMatchEnabled;
    if (draft.smsAuthorConfirmationEnabled !== settings.smsAuthorConfirmationEnabled)
      body.smsAuthorConfirmationEnabled = draft.smsAuthorConfirmationEnabled;
    if (draft.smsBookingReminderEnabled !== settings.smsBookingReminderEnabled)
      body.smsBookingReminderEnabled = draft.smsBookingReminderEnabled;
    if (draft.smsInactivityReminderEnabled !== settings.smsInactivityReminderEnabled)
      body.smsInactivityReminderEnabled = draft.smsInactivityReminderEnabled;
    if (draft.smsMatchTypeThreshold !== settings.smsMatchTypeThreshold)
      body.smsMatchTypeThreshold = draft.smsMatchTypeThreshold;

    const dailyCap = Number(draft.smsDailyCap);
    const monthlyCap = Number(draft.smsMonthlyCap);
    if (!Number.isInteger(dailyCap) || dailyCap < 0) {
      setError('Денний ліміт: ціле число ≥ 0');
      return;
    }
    if (!Number.isInteger(monthlyCap) || monthlyCap < 0) {
      setError('Місячний ліміт: ціле число ≥ 0');
      return;
    }
    if (dailyCap !== settings.smsDailyCap) body.smsDailyCap = dailyCap;
    if (monthlyCap !== settings.smsMonthlyCap) body.smsMonthlyCap = monthlyCap;

    const sender = draft.turboSmsSender.trim();
    if (sender !== (settings.turboSmsSender ?? '')) body.turboSmsSender = sender || null;
    if (tokenInput.trim()) body.turboSmsToken = tokenInput.trim();

    if (Object.keys(body).length === 0) {
      setSuccess('Немає змін');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await apiClient.updateNotificationSettings(body);
      setSettings(updated);
      setDraft(toDraft(updated));
      setTokenInput('');
      setSuccess('Збережено');
      const u = await apiClient.getNotificationSettingsUsage().catch(() => null);
      setUsage(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти');
    } finally {
      setSaving(false);
    }
  }, [settings, draft, tokenInput]);

  if (loading || !draft || !settings) {
    return (
      <div className="tab-content">
        {error && <Alert variant="error">{error}</Alert>}
        {!error && <p>Завантаження…</p>}
      </div>
    );
  }

  const credsMissing = !settings.hasToken || !settings.turboSmsSender;

  return (
    <div className="tab-content notif-settings">
      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <h2>Сповіщення та платний SMS-фолбек</h2>
      <p className="notif-hint">
        SMS шлеться лише коли безкоштовні канали (Telegram-бот і особистий акаунт) не
        дійшли. Усі зміни діють без редеплою (до ~30 c на кеш).
      </p>

      {credsMissing && (
        <Alert variant="warning">
          Не заповнені реквізити TurboSMS (токен та/або альфа-ім’я відправника) — платні
          відправки не працюватимуть, доки їх не додати нижче.
        </Alert>
      )}

      <section className="notif-block">
        <label className="notif-check notif-master">
          <input
            type="checkbox"
            checked={draft.smsFallbackEnabled}
            onChange={(e) => patch({ smsFallbackEnabled: e.target.checked })}
          />
          <span>
            <b>Головний вимикач платного SMS</b> — зніміть, якщо бачите, що витрачається
            бюджет
          </span>
        </label>
      </section>

      <section className="notif-block">
        <h3>Де застосовувати платний фолбек</h3>
        <label className="notif-check">
          <input
            type="checkbox"
            checked={draft.smsMatchEnabled}
            onChange={(e) => patch({ smsMatchEnabled: e.target.checked })}
          />
          <span>Сповіщення про збіг пари водій ↔ пасажир</span>
        </label>
        <label className="notif-check">
          <input
            type="checkbox"
            checked={draft.smsAuthorConfirmationEnabled}
            onChange={(e) => patch({ smsAuthorConfirmationEnabled: e.target.checked })}
          />
          <span>Підтвердження автору щойно створеного оголошення</span>
        </label>
        <label className="notif-check">
          <input
            type="checkbox"
            checked={draft.smsBookingReminderEnabled}
            onChange={(e) => patch({ smsBookingReminderEnabled: e.target.checked })}
          />
          <span>Нагадування про бронювання (для тих, хто не в боті / заблокував)</span>
        </label>
        <label className="notif-check">
          <input
            type="checkbox"
            checked={draft.smsInactivityReminderEnabled}
            onChange={(e) => patch({ smsInactivityReminderEnabled: e.target.checked })}
          />
          <span>Реактивація неактивних / заблокували бота (кнопка «Нагадати їм»)</span>
        </label>
      </section>

      <section className="notif-block">
        <h3>Поріг для збігів</h3>
        <Select
          label="Платний SMS про збіг слати для"
          value={draft.smsMatchTypeThreshold}
          onChange={(e) =>
            patch({ smsMatchTypeThreshold: e.target.value as SmsMatchTypeThreshold })
          }
          options={THRESHOLD_OPTIONS}
        />
      </section>

      <section className="notif-block notif-grid">
        <Input
          label="Денний ліміт відправок"
          type="number"
          min={0}
          value={draft.smsDailyCap}
          onChange={(e) => patch({ smsDailyCap: e.target.value })}
        />
        <Input
          label="Місячний ліміт відправок"
          type="number"
          min={0}
          value={draft.smsMonthlyCap}
          onChange={(e) => patch({ smsMonthlyCap: e.target.value })}
        />
      </section>

      <section className="notif-block notif-grid">
        <Input
          label="TurboSMS: альфа-ім’я відправника"
          value={draft.turboSmsSender}
          maxLength={11}
          placeholder="напр. Malyn"
          onChange={(e) => patch({ turboSmsSender: e.target.value })}
        />
        <Input
          label="TurboSMS: токен API"
          type="password"
          value={tokenInput}
          placeholder={
            settings.hasToken
              ? `Збережено (${settings.tokenHint ?? '••••'}). Порожнє — не змінювати`
              : 'Вставте токен TurboSMS'
          }
          onChange={(e) => setTokenInput(e.target.value)}
        />
      </section>

      <div className="notif-actions">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? 'Збереження…' : 'Зберегти'}
        </Button>
        <Button variant="secondary" onClick={() => void load()} disabled={saving}>
          Скинути
        </Button>
      </div>

      {usage && (
        <section className="notif-block notif-usage">
          <h3>Витрати</h3>
          <p>
            Сьогодні: <b>{usage.sentToday}</b> / {usage.capToday} · цього місяця:{' '}
            <b>{usage.sentThisMonth}</b> / {usage.capThisMonth}
          </p>
          {usage.recent.length > 0 && (
            <table className="notif-table">
              <thead>
                <tr>
                  <th>Час</th>
                  <th>Телефон</th>
                  <th>Сценарій</th>
                  <th>Статус</th>
                  <th>Сегм.</th>
                </tr>
              </thead>
              <tbody>
                {usage.recent.map((row) => (
                  <tr key={row.id} className={row.status === 'failed' ? 'notif-row-failed' : ''}>
                    <td>{new Date(row.createdAt).toLocaleString('uk-UA')}</td>
                    <td>{formatPhoneDisplay(row.phoneNormalized)}</td>
                    <td>{USE_CASE_LABEL[row.useCase] ?? row.useCase}</td>
                    <td>
                      {row.status}
                      {row.errorText ? ` — ${row.errorText}` : ''}
                    </td>
                    <td>{row.segments ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
};
