/** Логіка обідів (столова) для адмін-API — дзеркало Python lunch/. */

import type { PrismaClient } from '@prisma/client';

export type LunchMenuItemInput = { name: string; price: number };

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
  return s;
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
  items: Array<{ name: string; priceUah: number }>
): string {
  const lines = ['Меню на сьогодні:'];
  for (const it of items) {
    lines.push(`• ${it.name} — ${it.priceUah} грн`);
  }
  if (lines.length === 1) lines.push('(порожньо)');
  return lines.join('\n');
}

export async function upsertLunchMenuForToday(
  prisma: PrismaClient,
  items: LunchMenuItemInput[],
  parsedRaw: unknown
): Promise<{
  day: { id: number; date: Date; status: string };
  menuItems: Array<{ id: number; name: string; priceUah: number; nameNorm: string }>;
}> {
  const date = todayKyivDate();
  const day = await prisma.lunchDay.upsert({
    where: { date },
    create: { date, status: 'ordering', parsedRawJson: JSON.stringify(parsedRaw) },
    update: {
      status: 'ordering',
      parsedRawJson: JSON.stringify(parsedRaw),
      updatedAt: new Date(),
    },
  });

  await prisma.lunchMenuItem.deleteMany({ where: { dayId: day.id } });
  const created = await Promise.all(
    items.map((it) =>
      prisma.lunchMenuItem.create({
        data: {
          dayId: day.id,
          name: it.name,
          nameNorm: normalizeDishName(it.name),
          priceUah: it.price,
        },
      })
    )
  );

  return {
    day: { id: day.id, date: day.date, status: day.status },
    menuItems: created.map((r) => ({
      id: r.id,
      name: r.name,
      priceUah: r.priceUah,
      nameNorm: r.nameNorm,
    })),
  };
}

export async function getLunchDaySummary(prisma: PrismaClient, date?: Date) {
  const d = date ?? todayKyivDate();
  const day = await prisma.lunchDay.findUnique({
    where: { date: d },
    include: {
      menuItems: { orderBy: { id: 'asc' } },
      orders: {
        where: { status: 'active' },
        include: {
          participant: true,
          lines: {
            orderBy: { id: 'asc' },
            include: { menuItem: { select: { id: true, name: true, priceUah: true } } },
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
      menuItems: [] as Array<{ id: number; name: string; priceUah: number }>,
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
      paidUah: paid,
      debtUah: o.totalUah - paid,
      lines: o.lines.map((l) => ({
        menuItemId: l.menuItemId,
        /** Канонічна назва з меню (як у редагуванні); для старих рядків — з join */
        menuItemName: l.menuItem?.name ?? null,
        rawName: l.menuItem?.name || l.rawName,
        qty: l.qty,
        unitPriceUah: l.unitPriceUah,
        lineTotalUah: l.lineTotalUah,
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
    menuItems: day.menuItems.map((m) => ({
      id: m.id,
      name: m.name,
      priceUah: m.priceUah,
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
    rawText?: string;
    lines: Array<{
      rawName: string;
      menuItemName?: string | null;
      menuItemId?: number | null;
      qty?: number;
      unitPriceUah?: number;
      lineTotalUah?: number;
    }>;
  }>,
  menuItems?: Array<{ id: number; name: string; priceUah?: number }>
): string {
  if (!orders.length) return 'Замовлень немає.';
  const menuById = new Map((menuItems || []).map((m) => [m.id, m]));
  const lines: string[] = [];
  let grand = 0;
  for (const o of orders) {
    grand += o.totalUah;
    const dishes =
      o.lines
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
    lines.push(`${o.displayName}: ${dishes} — ${o.totalUah} грн`);
  }
  lines.push('');
  lines.push(`Разом: ${grand} грн`);
  return lines.join('\n');
}

/**
 * Ручне редагування замовлення оператором.
 * rawText ніколи не змінюємо — оригінал повідомлення для аналізу.
 */
export async function updateLunchOrder(
  prisma: PrismaClient,
  orderId: number,
  opts: {
    menuItemIds: number[];
    unmatchedText?: string | null;
  }
): Promise<{ ok: boolean; totalUah: number }> {
  const order = await prisma.lunchOrder.findUnique({
    where: { id: orderId },
    include: { day: { include: { menuItems: true } } },
  });
  if (!order || order.status !== 'active') {
    throw new Error('Замовлення не знайдено');
  }

  const menuById = new Map(order.day.menuItems.map((m) => [m.id, m]));
  const ids = (opts.menuItemIds || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  const linesData: Array<{
    menuItemId: number;
    rawName: string;
    qty: number;
    unitPriceUah: number;
    lineTotalUah: number;
  }> = [];
  let total = 0;
  for (const mid of ids) {
    const item = menuById.get(mid);
    if (!item) {
      throw new Error(`Позиція меню #${mid} не належить цьому дню`);
    }
    const price = item.priceUah;
    total += price;
    linesData.push({
      menuItemId: item.id,
      rawName: item.name,
      qty: 1,
      unitPriceUah: price,
      lineTotalUah: price,
    });
  }

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
        data: linesData.map((l) => ({ orderId, ...l })),
      });
    }
    await tx.lunchOrder.update({
      where: { id: orderId },
      data: {
        totalUah: total,
        unmatchedText: unmatched,
        // rawText не чіпаємо
        updatedAt: new Date(),
      },
    });
  });

  return { ok: true, totalUah: total };
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
