# 🚀 Швидкий старт Viber Parser

## 📦 Встановлення

```bash
cd viberparser

# 1. Встановити залежності
npm install

# 2. Створити .env файл
cp .env.example .env

# 3. Змінити DATABASE_URL в .env
nano .env
```

## 🧪 Тестування парсера (без БД)

```bash
# Скомпілювати і запустити тест
npm run test-parser
```

Це запустить тестовий скрипт який перевірить всі функції парсера.

## 🗄️ Налаштування бази даних

```bash
# Створити таблиці в БД
npm run prisma:migrate

# Або якщо БД вже є
npm run prisma:migrate:deploy
```

## 🏃 Запуск сервера

```bash
# Development режим
npm run dev

# Production режим
npm run build
npm start
```

Сервер запуститься на `http://localhost:3001`

## 📥 Тестування імпорту

### Варіант 1: Через curl з файлом

```bash
# Використати приклад файл
curl -X POST http://localhost:3001/api/import \
  -H "Content-Type: text/plain" \
  --data-binary @example-import.txt
```

### Варіант 2: Через curl з текстом

```bash
curl -X POST http://localhost:3001/api/import \
  -H "Content-Type: application/json" \
  -d '{
    "messages": "[ 9 лютого 2026 р. 12:55 ] ⁨Іван⁩: Київ-Малин завтра о 8:00, є 3 місця, 0501234567"
  }'
```

### Варіант 3: Через Postman/Insomnia

1. POST `http://localhost:3001/api/import`
2. Body → raw → Text
3. Вставте експортований текст
4. Send

## 📊 Перегляд результатів

### Отримати всі поїздки

```bash
curl http://localhost:3001/api/rides
```

### Отримати тільки активні

```bash
curl "http://localhost:3001/api/rides?active=true&parsed=true&limit=20"
```

### Статистика

```bash
curl http://localhost:3001/api/stats
```

### Деактивувати старі (старіші за 7 днів)

```bash
curl -X POST http://localhost:3001/api/deactivate-old \
  -H "Content-Type: application/json" \
  -d '{"days": 7}'
```

## 📱 Експорт чату з Viber

### Android/iOS:
1. Відкрити групу
2. Натиснути на назву групи
3. "Експортувати чат" / "Export chat"
4. Вибрати "Без медіа" / "Without media"

### Desktop:
1. Відкрити групу
2. Меню → "Експортувати чат"
3. Зберегти як .txt

## 🔄 Повний процес

```bash
# 1. Експортувати чат з Viber → viber_export.txt

# 2. Імпортувати
curl -X POST http://localhost:3001/api/import \
  -H "Content-Type: text/plain" \
  --data-binary @viber_export.txt

# 3. Перевірити результати
curl http://localhost:3001/api/rides | jq

# 4. Переглянути статистику
curl http://localhost:3001/api/stats | jq
```

## 🐛 Troubleshooting

### База даних не підключається
```bash
# Перевірте DATABASE_URL в .env
echo $DATABASE_URL

# Перевірте чи працює PostgreSQL
psql $DATABASE_URL -c "SELECT 1;"
```

### Парсер не розпізнає повідомлення
```bash
# Запустіть тест
npm run test-parser

# Перевірте формат експорту - має бути:
# [ дата ] ⁨Ім'я⁩: текст
```

### Помилка при імпорті
```bash
# Перевірте чи таблиці створені
npm run prisma:migrate

# Перевірте формат даних
head -5 viber_export.txt
```

## 📝 Корисні команди

```bash
# Переглянути логи (якщо запущено через npm run dev)
# Логи виводяться в консоль

# Очистити базу
psql $DATABASE_URL -c "TRUNCATE TABLE \"ViberRide\" CASCADE;"

# Переглянути кількість записів
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"ViberRide\";"

# Переглянути останні 5 записів
psql $DATABASE_URL -c "SELECT * FROM \"ViberRide\" ORDER BY \"createdAt\" DESC LIMIT 5;"
```

## 🚀 Деплой на Railway

1. Push код на GitHub
2. В Railway: New → Deploy from GitHub repo
3. Вибрати репозиторій
4. Root Directory: `viberparser`
5. Додати змінні:
   - `DATABASE_URL` (з Railway PostgreSQL)
   - `PORT` (автоматично)
6. Deploy!

Після деплою отримаєте URL типу:
`https://viberparser-production.up.railway.app`

Тестуйте:
```bash
curl https://your-url.railway.app/health
```
