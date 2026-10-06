import { useId, useState } from 'react';
import { niceMax, opensLabel } from './scanStats';

export type ScanBar = {
  key: string;
  /** Підпис на осі X (показується вибірково) */
  label: string;
  /** Повна назва стовпчика для підказки й таблиці: «06.10, пн» / «08:00–09:00» */
  name: string;
  value: number;
};

/**
 * Стовпчики однієї серії (відкриття з QR по добах або годинах). Без легенди — назву серії несе
 * заголовок; одна барва; стовпчик ≤ 24 px з округленим верхом, проміжок 2 px; наведення або фокус
 * на стовпчику показує значення в рядку над графіком; ті самі значення — у таблиці під графіком.
 */
export function ScanBars({ title, bars, labelEvery = 1 }: { title: string; bars: ScanBar[]; labelEvery?: number }) {
  const [active, setActive] = useState<string | null>(null);
  const tableId = useId();
  const top = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  const peak = bars.reduce<ScanBar | null>((best, b) => (b.value > (best?.value ?? 0) ? b : best), null);
  const shown = bars.find((b) => b.key === active) ?? null;
  return (
    <figure className="scan-chart" style={{ ['--scan-bars' as string]: bars.length }}>
      <figcaption className="scan-chart-head">
        <span className="scan-chart-title">{title}</span>
        <span className="scan-chart-readout" aria-live="polite">
          {shown ? (
            <>
              <strong>{opensLabel(shown.value)}</strong> · {shown.name}
            </>
          ) : peak ? (
            <>
              найбільше <strong>{peak.value}</strong> · {peak.name}
            </>
          ) : (
            'відкриттів ще немає'
          )}
        </span>
      </figcaption>
      <div className="scan-chart-plot">
        <div className="scan-chart-y" aria-hidden="true">
          <span>{top}</span>
          <span>0</span>
        </div>
        <div className="scan-chart-bars">
          {bars.map((b) => (
            <button
              key={b.key}
              type="button"
              className={`scan-chart-slot${b.key === active ? ' scan-chart-slot--active' : ''}`}
              aria-label={`${b.name}: ${opensLabel(b.value)}`}
              aria-describedby={tableId}
              onMouseEnter={() => setActive(b.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(b.key)}
              onBlur={() => setActive(null)}
            >
              {b.value > 0 && <span className="scan-chart-bar" style={{ height: `${(b.value / top) * 100}%` }} />}
            </button>
          ))}
        </div>
      </div>
      <div className="scan-chart-x" aria-hidden="true">
        {bars.map((b, i) => (
          <span key={b.key}>{i % labelEvery === 0 || i === bars.length - 1 ? b.label : ''}</span>
        ))}
      </div>
      <details className="scan-chart-table">
        <summary>Таблицею</summary>
        <table id={tableId}>
          <thead>
            <tr>
              <th scope="col">{title}</th>
              <th scope="col">Відкриттів</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.key}>
                <td>{b.name}</td>
                <td>{b.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
