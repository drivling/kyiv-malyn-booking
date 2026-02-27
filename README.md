# 🚌 Система бронювання маршрутки Київ ↔ Малин

Система бронювання місць у маршрутці між Києвом та Малином з можливістю управління графіками та бронюваннями.

## 🛠 Технології

### Backend
- Node.js + Express
- TypeScript
- Prisma ORM
- PostgreSQL

### Frontend
- React 18
- TypeScript
- Vite
- React Router

## 📋 Функціональність

- ✅ Бронювання місць на маршрутці
- ✅ Управління графіками рейсів
- ✅ Перевірка доступності місць
- ✅ Автоматичне заповнення даних клієнта по телефону
- ✅ Адмін панель з авторизацією
- ✅ 4 маршрути: через Ірпінь та Бучу (в обидва боки)

## 📊 Аналітика ViberRide / поведінки клієнтів

Цей блок описує, як працює аналітика історичних поїздок з Viber-групи, щоб було легко змінювати алгоритми або схему БД.

### 1. Структура БД для аналітики

У backend Prisma-схемі (`backend/prisma/schema.prisma`) є таблиця `ViberRideEvent`:

- `viberRideId` — первинний ключ із історичної таблиці `ViberRide` (окремий сервіс `viberparser`)
- `contactPhone` — сирий телефон з повідомлення
- `phoneNormalized` — нормалізований телефон (380XXXXXXXXX), використовується для звʼязку з `Person`
- `personId` — посилання на запис у таблиці `Person` (може бути `null`)
- `route` — напрямок (`Kyiv-Malyn`, `Malyn-Kyiv`, тощо)
- `departureDate` — дата поїздки
- `departureTime` — час / інтервал відправлення (наприклад, `18:00` або `18:00-18:30`)
- `availableSeats` — кількість вільних/потрібних місць
- `priceUah` — ціна в гривнях (якщо є)
- `isParsed` — чи вдалося коректно розпарсити повідомлення
- `isActive` — чи вважалась поїздка активною в `ViberRide` (може бути `null`)
- `parsingErrors` — текст помилки парсингу (якщо була)
- `weekday` — день тижня (0–6) за датою поїздки
- `hour` — година відправлення (0–23), початок інтервалу, якщо був діапазон

> ⚠️ Якщо змінюєте цю модель, не забудьте оновити міграції Prisma та логіку імпорту / аналітики в `backend/src/index.ts`.

### 2. Імпорт історичних даних з `ViberRide`

У backend (`backend/src/index.ts`) є адмін-ендпоінт:

- **`POST /admin/viber-analytics/import`**
  - Доступний тільки для авторизованого адміна (через `requireAdmin`)
  - Читає всі записи з таблиці `ViberRide` (через сирий SQL `SELECT ... FROM "ViberRide"` у спільній БД)
  - Пропускає ті, що вже були імпортовані (по `viberRideId`)
  - Нормалізує телефон через `normalizePhone` і намагається привʼязати до `Person` (`personId`)
  - Рахує `weekday` та `hour` для подальшої аналітики
  - Пакетно вставляє нові рядки в `ViberRideEvent` (`createMany` з `skipDuplicates`)

Що повертає:

- `success` — `true/false`
- `totalSource` — скільки всього рядків у `ViberRide`
- `alreadyImported` — скільки з них вже були в `ViberRideEvent`
- `importedNow` — скільки нових рядків додано за цей виклик
- `message` — текстове пояснення (може бути відсутнім)

**Де змінювати логіку імпорту:**  
Шукати блок коду з коментарем:

- `// Історичні дані з окремої таблиці "ViberRide" (сервіс парсингу Viber чату) → аналітична таблиця ViberRideEvent.`

у файлі `backend/src/index.ts`.

### 3. Аналіз поведінки клієнтів

Там же в `backend/src/index.ts` є ендпоінт:

- **`GET /admin/viber-analytics/summary?limit=&minRides=`**

Що робить зараз:

- вибирає телефони з `ViberRideEvent` з мінімальною кількістю поїздок (`minRides`, за замовчуванням ≥3)
- будує TOP клієнтів за кількістю поїздок (до `limit`, за замовчуванням 20)
- для кожного клієнта рахує:
  - загальну кількість поїздок (`totalRides`)
  - першу та останню поїздку (`firstRideDate`, `lastRideDate`)
  - статистику по маршрутах (топ-3, із часткою `share`)
  - розподіл по днях тижня (`weekdayStats`)
  - розподіл по часу доби (`timeOfDayStats`: ранок/день/вечір/ніч)
  - короткий текстовий опис патернів (`behaviorSummary`)
  - масив технічних рекомендацій (`recommendations`) — ідеї «що можна робити з даними» (легко змінити/видалити)

