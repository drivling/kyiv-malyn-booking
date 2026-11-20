import React, { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { formatPhoneDisplay } from '@/utils/constants';
import type { RideCompletionProofRow, RideProofLinkedReward } from '@/types';
import { StatusPill } from '../kit';
import { personLabel, proofStatus, rewardStatus, rewardTypeLabel, uah } from './referralText';

/** Фото заявки (старт / прибуття): тягнемо з адмінського API як blob, клік — збільшити */
export const ProofPhotoThumb: React.FC<{
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

/** Нагороди, привʼязані до заявки: одна стрічка на нагороду */
const ProofRewards: React.FC<{ rewards: RideProofLinkedReward[] }> = ({ rewards }) => {
  if (!rewards.length) return <p className="referral-muted">Нагород ще немає (або ще не нараховані).</p>;
  const sum = rewards.reduce((s, r) => s + r.amountUah, 0);
  return (
    <ul className="referral-proof-rewards" aria-label="Нагороди за заявкою">
      <li className="referral-proof-rewards__sum">
        Нагороди: <strong>{uah(sum)}</strong>
      </li>
      {rewards.map((r) => (
        <li key={r.id}>
          #{r.id} {rewardTypeLabel(r.rewardType)} → {personLabel(r.referrer)} · {uah(r.amountUah)} ·{' '}
          {rewardStatus(r.status).label}
          {r.flagReason ? ` (${r.flagReason})` : ''}
        </li>
      ))}
    </ul>
  );
};

const proofWho = (p: RideCompletionProofRow) =>
  `${formatPhoneDisplay(p.person.phoneNormalized)}${p.person.telegramUsername ? ` · @${p.person.telegramUsername}` : ''}`;

const proofTrip = (p: RideCompletionProofRow) =>
  `${p.route} · ${String(p.rideDate).slice(0, 10)}${p.departureTime ? ` · ${p.departureTime}` : ''}`;

/** Картка заявки з двома фото в розділі «Фото»: хто, яка поїздка, причина, нагороди, «Схвалити» / «Відхилити» */
export const ProofCard: React.FC<{
  proof: RideCompletionProofRow;
  busy: boolean;
  onOpenPhoto: (url: string) => void;
  onApprove: () => void;
  onReject: () => void;
}> = ({ proof: p, busy, onOpenPhoto, onApprove, onReject }) => {
  const st = proofStatus(p.status);
  const rejected = p.status === 'rejected';
  const reason = p.rejectionReason || p.flagReason;
  return (
    <article id={`referral-proof-${p.id}`} className={`referral-proof-card referral-proof-card--${st.tone}`} aria-label={`Заявка #${p.id}`}>
      <div className="referral-proof-card__head">
        <div>
          <h4 className="referral-proof-card__title">
            #{p.id} · {p.person.fullName || 'Без імені'}
          </h4>
          <p className="referral-proof-card__meta">
            {proofWho(p)}
            <br />
            {proofTrip(p)}
          </p>
        </div>
        <StatusPill tone={st.tone}>{st.label}</StatusPill>
      </div>
      {reason && (
        <p className="referral-proof-reason">
          <strong>{rejected ? 'Відхилено: ' : p.status === 'flagged' ? 'Чому підозра: ' : 'Причина: '}</strong>
          {reason}
        </p>
      )}
      <div className="referral-proof-photos">
        <ProofPhotoThumb proofId={p.id} kind="start" label="1 · Старт" onOpen={onOpenPhoto} />
        <ProofPhotoThumb proofId={p.id} kind="end" label="2 · Прибуття" onOpen={onOpenPhoto} />
      </div>
      <ProofRewards rewards={p.referralRewards ?? []} />
      <div className="referral-proof-actions">
        <button type="button" className="admin-kit-btn" disabled={busy} onClick={onApprove}>
          {busy ? '…' : rejected ? 'Перепогодити → у виплату' : 'Схвалити → у виплату'}
        </button>
        {!rejected && (
          <button type="button" className="admin-kit-btn admin-kit-btn--quiet" disabled={busy} onClick={onReject}>
            Відхилити
          </button>
        )}
      </div>
    </article>
  );
};

/** Заявка у вікні — коли її відкрили з картки людини чи з підозр (вона може бути й поза модерацією) */
export const ProofDetailModal: React.FC<{
  proofId: number;
  cachedProofs: RideCompletionProofRow[];
  onClose: () => void;
  onOpenPhoto: (url: string) => void;
  /** Є картка цієї заявки в розділі «Фото» — показати кнопку переходу */
  onShowInList?: () => void;
}> = ({ proofId, cachedProofs, onClose, onOpenPhoto, onShowInList }) => {
  const [proof, setProof] = useState<RideCompletionProofRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let alive = true;
    const cached = cachedProofs.find((p) => p.id === proofId);
    if (cached) {
      setProof(cached);
      setLoading(false);
      setLoadError('');
      return;
    }
    setLoading(true);
    setLoadError('');
    void apiClient
      .getRideProof(proofId)
      .then((data) => {
        if (alive) setProof(data);
      })
      .catch((e) => {
        if (alive) setLoadError(e instanceof Error ? e.message : 'Не вдалося завантажити');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [proofId, cachedProofs]);

  const st = proof ? proofStatus(proof.status) : null;
  return (
    <div
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Заявка #${proofId}`}
    >
      <div className="modal-content referral-proof-detail-modal">
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>Заявка #{proofId}</h3>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Закрити">
            ×
          </button>
        </div>
        <div className="modal-body">
          {loading && <p>Завантаження…</p>}
          {loadError && <Alert variant="error">{loadError}</Alert>}
          {!loading && proof && st && (
            <>
              <p className="referral-proof-detail-meta">
                <strong>{proof.person.fullName || 'Без імені'}</strong> · {proofWho(proof)}
                <br />
                {proofTrip(proof)} · <StatusPill tone={st.tone}>{st.label}</StatusPill>
              </p>
              {(proof.rejectionReason || proof.flagReason) && (
                <p className="referral-proof-reason">
                  <strong>Причина: </strong>
                  {proof.rejectionReason || proof.flagReason}
                </p>
              )}
              <div className="referral-proof-photos">
                <ProofPhotoThumb proofId={proof.id} kind="start" label="1 · Старт" onOpen={onOpenPhoto} />
                <ProofPhotoThumb proofId={proof.id} kind="end" label="2 · Прибуття" onOpen={onOpenPhoto} />
              </div>
              <ProofRewards rewards={proof.referralRewards ?? []} />
            </>
          )}
        </div>
        <div className="modal-footer referral-modal-footer">
          {onShowInList && (
            <button type="button" className="admin-kit-btn" onClick={onShowInList}>
              Відкрити в розділі «Фото»
            </button>
          )}
          <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={onClose}>
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
};
