"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupPhoneReport = lookupPhoneReport;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const phonecheck_1 = require("./phonecheck");
const telegram_1 = require("./telegram");
function formatFirstFopShort(entries) {
    const first = entries[0];
    if (!first?.name?.trim())
        return null;
    let fullName = first.name.trim();
    if (fullName.startsWith('ФОП '))
        fullName = fullName.slice(4).trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2)
        return `${parts[0]} ${parts[1]}`;
    return fullName || null;
}
async function lookupOpendatabotDetailed(phone) {
    const normalized = phone.trim().replace(/^\+/, '');
    const url = `https://opendatabot.ua/t/${normalized}`;
    const empty = {
        url,
        foundCountDeclared: null,
        entries: [],
        shortName: null,
    };
    if (!normalized)
        return { ...empty, error: 'Порожній номер' };
    const pythonCmd = process.env.OPENDATABOT_PYTHON?.trim() ||
        process.env.TELEGRAM_USER_PYTHON?.trim() ||
        'python3';
    const scriptPath = path_1.default.join(__dirname, '..', 'opendatabot-fop-parser', 'run_opendatabot_phone_lookup.py');
    const outDir = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), 'opendatabot-phone-'));
    return new Promise((resolve) => {
        const child = (0, child_process_1.spawn)(pythonCmd, [scriptPath, normalized, '--json', '--out-dir', outDir], {
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('close', (code) => {
            try {
                fs_1.default.rmSync(outDir, { recursive: true, force: true });
            }
            catch {
                /* ignore cleanup errors */
            }
            const text = stdout.trim();
            if (code === 0 && text) {
                try {
                    const data = JSON.parse(text);
                    const entries = Array.isArray(data.result?.entries) ? data.result.entries : [];
                    resolve({
                        url,
                        foundCountDeclared: data.result?.found_count_declared ?? null,
                        entries,
                        shortName: formatFirstFopShort(entries),
                    });
                    return;
                }
                catch (err) {
                    console.error('lookupOpendatabotDetailed: JSON parse failed', err);
                    resolve({ ...empty, error: 'Некоректна відповідь Opendatabot' });
                    return;
                }
            }
            if (code && code !== 0) {
                console.error(`ℹ️ lookupOpendatabotDetailed (${normalized}): код ${code}`, stderr.slice(0, 200));
            }
            resolve({
                ...empty,
                error: stderr.trim().slice(0, 300) || `Скрипт завершився з кодом ${code ?? '?'}`,
            });
        });
        child.on('error', (err) => {
            try {
                fs_1.default.rmSync(outDir, { recursive: true, force: true });
            }
            catch {
                /* ignore */
            }
            resolve({ ...empty, error: err.message || 'Spawn error' });
        });
    });
}
function buildReportText(report) {
    const lines = [];
    lines.push(`Телефон: +${report.phone}`);
    lines.push('');
    lines.push('— База (Person) —');
    if (report.person) {
        lines.push(`ID: ${report.person.id}`);
        lines.push(`Ім'я в базі: ${report.person.fullName || '—'}`);
        lines.push(`Telegram ChatId: ${report.person.telegramChatId || '—'}`);
        lines.push(`Telegram UserId: ${report.person.telegramUserId || '—'}`);
        lines.push(`@username: ${report.person.telegramUsername ? `@${report.person.telegramUsername}` : '—'}`);
        lines.push(`Бронювань: ${report.person.bookings}, Viber оголош.: ${report.person.viberListings}`);
    }
    else {
        lines.push('У базі не знайдено.');
    }
    lines.push('');
    lines.push('— Telegram (ResolvePhone) —');
    lines.push(`Ім'я: ${report.telegram.name || '—'}`);
    lines.push(`@username: ${report.telegram.username ? `@${report.telegram.username}` : '—'}`);
    lines.push('');
    lines.push('— Opendatabot (ФОП) —');
    lines.push(`URL: ${report.opendatabot.url}`);
    if (report.opendatabot.error) {
        lines.push(`Помилка: ${report.opendatabot.error}`);
    }
    if (report.opendatabot.foundCountDeclared != null) {
        lines.push(`Знайдено (заявлено): ${report.opendatabot.foundCountDeclared}`);
    }
    if (report.opendatabot.entries.length === 0) {
        lines.push('ФОП не знайдено.');
    }
    else {
        lines.push(`Записів: ${report.opendatabot.entries.length}`);
        for (const [i, entry] of report.opendatabot.entries.entries()) {
            lines.push(`  ${i + 1}. [${entry.type}] ${entry.name}`);
        }
        if (report.opendatabot.shortName) {
            lines.push(`Коротке ім'я: ${report.opendatabot.shortName}`);
        }
    }
    lines.push('');
    lines.push('— phonecheck.top —');
    if (report.phonecheck) {
        lines.push(`URL: ${report.phonecheck.url}`);
        lines.push(report.phonecheck.hasData ? 'Дані знайдено.' : 'Дані не знайдено.');
    }
    else {
        lines.push('Перевірку не виконано.');
    }
    lines.push('');
    lines.push('— Підсумок —');
    lines.push(`Рекомендоване ім'я: ${report.suggestedName || '—'}`);
    return lines.join('\n');
}
async function lookupPhoneReport(prisma, rawPhone) {
    const phone = (0, telegram_1.normalizePhone)(rawPhone);
    if (!phone || phone.length < 10) {
        throw new Error('Некоректний номер телефону');
    }
    const personRow = await prisma.person.findUnique({
        where: { phoneNormalized: phone },
        include: { _count: { select: { bookings: true, viberListings: true } } },
    });
    const person = personRow
        ? {
            id: personRow.id,
            phoneNormalized: personRow.phoneNormalized,
            fullName: personRow.fullName,
            telegramChatId: personRow.telegramChatId,
            telegramUserId: personRow.telegramUserId,
            telegramUsername: personRow.telegramUsername,
            bookings: personRow._count.bookings,
            viberListings: personRow._count.viberListings,
        }
        : null;
    const [nameFromTelegram, usernameFromTelegram, opendatabot, phoneCheck] = await Promise.all([
        (0, telegram_1.resolveNameByPhoneFromTelegram)(phone),
        (0, telegram_1.resolveUsernameByPhoneFromTelegram)(phone),
        lookupOpendatabotDetailed(phone),
        (0, phonecheck_1.runPhoneCheckForPhone)(phone),
    ]);
    const { newName } = (0, telegram_1.pickBestNameFromCandidates)(person?.fullName ?? null, null, nameFromTelegram, opendatabot.shortName);
    const draft = {
        phone,
        person,
        telegram: {
            name: nameFromTelegram?.trim() || null,
            username: usernameFromTelegram?.trim() || null,
        },
        opendatabot,
        phonecheck: phoneCheck
            ? { url: phoneCheck.url, hasData: phoneCheck.hasData }
            : null,
        suggestedName: newName,
    };
    return {
        ...draft,
        reportText: buildReportText(draft),
    };
}
