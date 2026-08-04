import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { formatPhoneDisplay } from '@/utils/constants';
import type {
  AdminReferralReport,
  ReferralPayoutPersonRow,
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

type PayoutFilter = 'payable' | 'all' | 'paid_only';

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

export const ReferralTab: React.FC = () => {
  const [report, setReport] = useState<AdminReferralReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [payoutFilter, setPayoutFilter] = useState<PayoutFilter>('payable');
  const [expandedPersonId, setExpandedPersonId] = useState<number | null>(null);
  const [payoutNote, setPayoutNote] = useState('');
  const [payingPersonId, setPayingPersonId] = useState<number | null>(null);
  const [busyProofId, setBusyProofId] = useState<number | null>(null);
  const [busyRewardId, setBusyRewardId] = useState<number | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.getReferralReport();
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredBalances = useMemo(() => {
    if (!report) return [];
    const q = search.trim().toLowerCase().replace(/\D/g, '');
    const qText = search.trim().toLowerCase();
    return report.payoutBalances.filter((row) => {
      if (payoutFilter === 'payable' && row.payableUah <= 0) return false;
      if (payoutFilter === 'paid_only' && row.paidUah <= 0) return false;
      if (!qText) return true;
      const phone = row.phoneNormalized.toLowerCase();
      const name = (row.fullName || '').toLowerCase();
      const un = (row.telegramUsername || '').toLowerCase();
      if (q && phone.includes(q)) return true;
      return name.includes(qText) || un.includes(qText) || phone.includes(qText);
    });
  }, [report, search, payoutFilter]);

  const rewardsByPerson = useMemo(() => {
    const map = new Map<number, ReferralRewardRow[]>();
    if (!report) return map;
    for (const r of report.rewards) {
      const arr = map.get(r.referrerId) ?? [];
      arr.push(r);
      map.set(r.referrerId, arr);
    }
    return map;
  }, [report]);

  const pendingProofs = useMemo(
    () =>
      (report?.promoPhotoProofs ?? []).filter((p) =>
        p.status === 'pending_review' || p.status === 'flagged' || p.status === 'rejected'
      ),
    [report]
  );

  const markPaid = async (row: ReferralPayoutPersonRow) => {
    if (row.payableUah <= 0) return;
    const who = row.fullName || formatPhoneDisplay(row.phoneNormalized);
    const noteRaw = window.prompt(
      `Виплата ${row.payableUah} грн → ${who}\n\nНотатка про виплату (обовʼязково), напр. «Київстар ****1952, 05.08» або «Приват ****1234»:`,
      payoutNote.trim()
    );
    if (noteRaw === null) return;
    const note = noteRaw.trim();
    if (!note) {
      setError('Нотатка до виплати обовʼязкова — як саме поповнили / куди перевели.');
      return;
    }
    setPayingPersonId(row.personId);
    setError('');
    setSuccess('');
    try {
      const result = await apiClient.markReferralPayout({
        personId: row.personId,
        rewardIds: row.rewardIds,
        note,
      });
      setSuccess(`Виплату позначено: ${result.amountUah} грн (${result.updatedCount} нагород)`);
      setPayoutNote('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка виплати');
    } finally {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка оновлення нагороди');
    } finally {
      setBusyRewardId(null);
    }
  };

  const flagReward = async (id: number, currentReason?: string | null) => {
    const reason = window.prompt(
      `Причина flag для нагороди #${id}:`,
      currentReason || 'Підозріла активність'
    );
    if (reason === null) return;
    await setRewardStatus(id, 'flagged', {
      flagReason: reason.trim() || 'Підозріла активність',
    });
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

  const rejectProof = async (p: RideCompletionProofRow) => {
    const reason = window.prompt(
      `Причина відхилення фото #${p.id} (буде на нагородах):`,
      p.flagReason || 'Фото не підтверджує поїздку'
    );
    if (reason === null) return;
    await setProofStatus(p.id, 'rejected', reason.trim() || 'Фото відхилено модератором');
  };

  if (loading && !report) {
    return <div className="tab-content"><p>Завантаження реферальної програми…</p></div>;
  }

  const s = report?.summary;

  return (
    <div className="tab-content">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>🎁 Реферали — виплати та контроль</h2>
        <Button type="button" onClick={() => void load()} disabled={loading}>
          Оновити
        </Button>
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
        </div>
      )}

      <section style={{ marginTop: 28 }}>
        <h3>💳 Черга виплат</h3>
        <p style={{ color: 'var(--pb-text-muted)', marginTop: 0 }}>
          Платимо людям (не окремим рядкам). Flagged у виплату не потрапляють — спочатку розберіть підозри нижче.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, alignItems: 'flex-end' }}>
          <div style={{ minWidth: 200, flex: 1 }}>
            <Input
              label="Пошук"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="телефон або імʼя"
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
              <option value="all">Усі з нагородами</option>
              <option value="paid_only">Уже отримували виплату</option>
            </select>
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <Input
              label="Чернетка нотатки (підставиться у вікно «Виплатив»)"
              value={payoutNote}
              onChange={(e) => setPayoutNote(e.target.value)}
              placeholder="напр. Київстар ****1952, 05.08"
            />
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Отримувач</th>
                <th>Телефон</th>
                <th>До виплати</th>
                <th>Виплачено</th>
                <th>Flagged</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredBalances.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    {payoutFilter === 'payable' ? (
                      <span>
                        Немає сум <strong>до виплати</strong>
                        {(s?.flaggedCount ?? 0) > 0
                          ? ` — але є ${s!.flaggedCount} flagged нагород (див. блок «Підозрілі» нижче або фільтр «Усі з нагородами»).`
                          : (s?.payableUah ?? 0) === 0
                            ? ' — нагороди ще не нараховані або вже виплачені. Натисніть «Оновити».'
                            : '.'}
                        {' '}
                        <button
                          type="button"
                          onClick={() => setPayoutFilter('all')}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--pb-primary)',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            padding: 0,
                            font: 'inherit',
                          }}
                        >
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
                const details = rewardsByPerson.get(row.personId) ?? [];
                return (
                  <React.Fragment key={row.personId}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          onClick={() => setExpandedPersonId(open ? null : row.personId)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, color: 'var(--pb-primary)', padding: 0 }}
                        >
                          {open ? '▼' : '▶'} {row.fullName || '—'}
                        </button>
                        {row.telegramUsername ? <div style={{ fontSize: 12, color: 'var(--pb-text-muted)' }}>@{row.telegramUsername}</div> : null}
                      </td>
                      <td>{formatPhoneDisplay(row.phoneNormalized)}</td>
                      <td>
                        <strong>{row.payableUah} грн</strong>
                        {row.payableCount > 0 ? <div style={{ fontSize: 12 }}>{row.payableCount} нагород</div> : null}
                      </td>
                      <td>{row.paidUah} грн</td>
                      <td>{row.flaggedUah > 0 ? `${row.flaggedUah} грн` : '—'}</td>
                      <td>
                        <Button
                          type="button"
                          disabled={row.payableUah <= 0 || payingPersonId === row.personId}
                          onClick={() => void markPaid(row)}
                        >
                          {payingPersonId === row.personId ? '…' : 'Виплатив'}
                        </Button>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--pb-bg-secondary)' }}>
                          <table style={{ width: '100%' }}>
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>Тип</th>
                                <th>Сума</th>
                                <th>Статус</th>
                                <th>Друг</th>
                                <th>Нотатка виплати</th>
                                <th>Причина flag</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {details.map((r) => (
                                <tr key={r.id}>
                                  <td>{r.id}</td>
                                  <td>{REWARD_TYPE_LABEL[r.rewardType] || r.rewardType}</td>
                                  <td>{r.amountUah}</td>
                                  <td>{r.status}</td>
                                  <td>
                                    {r.referredPerson.fullName || formatPhoneDisplay(r.referredPerson.phoneNormalized)}
                                  </td>
                                  <td style={{ fontSize: 12 }}>{r.payoutNote || '—'}</td>
                                  <td style={{ fontSize: 12, color: r.flagReason ? 'var(--pb-danger, #b42318)' : undefined }}>
                                    {r.flagReason || '—'}
                                  </td>
                                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {r.status === 'flagged' && (
                                      <Button
                                        type="button"
                                        disabled={busyRewardId === r.id}
                                        onClick={() => void setRewardStatus(r.id, 'approved')}
                                        title="Повернути в чергу виплат (знімає ручний Flag)"
                                      >
                                        Схвалити
                                      </Button>
                                    )}
                                    {(r.status === 'pending' || r.status === 'approved') && (
                                      <Button
                                        type="button"
                                        disabled={busyRewardId === r.id}
                                        onClick={() => void flagReward(r.id, r.flagReason)}
                                        title="Прибрати з виплат. Повернути можна кнопкою «Схвалити»"
                                      >
                                        Flag
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
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

      <section style={{ marginTop: 36 }}>
        <h3>📷 Фото підтверджень (модерація)</h3>
        <p style={{ color: 'var(--pb-text-muted)', marginTop: 0 }}>
          Після двох фото бот просить викласти пост у Facebook. Схваліть (нагороди у виплату) або відхиліть із причиною —
          користувач отримає повідомлення в бот і зможе знову надіслати фото через /confirmride.
          Відхилені можна <strong>перепогодити</strong> без нових фото, якщо передумали.
        </p>
        {pendingProofs.length === 0 ? (
          <p style={{ color: 'var(--pb-text-muted)' }}>Немає заявок на перевірці.</p>
        ) : (
          <div className="referral-proof-grid">
            {pendingProofs.map((p) => {
              const rewards = p.referralRewards ?? [];
              const rewardSum = rewards.reduce((s, r) => s + r.amountUah, 0);
              const isFlagged = p.status === 'flagged';
              const isRejected = p.status === 'rejected';
              return (
                <article
                  key={p.id}
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
                    <ProofPhotoThumb
                      proofId={p.id}
                      kind="start"
                      label="1️⃣ Старт"
                      onOpen={setLightboxUrl}
                    />
                    <ProofPhotoThumb
                      proofId={p.id}
                      kind="end"
                      label="2️⃣ Прибуття"
                      onOpen={setLightboxUrl}
                    />
                  </div>

                  {rewards.length > 0 ? (
                    <ul className="referral-proof-rewards">
                      <li>
                        <strong>Нагороди по цій заявці:</strong> {rewardSum} грн
                      </li>
                      {rewards.map((r) => (
                        <li key={r.id}>
                          #{r.id} {REWARD_TYPE_LABEL[r.rewardType] || r.rewardType} →{' '}
                          {r.referrer.fullName || formatPhoneDisplay(r.referrer.phoneNormalized)} ·{' '}
                          {r.amountUah} грн · {r.status}
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
                        onClick={() => void rejectProof(p)}
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
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Кому</th>
                  <th>Тип</th>
                  <th>Сума</th>
                  <th>Причина</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {report!.flagged.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{formatPhoneDisplay(r.referrer.phoneNormalized)}</td>
                    <td>{REWARD_TYPE_LABEL[r.rewardType] || r.rewardType}</td>
                    <td>{r.amountUah}</td>
                    <td style={{ fontSize: 12 }}>{r.flagReason || '—'}</td>
                    <td>
                      <Button type="button" disabled={busyRewardId === r.id} onClick={() => void setRewardStatus(r.id, 'approved')}>
                        Схвалити
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section style={{ marginTop: 36 }}>
        <h3>👥 Останні запрошення</h3>
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
              {(report?.invites ?? []).slice(0, 30).map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.referrer.fullName || formatPhoneDisplay(inv.referrer.phoneNormalized)}</td>
                  <td>{inv.inviteContact}</td>
                  <td>{inv.status}</td>
                  <td>{inv.registrationBonusEligible === false ? 'ні (уже в базі)' : 'так'}</td>
                  <td>{String(inv.createdAt).slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
