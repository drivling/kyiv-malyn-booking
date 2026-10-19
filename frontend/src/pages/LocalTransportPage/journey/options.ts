/**
 * Параметри пошуку поїздок з пересадками. Числа підібрані звіркою з Transitous (MOTIS) на тому ж GTFS —
 * див. Docs/transport-journey-planner-2026-10.md; змінювати разом із повторною звіркою.
 */
export interface JourneyOptions {
  /** Мінімум на пересадку, хв: буфер на тій самій зупинці і нижня межа для пішого переходу */
  minTransferMin: number;
  /** Швидкість пішки, м/с (pedestrianSpeed у MOTIS) */
  walkSpeedMps: number;
  /** Коефіцієнт «вулиця довша за пряму»: пішки йдуть не по прямій */
  detourFactor: number;
  /** Найдовший піший перехід між зупинками, м (за прямою) */
  maxTransferWalkM: number;
  /** Найдовший піший підхід від точки до зупинки й від зупинки до точки, хв (maxPreTransitTime у MOTIS) */
  maxAccessWalkMin: number;
  /** Скільки зупинок-кандидатів брати навколо точки (найближчі) */
  maxAccessStops: number;
  /** Найбільше пересадок у поїздці */
  maxTransfers: number;
  /** Найдовше очікування на пересадці, хв; якщо інакше нічого не знайдено — ліміт знімається */
  maxTransferWaitMin: number;
  /** Піший маршрут «напряму» пропонується, якщо він не довший за стільки хв */
  maxDirectWalkMin: number;
}

export const DEFAULT_JOURNEY_OPTIONS: JourneyOptions = {
  minTransferMin: 2,
  walkSpeedMps: 1.2,
  detourFactor: 1.3,
  maxTransferWalkM: 400,
  maxAccessWalkMin: 15,
  maxAccessStops: 12,
  maxTransfers: 2,
  maxTransferWaitMin: 90,
  maxDirectWalkMin: 20,
};
