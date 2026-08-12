-- Gold model CP1–CP5: TripRoute identity + backfills + tighten

-- ========== CP1: additive schema ==========
CREATE TABLE "TripRoute" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "labelUk" TEXT NOT NULL,
    "startPointId" INTEGER NOT NULL,
    "endPointId" INTEGER NOT NULL,
    "corridorTripRouteId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TripRoute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TripRoute_slug_key" ON "TripRoute"("slug");
CREATE INDEX "TripRoute_startPointId_endPointId_idx" ON "TripRoute"("startPointId", "endPointId");
CREATE INDEX "TripRoute_corridorTripRouteId_idx" ON "TripRoute"("corridorTripRouteId");

ALTER TABLE "TripRoute"
  ADD CONSTRAINT "TripRoute_startPointId_fkey"
  FOREIGN KEY ("startPointId") REFERENCES "TripPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripRoute"
  ADD CONSTRAINT "TripRoute_endPointId_fkey"
  FOREIGN KEY ("endPointId") REFERENCES "TripPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripRoute"
  ADD CONSTRAINT "TripRoute_corridorTripRouteId_fkey"
  FOREIGN KEY ("corridorTripRouteId") REFERENCES "TripRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TripRouteStop" (
    "id" SERIAL NOT NULL,
    "tripRouteId" INTEGER NOT NULL,
    "pointId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    CONSTRAINT "TripRouteStop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TripRouteStop_tripRouteId_position_key" ON "TripRouteStop"("tripRouteId", "position");
CREATE UNIQUE INDEX "TripRouteStop_tripRouteId_pointId_key" ON "TripRouteStop"("tripRouteId", "pointId");
CREATE INDEX "TripRouteStop_pointId_idx" ON "TripRouteStop"("pointId");

ALTER TABLE "TripRouteStop"
  ADD CONSTRAINT "TripRouteStop_tripRouteId_fkey"
  FOREIGN KEY ("tripRouteId") REFERENCES "TripRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripRouteStop"
  ADD CONSTRAINT "TripRouteStop_pointId_fkey"
  FOREIGN KEY ("pointId") REFERENCES "TripPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Schedule" ADD COLUMN "tripRouteId" INTEGER;
ALTER TABLE "ViberListing" ADD COLUMN "tripRouteId" INTEGER;
CREATE INDEX "ViberListing_tripRouteId_idx" ON "ViberListing"("tripRouteId");

-- ========== CP2: seed corridors ==========
WITH corridors(slug, start_code, end_code, label) AS (
  VALUES
    ('Kyiv-Malyn', 'Kyiv', 'Malyn', 'Київ → Малин'),
    ('Malyn-Kyiv', 'Malyn', 'Kyiv', 'Малин → Київ'),
    ('Malyn-Zhytomyr', 'Malyn', 'Zhytomyr', 'Малин → Житомир'),
    ('Zhytomyr-Malyn', 'Zhytomyr', 'Malyn', 'Житомир → Малин'),
    ('Korosten-Malyn', 'Korosten', 'Malyn', 'Коростень → Малин'),
    ('Malyn-Korosten', 'Malyn', 'Korosten', 'Малин → Коростень')
)
INSERT INTO "TripRoute" ("slug", "labelUk", "startPointId", "endPointId", "updatedAt")
SELECT c.slug, c.label, sp.id, ep.id, CURRENT_TIMESTAMP
FROM corridors c
JOIN "TripPoint" sp ON sp.code = c.start_code
JOIN "TripPoint" ep ON ep.code = c.end_code
ON CONFLICT ("slug") DO NOTHING;

-- ========== CP2: seed variants from Schedule ==========
INSERT INTO "TripRoute" ("slug", "labelUk", "startPointId", "endPointId", "corridorTripRouteId", "updatedAt")
SELECT DISTINCT ON (s.route)
  s.route,
  CASE
    WHEN s.route LIKE '%Irpin%' THEN
      REPLACE(REPLACE(split_part(s.route,'-',1)||' → '||split_part(s.route,'-',2), 'Kyiv', 'Київ'), 'Malyn', 'Малин') || ' (через Ірпінь)'
    WHEN s.route LIKE '%Bucha%' THEN
      REPLACE(REPLACE(split_part(s.route,'-',1)||' → '||split_part(s.route,'-',2), 'Kyiv', 'Київ'), 'Malyn', 'Малин') || ' (через Бучу)'
    ELSE COALESCE(c."labelUk", s.route)
  END,
  s."startPointId",
  s."endPointId",
  CASE
    WHEN EXISTS (SELECT 1 FROM "TripRoute" x WHERE x.slug = s.route AND x."corridorTripRouteId" IS NULL)
      THEN NULL
    ELSE c.id
  END,
  CURRENT_TIMESTAMP
FROM "Schedule" s
LEFT JOIN "TripRoute" c
  ON c.slug = (split_part(s.route, '-', 1) || '-' || split_part(s.route, '-', 2))
 AND c."corridorTripRouteId" IS NULL
WHERE s."startPointId" IS NOT NULL AND s."endPointId" IS NOT NULL
ON CONFLICT ("slug") DO NOTHING;

-- Link variants that already existed as corridors incorrectly: set corridor for Irpin/Bucha
UPDATE "TripRoute" tr
SET "corridorTripRouteId" = c.id,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "TripRoute" c
WHERE tr."corridorTripRouteId" IS NULL
  AND tr.slug LIKE c.slug || '-%'
  AND c."corridorTripRouteId" IS NULL
  AND (tr.slug LIKE '%-Irpin' OR tr.slug LIKE '%-Bucha');

-- ========== CP2: TripRouteStop for all TripRoutes ==========
-- start
INSERT INTO "TripRouteStop" ("tripRouteId", "pointId", "position", "role")
SELECT tr.id, tr."startPointId", 0, 'start' FROM "TripRoute" tr
ON CONFLICT DO NOTHING;

-- vias from any Schedule sharing slug (viaPointIds JSON array of ints)
INSERT INTO "TripRouteStop" ("tripRouteId", "pointId", "position", "role")
SELECT DISTINCT ON (tr.id, pid)
  tr.id,
  pid,
  pos,
  'via'
FROM "TripRoute" tr
JOIN "Schedule" s ON s.route = tr.slug
CROSS JOIN LATERAL (
  SELECT (e.val)::int AS pid, e.o::int AS pos
  FROM jsonb_array_elements(COALESCE(s."viaPointIds", '[]'::jsonb)) WITH ORDINALITY AS e(val, o)
  WHERE jsonb_typeof(COALESCE(s."viaPointIds", '[]'::jsonb)) = 'array'
) v
WHERE v.pid IS NOT NULL
ON CONFLICT DO NOTHING;

-- end (position = 1 + via count)
INSERT INTO "TripRouteStop" ("tripRouteId", "pointId", "position", "role")
SELECT tr.id, tr."endPointId",
  1 + (SELECT COUNT(*)::int FROM "TripRouteStop" x WHERE x."tripRouteId" = tr.id AND x.role = 'via'),
  'end'
FROM "TripRoute" tr
ON CONFLICT DO NOTHING;

-- ========== CP2: link Schedule ==========
UPDATE "Schedule" s
SET "tripRouteId" = tr.id
FROM "TripRoute" tr
WHERE tr.slug = s.route;

-- ========== CP3: Booking.scheduleId ==========
UPDATE "Booking" b
SET "scheduleId" = s.id
FROM "Schedule" s
WHERE b.source = 'schedule'
  AND s.route = b.route
  AND s."departureTime" = b."departureTime"
  AND b."scheduleId" IS NULL;

-- ========== CP4: ViberListing.tripRouteId (corridors only) ==========
UPDATE "ViberListing" v
SET "tripRouteId" = tr.id
FROM "TripRoute" tr
WHERE tr.slug = v.route
  AND tr."corridorTripRouteId" IS NULL
  AND v."tripRouteId" IS NULL;

-- ========== CP5: tighten ==========
ALTER TABLE "Schedule" ALTER COLUMN "tripRouteId" SET NOT NULL;
ALTER TABLE "Schedule"
  ADD CONSTRAINT "Schedule_tripRouteId_fkey"
  FOREIGN KEY ("tripRouteId") REFERENCES "TripRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Schedule_tripRouteId_departureTime_key" ON "Schedule"("tripRouteId", "departureTime");

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Booking_scheduleId_idx" ON "Booking"("scheduleId");

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_schedule_source_requires_scheduleId"
  CHECK (source <> 'schedule' OR "scheduleId" IS NOT NULL);

ALTER TABLE "ViberListing"
  ADD CONSTRAINT "ViberListing_tripRouteId_fkey"
  FOREIGN KEY ("tripRouteId") REFERENCES "TripRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;
