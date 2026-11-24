/**
 * Місто датасету міського транспорту (Docs/transport-tenancy-2026-11.md). Усі транспортні таблиці мають
 * колонку cityCode (TripPoint.code); запит без ?city= — Малин, і для нього нічого не змінюється.
 * Інше місто публічно доступне лише після ввімкнення TripPoint.hasLocalTransport («Маршрути» в адмінці);
 * до того його дані бачить тільки адмін.
 */
import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { getCatalog } from './catalog-cache';
import { isAdminRequest } from './middleware/require-admin';
import { SITES } from './site-domains';
import { DEFAULT_TRANSPORT_CITY } from './transport-city-code';

export { DEFAULT_TRANSPORT_CITY };

/**
 * ?city= / body.city → канонічний код міста. Порожньо — Малин; інакше код міста з транспортом (site-domains.ts,
 * `transport`; домен може бути ще не підключено), без урахування регістру. null — такого міста нема.
 */
export function parseTransportCity(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TRANSPORT_CITY;
  if (typeof raw !== 'string') return null;
  const wanted = raw.trim().toLowerCase();
  if (!wanted) return DEFAULT_TRANSPORT_CITY;
  const site = Object.values(SITES).find((s) => s.transport && s.cityCode.toLowerCase() === wanted);
  return site ? site.cityCode : null;
}

export interface TransportCityAccess {
  cityCode: string;
  /** Місто без параметра (Малин) — поведінка як до появи міст */
  isDefault: boolean;
  /** Місто ще не опубліковане: відповідь бачить лише адмін, кешувати її не можна */
  adminOnly: boolean;
}

/**
 * Чи можна цьому запиту читати / писати дані міста. null — відповідати 404 (нема такого міста або воно ще
 * не опубліковане, а запит не від адміна). Малин не потребує звернення до бази.
 */
export async function resolveTransportCity(prisma: PrismaClient, req: Request, raw: unknown): Promise<TransportCityAccess | null> {
  const cityCode = parseTransportCity(raw);
  if (!cityCode) return null;
  if (cityCode === DEFAULT_TRANSPORT_CITY) return { cityCode, isDefault: true, adminOnly: false };
  const point = (await getCatalog(prisma)).pointByCode(cityCode) as { hasLocalTransport?: boolean } | undefined;
  if (point?.hasLocalTransport === true) return { cityCode, isDefault: false, adminOnly: false };
  return isAdminRequest(req) ? { cityCode, isDefault: false, adminOnly: true } : null;
}
