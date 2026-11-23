#!/usr/bin/env node
/**
 * Джура · відновлення історії чату: експорт журналу → картинки «як у Telegram» (або текстові пости).
 *
 *   node scripts/dzhura-history/render.mjs --export osbb.json [--export older.json] \
 *     --mode single|chunk|text [--from <tgMessageId>] [--to <tgMessageId>] [--avatars avatars.json] --out <dir>
 *
 * Експорт — GET /admin/dzhura/chats/:id/export?from=&to= (до 366 днів за раз, кілька файлів можна скласти).
 * Аватарки — результат задачі слухача `avatars` ({ avatars: { <tgUserId>: <jpeg base64> } }); без них — кружечки
 * з ініціалами, як Telegram малює людей без фото. У <dir> пишуться NNN.jpg і manifest.json для post.mjs.
 * Локально, нічого в Telegram не шле. Chromium — той самий, що у Playwright-тестів.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import {
  CARD_WIDTH,
  GROUP_GAP_MS,
  PAGE_MAX_HEIGHT,
  buildContext,
  layout,
  pageHtml,
  rangeCaption,
  textPosts,
} from './cards.mjs';

function parseArgs(argv) {
  const out = { exports: [], mode: 'chunk', quality: 88 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--export') out.exports.push(v());
    else if (a === '--mode') out.mode = v();
    else if (a === '--from') out.from = BigInt(v());
    else if (a === '--to') out.to = BigInt(v());
    else if (a === '--avatars') out.avatars = v();
    else if (a === '--out') out.out = v();
    else if (a === '--quality') out.quality = Number(v());
    else throw new Error(`Невідомий аргумент ${a}`);
  }
  if (!out.exports.length || !out.out) throw new Error('Потрібні --export і --out');
  if (!['single', 'chunk', 'text'].includes(out.mode)) throw new Error('--mode: single | chunk | text');
  return out;
}

const args = parseArgs(process.argv.slice(2));
const exports = await Promise.all(args.exports.map(async (f) => JSON.parse(await readFile(f, 'utf8'))));
const avatars = args.avatars ? (JSON.parse(await readFile(args.avatars, 'utf8')).avatars ?? {}) : {};
const ctx = buildContext(exports, avatars);

const seen = new Set();
const messages = exports
  .flatMap((e) => e.messages ?? [])
  .filter((m) => {
    const id = BigInt(m.tgMessageId);
    if (seen.has(m.tgMessageId)) return false;
    seen.add(m.tgMessageId);
    if (args.from != null && id < args.from) return false;
    if (args.to != null && id > args.to) return false;
    return true;
  })
  .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || Number(BigInt(a.tgMessageId) - BigInt(b.tgMessageId)));

await mkdir(args.out, { recursive: true });
const manifest = { mode: args.mode, chat: exports[0]?.chat ?? null, messages: messages.length, items: [] };

if (args.mode === 'text') {
  manifest.items = textPosts(messages, ctx).map((html) => ({ kind: 'text', html }));
} else {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: CARD_WIDTH, height: 800 }, deviceScaleFactor: 2 });
    await page.setContent(pageHtml(messages, ctx), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const cards = await page.evaluate(layout, { mode: args.mode, maxHeight: PAGE_MAX_HEIGHT, gapMs: GROUP_GAP_MS });
    const byId = new Map(messages.map((m) => [String(m.tgMessageId), m]));
    for (const [i, c] of cards.entries()) {
      const file = `${String(i + 1).padStart(4, '0')}.jpg`;
      await page.locator(`#${c.id}`).screenshot({ path: path.join(args.out, file), type: 'jpeg', quality: args.quality });
      const first = byId.get(c.ids[0]);
      const last = byId.get(c.ids[c.ids.length - 1]);
      manifest.items.push({ kind: 'photo', file, ids: c.ids, height: c.height, caption: rangeCaption(first, last) });
    }
  } finally {
    await browser.close();
  }
}

await writeFile(path.join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`${args.mode}: ${messages.length} повідомлень → ${manifest.items.length} шт. у ${args.out}`);
