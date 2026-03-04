# Пошук по інтернету за номером телефону (OLX, AUTO.RIA, DOM.RIA)

Модуль завантажує сторінки пошуку за номером з OLX, AUTO.RIA, DOM.RIA, парсить оголошення і повертає JSON.

- **download_internet_phone_search.py** — завантажує HTML сторінок пошуку.
- **parse_internet_phone_search.py** — парсить HTML, витягує заголовки та посилання.
- **run_internet_phone_search.py** — повний цикл: завантажити → розпарсити → JSON.

Посилання на пошук у Google тільки формується (для ручного відкриття), автоматичних запитів до Google немає.

## Локально

```bash
cd backend/internet-phone-search
pip install -r requirements.txt
python3 run_internet_phone_search.py 380678341332
```

Вихід: JSON з полями `phone`, `searchUrls`, `hasData`, `results`.
