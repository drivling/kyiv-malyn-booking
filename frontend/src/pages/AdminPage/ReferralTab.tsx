import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { formatPhoneDisplay } from '@/utils/constants';
import type {
  AdminReferralReport,
  PersonReferralDetails,
  ReferralInviteRow,
  ReferralPayoutPersonRow,
  ReferralPersonSearchHit,
  ReferralRewardRow,
  RideCompletionProofRow,
} from '@/types';
import './ReferralTab.css';

const REWARD_TYPE_LABEL: Record<string, string> = {
  registration: 'Новий друг (10)',
  driver_qualified: 'Водій (40)',
  driver_first_listing: 'Водій (legacy)',
  passenger_completed_ride: 'Друг-пасажир (20)',
  passenger_self_confirm: 'Своє підтвердження (20)',
};

/** Має збігатися з SELF_REFERRAL_FLAG_REASON у backend/src/referral.ts */
const SELF_REFERRAL_FLAG_REASON =
  'Само-реферал: запрошення з того самого Telegram-акаунта — потрібна перевірка адміна';

const isSelfReferralFlag = (reason?: string | null): boolean => reason === SELF_REFERRAL_FLAG_REASON;

const REWARD_STATUS_LABEL: Record<string, string> = {
  hold: 'на перевірці',
  pending: 'на перевірці (legacy)',
  approved: 'до виплати',
  paid: 'виплачено',
  flagged: 'підозра',
};

type PayoutFilter = 'payable' | 'all' | 'paid_only' | 'flagged';

type ModalState =
  | { kind: 'payout'; row: ReferralPayoutPersonRow }
  | { kind: 'reject'; proof: RideCompletionProofRow }
  | { kind: 'flag'; rewardId: number; currentReason?: string | null }
  | null;

const INVITES_PAGE_SIZE = 30;

const ProofPhotoThumb: React.FC<{
  proofId: number;
  kind: 'start' | 'end';
  label: string;
  onOpen: (url: string) => void;
}> = ({ proofId, kind, label, onOpen }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setLoading(true);
    setError('');
    void apiClient
      .fetchRideProofPhotoObjectUrl(proofId, kind)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Не завантажилось');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [proofId, kind]);

  return (
    <button
      type="button"
      className="referral-proof-photo"
      onClick={() => {
        if (url) onOpen(url);
      }}
      disabled={!url}
      title={url ? 'Збільшити' : undefined}
    >
      {loading && <span className="referral-proof-photo__loading">Завантаження…</span>}
      {!loading && error && <span className="referral-proof-photo__err">{error}</span>}
      {!loading && url && (
        <>
          <img src={url} alt={label} />
          <span className="referral-proof-photo__label">{label}</span>
        </>
      )}
    </button>
  );
};

