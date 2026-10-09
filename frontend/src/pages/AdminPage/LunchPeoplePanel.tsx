import React, { useState } from 'react';
import { Button } from '@/components/Button';
import type { LunchDayPeople, LunchPerson } from '@/types';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
}

export const LunchPeoplePanel: React.FC<{
  data: LunchDayPeople | null;
  loading: boolean;
  busyTgUserId: string | null;
  disabled: boolean;
  notify: boolean;
  onNotifyChange: (value: boolean) => void;
  onReparse: (person: LunchPerson) => void;
  onRefresh: () => void;
}> = ({ data, loading, busyTgUserId, disabled, notify, onNotifyChange, onReparse, onRefresh }) => {
  const [showAll, setShowAll] = useState(false);
  const people = data?.people ?? [];
  const withoutOrder = people.filter((p) => !p.hasOrder);
  const shown = showAll ? people : withoutOrder;

  return (
    <section className="lunch-card">
      <div className="lunch-card__row">
        <h3 className="lunch-card__title">
          Писали в групі сьогодні · без замовлення ({withoutOrder.length})
        </h3>
        <div className="lunch-actions lunch-actions--tight">
          <label className="lunch-check">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            і з замовленням ({people.length - withoutOrder.length})
          </label>
          <Button type="button" variant="secondary" onClick={onRefresh} disabled={loading}>
            Оновити список
          </Button>
        </div>
      </div>
      <p className="lunch-card__hint">
        Список береться з «Джури» (збережені повідомлення групи), тож Telegram не чіпається. «Розібрати» шукає
        повідомлення цієї людини за сьогодні й розбирає лише її — чужі замовлення та ручні правки лишаються.
      </p>
      <label className="lunch-check">
        <input type="checkbox" checked={notify} onChange={(e) => onNotifyChange(e.target.checked)} />
        Написати людині підтвердження в групу (як при звичайному замовленні)
      </label>

      {data && !data.available ? (
        <p className="lunch-muted" style={{ marginTop: 8 }}>
          «Джура» ще не бачить чат обідів — список з’явиться, коли слухач збереже перші повідомлення групи.
        </p>
      ) : shown.length === 0 ? (
        <p className="lunch-muted" style={{ marginTop: 8 }}>
          {loading ? 'Завантаження…' : 'Усі, хто писав у групі, мають замовлення.'}
        </p>
      ) : (
        <ul className="lunch-people">
          {shown.map((p) => (
            <li key={p.tgUserId} className="lunch-person">
              <div className="lunch-person__head">
                <strong>{p.name}</strong>
                {p.username ? <span className="lunch-muted">@{p.username}</span> : null}
                <span className={`lunch-badge ${p.hasOrder ? 'lunch-badge--ordering' : 'lunch-badge--none'}`}>
                  {p.hasOrder ? `є замовлення · ${p.orderTotalUah ?? 0} грн` : 'без замовлення'}
                </span>
                <Button
                  type="button"
                  variant={p.hasOrder ? 'secondary' : 'primary'}
                  className="lunch-pay-btn"
                  disabled={disabled}
                  onClick={() => onReparse(p)}
                >
                  {busyTgUserId === p.tgUserId ? 'Розбір…' : p.hasOrder ? 'Перерозібрати' : 'Розібрати'}
                </Button>
              </div>
              <ul className="lunch-person__msgs">
                {p.messageCount > p.messages.length ? (
                  <li className="lunch-muted">… ще {p.messageCount - p.messages.length} раніших</li>
                ) : null}
                {p.messages.map((m) => (
                  <li key={m.tgMessageId}>
                    <span className="lunch-muted">{formatTime(m.sentAt)}</span> {m.text}
                    {m.editedAt ? <span className="lunch-muted"> (змінено)</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
