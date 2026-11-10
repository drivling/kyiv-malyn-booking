# Знімок джерел — Коростень

Стан джерел на момент `fetchedAt` у `manifest.json` (там же адреси й sha256). Що це за джерела й під якою
ліцензією — [`../SOURCES.md`](../SOURCES.md).

| Файл | Звідки |
|---|---|
| `rada-timetable.html` | частина сторінки ради з таблицями розкладу (без шапки, меню, скриптів і атрибутів оформлення) |
| `timetable.json` | той самий розклад, розібраний `backend/src/korosten-source-parser.ts` |
| `agency.csv`, `routes.csv`, `stops.csv`, `trips.csv` | набори ради на data.gov.ua, як є |

Оновити знімок (по одному запиту на файл):

```bash
cd backend && npm run build && npm run korosten:snapshot
```

`-- --page <файл>` бере сторінку ради зі збереженого HTML, `-- --no-csv` не чіпає CSV. Тест
`backend/src/korosten-source-parser.test.ts` перевіряє парсер на `rada-timetable.html` і те, що `timetable.json`
йому відповідає, — після оновлення знімка поправити в тесті числа рейсів, якщо розклад змінився.

## Формат `timetable.json`

`routes[]`: `number` («2-Б»), `title`, `blocks` (скільки графіків-автобусів), `runs[]`, `breaks[]`, `starNote`,
`starWeekdaysOnly`, `italicNote`. Рейс: `block` (графік 1 / 2), `from`, `to`, `via[]`, `departure`, `arrival`
(HH:MM), `starred`, `italic`, `note` (примітка в дужках), `days` (`weekdays` — зірочка з приміткою «не
виконуються в суботу та неділю»).
