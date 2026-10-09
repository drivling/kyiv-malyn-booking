"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleInclude = void 0;
/**
 * Форма `Schedule` для сайту: маршрут з упорядкованими зупинками й точками.
 * Спільна для GET /schedules і GET /poputky/search — одна відповідь для обох.
 */
exports.scheduleInclude = {
    startPoint: true,
    endPoint: true,
    tripRoute: {
        include: {
            startPoint: true,
            endPoint: true,
            corridorRoute: true,
            stops: { include: { point: true }, orderBy: { position: 'asc' } },
        },
    },
};
