-- Docs/poputky-search-performance-plan.md, Phases 3.1 (endsAt), 3.4 (OD backfill), 4.3 (NotificationJob).
-- AlterTable
ALTER TABLE "ViberListing" ADD COLUMN     "endsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NotificationJob" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationJob_status_runAfter_idx" ON "NotificationJob"("status", "runAfter");

-- CreateIndex
CREATE INDEX "ViberListing_isActive_endsAt_idx" ON "ViberListing"("isActive", "endsAt");

-- Docs/poputky-search-performance-plan.md, Phase 3.1: backfill endsAt = trip day + end of the departure time
-- Assumes the server TZ is UTC (Railway): "date" is stored as UTC midnight of the trip day.
-- (mirrors getViberListingEndDateTime: "HH:MM-HH:MM" -> end of range, "HH:MM" -> that time, else 23:59).
UPDATE "ViberListing"
SET "endsAt" = date_trunc('day', "date") + CASE
  WHEN "departureTime" ~ '^\d{1,2}:\d{2}-\d{1,2}:\d{2}$' THEN (split_part("departureTime", '-', 2))::interval
  WHEN "departureTime" ~ '^\d{1,2}:\d{2}$' THEN ("departureTime")::interval
  ELSE interval '23 hours 59 minutes'
END
WHERE "endsAt" IS NULL;

-- Phase 3.4: OD identity backfill for rows that still carry only the route slug.
UPDATE "ViberListing" v
SET "fromPointId" = f.id, "toPointId" = t.id
FROM "TripPoint" f, "TripPoint" t
WHERE v."fromPointId" IS NULL AND v."toPointId" IS NULL
  AND lower(f.code) = lower(split_part(v.route, '-', 1))
  AND lower(t.code) = lower(split_part(v.route, '-', 2))
  AND f.id <> t.id;
