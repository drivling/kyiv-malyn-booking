# Розклад руху громадського транспорту міста Малина

Дані з порталу відкритих даних України [data.gov.ua](https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36).

## Canonical runtime (сайт + API)

Єдине джерело правди для продакшен-даних:

```
data/malyn-transport/runtime/
  malyn_transport.json
  stops_coords.json
  segmentDurations.json
```

Після правок (або після завантаження JSON з адмін-редактора карти) синхронізуйте копії для сайту та Android API:

```bash
node scripts/sync-localtransport-data.mjs
node scripts/sync-localtransport-data.mjs --check   # перевірка без копіювання
```

Цілі sync:

- `frontend/public/data/` — статичний сайт
- `backend/localtransport-data/` — `GET /localtransport/data`
- `frontend/src/pages/LocalTransportPage/segmentDurations.json` — бандл у JS

Дорожня карта GTFS: `Docs/local-transport-gtfs-refactoring-plan.md`.

## GTFS export

```bash
node scripts/export-malyn-gtfs.mjs
```

Деталі: `Docs/local-transport-gtfs-feed.md`. Архів: `data/malyn-transport/gtfs/malyn-gtfs.zip`.

## Парсинг та спільний файл

```bash
python scripts/parse_malyn_transport.py
```

Створює:
- **malyn_transport_unified.json** — повні дані з метаданими та stats
- **malyn_transport_unified.csv** — для аналізу в Excel/Pandas

Структура: GTFS-подібна (route_id, trip_id, trip_headsign, direction_id тощо).

## Як завантажити

### Автоматично (скрипт)

```bash
pip install requests  # якщо ще не встановлено
python scripts/download_malyn_transport.py
```

### Вручну

1. Відкрийте: https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36
2. У розділі **«Дані та ресурси»** натисніть **«Завантажити»** біля файлу (зазвичай `Перелік рейсів.xlsx`)
3. Збережіть файл у цю папку: `data/malyn-transport/`

## Вміст набору даних

- Суб'єкти господарювання (перевізники)
- Зупинки громадського транспорту
- Маршрути
- Рейси
- Графік відбуття та прибуття на зупинках

## Контакт

За питаннями оновлення: Олексюк Алла Миколаївна — ekonomika.malin@ukr.net

Оновлення: щокварталу (останнє — червень 2024).
