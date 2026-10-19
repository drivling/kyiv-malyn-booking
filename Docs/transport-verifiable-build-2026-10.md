# Ремонт, форк, перевірка: SRI, видимий BUILD_ID і застосунок без домену

**Status:** Фаза 0 ✅ · Фаза 1 ✅ · Фаза 2 ⏳ · Фаза 3 ⏳ · Фаза 4 ⏳  
**Де зупинились:** SRI закомічено й перевірено збіркою та smoke; далі — фаза 2 (видимий `BUILD_ID` на `/about`)  
**Created:** 2026-10-20 · **Гілка тут:** `transport-verifiable-build` (від `main` після #97) · **Гілка в `internet4`:** `verifiable-build-case`

Файл відновлення: нова сесія читає його згори і продовжує з першого незакритого пункту. Одна фаза → один
англійський коміт; перед пушем — `gh pr view` стану гілки (власник мерджить швидко, гілка після squash зникає).
Це **етап 5** великого плану «malin.kiev.ua за маніфестом own-net» — таблиця етапів і рішення власника в
[`transport-pwa-2026-10.md`](transport-pwa-2026-10.md); етапи 1–4 і 6 злиті й задеплоєні (#82–#97):
[`transport-offline-writes-2026-10.md`](transport-offline-writes-2026-10.md),
[`transport-open-data-2026-10.md`](transport-open-data-2026-10.md),
[`transport-open-protocols-2026-10.md`](transport-open-protocols-2026-10.md),
[`transport-revisions-2026-10.md`](transport-revisions-2026-10.md),
[`manifesto-communication-2026-10.md`](manifesto-communication-2026-10.md). Фаза 4 етапу 3 (особисті дані в `/user`
і боті) робиться паралельно в іншій сесії — цей етап не торкається `/user`, `telegram.ts` і
`transport-open-data-2026-10.md`; на `/about` правка мінімальна й окремим блоком.

## Що просив власник (2026-10-20)

Принципи П7 («перевірювана архітектура»), П8 («ремонт/форк»), П1/П2 («без kill switch, без дозволу корпорації») у
кейсі на own-net.com стоять як «частково»: SRI на бандл і видимий id збірки не зроблені, інструкції «підняти свою
копію» нема, встановлена копія, яка переживе домен, «ще не збудована». Етап 5 — у **звуженому обсязі** за рішенням
власника: зробити перевірюваність (SRI, видимий `BUILD_ID`) і чесно перевірити життя застосунку без домену; форк не
полегшувати.

## Рішення

| питання | рішення |
|---|---|
| `Docs/fork.md` і будь-які «як підняти свою копію» | **не робимо і не пишемо.** Ліцензія OwnNet 1.1 форк і ремонт не забороняє, репозиторій публічний — цього достатньо; ми не полегшуємо і не закликаємо, лише не забороняємо. У кейсі на own-net.com рядок П8 формулюється саме так («не забороняємо: репозиторій і дані відкриті під OwnNet 1.1»), без обіцянок допомоги |
| де рахувати SRI | окремий крок `scripts/sri.mjs` одразу після `vite build` і **до** пререндерів: `prerender-corridors`, `prerender-transport-stops` і `prerender-spa` копіюють `<head>` оболонки `dist/index.html`, тож `integrity` потрапляє і в статичні сторінки; `build-sw.mjs` іде ще пізніше і precache-ить ту саму оболонку |
| що саме підписуємо | `<script type="module" src="/assets/index-*.js">` і `<link rel="stylesheet" href="/assets/index-*.css">` — єдина точка входу без code splitting; картинки Leaflet і шрифти не підписуються (SRI є лише для script/link). `sha384`, `crossorigin="anonymous"` явно (Vite ставить голий `crossorigin`) |
| SRI і service worker | не заважають один одному: воркер віддає з кешу ті самі байти, що й сервер, тож хеш збігається; перевірку робить браузер на будь-якій відповіді з `type: basic`. `freshBuild.ts` (`BUNDLE_RE` по `src`) і `assertShellCovered` (`src|href`) атрибут `integrity` не бачать |
| видимий `BUILD_ID` | один рядок на `/about` у блоці «працює без мережі»: збірка (хеш бандла з `loadedBundle()`), service worker (`BUILD_ID` через `GET_BUILD_ID` → `buildIdOf`, лише коли є реєстрація), дані станом на `revision` (`useTransportDataset().dataAsOf`). Під пререндером не рендериться (`isPrerendering()`), домен не хардкодиться; поруч — як звірити |
| «застосунок без домену» | перевіряємо фактом, а не обіцянкою: `serve-dist` зупинений = DNS не відповідає з погляду застосунку; результат і межі (що НЕ працює без домену) — розділ «Без домену» у `transport-pwa-smoke.md`; код правимо лише якщо щось справді заважає |
| гілка в цьому репо | `git worktree` `…/kyiv-malyn-booking-stage5` від `origin/main` (основний чекаут зайнятий іншою сесією; гілки не перемикаємо); `node_modules` — symlink на основний чекаут |

## Чекліст

Фаза 0 — файл відновлення
- [x] **0.1** Цей файл: рішення власника (без `fork.md`), межі, чекліст
- [x] **0.2** Коміт `Docs: verifiable build recovery file (stage 5, phase 0)`

Фаза 1 — SRI на бандл сайту
- [x] **1.1** `frontend/scripts/sri.mjs`: чиста функція `addIntegrity(html, readAsset)` (+ `sriOf(buffer)`), CLI-обгортка над `dist/index.html`; помилка, якщо в оболонці немає жодного `/assets/index-*` або файл не знайдено
- [x] **1.2** `package.json` `build`: крок після `vite build`, до пререндерів
- [x] **1.3** Юніт-тест `src/test/sri.test.ts` (як `precache.test.ts`): два теги, `sha384-…` від вмісту, `crossorigin="anonymous"`, ідемпотентність, чужі теги не чіпає
- [x] **1.4** Перевірка, що нічого не зламалось: `sri.test.ts` проганяє підписану оболонку через `bundleInHtml`/`loadedBundle`/`shellAssetRefs`; повний `npm run build` з прод-API; `seo-smoke` зелений; `npm run pwa:smoke -- http://localhost:4173` поверх `serve-dist` — воркер віддає підписані файли
- [x] **1.5** Коміт `Subresource integrity for the site bundle`

Фаза 2 — видимий `BUILD_ID` на `/about`
- [ ] **2.1** `src/pwa/buildInfo.ts`: `useBuildInfo()` → `{ bundle, swBuildId, dataAsOf }` (реєстрація воркера читається через `navigator.serviceWorker.getRegistration('/transport')`, id — `buildIdOf(active)`)
- [ ] **2.2** Рядок у блоці «працює без мережі» на `/about` + речення «як звірити» (відносні адреси `/transport-sw.js`, джерело сторінки); не рендериться під пререндером
- [ ] **2.3** Тести: `buildInfo.test.tsx` (без воркера → лише збірка й дані; з воркером → id), `CompanyLegalPage.test.tsx` (рядок є, доменів нема)
- [ ] **2.4** Коміт `Visible build id, worker id and data revision on /about`

Фаза 3 — застосунок живе без домену
- [ ] **3.1** Локальна перевірка: `npm run build` → `serve-dist` → перший візит `/transport` (воркер activated) → **зупинити serve-dist** → відкрити `/transport/stop/<id>`, `/transport/route/<id>`, `/transport/scheme`: сторінки з precache, дані з копії/знімка, смужка стану; `/mizhgorodski` і `/about` — помилка браузера (поза scope)
- [ ] **3.2** Розділ «Без домену» у `Docs/transport-pwa-smoke.md`: як відтворити (serve-dist зупинений; `/etc/hosts` для власника на проді), що працює, що НІ (оновлення, API, карта, перший візит, нові сторінки поза precache), скільки живе (eviction браузера, iOS 7 днів)
- [ ] **3.3** Якщо щось у коді заважає (`fetch('/')` у freshBuild, реєстрація воркера, ворота `LocalTransportGate`) — мінімальна правка з тестом; інакше записати «нічого не заважає» зі слідами
- [ ] **3.4** Коміт `Docs: installed app without the domain (smoke section)` (або з правкою коду)

Фаза 4 — документація і кейс
- [ ] **4.1** CLAUDE.md «Transport PWA»: абзац про SRI (`scripts/sri.mjs` після `vite build`), `BUILD_ID` на `/about`, «без домену»
- [ ] **4.2** `transport-pwa-2026-10.md`: таблиця етапів — етап 5 ✅ з посиланням на цей файл і реальним обсягом
- [ ] **4.3** `internet4` (`~/Projects/internet4`, worktree `…/internet4-stage5`, гілка `verifiable-build-case` від `main`): рядки П1, П7, П8 кейсу трьома мовами з адресами-доказами; `node build.js` → `ru/`, `uk/`
- [ ] **4.4** Коміти: тут `Docs: stage 5 in CLAUDE.md and the PWA stage table`; в `internet4` `Case page: verifiable build, fork stance, app without the domain`
- [ ] **4.5** `gh pr view` → push обох гілок → два compare-посилання в «Підсумку»

## Знахідки

### Фаза 1 — SRI (2026-10-20)

- Vite сам ставить голий `crossorigin` на точку входу і таблицю стилів; `scripts/sri.mjs` знімає його й ставить
  `integrity="sha384-…" crossorigin="anonymous"` (атрибути після `src`/`href`, щоб `grep -o '<script type="module"[^>]*>'`
  читався з першого погляду). Підписано рівно два теги; favicon, preconnect, Google Fonts і gtag — без змін.
- Пререндер справді копіює head: після повної збірки `integrity` є в `dist/transport/index.html`, `dist/about/index.html`,
  `dist/mizhgorodski/malyn-kyiv/index.html`, `dist/transport/stop/st_0001/index.html`. `seo-smoke`: 133 URL, 0 помилок.
- Перевірка руками збігається з атрибутом: `openssl dgst -sha384 -binary dist/assets/index-<hash>.js | base64`.
- `npm run pwa:smoke -- http://localhost:4173` поверх `serve-dist` із підписаною збіркою: воркер `activated`, кеш
  `malin-transport-shell-<id>` з обома підписаними assets, офлайн усі чотири сторінки «served by the worker, no
  subresource from the network», жодної помилки SRI в консолі. 4 FAIL у кроках «онлайн» — лише тому, що локальна збірка
  без `VITE_API_URL` не має бекенду (копія не пишеться, смужка «Сервер не відповідає»); до SRI не стосується — фінальний
  прогін зі збіркою на прод-API в «Підсумку».

## Чого свідомо немає в етапі 5

- `Docs/fork.md`, інструкцій «підняти свою копію», Docker-compose для чужого хостингу — рішення власника (таблиця вище).
- SRI для картинок Leaflet, шрифтів Google і gtag: SRI існує лише для `<script>` і `<link rel=stylesheet>`; шрифти
  приходять з чужого CDN із власними версіями в URL, gtag — зовнішній скрипт, який ми не контролюємо.
- Reproducible build (однаковий хеш бандла з двох машин) — не перевірявся; `integrity` підтверджує, що браузер отримав
  те, що лежить у `dist/` цього деплою, а не що `dist/` зібрано саме з цього коміту.
- Власний домен як гарантія: застосунок живе без домену лише в тому браузері, де його встановили, і лише поки той не
  витіснив кеш; без мережі й без домену оновлень не буде — це межа, а не недоробка.
