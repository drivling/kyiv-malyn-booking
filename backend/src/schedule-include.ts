/**
 * Форма `Schedule` для сайту: маршрут з упорядкованими зупинками й точками.
 * Спільна для GET /schedules і GET /poputky/search — одна відповідь для обох.
 */
export const scheduleInclude = {
  startPoint: true,
  endPoint: true,
  tripRoute: {
    include: {
      startPoint: true,
      endPoint: true,
      corridorRoute: true,
      stops: { include: { point: true }, orderBy: { position: 'asc' as const } },
    },
  },
} as const;
