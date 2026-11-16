/**
 * Поля навколо ролика продовжують його краї. Ролик 9:16 не збігається з екраном: на телефоні лишаються смуги зверху
 * й знизу, на компʼютері — з боків. Тло кадрів різне (білий пошук, сірий браузер, темна цитата, блакитне тло
 * телефона), тож білі смуги видавали б «вставлене відео». Щокадру крайній рядок (стовпчик) кадру розтягується на
 * свою смугу — це копіювання на відеокарті, без читання пікселів. Раз на чверть секунди середній колір верхнього
 * краю йде в `onTone` (theme-color: рядок браузера теж у колір кадру).
 */
/** Рядок від краю кадру: найкрайній після стиснення буває темнішим */
const EDGE = 2;
const TONE_MS = 250;

export function startEdgeFill(video: HTMLVideoElement, canvas: HTMLCanvasElement, onTone?: (rgb: string) => void): () => void {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return () => {};
  const draw2d = ctx;
  const probe = document.createElement('canvas');
  probe.width = 8;
  probe.height = 1;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  const v = video;
  // кадр за кадром, де є (Chrome, Safari 15.4+); інакше — кадр екрана
  const perFrame = typeof v.requestVideoFrameCallback === 'function';
  let stopped = false;
  let handle = 0;
  let lastTone = -Infinity;

  const draw = () => {
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh || v.readyState < 2) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    draw2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    // object-fit: contain — де стоїть кадр
    const scale = Math.min(w / vw, h / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;
    if (dy > 0.5) {
      draw2d.drawImage(v, 0, EDGE, vw, 1, dx, 0, dw, dy + 1);
      draw2d.drawImage(v, 0, vh - EDGE - 1, vw, 1, dx, dy + dh - 1, dw, h - dy - dh + 1);
    }
    if (dx > 0.5) {
      draw2d.drawImage(v, EDGE, 0, 1, vh, 0, dy, dx + 1, dh);
      draw2d.drawImage(v, vw - EDGE - 1, 0, 1, vh, dx + dw - 1, dy, w - dx - dw + 1, dh);
    }
    const now = performance.now();
    if (onTone && probeCtx && now - lastTone > TONE_MS) {
      lastTone = now;
      try {
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
    draw();
    schedule();
  };
  // на паузі нових кадрів немає — перемальовуємо на події
  const redraw = () => draw();
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
