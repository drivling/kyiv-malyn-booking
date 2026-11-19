import React from 'react';
import './kit.css';

export interface TableColumn<R> {
  key: string;
  /** заголовок і підпис клітинки в картці на телефоні; порожній — без підпису (кнопки) */
  label: string;
  /** числа — табличними цифрами */
  num?: boolean;
  render: (row: R) => React.ReactNode;
}

/**
 * Таблиця адмінки: на компʼютері — звичайна (гортається вбік у своїй обгортці, сторінка не їде), вужче за 640 px —
 * кожен рядок стає карткою з підписами клітинок (лише CSS, розмітка лишається таблицею).
 */
export function ResponsiveTable<R>({ columns, rows, rowKey, rowClassName, caption }: { columns: ReadonlyArray<TableColumn<R>>; rows: ReadonlyArray<R>; rowKey: (r: R) => string | number; rowClassName?: (r: R) => string | undefined; caption?: string }) {
  return (
    <div className="admin-kit-table-wrap">
      <table className="admin-kit-table">
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'is-num' : undefined} aria-label={c.label ? undefined : 'Дії'}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className={rowClassName?.(r)}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'is-num' : undefined} data-label={c.label || undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
