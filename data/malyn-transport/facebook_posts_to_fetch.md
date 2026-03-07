# Пости Facebook MalynCityCouncil для збереження

Збережіть ці сторінки після авторизації в Facebook. Потім покладіть HTML-файли в папку `data/malyn-transport/facebook_saved/` з іменами як в колонці «Файл».

## Як зберегти

1. Увійдіть у Facebook
2. Відкрийте кожне посилання
3. Ctrl+S (Cmd+S) → «Веб-сторінка, повністю» або «HTML only»
4. Збережіть у `data/malyn-transport/facebook_saved/` з ім'ям з колонки «Файл»

## Список постів

| Тема | URL | Файл |
|------|-----|------|
| Головна сторінка | https://www.facebook.com/MalynCityCouncil | malyn_council_main.html |
| Маршрут №9 — розклад | https://www.facebook.com/MalynCityCouncil/posts/pfbid02qhcxrGrrvt2yEgseziHE473xULZVkwytfKjV3HM3txSmZExboaju1MqkU4YRd45bl | post_route9_schedule.html |
| Маршрути №7, №8 — схема | https://www.facebook.com/MalynCityCouncil/posts/pfbid0nHjXXktKE9vDAtzAaxQ87vhFMn1RTQufdQ8FFproPAFc4uNAGA6iCDt5MFdHCd3wl | post_routes_7_8.html |
| Графік маршруток по Малину | https://www.facebook.com/MalynCityCouncil/posts/299392439040524 | post_schedule_malyn.html |
| Приміські маршрутки | https://www.facebook.com/MalynCityCouncil/posts/307060608273707 | post_suburban.html |

## Посилання (копіювати)

```
https://www.facebook.com/MalynCityCouncil
https://www.facebook.com/MalynCityCouncil/posts/pfbid02qhcxrGrrvt2yEgseziHE473xULZVkwytfKjV3HM3txSmZExboaju1MqkU4YRd45bl
https://www.facebook.com/MalynCityCouncil/posts/pfbid0nHjXXktKE9vDAtzAaxQ87vhFMn1RTQufdQ8FFproPAFc4uNAGA6iCDt5MFdHCd3wl
https://www.facebook.com/MalynCityCouncil/posts/299392439040524
https://www.facebook.com/MalynCityCouncil/posts/307060608273707
```

## Після збереження

```bash
pip install beautifulsoup4  # якщо ще немає
python scripts/parse_facebook_saved.py
```

Парсер створить `facebook_saved/parsed_facebook.json` з витягнутим текстом. Потім можна інтегрувати дані в supplement.
