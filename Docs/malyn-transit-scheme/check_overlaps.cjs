// Перевірка схеми на накладання: підписи й плашки номерів проти ліній, залізниці, річки, маркерів зупинок і одне одного.
// Запуск (Playwright з середовища): node Docs/malyn-transit-scheme/check_overlaps.cjs <svg зі сторінкою> [нижня межа карти, px]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [, , file, ymaxArg] = process.argv;
  const ymax = Number(ymaxArg || 1250);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 1600 } });
  await p.setContent(`<html><body style="margin:0">${fs.readFileSync(file, 'utf8').replace(/^<\?xml[^>]*>/, '')}</body></html>`);
  const res = await p.evaluate((ymax) => {
    const svg = document.querySelector('svg');
    const boxes = []; // {kind,name,x0,y0,x1,y1}
    const pad = 1.5;
    svg.querySelectorAll('text').forEach((t) => {
      if (t.closest('.lts-badge')) return;
      const bb = t.getBBox(); if (bb.y > ymax || bb.y < 150) return;
      boxes.push({ g: t.closest('.lts-stop'), kind: t.closest('.lts-water') ? 'water-label' : t.closest('.lts-rail') ? 'rail-label' : 'label', name: t.textContent, x0: bb.x - pad, y0: bb.y - pad, x1: bb.x + bb.width + pad, y1: bb.y + bb.height + pad });
    });
    svg.querySelectorAll('.lts-badge').forEach((g) => {
      if (g.closest('.lts-legend-row')) return;
      const bb = g.getBBox(); if (bb.y > ymax) return;
      boxes.push({ kind: 'badge', name: '[' + g.textContent + ']', x0: bb.x - pad, y0: bb.y - pad, x1: bb.x + bb.width + pad, y1: bb.y + bb.height + pad });
    });
    // лінії: семпли точок з шириною
    const strokes = [];
    const addPath = (el, kind, name) => {
      const w = parseFloat(el.getAttribute('stroke-width') || '2');
      const L = el.getTotalLength(); const pts = [];
      for (let s = 0; s <= L; s += 3) { const q = el.getPointAtLength(s); pts.push([q.x, q.y]); }
      strokes.push({ kind, name, w, pts });
    };
    svg.querySelectorAll('.lts-route').forEach((g) => { const ps = g.querySelectorAll('path'); addPath(ps[1], 'line', 'лінія ' + g.getAttribute('data-route')); for (let i = 2; i < ps.length; i++) if (ps[i].getAttribute('stroke-dasharray')) addPath(ps[i], 'dash', 'пунктир ' + g.getAttribute('data-route')); });
    svg.querySelectorAll('.lts-rail path').forEach((e, i) => { if (i % 2 === 0) addPath(e, 'rail', 'залізниця'); });
    svg.querySelectorAll('.lts-water path').forEach((e) => { if (e.getAttribute('fill') === 'none') addPath(e, 'river', 'річка'); });
    // маркери зупинок
    const marks = [];
    svg.querySelectorAll('.lts-stop').forEach((g) => {
      const m = g.querySelector(':scope > circle, :scope > line'); if (!m) return;
      const bb = m.getBBox(); marks.push({ name: g.getAttribute('data-stop'), label: (g.querySelector('text') || {}).textContent, x0: bb.x - 4, y0: bb.y - 4, x1: bb.x + bb.width + 4, y1: bb.y + bb.height + 4 });
    });
    const hits = [];
    const inter = (a, c) => a.x0 < c.x1 && a.x1 > c.x0 && a.y0 < c.y1 && a.y1 > c.y0;
    for (const bx of boxes) {
      for (const s of strokes) {
        const r = s.w / 2;
        if (s.pts.some(([x, y]) => x + r > bx.x0 && x - r < bx.x1 && y + r > bx.y0 && y - r < bx.y1)) hits.push(`${bx.kind} «${bx.name}» × ${s.name}`);
      }
      for (const m of marks) if (inter(bx, m) && m.label !== bx.name) hits.push(`${bx.kind} «${bx.name}» × маркер «${m.label}»`);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (inter(boxes[i], boxes[j]) && !(boxes[i].g && boxes[i].g === boxes[j].g && boxes[i].kind === 'label' && boxes[j].kind === 'label')) hits.push(`${boxes[i].kind} «${boxes[i].name}» × ${boxes[j].kind} «${boxes[j].name}»`);
    return [...new Set(hits)];
  }, ymax);
  console.log(res.length + ' перетинів'); res.forEach((h) => console.log(' - ' + h));
  await b.close();
})();
