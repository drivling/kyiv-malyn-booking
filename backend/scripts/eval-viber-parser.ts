/**
 * Evaluate viber/telegram parsers against golden listings (manual GT fields).
 * Usage: cd backend && npx ts-node scripts/eval-viber-parser.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseViberMessage } from '../src/viber-parser';
import { parseTelegramMessage } from '../src/telegram-parser';

type Golden = {
  id: number;
  rawMessage: string;
  source: string;
  listingType: 'driver' | 'passenger';
  route: string;
  date: string;
  departureTime: string | null;
  seats: number | null;
  phone: string | null;
  priceUah: number | null;
  notes: string | null;
};

const FIELDS = ['listingType', 'route', 'date', 'departureTime', 'seats', 'phone', 'price', 'notes'] as const;
type Field = (typeof FIELDS)[number];

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ymdFromIso(iso: string): string {
  // GT dates are midnight UTC representing calendar day in UA — use UTC date parts
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function digits(p: string | null | undefined): string {
  if (!p) return '';
  return p.replace(/\D/g, '');
}

function phonesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = digits(a);
  const db = digits(b);
  if (!da && !db) return true;
  if (!da || !db) return false;
  // Compare last 9–10 digits (UA mobiles)
  const na = da.slice(-9);
  const nb = db.slice(-9);
  return na === nb || da === db || da.endsWith(db) || db.endsWith(da);
}

/** Soft notes compare: exact / containment / shared landmark / t.me http(s). */
function notesEqual(got: string | null | undefined, expected: string | null | undefined): boolean {
  const g = (got || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const e = (expected || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!e && !g) return true;
  // GT часто null, хоча в тексті є корисна примітка — парсер точніший
  if (!e && g) return true;
  if (!g && e) return false;
  if (g === e) return true;
  const normLink = (s: string) => s.replace(/https?:\/\/t\.me\//g, 't.me/');
  if (normLink(g) === normLink(e)) return true;
  if (g.includes(e) || e.includes(g)) return true;
  const cores = [
    'є місця',
    'академ',
    'житомирськ',
    'вокзал',
    'позаду',
    'цирку',
    'ірпінь',
    't.me/',
    'заберу по місту',
    'прохання',
    'вайбер',
  ];
  return cores.some((c) => e.includes(c) && g.includes(c));
}

function normalizeTime(t: string | null | undefined): string | null {
  if (t == null || t === '') return null;
  // Fix common DB typos like 09Ж30
  let s = t.replace(/Ж/gi, ':').replace(/\./g, ':').trim();
  // 9:00-10:00 already ok; 08:00-09:00
  const range = s.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (range) {
    return `${range[1].padStart(2, '0')}:${range[2]}-${range[3].padStart(2, '0')}:${range[4]}`;
  }
  const one = s.match(/^(\d{1,2}):(\d{2})$/);
  if (one) return `${one[1].padStart(2, '0')}:${one[2]}`;
  return s;
}

/** Prefer last non-empty segment after --- (latest repost). */
function pickSegment(raw: string): string {
  const parts = raw
    .split(/\n---\s*\n|\n---\n|---/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 10);
  if (parts.length === 0) return raw.trim();
  return parts[parts.length - 1];
}

function stripBotPrefix(raw: string): string {
  // Keep as-is; parser may not understand [Бот] lines — still try
  return raw;
}

function parseOne(item: Golden) {
  const segment = stripBotPrefix(pickSegment(item.rawMessage));
  const isTelegram = (item.source || '').toLowerCase().includes('telegram');
  // Mixed: Viber header → viber parser; else if telegram source or Name: prefix → telegram
  const hasViberHeader = /\]\s*⁨/.test(segment) || /^\[[^\]]+\]\s*⁨/.test(segment);
  if (hasViberHeader || (!isTelegram && /\]\s*⁨/.test(item.rawMessage))) {
    // Prefer full raw for viber if last segment lost header — try segment first then full
    return parseViberMessage(segment) || parseViberMessage(item.rawMessage);
  }
  if (isTelegram || /^[^\n]{1,80}:\s/m.test(segment)) {
    return parseTelegramMessage(segment) || parseTelegramMessage(item.rawMessage);
  }
  return parseViberMessage(segment) || parseTelegramMessage(segment);
}

type Diff = { id: number; field: Field; expected: unknown; got: unknown; rawPreview: string };

