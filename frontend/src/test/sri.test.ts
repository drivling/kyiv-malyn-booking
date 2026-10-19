import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without types; excluded from tsc via tsconfig "exclude"
import { addIntegrity, sriOf } from '../../scripts/sri.mjs';
// @ts-expect-error — same
import { shellAssetRefs } from '../../scripts/precache.mjs';
import { bundleInHtml, loadedBundle } from '@/site/freshBuild';

const files: Record<string, string> = { '/assets/index-A1.js': 'console.log(1)', '/assets/index-B2.css': 'body{margin:0}' };
const read = (url: string) => (url in files ? Buffer.from(files[url]) : null);
const sha384 = (s: string) => `sha384-${createHash('sha384').update(s).digest('base64')}`;

// Так виглядає оболонка після `vite build` (голий crossorigin, без integrity)
const shell = `<!doctype html><html><head>
    <link rel="icon" href="/favicon.ico" sizes="32x32" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Outfit" rel="stylesheet" crossorigin="anonymous" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>
    <script type="module" crossorigin src="/assets/index-A1.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-B2.css">
  </head><body><div id="root"></div></body></html>`;

describe('sri (Docs/transport-verifiable-build-2026-10.md, фаза 1)', () => {
  it('sha384 від вмісту у форматі атрибута integrity', () => {
    expect(sriOf(Buffer.from('abc'))).toBe(sha384('abc'));
  });

  it('підписує точку входу і таблицю стилів з /assets/, явний crossorigin="anonymous"; чужі теги не чіпає', () => {
    const { html, signed } = addIntegrity(shell, read);
    expect(signed).toEqual({ '/assets/index-A1.js': sha384(files['/assets/index-A1.js']), '/assets/index-B2.css': sha384(files['/assets/index-B2.css']) });
    expect(html).toContain(`<script type="module" src="/assets/index-A1.js" integrity="${signed['/assets/index-A1.js']}" crossorigin="anonymous"></script>`);
    expect(html).toContain(`<link rel="stylesheet" href="/assets/index-B2.css" integrity="${signed['/assets/index-B2.css']}" crossorigin="anonymous">`);
    // favicon, preconnect, Google Fonts і gtag — без змін
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32" />');
    expect(html).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />');
    expect(html).toContain('<link href="https://fonts.googleapis.com/css2?family=Outfit" rel="stylesheet" crossorigin="anonymous" />');
    expect(html).toContain('<script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>');
    expect((html.match(/integrity=/g) || []).length).toBe(2);
  });

  it('ідемпотентно: повторний прогін дає той самий HTML, зміна файлу — інший хеш', () => {
    const once = addIntegrity(shell, read).html;
    expect(addIntegrity(once, read).html).toBe(once);
    const changed = addIntegrity(once, (url) => (url === '/assets/index-A1.js' ? Buffer.from('console.log(2)') : read(url))).html;
    expect(changed).not.toBe(once);
    expect(changed).toContain(sha384('console.log(2)'));
    expect((changed.match(/integrity=/g) || []).length).toBe(2);
  });

  it('файл, на який посилається оболонка, має лежати в dist; оболонка без бандла — помилка', () => {
    expect(() => addIntegrity(shell, () => null)).toThrow(/index-A1\.js.*missing/);
    expect(() => addIntegrity('<html><head><script type="module" src="/src/main.tsx"></script></head></html>', read)).toThrow(/vite build/);
  });

  it('freshBuild і precache читають підписану оболонку так само, як непідписану', () => {
    const { html } = addIntegrity(shell, read);
    expect(bundleInHtml(html)).toBe('/assets/index-A1.js');
    expect(shellAssetRefs(html)).toEqual(['/assets/index-A1.js', '/assets/index-B2.css']);
    document.head.innerHTML = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
    expect(loadedBundle()).toBe('/assets/index-A1.js');
    document.head.innerHTML = '';
  });
});
