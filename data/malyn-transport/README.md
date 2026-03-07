# Розклад руху громадського транспорту міста Малина

Дані з порталу відкритих даних України [data.gov.ua](https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36).

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
