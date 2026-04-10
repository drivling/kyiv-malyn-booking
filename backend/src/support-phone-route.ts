import type { PrismaClient } from '@prisma/client';

/** Телефон підтримки для маршруту з графіка (формат +380(93)1701835) */
export async function getSupportPhoneForRoute(prisma: PrismaClient, route: string): Promise<string | null> {
  const schedule = await prisma.schedule.findFirst({
    where: { route, supportPhone: { not: null } },
    select: { supportPhone: true },
  });
  return schedule?.supportPhone ?? null;
}
