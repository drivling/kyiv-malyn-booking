import type { KyivNow, LocalParse } from '../nlu/types';
import { modeLabel, placeRefLabel, whenLabel } from './labels';

/** «Розумію: з [Київ · Святошин] до [Малин · вокзал] · [сьогодні] · [будь-яким транспортом]» (у фазі 3 — з правкою слотів) */
export function Understanding({ parse, now }: { parse: LocalParse; now: KyivNow }) {
  const { intent, unknownRole } = parse;
  const unknown = intent.unknown[0];
  const from = placeRefLabel(intent.from) ?? (unknownRole === 'from' && unknown ? `«${unknown}»?` : null);
  const to = placeRefLabel(intent.to) ?? (unknownRole === 'to' && unknown ? `«${unknown}»?` : null);
  const when = whenLabel(intent.when, now);
  const mode = modeLabel(intent.modes);
  const slot = (cls: string, text: string | null, empty: string, extra = '') => (
    <span className={`dv-slot dv-slot--${cls}${text ? extra : ' is-empty'}`}>{text ?? empty}</span>
  );
  return (
    <p className="dv-understanding" aria-label="Як зрозуміло питання">
      <span>Розумію:</span>
      <span>з</span>
      {slot('from', from, 'звідки?', !intent.from && from ? ' is-unknown' : '')}
      <span>до</span>
      {slot('to', to, 'куди?', !intent.to && to ? ' is-unknown' : '')}
      <span aria-hidden="true">·</span>
      {slot('when', when.text, '', when.guessed ? ' is-guess' : '')}
      <span aria-hidden="true">·</span>
      {slot('mode', mode.text, '', mode.guessed ? ' is-guess' : '')}
    </p>
  );
}
