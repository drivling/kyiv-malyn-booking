-- «Доведе» · дорога містом: облік запитів до Google за київську добу — у базі, а не в памʼяті процесу.
-- Спільний для всіх контейнерів (під час деплою їх два) і для людей, фонового навчання й обходу; тут же пауза після
-- відмови Google (429 — квота, 401 / 403 — доступ) і остання відмова з її текстом. Рядки не видаляються.
CREATE TABLE "DovedeCityGoogleDay" (
  "day" TEXT PRIMARY KEY,
  "calls" INTEGER NOT NULL DEFAULT 0,
  "people" INTEGER NOT NULL DEFAULT 0,
  "learn" INTEGER NOT NULL DEFAULT 0,
  "refused" INTEGER NOT NULL DEFAULT 0,
  "blockedUntil" TIMESTAMP(3),
  "blockedReason" TEXT,
  "lastErrorStatus" INTEGER,
  "lastErrorMessage" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
