-- «Доведе» · налаштування, які власник міняє в адмінці (розділ «Налаштування»): ключ → значення (JSON).
-- NULL / немає рядка — типове (змінна середовища на Railway або значення з коду). Перелік ключів —
-- backend/src/dovede/settings.ts. Рядки не видаляються: «скинути до типового» ставить NULL.
CREATE TABLE "DovedeSetting" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Те, що вже задано в блоці «Місто: що вже знаємо», переходить сюди (стара таблиця лишається, але більше не читається)
INSERT INTO "DovedeSetting" ("key", "value", "updatedAt")
SELECT 'city.freshDays', to_jsonb("freshDays"), "updatedAt" FROM "DovedeCitySettings" WHERE "id" = 1 AND "freshDays" <> 30;
INSERT INTO "DovedeSetting" ("key", "value", "updatedAt")
SELECT 'city.dailyCap', to_jsonb("dailyCap"), "updatedAt" FROM "DovedeCitySettings" WHERE "id" = 1 AND "dailyCap" IS NOT NULL;
