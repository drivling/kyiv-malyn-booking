import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import type { TransportDataset } from '@/api/transportDataset';
import { Button } from '@/components/Button';
import { Combobox, type ComboboxOption } from '@/components/Combobox/Combobox';
import { prettyStopName, sideHeading, splitSides, stickerLines, type StickerLine } from './stopSticker/stickerModel';
import {
  buildStickerSheets,
  downloadStickerSvg,
  printStickerSheets,
  stickerPrintHtml,
  type StickerAssign,
  type StickerLayout,
  type StickerSideKey,
} from './stopSticker/stickerSheets';
import { renderStickerSvg, type StickerSize } from './stopSticker/stickerSvg';
import './StopStickerTab.css';

/** Стрілка напрямку руху: ↑ повернута на кут (0° — схід) */
function BearingArrow({ bearing }: { bearing: number }) {
  return (
    <span className="sticker-tab-bearing" style={{ transform: `rotate(${Math.round(90 - bearing)}deg)` }} aria-hidden="true">
      ↑
    </span>
  );
}

function fareOf(dataset: TransportDataset | null): number | null {
  const fare = dataset?.meta?.fare as { amount?: unknown } | undefined;
  return typeof fare?.amount === 'number' ? fare.amount : null;
}

const SIDE_LABEL: Record<StickerAssign, string> = { a: 'Бік 1', b: 'Бік 2', off: 'Не друкувати' };

/**
 * «Наклейки зупинок» (/admin/stickers?stop=<id>): наклейка на фізичну зупинку у стилі схеми —
 * назва, лінії з напрямком, QR на табло. Датасет часто описує обидва боки дороги однією
 * зупинкою, тому лінії розкладаються на два боки за напрямком руху, а адмін може їх перекинути.
 */
