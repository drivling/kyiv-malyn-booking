# SEO / AEO — живий план (malin.kiev.ua)

Мета: конкурувати з Polissya.today / новинами / BlaBlaCar за запитами «як доїхати», «маршрутка», «попутка» Малин ↔ Київ|Житомир|Коростень.

## Чекліст ітерацій

- [x] **I1** — usePageSeo + OG, sitemap `/transport`, robots коментарі, index.html, цей файл
- [ ] **I2** — редіректи `/poputky`, `/booking` → `/mizhgorodski`; прибрати Disallow; лінки в support
- [ ] **I3** — 6 коридорних лендінгів + sitemap
- [ ] **I4** — AEO-блок на головній + FAQPage
- [ ] **I5** — `/support/travel` + SiteArticle
- [ ] **I6** — smoke-док + фінальні нотатки

## Після кроку I1

**Що зробили:** розширено `usePageSeo` (description, og:*, `upsertJsonLd`); sitemap: `/transport` замість `/localtransport`, `lastmod` 2026-08-07; index.html — ключі «як доїхати» + SearchAction; robots — коментар про Disallow до I2.

**Що побачили:** Google ще індексує старі `/poputky` і `/booking` (site:); Disallow лишаємо до редіректів, інакше бот не переобійде URL і не побачить Navigate.

**Дописали в план на наступні кроки:** після I2 обов’язково перевірити, що support FAQ більше не рекламує `/poputky` як окремий продукт-URL.
