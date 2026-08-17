"use strict";
/** Логіка обідів (столова) для адмін-API — дзеркало Python lunch/. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.todayKyivDate = todayKyivDate;
exports.normalizeDishName = normalizeDishName;
exports.guessTrayRole = guessTrayRole;
exports.computeTrayCount = computeTrayCount;
exports.getLunchSettings = getLunchSettings;
exports.parseLunchMenuPayload = parseLunchMenuPayload;
exports.formatLunchMenuText = formatLunchMenuText;
exports.saveDishSynonym = saveDishSynonym;
exports.upsertLunchMenuForToday = upsertLunchMenuForToday;
exports.syncOrdersAfterMenuChange = syncOrdersAfterMenuChange;
exports.getLunchDaySummary = getLunchDaySummary;
exports.formatLunchTotalsComment = formatLunchTotalsComment;
exports.formatOrderConfirmText = formatOrderConfirmText;
exports.updateLunchOrder = updateLunchOrder;
exports.updateLunchDish = updateLunchDish;
exports.updateLunchTrayPrice = updateLunchTrayPrice;
exports.recordLunchPayment = recordLunchPayment;
const TOKEN_SYNONYMS = {
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
function todayKyivDate() {
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
function normalizeDishName(name) {
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
function guessTrayRole(name) {
    const n = normalizeDishName(name);
    if (n.includes('суп') ||
        n.includes('борщ') ||
        n.includes('солянка') ||
        n.includes('розсольник') ||
        n.includes('юшка') ||
        n.includes('бульйон')) {
        return 'soup';
    }
    if (n.includes('салат'))
        return 'salad';
    return 'second';
}
function computeTrayCount(lines) {
    const active = lines.filter((l) => (l.qty || 1) > 0);
    if (active.length === 0)
        return 0;
    let soupQty = 0;
    let hasSecond = false;
    for (const l of active) {
        const role = l.trayRole || 'second';
        const qty = l.qty && l.qty > 0 ? l.qty : 1;
        if (role === 'soup')
            soupQty += qty;
        else if (role === 'second')
            hasSecond = true;
    }
    let trays = soupQty + (hasSecond ? 1 : 0);
    if (active.length === 1)
        trays = Math.max(trays, 1);
    return trays;
}
async function getLunchSettings(prisma) {
    const row = await prisma.lunchSettings.upsert({
        where: { id: 1 },
        create: { id: 1, trayPriceUah: 5 },
        update: {},
    });
    return { trayPriceUah: row.trayPriceUah };
}
function parseLunchMenuPayload(body) {
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
    const itemsRaw = data.items;
    if (!Array.isArray(itemsRaw)) {
        throw new Error('Потрібен масив items');
    }
    const out = [];
    for (const it of itemsRaw) {
        if (!it || typeof it !== 'object')
            continue;
        const name = String(it.name || '').trim();
        const priceRaw = it.price;
        const price = typeof priceRaw === 'number' ? Math.round(priceRaw) : parseInt(String(priceRaw), 10);
        if (!name || !Number.isFinite(price) || price <= 0)
            continue;
        out.push({ name, price });
    }
    if (out.length === 0) {
        throw new Error('Немає валідних позицій (name + price)');
    }
    return out;
}
function formatLunchMenuText(items, trayPriceUah = 5) {
    const lines = ['Меню на сьогодні:'];
    for (const it of items) {
        lines.push(`• ${it.name} — ${it.priceUah} грн`);
    }
    lines.push(`• Лоток — ${trayPriceUah} грн`);
    return lines.join('\n');
}
async function findDishByNorm(tx, nameNorm) {
    const byName = await tx.lunchDish.findUnique({ where: { nameNorm } });
    if (byName)
        return byName;
    const syn = await tx.lunchDishSynonym.findFirst({
        where: { rawNorm: nameNorm },
        include: { dish: true },
    });
    return syn?.dish ?? null;
}
async function findOrCreateDish(tx, name, priceUah) {
    const nameNorm = normalizeDishName(name);
    const existing = await findDishByNorm(tx, nameNorm);
    if (existing) {
        return tx.lunchDish.update({
            where: { id: existing.id },
            data: { priceUah, updatedAt: new Date() },
        });
    }
    return tx.lunchDish.create({
        data: {
            name,
            nameNorm,
            priceUah,
            trayRole: guessTrayRole(name),
        },
    });
}
async function saveDishSynonym(prisma, dishId, rawText) {
    const raw = (rawText || '').trim();
    const rawNorm = normalizeDishName(raw);
    if (!raw || !rawNorm)
        return;
    const dish = await prisma.lunchDish.findUnique({ where: { id: dishId } });
    if (!dish || dish.nameNorm === rawNorm)
        return;
    await prisma.lunchDishSynonym.upsert({
        where: { dishId_rawNorm: { dishId, rawNorm } },
        create: { dishId, rawText: raw, rawNorm },
        update: {},
    });
}
async function upsertLunchMenuForToday(prisma, items, parsedRaw) {
    const date = todayKyivDate();
    const { menuItems, dayId } = await prisma.$transaction(async (tx) => {
        const day = await tx.lunchDay.upsert({
            where: { date },
            create: { date, status: 'ordering', parsedRawJson: JSON.stringify(parsedRaw) },
            update: {
                status: 'ordering',
                parsedRawJson: JSON.stringify(parsedRaw),
                updatedAt: new Date(),
            },
        });
        const dishIds = [];
        const created = [];
        for (const it of items) {
            const dish = await findOrCreateDish(tx, it.name, it.price);
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
    });
    const day = await prisma.lunchDay.findUniqueOrThrow({ where: { id: dayId } });
    const notices = await syncOrdersAfterMenuChange(prisma, day.id);
    return {
        day: { id: day.id, date: day.date, status: day.status },
        menuItems,
        notices,
    };
}
async function syncOrdersAfterMenuChange(prisma, dayId) {
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
    const notices = [];
    for (const order of orders) {
        const missing = [];
        let foodTotal = 0;
        const roles = [];
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
            }
            else {
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
async function getLunchDaySummary(prisma, date) {
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
        synonyms: c.synonyms.map((s) => s.rawText),
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
            menuItems: [],
            orders: [],
            payments: [],
            debts: [],
            totals: { orderUah: 0, paidUah: 0, debtUah: 0 },
        };
    }
    const paidByParticipant = new Map();
    for (const p of day.payments) {
        paidByParticipant.set(p.participantId, (paidByParticipant.get(p.participantId) || 0) + p.amountUah);
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
function formatLunchTotalsComment(orders, menuItems, trayPriceUah = 5) {
    if (!orders.length)
        return 'Замовлень немає.';
    const menuById = new Map((menuItems || []).map((m) => [m.id, m]));
    const lines = [];
    let grand = 0;
    for (const o of orders) {
        grand += o.totalUah;
        const dishes = o.lines
            .filter((l) => !l.unavailable)
            .map((l) => {
            const fromMenu = (l.menuItemId != null ? menuById.get(l.menuItemId)?.name : undefined) ||
                l.menuItemName ||
                null;
            const name = fromMenu || l.rawName;
            if (!name)
                return '';
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
function formatOrderConfirmText(opts) {
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
async function updateLunchOrder(prisma, orderId, opts) {
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
    const rawLines = opts.lines !== undefined
        ? opts.lines
        : (opts.menuItemIds || []).map((id) => ({ menuItemId: id, asWritten: '', qty: 1 }));
    const linesData = [];
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
    const manual = opts.trayCount != null && Number.isFinite(Number(opts.trayCount)) && Number(opts.trayCount) >= 0;
    const trayCount = manual ? Math.round(Number(opts.trayCount)) : autoTrays;
    const trayTotalUah = trayCount * settings.trayPriceUah;
    const total = foodTotal + trayTotalUah;
    const unmatched = opts.unmatchedText === undefined
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
async function updateLunchDish(prisma, dishId, opts) {
    const data = { updatedAt: new Date() };
    if (opts.priceUah != null) {
        const p = Math.round(Number(opts.priceUah));
        if (!Number.isFinite(p) || p <= 0)
            throw new Error('Некоректна ціна');
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
async function updateLunchTrayPrice(prisma, trayPriceUah) {
    const p = Math.round(Number(trayPriceUah));
    if (!Number.isFinite(p) || p < 0)
        throw new Error('Некоректна ціна лотка');
    await prisma.lunchSettings.upsert({
        where: { id: 1 },
        create: { id: 1, trayPriceUah: p },
        update: { trayPriceUah: p },
    });
    const date = todayKyivDate();
    const day = await prisma.lunchDay.findUnique({ where: { date } });
    if (day)
        await syncOrdersAfterMenuChange(prisma, day.id);
}
async function recordLunchPayment(prisma, opts) {
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
