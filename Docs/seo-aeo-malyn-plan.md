# SEO / AEO — живий план (malin.kiev.ua)

Мета: конкурувати з Polissya.today / новинами / BlaBlaCar за запитами «як доїхати», «маршрутка», «попутка» Малин ↔ Київ|Житомир|Коростень.

## Чекліст ітерацій

- [x] **I1** — usePageSeo + OG, sitemap `/transport`, robots коментарі, index.html, цей файл
- [x] **I2** — редіректи `/poputky`, `/booking` → `/mizhgorodski`; прибрати Disallow; лінки в support
- [x] **I3** — 6 коридорних лендінгів + sitemap
- [ ] **I4** — AEO-блок на головній + FAQPage
- [ ] **I5** — `/support/travel` + SiteArticle
- [ ] **I6** — smoke-док + фінальні нотатки

## Після кроку I1

**Що зробили:** `usePageSeo` + OG + `upsertJsonLd`; sitemap `/transport`; index.html ключі «як доїхати».

## Після кроку I2

**Що зробили:** Navigate `/poputky`/`/booking` → `/mizhgorodski`; robots Allow; support/legal лінки на канон.

## Після кроку I3

**Що зробили:** 6 URL `/mizhgorodski/{slug}` з FAQPage + BreadcrumbList; CTA на `?from=&to=`; блок «Напрямки» на головній; sitemap priority 0.95.

**Що побачили:** контент навмисно без чужих таймтейблів — ставка на живий пошук (як відмінність від Polissya/новин). На I4 не дублювати довгі FAQ з лендінгів — коротший hub-FAQ на головній + лінки на коридори.

**Дописали на I4:** FAQ на головній — 4 Q про «як доїхати / попутка vs маршрутка / бот»; jsonLd id `mizh-home-faq-jsonld` щоб не колізити з corridor-*.
