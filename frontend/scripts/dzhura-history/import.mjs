#!/usr/bin/env node
/**
 * Джура · вбудований імпорт історії Telegram: chat.txt (render.mjs --mode import) → задачі слухача `import_history`.
 * Повідомлення з'являються справжніми, з іменами авторів і датами, з позначкою «імпортовано». Потрібен адмін
 * у супергрупі. Між імпортами в одну групу Telegram вимагає паузу 5 хв.
 *
 *   DZHURA_ADMIN_TOKEN=… node scripts/dzhura-history/import.mjs --chat <DzhuraChat.id> --dir <render-out> \
 *     [--file-name "WhatsApp Chat with ОСББ.txt"] [--dry-run]
 *
 * --dry-run лише перевіряє, що Telegram розпізнав формат і пускає імпорт у цей чат (нічого не імпортує).
 * До 20 картинок — одна задача; більше — частинами: init (текст і кількість картинок) → media по ≤ 20 → start.
 * Якщо частина не вдалася, start не надсилається і Telegram сам відкидає незавершений імпорт — у групі нічого.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { API_BASE } from '../api-base.mjs';

const ONE_SHOT_MEDIA = 20;
/** express.json приймає до 2 МБ — лишаємо запас на JSON-обгортку */
const MAX_BODY_CHARS = 1_500_000;
const AHEAD = 3;

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--chat') out.chat = Number(v());
    else if (a === '--dir') out.dir = v();
    else if (a === '--file-name') out.fileName = v();
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--api') out.api = v();
    else throw new Error(`Невідомий аргумент ${a}`);
  }
  if (!Number.isInteger(out.chat) || out.chat <= 0 || !out.dir) throw new Error('Потрібні --chat <id> і --dir');
  return out;
}

const args = parseArgs(process.argv.slice(2));
const api = (args.api ?? API_BASE).replace(/\/$/, '');
const token = (process.env.DZHURA_ADMIN_TOKEN || process.env.VIBER_ADMIN_TOKEN || '').trim();
if (!token) throw new Error('Немає DZHURA_ADMIN_TOKEN / VIBER_ADMIN_TOKEN');

const manifest = JSON.parse(await readFile(path.join(args.dir, 'manifest.json'), 'utf8'));
if (manifest.mode !== 'import') throw new Error('Це не вивід render.mjs --mode import');
const text = await readFile(path.join(args.dir, manifest.textFile), 'utf8');
const media = await Promise.all(
  (manifest.media ?? []).map(async (name) => ({
    name,
    jpegBase64: (await readFile(path.join(args.dir, name))).toString('base64'),
  })),
);
const fileName = args.fileName ? { fileName: args.fileName } : {};

async function call(method, url, body) {
  const res = await fetch(`${api}${url}`, {
    method,
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function create(body) {
  const { status, json } = await call('POST', '/admin/dzhura/jobs', { type: 'import_history', chatId: args.chat, ...body });
  if (status !== 201) throw new Error(`HTTP ${status} ${json.error ?? ''}`);
  return json.job.id;
}

async function waitJob(id) {
  for (;;) {
    await sleep(4000);
    const { status, json: job } = await call('GET', `/admin/dzhura/jobs/${id}`);
    if (status !== 200) continue;
    if (job.status === 'done') return job.result;
    if (job.status === 'failed') throw new Error(`задача ${id} не вдалася: ${job.errorText}`);
  }
}

const lines = text.split('\n').length - 1;
const mediaChars = media.reduce((n, m) => n + m.jpegBase64.length, 0);

if (args.dryRun || (media.length <= ONE_SHOT_MEDIA && mediaChars + text.length < MAX_BODY_CHARS)) {
  const id = await create({ text, media: args.dryRun ? [] : media, dryRun: args.dryRun, ...fileName });
  console.log(`задача ${id}: ${lines} рядків, ${media.length} картинок${args.dryRun ? ', лише перевірка' : ''}`);
  console.log('готово:', JSON.stringify(await waitJob(id)));
  process.exit(0);
}

// Частинами: init → media… → start
const initId = await create({ stage: 'init', text, mediaCount: media.length, ...fileName });
console.log(`init: задача ${initId}, ${lines} рядків, ${media.length} картинок`);
const init = await waitJob(initId);
const importId = String(init.importId);
console.log(`init готово, importId ${importId}`);

const parts = [];
let cur = [];
let size = 0;
for (const m of media) {
  const s = m.jpegBase64.length + m.name.length + 64;
  if (cur.length && (cur.length >= ONE_SHOT_MEDIA || size + s > MAX_BODY_CHARS)) {
    parts.push(cur);
    cur = [];
    size = 0;
  }
  cur.push(m);
  size += s;
}
if (cur.length) parts.push(cur);

const open = [];
let sent = 0;
for (const [i, part] of parts.entries()) {
  while (open.length >= AHEAD) {
    const { id, n } = open.shift();
    await waitJob(id);
    sent += n;
    console.log(`  картинки: ${sent} / ${media.length}`);
  }
  open.push({ id: await create({ stage: 'media', importId, media: part }), n: part.length });
  if (i === 0) console.log(`  media: ${parts.length} задач`);
}
while (open.length) {
  const { id, n } = open.shift();
  await waitJob(id);
  sent += n;
  console.log(`  картинки: ${sent} / ${media.length}`);
}
const startId = await create({ stage: 'start', importId });
console.log('start:', JSON.stringify(await waitJob(startId)));
