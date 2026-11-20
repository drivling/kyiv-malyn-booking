import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
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
import { AdminSectionHeader, AdminSectionNav, ChipGroup, EmptyState, StatTile, StatTiles, StatusPill } from '../kit';
import { PersonCard } from './PersonCard';
import { ProofCard, ProofDetailModal } from './ProofViews';
import {
  budgetShare,
  earnedUah,
  filterBalances,
  filterProofs,
  inviteStatus,
  isReferralSection,
  isSelfReferralFlag,
  moderationProofs,
  payoutFilterCounts,
  personLabel,
  proofFilterCounts,
  REFERRAL_ADMIN_BASE,
  referralSections,
  rewardTypeLabel,
  uah,
  type PayoutFilter,
  type ProofFilter,
} from './referralText';
import '../SchedulesTab.css';
import './ReferralTab.css';

type ModalState =
  | { kind: 'payout'; row: ReferralPayoutPersonRow }
  | { kind: 'reject'; proof: RideCompletionProofRow }
  | { kind: 'flag'; rewardId: number }
  | null;

const INVITES_PAGE_SIZE = 30;
const PROOF_HASH = '#referral-proof-';

const INVITE_FILTERS = [
  { value: '', label: 'Усі' },
  { value: 'pending', label: 'Чекають' },
  { value: 'registered', label: 'Зареєструвались' },
  { value: 'blocked_self_referral', label: 'Само-реферал' },
];

const scrollToProof = (proofId: number): boolean => {
  const el = document.getElementById(`referral-proof-${proofId}`);
  if (!el) return false;
  el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  el.classList.add('referral-proof-card--flash');
  window.setTimeout(() => el.classList.remove('referral-proof-card--flash'), 1600);
  return true;
};

/**
 * Вкладка «Реферали» (`/admin/referrals/<розділ>`): угорі — один ряд плиток (до виплати, фото чекають, підозри,
 * виплачено, бюджет, запрошено), під ними розділи з власними адресами: «Виплати» (бюджет, черга людей, пошук,
 * картка людини), «Фото» (модерація заявок), «Підозри» (заморожені нагороди, спільні Telegram-акаунти),
 * «Запрошення». Логіка та сама, що була: ті самі запити й ті самі вікна підтвердження.
 */
