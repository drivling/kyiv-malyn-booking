import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { formatPhoneDisplay } from '@/utils/constants';
import type { NotificationSettings, NotificationSettingsPatch, NotificationSettingsUsage, SendTally, SmsMatchTypeThreshold } from '@/types';
import { AdminSectionHeader, EmptyState, StatTile, StatTiles, StatusPill, type StatusTone } from './kit';
import './SchedulesTab.css';
import './NotificationSettingsTab.css';

const THRESHOLD_OPTIONS: Array<{ value: SmsMatchTypeThreshold; label: string }> = [
  { value: 'exact', label: 'лише точні (±45 хв)' },
  { value: 'exact_approximate', label: 'точні й приблизні (±2 год)' },
  { value: 'all', label: 'усі, разом із «того ж дня»' },
];

const USE_CASE_LABEL: Record<string, string> = {
  match: 'збіг пари',
  authorConfirmation: 'підтвердження автору',
  bookingReminder: 'нагадування',
  inactivityReminder: 'реактивація',
  channelPromo: 'реклама каналу',
};

const SMS_SCENARIOS: Array<{ key: keyof NotificationSettings & `sms${string}Enabled`; useCase: string; label: string; help: string }> = [
  { key: 'smsMatchEnabled', useCase: 'match', label: 'Збіг пари водій ↔ пасажир', help: 'Коли ні бот, ні особистий акаунт не дійшли. Поріг — нижче.' },
  { key: 'smsAuthorConfirmationEnabled', useCase: 'authorConfirmation', label: 'Підтвердження автору оголошення', help: 'Щойно створене оголошення, автор недосяжний у Telegram.' },
  { key: 'smsBookingReminderEnabled', useCase: 'bookingReminder', label: 'Нагадування про бронювання', help: 'Для тих, хто не в боті або заблокував його.' },
  { key: 'smsInactivityReminderEnabled', useCase: 'inactivityReminder', label: 'Реактивація', help: 'Кнопка «Нагадати їм» — неактивним і тим, хто заблокував бота.' },
  { key: 'smsChannelPromoEnabled', useCase: 'channelPromo', label: 'Реклама каналу', help: 'Сторінка /admin/promo — тим, до кого не достукались.' },
];

const CONTACT_TYPE: Record<string, string> = { phone: 'за номером', username: 'за @username', user_id: 'за id' };

const kyivTime = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** «цього місяця: 5 дійшло · 2 ні» */
function tallyText(t: SendTally | undefined, word = 'дійшло'): string {
  if (!t || (t.sent === 0 && t.failed === 0)) return 'цього місяця — жодного';
  return `цього місяця: ${t.sent} ${word}${t.failed ? ` · ${t.failed} ні` : ''}`;
}

/** Один рядок налаштування: що це й навіщо ліворуч, керування праворуч, під ним — скільки вже надіслано */
const Row: React.FC<{ id: string; label: string; help: React.ReactNode; control: React.ReactNode; meta?: React.ReactNode; muted?: boolean }> = ({ id, label, help, control, meta, muted }) => (
  <div className={`admin-kit-setting${muted ? ' is-locked' : ''}`}>
    <div className="admin-kit-setting-text">
      <label htmlFor={id}>{label}</label>
      <p id={`${id}-help`}>{help}</p>
    </div>
    <div className="admin-kit-setting-control">
      {control}
      {meta ? <p className="admin-kit-setting-source">{meta}</p> : null}
    </div>
  </div>
);

const Switch: React.FC<{ id: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }> = ({ id, checked, disabled, onChange }) => (
  <span className="admin-kit-switch">
    <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={`${id}-help`} />
    <span aria-hidden="true">{checked ? 'Увімкнено' : 'Вимкнено'}</span>
  </span>
);

/** Поле з кнопкою «Зберегти», активною лише коли значення змінилось і правильне */
const FieldForm: React.FC<{
  id: string;
  value: string;
  type?: 'number' | 'text' | 'password';
  placeholder?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  unit?: string;
  busy?: boolean;
  onSave: (v: string) => Promise<boolean>;
}> = ({ id, value, type = 'number', placeholder, maxLength, min = 0, max, unit, busy, onSave }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const valid = type !== 'number' || (/^\d+$/.test(text) && Number(text) >= min && (max == null || Number(text) <= max));
  const changed = draft != null && text !== value && (type !== 'password' || text.trim() !== '');
  return (
    <form
      className="admin-kit-setting-form notif-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed && valid) void onSave(text).then((ok) => ok && setDraft(null));
      }}
    >
      <input
        id={id}
        type={type}
        inputMode={type === 'number' ? 'numeric' : undefined}
        min={type === 'number' ? min : undefined}
        max={type === 'number' ? max : undefined}
        maxLength={maxLength}
        placeholder={placeholder}
        value={text}
        autoComplete={type === 'password' ? 'off' : undefined}
        onChange={(e) => setDraft(e.target.value)}
        aria-invalid={!valid}
        aria-describedby={`${id}-help`}
      />
      {unit ? <span className="admin-kit-setting-unit">{unit}</span> : null}
      <button type="submit" className="admin-kit-btn" disabled={busy || !changed || !valid}>
        Зберегти
      </button>
    </form>
  );
};

