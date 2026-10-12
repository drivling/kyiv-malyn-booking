-- ViberListing.endsAt was computed as "departureTime in UTC" (Railway runs TZ=UTC), but departureTime is
-- Kyiv wall-clock time, so listings outlived their trip by 2-3 hours. Recompute: trip day + end of the
-- departure time, interpreted in Europe/Kyiv, stored as naive UTC (like every other TIMESTAMP(3) here).
-- Assumes "date" is UTC midnight of the trip day (server TZ=UTC), as the original backfill did.
-- Mirrors getListingEndsAt(): "HH:MM-HH:MM" -> end of range, "HH:MM" -> that time, else 23:59.
UPDATE "ViberListing"
SET "endsAt" = (
  (date_trunc('day', "date") + CASE
    WHEN "departureTime" ~ '^\d{1,2}:\d{2}-\d{1,2}:\d{2}$' THEN (split_part("departureTime", '-', 2))::interval
    WHEN "departureTime" ~ '^\d{1,2}:\d{2}$' THEN ("departureTime")::interval
    ELSE interval '23 hours 59 minutes'
  END) AT TIME ZONE 'Europe/Kyiv'
) AT TIME ZONE 'UTC';
