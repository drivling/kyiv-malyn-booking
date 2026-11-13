import { useEffect, useRef } from 'react';
import { CITY_LABEL, PLACES, type PlaceCity } from '../nlu/gazetteer';
import type { TripIntent } from '../nlu/types';

export type SlotKind = 'from' | 'to' | 'when' | 'mode';

interface Option {
  key: string;
  title: string;
  sub?: string;
  patch: Partial<TripIntent>;
  current: boolean;
}

const CITY_ORDER: PlaceCity[] = ['Malyn', 'Kyiv', 'Zhytomyr', 'Korosten', 'Irpin', 'Bucha'];

const TITLE: Record<SlotKind, string> = { from: 'Звідки вирушаєте?', to: 'Куди їдете?', when: 'Коли?', mode: 'Чим їхати?' };

function placeOptions(slot: 'from' | 'to', intent: TripIntent): Array<{ group: string; options: Option[] }> {
  const currentId = intent[slot]?.id ?? null;
  const groups = CITY_ORDER.map((city) => ({
    group: CITY_LABEL[city],
    options: PLACES.filter((p) => p.city === city)
      .sort((a, b) => Number(b.isCity ?? false) - Number(a.isCity ?? false) || a.label.localeCompare(b.label, 'uk'))
      .map((p) => ({
        key: p.id,
        title: p.isCity ? `${p.label} — місто загалом` : p.label,
        // вибране місце знімає «не знаю, де це» для слова, що стояло на його місці
        patch: { [slot]: { id: p.id, text: p.label }, unknown: [], intent: 'trip' } as Partial<TripIntent>,
        current: p.id === currentId,
      })),
  })).filter((g) => g.options.length);
  // малі міста коридору — одним списком
  const main = groups.filter((g) => g.group === 'Малин' || g.group === 'Київ');
  const rest = groups.filter((g) => !main.includes(g)).flatMap((g) => g.options.map((o) => ({ ...o, title: o.title.replace(' — місто загалом', '') })));
  return rest.length ? [...main, { group: 'Інші міста', options: rest }] : main;
}

function whenOptions(intent: TripIntent): Option[] {
  const w = intent.when;
  const is = (day: string, part?: string) => !w.time && w.day === day && (w.part ?? null) === (part ?? null);
  const opt = (key: string, title: string, sub: string, day: string, part?: 'morning' | 'day' | 'evening'): Option => ({
    key,
    title,
    sub,
    patch: { when: part ? { day, kind: 'depart', part } : { day, kind: 'depart' } },
    current: is(day, part),
  });
  return [
    opt('now', 'Зараз, найближчі', 'сьогодні від цієї хвилини', 'today'),
    opt('today-evening', 'Сьогодні ввечері', '17:00–23:00', 'today', 'evening'),
    opt('tomorrow-morning', 'Завтра зранку', '05:00–11:00', 'tomorrow', 'morning'),
    opt('tomorrow-day', 'Завтра вдень', '11:00–17:00', 'tomorrow', 'day'),
    opt('tomorrow-evening', 'Завтра ввечері', '17:00–23:00', 'tomorrow', 'evening'),
  ];
}

function modeOptions(intent: TripIntent): Option[] {
  const cur = intent.modes.join(',');
  const opt = (key: string, title: string, sub: string, modes: TripIntent['modes']): Option => ({ key, title, sub, patch: { modes }, current: cur === modes.join(',') });
  return [
    opt('any', 'Будь-яким транспортом', 'покажу найкраще', []),
    opt('marshrutka', 'Маршруткою', 'Київ ↔ Малин', ['marshrutka']),
    opt('elektrichka', 'Електричкою', 'Київ ↔ Малин', ['elektrichka']),
    opt('city_bus', 'Міським автобусом', 'у межах Малина', ['city_bus']),
  ];
}

/**
 * Правка одного слота рядка «Розумію…» (Docs/dovede-roadmap.md, фаза 3): на телефоні — панель знизу, на
 * широкому екрані — вікно по центру. Вибір одразу дає нову відповідь; Claude для цього не потрібен.
 */
export function SlotSheet({ slot, intent, onPick, onClose }: { slot: SlotKind; intent: TripIntent; onPick: (patch: Partial<TripIntent>) => void; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = panel.current;
    (el?.querySelector<HTMLElement>('[aria-current="true"]') ?? el?.querySelector<HTMLElement>('button'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  const groups = slot === 'from' || slot === 'to' ? placeOptions(slot, intent) : [{ group: '', options: slot === 'when' ? whenOptions(intent) : modeOptions(intent) }];
  const titleId = `dv-sheet-${slot}`;

  return (
    <div className="dv-sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dv-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}>
        <div className="dv-sheet__head">
          <h2 id={titleId}>{TITLE[slot]}</h2>
          <button type="button" className="dv-sheet__close" onClick={onClose} aria-label="Закрити">
            ×
          </button>
        </div>
        <div className="dv-sheet__body">
          {groups.map((g) => (
            <section key={g.group || 'all'}>
              {g.group ? <h3>{g.group}</h3> : null}
              <div className="dv-sheet__list">
                {g.options.map((o) => (
                  <button key={o.key} type="button" className={`dv-sheet__opt${o.current ? ' is-current' : ''}`} aria-current={o.current ? 'true' : undefined} onClick={() => onPick(o.patch)}>
                    <span className="dv-sheet__opt-title">{o.title}</span>
                    {o.sub ? <span className="dv-sheet__opt-sub">{o.sub}</span> : null}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
