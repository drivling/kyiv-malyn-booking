/** Логіка обідів (столова) для адмін-API — дзеркало Python lunch/. */

import type { Prisma, PrismaClient } from '@prisma/client';

export type LunchMenuItemInput = { name: string; price: number };

export type LunchTrayRole = 'soup' | 'second' | 'salad';

export type MenuUnavailableNotice = {
  orderId: number;
  displayName: string;
  sourceMessageId: string | null;
  missingDishes: string[];
};

const TOKEN_SYNONYMS: Record<string, string> = {
  овощи: 'овочі',
  овощ: 'овоч',
  бифштекс: 'біфштекс',
  бифтекс: 'біфштекс',
  печень: 'печінкові',
  печен: 'печінкові',
  печінкові: 'печінкові',
  оладьи: 'оладки',
  оладді: 'оладки',
  яйцом: 'яйцем',
  яйце: 'яйцем',
  гриле: 'грилі',
  гриль: 'грилі',
  огурец: 'огірок',
  огурцом: 'огірком',
  огурца: 'огірка',
  помидор: 'помідор',
  курица: 'курка',
  курицы: 'курки',
  грецкий: 'грецький',
  греческий: 'грецький',
  суп: 'суп',
  грибной: 'грибний',
  вареники: 'вареники',
  картошкой: 'картоплею',
  картошка: 'картопля',
};

