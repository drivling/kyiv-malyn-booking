# Транспорт Малина як PWA — ручна перевірка (smoke)

Автоматичного e2e з реальним service worker нема: він потребує `npm run build` проти живого API і `serve-dist`
(Playwright у CI ходить через `vite dev`, де воркера немає). Тому після деплою фази 4 (`Docs/transport-pwa-2026-10.md`)
— цей чекліст на malin.kiev.ua, а локально — на `node scripts/serve-dist.mjs` поверх свіжого `dist/`
(`http://localhost:4173` — localhost теж secure context).

## Chrome (Android або десктоп)

- [ ] `/transport` → DevTools → Application → Manifest: назва «Транспорт Малина», `start_url` `/transport`,
  іконки 192/512 + maskable, немає помилок «installability».
- [ ] Application → Service workers: `transport-sw.js`, scope `/transport`, статус **activated and is running**.
  Application → Cache storage: один кеш `malin-transport-shell-<12 hex>` (старих нема), у ньому `/index.html`,
  `/assets/*`, `/transport.webmanifest`, `/icons/*`, `/transport/dataset.json`; після завантаження шрифтів —
  `malin-transport-fonts-v1`.
- [ ] Network → **Offline**, перезавантажити `/transport`, `/transport/stop/st_0001`, `/transport/route/2` (№1 на сайті
  прихований як `unreliable`),
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
- [ ] `curl -I https://malin.kiev.ua/transport-sw.js` → `content-type: text/javascript`; `cache-control` з origin `no-cache`,
  але на проді Cloudflare кешує `.js` за розширенням і переписує його на `max-age=14400` (Browser Cache TTL зони) — це
  норма, браузер запитує скрипт воркера повз HTTP-кеш (файл відновлення, «Фаза 6», знахідка 1);
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
