/**
 * Облік реклами «Доведе» (Docs/dovede-roadmap.md, «Облік реклами»): події перегляду йдуть на POST /ads/events через
 * чергу outbox (без мережі на зупинці — дійдуть пізніше). viewId — один перегляд, clientId — той самий анонімний id
 * браузера, що в сканах наклейок. Помилки не заважають рекламі: облік — лише статистика.
 */
import { visitorId } from '@/analytics/visitorId';
import { sendOrQueue } from '@/pwa/outbox';
import type { AdEventBody } from '@/types';

export function newViewId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* немає crypto — нижче */
  }
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function trackAd(body: Omit<AdEventBody, 'clientId' | 'city'>): void {
  const clientId = visitorId() ?? undefined;
  void sendOrQueue('ad-event', { ...body, ...(clientId ? { clientId } : {}) }, `ad:${body.viewId}:${body.event}`).catch(() => {
    /* облік — не головне: 4xx чи немає сховища — подію просто втрачено */
  });
}
