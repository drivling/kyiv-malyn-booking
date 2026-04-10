"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupportPhoneForRoute = getSupportPhoneForRoute;
/** Телефон підтримки для маршруту з графіка (формат +380(93)1701835) */
async function getSupportPhoneForRoute(prisma, route) {
    const schedule = await prisma.schedule.findFirst({
        where: { route, supportPhone: { not: null } },
        select: { supportPhone: true },
    });
    return schedule?.supportPhone ?? null;
}
