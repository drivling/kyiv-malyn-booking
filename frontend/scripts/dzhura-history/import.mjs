#!/usr/bin/env node
/**
 * Джура · вбудований імпорт історії Telegram: chat.txt (render.mjs --mode import) → задача слухача `import_history`.
 * Повідомлення з'являються справжніми, з іменами авторів і датами, з позначкою «імпортовано». Потрібні права адміна.
 *
 *   DZHURA_ADMIN_TOKEN=… node scripts/dzhura-history/import.mjs --chat <DzhuraChat.id> --dir <render-out> \
 *     [--file-name "WhatsApp Chat with ОСББ.txt"] [--dry-run]
 *
 * --dry-run лише перевіряє, що Telegram розпізнав формат і пускає імпорт у цей чат (нічого не імпортує).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { API_BASE } from '../api-base.mjs';

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

async function call(method, url, body) {
  const res = await fetch(`${api}${url}`, {
    method,
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const { status, json } = await call('POST', '/admin/dzhura/jobs', {
  type: 'import_history',
  chatId: args.chat,
  text,
  media,
  dryRun: args.dryRun,
  ...(args.fileName ? { fileName: args.fileName } : {}),
});
if (status !== 201) throw new Error(`HTTP ${status} ${json.error ?? ''}`);
const id = json.job.id;
console.log(`задача ${id}: ${text.split('\n').length - 1} рядків, ${media.length} картинок${args.dryRun ? ', лише перевірка' : ''}`);
for (;;) {
  await new Promise((r) => setTimeout(r, 4000));
  const { status: st, json: job } = await call('GET', `/admin/dzhura/jobs/${id}`);
  if (st !== 200) continue;
  if (job.status === 'done') {
    console.log('готово:', JSON.stringify(job.result));
    break;
  }
  if (job.status === 'failed') {
    console.log('не вдалося:', job.errorText);
    process.exit(1);
  }
}
