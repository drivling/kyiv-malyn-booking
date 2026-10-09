# 🚂 Швидкий старт: Деплой на Railway

## Крок за кроком

### 1. Підготовка GitHub репозиторію

```bash
# Переконайтеся, що все закомічено
git status
git add .
git commit -m "Prepare for Railway deployment"
git push origin main
```

### 2. Створення проекту на Railway

1. Перейдіть на https://railway.app
2. Увійдіть через GitHub
3. Натисніть **"New Project"**
4. Оберіть **"Deploy from GitHub repo"**
5. Виберіть ваш репозиторій `kyiv-malyn-booking`

### 3. Додавання PostgreSQL

1. У проекті натисніть **"+ New"**
2. Оберіть **"Database"** → **"Add PostgreSQL"**
3. Зачекайте поки база створиться
4. Відкрийте базу → **"Variables"** → скопіюйте `DATABASE_URL`

### 4. Налаштування Backend

1. У проекті натисніть **"+ New"** → **"GitHub Repo"**
2. Виберіть той самий репозиторій
3. Відкрийте налаштування сервісу (три крапки → Settings)
4. Встановіть:
   - **Name:** `backend`
   - **Root Directory:** `backend`
   - **Start Command:** `npm start`

#### Змінні оточення для Backend:

Відкрийте **"Variables"** та додайте:

```
DATABASE_URL=<вставте скопійований DATABASE_URL>
ADMIN_PASSWORD=ваш_безпечний_пароль_тут
NODE_ENV=production

# Telegram Bot (опціонально, але рекомендовано)
TELEGRAM_BOT_TOKEN=ваш_токен_від_BotFather
TELEGRAM_ADMIN_CHAT_ID=ваш_chat_id
```

**Важливо:** 
- Замініть `ваш_безпечний_пароль_тут` на реальний пароль!
- Для налаштування Telegram Bot дивіться **TELEGRAM_BOT_SETUP.md**

### 5. Налаштування Frontend

1. У проекті натисніть **"+ New"** → **"GitHub Repo"**
2. Виберіть той самий репозиторій
3. Відкрийте налаштування сервісу
4. Встановіть:
   - **Name:** `frontend`
   - **Root Directory:** `frontend`
   - **Start Command:** `npm start`

#### Змінні оточення для Frontend:

**Спочатку зачекайте поки backend задеплоїться**, потім:

1. Відкрийте backend сервіс → **"Settings"** → **"Networking"**
2. Скопіюйте URL (наприклад: `https://backend-production-xxxx.up.railway.app`)
3. Відкрийте frontend → **"Variables"** → додайте:

```
VITE_API_URL=https://ваш-backend-url.railway.app
```

**Важливо:** Замініть `ваш-backend-url` на реальний URL з кроку 2!

### 6. Генерація доменів

#### Backend:
1. Відкрийте backend сервіс
2. **"Settings"** → **"Networking"**
3. Натисніть **"Generate Domain"**
4. Скопіюйте домен

#### Frontend:
1. Відкрийте frontend сервіс
2. **"Settings"** → **"Networking"**
3. Натисніть **"Generate Domain"**
4. Скопіюйте домен

### 7. Оновлення VITE_API_URL

Після отримання backend домену:

1. Відкрийте frontend → **"Variables"**
2. Додайте або оновіть (без слеша в кінці):
   ```
   VITE_API_URL=https://kyiv-malyn-booking-production.up.railway.app
   ```
   Якщо ваш backend має інший домен — підставте його.
3. Railway автоматично перезапустить frontend. Деталі: **PRODUCTION.md**

### 8. Перевірка деплою

1. Відкрийте frontend: **https://malin.kiev.ua** (або ваш frontend домен Railway)
2. Перевірте, що форма бронювання працює та API відповідає (бекенд: `kyiv-malyn-booking-production.up.railway.app`)
3. Спробуйте зайти в адмін панель (пароль з `ADMIN_PASSWORD`)

### 9. Нагадування в Telegram (cron)

Щоб клієнти автоматично отримували нагадування **за день до поїздки** та **в день поїздки**, потрібно налаштувати зовнішній cron (Railway не має вбудованого cron).

**Покрокова інструкція:** дивіться **[RAILWAY_CRON_REMINDERS.md](./RAILWAY_CRON_REMINDERS.md)** — там описано, як додати два cronjob’и (наприклад на cron-job.org) з правильним URL backend та заголовком `Authorization: <ADMIN_TOKEN>` (токен з `POST /admin/login`).

---

## ✅ Чеклист

- [ ] PostgreSQL база створена
- [ ] Backend сервіс створений з правильним Root Directory
- [ ] `DATABASE_URL` додано в backend змінні
- [ ] `ADMIN_PASSWORD` додано в backend змінні
- [ ] Frontend сервіс створений з правильним Root Directory
- [ ] `VITE_API_URL` додано в frontend змінні (після деплою backend)
- [ ] Домени згенеровані для обох сервісів
- [ ] `VITE_API_URL` оновлено на production домен
- [ ] Сайт працює та доступний
- [ ] (Опціонально) Налаштовано cron для Telegram-нагадувань — [RAILWAY_CRON_REMINDERS.md](./RAILWAY_CRON_REMINDERS.md)

## 🔍 Перевірка логів

Якщо щось не працює:

1. Відкрийте сервіс в Railway
2. Перейдіть в **"Deployments"**
3. Відкрийте останній deployment
4. Натисніть **"View Logs"**
5. Перевірте помилки

## 🎉 Готово!

Ваш проект тепер задеплоєний і автоматично оновлюватиметься при кожному push в GitHub!

---

**Підказка:** Railway надає безкоштовний кредит $5 на старті, достатньо для тестування.
