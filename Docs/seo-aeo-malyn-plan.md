# SEO / AEO — живий план (malin.kiev.ua)

Мета: конкурувати з Polissya.today / новинами / BlaBlaCar за запитами «як доїхати», «маршрутка», «попутка» Малин ↔ Київ|Житомир|Коростень; плюс міський транспорт vs Коростень/Звягель/Рівне.

## Чекліст ітерацій

- [x] **I1–I6** — tooling, redirects, corridors, home AEO, travel, smoke
- [x] **I7** — фіксований розклад маршруток з API на коридорних лендінгах
- [x] **I8** — prerender HTML таблиць коридорів + зовнішні анкори `/poputky` → `/mizhgorodski`
- [x] **I9** — AEO/SEO `/transport` (каталог маршрутів, FAQ, meta/JSON-LD)

## Після кроку I7

**Що зробили:** таблиця розкладу на коридорах; FAQ з першим/останнім рейсом; ItemList.

**Що побачили:** Google ще тримає старі `/booking`/`/poputky`; боти без повного JS не бачили таблицю в початковому HTML.

## Після кроку I8

**Що зробили:** `frontend/scripts/prerender-corridors.mjs` після `vite build` пише `dist/mizhgorodski/{slug}/index.html` з таблицею з `GET /schedules`; анкори в Docs + `llms.txt` на `/mizhgorodski`.

**Що побачили:** у сусідніх містах (Коростень / Звягель / Рівне) міський транспорт індексується через **окремі сторінки маршрутів + списки зупинок + FAQ**, а не лише інтерактивну карту.

## Після кроку I9

**Що зробили:** на `/transport` — видимий каталог ліній + FAQ; `usePageSeo` + FAQPage/ItemList; на `/transport/route/:id` — title/description з годинами і BreadcrumbList.

**Далі (опційно):** стабільні SEO-лендінги зупинок у sitemap; оновлення Telegram-лінків з `/poputky` на `/mizhgorodski` (окремий цикл + тести).
