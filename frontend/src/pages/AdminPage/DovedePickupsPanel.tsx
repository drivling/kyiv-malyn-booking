import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import type { StopLike } from '@/pages/DovedePage/nlu/stopPlaces';
import type { DovedePickups } from '@/types';
import { percent, tallyPickups } from './dovedePickups';

/**
 * «Звідки забирають попутки»: за примітками оголошень водіїв за 90 днів — які місця в Малині й Києві вони називають.
 * З цього видно, чи тримається правило «попутка з центру, якщо водій не сказав інше», і які слова варто навчити
 * синонімом. Імен і телефонів тут немає — сервер віддає лише напрямок і текст примітки.
 */
export const DovedePickupsPanel: React.FC<{ stops: StopLike[]; routeLabel: (slug: string) => string }> = ({ stops, routeLabel }) => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DovedePickups | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || data) return;
    apiClient
      .getDovedePickups(90)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не вдалося завантажити оголошення'));
  }, [open, data]);

  const tally = useMemo(() => (data ? tallyPickups(data, stops).filter((t) => t.total >= 3).slice(0, 8) : []), [data, stops]);

  return (
    <div className="dovede-syn dovede-pickups">
      <div className="dovede-log-head">
        <h3>Звідки забирають попутки</h3>
        <button type="button" className="dovede-log-chip" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Згорнути' : 'Порахувати за 90 днів'}
        </button>
      </div>
      <p className="dovede-log-note">
        Що водії пишуть у примітках до оголошень. Коли місця в Малині не названо, «Доведе» показує посадку «з центру —
        уточніть у водія».
      </p>
      {error ? <p className="dovede-log-error">{error}</p> : null}
      {open && !data && !error ? <p className="dovede-log-empty">Рахую…</p> : null}
      {open && data ? (
        tally.length === 0 ? (
          <p className="dovede-log-empty">За цей період оголошень водіїв замало.</p>
        ) : (
          tally.map((t) => (
            <section key={t.route} className="dovede-pickups-route" aria-label={routeLabel(t.route)}>
              <h4>
                {routeLabel(t.route)} <span>оголошень: {t.total}</span>
              </h4>
              <p className="dovede-log-dim">
                з приміткою — {percent(t.withNote, t.total)} · місце в Малині названо — {percent(t.malynNamed, t.total)} · у Києві —{' '}
                {percent(t.kyivNamed, t.total)}
              </p>
              <div className="dovede-pickups-cols">
                <div>
                  <h5>Малин</h5>
                  {t.malyn.length ? (
                    <ul>
                      {t.malyn.map((p) => (
                        <li key={p.label}>
                          {p.label} <b>{p.count}</b>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dovede-log-empty">ніхто не називає</p>
                  )}
                </div>
                <div>
                  <h5>Київ</h5>
                  {t.kyiv.length ? (
                    <ul>
                      {t.kyiv.map((p) => (
                        <li key={p.label}>
                          {p.label} <b>{p.count}</b>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dovede-log-empty">ніхто не називає</p>
                  )}
                </div>
              </div>
              {t.unrecognised.length ? (
                <details>
                  <summary>Примітки без впізнаного місця ({t.unrecognised.length})</summary>
                  <ul className="dovede-pickups-notes">
                    {t.unrecognised.map((n) => (
                      <li key={n.note}>
                        «{n.note}» <b>{n.count}</b>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          ))
        )
      ) : null}
    </div>
  );
};
