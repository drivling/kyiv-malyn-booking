# Транспорт Малина як PWA — ручна перевірка (smoke)

У CI e2e з реальним service worker нема: він потребує `npm run build` проти живого API і `serve-dist`
(Playwright у CI ходить через `vite dev`, де воркера немає). Тому після деплою (`Docs/transport-pwa-2026-10.md`) —
спочатку скрипт `npm run pwa:smoke` (розділ нижче), далі цей чекліст на malin.kiev.ua, а локально — на
`node scripts/serve-dist.mjs` поверх свіжого `dist/` (`http://localhost:4173` — localhost теж secure context).

## Скрипт `npm run pwa:smoke` (frontend, лише вручну)

`frontend/scripts/pwa-smoke.mjs` — Playwright-скрипт з реальним воркером проти задеплоєного сайту; не в CI і не в
pre-commit. Headless Chromium (430×900, uk-UA, Europe/Kyiv) відкриває базовий URL (за замовчуванням
`https://malin.kiev.ua`; інший — аргументом: `npm run pwa:smoke -- http://localhost:4173`), сам качає
`<base>/transport/dataset.json` і бере з нього перший не-`unreliable` маршрут та його першу зупинку. Покриває перші
п'ять пунктів чекліста Chrome нижче: **онлайн** — воркер `activated` зі scope `/transport`, `BUILD_ID` відповідає, один
кеш `malin-transport-shell-<id>` з оболонкою, усіма `/assets/*`, на які вона посилається, маніфестом, іконками і знімком,
копія в localStorage, після перезавантаження сторінка під контролем; **офлайн** (`context.setOffline` + abort усіх
запитів, і воркера теж) — `/transport`, табло, маршрут і схема відкриваються з воркера без жодного підресурсу з мережі,
з даними і смужкою стану, а `/mizhgorodski` падає як у звичайній вкладці; **«бекенд упав»** (abort лише
`GET …/transport/dataset`) — табло з копії зі смужкою «Сервер не відповідає…» і кнопкою «Оновити», а без копії — зі
знімка збірки; **знову онлайн** — смужка зникає, копія пишеться знову. Підсумок — таблиця PASS/WARN/FAIL, код виходу 1
при будь-якому FAIL (WARN — лише порада: кеш шрифтів, `cache-control` воркера після CDN). `PWA_SMOKE_SHOTS=<dir>`
додатково пише скріншот кожної перевіреної сторінки.

Застереження: під емуляцією Playwright `navigator.onLine` лишається `true`, тому навіть повністю офлайн сайт показує
гілку «Сервер не відповідає…». Скрипт лише підміняє `navigator.onLine` (init script) і перевіряє, що текст смужки
стає «Без мережі…»; справжнє визначення «мережі немає» — **тільки на телефоні** з вимкненим Wi-Fi і мобільними даними.
Встановлення, оновлення версії, вторинний домен, iOS і Lighthouse лишаються ручними пунктами нижче.

## Chrome (Android або десктоп)

- [ ] `/transport` → DevTools → Application → Manifest: назва «Транспорт Малина», `start_url` `/transport`,
  іконки 192/512 + maskable, немає помилок «installability».
- [ ] Application → Service workers: `transport-sw.js`, scope `/transport`, статус **activated and is running**.
  Application → Cache storage: один кеш `malin-transport-shell-<12 hex>` (старих нема), у ньому `/index.html`,
  `/assets/*`, `/transport.webmanifest`, `/icons/*`, `/transport/dataset.json`; після завантаження шрифтів —
  `malin-transport-fonts-v1`.
- [ ] Network → **Offline**, перезавантажити `/transport`, `/transport/stop/st_0001`, `/transport/route/1`,
  `/transport/scheme`: сторінки відкриваються, табло показує відправлення, зверху смужка «Без мережі — розклад
  станом на дд.мм.рррр». Карта (тайли OSM) порожня — очікувано.
- [ ] Offline, адреса `/mizhgorodski` → звичайна помилка браузера (поза scope — очікувано).
- [ ] Online, DevTools → Network → заблокувати `*/transport/dataset` (бекенд «упав») → перезавантажити табло:
  дані з копії, смужка «Сервер не відповідає — показуємо збережений розклад…», кнопка «Оновити».
- [ ] Смужка пропонує «Встановити» (у браузерній вкладці, не в застосунку) → системний діалог → застосунок на
  головному екрані відкривається на `/transport` без адресного рядка; GA4 DebugView бачить `transport_pwa_install`.
- [ ] Встановлений застосунок у режимі **Offline** (вимкнути Wi-Fi і мобільні дані) відкривається і показує табло.

## Оновлення версії

- [ ] Задеплоїти будь-яку зміну фронтенду. У відкритій вкладці `/transport`: згорнути браузер ≥ 30 хв (або DevTools →
  Application → Service workers → **Update**, потім перейти на іншу сторінку транспорту) → нова збірка (новий хеш у
  `<script src="/assets/index-….js">` у Elements, новий `malin-transport-shell-<id>` у Cache storage, старий видалено).
- [ ] Коротка відсутність (< 30 хв) або відкрита модалка «Факт прибуття»: знизу банер «Доступна нова версія сайту —
  Оновити / Пізніше»; «Оновити» перезавантажує в нову збірку; «Пізніше» ховає банер, наступний перехід між
  сторінками все одно застосовує.
- [ ] `/admin/*` ніколи не перезавантажується сам і банера не показує.

## Вторинний домен і краулери

- [ ] `https://korosten.kiev.ua/transport.webmanifest` і `/transport-sw.js` → 404; Application → Service workers порожній.
- [ ] `curl -I https://malin.kiev.ua/transport-sw.js` → `cache-control: no-cache`, `content-type: text/javascript`;
  `curl -I https://malin.kiev.ua/transport.webmanifest` → `application/manifest+json`, `no-cache`;
  `curl -I https://malin.kiev.ua/transport/dataset.json` → `application/json`, `no-cache`.
- [ ] `curl -s https://malin.kiev.ua/transport/stop/st_0001 | grep -c lt-status-bar` → `0` (смужка не запечена в HTML).

## iOS Safari

- [ ] `/transport` у вкладці Safari: смужка з підказкою «Поділитися → На Початковий екран» і «Зрозуміло» (після нього
  підказка не повертається).
- [ ] «Поділитися» → «На Початковий екран»: іконка маршрутки, назва «Транспорт»; застосунок відкривається без
  адресного рядка; у режимі «В літаку» показує табло з копії.
- [ ] Ризик, про який треба пам'ятати: сайт, не доданий на екран, Safari може почистити (localStorage + кеш) після
  7 днів без відвідин.

## Lighthouse (десктоп Chrome, `/transport/stop/st_0001`)

- [ ] PWA/Installable без зауважень; Accessibility не нижча, ніж до фази 4 (смужка `role="status"`, банер — також).
