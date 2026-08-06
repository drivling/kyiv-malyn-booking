# SEO / AEO — живий план (malin.kiev.ua)

Мета: конкурувати з Polissya.today / новинами / BlaBlaCar за запитами «як доїхати», «маршрутка», «попутка» Малин ↔ Київ|Житомир|Коростень.

## Чекліст ітерацій

- [x] **I1** — usePageSeo + OG, sitemap `/transport`, robots коментарі, index.html, цей файл
- [x] **I2** — редіректи `/poputky`, `/booking` → `/mizhgorodski`; прибрати Disallow; лінки в support
- [ ] **I3** — 6 коридорних лендінгів + sitemap
- [ ] **I4** — AEO-блок на головній + FAQPage
- [ ] **I5** — `/support/travel` + SiteArticle
- [ ] **I6** — smoke-док + фінальні нотатки

## Після кроку I1

**Що зробили:** розширено `usePageSeo` (description, og:*, `upsertJsonLd`); sitemap: `/transport` замість `/localtransport`, `lastmod` 2026-08-07; index.html — ключі «як доїхати»; robots — Disallow до I2.

**Що побачили:** Google ще індексує старі `/poputky` і `/booking` (site:). Невалідний SearchAction прибрали з index.html.

## Після кроку I2

**Що зробили:** SPA `Navigate` з `/poputky` і `/booking` на `/mizhgorodski`; прибрано Disallow у robots; support/FAQ/about/user лінки на канон; SiteArticle вже зливає попутки+маршрутки в одну картку.

**Що побачили:** `PoputkyPage` / `BookingPage` лишаються в репо, але більше не в роутері — ок для I2; повне видалення — окремий цикл. Telegram-команди `/poputky` у боті не чіпаємо (це не URL сайту).

**Дописали на I3:** лендінги мають відразу давати deep-link `?from=&to=` на живий пошук; на головній — блок «Напрямки» з 6 URL (не лише corridor chips).