export const StopStickerTab: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const stopId = searchParams.get('stop') ?? '';
  const [dataset, setDataset] = useState<TransportDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [title, setTitle] = useState('');
  const [assign, setAssign] = useState<Record<string, StickerAssign>>({});
  const [headings, setHeadings] = useState<Record<StickerSideKey, string>>({ a: '', b: '' });
  const [layout, setLayout] = useState<StickerLayout>('split');
  const [showOpposite, setShowOpposite] = useState(true);
  const [size, setSize] = useState<StickerSize>('A5');

  useEffect(() => {
    let alive = true;
    apiClient
      .getTransportDataset()
      .then((d) => {
        if (alive) setDataset(d);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Не вдалося завантажити дані транспорту');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const stopOptions = useMemo<ComboboxOption[]>(() => {
    if (!dataset) return [];
    return dataset.stops
      .map((s) => ({ s, lines: stickerLines(dataset, s.id) }))
      .filter(({ lines }) => lines.length > 0)
      .map(({ s, lines }) => ({
        value: s.id,
        label: `${prettyStopName(s.name)} — №${[...new Set(lines.map((l) => l.routeId))].join(', №')}`,
      }))
      .sort((x, y) => x.label.localeCompare(y.label, 'uk'));
  }, [dataset]);

  const stop = dataset?.stops.find((s) => s.id === stopId) ?? null;
  const lines = useMemo<StickerLine[]>(() => (dataset && stop ? stickerLines(dataset, stop.id) : []), [dataset, stop]);

  // нова зупинка — автоматичний розподіл по боках, назва й підписи з даних
  useEffect(() => {
    const sides = splitSides(lines);
    const next: Record<string, StickerAssign> = {};
    for (const l of lines) next[l.key] = sides.b.includes(l.key) ? 'b' : 'a';
    setAssign(next);
    const pick = (keys: string[]) => lines.filter((l) => keys.includes(l.key));
    setHeadings({ a: sideHeading(pick(sides.a)), b: sideHeading(pick(sides.b)) });
    setTitle(stop ? prettyStopName(stop.name) : '');
    setLayout(sides.b.length ? 'split' : 'single');
  }, [lines, stop]);

  const selectStop = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set('stop', id);
      else next.delete('stop');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const sheets = useMemo(
    () =>
      stop
        ? buildStickerSheets({ stopId: stop.id, title, lines, assign, headings, layout, showOpposite, size, fare: fareOf(dataset) })
        : [],
    [stop, title, lines, assign, headings, layout, showOpposite, size, dataset]
  );
  const previews = useMemo(() => sheets.map((s) => ({ ...s, svg: renderStickerSvg(s.spec) })), [sheets]);
  const hasB = lines.some((l) => assign[l.key] === 'b');

  if (loading) return <div className="sticker-tab-status">Завантаження зупинок…</div>;
  if (error) return <div className="sticker-tab-status sticker-tab-status--error">{error}</div>;

  return (
    <div className="tab-content sticker-tab">
      <p className="sticker-tab-intro">
        Наклейка на зупинку у стилі схеми маршрутів: назва, лінії з напрямком і QR-код на табло цієї зупинки (найближчі
        відправлення). Якщо обидва боки дороги в даних — одна зупинка, лінії розкладено на два боки за напрямком руху;
        перевірте розподіл на місці.
      </p>

      <div className="sticker-tab-controls">
        <div className="sticker-tab-stop">
          <Combobox
            id="sticker-stop"
            label="Зупинка"
            options={stopOptions}
            value={stopId}
            onChange={() => undefined}
            onSelectOption={selectStop}
            onClear={() => selectStop('')}
            clearable
            placeholder="Почніть вводити назву зупинки"
            emptyMessage="Немає зупинки з такою назвою"
          />
        </div>
        <label className="sticker-tab-field">
          <span>Формат</span>
          <select value={size} onChange={(e) => setSize(e.target.value as StickerSize)}>
            <option value="A5">A5 (148 × 210 мм)</option>
            <option value="A4">A4 (210 × 297 мм)</option>
          </select>
        </label>
      </div>

      {stop && (
        <>
          <div className="sticker-tab-controls">
            <label className="sticker-tab-field sticker-tab-field--wide">
              <span>Назва на наклейці</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </div>

          <fieldset className="sticker-tab-fieldset">
            <legend>Лінії й боки дороги</legend>
            <table className="sticker-tab-lines">
              <thead>
                <tr>
                  <th scope="col">Лінія</th>
                  <th scope="col">Рух</th>
                  <th scope="col">Куди / через</th>
                  <th scope="col">Бік</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <span className="sticker-tab-badge" style={{ background: l.color ?? '#1b1f2a' }}>
                        {l.routeId}
                      </span>
                    </td>
                    <td>
                      <BearingArrow bearing={l.bearing} />
                    </td>
                    <td>
                      <strong>→ {l.destination}</strong>
                      {l.via.length > 0 && <div className="sticker-tab-muted">через {l.via.map((v) => v.name).join(' · ')}</div>}
                    </td>
                    <td>
                      <div className="sticker-tab-assign" role="radiogroup" aria-label={`№${l.routeId} → ${l.destination}: бік`}>
                        {(['a', 'b', 'off'] as const).map((k) => (
                          <label key={k}>
                            <input
                              type="radio"
                              name={`sticker-side-${l.key}`}
                              checked={(assign[l.key] ?? 'off') === k}
                              onChange={() => setAssign((prev) => ({ ...prev, [l.key]: k }))}
                            />
                            {SIDE_LABEL[k]}
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sticker-tab-controls">
              <label className="sticker-tab-field">
                <span>Напрямок боку 1</span>
                <input value={headings.a} onChange={(e) => setHeadings((h) => ({ ...h, a: e.target.value }))} placeholder="без підпису" />
              </label>
              <label className="sticker-tab-field">
                <span>Напрямок боку 2</span>
                <input value={headings.b} onChange={(e) => setHeadings((h) => ({ ...h, b: e.target.value }))} placeholder="без підпису" />
              </label>
            </div>
            <div className="sticker-tab-options" role="radiogroup" aria-label="Скільки наклейок">
              <label>
                <input type="radio" name="sticker-layout" checked={layout === 'split'} onChange={() => setLayout('split')} />
                Окрема наклейка на кожен бік
              </label>
              <label>
                <input type="radio" name="sticker-layout" checked={layout === 'single'} onChange={() => setLayout('single')} />
                Одна наклейка з обома боками
              </label>
              {layout === 'split' && hasB && (
                <label>
                  <input type="checkbox" checked={showOpposite} onChange={(e) => setShowOpposite(e.target.checked)} />
                  Показати лінії протилежного боку
                </label>
              )}
            </div>
          </fieldset>

          <div className="sticker-tab-actions">
            <Button
              type="button"
              onClick={() => printStickerSheets(stickerPrintHtml(sheets, size, title))}
              disabled={!sheets.length}
            >
              Друкувати ({sheets.length} {sheets.length === 1 ? 'аркуш' : 'аркуші'} {size})
            </Button>
            <span className="sticker-tab-muted">
              Масштаб друку — 100 %, без полів. Для друкарні: «Друкувати» → «Зберегти як PDF» (шрифт вбудовано).
            </span>
          </div>

          <div className="sticker-tab-previews">
            {previews.map((p) => (
              <figure key={p.key} className="sticker-tab-preview">
                <figcaption>{p.label}</figcaption>
                <div className="sticker-tab-sheet" dangerouslySetInnerHTML={{ __html: p.svg }} />
                <Button type="button" variant="secondary" onClick={() => downloadStickerSvg(p, stop.id)}>
                  Завантажити SVG
                </Button>
              </figure>
            ))}
            {!previews.length && <p className="sticker-tab-muted">Жодна лінія не обрана для друку.</p>}
          </div>
        </>
      )}
    </div>
  );
};
