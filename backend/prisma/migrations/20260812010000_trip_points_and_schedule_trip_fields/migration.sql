-- TripPoint catalog + Schedule trip fields

CREATE TABLE "TripPoint" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "nameUk" TEXT NOT NULL,
    "requiredOnTrip" BOOLEAN NOT NULL DEFAULT false,
    "appearInFromTo" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripPoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TripPoint_code_key" ON "TripPoint"("code");

INSERT INTO "TripPoint" ("code", "nameUk", "requiredOnTrip", "appearInFromTo", "sortOrder", "updatedAt") VALUES
  ('Kyiv', 'Київ', false, true, 10, CURRENT_TIMESTAMP),
  ('Malyn', 'Малин', true, true, 20, CURRENT_TIMESTAMP),
  ('Zhytomyr', 'Житомир', false, true, 30, CURRENT_TIMESTAMP),
  ('Korosten', 'Коростень', false, true, 40, CURRENT_TIMESTAMP),
  ('Irpin', 'Ірпінь', false, false, 50, CURRENT_TIMESTAMP),
  ('Bucha', 'Буча', false, false, 60, CURRENT_TIMESTAMP);

ALTER TABLE "Schedule" ADD COLUMN "startPointId" INTEGER;
ALTER TABLE "Schedule" ADD COLUMN "endPointId" INTEGER;
ALTER TABLE "Schedule" ADD COLUMN "viaPointIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Schedule" ADD COLUMN "vehicleType" TEXT NOT NULL DEFAULT 'marshrutka';
ALTER TABLE "Schedule" ADD COLUMN "boardingPlace" TEXT;
ALTER TABLE "Schedule" ADD COLUMN "alightingPlace" TEXT;
ALTER TABLE "Schedule" ADD COLUMN "tripNumber" TEXT;
ALTER TABLE "Schedule" ADD COLUMN "arrivalTime" TEXT;
ALTER TABLE "Schedule" ADD COLUMN "durationMinutes" INTEGER;
ALTER TABLE "Schedule" ADD COLUMN "ticketPurchaseUrl" TEXT;
ALTER TABLE "Schedule" ADD COLUMN "activeWeekdays" JSONB NOT NULL DEFAULT '[1,2,3,4,5,6,7]';

-- Backfill terminals + via from legacy route (start-end[-via...])
UPDATE "Schedule" s
SET
  "startPointId" = sp.id,
  "endPointId" = ep.id,
  "viaPointIds" = COALESCE((
    SELECT jsonb_agg(vp.id ORDER BY ord.ord)
    FROM (
      SELECT trim(both FROM part) AS code, ordinality AS ord
      FROM unnest(string_to_array(s.route, '-')) WITH ORDINALITY AS u(part, ordinality)
      WHERE ordinality > 2
    ) ord
    JOIN "TripPoint" vp ON vp.code = ord.code
  ), '[]'::jsonb)
FROM "TripPoint" sp, "TripPoint" ep
WHERE sp.code = split_part(s.route, '-', 1)
  AND ep.code = split_part(s.route, '-', 2);

ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_startPointId_fkey"
  FOREIGN KEY ("startPointId") REFERENCES "TripPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_endPointId_fkey"
  FOREIGN KEY ("endPointId") REFERENCES "TripPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Schedule_startPointId_idx" ON "Schedule"("startPointId");
CREATE INDEX "Schedule_endPointId_idx" ON "Schedule"("endPointId");
CREATE INDEX "Schedule_vehicleType_idx" ON "Schedule"("vehicleType");
