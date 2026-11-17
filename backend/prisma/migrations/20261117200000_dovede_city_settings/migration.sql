-- «Доведе» · дорога містом: строк свіжості збереженої відповіді редагується з адмінки (singleton id = 1).
-- Рядка немає — діє типове значення з коду (30 днів).
CREATE TABLE "DovedeCitySettings" (
  "id" INTEGER PRIMARY KEY,
  "freshDays" INTEGER NOT NULL DEFAULT 30,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Фонове навчання оновлює застарілі відповіді; рядок, який оновити не вдалося, тиждень не чіпає.
ALTER TABLE "DovedeCityRoute" ADD COLUMN "refreshFailedAt" TIMESTAMP(3);

-- Пару з попиту, про яку навчання питало Google без успіху, воно теж тиждень не чіпає (досі питало щогодини).
ALTER TABLE "DovedeCityDemand" ADD COLUMN "learnFailedAt" TIMESTAMP(3);
