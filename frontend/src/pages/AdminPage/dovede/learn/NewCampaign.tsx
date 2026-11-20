import React, { useEffect, useMemo, useState } from "react";
import { MAX_DAILY } from './campaignText';
import { apiClient } from "@/api/client";
import type {
  DovedeCampaign,
  DovedeCampaignCity,
  DovedeCampaignDir,
  DovedeCampaignOptions,
  DovedeCampaignPreset,
  DovedeCampaignPreview,
} from "@/types";
import { StatTile, StatTiles } from "../../kit";
import {
  DAY_LABEL,
  DAY_TYPES,
  HOURS,
  formatHours,
  hourKey,
  parseHours,
  type DayType,
} from "./hours";
import { num } from "./campaignText";

const CITIES: Array<{ id: DovedeCampaignCity; name: string }> = [
  { id: "Zhytomyr", name: "Житомир" },
  { id: "Kyiv", name: "Київ" },
];
const MAX_BUDGET = 20_000;

interface FormState {
  origins: string[];
  dirs: DovedeCampaignDir[];
  main: Set<string>;
  extra: Set<string>;
  maxDepth: number;
  places: string;
}

const fromPreset = (p: DovedeCampaignPreset["cities"][number]): FormState => ({
  origins: p.origins,
  dirs: p.dirs,
  main: parseHours(p.main),
  extra: parseHours(p.extra),
  maxDepth: p.maxDepth,
  places: "",
});