**Тип відповіді:** використовується TypeScript-інтерфейс `ViberClientBehavior` у `frontend/src/types/index.ts`.

**Де змінювати алгоритм аналізу:**  
Блок коду з коментарем:

- `// Аналітика поведінки клієнтів на основі ViberRideEvent.`

у файлі `backend/src/index.ts`.

Тут можна:

- поміняти пороги (`minRides`, інші коефіцієнти)
- змінити формулу для `ridesPerWeek`
- перерахувати патерни (будні / вихідні, час доби, тощо)
- змінити текст `behaviorSummary` і `recommendations`

### 4. Інтерфейс в адмінці (Frontend)

На вкладці **📢 «Реклама»** адмінки (`frontend/src/pages/AdminPage/AdminPage.tsx`) додано блок:

- **Кнопка 1:** `Імпортувати нові ViberRide в аналітику`
  - Викликає `apiClient.importViberAnalytics()` → `POST /admin/viber-analytics/import`
  - Показує `Alert` з кількістю імпортованих записів

- **Кнопка 2:** `Показати 10–20 клієнтів з патернами`
  - Викликає `apiClient.getViberAnalyticsSummary({ limit: 20, minRides: 3 })`
  - Виводить таблицю з 10–20 клієнтами:
    - телефон, імʼя
    - кількість поїздок
    - період (перша/остання поїздка)
    - основні маршрути
    - короткий опис поведінки
    - технічні варіанти «що робити з даними» (щоб планувати далі)

**Де змінювати фронтенд:**

- Типи: `frontend/src/types/index.ts` → `ViberClientBehavior`
- API-клієнт: `frontend/src/api/client.ts`:
  - `importViberAnalytics()`
  - `getViberAnalyticsSummary(...)`
- UI: `frontend/src/pages/AdminPage/AdminPage.tsx`:
  - блок під заголовком `Аналітика історичних ViberRide`

### 5. Як оновлювати / розширювати аналітику

1. **Змінити схему аналітики:**
   - Редагувати `ViberRideEvent` у `backend/prisma/schema.prisma`
   - Запустити Prisma-міграцію локально / на проді

2. **Оновити імпорт з `ViberRide`:**
   - Додати / змінити поля в мапінгу в `POST /admin/viber-analytics/import`

3. **Оновити алгоритм аналізу клієнтів:**
   - Внести зміни в `GET /admin/viber-analytics/summary`
   - За потреби оновити `ViberClientBehavior` і рендер у адмінці

4. **Тестування:**
   - Локально викликати:
     - `POST /admin/viber-analytics/import`
     - `GET /admin/viber-analytics/summary?limit=20&minRides=3`
   - Перевірити вкладку **📢 «Реклама»** в адмінці.

## 🚀 Деплой на Railway

### Передумови

