-- «Доведе» · звіт якості навчання (Docs/dovede-admin-roadmap.md, крок 8): місце, яке власник переглянув і визнав
-- нормальним (більше не показується серед підозрілих), назви з відповіді, які обхід відкинув як сміття, і причина
-- останнього сповіщення кампанії в адмін-чат (щоб не писати про ту саму відмову Google щопівгодини).
ALTER TABLE "DovedeCityPlace" ADD COLUMN "okAt" TIMESTAMP(3);
ALTER TABLE "DovedeCityCampaignAsk" ADD COLUMN "filtered" JSONB;
ALTER TABLE "DovedeCityCampaign" ADD COLUMN "alertedReason" TEXT;
