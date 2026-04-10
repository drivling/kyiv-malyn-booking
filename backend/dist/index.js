"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupportPhoneForRoute = exports.getRegisteredRoutes = exports.createApp = exports.CODE_VERSION = void 0;
const client_1 = require("@prisma/client");
const create_app_1 = require("./create-app");
var create_app_2 = require("./create-app");
Object.defineProperty(exports, "CODE_VERSION", { enumerable: true, get: function () { return create_app_2.CODE_VERSION; } });
Object.defineProperty(exports, "createApp", { enumerable: true, get: function () { return create_app_2.createApp; } });
Object.defineProperty(exports, "getRegisteredRoutes", { enumerable: true, get: function () { return create_app_2.getRegisteredRoutes; } });
Object.defineProperty(exports, "getSupportPhoneForRoute", { enumerable: true, get: function () { return create_app_2.getSupportPhoneForRoute; } });
function main() {
    const prisma = new client_1.PrismaClient();
    const app = (0, create_app_1.createApp)({ prisma });
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        const routes = (0, create_app_1.getRegisteredRoutes)(app);
        const hasViber = routes.some((r) => r.includes('viber-listings'));
        console.log('========================================');
        console.log(`[KYIV-MALYN-BACKEND] CODE_VERSION=${create_app_1.CODE_VERSION}`);
        console.log(`[KYIV-MALYN-BACKEND] cwd=${process.cwd()}`);
        console.log(`[KYIV-MALYN-BACKEND] RAILWAY_DEPLOYMENT_ID=${process.env.RAILWAY_DEPLOYMENT_ID ?? 'not set'}`);
        console.log(`[KYIV-MALYN-BACKEND] /viber-listings registered: ${hasViber ? 'YES' : 'NO'}`);
        console.log('[KYIV-MALYN-BACKEND] Routes:', routes.filter((r) => r.startsWith('GET ') || r.startsWith('POST ')).slice(0, 25).join(', '));
        if (!hasViber)
            console.warn('[KYIV-MALYN-BACKEND] WARNING: Viber routes missing — likely old build/cache');
        console.log('========================================');
        console.log(`API on http://localhost:${PORT} [${create_app_1.CODE_VERSION}]`);
    });
}
if (require.main === module) {
    main();
}
