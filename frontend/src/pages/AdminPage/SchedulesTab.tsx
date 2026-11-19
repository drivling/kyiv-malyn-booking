import React, { useMemo, useState } from 'react';
import { Select } from '@/components/Select';
import type { Schedule } from '@/types';
import { getRouteLabel } from '@/utils/constants';
import { weekdaysLabel, isDaily } from '@/utils/weekdays';
import { AdminSectionHeader, ChipGroup, EmptyState, StatTile, StatTiles } from './kit';
import './SchedulesTab.css';

type Show = 'all' | 'marshrutka' | 'elektrichka' | 'noprice';

interface Group {
  key: string;
  label: string;
  rows: Schedule[];
  marshrutky: number;
  elektrychky: number;
  prices: number[];
  noPrice: number;
}

const isTrain = (s: Schedule) => s.vehicleType === 'elektrichka';

/** «Київ → Малин (через Ірпінь)» → напрямок «Київ → Малин» і «через Ірпінь» окремо */
function splitLabel(s: Schedule): { direction: string; via: string | null } {
  const label = s.tripRoute?.labelUk || getRouteLabel(s.route);
  const m = /^(.*?)\s*\((через [^)]+)\)\s*$/.exec(label);
  return m ? { direction: m[1], via: m[2] } : { direction: label, via: null };
}

const priceText = (prices: number[]) => {
  if (!prices.length) return null;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? `${lo} грн` : `${lo}–${hi} грн`;
};

export interface SchedulesTabProps {
  schedules: Schedule[];
  loading: boolean;
  routeOptions: Array<{ value: string; label: string }>;
  routeFilter: string;
  onRouteFilter: (slug: string) => void;
  onReload: () => void;
  onAdd: () => void;
  onEdit: (s: Schedule) => void;
  onDelete: (id: number) => void;
  onRebind: () => void;
  onParse: () => void;
  parsing: boolean;
  /** блок під списком (телефони «Зубастика») */
  footer?: React.ReactNode;
}

/**
 * «Графіки» (/admin/schedules): міжміські рейси — маршрутки й електрички — за напрямками. Зверху — скільки рейсів,
 * напрямків, без ціни й не щодня; фільтр за видом і «без ціни»; кожен напрямок — картка з кількістю й цінами, рейс —
 * один рядок: вид, час, «через …», номер, дні, місця, ціна, посадка; «Змінити» відкриває ту саму форму.
 */
