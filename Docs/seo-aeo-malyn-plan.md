# SEO / AEO — живий план (malin.kiev.ua)

Мета: конкурувати з Polissya.today / новинами / BlaBlaCar за запитами «як доїхати», «маршрутка», «попутка» Малин ↔ Київ|Житомир|Коростень.

## Чекліст ітерацій

- [x] **I1–I6** — tooling, redirects, corridors, home AEO, travel, smoke
- [x] **I7** — фіксований розклад маршруток з API на коридорних лендінгах

## Після кроку I7

**Що зробили:** на `/mizhgorodski/{slug}` — таблиця «Розклад маршруток» з `GET /schedules` (Irpin/Bucha тощо), CTA «Лише маршрутки» / «Забронювати», динамічний FAQ (перший/останній рейс), `ItemList` у JSON-LD; `/support/travel` пояснює де дивитися розклад.

**Що побачили:** у [site:malin.kiev.ua](https://www.google.com/search?q=site%3Amalin.kiev.ua) досі старі `/booking`/`/poputky` без годин — після deploy потрібен re-crawl коридорів із таблицею, щоб ІІ цитували наші часи, а не Infomalin 2022.

**Далі (опційно):** prerender HTML таблиці для ботів без JS; оновлення зовнішніх анкорів; SEO `/transport`.
