# SEO / AEO smoke checklist (malin.kiev.ua)

Date: 2026-08-07  
Goal: готовність конкурувати з Polissya / новинами / BlaBlaCar за «як доїхати / маршрутка / попутка».

## Meta & canonical

- [ ] `/mizhgorodski` — title містить попутки/маршрутки + Малин + міста; description з «як доїхати»; canonical `https://malin.kiev.ua/mizhgorodski`
- [ ] `/mizhgorodski/kyiv-malyn` (і решта 5) — унікальні title/description/H1; og:title/url; canonical на свій slug
- [ ] `/support/travel` — title «Як доїхати до Малина»; description з містами

## Structured data

- [ ] Головна: `FAQPage` script id `mizh-home-faq-jsonld`
- [ ] Коридор: `BreadcrumbList` + `FAQPage` (id `corridor-jsonld-*`)
- [ ] `/support/travel`: `FAQPage` id `support-travel-jsonld`
- [ ] `/support/faq`: існуючий FAQPage без поломки

## URL hygiene

- [ ] `/poputky` → `/mizhgorodski` (SPA Navigate)
- [ ] `/booking` → `/mizhgorodski`
- [ ] `/localtransport` → `/transport`
- [ ] `robots.txt` **не** Disallow `/poputky` / `/booking`
- [ ] `sitemap.xml` містить `/transport`, 6 коридорів, `/support/travel`; **не** містить `/localtransport` як канон

## Content / AEO

- [ ] Головна: блок «Як доїхати до Малина» + «Напрямки» + видимий FAQ
- [ ] Коридор: CTA «Шукати зараз» веде на `?from=&to=`
- [ ] Коридор: таблиця «Розклад маршруток» з API (`GET /schedules`), години відправлення видимі в HTML
- [ ] Коридор: FAQ згадує перший/останній рейс коли є дані; ItemList у JSON-LD
- [ ] Support hub показує картку «Як доїхати до Малина»; travel згадує розклад на напрямках

## After deploy

- [ ] GSC: надіслати оновлений sitemap
- [ ] URL Inspection на `/mizhgorodski/malyn-kyiv` і `/support/travel`
- [ ] Запит на переобхід `/poputky` (має згорнутися в канон)
- [ ] Перевірити в AI Overview / site: що з’являються години рейсів з лендінгів

## Honest note

Технічна готовність ≠ топ-1 завтра. Позиції залежать від crawl, посилань (напр. оновлення promo на malyn.media з `/poputky` → `/mizhgorodski`) і свіжості контенту. Фіксований розклад з власної БД — головна перевага над новинними «розкладами 2022».
