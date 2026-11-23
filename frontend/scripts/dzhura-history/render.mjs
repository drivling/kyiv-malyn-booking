#!/usr/bin/env node
/**
 * Джура · відновлення історії чату: експорт журналу → картинки «як у Telegram», пости або файл імпорту.
 *
 *   node scripts/dzhura-history/render.mjs --export osbb.json [--export older.json] \
 *     --mode single|chunk|text|posts|import [--from <tgMessageId>] [--to <tgMessageId>] [--ids 1,2,3] \
 *     [--avatars avatars.json] [--format android|ios|android-slash] [--attach-avatars | --attach-headers]
 *     [--header-style full|date] [--rename <tgUserId>=<ім'я>]… [--exclude-ids <file.json|1,2,3>] --out <dir>
 *
 * Режими: single — картинка на повідомлення; chunk — «скріншоти» розмови; text — HTML-пости по кілька
 * повідомлень; posts — пост на повідомлення: шапка-картинка (аватарка, ім'я, час) + текст підписом;
 * import — chat.txt у форматі експорту WhatsApp для вбудованого імпорту Telegram (--attach-avatars прикладає
 * аватарку до першого повідомлення кожного автора, --attach-headers — шапку як у posts до кожного повідомлення;
 * --header-style date — лише аватарка й дата на прозорому тлі, PNG). --rename міняє ім'я автора всюди (підпис,
 * цитати, переслане); --exclude-ids — повідомлення, які пропустити (наприклад ті, що пережили очищення:
 * результат задачі scan_ids `{ ids: [[id, дата], …] }` або список id). Службовий автор «Imported Message»
 * (наші ж імпортовані повідомлення, які Джура записала в журнал) пропускається завжди.
 * Експорт — GET /admin/dzhura/chats/:id/export?from=&to= (до 366 днів за раз, кілька файлів можна скласти).
 * Аватарки — результат задачі слухача `avatars` ({ avatars: { <tgUserId>: <jpeg base64> } }); без них — кружечки
 * з ініціалами, як Telegram малює людей без фото. У <dir> пишуться файли і manifest.json для post.mjs / import.mjs.
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
  headersPageHtml,
  layout,
  pageHtml,
  postParts,
  rangeCaption,
  textPosts,
  whatsappText,
} from './cards.mjs';

const MODES = ['single', 'chunk', 'text', 'posts', 'import'];

function parseArgs(argv) {
  const out = {
    exports: [],
    mode: 'chunk',
    quality: 88,
    format: 'android',
    attachAvatars: false,
    attachHeaders: false,
    headerStyle: 'full',
    rename: new Map(),
    exclude: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--export') out.exports.push(v());
    else if (a === '--mode') out.mode = v();
    else if (a === '--from') out.from = BigInt(v());
    else if (a === '--to') out.to = BigInt(v());
    else if (a === '--ids') out.ids = new Set(v().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--avatars') out.avatars = v();
    else if (a === '--format') out.format = v();
    else if (a === '--attach-avatars') out.attachAvatars = true;
    else if (a === '--attach-headers') out.attachHeaders = true;
    else if (a === '--header-style') out.headerStyle = v();
    else if (a === '--rename') {
      const [id, ...name] = v().split('=');
      out.rename.set(id.trim(), name.join('=').trim());
    } else if (a === '--exclude-ids') out.exclude.push(v());
    else if (a === '--out') out.out = v();
    else if (a === '--quality') out.quality = Number(v());
    else throw new Error(`Невідомий аргумент ${a}`);
  }
  if (!out.exports.length || !out.out) throw new Error('Потрібні --export і --out');
  if (!MODES.includes(out.mode)) throw new Error(`--mode: ${MODES.join(' | ')}`);
  return out;
}

const args = parseArgs(process.argv.slice(2));
const exports = await Promise.all(args.exports.map(async (f) => JSON.parse(await readFile(f, 'utf8'))));
const avatars = args.avatars ? (JSON.parse(await readFile(args.avatars, 'utf8')).avatars ?? {}) : {};
/** Інше ім'я автора — всюди: відправник, люди (для переслань), переслане від нього */
for (const ex of exports) {
  for (const p of ex.persons ?? []) {
    const name = args.rename.get(String(p.tgUserId));
    if (name) Object.assign(p, { firstName: name, lastName: null });
  }
  for (const m of ex.messages ?? []) {
    const name = args.rename.get(String(m.sender?.tgUserId ?? ''));
    if (name) m.sender = { ...m.sender, name };
    const fwdName = m.forward?.tgId ? args.rename.get(String(m.forward.tgId)) : null;
    if (fwdName) m.forward = { ...m.forward, name: fwdName };
  }
}
const ctx = buildContext(exports, avatars);

