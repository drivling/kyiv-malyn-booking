import type { KyivNow, LocalParse } from '../nlu/types';
import { routeNo } from '@/utils/routeNames';
import { modeLabel, placeRefLabel, whenLabel } from './labels';
import type { SlotKind } from './SlotSheet';

const EDIT_LABEL: Record<SlotKind, string> = { from: 'Змінити, звідки', to: 'Змінити, куди', when: 'Змінити час', mode: 'Змінити вид транспорту' };

/**
 * «Розумію: з [Київ · Святошин] до [Малин · вокзал] · [сьогодні] · [будь-яким транспортом]».
 * Кожен слот — кнопка: натиснули — вибрали інше (SlotSheet), відповідь перебудувалась.
 */
export function Understanding({ parse, now, onEdit }: { parse: LocalParse; now: KyivNow; onEdit?: (slot: SlotKind) => void }) {
  const { intent, unknownRole } = parse;
  const unknown = intent.unknown[0];
  const from = placeRefLabel(intent.from) ?? (unknownRole === 'from' && unknown ? `«${unknown}»?` : null);
  const to = placeRefLabel(intent.to) ?? (unknownRole === 'to' && unknown ? `«${unknown}»?` : null);
  const when = whenLabel(intent.when, now);
  const mode = modeLabel(intent.modes, (intent.routes ?? []).map((id) => routeNo(id)), (intent.avoidRoutes ?? []).map((id) => routeNo(id)));
  const slot = (kind: SlotKind, text: string | null, empty: string, extra = '') => {
    const cls = `dv-slot dv-slot--${kind}${text ? extra : ' is-empty'}`;
    if (!onEdit) return <span className={cls}>{text ?? empty}</span>;
    return (
      <button type="button" className={cls} onClick={() => onEdit(kind)} aria-label={`${EDIT_LABEL[kind]}: ${text ?? empty}`}>
        {text ?? empty}
      </button>
    );
  };
  return (
    <p className="dv-understanding" aria-label="Як зрозуміло питання">
      <span>Розумію:</span>
      <span>з</span>
      {slot('from', from, 'звідки?', !intent.from && from ? ' is-unknown' : '')}
      <span>до</span>
      {slot('to', to, 'куди?', !intent.to && to ? ' is-unknown' : '')}
      {slot('when', when.text, '', when.guessed ? ' is-guess' : '')}
      {slot('mode', mode.text, '', mode.guessed ? ' is-guess' : '')}
    </p>
  );
}
