"use strict";
/** Логіка обідів (столова) для адмін-API — дзеркало Python lunch/. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.todayKyivDate = todayKyivDate;
exports.normalizeDishName = normalizeDishName;
exports.parseLunchMenuPayload = parseLunchMenuPayload;
exports.formatLunchMenuText = formatLunchMenuText;
exports.upsertLunchMenuForToday = upsertLunchMenuForToday;
exports.getLunchDaySummary = getLunchDaySummary;
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
    return s;
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
function formatLunchMenuText(items) {
    const lines = ['Меню на сьогодні:'];
    for (const it of items) {
        lines.push(`• ${it.name} — ${it.priceUah} грн`);
    }
    if (lines.length === 1)
        lines.push('(порожньо)');
    return lines.join('\n');
}
async function upsertLunchMenuForToday(prisma, items, parsedRaw) {
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
    const created = await Promise.all(items.map((it) => prisma.lunchMenuItem.create({
        data: {
            dayId: day.id,
            name: it.name,
            nameNorm: normalizeDishName(it.name),
            priceUah: it.price,
        },
    })));
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
async function getLunchDaySummary(prisma, date) {
    const d = date ?? todayKyivDate();
    const day = await prisma.lunchDay.findUnique({
        where: { date: d },
        include: {
            menuItems: { orderBy: { id: 'asc' } },
            orders: {
                where: { status: 'active' },
                include: {
                    participant: true,
                    lines: { orderBy: { id: 'asc' } },
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
            totalUah: o.totalUah,
            paidUah: paid,
            debtUah: o.totalUah - paid,
            lines: o.lines.map((l) => ({
                rawName: l.rawName,
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
