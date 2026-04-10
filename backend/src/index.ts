import { PrismaClient } from '@prisma/client';
import { CODE_VERSION, createApp, getRegisteredRoutes } from './create-app';

export { CODE_VERSION, createApp, getRegisteredRoutes, getSupportPhoneForRoute } from './create-app';

function main(): void {
  const prisma = new PrismaClient();
  const app = createApp({ prisma });
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    const routes = getRegisteredRoutes(app);
    const hasViber = routes.some((r) => r.includes('viber-listings'));
    console.log('========================================');
    console.log(`[KYIV-MALYN-BACKEND] CODE_VERSION=${CODE_VERSION}`);
    console.log(`[KYIV-MALYN-BACKEND] cwd=${process.cwd()}`);
    console.log(`[KYIV-MALYN-BACKEND] RAILWAY_DEPLOYMENT_ID=${process.env.RAILWAY_DEPLOYMENT_ID ?? 'not set'}`);
    console.log(`[KYIV-MALYN-BACKEND] /viber-listings registered: ${hasViber ? 'YES' : 'NO'}`);
    console.log('[KYIV-MALYN-BACKEND] Routes:', routes.filter((r) => r.startsWith('GET ') || r.startsWith('POST ')).slice(0, 25).join(', '));
    if (!hasViber) console.warn('[KYIV-MALYN-BACKEND] WARNING: Viber routes missing — likely old build/cache');
    console.log('========================================');
    console.log(`API on http://localhost:${PORT} [${CODE_VERSION}]`);
  });
}

if (require.main === module) {
  main();
}
