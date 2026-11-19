import './kit.css';

export interface ChipOption<T extends string | number> {
  value: T;
  label: string;
}

/**
 * Ряд перемикачів одного вибору — лише для фільтрів і періодів («Сьогодні · 7 днів · 30 днів»), не для дій:
 * дія — кнопка (`admin-kit-btn`). Вибраний має `aria-pressed`.
 */
export function ChipGroup<T extends string | number>({ label, options, value, onChange }: { label: string; options: ReadonlyArray<ChipOption<T>>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="admin-kit-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={`admin-kit-chip${o.value === value ? ' is-on' : ''}`} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
