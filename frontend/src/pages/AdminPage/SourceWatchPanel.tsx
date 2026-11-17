import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { apiClient } from "@/api/client";
import type { WatchedSource } from "@/types";
import { SourceWatchBoard } from "./SourceWatchBoard";
import "./SourceWatchPanel.css";

const KYIV_TIME = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function when(iso: string | null): string {
  if (!iso) return "—";
  // data.gov.ua віддає час без зони — це UTC
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? "—" : KYIV_TIME.format(d);
}

/**
 * Зовнішні джерела розкладу, за якими стежить бекенд (сторінка ради, набори data.gov.ua, табло автовокзалу Житомир-1,
 * malyn.media): коли джерело змінилось, що саме, і кнопка «Переглянуто». Для табло — «Табло»: останній знімок таблицею
 * рейсів поруч із цінами в базі. Docs/korosten-transport-2026-11.md, фаза 1; Docs/fare-source-watch-2026-11.md, фаза 3.
 */
export const SourceWatchPanel: React.FC = () => {
  const [sources, setSources] = useState<WatchedSource[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openBoard, setOpenBoard] = useState<string | null>(null);

  const run = useCallback(
    async (action: () => Promise<{ sources: WatchedSource[] }>) => {
      setBusy(true);
      setError("");
      try {
        setSources((await action()).sources);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Не вдалося завантажити джерела",
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    void run(() => apiClient.getWatchedSources());
  }, [run]);

  if (!sources?.length && !error) return null;
  const list = sources ?? [];
  const pending = list.filter((s) => s.pending).length;
  const failing = list.filter((s) => s.failCount > 0).length;

  return (
    <details className="source-watch" open={pending > 0}>
      <summary className="source-watch-summary">
        Джерела розкладу
        {pending > 0 && (
          <span className="source-watch-badge source-watch-badge--changed">
            змінилось: {pending}
          </span>
        )}
        {failing > 0 && (
          <span className="source-watch-badge source-watch-badge--failing">
            не відповідає: {failing}
          </span>
        )}
        {pending === 0 && failing === 0 && (
          <span className="source-watch-badge">без змін</span>
        )}
      </summary>
      {error && <p className="source-watch-error">{error}</p>}
      <table className="source-watch-table">
        <thead>
          <tr>
            <th>Джерело</th>
            <th>Змінено в джерелі</th>
            <th>Перевірено</th>
            <th>Стан</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <React.Fragment key={s.key}>
              <tr
                className={s.pending ? "source-watch-row--changed" : undefined}
              >
                <td>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.label}
                  </a>
                  {s.attribution && (
                    <div className="source-watch-hint">{s.attribution}</div>
                  )}
                </td>
                <td>{when(s.modified)}</td>
                <td>{when(s.lastCheckedAt)}</td>
                <td>
                  {s.failCount > 0
                    ? `не відповідає (${s.failCount}): ${s.lastError ?? ""}`
                    : s.pending
                      ? `змінилось ${when(s.lastChangedAt)}${s.changed.length ? `: ${s.changed.join(", ")}` : ""}`
                      : s.lastCheckedAt
                        ? "без змін"
                        : "ще не перевірялось"}
                  {s.pending &&
                    s.failCount === 0 &&
                    (s.changeLines?.length ?? 0) > 0 && (
                      <ul className="source-watch-lines">
                        {s.changeLines?.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                </td>
                <td>
                  {s.pending && (
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          apiClient.acknowledgeWatchedSource(s.key),
                        )
                      }
                    >
                      Переглянуто
                    </Button>
                  )}
                  {s.kind === "bus-board" && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setOpenBoard((k) => (k === s.key ? null : s.key))
                      }
                      aria-expanded={openBoard === s.key}
                    >
                      {openBoard === s.key ? "Сховати табло" : "Табло"}
                    </Button>
                  )}
                </td>
              </tr>
              {openBoard === s.key && (
                <tr className="source-watch-board-row">
                  <td colSpan={5}>
                    <SourceWatchBoard sourceKey={s.key} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <div className="source-watch-actions">
        <Button
          type="button"
          disabled={busy}
          onClick={() => void run(() => apiClient.checkWatchedSources())}
        >
          {busy ? "Перевіряю…" : "Перевірити зараз"}
        </Button>
        <span className="source-watch-hint">
          Сервер перевіряє сам кілька разів на добу (табло автовокзалу — двічі,
          не частіше ніж раз на годину) й пише в адмін-чат бота, коли джерело
          змінилось. Нагляд лише сигналізує — ціни в базі міняєте ви.
        </span>
      </div>
    </details>
  );
};
