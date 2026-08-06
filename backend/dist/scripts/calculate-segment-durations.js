"use strict";
/**
 * CLI: OSRM-перерахунок сегментів → PostgreSQL.
 *
 *   cd backend && npm run calculate:segments
 *   cd backend && npm run calculate:segments -- --route=11
 */
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const transport_segments_1 = require("../transport-segments");
async function main() {
    let routeFilter = null;
    for (const a of process.argv.slice(2)) {
        if (a.startsWith('--route='))
            routeFilter = a.slice(8).trim();
    }
    const prisma = new client_1.PrismaClient();
    try {
        const result = await (0, transport_segments_1.recalculateSegmentDurations)(prisma, { routeId: routeFilter });
        for (const c of result.corrections)
            console.log(`Корекція ${c}`);
        console.log(`Оновлено сегменти в PostgreSQL для маршрутів: ${result.routes.join(', ')}`);
        console.log(`Нових сегментів: ${result.segmentsWritten}; збережено з інших маршрутів: ${result.segmentsKept}`);
        console.log(`Запитів OSRM: ${result.osrmRequested}, без відповіді (fallback): ${result.osrmFailed}`);
    }
    finally {
        await prisma.$disconnect();
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
