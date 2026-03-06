# Пошук за номером: OLX / AUTO.RIA / DOM.RIA

Міні-скрипт для **ручного** (або через Google `"номер" site:olx.ua`) пошуку: з оголошень витягується **хто** людина (ім'я/підпис продавця), а не **що** він продає.

## Встановлення

```bash
cd backend/internet-phone-search
pip install -r requirements.txt
```

## Запуск

```bash
# Текстовий вивід — тільки «хто» (або URL, якщо ім'я не вдалося витягти)
python run_internet_phone_search.py 380679551952

# Повний JSON (searchUrls, results з who + url)
python run_internet_phone_search.py 380679551952 --json

# Обмежити кількість оголошень з кожного сайту (менше запитів)
python run_internet_phone_search.py 380679551952 --max-listings 3 --json
```

## Що робить

1. Завантажує сторінки пошуку за номером: OLX, AUTO.RIA, DOM.RIA.
2. Парсить посилання на оголошення з цих сторінок.
3. Для кожного оголошення (з обмеженням `--max-listings`) завантажує сторінку і витягує **ім'я/підпис контакту** (продавець, контакт, агент) — тобто **хто**, а не назву оголошення.
4. Виводить унікальні «хто» або повний JSON з `source`, `who`, `url`.

Формат результату в JSON: `results[]` містить `{ "source": "olx"|"auto_ria"|"dom_ria", "who": "Ім'я" | null, "url": "..." }`.
