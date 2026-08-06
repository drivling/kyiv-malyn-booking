# SEO / AEO — живий план (malin.kiev.ua)

Мета: конкурувати з Polissya.today / новинами / BlaBlaCar за запитами «як доїхати», «маршрутка», «попутка» Малин ↔ Київ|Житомир|Коростень.

## Чекліст ітерацій

- [x] **I1** — usePageSeo + OG, sitemap `/transport`, robots, index.html
- [x] **I2** — редіректи `/poputky`, `/booking` → `/mizhgorodski`; Allow у robots
- [x] **I3** — 6 коридорних лендінгів + sitemap
- [x] **I4** — AEO-блок на головній + FAQPage
- [x] **I5** — `/support/travel` + SiteArticle
- [x] **I6** — smoke-док + фінальні нотатки

## Після кроку I1–I5 (коротко)

Див. коміти: tooling → redirects → corridors → home AEO → travel guide.

## Після кроку I6 (фінал циклу)

**Що зробили:** [Docs/seo-aeo-malyn-smoke.md](seo-aeo-malyn-smoke.md) — ручний чекліст title/canonical/schema/редиректи/sitemap.

**Вердикт на сьогодні:** продукт **готовий до індексації й цитування ІІ** по інтентах «як доїхати / попутка / маршрутка» для Київ, Житомир, Коростень. Фактичний №1 у Google — після deploy + GSC sitemap + переобхід старих URL і (бажано) оновлення зовнішніх згадок з `/poputky` на `/mizhgorodski` або коридори.

**Що побачили в серпі раніше:** Polissya виграє довгими статтями з посадкою; BlaBlaCar — URL на коридор + FAQ. Ми закрили той самий шар без копіювання чужих розкладів.

**Наступний цикл (поза скоупом):** оновлення прес-лінків; SSR/prerender за потреби; SEO зупинок `/transport`; guest post / локальні ЗМІ з анкорами на коридори.