function statusOfUser(u: NotificationSettingsUsage['telegramUser'], s: NotificationSettings): { tone: StatusTone; text: string } {
  if (u && !u.configured) return { tone: 'error', text: 'немає сесії' };
  if (u?.byId.flooded) return { tone: 'warn', text: 'Telegram обмежив (PEER_FLOOD)' };
  if (!s.tgUserMatchEnabled && !s.tgUserAuthorConfirmationEnabled) return { tone: 'off', text: 'вимкнено' };
  return { tone: 'ok', text: 'працює' };
}

function statusOfSms(s: NotificationSettings): { tone: StatusTone; text: string } {
  if (!s.smsFallbackEnabled) return { tone: 'off', text: 'вимкнено' };
  if (!s.hasToken || !s.turboSmsSender) return { tone: 'error', text: 'немає реквізитів TurboSMS' };
  return { tone: 'ok', text: 'увімкнено' };
}

/**
 * «Сповіщення» (/admin/notifications): кому й як доходять повідомлення про поїздки, коли бот не дійшов. Спершу
 * особистий Telegram-акаунт (безкоштовно; збіги пар, підтвердження автору, листи незнайомим за id з добовим лімітом),
 * потім платний SMS (TurboSMS: головний вимикач, сценарії, поріг, ліміти, реквізити). Біля кожного вимикача —
 * скільки цього місяця вже пішло; вимикачі зберігаються одразу, поля — кнопкою. Діє за ~30 с, без редеплою.
 */
