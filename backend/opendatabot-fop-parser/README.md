# Парсер сторінок Opendatabot (ФОП за телефоном)

Модуль для роботи зі сторінками:

- `https://opendatabot.ua/t/<phone>`

Є **два окремі скрипти**:

1. `download_opendatabot_phone_page.py` — **завантажує HTML** за телефоном та зберігає локально як `<phone>.html`.
2. `parse_opendatabot_phone_page.py` — **парсить локальний HTML-файл** і дістає з нього інформацію про ФОП.
3. `run_opendatabot_phone_lookup.py` — **повний флоу**: завантажити сторінку за телефоном та одразу її розпарсити.

---

## Що робить парсер

`parse_opendatabot_phone_page.py` працює **тільки з локальним HTML-файлом**, який ви зберегли зі сторінки типу:

- `https://opendatabot.ua/t/380938901865`

Скрипт витягує з HTML:

- кількість знайдених записів (`"Знайдено: N"`, якщо є),
- список ФОП у вигляді:

```json
{
  "found_count_declared": 1,
  "entries": [
    {
      "type": "ФОП",
      "name": "ФОП Боженко Яна Володимирівна"
    }
  ]
}
```

---

## Встановлення (локально)

```bash
cd backend/opendatabot-fop-parser
pip install -r requirements.txt
```

За потреби використовуйте `pip3` замість `pip`.

---

## Варіант 1. Автоматично завантажити HTML за телефоном

```bash
cd backend/opendatabot-fop-parser
python3 download_opendatabot_phone_page.py 380938901865
```

- Буде зроблено запит до `https://opendatabot.ua/t/380938901865`.
- HTML-сторінка збережеться у файл: `380938901865.html` у поточній директорії.

Можна вказати іншу директорію для збереження:

```bash
python3 download_opendatabot_phone_page.py 380938901865 --out-dir ./html-cache
```

---

## Варіант 2. Підготувати HTML-файл вручну

1. Відкрийте в браузері потрібну сторінку, наприклад:  
   `https://opendatabot.ua/t/380938901865`
2. Збережіть сторінку як HTML:
   - Меню браузера → **Save Page As… / Зберегти сторінку як…**
   - Формат: **Web page, HTML only / Лише HTML**
3. Покладіть файл поруч зі скриптом, наприклад:  
   `backend/opendatabot-fop-parser/380938901865.html`

---

## Запуск парсера локального HTML

```bash
cd backend/opendatabot-fop-parser
python3 parse_opendatabot_phone_page.py 380938901865.html --pretty
```

Аргументи:

- **`html_file`** – шлях до локального HTML-файлу.
- **`--pretty`** – вивести JSON з відступами (читабельний формат).

Без `--pretty` скрипт виведе компактний JSON в один рядок:

```bash
python3 parse_opendatabot_phone_page.py 380938901865.html
```

---

## Формат результату

Скрипт друкує в `stdout` JSON:

```json
{
  "found_count_declared": 1,
  "entries": [
    {
      "type": "ФОП",
      "name": "ФОП Боженко Яна Володимирівна"
    }
  ]
}
```

- **`found_count_declared`** – число з тексту `Знайдено: N` на сторінці (або `null`, якщо не знайдено).
- **`entries`** – масив об'єктів, які відповідають заголовкам виду `ФОП ...`.

Якщо структура HTML Opendatabot зміниться, можливо, доведеться трохи підкоригувати логіку пошуку заголовків у `parse_opendatabot_phone_page.py`.

---

## Повний флоу: завантажити + розпарсити за один крок

```bash
cd backend/opendatabot-fop-parser
python3 run_opendatabot_phone_lookup.py 380938901865
```

За замовчуванням скрипт виводить **простий текст** — скорочене ім'я першого знайденого ФОП:

```text
Меренкова Тетяна
```

або

```text
Боженко Яна
```

тобто без префікса `ФОП` і без по батькові.

Якщо ФОП не знайдено:

```text
ФОП не знайдено
```

---

### Вивести повний JSON замість тексту

```bash
cd backend/opendatabot-fop-parser
python3 run_opendatabot_phone_lookup.py 380938901865 --json
```

Або у читабельному вигляді:

```bash
python3 run_opendatabot_phone_lookup.py 380938901865 --json --pretty-json
```

Приклад JSON:

```json
{
  "phone": "380938901865",
  "html_file": "380938901865.html",
  "result": {
    "found_count_declared": 1,
    "entries": [
      {
        "type": "ФОП",
        "name": "ФОП Боженко Яна Володимирівна"
      }
    ]
  }
}
```


