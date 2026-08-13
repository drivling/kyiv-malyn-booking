-- Booking.tripRouteId + backfill; Schedule.route no longer unique SoT

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "tripRouteId" INTEGER;

UPDATE "Booking" b
SET "tripRouteId" = s."tripRouteId"
FROM "Schedule" s
WHERE b."scheduleId" = s.id AND b."tripRouteId" IS NULL;

UPDATE "Booking" b
SET "tripRouteId" = tr.id
FROM "TripRoute" tr
WHERE b."tripRouteId" IS NULL AND b.route = tr.slug;

CREATE INDEX IF NOT EXISTS "Booking_tripRouteId_idx" ON "Booking"("tripRouteId");

DO $$ BEGIN
  ALTER TABLE "Booking"
    ADD CONSTRAINT "Booking_tripRouteId_fkey"
    FOREIGN KEY ("tripRouteId") REFERENCES "TripRoute"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Drop legacy unique on (route, departureTime); keep non-unique index for lookups
DROP INDEX IF EXISTS "Schedule_route_departureTime_key";
CREATE INDEX IF NOT EXISTS "Schedule_route_departureTime_idx" ON "Schedule"("route", "departureTime");
