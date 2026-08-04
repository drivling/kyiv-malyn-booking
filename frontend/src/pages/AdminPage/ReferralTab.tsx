import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { formatPhoneDisplay } from '@/utils/constants';
import type { AdminReferralReport, ReferralPayoutPersonRow, ReferralRewardRow } from '@/types';

const REWARD_TYPE_LABEL: Record<string, string> = {
  registration: 'Новий друг (10)',
  driver_qualified: 'Водій (40)',
  driver_first_listing: 'Водій (legacy)',
  passenger_completed_ride: 'Друг-пасажир (20)',
  passenger_self_confirm: 'Своє підтвердження (20)',
};

type PayoutFilter = 'payable' | 'all' | 'paid_only';

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
    () => (report?.promoPhotoProofs ?? []).filter((p) => p.status === 'pending_review' || p.status === 'flagged'),
    [report]
  );

  const markPaid = async (row: ReferralPayoutPersonRow) => {
    if (row.payableUah <= 0) return;
    const ok = window.confirm(
      `Позначити виплату ${row.payableUah} грн для ${row.fullName || formatPhoneDisplay(row.phoneNormalized)}?`
    );
    if (!ok) return;
    setPayingPersonId(row.personId);
    setError('');
    setSuccess('');
    try {
      const result = await apiClient.markReferralPayout({
        personId: row.personId,
        rewardIds: row.rewardIds,
        note: payoutNote.trim() || undefined,
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

  const setRewardStatus = async (id: number, status: string) => {
    setBusyRewardId(id);
    setError('');
    try {
      await apiClient.patchReferralReward(id, { status });
      setSuccess(`Нагороду #${id} → ${status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка оновлення нагороди');
    } finally {
      setBusyRewardId(null);
    }
  };

  const setProofStatus = async (id: number, status: string) => {
    setBusyProofId(id);
    setError('');
    try {
      await apiClient.patchRideProof(id, { status });
      setSuccess(`Фото #${id} → ${status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Помилка оновлення фото');
    } finally {
      setBusyProofId(null);
    }
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
              label="Нотатка до наступної виплати"
              value={payoutNote}
              onChange={(e) => setPayoutNote(e.target.value)}
              placeholder="напр. Приват ****1234, 04.08"
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
                  <td colSpan={6}>Немає записів за фільтром</td>
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
                                <th>Нотатка</th>
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
                                  <td style={{ fontSize: 12 }}>{r.payoutNote || r.flagReason || '—'}</td>
                                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {r.status === 'flagged' && (
                                      <Button
                                        type="button"
                                        disabled={busyRewardId === r.id}
                                        onClick={() => void setRewardStatus(r.id, 'approved')}
                                      >
                                        Схвалити
                                      </Button>
                                    )}
                                    {(r.status === 'pending' || r.status === 'approved') && (
                                      <Button
                                        type="button"
                                        disabled={busyRewardId === r.id}
                                        onClick={() => void setRewardStatus(r.id, 'flagged')}
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
          Після двох фото бот просить людину викласти пост у Facebook. Тут — схвалення / відхилення.
        </p>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Хто</th>
                <th>Маршрут / дата</th>
                <th>Статус</th>
                <th>Telegram file_id</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingProofs.length === 0 && (
                <tr>
                  <td colSpan={6}>Немає фото на перевірці</td>
                </tr>
              )}
              {pendingProofs.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>
                    {p.person.fullName || '—'}
                    <div style={{ fontSize: 12 }}>{formatPhoneDisplay(p.person.phoneNormalized)}</div>
                  </td>
                  <td>
                    {p.route}
                    <div style={{ fontSize: 12 }}>{String(p.rideDate).slice(0, 10)}</div>
                  </td>
                  <td>{p.status}</td>
                  <td style={{ fontSize: 11, maxWidth: 180, wordBreak: 'break-all' }}>
                    {p.photoStartFileId ? `start: ${p.photoStartFileId.slice(0, 24)}…` : '—'}
                    <br />
                    {p.photoEndFileId ? `end: ${p.photoEndFileId.slice(0, 24)}…` : '—'}
                  </td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Button type="button" disabled={busyProofId === p.id} onClick={() => void setProofStatus(p.id, 'approved')}>
                      OK
                    </Button>
                    <Button type="button" disabled={busyProofId === p.id} onClick={() => void setProofStatus(p.id, 'rejected')}>
                      Відхилити
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
