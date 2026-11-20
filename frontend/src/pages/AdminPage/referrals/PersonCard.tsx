import React from 'react';
import { formatPhoneDisplay } from '@/utils/constants';
import type { PersonReferralDetails } from '@/types';
import { StatusPill } from '../kit';
import { personLabel, rewardStatus, rewardTypeLabel, uah } from './referralText';

/**
 * Картка людини в реферальній програмі: хто привів, кого привела, спільний Telegram і всі її нагороди одним рядком
 * кожна (тип, сума, стан, друг, заявка з фото, нотатка виплати) з діями «Схвалити» / «Підозра» / «Скасувати виплату».
 */
export const PersonCard: React.FC<{
  details: PersonReferralDetails;
  busyRewardId: number | null;
  undoingRewardId: number | null;
  /** `flagReason` — щоб для само-реферала спитати підтвердження */
  onApprove: (id: number, flagReason: string | null) => void;
  onFlag: (id: number, reason?: string | null) => void;
  onUndo: (id: number) => void;
  onOpenPerson: (id: number) => void;
  onOpenProof: (proofId: number) => void;
}> = ({ details, busyRewardId, undoingRewardId, onApprove, onFlag, onUndo, onOpenPerson, onOpenProof }) => {
  const { person, rewards, invitedPersons, sharedAccountPersons } = details;
  const total = (st: string) => rewards.filter((r) => r.status === st).reduce((s, r) => s + r.amountUah, 0);
  const paid = total('paid');
  const payable = total('approved');
  const hold = total('hold') + total('pending');
  const flagged = total('flagged');

  return (
    <div className="referral-person" aria-label={`Картка: ${personLabel(person)}`}>
      <div className="referral-person__meta">
        <span>
          <strong>{person.fullName || '—'}</strong> · {formatPhoneDisplay(person.phoneNormalized)}
          {person.telegramUsername ? ` · @${person.telegramUsername}` : ''}
          {person.referralCode ? <span className="referral-muted"> · код {person.referralCode}</span> : null}
        </span>
        <span>
          Привів:{' '}
          {person.referredByPerson ? (
            <button type="button" className="admin-kit-linkbtn" onClick={() => onOpenPerson(person.referredByPerson!.id)}>
              {personLabel(person.referredByPerson)}
            </button>
          ) : (
            '—'
          )}
        </span>
        <span>
          Привела ({invitedPersons.length}):{' '}
          {invitedPersons.length
            ? invitedPersons.map((p, i) => (
                <React.Fragment key={p.id}>
                  {i > 0 ? ', ' : ''}
                  <button type="button" className="admin-kit-linkbtn" onClick={() => onOpenPerson(p.id)}>
                    {personLabel(p)}
                  </button>
                </React.Fragment>
              ))
            : '—'}
        </span>
      </div>
      <div className="sched-tags" aria-label="Нагороди людини">
        <span className="sched-tag">виплачено {uah(paid)}</span>
        {payable > 0 && <span className="sched-tag referral-tag--ok">до виплати {uah(payable)}</span>}
        {hold > 0 && <span className="sched-tag">на перевірці {uah(hold)}</span>}
        {flagged > 0 && <span className="sched-flag referral-flag--error">підозра {uah(flagged)}</span>}
        {sharedAccountPersons.length > 0 && (
          <span className="sched-flag referral-flag--error">
            той самий Telegram: {sharedAccountPersons.map((p) => formatPhoneDisplay(p.phoneNormalized)).join(', ')}
          </span>
        )}
      </div>
      {rewards.length === 0 ? (
        <p className="referral-muted">Нагород як отримувач у неї немає.</p>
      ) : (
        <ul className="referral-rewards" aria-label="Нагороди">
          {rewards.map((r) => {
            const st = rewardStatus(r.status);
            const busy = busyRewardId === r.id;
            return (
              <li key={r.id} className="referral-reward">
                <span className="referral-reward__id">#{r.id}</span>
                <span className="referral-reward__what">
                  <strong>{uah(r.amountUah)}</strong> {rewardTypeLabel(r.rewardType)} · друг{' '}
                  <button type="button" className="admin-kit-linkbtn" onClick={() => onOpenPerson(r.referredPerson.id)}>
                    {personLabel(r.referredPerson)}
                  </button>
                  {r.rideProof?.id ? (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="admin-kit-linkbtn"
                        onClick={() => onOpenProof(r.rideProof!.id)}
                        title={`${r.rideProof.route} · ${String(r.rideProof.rideDate).slice(0, 10)}`}
                      >
                        заявка #{r.rideProof.id}
                      </button>
                    </>
                  ) : null}
                  {r.flagReason ? <span className="referral-reward__note referral-reward__note--error">{r.flagReason}</span> : null}
                  {r.payoutNote ? <span className="referral-reward__note">виплата: {r.payoutNote}</span> : null}
                </span>
                <StatusPill tone={st.tone}>{st.label}</StatusPill>
                <span className="referral-reward__actions">
                  {(r.status === 'flagged' || r.status === 'hold' || r.status === 'pending') && (
                    <button type="button" className="admin-kit-btn" disabled={busy} onClick={() => onApprove(r.id, r.flagReason)}>
                      Схвалити
                    </button>
                  )}
                  {(r.status === 'hold' || r.status === 'pending' || r.status === 'approved') && (
                    <button type="button" className="admin-kit-btn admin-kit-btn--quiet" disabled={busy} onClick={() => onFlag(r.id, r.flagReason)}>
                      Підозра
                    </button>
                  )}
                  {r.status === 'paid' && (
                    <button
                      type="button"
                      className="admin-kit-btn admin-kit-btn--quiet"
                      disabled={undoingRewardId === r.id}
                      onClick={() => onUndo(r.id)}
                      title="Повернути в чергу виплат (якщо натиснули «Виплатив» помилково)"
                    >
                      {undoingRewardId === r.id ? '…' : 'Скасувати виплату'}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
