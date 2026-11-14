/**
 * Покадрова зйомка справжнього фронтенду для тизера (Docs/dovede-teaser/roadmap.md, план 2).
 *
 *   npm run capture -- rides            # одна сцена (capture/scenes/rides.mjs)
 *   npm run capture -- rides --frames 30 # перші 30 кадрів — швидка перевірка
 *
 * Як: піднімаємо `vite` фронтенду (порт 4188), бекенд не потрібен — усі запити до API (http://localhost:4189)
 * перехоплює Playwright і віддає фікстури з capture/fixtures/. Телефон 390 × 844, DPR 3 → кадр 1170 × 2532.
 * Час іде кадр за кадром: годинник сторінки — `page.clock` (Date, таймери, requestAnimationFrame), CSS-анімації й
 * переходи — Web Animations API (усі на паузі, `currentTime` ставимо самі). Тому кадр N завжди однаковий, а
 * анімації не «пропускаються», хоч скриншот і триває довше за 1/30 с.
 * Результат: public/captures/<сцена>/f0000.jpg … + manifest.json (fps, розмір, кадри, тапи) для Remotion.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { FAKE_CONTACT, fakeRides } from './fixtures/rides.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = path.join(HERE, '..');
const FRONTEND = path.join(VIDEO, '..', 'frontend');
const SITE = 'http://localhost:4188';
const API_ORIGIN = 'http://localhost:4189';
const FPS = 30;
const VIEWPORT = { width: 390, height: 844 };
const DPR = 3;

const args = process.argv.slice(2);
const sceneName = args.find((a) => !a.startsWith('--'));
const limitArg = args.indexOf('--frames');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : null;
if (!sceneName) {
  console.error('Usage: npm run capture -- <scene> [--frames N]');
  process.exit(1);
}
const scene = (await import(pathToFileURL(path.join(HERE, 'scenes', `${sceneName}.mjs`)).href)).default;

/* ---------- фікстури API ---------- */
const dataset = JSON.parse(await readFile(path.join(HERE, 'fixtures', 'transport-dataset.json'), 'utf8'));
async function poputky(url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const date = url.searchParams.get('date');
  let body;
  try {
    body = JSON.parse(await readFile(path.join(HERE, 'fixtures', 'poputky', `${from}-${to}-${date}.json`), 'utf8'));
  } catch {
    console.warn(`  ! немає фікстури poputky/${from}-${to}-${date}.json — порожній розклад`);
    body = { from: null, to: null, date, listings: [], schedules: [], availability: {} };
  }
  body.listings = fakeRides(date).filter((l) => l.route === `${from}-${to}`);
  return body;
}
const unknown = new Set();
async function api(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (p === '/transport/dataset') return json(200, dataset);
  if (p === '/poputky/search') return json(200, await poputky(url));
  if (p === '/dovede/access') return json(200, { open: true, allowed: true });
  // Claude у зйомці не кличемо: сторінка відповідає словником (як без ключа), відповідь детермінована
  if (p === '/dovede/understand') return json(503, { fallback: 'local', reason: 'no_key' });
  if (/^\/viber-listings\/\d+\/contact$/.test(p)) return json(200, { contact: FAKE_CONTACT });
  if (!unknown.has(`${req.method()} ${p}`)) {
    unknown.add(`${req.method()} ${p}`);
    console.warn(`  ? немає фікстури: ${req.method()} ${p}${url.search}`);
  }
  return json(404, { error: 'no fixture' });
}

