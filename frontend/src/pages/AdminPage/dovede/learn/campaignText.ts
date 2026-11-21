/** Стан кампанії навчання словами й тоном плашки (розділ «Навчання» і «Огляд») */
import type { DovedeCampaign, DovedeCampaignPlanView, DovedeCheckReport, DovedeCheckVerdict } from '@/types';
import type { StatusTone } from '../../kit';
import { hoursText } from './hours';

/** Найбільша денна частка кампанії — та сама межа, що `MAX_DAILY_BUDGET` на сервері */
export const MAX_DAILY = 5_000;

export const WAIT_REASON: Record<string, string> = {
  cap: 'за день витрачено ліміт Google мінус запас для людей',
  daily: 'денну частку кампанії витрачено',
  quota: 'Google відповів «квоту вичерпано»',
  denied: 'Google відмовив у доступі (ключ, API або білінг)',
  errors: 'Google кілька разів не відповів',
  disabled: 'пошук містом вимкнено або немає ключа Google',
  people: 'людям відмовляли через ліміт',
};

const time = (iso: string) => new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export const isActive = (c: Pick<DovedeCampaign, 'status'>) => c.status === 'running' || c.status === 'waiting';
export const isOpen = (c: Pick<DovedeCampaign, 'status'>) => isActive(c) || c.status === 'paused';

/** [тон, коротко, пояснення] */
export function campaignState(c: DovedeCampaign): [StatusTone, string, string] {
  if (c.status === 'running' && c.queuedBehind) return ['off', 'У черзі', `після «${c.queuedBehind.title}» — сервер веде одну кампанію за раз`];
  if (c.status === 'running') return ['busy', 'Іде', ''];
  if (c.status === 'waiting') return ['warn', 'Чекає', `${WAIT_REASON[c.waitReason ?? ''] ?? c.waitReason ?? ''}${c.waitUntil ? ` — продовжить ${time(c.waitUntil)}` : ''}`];
  if (c.status === 'paused') return ['off', 'На паузі', ''];
  if (c.status === 'cancelled') return ['off', 'Скасовано', c.finishedAt ? time(c.finishedAt) : ''];
  if (c.status === 'done' && c.stopReason === 'budget') return ['warn', 'Бюджет вичерпано', `у черзі ще питань: ${c.left}`];
  if (c.status === 'done') return ['ok', 'Завершено', c.finishedAt ? time(c.finishedAt) : ''];
  return ['off', c.status, ''];
}

const DIRS: Record<string, string> = { to: 'туди', from: 'назад' };

/** «від автовокзал Житомир-1 · туди й назад · будні 09:00; для знайдених ще будні 17:00 · глибина 2» */
export function planText(p: DovedeCampaignPlanView): string {
  if (p.check) return `пар зупинок свого розкладу: ${num(p.seeds)} · година — коли маршрут їде · розклад не міняється`;
  if (p.ownSlots) return `застарілих відповідей: місць ${num(p.seeds)} · години — як у застарілих відповідях · без нових місць`;
  return [
    p.origins.length ? `від: ${p.origins.map((o) => o.label).join(', ')}` : null,
    p.dirs.length === 2 ? 'туди й назад' : p.dirs.map((d) => DIRS[d] ?? d).join(', '),
    p.ownSlots ? 'години — як у застарілих відповідях' : `${hoursText(p.main)}${p.extra ? `; для знайдених ще ${hoursText(p.extra)}` : ''}`,
    p.maxDepth ? `нові місця з відповідей: ${p.maxDepth} ${p.maxDepth === 1 ? 'крок' : 'кроки'}` : 'без нових місць',
  ]
    .filter(Boolean)
    .join(' · ');
}

export const num = (n: number) => n.toLocaleString('uk-UA');

/** Вердикти звірки свого розкладу з Google — словами, у порядку показу */
export const CHECK_VERDICT: Record<DovedeCheckVerdict, string> = {
  same: 'Збігається',
  google_faster: 'Google швидше',
  ours_faster: 'Наше швидше',
  other_line: 'Інша лінія',
  walk: 'Лише пішки',
  none: 'Дороги немає',
};
export const CHECK_ORDER = Object.keys(CHECK_VERDICT) as DovedeCheckVerdict[];

/** «наше 5 хв, Google 12 хв (+7)» / «Google їде №7» / «Google радить іти пішки» */
export function checkRowText(r: DovedeCheckReport['rows'][number]): string {
  if (r.verdict === 'none') return 'Google не знає дороги транспортом';
  if (r.verdict === 'walk') return 'Google радить іти пішки';
  if (r.verdict === 'other_line') return `Google їде ${r.googleLines?.length ? r.googleLines.map((l) => `№${l}`).join(' + ') : 'іншим транспортом'}`;
  const diff = (r.googleMin ?? 0) - (r.ownMin ?? 0);
  return `№${r.routeNo}: наше ${r.ownMin} хв, Google ${r.googleMin} хв (${diff > 0 ? '+' : '−'}${Math.abs(diff)})`;
}

/**
 * Посилання «Відкрити як людина»: та сама пара, що в базі, — сторінка спитає сервер так само, як людина.
 * Київ: точка (метро, вокзал) — своїм id, місце словами (`f=` / `t=city.Kyiv&td=`); Житомир: поїздка з Малина, бо
 * сторінка питає дорогу містом від автовокзалу Житомир-1 саме так.
 */
export function humanLink(item: { city: string; label: string }, route: { origin: string; dir: string }): string {
  const q = new URLSearchParams();
  const point = item.city === 'Zhytomyr' ? 'malyn.avtostantsiya' : route.origin;
  const place = `city.${item.city}`;
  if (route.dir === 'from') {
    q.set('f', place);
    q.set('fd', item.label);
    q.set('t', point);
  } else {
    q.set('f', point);
    q.set('t', place);
    q.set('td', item.label);
  }
  return `/dovede?${q.toString()}`;
}
