/**
 * «Доведе» · самонавчання без ШІ: обхід у ширину, що наповнює базу доріг містом (Київ, Житомир).
 * `npm run dovede:crawl -- "з Малина до Києва на вулицю Ентузіастів 7" --from святошин` (у `frontend/`).
 *
 * Робить те саме, що сторінка /dovede після розбору фрази: `GET /dovede/city-route` від точки висадки до «місця
 * словами». Сервер відповідає з бази або питає Google і зберігає відповідь (маршрут, лінії, зупинки) — наступна
 * людина з тим самим місцем отримає її вже з бази. З кожної відповіді беремо нові місця (зупинки пересадок і
 * висадки, кінцеві ліній) і питаємо їх від тієї самої точки. Фразу розбирає справжній словник сторінки
 * (`nlu/parseLocal`, зібраний esbuild-ом); ШІ (`/dovede/understand`) не викликається.
 *
 * Журнал `data/dovede-crawl/journal-<сервер>.jsonl` (поза git): що вже питали — вдруге сервер тим самим не
 * ганяємо, а запуск без фрази продовжує обхід із того місця, де він зупинився. Ctrl+C — зупинка після поточного
 * запиту. Локальний скрипт, не для CI. Чиста логіка — спільна з сервером `backend/src/dovede/crawl-core.ts` (тест
 * `crawl-core.test.ts`, мережі не торкається), стартові списки місць — `backend/src/dovede/learn-places.ts`; обидва
 * esbuild збирає в `node_modules/.cache/dovede-crawl/` перед запуском.
 *
 * Денний ліміт Google на сервері спільний із людьми (`DOVEDE_CITY_DAILY_CAP`), тому є `--budget` (нових відповідей
 * Google за запуск) і, з токеном адміна, `--reserve` (скільки ліміту лишити людям).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { API_BASE } from './api-base.mjs';

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(frontendDir, '..');
const cacheDir = path.join(frontendDir, 'node_modules/.cache/dovede-crawl');

/** Ядро обходу й списки місць живуть на сервері (TypeScript): збираємо їх esbuild-ом в один модуль */
async function loadCore() {
  const { build } = await import('esbuild');
  const outfile = path.join(cacheDir, 'crawl-core.mjs');
  await build({
    stdin: {
      contents: "export * from './backend/src/dovede/crawl-core.ts';\nexport * from './backend/src/dovede/learn-places.ts';\n",
      resolveDir: repoRoot,
      sourcefile: 'dovede-crawl-core-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

const {
  POINT_LABEL,
  DEFAULT_FRESH_DAYS,
  LEARN_PLACES,
  createCrawl,
  describeSteps,
  compactSteps,
  kyivToday,
  parseSlots,
  resolveOrigins,
  rootsFromRecords,
  seedFromIntent,
  seedsFromUnanswered,
  siteForm,
  summarizeRecords,
} = await loadCore();

/** `--places kyiv | zhytomyr` — готовий список із `learn-places.ts` і його місто */
const READY_LIST_CITY = { kyiv: 'Kyiv', zhytomyr: 'Zhytomyr' };

const HELP = `«Доведе» · обхід у ширину для наповнення бази доріг містом

  npm run dovede:crawl -- "з Малина до Києва на вулицю Ентузіастів 7" --from святошин
  npm run dovede:crawl                      продовжити обхід із журналу
  npm run dovede:crawl -- --status          що вже зібрано

  --from <точки>    звідки рахувати дорогу: академ | святошин | житомирська | вокзал | борщагівка | all
                    (типово академ; для Житомира завжди автовокзал)
  --both            ще й зворотний напрям: від місця до точки посадки
  --reverse         лише зворотний напрям (для поїздок із міста — зручно разом із вечірнім часом у --when)
  --city <місто>    Kyiv | Zhytomyr — для --place і --places (типово Kyiv; з --places zhytomyr — Zhytomyr)
  --place "<слова>" місце без фрази; можна кілька разів
  --places <список> готовий список kyiv | zhytomyr (backend/src/dovede/learn-places.ts) або файл:
                    по одному місцю в рядку, # — коментар
  --unanswered      питання людей, на які сервер не знайшов відповіді (потрібен токен адміна)
  --when <часи>     weekday@09:00 (типово) | day | full | weekday@08,saturday@10
                    сервер віддає з бази відповідь того самого типу дня й години ± 1
  --depth N         глибина обходу від першого місця (типово 3)
  --budget N        нових відповідей від Google за запуск (типово 40)
  --reserve N       скільки денного ліміту Google лишити людям (типово 50; діє з токеном адміна)
  --max N           найбільше запитів до сервера за запуск
  --pause мс        пауза між запитами (типово 1500)
  --no-headsigns    не брати в обхід кінцеві ліній
  --fresh-days N    скільки днів відповідь свіжа (типово — як в адмінці, інакше 30)
  --as-person       рахувати питання в попит людей навіть із токеном адміна
  --api <адреса>    інший сервер (типово бойовий)
  --dry             нічого не питати: показати розбір і перші питання

Доступ: DOVEDE_PASSWORD або DOVEDE_TOKEN у середовищі. Токен адміна (DOVEDE_ADMIN_TOKEN, ADMIN_TOKEN або
VIBER_ADMIN_TOKEN) теж відкриває, показує денний ліміт Google і вмикає режим навчання: питання обходу не
потрапляють у лічильник попиту людей.`;

function parseArgs(argv) {
  const o = { phrases: [], places: [], from: '', both: false, city: 'Kyiv', cityGiven: false, placesFile: '', when: '', depth: 3, budget: 40, reserve: 50, max: Infinity, pause: 1500, headsigns: true, api: API_BASE, dry: false, status: false, help: false, unanswered: false, asPerson: false, freshDays: null, reverse: false };
  const num = (name, v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name}: потрібне число, а не «${v}»`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a}: бракує значення`);
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--from') o.from = val();
    else if (a === '--both') o.both = true;
    else if (a === '--reverse') o.reverse = true;
    else if (a === '--city') {
      o.city = val();
      o.cityGiven = true;
    }
    else if (a === '--place') o.places.push(val());
    else if (a === '--places') o.placesFile = val();
    else if (a === '--when') o.when = val();
    else if (a === '--depth') o.depth = num(a, val());
    else if (a === '--budget') o.budget = num(a, val());
    else if (a === '--reserve') o.reserve = num(a, val());
    else if (a === '--max') o.max = num(a, val());
    else if (a === '--pause') o.pause = num(a, val());
    else if (a === '--no-headsigns') o.headsigns = false;
    else if (a === '--unanswered') o.unanswered = true;
    else if (a === '--as-person') o.asPerson = true;
    else if (a === '--fresh-days') o.freshDays = num(a, val());
    else if (a === '--api') o.api = val().replace(/\/$/, '');
    else if (a === '--dry') o.dry = true;
    else if (a === '--status') o.status = true;
    else if (a.startsWith('--')) throw new Error(`Невідомий прапорець ${a} (див. --help)`);
    else o.phrases.push(a);
  }
  // готовий список задає й місто, якщо його не названо окремо
  const listCity = READY_LIST_CITY[o.placesFile.toLowerCase()];
  if (listCity && !o.cityGiven) o.city = listCity;
  if (o.city !== 'Kyiv' && o.city !== 'Zhytomyr') throw new Error('--city: Kyiv або Zhytomyr');
  return o;
}

/** Словник сторінки, зібраний в один файл: той самий розбір, що в полі «Доведе». null — зібрати не вдалося */
async function loadSiteParser() {
  try {
    const { build } = await import('esbuild');
    const outfile = path.join(cacheDir, 'parse-local.mjs');
    await build({ entryPoints: [path.join(frontendDir, 'src/pages/DovedePage/nlu/parseLocal.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
    const mod = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
    return typeof mod.parseLocal === 'function' ? mod.parseLocal : null;
  } catch (e) {
    console.warn(`⚠️  Словник сторінки не зібрався (${e?.message ?? e}). Фрази не розберу — задайте місце через --place.`);
    return null;
  }
}

function journalFile(api) {
  const host = new URL(api).host.replace(/[^a-z0-9.-]/gi, '_');
  return path.join(repoRoot, 'data/dovede-crawl', `journal-${host}.jsonl`);
}

function readJournal(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // обірваний останній рядок після аварійної зупинки — пропускаємо
    }
  }
  return out;
}

function appendJournal(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

const adminToken = () => (process.env.DOVEDE_ADMIN_TOKEN || process.env.ADMIN_TOKEN || process.env.VIBER_ADMIN_TOKEN || '').trim();

async function getJson(url, headers, timeoutMs = 15000) {
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** Заголовки доступу: токен адміна, готовий токен запрошених або пароль → токен. Значень не друкуємо */
async function accessHeaders(api) {
  const headers = {};
  if (adminToken()) headers.Authorization = adminToken();
  const token = (process.env.DOVEDE_TOKEN || '').trim();
  if (token) headers['X-Dovede-Token'] = token;
  else if (process.env.DOVEDE_PASSWORD) {
    const res = await fetch(`${api}/dovede/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: process.env.DOVEDE_PASSWORD }), signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.token) throw new Error(`Вхід за паролем не вдався (HTTP ${res.status}). Перевірте DOVEDE_PASSWORD.`);
    headers['X-Dovede-Token'] = body.token;
  }
  const { status, body } = await getJson(`${api}/dovede/access`, headers);
  if (status !== 200 || !body) throw new Error(`${api}/dovede/access → HTTP ${status}. Сервер не відповідає як слід.`);
  if (!body.open && !body.allowed) throw new Error('Сервер не пускає: задайте DOVEDE_PASSWORD (пароль запрошених) або токен адміна в ADMIN_TOKEN.');
  return headers;
}

/** Стан ліміту Google з адмінки; null — токена адміна немає або відповідь не прочиталась */
async function cityStats(api, headers) {
  if (!headers.Authorization) return null;
  try {
    const { status, body } = await getJson(`${api}/admin/dovede/city`, headers);
    return status === 200 && body && typeof body.callsToday === 'number' ? body : null;
  } catch {
    return null;
  }
}

const pointLabel = (id) => POINT_LABEL[id] ?? id;
const askText = (ask) => `${POINT_LABEL[ask.from] ?? `«${ask.from}»`} → ${POINT_LABEL[ask.to] ?? `«${ask.to}»`}`;
const DAY_UK = { weekday: 'будні', saturday: 'субота', sunday: 'неділя' };

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log(HELP);
    return;
  }
  const file = journalFile(o.api);
  const records = readJournal(file);

  if (o.status) {
    const days = o.freshDays ?? DEFAULT_FRESH_DAYS;
    const s = summarizeRecords(records, { freshDays: days });
    console.log(`Журнал: ${path.relative(process.cwd(), file)}`);
    console.log(`Записів ${s.total} · місць із відповіддю ${s.pairs} · ліній ${s.lines} · зупинок ${s.stops}`);
    console.log(`Нових від Google ${s.by.google} · уже було в базі ${s.by.stored} · власні дані ${s.by.own} · без маршруту ${s.by.no_route} · збоїв ${s.by.error}`);
    console.log(`Строк свіжості ${days} днів (на сервері може бути інший — див. адмінку): уже застаріло ${s.stale}, застаріє за тиждень ${s.expiring}.`);
    if (s.stale) console.log('Освіжити: npm run dovede:crawl (без фрази) — застарілі питання підуть до сервера знову.');
    return;
  }

  const slots = parseSlots(o.when);
  const parseLocal = await loadSiteParser();
  const nowK = { date: kyivToday(), mins: 600 };

  // Сервер потрібен і для сухого прогону з --unanswered: список питань людей лежить у нього
  const online = !o.dry || o.unanswered;
  const headers = online ? await accessHeaders(o.api) : {};
  const stats = online ? await cityStats(o.api, headers) : null;
  const learn = Boolean(headers.Authorization) && !o.asPerson;

  // --- з чого починаємо ---
  const seeds = [];
  const addSeed = (city, place, dir, via) => {
    const dirs = o.reverse ? ['from'] : o.both ? ['to', 'from'] : [dir];
    for (const origin of resolveOrigins(city, o.from)) for (const d of dirs) seeds.push({ city, origin, dir: d, place, via });
  };
  for (const phrase of o.phrases) {
    if (!parseLocal) throw new Error('Без словника сторінки фразу не розібрати — задайте місце через --place.');
    const seed = seedFromIntent(parseLocal(phrase, nowK).intent);
    if (!seed) {
      throw new Error(
        `У фразі «${phrase}» сторінка не бачить «місця словами» в Києві чи Житомирі.\n` +
          '   Після назви міста має стояти прийменник або слово «вулиця»: «з Малина до Києва на вулицю Ентузіастів 7».\n' +
          '   Станції метро, вокзал і міську електричку «Доведе» знає сам — сервер про них не питають.',
      );
    }
    console.log(`Фраза: «${phrase}» → ${seed.city === 'Kyiv' ? 'Київ' : 'Житомир'}, місце «${seed.place}»${seed.dir === 'from' ? ' (звідти до точки посадки)' : ''}`);
    addSeed(seed.city, seed.place, seed.dir, 'seed');
  }
  const listed = [...o.places];
  const ready = LEARN_PLACES[READY_LIST_CITY[o.placesFile.toLowerCase()]];
  if (ready) listed.push(...ready);
  else if (o.placesFile) {
    for (const line of fs.readFileSync(path.resolve(process.cwd(), o.placesFile), 'utf8').split('\n')) {
      const t = line.replace(/#.*$/, '').trim();
      if (t) listed.push(t);
    }
  }
  let ownPlaces = 0;
  for (const place of listed) {
    // місце шлемо так, як його надіслала б сторінка (до пʼяти слів, `detailForm`); відоме їй — не шлемо зовсім
    const form = siteForm(o.city, place);
    if (form === null) {
      ownPlaces++;
      console.log(`· «${place}» пропускаю: це місце «Доведе» знає сам (метро, вокзал, електричка), сервер про нього не питають`);
      continue;
    }
    addSeed(o.city, form, 'to', 'file');
  }
  if (listed.length) console.log(`Місць зі списку: ${listed.length - ownPlaces}${ownPlaces ? ` (ще ${ownPlaces} «Доведе» знає сам)` : ''}.`);
  if (o.unanswered) {
    if (!stats) throw new Error('--unanswered: потрібен токен адміна (ADMIN_TOKEN) — список питань людей бачить лише адмінка.');
    if (!Array.isArray(stats.unanswered)) throw new Error('--unanswered: сервер ще не віддає цього списку — задеплойте бекенд із цією зміною.');
    const people = seedsFromUnanswered(stats.unanswered);
    console.log(`Питань людей без відповіді: ${people.length}.`);
    seeds.push(...people);
  }
  const explicit = o.phrases.length || listed.length || o.unanswered;
  if (!explicit) {
    seeds.push(...rootsFromRecords(records));
    if (!seeds.length) {
      console.log(HELP);
      console.log('\nЖурнал порожній — почніть із фрази.');
      return;
    }
    console.log(`Продовжую обхід із журналу: ${seeds.length} початкових місць.`);
  }
  if (!seeds.length) {
    console.log('Питати нічого.');
    return;
  }

  const freshDays = o.freshDays ?? stats?.freshDays ?? DEFAULT_FRESH_DAYS;
  const crawl = createCrawl({
    records,
    seeds,
    slots,
    maxDepth: o.depth,
    freshDays,
    headsigns: o.headsigns,
    // у обхід беремо назву так, як її надіслала б сторінка (`detailForm`); відоме їй місце — не беремо зовсім
    siteForm,
  });

  console.log(`Сервер: ${o.api}`);
  console.log(`Точки: ${[...new Set(seeds.map((s) => pointLabel(s.origin)))].join(', ')} · час: ${slots.map((s) => `${DAY_UK[s.dayType]} ${s.time}`).join(', ')} · глибина ${o.depth}`);
  console.log(`Журнал: ${path.relative(process.cwd(), file)} (${records.length} записів) · відповідь свіжа ${freshDays} днів${o.freshDays == null && stats?.freshDays ? ' (з адмінки)' : ''}`);

  if (o.dry) {
    console.log('\n--dry: дороги не питаю. Перші питання:');
    let shown = 0;
    for (let t = crawl.next(); t && shown < 20; t = crawl.next(), shown++) console.log(`  ${askText(t.ask)}   ${DAY_UK[t.slot.dayType]} ${t.ask.time} (${t.ask.date})`);
    if (!shown) console.log('  нічого нового: усе з цього списку вже питали (журнал). Нові місця зʼявляться з відповідей сервера.');
    console.log(`З журналу пропущено ${crawl.stats.skipped}, у черзі ще ${crawl.pending()}.`);
    return;
  }

  console.log(
    learn
      ? 'Режим навчання (токен адміна): лічильник попиту людей не росте.'
      : 'Питаю як людина: кожне питання потрапить у лічильник попиту (в адмінці є «Скинути лічильник попиту»). З токеном адміна його б не зачепило.',
  );
  let budget = o.budget;
  const count = { asked: 0, google: 0, stored: 0, own: 0, noRoute: 0, failed: 0 };
  const checkCap = async (first) => {
    const st = first ? stats : await cityStats(o.api, headers);
    if (!st) {
      if (first) console.log(`Ліміт Google: стану не бачу (потрібен токен адміна) — зупинюсь після ${budget} нових відповідей або коли сервер скаже «ліміт».`);
      return true;
    }
    if (first) {
      if (!st.enabled || !st.hasKey) throw new Error('На сервері дорогу містом вимкнено або немає ключа Google — навчати нічим.');
      if (!st.store) throw new Error('На сервері вимкнено запис у базу (DOVEDE_CITY_STORE=0) — відповіді не збережуться.');
    }
    const left = st.dailyCap - o.reserve - st.callsToday;
    // ліміт спільний: поки ми працюємо, його витрачають і люди, і фонове навчання сервера
    budget = Math.min(budget, count.google + Math.max(0, left));
    if (first) console.log(`Google сьогодні: ${st.callsToday} з ${st.dailyCap}; людям лишаю ${o.reserve} → цьому запуску до ${budget} нових відповідей.`);
    return left > 0;
  };
  if (!(await checkCap(true))) {
    console.log('Денний ліміт (без резерву для людей) уже вичерпано — спробуйте завтра або зменшіть --reserve.');
    return;
  }

  // --- обхід ---
  let stopping = false;
  let wake = null;
  process.on('SIGINT', () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log('\n⏹  Зупиняюсь після поточного запиту (ще раз Ctrl+C — негайно)…');
    wake?.();
  });
  const sleep = (ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  let failStreak = 0;
  // Google відмовляв чи не відповідав: наприкінці спитаємо в сервера, що саме він сказав
  let googleTrouble = false;
  let why = 'обхід закінчено: нових місць немає';
  const startedAt = Date.now();

  for (;;) {
    if (stopping) {
      why = 'зупинено (Ctrl+C)';
      break;
    }
    if (count.google >= budget) {
      why = budget < o.budget ? `денний ліміт Google: людям лишено ${o.reserve}` : `вичерпано --budget ${budget} (нових відповідей від Google за запуск)`;
      break;
    }
    if (count.asked >= o.max) {
      why = `вичерпано --max ${o.max}`;
      break;
    }
    const task = crawl.next();
    if (!task) break;
    const q = new URLSearchParams(task.ask);
    if (learn) q.set('learn', '1');
    let res;
    try {
      res = await getJson(`${o.api}/dovede/city-route?${q.toString()}`, headers);
    } catch (e) {
      res = { status: 0, body: null, error: e?.message ?? String(e) };
    }
    count.asked++;
    const n = String(count.asked).padStart(4);
    const label = `${askText(task.ask)}  [${DAY_UK[task.slot.dayType]} ${task.ask.time}]`;
    const body = res.body;

    if (res.status === 401) {
      why = 'сервер відмовив у доступі (401)';
      break;
    }
    if (res.status === 200 && body?.ok && Array.isArray(body.steps)) {
      failStreak = 0;
      const { record, added } = crawl.done(task, { ok: true, source: body.source, minutes: body.minutes, steps: body.steps });
      appendJournal(file, record);
      if (body.source === 'google') count.google++;
      else if (body.source === 'own') count.own++;
      else count.stored++;
      const tag = body.source === 'google' ? '🆕 Google ' : body.source === 'own' ? '📒 власні ' : '💾 з бази ';
      console.log(`${n} ${tag} ${String(body.minutes).padStart(3)} хв  ${label}`);
      console.log(`       ${describeSteps(compactSteps(body.steps))}${added ? `   +${added} нових місць` : ''}   · черга ${crawl.pending()} · Google ${count.google}/${budget}`);
      if (body.source === 'google' && count.google % 5 === 0 && !(await checkCap(false))) {
        why = `денний ліміт Google: людям лишено ${o.reserve}`;
        break;
      }
    } else if (res.status === 200 && body && body.ok === false && ['cap', 'denied', 'disabled', 'no_key'].includes(body.reason)) {
      // питання не записуємо: наступного запуску воно знову буде в черзі
      why =
        body.reason === 'cap'
          ? 'сервер каже «ліміт»: вичерпано наш денний ліміт або квоту в Google Cloud (429) — продовжіть пізніше, питання лишилось у черзі'
          : body.reason === 'denied'
            ? 'Google відмовив серверу в доступі (403): обмеження ключа, вимкнений Routes API або білінг — питання лишилось у черзі'
            : 'на сервері дорогу містом вимкнено або немає ключа Google';
      console.log(`${n} ⛔ ${body.reason}  ${label}`);
      googleTrouble = true;
      break;
    } else if (res.status === 200 && body && body.ok === false && body.reason !== 'no_route' && body.reason !== 'archived') {
      // збій Google — не відповідь про місце: у журнал не пишемо, питання повториться наступного запуску
      count.failed++;
      failStreak++;
      googleTrouble = true;
      console.log(`${n} ⚠️  Google не відповів     ${label}`);
    } else if ((res.status === 200 && body && body.ok === false) || res.status === 400) {
      // `archived` — власник прибрав це місце в адмінці («Місця» → «В архів»): сервер про нього не відповідає
      const archived = res.status === 200 && body.reason === 'archived';
      const { record } = crawl.done(task, { ok: false, reason: res.status === 400 ? 'bad_request' : archived ? 'archived' : 'no_route' });
      appendJournal(file, record);
      failStreak = 0;
      count.noRoute++;
      console.log(`${n} ·  ${archived ? 'місце в архіві       ' : 'маршруту немає       '} ${label}`);
    } else {
      // мережа або збій сервера: у журнал не пишемо, питання повториться наступного запуску
      count.failed++;
      failStreak++;
      console.log(`${n} ⚠️  ${res.error ?? `HTTP ${res.status}`}  ${label}`);
    }
    if (failStreak >= 5) {
      why = 'пʼять збоїв поспіль — зупиняюсь, щоб не довбати сервер';
      break;
    }
    if (!stopping) await sleep(body?.ok && body.source !== 'google' ? Math.min(o.pause, 300) : o.pause);
  }

  if (googleTrouble) {
    const st = await cityStats(o.api, headers);
    const ge = st?.googleError;
    if (ge) console.log(`\nGoogle сказав серверу (HTTP ${ge.status}, ${new Date(ge.at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}): ${ge.message || 'без пояснення'}`);
    else if (st) console.log('\nЩо саме відповів Google, сервер не зберіг — дивіться журнал сервера (Railway), рядки «city-route».');
  }

  const all = summarizeRecords(readJournal(file), { freshDays });
  const secs = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n■ ${why}`);
  console.log(`За запуск (${secs} с): запитів ${count.asked} · нових від Google ${count.google} · уже було в базі ${count.stored} · власні дані ${count.own} · без маршруту ${count.noRoute} · збоїв ${count.failed}`);
  console.log(`Пропущено як уже спитане ${crawl.stats.skipped} · знайдено нових місць ${crawl.stats.found} · у черзі лишилось ${crawl.pending()}`);
  console.log(`Журнал загалом: місць із відповіддю ${all.pairs} · ліній ${all.lines} · зупинок ${all.stops} — ${path.relative(process.cwd(), file)}`);
  if (crawl.pending()) console.log('Продовжити: npm run dovede:crawl (без фрази).');
}

main().catch((e) => {
  console.error(`❌ ${e?.message ?? e}`);
  process.exit(1);
});