/* ---------- vite ---------- */
async function startVite() {
  const proc = spawn('npm', ['run', 'dev', '--', '--port', '4188', '--strictPort'], {
    cwd: FRONTEND,
    env: { ...process.env, VITE_API_URL: API_ORIGIN, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(SITE);
      if (r.ok) return proc;
    } catch {
      /* ще піднімається */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill();
  throw new Error('vite не відповів за 60 с');
}

/* ---------- синхронізація CSS-анімацій із віртуальним часом ---------- */
const syncAnimations = () => {
  window.__teaserStart = new WeakMap();
  window.__teaserFirst = true;
  window.__teaserSync = (vt) => {
    const first = window.__teaserFirst;
    window.__teaserFirst = false;
    for (const a of document.getAnimations()) {
      let start = window.__teaserStart.get(a);
      if (start === undefined) {
        // те, що грало ще до першого кадру, лишаємо на своєму місці; нове починається з нуля
        start = first ? vt - (Number(a.currentTime) || 0) : vt;
        window.__teaserStart.set(a, start);
        a.pause();
      }
      a.currentTime = (vt - start) * (a.playbackRate || 1);
    }
  };
};

/* ---------- кроки сцени ---------- */
function locate(page, t) {
  let loc;
  if (t.label) loc = page.getByLabel(t.label);
  else if (t.role) loc = page.getByRole(t.role, t.name ? { name: t.name } : {});
  else if (t.text) loc = page.getByText(t.text);
  else loc = page.locator(t.selector);
  return t.nth != null ? loc.nth(t.nth) : loc.first();
}

async function run() {
  const vite = await startVite();
  const browser = await chromium.launch();
  const out = path.join(VIDEO, 'public', 'captures', scene.name);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  try {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DPR,
      isMobile: true,
      hasTouch: true,
      locale: 'uk-UA',
      timezoneId: 'Europe/Kyiv',
    });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('malin_kiev_ua_cookie_notice_v1', '1');
      } catch {
        /* ignore */
      }
    });
    await ctx.addInitScript(syncAnimations);
    await ctx.route(`${API_ORIGIN}/**`, api);
    const page = await ctx.newPage();
    await page.clock.install({ time: new Date(scene.now) });
    await page.goto(`${SITE}${scene.url}`);
    await locate(page, scene.ready).waitFor({ timeout: 30000 });
    // правки вигляду лише для зйомки (напр. сховати тимчасову плашку) — сайт не змінюється
    if (scene.css) await page.addStyleTag({ content: scene.css });
    // дати сторінці «влягтися» (шрифти, датасет, перші анімації), далі годинник лише покроково
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(scene.settleMs ?? 1500);
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(new Date(now + 50));
    if (scene.prepare) await scene.prepare(page);

    const total = limit ?? scene.frames;
    const taps = [];
    const scroll = [];
    let vt = 0;
    let typing = null;
    let scrolling = null;
    for (let f = 0; f < total; f++) {
      for (const a of scene.actions.filter((x) => x.frame === f)) {
        if (a.type) {
          const field = locate(page, a.type);
          await field.focus();
          typing = { text: a.type.text, from: f, cps: a.type.cps ?? 20, done: 0 };
        }
        if (a.press) await page.keyboard.press(a.press);
        if (a.tap) {
          const box = await locate(page, a.tap).boundingBox();
          if (!box) throw new Error(`кадр ${f}: не бачу ${JSON.stringify(a.tap)}`);
          const x = box.x + box.width * (a.tap.atX ?? 0.5);
          const y = box.y + box.height * (a.tap.atY ?? 0.5);
          await page.mouse.click(x, y);
          taps.push({ frame: f, x: x / VIEWPORT.width, y: y / VIEWPORT.height });
        }
        if (a.scrollBy) await page.mouse.wheel(0, a.scrollBy);
        if (a.scrollTo) {
          // плавна прокрутка за `frames` кадрів: верх елемента стає на `align` висоти екрана
          const box = await locate(page, a.scrollTo).boundingBox();
          if (!box) throw new Error(`кадр ${f}: не бачу ${JSON.stringify(a.scrollTo)}`);
          const from = await page.evaluate(() => window.scrollY);
          const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
          const to = Math.max(0, Math.min(max, from + box.y - VIEWPORT.height * (a.scrollTo.align ?? 0.3)));
          scrolling = { from, to, start: f, frames: a.scrollTo.frames ?? 30 };
        }
        if (a.run) await a.run(page);
      }
      if (scrolling) {
        const k = Math.min(1, (f - scrolling.start + 1) / scrolling.frames);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        await page.evaluate((y) => window.scrollTo(0, y), scrolling.from + (scrolling.to - scrolling.from) * e);
        if (k >= 1) scrolling = null;
      }
      if (typing) {
        const want = Math.min(typing.text.length, Math.round(((f - typing.from + 1) / FPS) * typing.cps));
        if (want > typing.done) {
          await page.keyboard.type(typing.text.slice(typing.done, want));
          typing.done = want;
        }
        if (typing.done >= typing.text.length) typing = null;
      }
      const step = Math.round(((f + 1) * 1000) / FPS) - Math.round((f * 1000) / FPS);
      await page.clock.runFor(step);
      vt += step;
      await page.evaluate((t) => window.__teaserSync(t), vt);
      await page.screenshot({ path: path.join(out, `f${String(f).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92, caret: 'hide', animations: 'allow' });
      scroll.push(await page.evaluate(() => window.scrollY));
      if (f % 30 === 0) console.log(`  кадр ${f}/${total}`);
    }
    // знімки всієї сторінки після останнього кадру (напр. для зум-ауту всієї історії)
    const stills = {};
    for (const s of scene.stills ?? []) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.screenshot({ path: path.join(out, `${s.name}.jpg`), type: 'jpeg', quality: 92, caret: 'hide', animations: 'allow', fullPage: true });
      stills[s.name] = { width: VIEWPORT.width * DPR, height: height * DPR, cssHeight: height };
    }
    const manifest = { scene: scene.name, fps: FPS, width: VIEWPORT.width * DPR, height: VIEWPORT.height * DPR, frames: total, taps, scroll, stills, now: scene.now, url: scene.url };
    await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`✓ ${scene.name}: ${total} кадрів → public/captures/${scene.name}/`);
  } finally {
    await browser.close();
    vite.kill();
  }
}

await run();
