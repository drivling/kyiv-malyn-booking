import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import type { PrismaClient } from '@prisma/client';
import { runPhoneCheckForPhone } from './phonecheck';
import {
  normalizePhone,
  pickBestNameFromCandidates,
  resolveNameByPhoneFromTelegram,
  resolveUsernameByPhoneFromTelegram,
} from './telegram';

export interface OpendatabotFopEntry {
  type: string;
  name: string;
}

export interface PhoneLookupOpendatabot {
  url: string;
  foundCountDeclared: number | null;
  entries: OpendatabotFopEntry[];
  shortName: string | null;
  error?: string;
}

export interface PhoneLookupPerson {
  id: number;
  phoneNormalized: string;
  fullName: string | null;
  telegramChatId: string | null;
  telegramUserId: string | null;
  telegramUsername: string | null;
  bookings: number;
  viberListings: number;
}

export interface PhoneLookupReport {
  phone: string;
  person: PhoneLookupPerson | null;
  telegram: {
    name: string | null;
    username: string | null;
  };
  opendatabot: PhoneLookupOpendatabot;
  phonecheck: {
    url: string;
    hasData: boolean;
  } | null;
  suggestedName: string | null;
  reportText: string;
}

function formatFirstFopShort(entries: OpendatabotFopEntry[]): string | null {
  const first = entries[0];
  if (!first?.name?.trim()) return null;
  let fullName = first.name.trim();
  if (fullName.startsWith('ФОП ')) fullName = fullName.slice(4).trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return fullName || null;
}

async function lookupOpendatabotDetailed(phone: string): Promise<PhoneLookupOpendatabot> {
  const normalized = phone.trim().replace(/^\+/, '');
  const url = `https://opendatabot.ua/t/${normalized}`;
  const empty: PhoneLookupOpendatabot = {
    url,
    foundCountDeclared: null,
    entries: [],
    shortName: null,
  };
  if (!normalized) return { ...empty, error: 'Порожній номер' };

  const pythonCmd =
    process.env.OPENDATABOT_PYTHON?.trim() ||
    process.env.TELEGRAM_USER_PYTHON?.trim() ||
    'python3';
  const scriptPath = path.join(__dirname, '..', 'opendatabot-fop-parser', 'run_opendatabot_phone_lookup.py');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendatabot-phone-'));

  return new Promise((resolve) => {
    const child = spawn(pythonCmd, [scriptPath, normalized, '--json', '--out-dir', outDir], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      try {
        fs.rmSync(outDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup errors */
      }
      const text = stdout.trim();
      if (code === 0 && text) {
        try {
          const data = JSON.parse(text) as {
            result?: {
              found_count_declared?: number | null;
              entries?: OpendatabotFopEntry[];
            };
          };
          const entries = Array.isArray(data.result?.entries) ? data.result!.entries! : [];
          resolve({
            url,
            foundCountDeclared: data.result?.found_count_declared ?? null,
            entries,
            shortName: formatFirstFopShort(entries),
          });
          return;
        } catch (err) {
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
        fs.rmSync(outDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve({ ...empty, error: err.message || 'Spawn error' });
    });
  });
}

function buildReportText(report: Omit<PhoneLookupReport, 'reportText'>): string {
  const lines: string[] = [];
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
  } else {
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
  } else {
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
  } else {
    lines.push('Перевірку не виконано.');
  }
  lines.push('');

  lines.push('— Підсумок —');
  lines.push(`Рекомендоване ім'я: ${report.suggestedName || '—'}`);
  return lines.join('\n');
}

export async function lookupPhoneReport(
  prisma: PrismaClient,
  rawPhone: string,
): Promise<PhoneLookupReport> {
  const phone = normalizePhone(rawPhone);
  if (!phone || phone.length < 10) {
    throw new Error('Некоректний номер телефону');
  }

  const personRow = await prisma.person.findUnique({
    where: { phoneNormalized: phone },
    include: { _count: { select: { bookings: true, viberListings: true } } },
  });

  const person: PhoneLookupPerson | null = personRow
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
    resolveNameByPhoneFromTelegram(phone),
    resolveUsernameByPhoneFromTelegram(phone),
    lookupOpendatabotDetailed(phone),
    runPhoneCheckForPhone(phone),
  ]);

  const { newName } = pickBestNameFromCandidates(
    person?.fullName ?? null,
    null,
    nameFromTelegram,
    opendatabot.shortName,
  );

  const draft: Omit<PhoneLookupReport, 'reportText'> = {
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
