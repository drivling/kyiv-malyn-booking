-- «Доведе» · синоніми з адмінки: як люди називають місце → id місця (Docs/dovede-roadmap.md). Без деплою.
CREATE TABLE "DovedeSynonym" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phrase" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,

    CONSTRAINT "DovedeSynonym_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DovedeSynonym_phrase_key" ON "DovedeSynonym"("phrase");
