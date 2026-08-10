# SEO / AEO smoke checklist (malin.kiev.ua)

Date: 2026-08-10  
Goal: готовність конкурувати з Polissya / новинами / BlaBlaCar за «як доїхати / маршрутка / попутка».

## Meta & canonical

- [x] `/mizhgorodski` — title містить попутки/маршрутки + Малин + міста; description з «як доїхати»; canonical `https://malin.kiev.ua/mizhgorodski`
- [x] `/mizhgorodski/kyiv-malyn` (і решта 5) — унікальні title/description/H1; og:title/url; canonical на свій slug
- [x] `/support/travel` — title «Як доїхати до Малина»; description з містами
- [x] `/transport` — title з «Транспорт Малина» / розклад; description; canonical `https://malin.kiev.ua/transport`
- [x] `/transport/route/{id}` — унікальний title з № і кінцевими; canonical на свій route
- [x] `/transport/stop/{st_*}` — title «Зупинка …»; canonical на `st_*`; години у картках/JSON-LD

## Structured data

- [x] Головна: `FAQPage` script id `mizh-home-faq-jsonld`
- [x] Коридор: `BreadcrumbList` + `FAQPage` (id `corridor-jsonld-*`)
- [x] `/support/travel`: `FAQPage` id `support-travel-jsonld`
- [x] `/support/faq`: існуючий FAQPage без поломки
- [x] `/transport`: `transport-hub-jsonld` (FAQPage + ItemList маршрутів)
- [x] `/transport/route/{id}`: `transport-route-jsonld-*`
- [x] `/transport/stop/{id}`: `transport-stop-jsonld-*`

## URL hygiene

- [x] `/poputky` → `/mizhgorodski` (**HTTP 301** у `serve-dist.mjs` + SPA Navigate)
- [x] `/booking` → `/mizhgorodski` (**HTTP 301** + SPA)
- [x] `/localtransport` → `/transport` (**HTTP 301** + SPA rewrite)
- [x] `robots.txt` **не** Disallow `/poputky` / `/booking`
- [x] `sitemap.xml` містить `/transport`, 6 коридорів, `/support/travel`; **не** містить `/localtransport` як канон
- [ ] Після build: у `dist/mizhgorodski/{slug}/index.html` години в таблиці «Розклад маршруток» у view-source (зараз є H2 + fallback «підвантажиться в додатку» — потрібен API на build)
- [x] Після build: `dist/sitemap.xml` містить `/transport/route/*` і `/transport/stop/st_*`
- [x] Після build: є `dist/transport/stop/st_*/index.html`
- [x] Telegram-повідомлення / referral caption ведуть на `/mizhgorodski`, не `/poputky`

## Content / AEO

- [x] Головна: блок «Як доїхати до Малина» + «Напрямки» + видимий FAQ
- [x] Коридор: CTA «Шукати зараз» веде на `?from=&to=`
- [x] Коридор: таблиця «Розклад маршруток» з API (`GET /schedules`), години відправлення видимі в HTML (SPA)
- [x] Коридор: FAQ згадує перший/останній рейс коли є дані; ItemList у JSON-LD
- [x] Support hub показує картку «Як доїхати до Малина»; travel згадує розклад на напрямках
- [x] `/transport`: блок «Маршрути Малина» + FAQ; лінки на `/transport/route/{id}`
- [x] `llms.txt` / Docs анкори вказують на `/mizhgorodski`, не `/poputky`

## After deploy

- [ ] GSC: надіслати оновлений sitemap
- [ ] URL Inspection на `/mizhgorodski/malyn-kyiv` і `/support/travel`
- [ ] Запит на переобхід `/poputky` (має дати **301** → `/mizhgorodski`)
- [ ] Перевірити в AI Overview / site: що з’являються години рейсів з лендінгів

## Honest note

Технічна готовність ≠ топ-1 завтра. Позиції залежать від crawl, посилань (напр. оновлення promo на malyn.media з `/poputky` → `/mizhgorodski`) і свіжості контенту. Фіксований розклад з власної БД — головна перевага над новинними «розкладами 2022».