export function todayKyivDate(): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const s = fmt.format(new Date()); // YYYY-MM-DD
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function normalizeDishName(name: string): string {
  let s = (name || '').normalize('NFKC').toLowerCase().trim();
  s = s.replace(/ё/g, 'е').replace(/є/g, 'е').replace(/ї/g, 'і').replace(/ґ/g, 'г');
  s = s.replace(/ь/g, '').replace(/ъ/g, '');
  s = s.replace(/[ʼ’`´']/g, '');
  s = s.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => TOKEN_SYNONYMS[t] || t)
    .join(' ');
}

export function guessTrayRole(name: string): LunchTrayRole {
  const n = normalizeDishName(name);
  if (
    n.includes('суп') ||
    n.includes('борщ') ||
    n.includes('солянка') ||
    n.includes('розсольник') ||
    n.includes('юшка') ||
    n.includes('бульйон')
  ) {
    return 'soup';
  }
  if (n.includes('салат')) return 'salad';
  return 'second';
}

export function computeTrayCount(
  lines: Array<{ trayRole?: string | null; qty?: number | null }>
): number {
  const active = lines.filter((l) => (l.qty || 1) > 0);
  if (active.length === 0) return 0;
  let soupQty = 0;
  let hasSecond = false;
  for (const l of active) {
    const role = l.trayRole || 'second';
    const qty = l.qty && l.qty > 0 ? l.qty : 1;
    if (role === 'soup') soupQty += qty;
    else if (role === 'second') hasSecond = true;
  }
  let trays = soupQty + (hasSecond ? 1 : 0);
  if (active.length === 1) trays = Math.max(trays, 1);
  return trays;
}

export async function getLunchSettings(prisma: PrismaClient): Promise<{ trayPriceUah: number }> {
  const row = await prisma.lunchSettings.upsert({
    where: { id: 1 },
    create: { id: 1, trayPriceUah: 5 },
    update: {},
  });
  return { trayPriceUah: row.trayPriceUah };
}

export function parseLunchMenuPayload(body: unknown): LunchMenuItemInput[] {
  let data = body;
  if (typeof body === 'string') {
    const text = body.trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const json = start >= 0 && end > start ? text.slice(start, end + 1) : text;
    data = JSON.parse(json);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Очікується JSON обʼєкт');
  }
  const itemsRaw = (data as { items?: unknown }).items;
  if (!Array.isArray(itemsRaw)) {
    throw new Error('Потрібен масив items');
  }
  const out: LunchMenuItemInput[] = [];
  for (const it of itemsRaw) {
    if (!it || typeof it !== 'object') continue;
    const name = String((it as { name?: unknown }).name || '').trim();
    const priceRaw = (it as { price?: unknown }).price;
    const price = typeof priceRaw === 'number' ? Math.round(priceRaw) : parseInt(String(priceRaw), 10);
    if (!name || !Number.isFinite(price) || price <= 0) continue;
    out.push({ name, price });
  }
  if (out.length === 0) {
    throw new Error('Немає валідних позицій (name + price)');
  }
  return out;
}

export function formatLunchMenuText(
  items: Array<{ name: string; priceUah: number }>,
  trayPriceUah = 5
): string {
  const lines = ['Меню на сьогодні:'];
  for (const it of items) {
    lines.push(`• ${it.name} — ${it.priceUah} грн`);
  }
  lines.push(`• Лоток — ${trayPriceUah} грн`);
  return lines.join('\n');
}

export async function saveDishSynonym(
  prisma: PrismaClient | Prisma.TransactionClient,
  dishId: number,
  rawText: string
): Promise<void> {
  const raw = (rawText || '').trim();
  const rawNorm = normalizeDishName(raw);
  if (!raw || !rawNorm) return;
  const dish = await prisma.lunchDish.findUnique({ where: { id: dishId } });
  if (!dish || dish.nameNorm === rawNorm) return;
  await prisma.lunchDishSynonym.upsert({
    where: { dishId_rawNorm: { dishId, rawNorm } },
    create: { dishId, rawText: raw, rawNorm },
    update: {},
  });
}

export async function addLunchDishSynonym(
  prisma: PrismaClient,
  dishId: number,
  rawText: string
): Promise<void> {
  const raw = (rawText || '').trim();
  const rawNorm = normalizeDishName(raw);
  if (!raw || !rawNorm) throw new Error('Порожній синонім');
  const dish = await prisma.lunchDish.findUnique({ where: { id: dishId } });
  if (!dish) throw new Error(`Страву #${dishId} не знайдено`);
  if (dish.nameNorm === rawNorm) throw new Error('Це канонічна назва страви, не синонім');
  await prisma.lunchDishSynonym.upsert({
    where: { dishId_rawNorm: { dishId, rawNorm } },
    create: { dishId, rawText: raw, rawNorm },
    update: {},
  });
}

export async function deleteLunchDishSynonym(prisma: PrismaClient, synonymId: number): Promise<void> {
  const deleted = await prisma.lunchDishSynonym.deleteMany({ where: { id: synonymId } });
  if (!deleted.count) throw new Error('Синонім не знайдено');
}

export async function moveLunchDishSynonym(
  prisma: PrismaClient,
  synonymId: number,
  targetDishId: number
): Promise<void> {
  if (!Number.isFinite(targetDishId) || targetDishId <= 0) {
    throw new Error('Некоректна страва');
  }
  const syn = await prisma.lunchDishSynonym.findUnique({ where: { id: synonymId } });
  if (!syn) throw new Error('Синонім не знайдено');
  if (syn.dishId === targetDishId) return;
  const dish = await prisma.lunchDish.findUnique({ where: { id: targetDishId } });
  if (!dish) throw new Error(`Страву #${targetDishId} не знайдено`);
  if (dish.nameNorm === syn.rawNorm) {
    await prisma.lunchDishSynonym.delete({ where: { id: synonymId } });
    return;
  }
  const existing = await prisma.lunchDishSynonym.findUnique({
    where: { dishId_rawNorm: { dishId: targetDishId, rawNorm: syn.rawNorm } },
  });
  if (existing) {
    await prisma.lunchDishSynonym.delete({ where: { id: synonymId } });
    return;
  }
  await prisma.lunchDishSynonym.update({
    where: { id: synonymId },
    data: { dishId: targetDishId },
  });
}

export async function upsertLunchMenuForToday(
  prisma: PrismaClient,
  items: LunchMenuItemInput[],
  parsedRaw: unknown
): Promise<{
  day: { id: number; date: Date; status: string };
  menuItems: Array<{
    id: number;
    dishId: number;
    name: string;
    priceUah: number;
    nameNorm: string;
    trayRole: string;
  }>;
  notices: MenuUnavailableNotice[];
}> {
  const date = todayKyivDate();
  const normItems = items.map((it) => ({ ...it, nameNorm: normalizeDishName(it.name) }));
  const allNorms = normItems.map((it) => it.nameNorm);

  const { menuItems, dayId } = await prisma.$transaction(
    async (tx) => {
      const day = await tx.lunchDay.upsert({
        where: { date },
        create: { date, status: 'ordering', parsedRawJson: JSON.stringify(parsedRaw) },
        update: {
          status: 'ordering',
          parsedRawJson: JSON.stringify(parsedRaw),
          updatedAt: new Date(),
        },
      });

      // Prefetch all dishes/synonyms in bulk up front so the per-item loop below
      // does zero extra reads — with 30+ items, per-item findUnique/findFirst calls
      // pushed this interactive transaction past Prisma's default 5s timeout and it
      // got closed mid-loop ("Transaction not found").
      const byNormDish = new Map<string, { id: number; name: string; nameNorm: string; priceUah: number; trayRole: string }>();
      const existingDishes = await tx.lunchDish.findMany({ where: { nameNorm: { in: allNorms } } });
      for (const d of existingDishes) byNormDish.set(d.nameNorm, d);
      const missingNorms = allNorms.filter((n) => !byNormDish.has(n));
      if (missingNorms.length > 0) {
        const synonyms = await tx.lunchDishSynonym.findMany({
          where: { rawNorm: { in: missingNorms } },
          include: { dish: true },
        });
        for (const syn of synonyms) {
          if (!byNormDish.has(syn.rawNorm)) byNormDish.set(syn.rawNorm, syn.dish);
        }
      }

      const dishIds: number[] = [];
      const created: Array<{
        id: number;
        dishId: number;
        name: string;
        priceUah: number;
        nameNorm: string;
        trayRole: string;
      }> = [];

      for (const it of normItems) {
        const existing = byNormDish.get(it.nameNorm);
        const dish = existing
          ? await tx.lunchDish.update({
              where: { id: existing.id },
              data: { priceUah: it.price, updatedAt: new Date() },
            })
          : await tx.lunchDish.create({
              data: {
                name: it.name,
                nameNorm: it.nameNorm,
                priceUah: it.price,
                trayRole: guessTrayRole(it.name),
              },
            });
        dishIds.push(dish.id);
        const row = await tx.lunchMenuItem.upsert({
          where: { dayId_dishId: { dayId: day.id, dishId: dish.id } },
          create: {
            dayId: day.id,
            dishId: dish.id,
            name: dish.name,
            nameNorm: dish.nameNorm,
            priceUah: dish.priceUah,
          },
          update: {
            priceUah: dish.priceUah,
            name: dish.name,
            nameNorm: dish.nameNorm,
          },
        });
        created.push({
          id: row.id,
          dishId: dish.id,
          name: dish.name,
          priceUah: dish.priceUah,
          nameNorm: dish.nameNorm,
          trayRole: dish.trayRole,
        });
      }

      await tx.lunchMenuItem.deleteMany({
        where: { dayId: day.id, dishId: { notIn: dishIds } },
      });

      return { menuItems: created, dayId: day.id };
    },
    { timeout: 20000, maxWait: 10000 }
  );

  const day = await prisma.lunchDay.findUniqueOrThrow({ where: { id: dayId } });
  const notices = await syncOrdersAfterMenuChange(prisma, day.id);
  return {
    day: { id: day.id, date: day.date, status: day.status },
    menuItems,
    notices,
  };
}

export async function syncOrdersAfterMenuChange(
  prisma: PrismaClient,
  dayId: number
): Promise<MenuUnavailableNotice[]> {
  const settings = await getLunchSettings(prisma);
  const todayItems = await prisma.lunchMenuItem.findMany({
    where: { dayId },
    include: { dish: true },
  });
  const todayByDish = new Map(todayItems.map((m) => [m.dishId, m]));

  const orders = await prisma.lunchOrder.findMany({
    where: { dayId, status: 'active' },
    include: {
      participant: true,
      lines: { include: { dish: true } },
    },
  });

  const notices: MenuUnavailableNotice[] = [];

  for (const order of orders) {
    const missing: string[] = [];
    let foodTotal = 0;
    const roles: Array<{ trayRole: string; qty: number }> = [];

    for (const line of order.lines) {
      const dishId = line.dishId;
      const today = dishId != null ? todayByDish.get(dishId) : undefined;
      if (today) {
        const qty = line.qty || 1;
        const unit = today.priceUah;
        const lineTotal = unit * qty;
        foodTotal += lineTotal;
        roles.push({ trayRole: today.dish.trayRole, qty });
        await prisma.lunchOrderLine.update({
          where: { id: line.id },
          data: {
            menuItemId: today.id,
            unitPriceUah: unit,
            lineTotalUah: lineTotal,
            unavailable: false,
            rawName: today.name,
          },
        });
      } else {
        const name = line.dish?.name || line.rawName;
        missing.push(name);
        await prisma.lunchOrderLine.update({
          where: { id: line.id },
          data: { unavailable: true, menuItemId: null },
        });
        roles.push({ trayRole: line.dish?.trayRole || 'second', qty: line.qty || 1 });
        foodTotal += line.lineTotalUah;
      }
    }

    const trayCount = order.trayCountManual
      ? order.trayCount
      : computeTrayCount(roles);
    const trayTotalUah = trayCount * settings.trayPriceUah;
    await prisma.lunchOrder.update({
      where: { id: order.id },
      data: {
        trayCount,
        trayTotalUah,
        totalUah: foodTotal + trayTotalUah,
        updatedAt: new Date(),
      },
    });

    if (missing.length) {
      notices.push({
        orderId: order.id,
        displayName: order.participant.displayName,
        sourceMessageId: order.sourceMessageId != null ? String(order.sourceMessageId) : null,
        missingDishes: missing,
      });
    }
  }

  return notices;
}

export async function getLunchDaySummary(prisma: PrismaClient, date?: Date) {
  const d = date ?? todayKyivDate();
  const settings = await getLunchSettings(prisma);
  const catalog = await prisma.lunchDish.findMany({
    orderBy: { name: 'asc' },
    include: { synonyms: { orderBy: { id: 'asc' } } },
  });
  const dishes = catalog.map((c) => ({
    id: c.id,
    name: c.name,
    priceUah: c.priceUah,
    trayRole: c.trayRole,
    synonyms: c.synonyms.map((s) => ({ id: s.id, rawText: s.rawText })),
  }));

  const day = await prisma.lunchDay.findUnique({
    where: { date: d },
    include: {
      menuItems: { orderBy: { id: 'asc' }, include: { dish: true } },
      orders: {
        where: { status: 'active' },
        include: {
          participant: true,
          lines: {
            orderBy: { id: 'asc' },
            include: {
              menuItem: { select: { id: true, name: true, priceUah: true } },
              dish: { select: { id: true, name: true, priceUah: true, trayRole: true } },
            },
          },
        },
        orderBy: { id: 'asc' },
      },
      payments: {
        include: { participant: true },
        orderBy: { id: 'asc' },
      },
    },
  });

  if (!day) {
    return {
      date: d.toISOString().slice(0, 10),
      day: null,
      trayPriceUah: settings.trayPriceUah,
      dishes,
      menuItems: [] as Array<{
        id: number;
        dishId: number;
        name: string;
        priceUah: number;
        trayRole: string;
      }>,
      orders: [] as unknown[],
      payments: [] as unknown[],
      debts: [] as unknown[],
      totals: { orderUah: 0, paidUah: 0, debtUah: 0 },
    };
  }

  const paidByParticipant = new Map<number, number>();
  for (const p of day.payments) {
    paidByParticipant.set(
      p.participantId,
      (paidByParticipant.get(p.participantId) || 0) + p.amountUah
    );
  }

  const orders = day.orders.map((o) => {
    const paid = paidByParticipant.get(o.participantId) || 0;
    return {
      id: o.id,
      participantId: o.participantId,
      displayName: o.participant.displayName,
      username: o.participant.username,
      rawText: o.rawText,
      unmatchedText: o.unmatchedText,
      totalUah: o.totalUah,
      trayCount: o.trayCount,
      trayTotalUah: o.trayTotalUah,
      trayCountManual: o.trayCountManual,
      hasReply: o.replyMessageId != null,
      paidUah: paid,
      debtUah: o.totalUah - paid,
      lines: o.lines.map((l) => ({
        menuItemId: l.menuItemId,
        dishId: l.dishId,
        menuItemName: l.dish?.name ?? l.menuItem?.name ?? null,
        trayRole: l.dish?.trayRole ?? null,
        rawName: l.dish?.name || l.menuItem?.name || l.rawName,
        qty: l.qty,
        unitPriceUah: l.unitPriceUah,
        lineTotalUah: l.lineTotalUah,
        unavailable: l.unavailable,
      })),
    };
  });

  const debts = orders.filter((o) => o.debtUah > 0);
  const orderUah = orders.reduce((s, o) => s + o.totalUah, 0);
  const paidUah = day.payments.reduce((s, p) => s + p.amountUah, 0);

  return {
    date: day.date.toISOString().slice(0, 10),
    day: {
      id: day.id,
      status: day.status,
      payeeCard: day.payeeCard,
      menuMessageId: day.menuMessageId != null ? String(day.menuMessageId) : null,
      updatedAt: day.updatedAt.toISOString(),
    },
    trayPriceUah: settings.trayPriceUah,
    dishes,
    menuItems: day.menuItems.map((m) => ({
      id: m.id,
      dishId: m.dishId,
      name: m.dish?.name || m.name,
      priceUah: m.dish?.priceUah ?? m.priceUah,
      trayRole: m.dish?.trayRole || 'second',
    })),
    orders,
    payments: day.payments.map((p) => ({
      id: p.id,
      displayName: p.participant.displayName,
      amountUah: p.amountUah,
      rawText: p.rawText,
      createdAt: p.createdAt.toISOString(),
    })),
    debts,
    totals: {
      orderUah,
      paidUah,
      debtUah: orderUah - paidUah,
    },
  };
}

export function formatLunchTotalsComment(
  orders: Array<{
    displayName: string;
    totalUah: number;
    trayCount?: number;
    trayTotalUah?: number;
    rawText?: string;
    lines: Array<{
      rawName: string;
      menuItemName?: string | null;
      menuItemId?: number | null;
      qty?: number;
      unitPriceUah?: number;
      lineTotalUah?: number;
      unavailable?: boolean;
    }>;
  }>,
  menuItems?: Array<{ id: number; name: string; priceUah?: number }>,
  trayPriceUah = 5
): string {
  if (!orders.length) return 'Замовлень немає.';
  const menuById = new Map((menuItems || []).map((m) => [m.id, m]));
  const lines: string[] = [];
  let grand = 0;
  for (const o of orders) {
    grand += o.totalUah;
    const dishes =
      o.lines
        .filter((l) => !l.unavailable)
        .map((l) => {
          const fromMenu =
            (l.menuItemId != null ? menuById.get(l.menuItemId)?.name : undefined) ||
            l.menuItemName ||
            null;
          const name = fromMenu || l.rawName;
          if (!name) return '';
          const qty = l.qty && l.qty > 1 ? `×${l.qty} ` : '';
          const price = l.lineTotalUah ?? l.unitPriceUah;
          return price != null ? `${qty}${name} — ${price} грн` : `${qty}${name}`;
        })
        .filter(Boolean)
        .join(', ') ||
      (o.rawText || '').replace(/\n/g, ', ');
    const trays = o.trayCount || 0;
    const traySum = o.trayTotalUah ?? trays * trayPriceUah;
    const trayBit = trays > 0 ? `; лотки ${trays} × ${trayPriceUah} = ${traySum} грн` : '';
    lines.push(`${o.displayName}: ${dishes}${trayBit} — ${o.totalUah} грн`);
  }
  lines.push('');
  lines.push(`Разом: ${grand} грн`);
  return lines.join('\n');
}

export function formatOrderConfirmText(opts: {
  displayName: string;
  lines: Array<{
    rawName?: string;
    menuItemName?: string | null;
    qty?: number;
    unitPriceUah?: number;
    lineTotalUah?: number;
  }>;
  foodTotal: number;
  trayCount: number;
  trayPriceUah: number;
  trayTotalUah: number;
  totalUah: number;
  unmatched?: string[];
}): string {
  const parts = [`${opts.displayName}, заказ:`];
  for (const line of opts.lines) {
    const name = line.menuItemName || line.rawName || '?';
    const qty = line.qty || 1;
    const q = qty > 1 ? `×${qty} ` : '';
    const lt = line.lineTotalUah ?? (line.unitPriceUah || 0) * qty;
    const unit = line.unitPriceUah;
    parts.push(unit != null ? `• ${q}${name} — ${lt} грн (${unit}/шт)` : `• ${q}${name} — ${lt} грн`);
  }
  if (opts.trayCount > 0) {
    parts.push(`Лотки: ${opts.trayCount} × ${opts.trayPriceUah} = ${opts.trayTotalUah} грн`);
  }
  parts.push(`Разом: ${opts.totalUah} грн`);
  if (opts.unmatched && opts.unmatched.length) {
    parts.push('Не розпізнав: ' + opts.unmatched.join(', '));
    parts.push('Уточни назви по меню.');
  }
  return parts.join('\n');
}

/**
 * Ручне редагування замовлення оператором.
 * rawText ніколи не змінюємо — оригінал повідомлення для аналізу.
 */
export async function updateLunchOrder(
  prisma: PrismaClient,
  orderId: number,
  opts: {
    menuItemIds?: number[];
    lines?: Array<{ dishId?: number; menuItemId?: number; asWritten?: string; qty?: number }>;
    unmatchedText?: string | null;
    trayCount?: number | null;
  }
): Promise<{
  ok: boolean;
  totalUah: number;
  confirmText: string;
  replyMessageId: string | null;
  sourceMessageId: string | null;
}> {
  const order = await prisma.lunchOrder.findUnique({
    where: { id: orderId },
    include: {
      participant: true,
      day: { include: { menuItems: { include: { dish: true } } } },
    },
  });
  if (!order || order.status !== 'active') {
    throw new Error('Замовлення не знайдено');
  }

  const settings = await getLunchSettings(prisma);
  const menuById = new Map(order.day.menuItems.map((m) => [m.id, m]));
  const menuByDishId = new Map(order.day.menuItems.map((m) => [m.dishId, m]));
  type IncomingLine = { dishId?: number; menuItemId?: number; asWritten?: string; qty?: number };
  const rawLines: IncomingLine[] =
    opts.lines !== undefined
      ? opts.lines
      : (opts.menuItemIds || []).map((id) => ({ menuItemId: id, asWritten: '', qty: 1 }));

  const linesData: Array<{
    menuItemId: number | null;
    dishId: number;
    dishName: string;
    rawName: string;
    qty: number;
    unitPriceUah: number;
    lineTotalUah: number;
    asWritten: string;
    trayRole: string;
  }> = [];
  let foodTotal = 0;
  for (const raw of rawLines) {
    const qty = raw.qty && raw.qty > 0 ? Math.round(raw.qty) : 1;
    const asWritten = (raw.asWritten || '').trim();
    const dishIdRaw = raw.dishId != null ? Number(raw.dishId) : 0;
    const mid = raw.menuItemId != null ? Number(raw.menuItemId) : 0;
    const fromMenu = mid > 0 ? menuById.get(mid) : undefined;
    const dishId = dishIdRaw > 0 ? dishIdRaw : fromMenu?.dishId;
    if (!dishId) {
      throw new Error('Потрібен dishId або позиція сьогоднішнього меню');
    }
    const dish = await prisma.lunchDish.findUnique({ where: { id: dishId } });
    if (!dish) {
      throw new Error(`Страву #${dishId} не знайдено в каталозі`);
    }
    const todayItem = menuByDishId.get(dish.id) || fromMenu;
    const price = dish.priceUah;
    const lineTotal = price * qty;
    foodTotal += lineTotal;
    linesData.push({
      menuItemId: todayItem?.id ?? null,
      dishId: dish.id,
      dishName: dish.name,
      rawName: asWritten || dish.name,
      qty,
      unitPriceUah: price,
      lineTotalUah: lineTotal,
      asWritten,
      trayRole: dish.trayRole || 'second',
    });
  }

  const autoTrays = computeTrayCount(linesData);
  const manual =
    opts.trayCount != null && Number.isFinite(Number(opts.trayCount)) && Number(opts.trayCount) >= 0;
  const trayCount = manual ? Math.round(Number(opts.trayCount)) : autoTrays;
  const trayTotalUah = trayCount * settings.trayPriceUah;
  const total = foodTotal + trayTotalUah;

  const unmatched =
    opts.unmatchedText === undefined
      ? order.unmatchedText
      : opts.unmatchedText === null || String(opts.unmatchedText).trim() === ''
        ? null
        : String(opts.unmatchedText).trim();

  await prisma.$transaction(async (tx) => {
    await tx.lunchOrderLine.deleteMany({ where: { orderId } });
    if (linesData.length) {
      await tx.lunchOrderLine.createMany({
        data: linesData.map((l) => ({
          orderId,
          menuItemId: l.menuItemId,
          dishId: l.dishId,
          rawName: l.rawName,
          qty: l.qty,
          unitPriceUah: l.unitPriceUah,
          lineTotalUah: l.lineTotalUah,
          unavailable: false,
        })),
      });
    }
    await tx.lunchOrder.update({
      where: { id: orderId },
      data: {
        totalUah: total,
        trayCount,
        trayTotalUah,
        trayCountManual: manual,
        unmatchedText: unmatched,
        updatedAt: new Date(),
      },
    });
    for (const l of linesData) {
      if (l.asWritten) {
        await saveDishSynonym(tx, l.dishId, l.asWritten);
      }
    }
  });

  const unmatchedParts = unmatched
    ? unmatched
        .split(/[;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const confirmText = formatOrderConfirmText({
    displayName: order.participant.displayName,
    lines: linesData.map((l) => ({
      menuItemName: l.dishName,
      rawName: l.rawName,
      qty: l.qty,
      unitPriceUah: l.unitPriceUah,
      lineTotalUah: l.lineTotalUah,
    })),
    foodTotal,
    trayCount,
    trayPriceUah: settings.trayPriceUah,
    trayTotalUah,
    totalUah: total,
    unmatched: unmatchedParts,
  });

  return {
    ok: true,
    totalUah: total,
    confirmText,
    replyMessageId: order.replyMessageId != null ? String(order.replyMessageId) : null,
    sourceMessageId: order.sourceMessageId != null ? String(order.sourceMessageId) : null,
  };
}

export async function updateLunchDish(
  prisma: PrismaClient,
  dishId: number,
  opts: { priceUah?: number; trayRole?: string }
): Promise<void> {
  const data: { priceUah?: number; trayRole?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (opts.priceUah != null) {
    const p = Math.round(Number(opts.priceUah));
    if (!Number.isFinite(p) || p <= 0) throw new Error('Некоректна ціна');
    data.priceUah = p;
  }
  if (opts.trayRole) {
    if (!['soup', 'second', 'salad'].includes(opts.trayRole)) {
      throw new Error('trayRole: soup | second | salad');
    }
    data.trayRole = opts.trayRole;
  }
  await prisma.lunchDish.update({ where: { id: dishId }, data });
  const date = todayKyivDate();
  const day = await prisma.lunchDay.findUnique({ where: { date } });
  if (day) {
    if (data.priceUah != null) {
      await prisma.lunchMenuItem.updateMany({
        where: { dayId: day.id, dishId },
        data: { priceUah: data.priceUah },
      });
    }
    await syncOrdersAfterMenuChange(prisma, day.id);
  }
}

export async function updateLunchTrayPrice(prisma: PrismaClient, trayPriceUah: number): Promise<void> {
  const p = Math.round(Number(trayPriceUah));
  if (!Number.isFinite(p) || p < 0) throw new Error('Некоректна ціна лотка');
  await prisma.lunchSettings.upsert({
    where: { id: 1 },
    create: { id: 1, trayPriceUah: p },
    update: { trayPriceUah: p },
  });
  const date = todayKyivDate();
  const day = await prisma.lunchDay.findUnique({ where: { date } });
  if (day) await syncOrdersAfterMenuChange(prisma, day.id);
}

export async function recordLunchPayment(
  prisma: PrismaClient,
  opts: { participantId: number; amountUah?: number; rawText?: string }
): Promise<{
  ok: boolean;
  amountUah: number;
  ordered: number;
  paid: number;
  debt: number;
}> {
  const date = todayKyivDate();
  const day = await prisma.lunchDay.findUnique({ where: { date } });
  if (!day) {
    throw new Error('Немає дня обідів на сьогодні');
  }
  const order = await prisma.lunchOrder.findUnique({
    where: {
      dayId_participantId: { dayId: day.id, participantId: opts.participantId },
    },
  });
  if (!order || order.status !== 'active') {
    throw new Error('Немає активного замовлення для цього учасника');
  }
  const paidAgg = await prisma.lunchPayment.aggregate({
    where: { dayId: day.id, participantId: opts.participantId },
    _sum: { amountUah: true },
  });
  const paidSoFar = paidAgg._sum.amountUah || 0;
  const debt = order.totalUah - paidSoFar;
  const amount = opts.amountUah != null ? Math.round(opts.amountUah) : debt;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(debt <= 0 ? 'Боргу немає' : 'Некоректна сума');
  }
  await prisma.lunchPayment.create({
    data: {
      dayId: day.id,
      participantId: opts.participantId,
      amountUah: amount,
      rawText: opts.rawText || `admin pay ${amount}`,
    },
  });
  const paid = paidSoFar + amount;
  return {
    ok: true,
    amountUah: amount,
    ordered: order.totalUah,
    paid,
    debt: order.totalUah - paid,
  };
}
