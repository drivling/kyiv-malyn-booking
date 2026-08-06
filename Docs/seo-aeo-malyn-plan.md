# SEO / AEO — живий план (malin.kiev.ua)

Мета: конкурувати з Polissya.today / новинами / BlaBlaCar за запитами «як доїхати», «маршрутка», «попутка» Малин ↔ Київ|Житомир|Коростень; плюс міський транспорт vs Коростень/Звягель/Рівне.

## Чекліст ітерацій

- [x] **I1–I6** — tooling, redirects, corridors, home AEO, travel, smoke
- [x] **I7** — фіксований розклад маршруток з API на коридорних лендінгах
- [x] **I8** — prerender HTML таблиць коридорів + зовнішні анкори `/poputky` → `/mizhgorodski`
- [x] **I9** — AEO/SEO `/transport` (каталог маршрутів, FAQ, meta/JSON-LD)
- [x] **I10** — SEO-лендінги зупинок (`/transport/stop/st_*`) + sitemap на build
- [x] **I11** — Telegram web-лінки → `/mizhgorodski` (+ тести)

## Після кроку I10

**Що зробили:** SPA SEO на табло зупинки (H1, FAQ, ItemList); `prerender-transport-stops.mjs` пише `dist/transport/stop/{id}/index.html` і дописує stops/routes у `dist/sitemap.xml` (дані з API або local JSON).

## Після кроку I11

**Що зробили:** `poputkyWeb` і хардкод URL у telegram/referral/inline → `https://malin.kiev.ua/mizhgorodski`; оновлені `telegram.test.ts` / `referral.test.ts`. Команда бота `/poputky` і API `POST /poputky/announce-draft` лишаються (це не URL сайту).

**Далі (опційно):** guest posts / оновлення malyn.media; моніторинг GSC після deploy.