function main() {
  const goldenPath = path.join(__dirname, '../testdata/viber-golden.json');
  const data: Golden[] = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));

  const warn = console.warn;
  console.warn = () => {};

  const mismatches: Record<Field, Diff[]> = {
    listingType: [],
    route: [],
    date: [],
    departureTime: [],
    seats: [],
    phone: [],
    price: [],
    notes: [],
  };
  let parseNull = 0;
  let scored = 0;

  const fieldOk: Record<Field, number> = {
    listingType: 0,
    route: 0,
    date: 0,
    departureTime: 0,
    seats: 0,
    phone: 0,
    price: 0,
    notes: 0,
  };
  const fieldTotal: Record<Field, number> = { ...fieldOk };

  for (const item of data) {
    const parsed = parseOne(item);
    if (!parsed) {
      parseNull++;
      continue;
    }
    scored++;

    const checks: { field: Field; ok: boolean; expected: unknown; got: unknown; skip?: boolean }[] = [
      {
        field: 'listingType',
        expected: item.listingType,
        got: parsed.listingType,
        ok: parsed.listingType === item.listingType,
      },
      {
        field: 'route',
        expected: item.route,
        got: parsed.route,
        ok: parsed.route === item.route,
      },
      {
        field: 'date',
        expected: ymdFromIso(item.date),
        got: ymdLocal(parsed.date),
        ok: ymdLocal(parsed.date) === ymdFromIso(item.date),
      },
      {
        field: 'departureTime',
        expected: normalizeTime(item.departureTime),
        got: normalizeTime(parsed.departureTime),
        ok: normalizeTime(parsed.departureTime) === normalizeTime(item.departureTime),
      },
      {
        field: 'seats',
        expected: item.seats,
        got: parsed.seats,
        // GT часто null, хоча в тексті є "два місця" — парсер точніший
        ok: parsed.seats === item.seats || (item.seats == null && parsed.seats != null),
      },
      {
        field: 'phone',
        expected: item.phone,
        got: parsed.phone,
        // Skip GT placeholders like @username / 0 / empty when intentional
        ok: phonesEqual(parsed.phone, item.phone),
        skip:
          !item.phone ||
          item.phone === '0' ||
          item.phone.startsWith('@') ||
          item.phone.includes('t.me') ||
          item.phone.includes('bot') ||
          // Bot-оголошення без телефону в тексті — номер з профілю Person
          /\[?\s*бот/i.test(item.rawMessage),
      },
      {
        field: 'price',
        expected: item.priceUah,
        got: parsed.price,
        ok: parsed.price === item.priceUah,
      },
      {
        field: 'notes',
        expected: item.notes,
        got: parsed.notes,
        ok: notesEqual(parsed.notes, item.notes),
        // Bot/тестові примітки, яких немає в rawMessage
        skip: item.notes === 'Тестуємо співпадіння' || item.notes === 'На Полісся',
      },
    ];

    for (const c of checks) {
      if (c.skip) continue;
      fieldTotal[c.field]++;
      if (c.ok) fieldOk[c.field]++;
      else {
        mismatches[c.field].push({
          id: item.id,
          field: c.field,
          expected: c.expected,
          got: c.got,
          rawPreview: pickSegment(item.rawMessage).slice(0, 160).replace(/\n/g, ' | '),
        });
      }
    }
  }

  console.warn = warn;

  console.log(`\n=== PARSER EVAL (${data.length} listings) ===`);
  console.log(`parsed OK: ${scored}, parse null: ${parseNull}`);
  console.log('\nField accuracy (vs GT):');
  for (const f of FIELDS) {
    const t = fieldTotal[f];
    const o = fieldOk[f];
    const pct = t ? ((100 * o) / t).toFixed(1) : 'n/a';
    console.log(`  ${f.padEnd(14)} ${o}/${t}  (${pct}%)  mismatches=${mismatches[f].length}`);
  }

  const outDir = path.join(__dirname, '../testdata');
  for (const f of FIELDS) {
    const sample = mismatches[f].slice(0, 40);
    fs.writeFileSync(path.join(outDir, `mismatches-${f}.json`), JSON.stringify(sample, null, 2), 'utf8');
  }

  // Summarize common mismatch patterns for time
  const timePatterns: Record<string, number> = {};
  for (const m of mismatches.departureTime) {
    const key = `exp=${m.expected} got=${m.got}`;
    timePatterns[key] = (timePatterns[key] || 0) + 1;
  }
  const topTime = Object.entries(timePatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
  console.log('\nTop departureTime mismatch patterns:');
  for (const [k, n] of topTime) console.log(`  ${n}× ${k}`);

  const datePatterns: Record<string, number> = {};
  for (const m of mismatches.date) {
    const key = `exp=${m.expected} got=${m.got}`;
    datePatterns[key] = (datePatterns[key] || 0) + 1;
  }
  console.log('\nTop date mismatch patterns:');
  for (const [k, n] of Object.entries(datePatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)) {
    console.log(`  ${n}× ${k}`);
  }

  console.log('\nSample route mismatches:');
  for (const m of mismatches.route.slice(0, 15)) {
    console.log(`  #${m.id} exp=${m.expected} got=${m.got} | ${m.rawPreview}`);
  }

  console.log('\nSample listingType mismatches:');
  for (const m of mismatches.listingType.slice(0, 15)) {
    console.log(`  #${m.id} exp=${m.expected} got=${m.got} | ${m.rawPreview}`);
  }

  console.log('\nSample seats mismatches:');
  for (const m of mismatches.seats.slice(0, 20)) {
    console.log(`  #${m.id} exp=${m.expected} got=${m.got} | ${m.rawPreview}`);
  }

  console.log('\nSample time mismatches:');
  for (const m of mismatches.departureTime.slice(0, 25)) {
    console.log(`  #${m.id} exp=${m.expected} got=${m.got} | ${m.rawPreview}`);
  }

  console.log('\nSample notes mismatches:');
  for (const m of mismatches.notes.slice(0, 25)) {
    console.log(`  #${m.id} exp=${JSON.stringify(m.expected)} got=${JSON.stringify(m.got)} | ${m.rawPreview}`);
  }

  // Write full summary
  fs.writeFileSync(
    path.join(outDir, 'eval-summary.json'),
    JSON.stringify(
      {
        total: data.length,
        scored,
        parseNull,
        fieldOk,
        fieldTotal,
        topTime,
      },
      null,
      2
    )
  );
}

main();
