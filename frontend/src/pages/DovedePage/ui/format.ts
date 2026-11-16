import { routeNo } from '@/utils/routeNames';
import { clock } from '../compose/narrate';
import { maskSenderNameForDisplay } from '@/utils/nameMask';
import type { Story, StoryLeg } from '../compose/types';

type IntercityLeg = Extract<StoryLeg, { kind: 'intercity' }>;
type BusLeg = Extract<StoryLeg, { kind: 'bus' }>;
type RideLeg = Extract<StoryLeg, { kind: 'ride' }>;

export function durationText(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m} хв`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} год ${m % 60} хв` : `${h} год`;
}

export function metersText(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} км` : `${meters} м`;
}

/** Підпис варіанта для карток вибору й «інших варіантів» */
export function storySummary(story: Story): { title: string; sub: string; time: string } {
  const ic = story.legs.find((l): l is IntercityLeg => l.kind === 'intercity');
  const bus = story.legs.filter((l): l is BusLeg => l.kind === 'bus');
  const ride = story.legs.find((l): l is RideLeg => l.kind === 'ride');
  if (ride) {
    // «Попутка · Сергій»: імʼя скорочене, як на дошці сайту
    const who = ride.ride.name ? maskSenderNameForDisplay(ride.ride.name) : null;
    const sub = [`${clock(ride.depMins)} ${ride.boardLabel}`, bus.length ? `міський №${bus.map((b) => routeNo(b.routeId)).join(', №')}` : null, ride.ride.seats ? `місць: ${ride.ride.seats}` : null, story.priceUah ? `${story.priceUah} ₴` : null];
    return { title: who ? `Попутка · ${who}` : 'Попутка', sub: sub.filter(Boolean).join(' · '), time: clock(story.arriveMins, true) };
  }
  const title = story.mode === 'elektrichka' ? 'Електричка' : story.mode === 'marshrutka' ? 'Маршрутка' : `Автобус №${bus.map((b) => routeNo(b.routeId)).join(' → №') || ''}`;
  const parts: string[] = [];
  if (ic) parts.push(`${clock(ic.boardMins, ic.boardApprox)} ${ic.boardLabel}`);
  else if (bus[0]) parts.push(`о ${clock(bus[0].depMins)}`);
  if (ic && bus.length) parts.push(`пересадка на №${bus.map((b) => routeNo(b.routeId)).join(', №')}`);
  else if (ic) parts.push('без пересадок');
  if (story.priceUah) parts.push(`${story.priceUah} ₴`);
  return { title, sub: parts.join(' · '), time: clock(story.arriveMins, story.arriveApprox) };
}
