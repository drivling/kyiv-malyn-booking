# «Джура» · фаза 0 — читання обраних чатів у базу

Python-частина персонального секретаря. Живе **всередині процесу `lunch.listener`**
(одна Telethon-сесія на акаунт — друга паралельна сесія з того ж `.session` не працює).
Roadmap і принципи: `Docs/dzhura-roadmap.md`. Ручний чекліст: `Docs/dzhura-phase-0-smoke.md`.

## Що робить

- `capture.py` — обробники Telethon (`NewMessage`, `MessageEdited`, `Raw(UpdateMessageReactions)`,
  `MessageDeleted`) → `asyncio.Queue` → один writer пише в `DzhuraChat/Person/Message/Reaction`.
  Для чатів із `relayToSaved` ставить HTML-дубль у чергу `LunchOutboundMessage` (`target='saved'`),
  який `outbound_loop` слухача надсилає в «Обране» власника (`send_message('me', …)`).
- `jobs.py` — `sync_dialogs` (список груп/супергруп/особистих із `iter_dialogs`, канали й боти
  пропускаються), `gap_fill` після старту (по `lastCapturedTgMessageId`), `backfill` за період дат
  (доби Києва) із прогресом у `DzhuraJob`.
- `relay.py` — чисте форматування (без telethon/asyncpg), покрите `test_relay.py`.
- `db.py` — asyncpg на спільному пулі `LunchDB`; усі datetime — naive UTC; JSONB через `json.dumps`.

Конфіг чатів (галочки «Читати» / «В Обране») — у таблиці `DzhuraChat`, редагується в адмінці
`/admin/dzhura`; слухач перечитує його кожні 5 с.

## Гарантії

- Ніколи не викликаємо `send_read_acknowledge` / `mark_read`: у колег не з'являється «прочитано».
- Ніколи не викликаємо `SetTypingRequest` / `UpdateStatusRequest`.
- Нічого не пишемо у захоплені чати; єдиний вихід у Telegram — черга `LunchOutboundMessage`.
- Власні вихідні повідомлення зберігаються, але в «Обране» не дублюються; Saved Messages
  (`chat_id == me.id`) не читаються взагалі.

## Змінні середовища

| Змінна | Опис |
|--------|------|
| `DZHURA_ENABLED` | `1` (default) — підключати Джуру до слухача; `0` — лунч працює як раніше |

Решта — ті самі, що в `lunch/README.md` (`DATABASE_URL`, `TELEGRAM_API_ID/HASH`, сесія).

## Тести (без мережі)

```bash
cd backend/telegram-user
python3 -m dzhura.test_relay
python3 -m py_compile dzhura/*.py
```

## Логи

`[dzhura] attached me=… lunch_group=…`, `[dzhura] watching N chat(s): …`, `[dzhura] dialogs synced: …`,
`[dzhura] job backfill id=… params=…`, `[lunch] outbound sent id=… target=saved`.
