/**
 * «Доведе» · крок між розбором питання і відповіддю (Docs/dovede-geo-roadmap.md, Г1): «звідки» не названо, а місце
 * людини відоме — підставляємо його. Слова завжди мають перевагу; «Аргентина» (`far`) — не підставляємо; координати не
 * йдуть ні в Claude, ні в Google, ні в адресу сторінки: розбір Claude вже готовий, сюди приходить лише намір.
 */
import { resolvePlace } from '../nlu/places';
import type { PlaceRef, TripIntent } from '../nlu/types';
import { HERE_ID, type HereFix } from './here';

export type HereOutcome =
  /** підставили: `from` — місце людини */
  | { kind: 'used'; imprecise: boolean }
  /** людина далеко від міст, які знає сторінка */
  | { kind: 'far' }
  /** питання про місце іншого міста, ніж відкрите на сторінці: сторінці треба перемкнутися (Г3) */
  | { kind: 'other_city'; city: 'Malyn' | 'Korosten' }
  /** місце не потрібне чи не підходить: стара поведінка */
  | { kind: 'skip' };

export interface ApplyHereOptions {
  /** місто, відкрите на сторінці */
  pageCity: 'Malyn' | 'Korosten';
  /** чи знайдуться ці слова про Коростень у наших даних (`korostenSpot`) — інакше їх питали б у сервера, а там Google */
  isLocalKorosten?: (words: string) => boolean;
}

const TRIP_INTENTS = new Set<TripIntent['intent']>(['trip', 'schedule']);

export function applyHere(intent: TripIntent, fix: HereFix | null, opts: ApplyHereOptions): { intent: TripIntent; outcome: HereOutcome } {
  const skip = { intent, outcome: { kind: 'skip' } as HereOutcome };
  if (!fix || intent.from || !intent.to || !TRIP_INTENTS.has(intent.intent)) return skip;
  if (fix.city === 'far') return { intent, outcome: { kind: 'far' } };
  const to = resolvePlace(intent.to.id);
  if (!to) return skip;
  const local = opts.isLocalKorosten ?? (() => false);
  const used = (from: PlaceRef) => ({ intent: { ...intent, from }, outcome: { kind: 'used', imprecise: fix.imprecise } as HereOutcome });
  const here: PlaceRef = { id: HERE_ID, text: 'де я зараз' };

  switch (fix.city) {
    case 'Malyn':
      // на сторінці Коростеня людина з Малина — це коридор Малина, не місто Коростеня
      if (opts.pageCity === 'Korosten') return { intent, outcome: { kind: 'other_city', city: 'Malyn' } };
      // «до Малина», а людина вже в Малині — питання не про це
      if (to.isCity && to.city === 'Malyn') return skip;
      return used(here);
    case 'Korosten': {
      if (opts.pageCity === 'Korosten') {
        // інший кінець — слова, яких нема в наших даних: їх питали б у сервера разом із «звідки» — не підставляємо
        const words = intent.to.id === 'city.Korosten' ? (intent.to.detail ?? '').trim() : '';
        if (words && !local(words)) return skip;
        return used(here);
      }
      // на сторінці Малина: до Малина (чи далі) — від Коростеня; місце в Коростені — питання міста Коростеня
      if (to.city === 'Korosten') return { intent, outcome: { kind: 'other_city', city: 'Korosten' } };
      if (to.city !== 'Malyn') return skip;
      // без адреси: `detail` пішов би в адресу сторінки (`fd=`) — це вже місце людини в посиланні. Від вокзалу Коростеня
      return used({ id: 'city.Korosten', text: 'Коростень (де я зараз)' });
    }
    case 'Kyiv':
    case 'Zhytomyr':
      // координат станцій метро нема — «місто без місця», як «з Києва до Малина»; в межах того самого міста — ні
      if (to.city === fix.city) return skip;
      return used({ id: `city.${fix.city}`, text: fix.city === 'Kyiv' ? 'Київ (де я зараз)' : 'Житомир (де я зараз)' });
  }
}
