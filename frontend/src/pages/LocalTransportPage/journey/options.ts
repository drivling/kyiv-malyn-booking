/**
 * Параметри пошуку поїздок з пересадками. Числа підібрані звіркою з Transitous (MOTIS) на тому ж GTFS
 * (transitous.oracle.test.ts, 120 запитів «точка → точка»): detourFactor 1,5 дав найбільше точних збігів прибуття
 * (50 з 120, у межах ±2 хв — 102); довший піший перехід, ніж 400 м, і інші minTransferMin збігів не додають.
 * Деталі й обмеження — Docs/transport-journey-planner-2026-10.md; змінювати разом із повторною звіркою.
 */
export interface JourneyOptions {
  /** Мінімум на пересадку, хв: буфер на тій самій зупинці і нижня межа для пішого переходу */
  minTransferMin: number;
  /** Швидкість пішки, м/с (pedestrianSpeed у MOTIS) */
  walkSpeedMps: number;
  /**
   * Коефіцієнт «вулиця довша за пряму»: пішки йдуть не по прямій. Transitous рахує по OSM: медіана 1,27, p75 1,44,
   * поруч стоїть «навпроти» через дорогу — до 3,7; 1,5 трохи консервативніший за реальність (безпечніше для людини)
   */
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
  detourFactor: 1.5,
  maxTransferWalkM: 400,
  maxAccessWalkMin: 15,
  maxAccessStops: 40,
  maxTransfers: 2,
  maxTransferWaitMin: 90,
  maxDirectWalkMin: 20,
};
