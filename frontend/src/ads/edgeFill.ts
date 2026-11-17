/**
 * Поля навколо ролика продовжують його краї. Ролик 9:16 не збігається з екраном: на телефоні лишаються смуги зверху
 * й знизу, на компʼютері — з боків. Тло кадрів різне (білий пошук, сірий браузер, темна цитата, блакитне тло
 * телефона), тож білі смуги видавали б «вставлене відео».
 *
 * Колір поля — колір ТЛА біля краю кадру, а не його вмісту. Раз на SAMPLE_MS край кадру (зовнішні 3 %) береться
 * маленьким (4 × 48) і для кожної з CELLS ділянок уздовж краю обирається медіанний за яскравістю піксель: лінія схеми,
 * текст чи картка, що торкаються краю, — меншість пікселів ділянки, тож не тягнуться смугами чи плямами (так було з
 * розтягнутим крайнім стовпчиком і з середнім кольором). Медіана всього краю — колір поля далі від кадру; строката
 * ділянка (лінії схеми, фото — менше UNIFORM пікселів близькі до її медіани) теж бере цей колір, а не свій.
 *
 * Малюється щокадру лише градієнт (без відео): біля кадру — кольори ділянок, за FADE_PX — один колір, кольори плавно
 * перетікають до нових замірів (BLEND за кадр), тож поле не мерехтить. Полотно маленьке (1/6 екрана) й
 * розтягується браузером. Раз на чверть секунди середній колір верхнього краю йде в `onTone` (theme-color і фон).
 */
/** Рядок від краю кадру для кольору рядка браузера: найкрайній після стиснення буває темнішим */
const EDGE = 2;
const TONE_MS = 250;
/** Як часто брати колір країв кадру */
const SAMPLE_MS = 66;
/** Роздільність поля відносно CSS-пікселів екрана */
const SCALE = 1 / 6;
/** Частка кадру біля краю, з якої береться колір поля */
const STRIP = 0.03;
/** Ділянок уздовж краю */
const CELLS = 8;
/** Пікселів заміру на ділянку вздовж краю й поперек нього */
const ALONG = 6;
const ACROSS = 4;
/** Відстань від кадру (CSS px), за якою поле — один колір */
const FADE_PX = 140;
/** Частка шляху до нового кольору за кадр */
const BLEND = 0.35;
/** Ділянка однорідна, якщо стільки її пікселів близькі до медіани (тло); інакше вона бере колір усього краю */
const UNIFORM = 0.7;
/** «Близькі»: різниця кожного каналу не більша */
const NEAR = 18;

type Ctx = CanvasRenderingContext2D;
export type Rgb = [number, number, number];
/** Колір смуги: ділянки вздовж краю й тло далі від кадру */
export type Profile = { cells: Rgb[]; base: Rgb };

const WHITE: Rgb = [255, 255, 255];
const css = (c: Rgb) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
const luma = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Піксель із медіанною яскравістю — колір тла, навіть коли край перетинають лінії чи текст */
export function medianColor(pixels: Rgb[]): Rgb {
  if (!pixels.length) return WHITE;
  const sorted = [...pixels].sort((a, b) => luma(a) - luma(b));
  return sorted[Math.floor(sorted.length / 2)];
}

/** Частка пікселів, близьких до кольору `c` */
export function shareNear(pixels: Rgb[], c: Rgb): number {
  if (!pixels.length) return 0;
  let n = 0;
  for (const p of pixels) if (Math.abs(p[0] - c[0]) <= NEAR && Math.abs(p[1] - c[1]) <= NEAR && Math.abs(p[2] - c[2]) <= NEAR) n++;
  return n / pixels.length;
}

/** Колір ділянок уздовж краю й тла: строката ділянка бере колір тла всього краю */
export function edgeProfile(cells: Rgb[][]): Profile {
  const base = medianColor(cells.flat());
  return {
    base,
    cells: cells.map((cell) => {
      const m = medianColor(cell);
      return shareNear(cell, m) >= UNIFORM ? m : base;
    }),
  };
}

