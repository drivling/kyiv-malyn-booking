-- Poputky OD identity: appearInPoputky + from/to point FKs on listings and bookings

-- ========== CP1: schema ==========
ALTER TABLE "TripPoint" ADD COLUMN "appearInPoputky" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ViberListing" ADD COLUMN "fromPointId" INTEGER;
ALTER TABLE "ViberListing" ADD COLUMN "toPointId" INTEGER;

ALTER TABLE "Booking" ADD COLUMN "fromPointId" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "toPointId" INTEGER;

CREATE INDEX "ViberListing_fromPointId_toPointId_date_listingType_idx"
  ON "ViberListing"("fromPointId", "toPointId", "date", "listingType");
CREATE INDEX "Booking_fromPointId_toPointId_idx"
  ON "Booking"("fromPointId", "toPointId");

ALTER TABLE "ViberListing"
  ADD CONSTRAINT "ViberListing_fromPointId_fkey"
  FOREIGN KEY ("fromPointId") REFERENCES "TripPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ViberListing"
  ADD CONSTRAINT "ViberListing_toPointId_fkey"
  FOREIGN KEY ("toPointId") REFERENCES "TripPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_fromPointId_fkey"
  FOREIGN KEY ("fromPointId") REFERENCES "TripPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_toPointId_fkey"
  FOREIGN KEY ("toPointId") REFERENCES "TripPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ========== CP2: seed appearInPoputky ==========
UPDATE "TripPoint"
SET "appearInPoputky" = true,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE code IN ('Kyiv', 'Malyn', 'Zhytomyr', 'Korosten', 'Irpin', 'Bucha');

-- ========== CP2: backfill ViberListing OD from route slug (first two segments) ==========
UPDATE "ViberListing" v
SET
  "fromPointId" = sp.id,
  "toPointId" = ep.id
FROM "TripPoint" sp, "TripPoint" ep
WHERE v."fromPointId" IS NULL
  AND split_part(v.route, '-', 1) <> ''
  AND split_part(v.route, '-', 2) <> ''
  AND sp.code = split_part(v.route, '-', 1)
  AND ep.code = split_part(v.route, '-', 2);

-- ========== CP2: backfill Booking OD for viber_match ==========
UPDATE "Booking" b
SET
  "fromPointId" = sp.id,
  "toPointId" = ep.id
FROM "TripPoint" sp, "TripPoint" ep
WHERE b.source = 'viber_match'
  AND b."fromPointId" IS NULL
  AND split_part(b.route, '-', 1) <> ''
  AND split_part(b.route, '-', 2) <> ''
  AND sp.code = split_part(b.route, '-', 1)
  AND ep.code = split_part(b.route, '-', 2);
