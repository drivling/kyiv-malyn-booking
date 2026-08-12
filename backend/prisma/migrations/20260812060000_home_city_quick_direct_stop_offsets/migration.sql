-- Home-city quick-pick destinations + boarding offsets on route stops

ALTER TABLE "TripPoint" ADD COLUMN IF NOT EXISTS "quickDirectPointIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE "TripRouteStop" ADD COLUMN IF NOT EXISTS "departureOffsetMinutes" INTEGER;

-- Seed quick-pick for known cities (by code; ids resolved at runtime)
UPDATE "TripPoint" tp
SET "quickDirectPointIds" = COALESCE((
  SELECT array_agg(o.id ORDER BY o."sortOrder", o.id)
  FROM "TripPoint" o
  WHERE o.code = ANY(ARRAY['Kyiv', 'Zhytomyr', 'Korosten'])
), ARRAY[]::INTEGER[])
WHERE tp.code = 'Malyn';

UPDATE "TripPoint" tp
SET "quickDirectPointIds" = COALESCE((
  SELECT array_agg(o.id ORDER BY o."sortOrder", o.id)
  FROM "TripPoint" o
  WHERE o.code = ANY(ARRAY['Malyn', 'Irpin', 'Bucha'])
), ARRAY[]::INTEGER[])
WHERE tp.code = 'Kyiv';

UPDATE "TripPoint" tp
SET "quickDirectPointIds" = COALESCE((
  SELECT array_agg(o.id ORDER BY o."sortOrder", o.id)
  FROM "TripPoint" o
  WHERE o.code = ANY(ARRAY['Kyiv', 'Malyn'])
), ARRAY[]::INTEGER[])
WHERE tp.code = 'Zhytomyr';

UPDATE "TripPoint" tp
SET "quickDirectPointIds" = COALESCE((
  SELECT array_agg(o.id ORDER BY o."sortOrder", o.id)
  FROM "TripPoint" o
  WHERE o.code = ANY(ARRAY['Malyn'])
), ARRAY[]::INTEGER[])
WHERE tp.code = 'Korosten';

UPDATE "TripPoint" tp
SET "quickDirectPointIds" = COALESCE((
  SELECT array_agg(o.id ORDER BY o."sortOrder", o.id)
  FROM "TripPoint" o
  WHERE o.code = ANY(ARRAY['Kyiv', 'Irpin', 'Malyn', 'Korosten'])
), ARRAY[]::INTEGER[])
WHERE tp.code = 'Bucha';

UPDATE "TripPoint" tp
SET "quickDirectPointIds" = COALESCE((
  SELECT array_agg(o.id ORDER BY o."sortOrder", o.id)
  FROM "TripPoint" o
  WHERE o.code = ANY(ARRAY['Kyiv', 'Bucha', 'Malyn'])
), ARRAY[]::INTEGER[])
WHERE tp.code = 'Irpin';
