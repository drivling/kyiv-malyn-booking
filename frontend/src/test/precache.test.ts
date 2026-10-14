import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without types; excluded from tsc via tsconfig "exclude"
import { SHELL_URL, assertShellCovered, buildPrecache, renderServiceWorker, shellAssetRefs } from '../../scripts/precache.mjs';

const hashes: Record<string, string> = { '/index.html': 'h1', '/transport.webmanifest': 'm1', '/icons/transport-192.png': 'i1', '/transport/dataset.json': 'd1' };
const args = () => ({
  assetFiles: ['assets/index-B.css', 'assets/index-A.js', 'assets/marker-C.png'],
  extraFiles: ['transport.webmanifest', 'icons/transport-192.png', 'transport/dataset.json'],
  fileHash: (url: string) => hashes[url] ?? 'x',
});

describe('precache (Docs/transport-pwa-2026-10.md, фаза 4)', () => {
  it('оболонка, потім assets, потім решта — відсортовано, з провідним слешем', () => {
    const { urls } = buildPrecache(args());
    expect(urls).toEqual([
      SHELL_URL,
      '/assets/index-A.js',
      '/assets/index-B.css',
      '/assets/marker-C.png',
      '/icons/transport-192.png',
      '/transport.webmanifest',
      '/transport/dataset.json',
    ]);
  });

  it('BUILD_ID змінюється від вмісту нехешованих файлів (знімок даних), а не лише від списку', () => {
    const a = buildPrecache(args()).buildId;
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(buildPrecache(args()).buildId).toBe(a);
    const changedSnapshot = buildPrecache({ ...args(), fileHash: (u: string) => (u === '/transport/dataset.json' ? 'd2' : hashes[u] ?? 'x') }).buildId;
    expect(changedSnapshot).not.toBe(a);
    const moreAssets = buildPrecache({ ...args(), assetFiles: ['assets/index-A.js'] }).buildId;
    expect(moreAssets).not.toBe(a);
  });

  it('оболонка не може посилатись на asset поза precache', () => {
    const html = '<script type="module" crossorigin src="/assets/index-A.js"></script><link rel="stylesheet" crossorigin href="/assets/index-B.css"><link rel="icon" href="/icons/transport.svg">';
    expect(shellAssetRefs(html)).toEqual(['/assets/index-A.js', '/assets/index-B.css']);
    expect(() => assertShellCovered(buildPrecache(args()).urls, html)).not.toThrow();
    expect(() => assertShellCovered(['/index.html', '/assets/index-A.js'], html)).toThrow(/index-B\.css/);
  });

  it('шаблон отримує список і BUILD_ID; незамінений плейсхолдер — помилка', () => {
    const sw = renderServiceWorker("const BUILD_ID = '__BUILD_ID__';\nconst PRECACHE = __PRECACHE__;", { urls: ['/index.html'], buildId: 'abc' });
    expect(sw).toContain('const BUILD_ID = "abc";');
    expect(sw).toContain('"/index.html"');
    expect(() => renderServiceWorker('nothing here', { urls: [], buildId: 'x' })).toThrow(/placeholders/);
  });
});
