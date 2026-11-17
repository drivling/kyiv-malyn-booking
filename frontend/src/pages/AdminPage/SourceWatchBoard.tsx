import React, { useEffect, useState } from "react";
import { apiClient } from "@/api/client";
import type {
  BoardComparisonRow,
  BoardSourceSnapshot,
  BoardTrip,
  BoardVerdict,
} from "@/types";

/** 334.8 → «334,80»; null → «—» */
const boardPrice = (n: number | null): string =>
  n == null ? "—" : n.toFixed(2).replace(".", ",");

const VERDICT_LABEL: Record<BoardVerdict, string> = {
  same: "збігається",
  differs: "інша ціна",
  missing: "нема в базі",
  "no-db-price": "у базі без ціни",
  "no-board-price": "на табло без ціни",
  "only-db": "лише в базі",
};

const verdictClass = (v: BoardVerdict): string =>
  v === "same" ? "source-watch-verdict--ok" : "source-watch-verdict--warn";

/**
 * Останній знімок табло автовокзалу (джерело bus-board): рейси до міста поруч із ціною в Schedule, решта рейсів через
 * місто окремо. Лише показ — ціну в базі міняє власник у «Розкладах». Docs/fare-source-watch-2026-11.md, фаза 3.
 */
export const SourceWatchBoard: React.FC<{ sourceKey: string }> = ({
  sourceKey,
}) => {
  const [snapshot, setSnapshot] = useState<BoardSourceSnapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    apiClient
      .getWatchedSourceBoard(sourceKey)
      .then((s) => alive && setSnapshot(s))
      .catch(
        (e: unknown) =>
          alive &&
          setError(
            e instanceof Error ? e.message : "Не вдалося завантажити табло",
          ),
      );
    return () => {
      alive = false;
    };
  }, [sourceKey]);

  if (error) return <p className="source-watch-error">{error}</p>;
  if (!snapshot) return <p className="source-watch-hint">Завантажую табло…</p>;
  if (!snapshot.trips.length && !snapshot.comparison.length)
    return <p className="source-watch-hint">Табло ще не читалось.</p>;

  const toCity = snapshot.comparison;
  const compared = new Set(toCity.map((r) => `${r.time}|${r.from ?? ""}`));
  const others: BoardTrip[] = snapshot.trips.filter(
    (t) => !compared.has(`${t.time}|${t.from}`),
  );
  const mismatches = toCity.filter((r) => r.verdict !== "same").length;

  return (
    <div className="source-watch-board">
      <p className="source-watch-hint">
        Знімок табло{snapshot.boardDate ? ` (${snapshot.boardDate})` : ""}
        {snapshot.scheduleRoute
          ? ` проти розкладу «${snapshot.scheduleRoute}»`
          : ""}
        {mismatches ? ` — розходжень: ${mismatches}` : " — усе збігається"}.
        Нічого не записується: ціну в базі міняйте в «Розкладах».
      </p>
      <table className="source-watch-table source-watch-board-table">
        <thead>
          <tr>
            <th>Час</th>
            <th>Рейс</th>
            <th>Приб.</th>
            <th>Табло, грн</th>
            <th>У базі, грн</th>
            <th>Перевізник</th>
            <th>Стан</th>
          </tr>
        </thead>
        <tbody>
          {toCity.map((r: BoardComparisonRow) => (
            <tr
              key={`${r.time}-${r.from ?? "db"}`}
              className={
                r.verdict === "same" ? undefined : "source-watch-row--changed"
              }
            >
              <td>{r.time}</td>
              <td>{r.from ? `${r.from} → ${r.to}` : `→ ${r.to}`}</td>
              <td>{r.arrival ?? "—"}</td>
              <td>{boardPrice(r.boardPriceUah)}</td>
              <td>{r.dbPriceUah ?? "—"}</td>
              <td>{r.carrier ?? "—"}</td>
              <td>
                <span
                  className={`source-watch-verdict ${verdictClass(r.verdict)}`}
                >
                  {VERDICT_LABEL[r.verdict]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {others.length > 0 && (
        <>
          <p className="source-watch-hint">
            Інші рейси через місто (з базою не звіряються — на табло час
            проходження через Житомир):
          </p>
          <ul className="source-watch-lines">
            {others.map((t) => (
              <li key={`${t.time}-${t.from}-${t.to}`}>
                {t.time} {t.from} → {t.to} · {boardPrice(t.priceUah)} грн ·{" "}
                {t.carrier}
              </li>
            ))}
          </ul>
        </>
      )}
      {snapshot.attribution && (
        <p className="source-watch-hint">
          Ціни —{" "}
          <a href={snapshot.url} target="_blank" rel="noreferrer">
            {snapshot.attribution}
          </a>
          .
        </p>
      )}
    </div>
  );
};
