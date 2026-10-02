import React, { useState } from 'react';
import { Button } from '@/components/Button';
import type { LunchReparseDetail, LunchReparseReport } from '@/types';

const SOURCE_LABEL: Record<string, string> = {
  telegram: 'Telegram',
  dzhura: 'база Джури (Telegram був недоступний)',
  none: 'нічого не знайдено',
};

const OUTCOME_LABEL: Record<string, string> = {
  order: 'замовлення',
  payment: 'оплата',
  card: 'картка',
  summary: 'підсумок',
  skipped: 'пропущено',
};

/** Рядки, на які варто глянути: пропущені та ті, де щось не розпізнано. */
function isNoteworthy(d: LunchReparseDetail): boolean {
  return d.outcome === 'skipped' || Boolean(d.reason);
}

export const LunchReparseReportView: React.FC<{
  title: string;
  report: LunchReparseReport;
  onClose: () => void;
}> = ({ title, report, onClose }) => {
  const [showAll, setShowAll] = useState(false);
  const details = report.details ?? [];
  const interesting = details.filter(isNoteworthy);
  const shown = showAll ? details : interesting;

  return (
    <section className="lunch-card lunch-report" aria-label="Звіт розбору">
      <div className="lunch-card__row">
        <h3 className="lunch-card__title">{title}</h3>
        <Button type="button" variant="secondary" onClick={onClose}>
          Закрити звіт
        </Button>
      </div>
      <p className="lunch-card__hint" style={{ marginTop: 0 }}>
        Повідомлень: {report.scanned ?? 0} · замовлень: {report.orders ?? 0} · оплат: {report.payments ?? 0}
        {report.summaries ? ` · підсумків: ${report.summaries}` : ''} · пропущено: {report.skipped ?? 0}
        {report.source ? ` · джерело: ${SOURCE_LABEL[report.source] ?? report.source}` : ''}
        {report.replaced ? ' · замінено наявне замовлення' : ''}
        {report.notified ? ' · підтвердження поставлено в чергу для групи' : ''}
      </p>
      {(report.warnings ?? []).map((w) => (
        <p key={w} className="lunch-report__warn">
          ⚠ {w}
        </p>
      ))}
      {(report.errors ?? []).map((e) => (
        <p key={e} className="lunch-report__warn">
          ⚠ {e}
        </p>
      ))}
      {details.length === 0 ? (
        <p className="lunch-muted">Звіту по окремих повідомленнях немає.</p>
      ) : (
        <>
          <div className="lunch-report__toggle">
            <label className="lunch-check">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Показати всі повідомлення ({details.length})
            </label>
          </div>
          {shown.length === 0 ? (
            <p className="lunch-muted">Усе розпізнано без зауважень.</p>
          ) : (
            <div className="lunch-table-wrap">
              <table className="lunch-table">
                <thead>
                  <tr>
                    <th>Хто</th>
                    <th>Повідомлення</th>
                    <th>Результат</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d, i) => (
                    <tr
                      key={`${d.messageId ?? 'x'}-${i}`}
                      className={d.outcome === 'skipped' ? 'lunch-row--warn' : undefined}
                    >
                      <td>{d.name}</td>
                      <td className="lunch-report__text">{d.text || <span className="lunch-muted">—</span>}</td>
                      <td>
                        <strong>{OUTCOME_LABEL[d.outcome] ?? d.outcome}</strong>
                        {d.reason ? <div className="lunch-muted">{d.reason}</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
};