export const SchedulesTab: React.FC<SchedulesTabProps> = ({
  schedules,
  loading,
  routeOptions,
  routeFilter,
  onRouteFilter,
  onReload,
  onAdd,
  onEdit,
  onDelete,
  onRebind,
  onParse,
  parsing,
  footer,
}) => {
  const [show, setShow] = useState<Show>('all');

  const noPriceTotal = schedules.filter((s) => s.priceUah == null).length;
  const notDaily = schedules.filter((s) => !isDaily(s.activeWeekdays)).length;

  const groups = useMemo(() => {
    const keep = (s: Schedule) => (show === 'all' ? true : show === 'noprice' ? s.priceUah == null : show === 'elektrichka' ? isTrain(s) : !isTrain(s));
    const byKey = new Map<string, Group>();
    for (const s of schedules) {
      if (!keep(s)) continue;
      const { direction } = splitLabel(s);
      const g = byKey.get(direction) ?? { key: direction, label: direction, rows: [], marshrutky: 0, elektrychky: 0, prices: [], noPrice: 0 };
      g.rows.push(s);
      if (isTrain(s)) g.elektrychky++;
      else g.marshrutky++;
      if (s.priceUah != null) g.prices.push(s.priceUah);
      else g.noPrice++;
      byKey.set(direction, g);
    }
    for (const g of byKey.values()) g.rows.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
    // більші напрямки вгорі, далі за назвою
    return [...byKey.values()].sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label, 'uk'));
  }, [schedules, show]);

  const directions = new Set(schedules.map((s) => splitLabel(s).direction)).size;

  return (
    <div className="sched-tab">
      <AdminSectionHeader
        title="Графіки"
        purpose="Міжміські рейси за напрямками: маршрутки й електрички. «Змінити» відкриває форму рейсу."
        actions={
          <>
            <button type="button" className="admin-kit-btn" onClick={onAdd}>
              Додати рейс
            </button>
            <button type="button" className="admin-kit-chip" onClick={onReload}>
              Оновити
            </button>
          </>
        }
      />

      <StatTiles label="Рейси">
        <StatTile label="Рейсів" value={schedules.length} />
        <StatTile label="Напрямків" value={directions} />
        <StatTile label="Без ціни" value={noPriceTotal} tone={noPriceTotal ? 'warn' : 'default'} />
        <StatTile label="Не щодня" value={notDaily} />
      </StatTiles>

      <div className="sched-toolbar">
        <ChipGroup
          label="Показати"
          options={[
            { value: 'all', label: 'Усі' },
            { value: 'marshrutka', label: 'Маршрутки' },
            { value: 'elektrichka', label: 'Електрички' },
            { value: 'noprice', label: `Без ціни${noPriceTotal ? ` · ${noPriceTotal}` : ''}` },
          ]}
          value={show}
          onChange={setShow}
        />
        <div className="sched-toolbar-route">
          <Select aria-label="Маршрут" options={[{ value: '', label: 'Усі маршрути' }, ...routeOptions]} value={routeFilter} onChange={(e) => onRouteFilter(e.target.value)} />
        </div>
        <span className="sched-toolbar-tools">
          <button type="button" className="admin-kit-linkbtn" disabled={parsing} onClick={onParse}>
            {parsing ? 'Парсинг…' : 'Оновити графіки через парсер'}
          </button>
          <button type="button" className="admin-kit-linkbtn" onClick={onRebind}>
            Перепривʼязати TripRoute
          </button>
        </span>
      </div>

      {loading ? (
        <p className="sched-note" aria-live="polite">
          Завантаження…
        </p>
      ) : schedules.length === 0 ? (
        <EmptyState
          action={
            <button type="button" className="admin-kit-btn" onClick={onAdd}>
              Додати перший рейс
            </button>
          }
        >
          Ще немає рейсів у графіку.
        </EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState>Таких рейсів немає.</EmptyState>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="sched-group" aria-label={g.label}>
            <header className="sched-group-head">
              <h3>{g.label}</h3>
              <span className="sched-note">
                {[g.marshrutky ? `маршрутки ${g.marshrutky}` : null, g.elektrychky ? `електрички ${g.elektrychky}` : null, priceText(g.prices)].filter(Boolean).join(' · ')}
              </span>
              {g.noPrice ? <span className="sched-flag">без ціни {g.noPrice}</span> : null}
            </header>
            <ul className="sched-rows">
              {g.rows.map((s) => {
                const { via } = splitLabel(s);
                const fkOff = s.tripRoute && s.tripRoute.slug !== s.route;
                const places = [s.boardingPlace, s.alightingPlace].filter(Boolean).join(' → ');
                return (
                  <li key={s.id} className="sched-row">
                    <span className={`sched-kind sched-kind--${isTrain(s) ? 'train' : 'bus'}`} title={isTrain(s) ? 'Електричка' : 'Маршрутка'}>
                      {isTrain(s) ? 'Е' : 'М'}
                    </span>
                    <span className="sched-time">
                      <strong>{s.departureTime}</strong>
                      {s.arrivalTime ? <small> → {s.arrivalTime}</small> : null}
                    </span>
                    <span className="sched-what">
                      <span className="sched-tags">
                        {via ? <span className="sched-tag">{via}</span> : null}
                        {s.tripNumber ? (
                          <span className="sched-tag" title={s.timetableSourceUrl ?? undefined}>
                            №{s.tripNumber}
                            {s.timetableSourceUrl ? ' 🔗' : ''}
                          </span>
                        ) : null}
                        {!isDaily(s.activeWeekdays) ? <span className="sched-tag sched-tag--days">{weekdaysLabel(s.activeWeekdays)}</span> : null}
                        {fkOff ? (
                          <span className="sched-flag" title={`slug ${s.route}, TripRoute ${s.tripRoute?.slug}`}>
                            FK≠route
                          </span>
                        ) : null}
                      </span>
                      {places ? <small className="sched-places">{places}</small> : null}
                    </span>
                    <span className="sched-meta">
                      {isTrain(s) ? null : <span className="sched-note">{s.maxSeats} місць</span>}
                      {s.priceUah != null ? <strong>{s.priceUah} грн</strong> : <span className="sched-flag">без ціни</span>}
                    </span>
                    <span className="sched-actions">
                      <button type="button" className="admin-kit-linkbtn" onClick={() => onEdit(s)} aria-label={`Змінити рейс ${s.departureTime} ${g.label}`}>
                        Змінити
                      </button>
                      <button type="button" className="admin-kit-dangerbtn" onClick={() => onDelete(s.id)} aria-label={`Видалити рейс ${s.departureTime} ${g.label}`} title="Видалити рейс">
                        ×
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {footer}
    </div>
  );
};
