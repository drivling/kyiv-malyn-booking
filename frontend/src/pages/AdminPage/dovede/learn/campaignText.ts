/** Стан кампанії навчання словами й тоном плашки (розділ «Навчання» і «Огляд») */
import type { DovedeCampaign, DovedeCampaignPlanView } from '@/types';
import type { StatusTone } from '../../kit';
import { hoursText } from './hours';

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
  return [
    p.origins.length ? `від: ${p.origins.map((o) => o.label).join(', ')}` : null,
    p.dirs.length === 2 ? 'туди й назад' : p.dirs.map((d) => DIRS[d] ?? d).join(', '),
    `${hoursText(p.main)}${p.extra ? `; для знайдених ще ${hoursText(p.extra)}` : ''}`,
    p.maxDepth ? `нові місця з відповідей: ${p.maxDepth} ${p.maxDepth === 1 ? 'крок' : 'кроки'}` : 'без нових місць',
  ]
    .filter(Boolean)
    .join(' · ');
}

export const num = (n: number) => n.toLocaleString('uk-UA');