function canvas2d(w: number, h: number, readBack = false): [HTMLCanvasElement, Ctx] | null {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', readBack ? { willReadFrequently: true } : undefined);
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

type Side = 'left' | 'right' | 'top' | 'bottom';

export function startEdgeFill(video: HTMLVideoElement, canvas: HTMLCanvasElement, onTone?: (rgb: string) => void): () => void {
  let ctx: Ctx | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return () => {};
  const main = ctx;
  // край зменшується на відеокарті, читається вже маленьким
  const shrinkV = canvas2d(ACROSS, CELLS * ALONG);
  const shrinkH = canvas2d(CELLS * ALONG, ACROSS);
  const readV = canvas2d(ACROSS, CELLS * ALONG, true);
  const readH = canvas2d(CELLS * ALONG, ACROSS, true);
  const layer = canvas2d(1, 1);
  const probe = canvas2d(8, 1, true);
  if (!shrinkV || !shrinkH || !readV || !readH || !layer) return () => {};
  const v = video;
  // кадр за кадром, де є (Chrome, Safari 15.4+); інакше — кадр екрана
  const perFrame = typeof v.requestVideoFrameCallback === 'function';
  let stopped = false;
  let handle = 0;
  let lastSample = -Infinity;
  let lastTone = -Infinity;
  const target = new Map<Side, Profile>();
  const shown = new Map<Side, Profile>();

  /** Заміряти край кадру: `src` — прямокутник краю в кадрі; vertical — бічний край (ділянки згори вниз) */
  const sample = (src: [number, number, number, number], vertical: boolean): Profile | null => {
    const [shrink, shrinkCtx] = vertical ? shrinkV : shrinkH;
    const [read, readCtx] = vertical ? readV : readH;
    try {
      shrinkCtx.clearRect(0, 0, shrink.width, shrink.height);
      shrinkCtx.drawImage(v, src[0], src[1], src[2], src[3], 0, 0, shrink.width, shrink.height);
      readCtx.clearRect(0, 0, read.width, read.height);
      readCtx.drawImage(shrink, 0, 0);
      const data = readCtx.getImageData(0, 0, read.width, read.height).data;
      const px = (x: number, y: number): Rgb => {
        const i = (y * read.width + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      };
      const cells: Rgb[][] = [];
      for (let c = 0; c < CELLS; c++) {
        const cell: Rgb[] = [];
        for (let a = c * ALONG; a < (c + 1) * ALONG; a++) {
          for (let b = 0; b < ACROSS; b++) cell.push(vertical ? px(b, a) : px(a, b));
        }
        cells.push(cell);
      }
      return edgeProfile(cells);
    } catch {
      return null; // кадр чужого походження — поле лишається як є
    }
  };

  const mix = (from: Rgb, to: Rgb, t: number): Rgb => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];

  /** Намалювати смугу: [x, y, w, h] у пікселях полотна; frameAt — з якого боку смуги кадр */
  const paint = (rect: [number, number, number, number], vertical: boolean, frameAt: 'start' | 'end', p: Profile, fadePx: number) => {
    const [x, y, w, h] = rect;
    if (w < 0.5 || h < 0.5) return;
    main.fillStyle = css(p.base);
    main.fillRect(x, y, w, h);
    // ділянки вздовж краю → градієнт; згасає від кадру назовні
    const [layerCanvas, layerCtx] = layer;
    layerCtx.globalCompositeOperation = 'source-over';
    layerCtx.clearRect(x, y, w, h);
    const along = vertical ? layerCtx.createLinearGradient(0, y, 0, y + h) : layerCtx.createLinearGradient(x, 0, x + w, 0);
    p.cells.forEach((c, i) => along.addColorStop((i + 0.5) / CELLS, css(c)));
    layerCtx.fillStyle = along;
    layerCtx.fillRect(x, y, w, h);
    const fade = Math.min(vertical ? w : h, fadePx);
    let across: CanvasGradient;
    if (vertical) across = frameAt === 'end' ? layerCtx.createLinearGradient(x + w, 0, x + w - fade, 0) : layerCtx.createLinearGradient(x, 0, x + fade, 0);
    else across = frameAt === 'end' ? layerCtx.createLinearGradient(0, y + h, 0, y + h - fade) : layerCtx.createLinearGradient(0, y, 0, y + fade);
    across.addColorStop(0, 'rgba(0,0,0,1)');
    across.addColorStop(1, 'rgba(0,0,0,0)');
    layerCtx.globalCompositeOperation = 'destination-in';
    layerCtx.fillStyle = across;
    layerCtx.fillRect(x, y, w, h);
    layerCtx.globalCompositeOperation = 'source-over';
    main.drawImage(layerCanvas, x, y, w, h, x, y, w, h);
  };

  const draw = (full: boolean) => {
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh || v.readyState < 2) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const cw = Math.max(1, Math.round(w * SCALE));
    const ch = Math.max(1, Math.round(h * SCALE));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      layer[0].width = cw;
      layer[0].height = ch;
      full = true;
    }
    const k = cw / w;
    // object-fit: contain — де стоїть кадр (у пікселях полотна)
    const scale = Math.min(w / vw, h / vh);
    const dw = vw * scale * k;
    const dh = vh * scale * k;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    const sides: { side: Side; rect: [number, number, number, number]; vertical: boolean; frameAt: 'start' | 'end'; src: [number, number, number, number] }[] = [];
    // смуга заходить на пів пікселя під кадр — без щілини на межі
    if (dx > 0.25) {
      const sw = Math.max(1, Math.round(vw * STRIP));
      sides.push({ side: 'left', rect: [0, dy, dx + 0.5, dh], vertical: true, frameAt: 'end', src: [0, 0, sw, vh] });
      sides.push({ side: 'right', rect: [dx + dw - 0.5, dy, cw - dx - dw + 0.5, dh], vertical: true, frameAt: 'start', src: [vw - sw, 0, sw, vh] });
    }
    if (dy > 0.25) {
      const sh = Math.max(1, Math.round(vh * STRIP));
      sides.push({ side: 'top', rect: [dx, 0, dw, dy + 0.5], vertical: false, frameAt: 'end', src: [0, 0, vw, sh] });
      sides.push({ side: 'bottom', rect: [dx, dy + dh - 0.5, dw, ch - dy - dh + 0.5], vertical: false, frameAt: 'start', src: [0, vh - sh, vw, sh] });
    }

    const now = performance.now();
    if (full || now - lastSample >= SAMPLE_MS) {
      lastSample = now;
      for (const s of sides) {
        const p = sample(s.src, s.vertical);
        if (p) target.set(s.side, p);
      }
    }
    for (const s of sides) {
      const want = target.get(s.side);
      if (!want) continue;
      const was = shown.get(s.side);
      const t = full || !was ? 1 : BLEND;
      const now2: Profile = was ? { cells: want.cells.map((c, i) => mix(was.cells[i], c, t)), base: mix(was.base, want.base, t) } : want;
      shown.set(s.side, now2);
      paint(s.rect, s.vertical, s.frameAt, now2, FADE_PX * k);
    }

    if (onTone && probe && now - lastTone > TONE_MS) {
      lastTone = now;
      try {
        const [, probeCtx] = probe;
        probeCtx.drawImage(v, 0, EDGE, vw, 1, 0, 0, 8, 1);
        const px = probeCtx.getImageData(0, 0, 8, 1).data;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < px.length; i += 4) {
          r += px[i];
          g += px[i + 1];
          b += px[i + 2];
        }
        const n = px.length / 4;
        onTone(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
      } catch {
        /* кадр чужого походження — колір рядка браузера лишається білим */
      }
    }
  };

  const schedule = () => {
    if (stopped) return;
    handle = perFrame ? v.requestVideoFrameCallback(tick) : window.requestAnimationFrame(tick);
  };
  const tick = () => {
    draw(false);
    schedule();
  };
  // на паузі нових кадрів немає — перемальовуємо на події, одразу повністю
  const redraw = () => draw(true);
  const events = ['loadeddata', 'seeked', 'pause', 'ended'] as const;
  for (const e of events) v.addEventListener(e, redraw);
  window.addEventListener('resize', redraw);
  schedule();

  return () => {
    stopped = true;
    if (perFrame) v.cancelVideoFrameCallback(handle);
    else window.cancelAnimationFrame(handle);
    for (const e of events) v.removeEventListener(e, redraw);
    window.removeEventListener('resize', redraw);
  };
}
