/**
 * Крок збірки (після sri.mjs): dist/dovede/index.html — оболонка SPA з шапкою «Доведе» (назва, опис, іконки вкладки,
 * картка посилання). Без неї Telegram показав би на /dovede і dovede.online картку «Як доїхати». Правила заміни —
 * `dovedeHtml` у dovede-brand.mjs. Скрипти й SRI ті самі, що в dist/index.html, тож сторінка вантажить той самий бандл.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dovedeHtml } from './dovede-brand.mjs';
import { PRIMARY_ORIGIN } from './site-hosts.mjs';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const out = path.join(dist, 'dovede', 'index.html');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, dovedeHtml(readFileSync(path.join(dist, 'index.html'), 'utf8'), PRIMARY_ORIGIN), 'utf8');
console.log('[dovede-html] dist/dovede/index.html');