const toggle = <T,>(list: T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

/** Клітинки годин: рядок на тип дня; сервер бере відповідь на годину ± 1 */
const HoursGrid: React.FC<{
  label: string;
  value: Set<string>;
  disabled?: Set<string>;
  onChange: (next: Set<string>) => void;
}> = ({ label, value, disabled, onChange }) => (
  <fieldset className="dv-learn-hours">
    <legend>{label}</legend>
    {DAY_TYPES.map((day: DayType) => (
      <div
        key={day}
        className="dv-learn-hours-row"
        role="group"
        aria-label={`${label}: ${DAY_LABEL[day]}`}
      >
        <span>{DAY_LABEL[day]}</span>
        {HOURS.map((h) => {
          const key = hourKey(day, h);
          const on = value.has(key);
          const off = disabled?.has(key);
          return (
            <button
              key={key}
              type="button"
              className={`dv-learn-hour${on ? " is-on" : ""}`}
              aria-pressed={on}
              aria-label={`${DAY_LABEL[day]} ${h}:00`}
              disabled={off}
              title={off ? "Уже серед основних годин" : undefined}
              onClick={() => {
                const next = new Set(value);
                if (on) next.delete(key);
                else next.add(key);
                onChange(next);
              }}
            >
              {String(h).padStart(2, "0")}
            </button>
          );
        })}
      </div>
    ))}
  </fieldset>
);

/**
 * «Нова кампанія»: місто, заготовка, параметри (за замовчуванням — із заготовки), «Оцінити» → скільки запитів до
 * Google це коштує → власник погоджує або міняє число й денну частку → «Почати». Будь-яка зміна параметрів скидає
 * оцінку: почати можна лише те, що оцінено (рішення власника 2026-11-19).
 */
export const NewCampaign: React.FC<{
  onStarted: (c: DovedeCampaign) => void;
}> = ({ onStarted }) => {
  const [presets, setPresets] = useState<DovedeCampaignPreset[] | null>(null);
  const [city, setCity] = useState<DovedeCampaignCity>("Zhytomyr");
  const [presetId, setPresetId] = useState("learn");
  const [form, setForm] = useState<FormState | null>(null);
  const [preview, setPreview] = useState<DovedeCampaignPreview | null>(null);
  const [budget, setBudget] = useState("");
  const [daily, setDaily] = useState("");
  const [busy, setBusy] = useState<"" | "preview" | "start">("");
  const [error, setError] = useState("");

  useEffect(() => {
    apiClient
      .getDovedeCampaignPresets()
      .then((r) => setPresets(r.presets))
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Не вдалося завантажити заготовки",
        ),
      );
  }, []);

  const forCity = useMemo(
    () => (presets ?? []).filter((p) => p.cities.some((c) => c.city === city)),
    [presets, city],
  );
  const preset = forCity.find((p) => p.id === presetId) ?? forCity[0];
  const defaults = preset?.cities.find((c) => c.city === city);

  // нова заготовка чи місто — параметри знову з заготовки
  useEffect(() => {
    if (defaults) setForm(fromPreset(defaults));
    setPreview(null);
  }, [defaults]);

  const change = (patch: Partial<FormState>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setPreview(null);
  };

  const options = (f: FormState): DovedeCampaignOptions => ({
    origins: f.origins,
    dirs: f.dirs,
    main: formatHours(f.main),
    extra: formatHours([...f.extra].filter((k) => !f.main.has(k))),
    maxDepth: f.maxDepth,
    ...(preset?.custom ? { places: f.places } : {}),
  });

  const estimate = async () => {
    if (!preset || !form) return;
    setBusy("preview");
    setError("");
    try {
      const r = await apiClient.previewDovedeCampaign({
        preset: preset.id,
        city,
        options: options(form),
      });
      setPreview(r);
      setBudget(String(r.estimate.budget));
      setDaily(String(r.estimate.dailyBudget));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося оцінити");
    } finally {
      setBusy("");
    }
  };

  const b = Number(budget);
  const d = Number(daily);
  const budgetOk = Number.isInteger(b) && b >= 1 && b <= MAX_BUDGET;
  const dailyOk = Number.isInteger(d) && d >= 1 && d <= MAX_DAILY;
  const days = budgetOk && dailyOk ? Math.ceil(b / Math.min(d, b)) : null;

  const start = async () => {
    if (!preset || !form || !preview || !budgetOk || !dailyOk) return;
    setBusy("start");
    setError("");
    try {
      const c = await apiClient.createDovedeCampaign({
        preset: preset.id,
        city,
        options: options(form),
        budget: b,
        dailyBudget: d,
      });
      setPreview(null);
      onStarted(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося почати");
    } finally {
      setBusy("");
    }
  };

  const noOrigins =
    Boolean(defaults?.origins.length) &&
    !preset?.ownSlots &&
    form?.origins.length === 0;
  const canEstimate = Boolean(
    preset &&
    form &&
    form.dirs.length &&
    form.main.size &&
    !noOrigins &&
    (!preset.custom || form.places.trim()),
  );
  const e = preview?.estimate;

  return (
    <section
      className="dv-learn-card dv-learn-new"
      aria-labelledby="dv-learn-new-title"
    >
      <h3 id="dv-learn-new-title">Нова кампанія</h3>
      {error ? (
        <p className="dovede-log-error" role="alert">
          {error}
        </p>
      ) : null}
      {!presets && !error ? (
        <p className="dovede-log-empty">Завантажую заготовки…</p>
      ) : null}
      {presets ? (
        <div className="dv-learn-new-grid">
          <div className="dv-learn-new-form">
            <div className="dv-learn-seg" role="radiogroup" aria-label="Місто">
              {CITIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={city === c.id}
                  className={city === c.id ? "is-on" : ""}
                  onClick={() => setCity(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>

            <div
              className="dv-learn-presets"
              role="radiogroup"
              aria-label="Заготовка"
            >
              {forCity.map((p) => (
                <label
                  key={p.id}
                  className={`dv-learn-preset${preset?.id === p.id ? " is-on" : ""}`}
                >
                  <input
                    type="radio"
                    name="dv-learn-preset"
                    checked={preset?.id === p.id}
                    onChange={() => setPresetId(p.id)}
                  />
                  <span>
                    <strong>{p.title}</strong>
                    <small>{p.help}</small>
                  </span>
                </label>
              ))}
            </div>

            {form && defaults ? (
              <div className="dv-learn-options">
                {preset?.custom ? (
                  <label className="dv-learn-field">
                    <span>
                      Місця — по одному в рядку, як написала б людина після «до{" "}
                      {city === "Kyiv" ? "Києва" : "Житомира"} до …»
                    </span>
                    <textarea
                      rows={5}
                      value={form.places}
                      onChange={(ev) => change({ places: ev.target.value })}
                    />
                  </label>
                ) : null}
                {defaults.origins.length && !preset?.ownSlots ? (
                  <fieldset className="dv-learn-checks">
                    <legend>Від яких точок</legend>
                    {defaults.points.map((pt) => (
                      <label key={pt.id}>
                        <input
                          type="checkbox"
                          checked={form.origins.includes(pt.id)}
                          onChange={() =>
                            change({ origins: toggle(form.origins, pt.id) })
                          }
                        />{" "}
                        {pt.label}
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                {preset?.ownSlots ? null : (
                  <fieldset className="dv-learn-checks">
                    <legend>Напрямок</legend>
                    <label>
                      <input
                        type="checkbox"
                        checked={form.dirs.includes("to")}
                        onChange={() =>
                          change({ dirs: toggle(form.dirs, "to") })
                        }
                      />{" "}
                      від точки до місця
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={form.dirs.includes("from")}
                        onChange={() =>
                          change({ dirs: toggle(form.dirs, "from") })
                        }
                      />{" "}
                      від місця до точки
                    </label>
                  </fieldset>
                )}
                {preset?.ownSlots ? (
                  <p className="dv-learn-hint">
                    Точки, напрямки й години — ті самі, що в застарілих
                    відповідях (тип дня й година кожної). Нових місць ця
                    заготовка не додає.
                  </p>
                ) : (
                  <>
                    <HoursGrid
                      label="Години для кожного місця"
                      value={form.main}
                      onChange={(main) => change({ main })}
                    />
                    <HoursGrid
                      label="Ще години — лише для місць, куди дорогу знайдено"
                      value={form.extra}
                      disabled={form.main}
                      onChange={(extra) => change({ extra })}
                    />
                    <label className="dv-learn-field dv-learn-field--inline">
                      <span>Нові місця з відповідей (зупинки й кінцеві)</span>
                      <select
                        value={form.maxDepth}
                        onChange={(ev) =>
                          change({ maxDepth: Number(ev.target.value) })
                        }
                      >
                        <option value={0}>не брати</option>
                        <option value={1}>на 1 крок</option>
                        <option value={2}>на 2 кроки</option>
                        <option value={3}>на 3 кроки</option>
                      </select>
                    </label>
                  </>
                )}
                <div>
                  <button
                    type="button"
                    className="admin-kit-btn"
                    disabled={!canEstimate || busy !== ""}
                    onClick={() => void estimate()}
                  >
                    {busy === "preview" ? "Рахую…" : "Оцінити"}
                  </button>
                  {noOrigins ? (
                    <span className="dv-learn-hint">
                      {" "}
                      Виберіть хоч одну точку.
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="dv-learn-estimate" aria-live="polite">
            {e && preview ? (
              <>
                <h4>{preview.title}: оцінка</h4>
                <StatTiles label="Оцінка кампанії">
                  <StatTile label="Місць" value={num(e.places)} />
                  <StatTile
                    label="Уже знаємо"
                    value={num(e.free)}
                    sub={`з ${num(e.asks)} питань`}
                  />
                  <StatTile
                    label="Треба спитати Google"
                    value={num(e.google)}
                  />
                  <StatTile
                    label="Запитів до Google усього"
                    value={
                      e.low === e.high
                        ? num(e.high)
                        : `${num(e.low)}–${num(e.high)}`
                    }
                  />
                </StatTiles>
                <p className="dv-learn-hint">
                  {e.maxDepth || e.extraSlots
                    ? `Перші питання пораховано точно за базою; ${[e.extraSlots ? "додаткові години" : "", e.maxDepth ? "нові місця з відповідей" : ""].filter(Boolean).join(" і ")} — оцінка «від і до».`
                    : "Пораховано точно за базою."}
                  {e.skipped
                    ? ` Пропустимо ${num(e.skipped)} (місце в архіві або не місце).`
                    : ""}{" "}
                  Сьогодні Google: {num(e.callsToday)} з {num(e.cap)};{" "}
                  {num(e.reserve)} лишаємо людям — кампанія їх не чіпає.
                </p>
                <div className="dv-learn-budget">
                  <label className="dv-learn-field">
                    <span>Погоджую запитів до Google</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_BUDGET}
                      value={budget}
                      aria-invalid={!budgetOk}
                      onChange={(ev) => setBudget(ev.target.value)}
                    />
                  </label>
                  <label className="dv-learn-field">
                    <span>З них на добу, не більше</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_DAILY}
                      value={daily}
                      aria-invalid={!dailyOk}
                      onChange={(ev) => setDaily(ev.target.value)}
                    />
                  </label>
                  <p className="dv-learn-hint">
                    {days
                      ? `≈ ${days} ${days === 1 ? "день" : days < 5 ? "дні" : "днів"}. `
                      : ""}
                    {budgetOk && b < e.low
                      ? "Менше за нижню оцінку — кампанія зупиниться, не пройшовши все; бюджет можна буде додати. "
                      : ""}
                    Скільки витрачено — видно в списку кампаній.
                  </p>
                </div>
                <button
                  type="button"
                  className="admin-kit-btn"
                  disabled={!budgetOk || !dailyOk || busy !== ""}
                  onClick={() => void start()}
                >
                  {busy === "start"
                    ? "Запускаю…"
                    : budgetOk
                      ? `Почати: до ${num(b)} запитів до Google`
                      : "Почати"}
                </button>
              </>
            ) : (
              <p className="dv-learn-hint">
                Оберіть заготовку й натисніть «Оцінити» — тут буде видно,
                скільки запитів до Google це коштує. Почати можна лише після
                оцінки.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
};
