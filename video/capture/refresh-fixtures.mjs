/**
 * Знімок даних для зйомки: публічні GET з проду → capture/fixtures/. Перезйомка з тих самих фікстур дає ті самі
 * числа в кадрі. Запускати лише свідомо (числа в сценарії звірені з цим знімком): `npm run fixtures`.
 * Оголошення попуток із проду не зберігаємо — їх підміняє fixtures/rides.mjs.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://kyiv-malyn-booking-production.up.railway.app';
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
// дні, на які дивляться сцени: понеділок 16.11.2026 («сьогодні» в ролику) і вівторок 17.11 («завтра»)
const DATES = ['2026-11-16', '2026-11-17'];
const PAIRS = [['Kyiv', 'Malyn'], ['Malyn', 'Kyiv']];

async function get(url) {
  const res = await fetch(`${API}${url}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

await mkdir(path.join(DIR, 'poputky'), { recursive: true });
const dataset = await get('/transport/dataset');
await writeFile(path.join(DIR, 'transport-dataset.json'), JSON.stringify(dataset));
console.log(`transport-dataset.json · revision ${dataset.revision}`);
for (const date of DATES) {
  for (const [from, to] of PAIRS) {
    const body = await get(`/poputky/search?${new URLSearchParams({ from, to, date })}`);
    body.listings = [];
    const file = `${from}-${to}-${date}.json`;
    await writeFile(path.join(DIR, 'poputky', file), JSON.stringify(body, null, 1));
    console.log(`poputky/${file} · ${body.schedules?.length ?? 0} рейсів`);
  }
}
