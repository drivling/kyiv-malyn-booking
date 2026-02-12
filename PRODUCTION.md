# Production — malin.kiev.ua

## URL сервісів

| Сервіс   | URL |
|----------|-----|
| **Фронтенд** (сайт) | https://malin.kiev.ua |
| **Бекенд** (API)    | https://kyiv-malyn-booking-production.up.railway.app |

## Обов'язкові змінні Railway

### Frontend (Variables)

- **VITE_API_URL** = `https://kyiv-malyn-booking-production.up.railway.app` (без слеша в кінці)  
  Без цієї змінної фронт буде звертатися до `http://localhost:3000` і API не працюватиме.

### Backend (Variables)

- **DATABASE_URL** — з Railway PostgreSQL
- **ADMIN_PASSWORD** — пароль адмін-панелі
- **TELEGRAM_BOT_TOKEN**, **TELEGRAM_ADMIN_CHAT_ID** — за бажанням

## Перевірка

1. **Фронт:** https://malin.kiev.ua — форма бронювання, адмінка.
2. **Бекенд health:** https://kyiv-malyn-booking-production.up.railway.app/health — має бути JSON з `status`, `version`, `codeVersion`.
3. **Viber оголошення:** https://kyiv-malyn-booking-production.up.railway.app/viber-listings — має бути JSON (наприклад `[]`), не HTML.

## Root Directory (Railway)

- **Backend:** Root Directory = `backend`.
- **Frontend:** Root Directory = `frontend`.
