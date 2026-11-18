import { routeNoIn } from '@/utils/routeNames';
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
    const sub = [`${clock(ride.depMins)} ${ride.boardLabel}`, bus.length ? `міський №${bus.map((b) => routeNoIn(b.city, b.routeId)).join(', №')}` : null, ride.ride.seats ? `місць: ${ride.ride.seats}` : null, story.priceUah ? `${story.priceUah} ₴` : null];
    return { title: who ? `Попутка · ${who}` : 'Попутка', sub: sub.filter(Boolean).join(' · '), time: clock(story.arriveMins, true) };
  }
  if (story.mode === 'kyiv') {
    // у межах Києва: рейс електрички з точним часом або метро; автобус замість метро називаємо автобусом
    const ring = story.legs.find((l): l is Extract<StoryLeg, { kind: 'ring' }> => l.kind === 'ring');
    const segments = story.legs.flatMap((l) => (l.kind === 'metro' ? l.segments : []));
    const busNo = segments.find((sg) => sg.bus)?.bus ?? null;
    const train = segments.some((sg) => !sg.bus);
    const price = story.priceUah ? `${story.priceUah} ₴` : null;
    const time = clock(story.arriveMins, story.arriveApprox);
    if (!ring) {
      const title = !busNo ? 'Метро' : train ? `Метро й автобус №${busNo}` : `Автобус №${busNo} замість метро`;
      return { title, sub: [`≈ ${durationText(story.arriveMins - story.leaveMins)}`, price].filter(Boolean).join(' · '), time };
    }
    const rest = train && busNo ? `з метро й автобусом №${busNo}` : train ? 'з метро' : busNo ? `далі автобус №${busNo}` : 'без пересадок';
    return { title: `Міська електричка ${ring.ride.train}`, sub: [`${clock(ring.depMins)} з платформи «${ring.ride.from.name}»`, rest, price].filter(Boolean).join(' · '), time };
  }
  const title = story.mode === 'elektrichka' ? 'Електричка' : story.mode === 'marshrutka' ? 'Маршрутка' : `Автобус №${bus.map((b) => routeNoIn(b.city, b.routeId)).join(' → №') || ''}`;
  const parts: string[] = [];
  if (ic) parts.push(`${clock(ic.boardMins, ic.boardApprox)} ${ic.boardLabel}`);
  else if (bus[0]) parts.push(`о ${clock(bus[0].depMins)}`);
  if (ic && bus.length) parts.push(`пересадка на №${bus.map((b) => routeNoIn(b.city, b.routeId)).join(', №')}`);
  else if (ic) parts.push('без пересадок');
  if (story.priceUah) parts.push(`${story.priceUah} ₴`);
  return { title, sub: parts.join(' · '), time: clock(story.arriveMins, story.arriveApprox) };
}

export function stopsText(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} зупинка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} зупинки`;
  return `${n} зупинок`;
}

const DAY_MS = 24 * 3600_000;

/** «сьогодні», «вчора», «5 днів тому» — коли відповідь із нашої бази востаннє звіряли */
export function checkedAgo(fetchedAt: string, now = Date.now()): string {
  const t = Date.parse(fetchedAt);
  const days = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : 0;
  if (days === 0) return 'сьогодні';
  if (days === 1) return 'вчора';
  const mod10 = days % 10;
  const mod100 = days % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дні' : 'днів';
  return `${days} ${word} тому`;
}