export const ReferralTab: React.FC<{ section?: string }> = ({ section = '' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [report, setReport] = useState<AdminReferralReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [payoutFilter, setPayoutFilter] = useState<PayoutFilter>('payable');
  const [proofFilter, setProofFilter] = useState<ProofFilter>('all');
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

  const [personSearchHits, setPersonSearchHits] = useState<ReferralPersonSearchHit[] | null>(null);
  const [personSearchBusy, setPersonSearchBusy] = useState(false);
  const [proofDetailId, setProofDetailId] = useState<number | null>(null);

  const loadInvites = useCallback(async (skip: number, status: string) => {
    setInvitesLoading(true);
    try {
      const page = await apiClient.getReferralInvites({ skip, take: INVITES_PAGE_SIZE, status: status || undefined });
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
      setInvitesStatus('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshPerson = useCallback(async (personId: number | null) => {
    if (!personId) return;
    setPersonDetails(await apiClient.getPersonReferralDetails(personId));
  }, []);

  const openPersonDetails = useCallback(
    async (personId: number) => {
      if (expandedPersonId === personId) {
        setExpandedPersonId(null);
        setPersonDetails(null);
        return;
      }
      setExpandedPersonId(personId);
      setPersonDetails(null);
      setPersonDetailsLoading(true);
      try {
        setPersonDetails(await apiClient.getPersonReferralDetails(personId));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не вдалося завантажити деталі');
        setExpandedPersonId(null);
      } finally {
        setPersonDetailsLoading(false);
      }
    },
    [expandedPersonId]
  );

  const closePerson = () => {
    setExpandedPersonId(null);
    setPersonDetails(null);
  };

  const balances = useMemo(() => report?.payoutBalances ?? [], [report]);
  const payoutCounts = useMemo(() => payoutFilterCounts(balances), [balances]);
  const shownBalances = useMemo(() => filterBalances(balances, { query: search, filter: payoutFilter }), [balances, search, payoutFilter]);
  const proofs = useMemo(() => report?.promoPhotoProofs ?? [], [report]);
  const proofCounts = useMemo(() => proofFilterCounts(proofs), [proofs]);
  const shownProofs = useMemo(() => filterProofs(proofs, proofFilter), [proofs, proofFilter]);
  const moderationIds = useMemo(() => new Set(moderationProofs(proofs).map((p) => p.id)), [proofs]);
  const flagged = useMemo(() => report?.flagged ?? [], [report]);
  const selfReferral = useMemo(() => flagged.filter((r) => isSelfReferralFlag(r.flagReason)), [flagged]);
  const selfReferralUah = selfReferral.reduce((s, r) => s + r.amountUah, 0);
  const sharedGroups = report?.sharedTelegramGroups ?? [];
  const warnLimit = report?.summary.personWarnLimitUah ?? 200;

  // Перехід із вікна заявки: /admin/referrals/photos#referral-proof-12 — показати й підсвітити картку
  useEffect(() => {
    if (section !== 'photos' || !report || !location.hash.startsWith(PROOF_HASH)) return;
    const id = Number(location.hash.slice(PROOF_HASH.length));
    if (Number.isFinite(id)) window.setTimeout(() => scrollToProof(id), 50);
  }, [section, report, location.hash]);

  // Інший розділ — картка людини з попереднього закривається (її відкривають там, де вона потрібна)
  useEffect(() => {
    setExpandedPersonId(null);
    setPersonDetails(null);
  }, [section]);

  // Esc закриває збільшене фото
  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxUrl]);

  if (!isReferralSection(section)) return <Navigate to={REFERRAL_ADMIN_BASE} replace />;

  const openModal = (next: ModalState, preset = '') => {
    setModal(next);
    setModalText(preset);
  };

  const closeModal = () => {
    if (modalBusy) return;
    setModal(null);
    setModalText('');
  };

  const setRewardStatus = async (id: number, status: string, extra?: { flagReason?: string | null }) => {
    setBusyRewardId(id);
    setError('');
    try {
      await apiClient.patchReferralReward(id, { status, ...extra });
      setSuccess(status === 'approved' ? `Нагороду #${id} схвалено — вона в черзі виплат` : `Нагороду #${id} позначено підозрою`);
      await load();
      await refreshPerson(expandedPersonId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка оновлення нагороди');
    } finally {
      setBusyRewardId(null);
    }
  };

  const setProofStatus = async (id: number, status: string, rejectionReason?: string) => {
    setBusyProofId(id);
    setError('');
    try {
      await apiClient.patchRideProof(id, { status, ...(rejectionReason !== undefined ? { rejectionReason } : {}) });
      setSuccess(
        status === 'approved'
          ? `Заявку #${id} схвалено. Отримувачам надіслано суми до виплати в бот (якщо chat є). При блоці бота їх невиплачені бонуси → підозра.`
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
        const result = await apiClient.markReferralPayout({ personId: modal.row.personId, rewardIds: modal.row.rewardIds, note: text });
        setSuccess(`Виплату позначено: ${uah(result.amountUah)} (${result.updatedCount} нагород)`);
        setModal(null);
        setModalText('');
        await load();
        if (expandedPersonId === modal.row.personId) await refreshPerson(modal.row.personId);
      } else if (modal.kind === 'reject') {
        await setProofStatus(modal.proof.id, 'rejected', text || 'Фото відхилено модератором');
        setModal(null);
        setModalText('');
      } else {
        await setRewardStatus(modal.rewardId, 'flagged', { flagReason: text || 'Підозріла активність' });
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

  const undoPayout = async (rewardId: number) => {
    setUndoingRewardId(rewardId);
    setError('');
    setSuccess('');
    try {
      const result = await apiClient.undoReferralPayout([rewardId]);
      setSuccess(`Виплату скасовано: ${uah(result.amountUah)} (нагорода #${rewardId})`);
      await load();
      await refreshPerson(expandedPersonId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося скасувати виплату');
    } finally {
      setUndoingRewardId(null);
    }
  };

  const saveBudget = async () => {
    const value = Number(budgetInput.trim());
    if (!budgetInput.trim() || !Number.isInteger(value) || value < 0) {
      setError('Бюджет має бути цілим числом у гривнях');
      return;
    }
    setBudgetSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await apiClient.setReferralBudget(value);
      setSuccess(
        `Бюджет акції: ${uah(result.budgetUah)}` +
          (result.releasedCount > 0
            ? `. Знято з утримання ${result.releasedCount} нагород на ${uah(result.releasedUah)} — тепер чекають схвалення фото.`
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
      setSuccess(result.unlocked > 0 ? `Синхронізовано: ${result.unlocked} нагород переведено в чергу виплат` : 'Немає нагород для синхронізації');
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

  const confirmSelfReferral = (id: number, amountUah: number | null, who: string | null, friend: string | null) =>
    window.confirm(
      `Нагорода #${id}${amountUah != null ? ` на ${uah(amountUah)}` : ''} позначена як само-реферал.\n\n` +
        (who && friend ? `Отримувач: ${who}\nЗапрошений: ${friend}\n\n` : '') +
        'Обидва номери привʼязані до одного Telegram-акаунта.\n' +
        'Схвалити й поставити в чергу виплат?'
    );

  const approveFlaggedReward = async (r: ReferralRewardRow) => {
    if (isSelfReferralFlag(r.flagReason) && !confirmSelfReferral(r.id, r.amountUah, personLabel(r.referrer), personLabel(r.referredPerson))) return;
    await setRewardStatus(r.id, 'approved');
  };

  const runPersonSearch = async () => {
    const q = search.trim();
    if (q.length < 2) return;
    setPersonSearchBusy(true);
    setError('');
    try {
      setPersonSearchHits((await apiClient.searchReferralPersons(q)).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Пошук не вдався');
    } finally {
      setPersonSearchBusy(false);
    }
  };

  if (loading && !report) {
    return (
      <div className="tab-content referral-tab">
        <p>Завантаження реферальної програми…</p>
      </div>
    );
  }

  const s = report?.summary;
  const budget = report?.budget;
  const pendingReview = proofCounts.pending_review;
  const personCardProps = {
    busyRewardId,
    undoingRewardId,
    onApprove: (id: number, flagReason: string | null) => {
      if (isSelfReferralFlag(flagReason) && !confirmSelfReferral(id, null, null, null)) return;
      void setRewardStatus(id, 'approved');
    },
    onFlag: (id: number, reason?: string | null) => openModal({ kind: 'flag', rewardId: id }, reason || ''),
    onUndo: (id: number) => void undoPayout(id),
    onOpenPerson: (id: number) => void openPersonDetails(id),
    onOpenProof: setProofDetailId,
  };
  // Картка людини окремо — коли її рядка немає в показаній черзі (відкрили з пошуку, підозр чи з іншої картки)
  const personInline = section === '' && expandedPersonId != null && shownBalances.some((r) => r.personId === expandedPersonId);
  const standaloneCard = expandedPersonId != null && !personInline && (
    <section className="referral-card-standalone" aria-label="Картка людини">
      <div className="referral-card-standalone__head">
        <h3>Картка людини</h3>
        <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={closePerson}>
          Закрити
        </button>
      </div>
      {personDetailsLoading || !personDetails ? <p>Завантаження…</p> : <PersonCard details={personDetails} {...personCardProps} />}
    </section>
  );

  const invitesPage = Math.floor(invitesSkip / INVITES_PAGE_SIZE) + 1;
  const invitesPages = Math.max(1, Math.ceil(invitesTotal / INVITES_PAGE_SIZE));

  return (
    <div className="tab-content referral-tab">
      <AdminSectionHeader
        title="Реферали"
        purpose="Бонуси за запрошених друзів: хто чекає грошей, які фото поїздок підтвердити, що схоже на обман."
        actions={
          <>
            <button
              type="button"
              className="admin-kit-btn admin-kit-btn--quiet"
              onClick={() => void syncApproved()}
              disabled={syncing || loading}
              title="Перевести в чергу виплат нагороди за вже схваленими фото"
            >
              {syncing ? 'Синхронізація…' : 'Синхронізувати схвалені'}
            </button>
            <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void downloadCsv()} disabled={csvBusy}>
              {csvBusy ? 'CSV…' : 'CSV виплат'}
            </button>
            <button type="button" className="admin-kit-btn" onClick={() => void load()} disabled={loading}>
              Оновити
            </button>
          </>
        }
      />

      {s && budget && (
        <StatTiles label="Підсумки реферальної програми">
          <StatTile label="До виплати" value={uah(s.payableUah)} sub={`людей ${s.payablePeopleCount}`} tone={s.payableUah > 0 ? 'warn' : 'default'} to={section ? REFERRAL_ADMIN_BASE : undefined} />
          <StatTile
            label="Фото чекають"
            value={pendingReview}
            sub={`утримано ${uah(s.onHoldUah)}`}
            tone={pendingReview > 0 ? 'warn' : 'default'}
            to={section !== 'photos' ? `${REFERRAL_ADMIN_BASE}/photos` : undefined}
          />
          <StatTile
            label="Підозри"
            value={uah(s.flaggedUah)}
            sub={`нагород ${s.flaggedCount}${selfReferral.length ? ` · само-реферал ${selfReferral.length}` : ''}`}
            tone={selfReferral.length || s.sharedTelegramGroupCount ? 'error' : s.flaggedCount ? 'warn' : 'default'}
            to={section !== 'suspicious' ? `${REFERRAL_ADMIN_BASE}/suspicious` : undefined}
          />
          <StatTile label="Виплачено" value={uah(s.paidUah)} sub={`нагород ${s.paidCount}`} />
          <StatTile
            label="Бюджет: лишилось"
            value={uah(budget.remainingUah)}
            sub={`з ${uah(budget.budgetUah)}${budget.budgetHeldCount ? ` · утримано ${budget.budgetHeldCount}` : ''}`}
            tone={budget.exceeded || budget.budgetHeldCount > 0 ? 'error' : budgetShare(budget) >= 0.9 ? 'warn' : 'default'}
          />
          <StatTile
            label="Запрошено друзів"
            value={s.referredPersonsCount}
            sub={`запрошень ${report!.invites.total}`}
            to={section !== 'invites' ? `${REFERRAL_ADMIN_BASE}/invites` : undefined}
          />
        </StatTiles>
      )}

      <AdminSectionNav
        base={REFERRAL_ADMIN_BASE}
        sections={referralSections({ photos: pendingReview, suspicious: flagged.length })}
        label="Розділи «Реферали»"
      />

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {standaloneCard}

      {section === '' && report && budget && (
        <>
          <section className="referral-budget" aria-label="Бюджет акції">
            <div className="referral-budget__text">
              <strong>Бюджет акції:</strong> витрачено {uah(budget.committedUah)} з {uah(budget.budgetUah)}, лишилось{' '}
              {uah(budget.remainingUah)}
              <span className="referral-muted"> · понад бюджет нагороди йдуть на утримання, схвалення фото їх не розморожує</span>
            </div>
            <div
              className={`referral-budget__bar${budget.exceeded || budget.budgetHeldCount ? ' is-over' : ''}`}
              role="meter"
              aria-label="Витрачено бюджету"
              aria-valuemin={0}
              aria-valuemax={budget.budgetUah}
              aria-valuenow={Math.min(budget.committedUah, budget.budgetUah)}
            >
              <span style={{ width: `${Math.round(budgetShare(budget) * 100)}%` }} />
            </div>
            <form
              className="referral-budget__form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveBudget();
              }}
            >
              <label>
                Загальний бюджет, грн
                <input inputMode="numeric" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)} placeholder="4000" />
              </label>
              <button type="submit" className="admin-kit-btn" disabled={budgetSaving || budgetInput.trim() === String(budget.budgetUah)}>
                {budgetSaving ? 'Збереження…' : 'Зберегти'}
              </button>
            </form>
            {budget.budgetHeldCount > 0 && (
              <p className="sched-flag referral-flag--error referral-budget__held">
                Через вичерпаний бюджет утримано {budget.budgetHeldCount} нагород на {uah(budget.budgetHeldUah)} — підніміть
                бюджет, і ті, що вкладуться, повернуться в чергу модерації
              </p>
            )}
          </section>

          <section className="referral-queue" aria-labelledby="referral-queue-title">
            <div className="referral-queue__head">
              <h3 id="referral-queue-title">Черга виплат</h3>
              <span className="referral-muted">платимо людям, а не окремим нагородам; підозри не платимо</span>
            </div>
            <div className="referral-toolbar">
              <ChipGroup
                label="Які отримувачі"
                value={payoutFilter}
                onChange={setPayoutFilter}
                options={[
                  { value: 'payable', label: `До виплати ${payoutCounts.payable}` },
                  { value: 'flagged', label: `З підозрою ${payoutCounts.flagged}` },
                  { value: 'all', label: `Усі ${payoutCounts.all}` },
                  { value: 'paid_only', label: `Уже отримували ${payoutCounts.paid_only}` },
                ]}
              />
              <input
                type="search"
                className="referral-search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPersonSearchHits(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runPersonSearch();
                }}
                placeholder="Телефон, імʼя або @нік"
                aria-label="Пошук людини"
              />
            </div>

            {shownBalances.length === 0 ? (
              <EmptyState
                action={
                  payoutFilter !== 'all' ? (
                    <button type="button" className="admin-kit-linkbtn" onClick={() => setPayoutFilter('all')}>
                      Показати всіх з нагородами
                    </button>
                  ) : undefined
                }
              >
                {payoutFilter === 'payable' && !search.trim()
                  ? s!.onHoldCount > 0
                    ? `Платити зараз нікому — ${uah(s!.onHoldUah)} чекають схвалення фото.`
                    : s!.flaggedCount > 0
                      ? `Платити зараз нікому — є ${s!.flaggedCount} підозрілих нагород.`
                      : 'Платити зараз нікому: нагороди ще не нараховані або вже виплачені.'
                  : 'У черзі нікого за цим фільтром.'}
              </EmptyState>
            ) : (
              <ul className="referral-rows" aria-label="Отримувачі">
                {shownBalances.map((row) => {
                  const open = expandedPersonId === row.personId;
                  const earned = earnedUah(row);
                  return (
                    <li key={row.personId} className={`referral-payee${open ? ' is-open' : ''}`}>
                      <div className="referral-payee__row">
                        <button
                          type="button"
                          className="referral-payee__who"
                          aria-expanded={open}
                          onClick={() => void openPersonDetails(row.personId)}
                        >
                          <span className="referral-payee__name">
                            {open ? '▾' : '▸'} {row.fullName || '—'}
                          </span>
                          <span className="referral-muted">
                            {formatPhoneDisplay(row.phoneNormalized)}
                            {row.telegramUsername ? ` · @${row.telegramUsername}` : ''}
                          </span>
                        </button>
                        <span className="referral-payee__sum">
                          <strong>{uah(row.payableUah)}</strong>
                          {row.payableCount > 0 && <span className="referral-muted"> · нагород {row.payableCount}</span>}
                        </span>
                        <span className="sched-tags referral-payee__tags">
                          {row.holdUah > 0 && (
                            <span className="sched-tag" title="Фото ще не схвалені — платити не можна">
                              на перевірці {uah(row.holdUah)}
                            </span>
                          )}
                          {row.paidUah > 0 && <span className="sched-tag">виплачено {uah(row.paidUah)}</span>}
                          {row.flaggedUah > 0 && <span className="sched-flag referral-flag--error">підозра {uah(row.flaggedUah)}</span>}
                          {earned >= warnLimit && <span className="sched-flag">усього {uah(earned)} — перевірте</span>}
                        </span>
                        <button
                          type="button"
                          className="admin-kit-btn referral-payee__pay"
                          disabled={row.payableUah <= 0 || payingPersonId === row.personId}
                          onClick={() => openModal({ kind: 'payout', row })}
                        >
                          {payingPersonId === row.personId ? '…' : 'Виплатив'}
                        </button>
                      </div>
                      {open && (
                        <div className="referral-payee__card">
                          {personDetailsLoading || !personDetails || personDetails.person.id !== row.personId ? (
                            <p>Завантаження…</p>
                          ) : (
                            <PersonCard details={personDetails} {...personCardProps} />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {search.trim().length >= 2 && (
              <div className="referral-people-search">
                <button type="button" className="admin-kit-linkbtn" onClick={() => void runPersonSearch()} disabled={personSearchBusy}>
                  {personSearchBusy ? 'Шукаю…' : `Шукати «${search.trim()}» серед усіх людей (і запрошених)`}
                </button>
                {personSearchHits && personSearchHits.length === 0 && <p className="referral-muted">Нікого не знайдено.</p>}
                {personSearchHits && personSearchHits.length > 0 && (
                  <ul className="referral-rows" aria-label="Знайдені люди">
                    {personSearchHits.map((hit) => (
                      <li key={hit.id} className="referral-hit">
                        <span>
                          <strong>{hit.fullName || '—'}</strong>
                          <span className="referral-muted">
                            {' '}
                            · {formatPhoneDisplay(hit.phoneNormalized)}
                            {hit.telegramUsername ? ` · @${hit.telegramUsername}` : ''}
                          </span>
                        </span>
                        <span className="referral-muted">
                          привів: {hit.referredByPerson ? personLabel(hit.referredByPerson) : '—'} · запросила {hit._count.referredPersons} ·
                          нагород {hit._count.referralRewards}
                        </span>
                        <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void openPersonDetails(hit.id)}>
                          {expandedPersonId === hit.id ? 'Сховати' : 'Картка'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {section === 'photos' && report && (
        <section className="referral-photos" aria-labelledby="referral-photos-title">
          <div className="referral-queue__head">
            <h3 id="referral-photos-title">Фото поїздок</h3>
            <span className="referral-muted">
              схвалене фото переводить нагороди в чергу виплат; відхилене — людина отримає причину в бот і зможе надіслати знову
              (/confirmride)
            </span>
          </div>
          <ChipGroup
            label="Які заявки"
            value={proofFilter}
            onChange={setProofFilter}
            options={[
              { value: 'all', label: `Усі ${proofCounts.all}` },
              { value: 'pending_review', label: `На перевірці ${proofCounts.pending_review}` },
              { value: 'flagged', label: `Підозра ${proofCounts.flagged}` },
              { value: 'rejected', label: `Відхилені ${proofCounts.rejected}` },
            ]}
          />
          {shownProofs.length === 0 ? (
            <EmptyState>Заявок, що чекають рішення, немає.</EmptyState>
          ) : (
            <div className="referral-proof-grid">
              {shownProofs.map((p) => (
                <ProofCard
                  key={p.id}
                  proof={p}
                  busy={busyProofId === p.id}
                  onOpenPhoto={setLightboxUrl}
                  onApprove={() => void setProofStatus(p.id, 'approved')}
                  onReject={() => openModal({ kind: 'reject', proof: p }, p.flagReason || 'Фото не підтверджує поїздку')}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {section === 'suspicious' && report && (
        <>
          <section className="referral-queue" aria-labelledby="referral-flagged-title">
            <div className="referral-queue__head">
              <h3 id="referral-flagged-title">Підозрілі нагороди</h3>
              <span className="referral-muted">заморожені: не платимо, доки не схвалите тут</span>
            </div>
            {selfReferral.length > 0 && (
              <Alert variant="error">
                <strong>
                  Само-реферал: {selfReferral.length} нагород на {uah(selfReferralUah)}.
                </strong>{' '}
                Людина запросила свій же другий номер з того самого Telegram-акаунта. Схвалення фото їх <strong>не</strong>{' '}
                розморозить — рішення лише тут.
              </Alert>
            )}
            {flagged.length === 0 ? (
              <EmptyState>Підозрілих нагород немає.</EmptyState>
            ) : (
              <ul className="referral-rows" aria-label="Підозрілі нагороди">
                {flagged.map((r) => {
                  const self = isSelfReferralFlag(r.flagReason);
                  return (
                    <li key={r.id} className={`referral-flagged${self ? ' is-fraud' : ''}`}>
                      <span className="referral-reward__id">#{r.id}</span>
                      <span className="referral-flagged__what">
                        <strong>{uah(r.amountUah)}</strong> {rewardTypeLabel(r.rewardType)} →{' '}
                        <button type="button" className="admin-kit-linkbtn" onClick={() => void openPersonDetails(r.referrer.id)}>
                          {personLabel(r.referrer)}
                        </button>
                        <span className="referral-muted">
                          {' '}
                          · друг{' '}
                          <button type="button" className="admin-kit-linkbtn" onClick={() => void openPersonDetails(r.referredPerson.id)}>
                            {personLabel(r.referredPerson)}
                          </button>
                        </span>
                        {r.rideProof?.id ? (
                          <>
                            {' · '}
                            <button type="button" className="admin-kit-linkbtn" onClick={() => setProofDetailId(r.rideProof!.id)}>
                              заявка #{r.rideProof.id}
                            </button>
                          </>
                        ) : null}
                        <span className={`referral-reward__note${self ? ' referral-reward__note--error' : ''}`}>
                          {self ? 'Само-реферал: той самий Telegram-акаунт' : r.flagReason || 'причину не вказано'}
                        </span>
                      </span>
                      <button type="button" className="admin-kit-btn" disabled={busyRewardId === r.id} onClick={() => void approveFlaggedReward(r)}>
                        Схвалити
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="referral-queue" aria-labelledby="referral-shared-title">
            <div className="referral-queue__head">
              <h3 id="referral-shared-title">Спільні Telegram-акаунти</h3>
              <span className="referral-muted">кілька людей з одним chatId / userId — типовий слід само-реферала</span>
            </div>
            {sharedGroups.length === 0 ? (
              <EmptyState>Людей зі спільним Telegram-акаунтом немає.</EmptyState>
            ) : (
              <ul className="referral-rows" aria-label="Спільні Telegram-акаунти">
                {sharedGroups.map((g) => (
                  <li key={g.key} className={`referral-shared${g.selfReferralPairs.length ? ' is-fraud' : ''}`}>
                    <span className="referral-shared__people">
                      {g.persons.map((p, i) => (
                        <React.Fragment key={p.id}>
                          {i > 0 ? ' · ' : ''}
                          <button type="button" className="admin-kit-linkbtn" onClick={() => void openPersonDetails(p.id)}>
                            {personLabel(p)}
                          </button>
                          {p.telegramUsername ? <span className="referral-muted"> @{p.telegramUsername}</span> : null}
                        </React.Fragment>
                      ))}
                      <span className="referral-reward__note">{g.key}</span>
                    </span>
                    <span className="sched-tags">
                      <span className="sched-tag">невиплачено {uah(g.unpaidUah)}</span>
                      {g.selfReferralPairs.length > 0 && (
                        <span className="sched-flag referral-flag--error">само-реферал: пар {g.selfReferralPairs.length}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {section === 'invites' && report && (
        <section className="referral-queue" aria-labelledby="referral-invites-title">
          <div className="referral-queue__head">
            <h3 id="referral-invites-title">Запрошення</h3>
            <span className="referral-muted">
              {invitesLoading ? 'Завантаження…' : `${invitesTotal} за фільтром · стор. ${invitesPage} з ${invitesPages}`}
            </span>
          </div>
          <div className="referral-toolbar">
            <ChipGroup
              label="Стан запрошення"
              value={invitesStatus}
              onChange={(next) => {
                setInvitesStatus(next);
                void loadInvites(0, next);
              }}
              options={INVITE_FILTERS}
            />
            <span className="referral-pager">
              <button
                type="button"
                className="admin-kit-btn admin-kit-btn--quiet"
                disabled={invitesLoading || invitesSkip <= 0}
                onClick={() => void loadInvites(Math.max(0, invitesSkip - INVITES_PAGE_SIZE), invitesStatus)}
              >
                ← Назад
              </button>
              <button
                type="button"
                className="admin-kit-btn admin-kit-btn--quiet"
                disabled={invitesLoading || invitesSkip + INVITES_PAGE_SIZE >= invitesTotal}
                onClick={() => void loadInvites(invitesSkip + INVITES_PAGE_SIZE, invitesStatus)}
              >
                Далі →
              </button>
            </span>
          </div>
          {invites.length === 0 ? (
            <EmptyState>Запрошень за цим фільтром немає.</EmptyState>
          ) : (
            <ul className="referral-rows" aria-label="Запрошення">
              {invites.map((inv) => {
                const st = inviteStatus(inv.status);
                return (
                  <li key={inv.id} className="referral-invite">
                    <span className="referral-invite__date">{String(inv.createdAt).slice(0, 10)}</span>
                    <span className="referral-invite__who">
                      {personLabel(inv.referrer)} → <strong>{inv.inviteContact}</strong>
                      {inv.referredPerson && inv.referredPerson.fullName ? (
                        <span className="referral-muted"> ({inv.referredPerson.fullName})</span>
                      ) : null}
                    </span>
                    <StatusPill tone={st.tone}>{st.label}</StatusPill>
                    <span className="referral-muted">
                      {inv.registrationBonusEligible === false ? 'без 10 грн — уже був у базі' : '10 грн за реєстрацію'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {lightboxUrl && (
        <div className="referral-lightbox" role="dialog" aria-modal="true" aria-label="Перегляд фото" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Фото підтвердження" />
        </div>
      )}

      {proofDetailId != null && (
        <ProofDetailModal
          proofId={proofDetailId}
          cachedProofs={proofs}
          onClose={() => setProofDetailId(null)}
          onOpenPhoto={setLightboxUrl}
          onShowInList={
            moderationIds.has(proofDetailId)
              ? () => {
                  const id = proofDetailId;
                  setProofDetailId(null);
                  setProofFilter('all');
                  navigate(`${REFERRAL_ADMIN_BASE}/photos${PROOF_HASH}${id}`);
                }
              : undefined
          }
        />
      )}

      {modal && (
        <div
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
          role="dialog"
          aria-modal="true"
          aria-label={modal.kind === 'payout' ? 'Нотатка виплати' : modal.kind === 'reject' ? 'Відхилити фото' : 'Позначити підозрою'}
        >
          <div className="modal-content" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>
                {modal.kind === 'payout' && 'Нотатка виплати'}
                {modal.kind === 'reject' && `Відхилити фото #${modal.proof.id}`}
                {modal.kind === 'flag' && `Підозра: нагорода #${modal.rewardId}`}
              </h3>
              <button type="button" className="close-btn" onClick={closeModal} disabled={modalBusy} aria-label="Закрити">
                ×
              </button>
            </div>
            <div className="modal-body">
              {modal.kind === 'payout' && (
                <p style={{ marginTop: 0, color: 'var(--pb-text-muted)' }}>
                  Виплата <strong>{uah(modal.row.payableUah)}</strong> → {personLabel(modal.row)}. Опишіть, куди перевели / яке
                  поповнення.
                </p>
              )}
              {modal.kind === 'reject' && (
                <p style={{ marginTop: 0, color: 'var(--pb-text-muted)' }}>Причина потрапить у повідомлення користувачу і на повʼязані нагороди.</p>
              )}
              <label className="referral-modal-label">
                {modal.kind === 'payout' ? 'Нотатка (обовʼязково)' : 'Причина'}
                <textarea
                  value={modalText}
                  onChange={(e) => setModalText(e.target.value)}
                  rows={4}
                  placeholder={
                    modal.kind === 'payout' ? 'напр. Київстар ****1952, 05.08' : modal.kind === 'reject' ? 'Фото не підтверджує поїздку' : 'Підозріла активність'
                  }
                  autoFocus
                />
              </label>
            </div>
            <div className="modal-footer referral-modal-footer">
              <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={closeModal} disabled={modalBusy}>
                Скасувати
              </button>
              <button type="button" className="admin-kit-btn" onClick={() => void confirmModal()} disabled={modalBusy}>
                {modalBusy ? '…' : modal.kind === 'payout' ? 'Підтвердити виплату' : modal.kind === 'reject' ? 'Відхилити' : 'Позначити підозрою'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
