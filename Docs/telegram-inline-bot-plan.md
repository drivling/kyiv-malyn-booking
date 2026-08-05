# План: inline-режим бота (архитектура и UX)

Составлен 05.08.2026 после включения inline в BotFather (`/setinline`, placeholder «Запросити друга…»).  
Формат: чекбоксы — лишнее удаляй в Обсидиане, остальное берём сверху вниз.

Обозначения: **P0** — сильный эффект / без этого inline «мёртвый», **P1** — важно для комфорта, **P2** — улучшение.
Оценка — грубая, в часах работы.

**Уже сделано (реферал):**
- Кнопка «📤 Поділитися з другом» → `switch_inline_query: ref_share`
- `bot.on('inline_query')` → `answerInlineQuery` с персональным текстом и ссылкой

**Инструкция для пользователей:** `Docs/telegram-bot-user-guide.md`

---

## Зачем inline для этого бота (не только реферал)

Сейчас почти всё живёт в **личном чате с ботом**: длинные сценарии, кнопки, `/allrides`. Inline даёт:

1. **Действия из любого чата** — семейная группа, соседи, рабочий чат.
2. **Меньше friction** — один тап → выбор чата → готовое сообщение.
3. **Обнаружение бота** — `@malin_kiev_ua_bot` в группе с подсказкой и результатами.

Inline **не заменяет** PM-потоки. Сложные шаги — через `switch_pm` или deep link `t.me/bot?start=…`.

---

## Этап 0. Базовая архитектура inline (P0)

**P0 · ~3ч · backend**

- [x] Модуль `telegram-inline.ts`: `handleInlineQuery(bot, query, ctx)` — единая точка входа
- [x] Реестр префиксов: `ref_share`, `rides`, `rides_today`, `help`, `book`, `share_listing_`, `setup_phone`
- [x] Правило: **всегда** вызывать `answerInlineQuery` (даже `[]`)
- [x] `is_personal: true` для реферала; `cache_time` по типу
- [x] Логирование: inline_query id, kind, from.id, latency ms
- [x] Юніт-тесты: `telegram-inline.test.ts`

> **Решено:** `inline-listings.ts` — поиск попуток для inline. Пустой query → меню (этап 1), не реферал.

---

## Этап 1. Inline-меню при `@бот` (P1)

**P1 · ~2ч · backend + тексты**

- [x] Пустой query → карточки: запросити друга, попутки сьогодні, допомога, забронювати
- [x] Тексты українською
- [x] Известный префикс → узкий handler, не меню

---

## Этап 2. Inline-поиск попуток (P1)

**P1 · ~6ч · backend**

- [x] Префиксы `rides` / `rides_today`, эвристики даты и маршрута
- [x] `answerInlineQuery`: до 20 `article` с маршрутом, датой, ссылкой `book_viber_{id}`
- [x] Фильтр: активные `ViberListing`, дата ≥ сегодня
- [x] Кнопка в `/allrides`: `switch_inline_query_current_chat: rides_today`
- [x] `searchListingsForInline` в `inline-listings.ts`

---

## Этап 3. Шаринг своей поїздки (водій) (P2)

**P2 · ~3ч · backend**

- [x] После `adddriverride` — «Поділитися оголошенням» (`share_listing_{id}`)
- [x] `/mydriverrides` — кнопки поділитися для каждого оголошення
- [x] Inline result: текст + `book_viber_{id}`; только автор или админ

---

## Этап 4. switch_pm и возврат из PM (P2)

**P2 · ~4ч · backend**

- [x] `InlineQueryResultsButton` + `start=setup_phone` для inline `setup_phone`
- [x] После setup_phone — кнопка «Попутки в цей чат» (`rides_today`)
- [x] Contact-flow водія/пасажира не изменён

---

## Этап 5. Аналитика и качество (P2)

**P2 · ~2ч · backend + опционально BotFather**

- [x] `/setinlinefeedback` в BotFather — Enable, **100%** (достатньо для 10–700 юзерів; логи `inline_chosen`)
- [x] Обработчик `chosen_inline_result` → лог `inline_chosen`
- [x] Лог latency в `logInlineQueryHandled`

**Не включено:** `/setinlinegeo`

---

## Этап 6. UX в клиенте Telegram (P1 · в основном тексты)

**P1 · ~1ч · копирайт**

- [x] Синхронизировать placeholder BotFather → **`Попутки, акція, бронювання…`** (`/setinline`, 1 минута вручную; user-guide §9)
- [x] В `/help` блок «У групі (inline)»
- [x] В `buildReferralHelpSection`: кнопка або `@бот ref_share`

---

## Что inline **не** должен делать

- Модерация фото, выплаты, админ-команды — только PM или админка
- Полная замена `/allrides` с фильтрами по времени
- Inline keyboard callbacks ≠ inline mode

---

## Приоритет внедрения (выполнено)

| Порядок | Этап | Статус |
|--------|------|--------|
| 1 | 0 | ✅ |
| 2 | 1 | ✅ |
| 3 | 2 | ✅ |
| 4 | 6 | ✅ (кроме BotFather placeholder — вручную) |
| 5 | 3–5 | ✅ (setinlinefeedback — вручную) |

---

## Связанные документы

- `Docs/telegram-bot-user-guide.md` — інструкція для людей і сайту
- `Docs/referral-program-fix-plan.md` — реферал
- `Docs/На будущее.md` — даты/таймзона Kyiv (улучшение фильтра дат)