1. Аккаунт на [Railway](https://railway.app)
2. GitHub репозиторій з кодом
3. Railway CLI (опціонально)

### Крок 1: Підготовка репозиторію

Переконайтеся, що всі файли закомічені та запушені в GitHub:

```bash
git add .
git commit -m "Prepare for Railway deployment"
git push origin main
```

### Крок 2: Створення проекту на Railway

1. Перейдіть на [railway.app](https://railway.app)
2. Натисніть **"New Project"**
3. Оберіть **"Deploy from GitHub repo"**
4. Виберіть ваш репозиторій
5. Railway автоматично визначить структуру проекту

### Крок 3: Додавання PostgreSQL бази даних

1. У проекті натисніть **"+ New"**
2. Оберіть **"Database"** → **"Add PostgreSQL"**
3. Railway автоматично створить базу даних
4. Скопіюйте `DATABASE_URL` з вкладки **"Variables"**

### Крок 4: Налаштування Backend сервісу

1. У проекті натисніть **"+ New"** → **"GitHub Repo"**
2. Оберіть той самий репозиторій
3. Railway визначить це як окремий сервіс
4. Відкрийте налаштування сервісу
5. Встановіть **Root Directory:** `backend`
6. Встановіть **Start Command:** `npm start`

#### Змінні оточення для Backend:

Додайте в **"Variables"**:

```
DATABASE_URL=<скопійований DATABASE_URL з PostgreSQL>
ADMIN_PASSWORD=ваш_безпечний_пароль
PORT=3000
NODE_ENV=production
```

### Крок 5: Налаштування Frontend сервісу

1. У проекті натисніть **"+ New"** → **"GitHub Repo"**
2. Оберіть той самий репозиторій
3. Відкрийте налаштування сервісу
4. Встановіть **Root Directory:** `frontend`
5. Встановіть **Start Command:** `npm start`

#### Змінні оточення для Frontend:

Додайте в **"Variables"**:

```
VITE_API_URL=https://ваш-backend-url.railway.app
PORT=5173
```

**Важливо:** Замініть `ваш-backend-url` на реальний URL вашого backend сервісу (Railway надасть його після деплою).

### Крок 6: Запуск міграцій бази даних

Після першого деплою backend, міграції запустяться автоматично завдяки скрипту `postinstall` та `build`.

Якщо потрібно запустити вручну:

1. Відкрийте backend сервіс
2. Перейдіть в **"Deployments"**
3. Відкрийте останній deployment
4. Натисніть **"View Logs"**
5. Перевірте, що міграції виконані успішно

Або через Railway CLI:

```bash
railway run --service backend npm run prisma:migrate:deploy
```

### Крок 7: Налаштування доменів (опціонально)

1. Відкрийте frontend сервіс
2. Перейдіть в **"Settings"** → **"Networking"**
3. Натисніть **"Generate Domain"** для отримання Railway домену
4. Або додайте свій кастомний домен

Повторіть для backend сервісу.

### Крок 8: Оновлення змінних оточення

Після отримання доменів, оновіть `VITE_API_URL` у frontend:

```
VITE_API_URL=https://ваш-backend-домен.railway.app
```

Railway автоматично перезапустить frontend з новими змінними.

## 🔄 Автоматичний деплой

Railway автоматично деплоїть ваш проект при кожному push в GitHub:

1. Push в `main` або `master` гілку
2. Railway автоматично виявляє зміни
3. Запускає build процес
4. Деплоїть нову версію

### Build процес:

**Backend:**
1. `npm install`
2. `npm run build` (генерує Prisma Client + компілює TypeScript)
3. `npm run prisma:migrate:deploy` (застосовує міграції)
4. `npm start` (запускає сервер)

**Frontend:**
1. `npm install`
2. `npm run build` (збирає production build)
3. `npm start` (запускає preview сервер)

## 🔐 Безпека

- Пароль адміна зберігається в змінних оточення
- Не комітьте `.env` файли в Git
- Використовуйте сильні паролі для `ADMIN_PASSWORD`
- Railway автоматично надає HTTPS сертифікати

## 📊 Моніторинг

Railway надає:
- Логи в реальному часі
- Метрики використання ресурсів
- Історію деплоїв
- Статус сервісів

## 💰 Вартість

- **Hobby план:** $5/місяць (500 годин)
- **Pay-as-you-go:** ~$8-15/місяць для малого трафіку
- Безкоштовний кредит $5 на старті

## 🐛 Troubleshooting

### Проблема: Міграції не запускаються

**Рішення:**
1. Перевірте `DATABASE_URL` в змінних оточення
2. Запустіть міграції вручну через CLI:
   ```bash
   railway run --service backend npm run prisma:migrate:deploy
   ```

### Проблема: Frontend не може підключитися до Backend

**Рішення:**
1. Перевірте `VITE_API_URL` в frontend змінних
2. Переконайтеся, що backend запущений
3. Перевірте CORS налаштування в backend

### Проблема: Build падає

**Рішення:**
1. Перевірте логи в Railway Dashboard
2. Переконайтеся, що всі залежності в `package.json`
3. Перевірте TypeScript помилки локально перед push

## 📝 Структура проекту

```
kyiv-malyn-booking/
├── backend/          # Backend сервіс
│   ├── src/         # TypeScript код
│   ├── prisma/      # Prisma схема та міграції
│   └── railway.json # Railway конфігурація
├── frontend/        # Frontend сервіс
│   ├── src/         # React компоненти
│   └── railway.json # Railway конфігурація
└── README.md        # Цей файл
```

## 🔗 Корисні посилання

- [Railway Documentation](https://docs.railway.app)
- [Prisma Deployment Guide](https://www.prisma.io/docs/guides/deployment)
- [Vite Production Guide](https://vitejs.dev/guide/build.html)

## 📞 Підтримка

При виникненні проблем перевірте:
1. Логи в Railway Dashboard
2. Змінні оточення
3. Статус сервісів
4. Мережеві налаштування

---

**Готово!** 🎉 Ваш проект тепер автоматично деплоїться при кожному push в GitHub.