export const NotificationSettingsTab: React.FC = () => {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [usage, setUsage] = useState<NotificationSettingsUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const loadUsage = useCallback(async () => setUsage(await apiClient.getNotificationSettingsUsage().catch(() => null)), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, u] = await Promise.all([apiClient.getNotificationSettings(), apiClient.getNotificationSettingsUsage().catch(() => null)]);
      setSettings(s);
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

  const save = useCallback(
    async (patch: NotificationSettingsPatch, what: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      setSaved(null);
      try {
        setSettings(await apiClient.updateNotificationSettings(patch));
        setSaved(`Збережено: ${what}. Діє за ~30 с.`);
        void loadUsage();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не вдалося зберегти');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [loadUsage],
  );

  if (loading || !settings) {
    return (
      <div className="tab-content notif-tab">
        {error ? <Alert variant="error">{error}</Alert> : <p aria-live="polite">Завантаження…</p>}
      </div>
    );
  }

  const s = settings;
  const tg = usage?.telegramUser;
  const userStatus = statusOfUser(tg, s);
  const smsStatus = statusOfSms(s);
  const smsDayShare = usage && usage.capToday ? usage.sentToday / usage.capToday : 0;
  const promoMonth = tg ? (tg.byPurpose.promo?.sent ?? 0) + (tg.byPurpose.other?.sent ?? 0) : 0;
  const idCapChanged = s.tgUserByIdDailyCap != null;

  return (
    <div className="tab-content notif-tab">
      <AdminSectionHeader
        title="Сповіщення"
        purpose="Коли бот не дійшов до людини: спершу особистий Telegram-акаунт (безкоштовно), потім платний SMS. Зміни діють за ~30 с, без редеплою."
        actions={
          <button type="button" className="admin-kit-chip" onClick={() => void load()} disabled={busy}>
            Оновити
          </button>
        }
      />

      {error ? <Alert variant="error">{error}</Alert> : null}
      {saved ? (
        <p className="notif-saved" role="status">
          {saved}
        </p>
      ) : null}

      <p className="notif-status">
        <span>
          Особистий акаунт: <StatusPill tone={userStatus.tone}>{userStatus.text}</StatusPill>
        </span>
        <span>
          SMS: <StatusPill tone={smsStatus.tone}>{smsStatus.text}</StatusPill>
        </span>
      </p>

      <StatTiles label="Відправки">
        <StatTile label="Особистий акаунт сьогодні" value={tg?.today.sent ?? '—'} sub={tg?.today.failed ? `не дійшло ${tg.today.failed}` : undefined} />
        <StatTile label="Особистий акаунт за місяць" value={tg?.month.sent ?? '—'} sub={tg?.month.failed ? `не дійшло ${tg.month.failed}` : undefined} />
        <StatTile label="SMS сьогодні" value={usage?.sentToday ?? '—'} sub={usage ? `з ${usage.capToday}` : undefined} tone={smsDayShare >= 1 ? 'error' : smsDayShare >= 0.8 ? 'warn' : 'default'} />
        <StatTile label="SMS за місяць" value={usage?.sentThisMonth ?? '—'} sub={usage ? `з ${usage.capThisMonth}` : undefined} />
      </StatTiles>

      <section className="admin-kit-settings" aria-label="Особистий Telegram-акаунт">
        <h3>1. Особистий Telegram-акаунт · безкоштовно</h3>
        {tg && !tg.configured ? (
          <p className="notif-warn">На сервері немає сесії особистого акаунта — ці вимикачі зараз нічого не змінюють.</p>
        ) : null}
        <Row
          id="tg-match"
          label="Збіги пар водій ↔ пасажир"
          help="Пасажиру — про водія, водію — про пасажира, коли бот не дійшов. Вимкнено — одразу SMS (якщо дозволено)."
          control={<Switch id="tg-match" checked={s.tgUserMatchEnabled} disabled={busy} onChange={(v) => void save({ tgUserMatchEnabled: v }, 'збіги пар')} />}
          meta={tallyText(tg?.byPurpose.match)}
        />
        <Row
          id="tg-confirm"
          label="Підтвердження автору оголошення"
          help="Автор щойно опублікованої попутки отримує «оголошення на сайті» з посиланням на бота."
          control={<Switch id="tg-confirm" checked={s.tgUserAuthorConfirmationEnabled} disabled={busy} onChange={(v) => void save({ tgUserAuthorConfirmationEnabled: v }, 'підтвердження автору')} />}
          meta={tallyText(tg?.byPurpose.authorConfirmation)}
        />
        <Row
          id="tg-byid"
          label="Писати незнайомим за id"
          help="Автор без номера й @username, якого бачили в групі. Одна сесія на все (Джура, обіди): скарги на спам → обмеження акаунта."
          muted={Boolean(tg?.byId.lockedBy)}
          control={<Switch id="tg-byid" checked={tg ? tg.byId.enabled : s.tgUserByIdEnabled} disabled={busy || Boolean(tg?.byId.lockedBy)} onChange={(v) => void save({ tgUserByIdEnabled: v }, 'листи за id')} />}
          meta={
            tg?.byId.lockedBy ? (
              `Вимкнено на сервері (${tg.byId.lockedBy}) — тут не ввімкнути.`
            ) : tg ? (
              <>
                сьогодні {tg.byId.usedToday} з {tg.byId.cap}
                {tg.byId.flooded ? <strong className="notif-flag">PEER_FLOOD — до кінця доби не пишемо</strong> : null}
              </>
            ) : null
          }
        />
        <Row
          id="tg-bycap"
          label="Скільки листів за id на добу"
          help="Рахується від київської півночі; лічильник живе в памʼяті сервера й обнуляється після деплою."
          control={
            <FieldForm
              id="tg-bycap"
              value={String(tg?.byId.cap ?? s.tgUserByIdDailyCap ?? 20)}
              min={0}
              max={200}
              unit="на добу"
              busy={busy}
              onSave={(v) => save({ tgUserByIdDailyCap: Number(v) }, 'ліміт листів за id')}
            />
          }
          meta={
            idCapChanged ? (
              <>
                змінено, типове — {tg?.byId.defaultCap ?? 20}
                <button type="button" className="admin-kit-linkbtn" disabled={busy} onClick={() => void save({ tgUserByIdDailyCap: null }, 'ліміт листів за id')}>
                  Скинути до типового
                </button>
              </>
            ) : (
              `типове: ${tg?.byId.defaultCap ?? 20}`
            )
          }
        />
        <p className="notif-foot">
          Розсилки з адмінки (промо, реактивація) йдуть тим самим акаунтом{tg ? ` — цього місяця ${promoMonth}` : ''}; ними керують їхні сторінки.
        </p>
        {tg?.recentErrors.length ? (
          <div className="notif-errors">
            <h4>Останні помилки акаунта</h4>
            <ul>
              {tg.recentErrors.map((e) => (
                <li key={e.id}>
                  <span className="sched-note">{kyivTime(e.createdAt)}</span> <span className="sched-tag">{CONTACT_TYPE[e.contactType] ?? e.contactType}</span>{' '}
                  <code>{e.errorText || `код ${e.errorCode}`}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="admin-kit-settings" aria-label="Платні SMS">
        <h3>2. Платні SMS · TurboSMS</h3>
        <Row
          id="sms-master"
          label="Головний вимикач SMS"
          help="Вимкніть, якщо бачите, що витрачається бюджет: жоден сценарій нижче тоді не шле SMS."
          control={<Switch id="sms-master" checked={s.smsFallbackEnabled} disabled={busy} onChange={(v) => void save({ smsFallbackEnabled: v }, 'головний вимикач SMS')} />}
          meta={usage ? `сьогодні ${usage.sentToday} з ${usage.capToday} · місяць ${usage.sentThisMonth} з ${usage.capThisMonth}` : null}
        />
        {SMS_SCENARIOS.map((sc) => (
          <Row
            key={sc.key}
            id={`sms-${sc.useCase}`}
            label={sc.label}
            help={sc.help}
            muted={!s.smsFallbackEnabled}
            control={<Switch id={`sms-${sc.useCase}`} checked={s[sc.key]} disabled={busy} onChange={(v) => void save({ [sc.key]: v }, sc.label.toLowerCase())} />}
            meta={
              <>
                {tallyText(usage?.smsByUseCase?.[sc.useCase], 'надіслано')}
                {!s.smsFallbackEnabled && s[sc.key] ? <span>не діє: головний вимикач вимкнено</span> : null}
              </>
            }
          />
        ))}
        <Row
          id="sms-threshold"
          label="Поріг для збігів"
          help="Для яких збігів пари слати платний SMS."
          control={
            <select
              id="sms-threshold"
              className="notif-select"
              value={s.smsMatchTypeThreshold}
              disabled={busy}
              aria-describedby="sms-threshold-help"
              onChange={(e) => void save({ smsMatchTypeThreshold: e.target.value as SmsMatchTypeThreshold }, 'поріг для збігів')}
            >
              {THRESHOLD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          }
        />
        <Row
          id="sms-day"
          label="Ліміт на добу"
          help="Більше за добу (Київ) SMS не піде, хоч би що сталося."
          control={<FieldForm id="sms-day" value={String(s.smsDailyCap)} max={100000} unit="SMS" busy={busy} onSave={(v) => save({ smsDailyCap: Number(v) }, 'ліміт на добу')} />}
        />
        <Row
          id="sms-month"
          label="Ліміт на місяць"
          help="Захист бюджету на календарний місяць."
          control={<FieldForm id="sms-month" value={String(s.smsMonthlyCap)} max={100000} unit="SMS" busy={busy} onSave={(v) => save({ smsMonthlyCap: Number(v) }, 'ліміт на місяць')} />}
        />
        <Row
          id="sms-sender"
          label="Відправник (альфа-імʼя)"
          help="Зареєстроване в TurboSMS імʼя, до 11 символів."
          muted={!s.turboSmsSender}
          control={<FieldForm id="sms-sender" type="text" value={s.turboSmsSender ?? ''} maxLength={11} placeholder="напр. Malyn" busy={busy} onSave={(v) => save({ turboSmsSender: v.trim() || null }, 'відправник')} />}
          meta={s.turboSmsSender ? null : <strong className="notif-flag">не задано — SMS не підуть</strong>}
        />
        <Row
          id="sms-token"
          label="Токен API TurboSMS"
          help="Зберігається на сервері, сюди не повертається."
          muted={!s.hasToken}
          control={
            <FieldForm
              id="sms-token"
              type="password"
              value=""
              placeholder={s.hasToken ? `збережено (${s.tokenHint ?? '••••'})` : 'вставте токен'}
              busy={busy}
              onSave={(v) => save({ turboSmsToken: v.trim() }, 'токен TurboSMS')}
            />
          }
          meta={s.hasToken ? `збережено: ${s.tokenHint ?? '••••'}` : <strong className="notif-flag">не задано — SMS не підуть</strong>}
        />
      </section>

      <section className="sched-group" aria-label="Останні SMS">
        <header className="sched-group-head">
          <h3>Останні SMS</h3>
          <span className="sched-note">20 найновіших</span>
        </header>
        {!usage?.recent.length ? (
          <EmptyState>SMS ще не надсилали.</EmptyState>
        ) : (
          <ul className="sched-rows">
            {usage.recent.map((r) => (
              <li key={r.id} className={`sched-row notif-sms-row${r.status === 'failed' ? ' is-failed' : ''}`}>
                <span className="sched-note">{kyivTime(r.createdAt)}</span>
                <span>{formatPhoneDisplay(r.phoneNormalized)}</span>
                <span className="sched-tags">
                  <span className="sched-tag">{USE_CASE_LABEL[r.useCase] ?? r.useCase}</span>
                  {r.segments ? <span className="sched-note">{r.segments} сегм.</span> : null}
                  {r.errorText ? <small className="notif-error-text">{r.errorText}</small> : null}
                </span>
                <span className="sched-meta">
                  <StatusPill tone={r.status === 'sent' ? 'ok' : r.status === 'failed' ? 'error' : r.status === 'pending' ? 'busy' : 'off'}>
                    {r.status === 'sent' ? 'надіслано' : r.status === 'failed' ? 'помилка' : r.status === 'pending' ? 'в черзі' : 'пропущено'}
                  </StatusPill>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
