# Локальний запуск і перевірка

Усе, що потрібно для повного циклу: БД у Docker, бекенд, фронтенд, обидва домени, тести.

## 1. Один раз

```bash
cp backend/.env.example backend/.env      # значення вже під локальну БД
cp frontend/.env.example frontend/.env
npm install --prefix backend
npm install --prefix frontend
npm run setup:local                        # підняти Postgres, міграції, build, seed транспорту
npx --prefix frontend playwright install chromium   # для npm run test:e2e
```

`npm run setup:local` = `db:up` → `prisma migrate deploy` → `backend build` → `seed:transport`.
Міграції самі створюють каталог міст (Київ, Малин, Житомир, Коростень, Ірпінь, Буча),
коридори TripRoute і вмикають `hasLocalTransport` Малину.

## 2. Щодня

```bash
npm run db:up          # якщо контейнер зупинено
npm run dev:backend    # http://localhost:3000
npm run dev:frontend   # http://localhost:5173
```

Адмінка: <http://localhost:5173/admin> → вкладка «Адмін» → пароль `admin123` (з `backend/.env`).

## 3. Два домени локально

`korosten.localhost` резолвиться в 127.0.0.1 у всіх сучасних браузерах — окремий домен для
Коростеня перевіряється без правок `/etc/hosts`:

| Що перевіряємо | Як |
|---|---|
| Сайт Малина | <http://localhost:5173/mizhgorodski> |
| Сайт Коростеня | <http://korosten.localhost:5173/mizhgorodski> — рідне місто пінниться доменом |
| Перехід між доменами | у «Рідне місто» вибрати Коростень → редирект на `korosten.localhost` з тим самим шляхом, кука `malin_home_city` записується на новому домені, `?city=` зникає з адреси |
| Заглушка транспорту | <http://korosten.localhost:5173/transport> → «Транспорт Коростеня — скоро» |
| Прапорець з адмінки | `/admin/routes` → «Редагувати» місто → галочка «Є локальний транспорт» → `/transport` відповідно стає планувальником або заглушкою |
| Редирект адмінки | <http://korosten.localhost:5173/admin> → `localhost:5173/admin` (у проді — на `malin.kiev.ua`) |
| Дебаг без другого домену | будь-яка сторінка з `?site=korosten` |

Серверна частина (301 і noindex) живе в `frontend/scripts/serve-dist.mjs` і перевіряється на зібраному фронті:

```bash
npm run build --prefix frontend
PORT=4173 node frontend/scripts/serve-dist.mjs
curl -I -H 'Host: korosten.kiev.ua' localhost:4173/admin        # 301 → https://malin.kiev.ua/admin
curl -s  -H 'Host: korosten.kiev.ua' localhost:4173/robots.txt  # Disallow: /
curl -I -H 'Host: korosten.kiev.ua' localhost:4173/mizhgorodski # X-Robots-Tag: noindex, nofollow
curl -I -H 'Host: malin.kiev.ua'    localhost:4173/mizhgorodski # без noindex
```

## 4. Перевірки перед комітом

```bash
npm test         # backend + frontend unit
npm run lint     # eslint (frontend, max-warnings 0)
npm run typecheck
npm run test:e2e # playwright, бекенд замокано (жива БД не потрібна)
```

Pre-commit хук (husky) запускає `npm test`.

## 5. БД

```bash
npm run db:psql    # psql у контейнері
npm run db:reset   # знести том і підняти чисту БД (далі npm run setup:local)
npm run db:down
```

Порт 5433 обрано, щоб не конфліктувати із системним Postgres. Дані — у Docker-томі
`kyiv-malyn-booking_kyiv_malyn_pgdata`.

## Примітки

- `backend/.env` читається через `dotenv` (`-r dotenv/config` у `dev` і `seed:transport`);
  Prisma CLI бачить його самостійно.
- Без `TELEGRAM_BOT_TOKEN` бот не стартує — це нормальний локальний режим.
- Флоу з Telegram-логіном локально не працює: віджет прив'язаний до домену `malin.kiev.ua`.