const scrollToProof = (proofId: number) => {
  const el = document.getElementById(`referral-proof-${proofId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('referral-proof-card--flash');
  window.setTimeout(() => el.classList.remove('referral-proof-card--flash'), 1600);
};

export const ReferralTab: React.FC = () => {
  const [report, setReport] = useState<AdminReferralReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [payoutFilter, setPayoutFilter] = useState<PayoutFilter>('payable');
  const [expandedPersonId, setExpandedPersonId] = useState<number | null>(null);
  const [personDetails, setPersonDetails] = useState<PersonReferralDetails | null>(null);
  const [personDetailsLoading, setPersonDetailsLoading] = useState(false);
  const [payingPersonId, setPayingPersonId] = useState<number | null>(null);
  const [busyProofId, setBusyProofId] = useState<number | null>(null);
  const [busyRewardId, setBusyRewardId] = useState<number | null>(null);
  const [undoingRewardId, setUndoingRewardId] = useState<number | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [modalText, setModalText] = useState('');
  const [modalBusy, setModalBusy] = useState(false);

  const [invites, setInvites] = useState<ReferralInviteRow[]>([]);
  const [invitesTotal, setInvitesTotal] = useState(0);
  const [invitesSkip, setInvitesSkip] = useState(0);
  const [invitesStatus, setInvitesStatus] = useState('');
  const [invitesLoading, setInvitesLoading] = useState(false);

  const [personSearch, setPersonSearch] = useState('');
  const [personSearchHits, setPersonSearchHits] = useState<ReferralPersonSearchHit[]>([]);
  const [personSearchBusy, setPersonSearchBusy] = useState(false);

  const loadInvites = useCallback(async (skip: number, status: string) => {
    setInvitesLoading(true);
    try {
      const page = await apiClient.getReferralInvites({
        skip,
        take: INVITES_PAGE_SIZE,
        status: status || undefined,
      });
      setInvites(page.items);
      setInvitesTotal(page.total);
      setInvitesSkip(page.skip);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося завантажити запрошення');
    } finally {
      setInvitesLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.getReferralReport();
      setReport(data);
      setBudgetInput(String(data.budget.budgetUah));
      setInvites(data.invites.items);
      setInvitesTotal(data.invites.total);
      setInvitesSkip(data.invites.skip);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openPersonDetails = useCallback(async (personId: number) => {
    if (expandedPersonId === personId) {
      setExpandedPersonId(null);
      setPersonDetails(null);
      return;
    }
    setExpandedPersonId(personId);
    setPersonDetails(null);
    setPersonDetailsLoading(true);
    try {
      const details = await apiClient.getPersonReferralDetails(personId);
      setPersonDetails(details);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося завантажити деталі');
      setExpandedPersonId(null);
    } finally {
      setPersonDetailsLoading(false);
    }
  }, [expandedPersonId]);

  const filteredBalances = useMemo(() => {
    if (!report) return [];
    const q = search.trim().toLowerCase().replace(/\D/g, '');
    const qText = search.trim().toLowerCase();
    return report.payoutBalances.filter((row) => {
      if (payoutFilter === 'payable' && row.payableUah <= 0) return false;
      if (payoutFilter === 'paid_only' && row.paidUah <= 0) return false;
      if (payoutFilter === 'flagged' && row.flaggedUah <= 0) return false;
      if (!qText) return true;
      const phone = row.phoneNormalized.toLowerCase();
      const name = (row.fullName || '').toLowerCase();
      const un = (row.telegramUsername || '').toLowerCase();
      if (q && phone.includes(q)) return true;
      return name.includes(qText) || un.includes(qText) || phone.includes(qText);
    });
  }, [report, search, payoutFilter]);

  const selfReferralFlagged = useMemo(
    () => (report?.flagged ?? []).filter((r) => isSelfReferralFlag(r.flagReason)),
    [report]
  );

  const selfReferralUah = useMemo(
    () => selfReferralFlagged.reduce((s, r) => s + r.amountUah, 0),
    [selfReferralFlagged]
  );

  const personWarnLimitUah = report?.summary.personWarnLimitUah ?? 200;

  const pendingProofs = useMemo(
    () =>
      (report?.promoPhotoProofs ?? []).filter(
        (p) => p.status === 'pending_review' || p.status === 'flagged' || p.status === 'rejected'
      ),
    [report]
  );

  const openModal = (next: ModalState, preset = '') => {
    setModal(next);
    setModalText(preset);
  };

  const closeModal = () => {
    if (modalBusy) return;
    setModal(null);
    setModalText('');
  };

  const confirmModal = async () => {
    if (!modal) return;
    const text = modalText.trim();
    setModalBusy(true);
    setError('');
    setSuccess('');
    try {
      if (modal.kind === 'payout') {
        if (!text) {
          setError('Нотатка до виплати обовʼязкова — як саме поповнили / куди перевели.');
          return;
        }
        setPayingPersonId(modal.row.personId);
        const result = await apiClient.markReferralPayout({
          personId: modal.row.personId,
          rewardIds: modal.row.rewardIds,
          note: text,
        });
        setSuccess(`Виплату позначено: ${result.amountUah} грн (${result.updatedCount} нагород)`);
        setModal(null);
        setModalText('');
        await load();
        if (expandedPersonId === modal.row.personId) {
          const details = await apiClient.getPersonReferralDetails(modal.row.personId);
          setPersonDetails(details);
        }
      } else if (modal.kind === 'reject') {
        await setProofStatus(
          modal.proof.id,
          'rejected',
          text || 'Фото відхилено модератором'
        );
        setModal(null);
        setModalText('');
      } else if (modal.kind === 'flag') {
        await setRewardStatus(modal.rewardId, 'flagged', {
          flagReason: text || 'Підозріла активність',
        });
        setModal(null);
        setModalText('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка');
    } finally {
      setModalBusy(false);
      setPayingPersonId(null);
    }
  };

  const setRewardStatus = async (
    id: number,
    status: string,
    extra?: { flagReason?: string | null }
  ) => {
    setBusyRewardId(id);
    setError('');
    try {
      await apiClient.patchReferralReward(id, { status, ...extra });
      setSuccess(`Нагороду #${id} → ${status}`);
      await load();
      if (expandedPersonId) {
        const details = await apiClient.getPersonReferralDetails(expandedPersonId);
        setPersonDetails(details);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка оновлення нагороди');
    } finally {
      setBusyRewardId(null);
    }
  };

  const undoPayout = async (rewardId: number) => {
    setUndoingRewardId(rewardId);
    setError('');
    setSuccess('');
    try {
      const result = await apiClient.undoReferralPayout([rewardId]);
      setSuccess(`Виплату скасовано: ${result.amountUah} грн (нагорода #${rewardId})`);
      await load();
      if (expandedPersonId) {
        const details = await apiClient.getPersonReferralDetails(expandedPersonId);
        setPersonDetails(details);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося скасувати виплату');
    } finally {
      setUndoingRewardId(null);
    }
  };

  const saveBudget = async () => {
    const value = Number(budgetInput.trim());
    if (!Number.isInteger(value) || value < 0) {
      setError('Бюджет має бути цілим числом у гривнях');
      return;
    }
    setBudgetSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await apiClient.setReferralBudget(value);
      setSuccess(
        `Бюджет акції: ${result.budgetUah} грн` +
          (result.releasedCount > 0
            ? `. Знято з утримання ${result.releasedCount} нагород на ${result.releasedUah} грн — тепер чекають схвалення фото.`
            : '')
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося змінити бюджет');
    } finally {
      setBudgetSaving(false);
    }
  };

  const syncApproved = async () => {
    setSyncing(true);
    setError('');
    setSuccess('');
    try {
      const result = await apiClient.syncReferralApproved();
      setSuccess(
        result.unlocked > 0
          ? `Синхронізовано: ${result.unlocked} нагород переведено в чергу виплат`
          : 'Немає нагород для синхронізації'
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося синхронізувати');
    } finally {
      setSyncing(false);
    }
  };

  const downloadCsv = async () => {
    setCsvBusy(true);
    setError('');
    try {
      const blob = await apiClient.downloadReferralPayoutsCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'referral-payouts.csv';
      a.click();
      URL.revokeObjectURL(url);
      setSuccess('CSV завантажено');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося завантажити CSV');
    } finally {
      setCsvBusy(false);
    }
  };

  const approveFlaggedReward = async (r: ReferralRewardRow) => {
    if (isSelfReferralFlag(r.flagReason)) {
      const who = r.referrer.fullName || formatPhoneDisplay(r.referrer.phoneNormalized);
      const friend = r.referredPerson.fullName || formatPhoneDisplay(r.referredPerson.phoneNormalized);
      const ok = window.confirm(
        `Нагорода #${r.id} на ${r.amountUah} грн позначена як само-реферал.\n\n` +
          `Отримувач: ${who}\nЗапрошений: ${friend}\n\n` +
          'Обидва номери привʼязані до одного Telegram-акаунта.\n' +
          'Схвалити й поставити в чергу виплат?'
      );
      if (!ok) return;
    }
    await setRewardStatus(r.id, 'approved');
  };

  const setProofStatus = async (id: number, status: string, rejectionReason?: string) => {
    setBusyProofId(id);
    setError('');
    try {
      await apiClient.patchRideProof(id, {
        status,
        ...(rejectionReason !== undefined ? { rejectionReason } : {}),
      });
      setSuccess(
        status === 'approved'
          ? `Заявку #${id} схвалено. Отримувачам надіслано суми до виплати в бот (якщо chat є). При блоці бота їх невиплачені бонуси → flagged.`
          : status === 'rejected'
            ? `Заявку #${id} відхилено — користувача сповіщено в бот (може знову надіслати фото через /confirmride).`
            : `Заявку #${id} → ${status}`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка оновлення фото');
    } finally {
      setBusyProofId(null);
    }
  };

  const runPersonSearch = async () => {
    const q = personSearch.trim();
    if (q.length < 2) {
      setPersonSearchHits([]);
      return;
    }
    setPersonSearchBusy(true);
    setError('');
    try {
      const result = await apiClient.searchReferralPersons(q);
      setPersonSearchHits(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Пошук не вдався');
    } finally {
      setPersonSearchBusy(false);
    }
  };

  if (loading && !report) {
    return (
      <div className="tab-content">
        <p>Завантаження реферальної програми…</p>
      </div>
    );
  }

  const s = report?.summary;
  const invitesPage = Math.floor(invitesSkip / INVITES_PAGE_SIZE) + 1;
  const invitesPages = Math.max(1, Math.ceil(invitesTotal / INVITES_PAGE_SIZE));

  return (
    <div className="tab-content">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0 }}>🎁 Реферали — виплати та контроль</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button type="button" variant="secondary" onClick={() => void syncApproved()} disabled={syncing || loading}>
            {syncing ? 'Синхронізація…' : 'Синхронізувати схвалені'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void downloadCsv()} disabled={csvBusy}>
            {csvBusy ? 'CSV…' : 'CSV виплат'}
          </Button>
          <Button type="button" onClick={() => void load()} disabled={loading}>
            Оновити
          </Button>
        </div>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {s && (
        <div className="stats">
          <div className="stat-card">
            <h3>До виплати</h3>
            <div className="stat-value">{s.payableUah} грн</div>
            <div style={{ fontSize: 13, color: 'var(--pb-text-muted)' }}>{s.payablePeopleCount} осіб</div>
          </div>
          <div className="stat-card">
            <h3>На перевірці фото</h3>
            <div className="stat-value">{s.onHoldUah} грн</div>
            <div style={{ fontSize: 13, color: 'var(--pb-text-muted)' }}>{s.onHoldCount} нагород</div>
          </div>
          <div className="stat-card">
            <h3>Уже виплачено</h3>
            <div className="stat-value">{s.paidUah} грн</div>
            <div style={{ fontSize: 13, color: 'var(--pb-text-muted)' }}>{s.paidCount} нагород</div>
          </div>
          <div className="stat-card">
            <h3>Підозри (flagged)</h3>
            <div className="stat-value">{s.flaggedUah} грн</div>
            <div style={{ fontSize: 13, color: 'var(--pb-text-muted)' }}>{s.flaggedCount} шт.</div>
          </div>
          <div className="stat-card">
            <h3>Запрошених друзів</h3>
            <div className="stat-value">{s.referredPersonsCount}</div>
          </div>
          {(s.sharedTelegramGroupCount ?? 0) > 0 && (
            <div className="stat-card">
              <h3>Спільні Telegram</h3>
              <div className="stat-value">{s.sharedTelegramGroupCount}</div>
              <div style={{ fontSize: 13, color: 'var(--pb-text-muted)' }}>груп акаунтів</div>
            </div>
          )}
        </div>
      )}

      {report?.budget && (
        <section style={{ marginTop: 28 }}>
          <h3>💰 Бюджет акції</h3>
          <p style={{ color: 'var(--pb-text-muted)', marginTop: 0 }}>
            Витрачено <strong>{report.budget.committedUah} грн</strong> із {report.budget.budgetUah} грн,
            лишилось {report.budget.remainingUah} грн. Понад бюджет нагороди створюються на утриманні —
            схвалення фото їх не розморожує.
          </p>
          {report.budget.budgetHeldCount > 0 && (
            <Alert variant="error">
              Через вичерпаний бюджет утримано {report.budget.budgetHeldCount} нагород на{' '}
              <strong>{report.budget.budgetHeldUah} грн</strong>. Підніміть бюджет — ті, що вкладуться,
              автоматично повернуться в звичайну чергу модерації.
            </Alert>
          )}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 200 }}>
              <Input
                label="Загальний бюджет, грн"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                placeholder="4000"
              />
            </div>
            <Button
              type="button"
              onClick={() => void saveBudget()}
              disabled={budgetSaving || budgetInput.trim() === String(report.budget.budgetUah)}
            >
              {budgetSaving ? 'Збереження…' : 'Зберегти бюджет'}
            </Button>
          </div>
        </section>
      )}

      {(report?.sharedTelegramGroups?.length ?? 0) > 0 && (
        <section style={{ marginTop: 28 }}>
          <h3>🚨 Спільні Telegram-акаунти</h3>
          <p style={{ color: 'var(--pb-text-muted)', marginTop: 0 }}>
            Кілька Person з одним chatId/userId — типовий слід само-реферала. Натисніть імʼя, щоб відкрити граф.
          </p>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Ключ</th>
                  <th>Люди</th>
                  <th>Невиплачено</th>
                  <th>Само-реферал?</th>
                </tr>
              </thead>
              <tbody>
                {report!.sharedTelegramGroups.map((g) => (
                  <tr key={g.key} className={g.selfReferralPairs.length > 0 ? 'referral-row--fraud' : undefined}>
                    <td style={{ fontSize: 12 }}>{g.key}</td>
                    <td>
                      {g.persons.map((p) => (
                        <div key={p.id}>
                          <button
                            type="button"
                            className="referral-link-btn"
                            onClick={() => void openPersonDetails(p.id)}
                          >
                            {p.fullName || formatPhoneDisplay(p.phoneNormalized)}
                          </button>
                          {p.telegramUsername ? (
                            <span style={{ fontSize: 12, color: 'var(--pb-text-muted)' }}> @{p.telegramUsername}</span>
                          ) : null}
                        </div>
                      ))}
                    </td>
                    <td>
                      <strong>{g.unpaidUah} грн</strong>
                    </td>
                    <td>{g.selfReferralPairs.length > 0 ? `так (${g.selfReferralPairs.length})` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section style={{ marginTop: 28 }}>
        <h3>🔍 Пошук людини (отримувач або запрошений)</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ minWidth: 240, flex: 1 }}>
            <Input
              label="Імʼя, телефон або @username"
              value={personSearch}
              onChange={(e) => setPersonSearch(e.target.value)}
              placeholder="напр. 38067… або Олена"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runPersonSearch();
              }}
            />
          </div>
          <Button type="button" onClick={() => void runPersonSearch()} disabled={personSearchBusy}>
            {personSearchBusy ? '…' : 'Знайти'}
          </Button>
        </div>
        {personSearchHits.length > 0 && (
          <div className="table-container" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Людина</th>
                  <th>Телефон</th>
                  <th>Хто привів</th>
                  <th>Запросила / нагород</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {personSearchHits.map((hit) => (
                  <tr key={hit.id}>
                    <td>
                      {hit.fullName || '—'}
                      {hit.telegramUsername ? (
                        <div style={{ fontSize: 12, color: 'var(--pb-text-muted)' }}>@{hit.telegramUsername}</div>
                      ) : null}
                    </td>
                    <td>{formatPhoneDisplay(hit.phoneNormalized)}</td>
                    <td>
                      {hit.referredByPerson
                        ? hit.referredByPerson.fullName ||
                          formatPhoneDisplay(hit.referredByPerson.phoneNormalized)
                        : '—'}
                    </td>
                    <td>
                      {hit._count.referredPersons} / {hit._count.referralRewards}
                    </td>
                    <td>
                      <Button type="button" variant="secondary" onClick={() => void openPersonDetails(hit.id)}>
                        Граф
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ marginTop: 28 }}>
        <h3>💳 Черга виплат</h3>
        <p style={{ color: 'var(--pb-text-muted)', marginTop: 0 }}>
          Платимо людям (не окремим рядкам). У «До виплати» потрапляє лише те, де фото вже схвалені.
          Колонка «На перевірці» — нараховано, але заявка ще не пройшла модерацію. Розкрийте рядок — там
          посилання на заявку з фото. Flagged не платимо.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, alignItems: 'flex-end' }}>
          <div style={{ minWidth: 200, flex: 1 }}>
            <Input
              label="Пошук у черзі"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="телефон або імʼя отримувача"
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Фільтр</label>
            <select
              value={payoutFilter}
              onChange={(e) => setPayoutFilter(e.target.value as PayoutFilter)}
              style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--pb-border)' }}
            >
              <option value="payable">Лише до виплати</option>
              <option value="flagged">З flagged сумою</option>
              <option value="all">Усі з нагородами</option>
              <option value="paid_only">Уже отримували виплату</option>
            </select>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Отримувач</th>
                <th>Телефон</th>
                <th>До виплати</th>
                <th>На перевірці</th>
                <th>Виплачено</th>
                <th>Flagged</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredBalances.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    {payoutFilter === 'payable' ? (
                      <span>
                        Немає сум <strong>до виплати</strong>
                        {(s?.onHoldCount ?? 0) > 0
                          ? ` — але ${s!.onHoldUah} грн чекають модерації фото.`
                          : (s?.flaggedCount ?? 0) > 0
                            ? ` — але є ${s!.flaggedCount} flagged нагород.`
                            : (s?.payableUah ?? 0) === 0
                              ? ' — нагороди ще не нараховані або вже виплачені.'
                              : '.'}{' '}
                        <button type="button" className="referral-link-btn" onClick={() => setPayoutFilter('all')}>
                          Показати всі з нагородами
                        </button>
                      </span>
                    ) : (
                      'Немає записів за фільтром'
                    )}
                  </td>
                </tr>
              )}
              {filteredBalances.map((row) => {
                const open = expandedPersonId === row.personId;
                const totalEarnedUah = row.paidUah + row.payableUah + row.holdUah;
                const overWarnLimit = totalEarnedUah >= personWarnLimitUah;
                return (
                  <React.Fragment key={row.personId}>
                    <tr className={overWarnLimit ? 'referral-row--watch' : undefined}>
                      <td>
                        <button
                          type="button"
                          onClick={() => void openPersonDetails(row.personId)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: 600,
                            color: 'var(--pb-primary)',
                            padding: 0,
                          }}
                        >
                          {open ? '▼' : '▶'} {row.fullName || '—'}
                        </button>
                        {row.telegramUsername ? (
                          <div style={{ fontSize: 12, color: 'var(--pb-text-muted)' }}>@{row.telegramUsername}</div>
                        ) : null}
                        {overWarnLimit && (
                          <div style={{ fontSize: 12, fontWeight: 600 }}>👀 усього {totalEarnedUah} грн — перевірте</div>
                        )}
                      </td>
                      <td>{formatPhoneDisplay(row.phoneNormalized)}</td>
                      <td>
                        <strong>{row.payableUah} грн</strong>
                        {row.payableCount > 0 ? (
                          <div style={{ fontSize: 12 }}>{row.payableCount} нагород</div>
                        ) : null}
                      </td>
                      <td>
                        {row.holdUah > 0 ? (
                          <span title="Фото ще не схвалені — платити не можна">
                            ⏳ {row.holdUah} грн
                            <div style={{ fontSize: 12 }}>{row.holdCount} нагород</div>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{row.paidUah} грн</td>
                      <td>{row.flaggedUah > 0 ? `${row.flaggedUah} грн` : '—'}</td>
                      <td>
                        <Button
                          type="button"
                          disabled={row.payableUah <= 0 || payingPersonId === row.personId}
                          onClick={() => openModal({ kind: 'payout', row })}
                        >
                          {payingPersonId === row.personId ? '…' : 'Виплатив'}
                        </Button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--pb-bg-secondary)' }}>
                          {personDetailsLoading && <p>Завантаження деталей…</p>}
                          {!personDetailsLoading && personDetails && personDetails.person.id === row.personId && (
                            <PersonDetailsPanel
                              details={personDetails}
                              busyRewardId={busyRewardId}
                              undoingRewardId={undoingRewardId}
                              onApprove={(id) => void setRewardStatus(id, 'approved')}
                              onFlag={(id, reason) =>
                                openModal({ kind: 'flag', rewardId: id, currentReason: reason }, reason || '')
                              }
                              onUndo={(id) => void undoPayout(id)}
                              onOpenPerson={(id) => void openPersonDetails(id)}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {expandedPersonId &&
        personDetails &&
        !filteredBalances.some((r) => r.personId === expandedPersonId) && (
          <section style={{ marginTop: 28 }}>
            <h3>👤 Картка людини #{expandedPersonId}</h3>
            {personDetailsLoading ? (
              <p>Завантаження…</p>
            ) : (
              <PersonDetailsPanel
                details={personDetails}
                busyRewardId={busyRewardId}
                undoingRewardId={undoingRewardId}
                onApprove={(id) => void setRewardStatus(id, 'approved')}
                onFlag={(id, reason) =>
                  openModal({ kind: 'flag', rewardId: id, currentReason: reason }, reason || '')
                }
                onUndo={(id) => void undoPayout(id)}
                onOpenPerson={(id) => void openPersonDetails(id)}
              />
            )}
          </section>
        )}

      <section style={{ marginTop: 36 }}>
        <h3>📷 Фото підтверджень (модерація)</h3>
        <p style={{ color: 'var(--pb-text-muted)', marginTop: 0 }}>
          Після двох фото бот просить викласти пост у Facebook. Схваліть (нагороди у виплату) або відхиліть із
          причиною — користувач отримає повідомлення в бот і зможе знову надіслати фото через /confirmride.
        </p>
        {pendingProofs.length === 0 ? (
          <p style={{ color: 'var(--pb-text-muted)' }}>Немає заявок на перевірці.</p>
        ) : (
          <div className="referral-proof-grid">
            {pendingProofs.map((p) => {
              const rewards = p.referralRewards ?? [];
              const rewardSum = rewards.reduce((sum, r) => sum + r.amountUah, 0);
              const isFlagged = p.status === 'flagged';
              const isRejected = p.status === 'rejected';
              return (
                <article
                  key={p.id}
                  id={`referral-proof-${p.id}`}
                  className={`referral-proof-card${isFlagged ? ' is-flagged' : ''}${isRejected ? ' is-rejected' : ''}`}
                >
                  <div className="referral-proof-card__head">
                    <div>
                      <h4 className="referral-proof-card__title">
                        #{p.id} · {p.person.fullName || 'Без імені'}
                      </h4>
                      <p className="referral-proof-card__meta">
                        {formatPhoneDisplay(p.person.phoneNormalized)}
                        {p.person.telegramUsername ? ` · @${p.person.telegramUsername}` : ''}
                        <br />
                        {p.route} · {String(p.rideDate).slice(0, 10)}
                        {p.departureTime ? ` · ${p.departureTime}` : ''}
                      </p>
                    </div>
                    <span
                      className={`referral-proof-badge ${
                        isRejected
                          ? 'referral-proof-badge--rejected'
                          : isFlagged
                            ? 'referral-proof-badge--flagged'
                            : 'referral-proof-badge--pending'
                      }`}
                    >
                      {p.status}
                    </span>
                  </div>

                  {(p.flagReason || p.rejectionReason) && (
                    <p className={`referral-proof-reason${isRejected ? ' is-rejected' : ''}`}>
                      <strong>
                        {isRejected ? 'Відхилено: ' : isFlagged ? 'Чому flagged: ' : 'Причина: '}
                      </strong>
                      {p.rejectionReason || p.flagReason}
                    </p>
                  )}

                  <div className="referral-proof-photos">
                    <ProofPhotoThumb proofId={p.id} kind="start" label="1️⃣ Старт" onOpen={setLightboxUrl} />
                    <ProofPhotoThumb proofId={p.id} kind="end" label="2️⃣ Прибуття" onOpen={setLightboxUrl} />
                  </div>

                  {rewards.length > 0 ? (
                    <ul className="referral-proof-rewards">
                      <li>
                        <strong>Нагороди по цій заявці:</strong> {rewardSum} грн
                      </li>
                      {rewards.map((r) => (
                        <li key={r.id}>
                          #{r.id} {REWARD_TYPE_LABEL[r.rewardType] || r.rewardType} →{' '}
                          {r.referrer.fullName || formatPhoneDisplay(r.referrer.phoneNormalized)} · {r.amountUah} грн ·{' '}
                          {r.status}
                          {r.flagReason ? ` (${r.flagReason})` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="referral-proof-card__meta">Немає привʼязаних нагород (або ще не нараховані).</p>
                  )}

                  <div className="referral-proof-actions">
                    <Button
                      type="button"
                      disabled={busyProofId === p.id}
                      onClick={() => void setProofStatus(p.id, 'approved')}
                    >
                      {busyProofId === p.id
                        ? '…'
                        : isRejected
                          ? 'Перепогодити → у виплату'
                          : 'Схвалити → у виплату'}
                    </Button>
                    {!isRejected && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busyProofId === p.id}
                        onClick={() =>
                          openModal(
                            { kind: 'reject', proof: p },
                            p.flagReason || 'Фото не підтверджує поїздку'
                          )
                        }
                      >
                        Відхилити
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {lightboxUrl && (
        <div
          className="referral-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Перегляд фото"
          onClick={() => setLightboxUrl(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setLightboxUrl(null);
          }}
        >
          <img src={lightboxUrl} alt="Фото підтвердження" />
        </div>
      )}

      {(report?.flagged?.length ?? 0) > 0 && (
        <section style={{ marginTop: 36 }}>
          <h3>🚩 Підозрілі нагороди</h3>
          {selfReferralFlagged.length > 0 && (
            <Alert variant="error">
              <strong>
                Само-реферал: {selfReferralFlagged.length} нагород на {selfReferralUah} грн.
              </strong>{' '}
              Людина запросила свій же другий номер з того самого Telegram-акаунта. Схвалення фото їх{' '}
              <strong>не</strong> розморозить — рішення лише тут.
            </Alert>
          )}
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Кому</th>
                  <th>Тип</th>
                  <th>Сума</th>
                  <th>Причина</th>
                  <th>Фото</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {report!.flagged.map((r) => {
                  const selfReferral = isSelfReferralFlag(r.flagReason);
                  return (
                    <tr key={r.id} className={selfReferral ? 'referral-row--fraud' : undefined}>
                      <td>{r.id}</td>
                      <td>
                        {formatPhoneDisplay(r.referrer.phoneNormalized)}
                        {selfReferral && (
                          <div style={{ fontSize: 12 }}>
                            друг: {formatPhoneDisplay(r.referredPerson.phoneNormalized)}
                          </div>
                        )}
                      </td>
                      <td>{REWARD_TYPE_LABEL[r.rewardType] || r.rewardType}</td>
                      <td>{r.amountUah}</td>
                      <td style={{ fontSize: 12 }}>
                        {selfReferral ? <strong>🚨 Само-реферал</strong> : r.flagReason || '—'}
                      </td>
                      <td>
                        {r.rideProof?.id ? (
                          <button
                            type="button"
                            className="referral-link-btn"
                            onClick={() => scrollToProof(r.rideProof!.id)}
                          >
                            заявка #{r.rideProof.id}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <Button
                          type="button"
                          disabled={busyRewardId === r.id}
                          onClick={() => void approveFlaggedReward(r)}
                        >
                          Схвалити
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section style={{ marginTop: 36 }}>
        <h3>👥 Запрошення</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Статус</label>
            <select
              value={invitesStatus}
              onChange={(e) => {
                const next = e.target.value;
                setInvitesStatus(next);
                void loadInvites(0, next);
              }}
              style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--pb-border)' }}
            >
              <option value="">Усі</option>
              <option value="pending">pending</option>
              <option value="linked">linked</option>
              <option value="blocked_self_referral">blocked_self_referral</option>
              <option value="already_referred">already_referred</option>
            </select>
          </div>
          <span style={{ fontSize: 13, color: 'var(--pb-text-muted)', paddingBottom: 8 }}>
            {invitesLoading ? 'Завантаження…' : `${invitesTotal} усього · стор. ${invitesPage}/${invitesPages}`}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={invitesLoading || invitesSkip <= 0}
            onClick={() => void loadInvites(Math.max(0, invitesSkip - INVITES_PAGE_SIZE), invitesStatus)}
          >
            ← Назад
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={invitesLoading || invitesSkip + INVITES_PAGE_SIZE >= invitesTotal}
            onClick={() => void loadInvites(invitesSkip + INVITES_PAGE_SIZE, invitesStatus)}
          >
            Далі →
          </Button>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Від</th>
                <th>Контакт</th>
                <th>Статус</th>
                <th>10 грн?</th>
                <th>Дата</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.referrer.fullName || formatPhoneDisplay(inv.referrer.phoneNormalized)}</td>
                  <td>{inv.inviteContact}</td>
                  <td>{inv.status}</td>
                  <td>{inv.registrationBonusEligible === false ? 'ні (уже в базі)' : 'так'}</td>
                  <td>{String(inv.createdAt).slice(0, 10)}</td>
                </tr>
              ))}
              {invites.length === 0 && (
                <tr>
                  <td colSpan={5}>Немає запрошень</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modal && (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal-content" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>
                {modal.kind === 'payout' && 'Нотатка виплати'}
                {modal.kind === 'reject' && `Відхилити фото #${modal.proof.id}`}
                {modal.kind === 'flag' && `Flag нагороди #${modal.rewardId}`}
              </h3>
              <button type="button" className="close-btn" onClick={closeModal} disabled={modalBusy}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {modal.kind === 'payout' && (
                <p style={{ marginTop: 0, color: 'var(--pb-text-muted)' }}>
                  Виплата <strong>{modal.row.payableUah} грн</strong> →{' '}
                  {modal.row.fullName || formatPhoneDisplay(modal.row.phoneNormalized)}. Опишіть, куди
                  перевели / яке поповнення.
                </p>
              )}
              {modal.kind === 'reject' && (
                <p style={{ marginTop: 0, color: 'var(--pb-text-muted)' }}>
                  Причина потрапить у повідомлення користувачу і на повʼязані нагороди.
                </p>
              )}
              <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
                {modal.kind === 'payout' ? 'Нотатка (обовʼязково)' : 'Причина'}
              </label>
              <textarea
                value={modalText}
                onChange={(e) => setModalText(e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid var(--pb-border)',
                  font: 'inherit',
                  resize: 'vertical',
                }}
                placeholder={
                  modal.kind === 'payout'
                    ? 'напр. Київстар ****1952, 05.08'
                    : modal.kind === 'reject'
                      ? 'Фото не підтверджує поїздку'
                      : 'Підозріла активність'
                }
                autoFocus
              />
            </div>
            <div className="modal-footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button type="button" variant="secondary" onClick={closeModal} disabled={modalBusy}>
                Скасувати
              </Button>
              <Button type="button" onClick={() => void confirmModal()} disabled={modalBusy}>
                {modalBusy
                  ? '…'
                  : modal.kind === 'payout'
                    ? 'Підтвердити виплату'
                    : modal.kind === 'reject'
                      ? 'Відхилити'
                      : 'Поставити Flag'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PersonDetailsPanel: React.FC<{
  details: PersonReferralDetails;
  busyRewardId: number | null;
  undoingRewardId: number | null;
  onApprove: (id: number) => void;
  onFlag: (id: number, reason?: string | null) => void;
  onUndo: (id: number) => void;
  onOpenPerson: (id: number) => void;
}> = ({ details, busyRewardId, undoingRewardId, onApprove, onFlag, onUndo, onOpenPerson }) => {
  const { person, rewards, invitedPersons, sharedAccountPersons } = details;
  return (
    <div className="referral-person-panel">
      <div className="referral-person-panel__meta">
        <div>
          <strong>{person.fullName || '—'}</strong> · {formatPhoneDisplay(person.phoneNormalized)}
          {person.telegramUsername ? ` · @${person.telegramUsername}` : ''}
          {person.referralCode ? (
            <div style={{ fontSize: 12, color: 'var(--pb-text-muted)' }}>код: {person.referralCode}</div>
          ) : null}
        </div>
        <div style={{ fontSize: 13 }}>
          Хто привів:{' '}
          {person.referredByPerson ? (
            <button
              type="button"
              className="referral-link-btn"
              onClick={() => onOpenPerson(person.referredByPerson!.id)}
            >
              {person.referredByPerson.fullName ||
                formatPhoneDisplay(person.referredByPerson.phoneNormalized)}
            </button>
          ) : (
            '—'
          )}
        </div>
        {invitedPersons.length > 0 && (
          <div style={{ fontSize: 13 }}>
            Кого привела:{' '}
            {invitedPersons.map((p, i) => (
              <React.Fragment key={p.id}>
                {i > 0 ? ', ' : ''}
                <button type="button" className="referral-link-btn" onClick={() => onOpenPerson(p.id)}>
                  {p.fullName || formatPhoneDisplay(p.phoneNormalized)}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}
        {sharedAccountPersons.length > 0 && (
          <Alert variant="error">
            Той самий Telegram також у:{' '}
            {sharedAccountPersons.map((p) => formatPhoneDisplay(p.phoneNormalized)).join(', ')}
          </Alert>
        )}
      </div>

      <table style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>#</th>
            <th>Тип</th>
            <th>Сума</th>
            <th>Статус</th>
            <th>Друг</th>
            <th>Фото</th>
            <th>Нотатка</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rewards.length === 0 && (
            <tr>
              <td colSpan={8}>Немає нагород у цієї людини як у отримувача</td>
            </tr>
          )}
          {rewards.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{REWARD_TYPE_LABEL[r.rewardType] || r.rewardType}</td>
              <td>{r.amountUah}</td>
              <td>
                {REWARD_STATUS_LABEL[r.status] || r.status}
                {r.flagReason ? (
                  <div style={{ fontSize: 11, color: 'var(--pb-danger, #b42318)' }}>{r.flagReason}</div>
                ) : null}
              </td>
              <td>
                <button
                  type="button"
                  className="referral-link-btn"
                  onClick={() => onOpenPerson(r.referredPerson.id)}
                >
                  {r.referredPerson.fullName || formatPhoneDisplay(r.referredPerson.phoneNormalized)}
                </button>
              </td>
              <td>
                {r.rideProof?.id ? (
                  <button
                    type="button"
                    className="referral-link-btn"
                    onClick={() => scrollToProof(r.rideProof!.id)}
                    title={`${r.rideProof.route} · ${String(r.rideProof.rideDate).slice(0, 10)} · ${r.rideProof.status}`}
                  >
                    заявка #{r.rideProof.id}
                  </button>
                ) : (
                  '—'
                )}
              </td>
              <td style={{ fontSize: 12 }}>{r.payoutNote || '—'}</td>
              <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(r.status === 'flagged' || r.status === 'hold' || r.status === 'pending') && (
                  <Button
                    type="button"
                    disabled={busyRewardId === r.id}
                    onClick={() => onApprove(r.id)}
                  >
                    Схвалити
                  </Button>
                )}
                {(r.status === 'hold' || r.status === 'pending' || r.status === 'approved') && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busyRewardId === r.id}
                    onClick={() => onFlag(r.id, r.flagReason)}
                  >
                    Flag
                  </Button>
                )}
                {r.status === 'paid' && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={undoingRewardId === r.id}
                    onClick={() => onUndo(r.id)}
                    title="Повернути в чергу виплат (якщо натиснули «Виплатив» помилково)"
                  >
                    {undoingRewardId === r.id ? '…' : 'Скасувати виплату'}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
