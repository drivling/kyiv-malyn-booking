-- «Доведе» · дорога містом: архів одного місця. Власник прибирає місце, для якого Google показує не те:
-- збережені дороги цього місця йдуть в архів, а нові питання про нього до Google не доходять (сторінка дає
-- кнопку карти). Рядок лишається назавжди: повернення з архіву ставить "archivedAt" = NULL.
CREATE TABLE "DovedeCityPlace" (
  "id" SERIAL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cityCode" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "DovedeCityPlace_key" ON "DovedeCityPlace"("cityCode", "key");
