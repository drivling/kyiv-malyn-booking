# Розклад руху громадського транспорту міста Малина

Дані з порталу відкритих даних України [data.gov.ua](https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36).

## Production source of truth

**PostgreSQL** (`TransportStop`, `TransportRoute`, `TransportRouteStop`, `TransportTrip`, `TransportSegment`, `TransportMeta`).

- Site / admin: `GET` / `PUT` `/transport/dataset`
- Public page: `/transport`
- Seed from archive JSON (one-time / reset):

```bash
cd backend && npm run seed:transport
```

## Archive runtime JSON

Kept in the repo as seed / backup / OSRM input:

```
data/malyn-transport/runtime/
  malyn_transport.json
  stops_coords.json
  segmentDurations.json
  agency.json
```

Admin Map Editor edits in memory and saves to the database (no file download).

Roadmap of the DB migration: `Docs/local-transport-db-refactoring-plan.md`.
Result: `Docs/local-transport-db-refactoring-result.md`.

## GTFS export

```bash
cd backend && npm run export:gtfs
```

Details: `Docs/local-transport-gtfs-feed.md`. Zip: `data/malyn-transport/gtfs/malyn-gtfs.zip`.

## OSRM segment recalculation (backlog)

`scripts/calculate_segment_durations.js` still writes `runtime/segmentDurations.json`.
After recalculation, re-seed the DB (`npm run seed:transport`) or push segments via admin PUT.

## Парсинг та спільний файл

```bash
python scripts/parse_malyn_transport.py
```

Створює:
- **malyn_transport_unified.json** — повні дані з метаданими та stats
- **malyn_transport_unified.csv** — для аналізу в Excel/Pandas

## Як завантажити

### Автоматично (скрипт)

```bash
pip install requests
python scripts/download_malyn_transport.py
```

### Вручну

1. Відкрийте: https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36
2. У розділі **«Дані та ресурси»** натисніть **«Завантажити»** біля файлу (зазвичай `Перелік рейсів.xlsx`)
3. Збережіть файл у цю папку: `data/malyn-transport/`

## Контакт

За питаннями оновлення: Олексюк Алла Миколаївна — ekonomika.malin@ukr.net

Оновлення: щокварталу (останнє — червень 2024).
