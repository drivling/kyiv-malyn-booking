#!/usr/bin/env node
/**
 * Джура · відновлення історії: поставити готові пости (render.mjs) у чергу слухача — задачі `post_items`.
 * Слухач публікує їх від імені власника по черзі, тихо (без сповіщень), з паузою між постами.
 *
 *   DZHURA_ADMIN_TOKEN=… node scripts/dzhura-history/post.mjs --chat <DzhuraChat.id> --batch <name> \
 *     [--say "<b>текст</b>"] --dir <render-out> [--dir …] [--loud] [--ahead 3] [--dry-run]
 *
 * --say і --dir ідуть у тому порядку, у якому написані. Підпис (діапазон часу) отримують лише картинки
 * режиму chunk. Пара batch + seq у сервера унікальна: перезапуск із тим самим --batch пропускає вже
 * поставлене (409), тож обірваний прогін можна просто повторити. Частина, що не вдалася, зупиняє решту партії.
 * Токен: DZHURA_ADMIN_TOKEN або VIBER_ADMIN_TOKEN (адмінський HMAC, у вивід не потрапляє).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { API_BASE } from '../api-base.mjs';
import { escapeHtml } from './cards.mjs';

const MAX_ITEMS = 10;
/** express.json приймає до 2 МБ — лишаємо запас на JSON-обгортку */
const MAX_BODY_CHARS = 1_600_000;

function parseArgs(argv) {
  const out = { steps: [], silent: true, ahead: 3, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--chat') out.chat = Number(v());
    else if (a === '--batch') out.batch = v();
    else if (a === '--say') out.steps.push({ say: v() });
    else if (a === '--dir') out.steps.push({ dir: v() });
    else if (a === '--loud') out.silent = false;
    else if (a === '--ahead') out.ahead = Math.max(1, Number(v()));
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--api') out.api = v();
    else throw new Error(`Невідомий аргумент ${a}`);
  }
  if (!Number.isInteger(out.chat) || out.chat <= 0 || !out.batch || !out.steps.length) {
    throw new Error('Потрібні --chat <id>, --batch <name> і хоча б один --say / --dir');
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const api = (args.api ?? API_BASE).replace(/\/$/, '');
const token = (process.env.DZHURA_ADMIN_TOKEN || process.env.VIBER_ADMIN_TOKEN || '').trim();
if (!token && !args.dryRun) throw new Error('Немає DZHURA_ADMIN_TOKEN / VIBER_ADMIN_TOKEN');

/** Усі пости по порядку */
const items = [];
for (const step of args.steps) {
  if (step.say) {
    items.push({ kind: 'text', html: step.say });
    continue;
  }
  const manifest = JSON.parse(await readFile(path.join(step.dir, 'manifest.json'), 'utf8'));
  for (const it of manifest.items) {
    if (it.kind === 'text') items.push({ kind: 'text', html: it.html });
    else {
      const jpegBase64 = (await readFile(path.join(step.dir, it.file))).toString('base64');
      const caption = it.captionHtml || (manifest.mode === 'chunk' && it.caption ? escapeHtml(it.caption) : undefined);
      items.push(caption ? { kind: 'photo', jpegBase64, caption } : { kind: 'photo', jpegBase64 });
    }
  }
}

/** Частини: ≤ 10 постів і ≤ MAX_BODY_CHARS у тілі запиту */
const parts = [];
let cur = [];
let size = 0;
for (const it of items) {
  const s = (it.jpegBase64?.length ?? 0) + (it.html?.length ?? 0) + (it.caption?.length ?? 0) + 64;
  if (cur.length && (cur.length >= MAX_ITEMS || size + s > MAX_BODY_CHARS)) {
    parts.push(cur);
    cur = [];
    size = 0;
  }
  cur.push(it);
  size += s;
}
if (cur.length) parts.push(cur);

const photos = items.filter((i) => i.kind === 'photo').length;
console.log(`${items.length} постів (${photos} картинок) → ${parts.length} задач, партія ${args.batch}, чат №${args.chat}`);
if (args.dryRun) process.exit(0);

async function call(method, url, body) {
  const res = await fetch(`${api}${url}`, {
    method,
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = new Map(); // seq → job id, ще не завершені

async function refresh() {
  for (const [seq, id] of open) {
    const { status, json } = await call('GET', `/admin/dzhura/jobs/${id}`);
    if (status !== 200) continue;
    if (json.status === 'done') {
      open.delete(seq);
      console.log(`  №${seq} опубліковано: ${json.result?.sent ?? '?'} пост(ів)`);
    } else if (json.status === 'failed') {
      throw new Error(`№${seq} (задача ${id}) не вдалася: ${json.errorText}`);
    }
  }
}

for (const [seq, part] of parts.entries()) {
  while (open.size >= args.ahead) {
    await sleep(5000);
    await refresh();
  }
  const { status, json } = await call('POST', '/admin/dzhura/jobs', {
    type: 'post_items',
    chatId: args.chat,
    batch: args.batch,
    seq,
    silent: args.silent,
    items: part,
  });
  if (status === 409) {
    console.log(`  №${seq}: ${json.error}`);
    continue;
  }
  if (status !== 201) throw new Error(`№${seq}: HTTP ${status} ${json.error ?? ''}`);
  open.set(seq, json.job.id);
  console.log(`  №${seq} у черзі: задача ${json.job.id}, ${part.length} пост(ів)`);
}
while (open.size) {
  await sleep(5000);
  await refresh();
}
console.log('Готово.');