const excluded = new Set();
for (const src of args.exclude) {
  let list;
  if (/^[\d,\s]+$/.test(src)) list = src.split(',');
  else {
    const j = JSON.parse(await readFile(src, 'utf8'));
    list = (Array.isArray(j) ? j : (j.ids ?? [])).map((x) => (Array.isArray(x) ? x[0] : x));
  }
  for (const id of list) if (String(id).trim()) excluded.add(String(id).trim());
}
const IMPORTED_SENDER = 'Imported Message';

const seen = new Set();
const messages = exports
  .flatMap((e) => e.messages ?? [])
  .filter((m) => {
    const id = BigInt(m.tgMessageId);
    if (seen.has(m.tgMessageId)) return false;
    seen.add(m.tgMessageId);
    if (excluded.has(String(m.tgMessageId)) || m.sender?.name === IMPORTED_SENDER) return false;
    if (args.ids && !args.ids.has(String(m.tgMessageId))) return false;
    if (args.from != null && id < args.from) return false;
    if (args.to != null && id > args.to) return false;
    return true;
  })
  .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || Number(BigInt(a.tgMessageId) - BigInt(b.tgMessageId)));

await mkdir(args.out, { recursive: true });
const manifest = { mode: args.mode, chat: exports[0]?.chat ?? null, messages: messages.length, items: [] };

async function withPage(html, fn) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: CARD_WIDTH, height: 800 }, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

if (args.mode === 'text') {
  manifest.items = textPosts(messages, ctx).map((html) => ({ kind: 'text', html }));
} else if (args.mode === 'import') {
  const attach = new Map();
  manifest.media = [];
  const mediaName = (m) => `IMG-${m.sentAt.slice(0, 10).replace(/-/g, '')}-WA${String(manifest.media.length + 1).padStart(4, '0')}.jpg`;
  if (args.attachHeaders) {
    const png = args.headerStyle === 'date';
    await withPage(headersPageHtml(messages, ctx, args.headerStyle), async (page) => {
      for (const m of messages) {
        const file = png ? mediaName(m).replace(/\.jpg$/, '.png') : mediaName(m);
        const shot = png
          ? { path: path.join(args.out, file), type: 'png', omitBackground: true }
          : { path: path.join(args.out, file), type: 'jpeg', quality: args.quality };
        await page.locator(`.hdr[data-id="${m.tgMessageId}"]`).screenshot(shot);
        attach.set(String(m.tgMessageId), file);
        manifest.media.push(file);
      }
    });
  } else if (args.attachAvatars) {
    const done = new Set();
    for (const m of messages) {
      const uid = String(m.sender?.tgUserId ?? '');
      if (!uid || done.has(uid) || !avatars[uid]) continue;
      done.add(uid);
      const file = mediaName(m);
      await writeFile(path.join(args.out, file), Buffer.from(avatars[uid], 'base64'));
      attach.set(String(m.tgMessageId), file);
      manifest.media.push(file);
    }
  }
  manifest.format = args.format;
  manifest.textFile = 'chat.txt';
  await writeFile(path.join(args.out, 'chat.txt'), whatsappText(messages, ctx, { format: args.format, attach }));
} else if (args.mode === 'posts') {
  await withPage(headersPageHtml(messages, ctx), async (page) => {
    for (const [i, m] of messages.entries()) {
      const file = `${String(i + 1).padStart(4, '0')}.jpg`;
      await page
        .locator(`.hdr[data-id="${m.tgMessageId}"]`)
        .screenshot({ path: path.join(args.out, file), type: 'jpeg', quality: args.quality });
      const { caption, rest } = postParts(m, ctx);
      manifest.items.push({ kind: 'photo', file, ids: [String(m.tgMessageId)], captionHtml: caption });
      for (const html of rest) manifest.items.push({ kind: 'text', html });
    }
  });
} else {
  await withPage(pageHtml(messages, ctx), async (page) => {
    const cards = await page.evaluate(layout, { mode: args.mode, maxHeight: PAGE_MAX_HEIGHT, gapMs: GROUP_GAP_MS });
    const byId = new Map(messages.map((m) => [String(m.tgMessageId), m]));
    for (const [i, c] of cards.entries()) {
      const file = `${String(i + 1).padStart(4, '0')}.jpg`;
      await page.locator(`#${c.id}`).screenshot({ path: path.join(args.out, file), type: 'jpeg', quality: args.quality });
      const first = byId.get(c.ids[0]);
      const last = byId.get(c.ids[c.ids.length - 1]);
      manifest.items.push({ kind: 'photo', file, ids: c.ids, height: c.height, caption: rangeCaption(first, last) });
    }
  });
}

await writeFile(path.join(args.out, 'manifest.json'), JSON.stringify(manifest, null, 2));
const what = args.mode === 'import' ? `chat.txt + ${manifest.media.length} картинок` : `${manifest.items.length} шт.`;
console.log(`${args.mode}: ${messages.length} повідомлень → ${what} у ${args.out}`);
