-- Kyiv → Malyn suburban trains from SW Railway
-- Source: https://swrailway.gov.ua/timetable/eltrain/?gid=1&rid=68&reverse=1&half=1&count=4
-- Only trains that stop at Малин. BoardingPlace = actual Kyiv-area origin
-- (Київ-Пас. / Борщагівка / Святошин). Ticket link from ops.
-- Days from column headers (крім сб./нд., по сб. нд., щоденно).

DELETE FROM "Schedule"
WHERE "vehicleType" = 'elektrichka'
  AND "route" = 'Kyiv-Malyn';

INSERT INTO "Schedule" (
  "route",
  "departureTime",
  "arrivalTime",
  "durationMinutes",
  "tripNumber",
  "vehicleType",
  "activeWeekdays",
  "priceUah",
  "boardingPlace",
  "alightingPlace",
  "ticketPurchaseUrl",
  "timetableSourceUrl",
  "maxSeats",
  "startPointId",
  "endPointId",
  "viaPointIds",
  "tripRouteId",
  "updatedAt"
)
SELECT
  v.route,
  v."departureTime",
  v."arrivalTime",
  v."durationMinutes",
  v."tripNumber",
  'elektrichka',
  v."activeWeekdays"::jsonb,
  60,
  v."boardingPlace",
  v."alightingPlace",
  'https://lnk.ua/8iLMTuFpe',
  'https://swrailway.gov.ua/timetable/eltrain/?gid=1&rid=68&reverse=1&half=1&count=4',
  20,
  kyiv.id,
  malyn.id,
  '[]'::jsonb,
  tr.id,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    -- 6601 Київ-Пас → Коростень: відпр. 05:35 → Малин 08:01; щоденно
    ('Kyiv-Malyn', '05:35', '08:01', 146, '6601', '[1,2,3,4,5,6,7]', 'Київ-Пас. (Приміський)', 'Малин'),
    -- 6605 Київ-Пас → Малин: 08:50 → 11:11; щоденно
    ('Kyiv-Malyn', '08:50', '11:11', 141, '6605', '[1,2,3,4,5,6,7]', 'Київ-Пас. (Приміський)', 'Малин'),
    -- 855 Київ-Пас → Коростень: 09:20 → 11:27; крім сб., нд.
    ('Kyiv-Malyn', '09:20', '11:27', 127, '855', '[1,2,3,4,5]', 'Київ-Пас. (Приміський)', 'Малин'),
    -- 6613 Київ-Пас → Коростень: 14:51 → 17:11; щоденно
    ('Kyiv-Malyn', '14:51', '17:11', 140, '6613', '[1,2,3,4,5,6,7]', 'Київ-Пас. (Приміський)', 'Малин'),
    -- 859 Київ-Пас → Коростень: 17:30 → 19:28; крім сб.
    ('Kyiv-Malyn', '17:30', '19:28', 118, '859', '[1,2,3,4,5,7]', 'Київ-Пас. (Приміський)', 'Малин'),
    -- 6621 (вихідні) Борщагівка → …: 18:51 → 20:48; по сб., нд.
    ('Kyiv-Malyn', '18:51', '20:48', 117, '6621', '[6,7]', 'з.п. Борщагівка', 'Малин'),
    -- 6621 (будні) Святошин → Коростень: 18:59 → 20:48; крім сб., нд.
    ('Kyiv-Malyn', '18:59', '20:48', 109, '6621', '[1,2,3,4,5]', 'Святошин', 'Малин')
) AS v(
  route,
  "departureTime",
  "arrivalTime",
  "durationMinutes",
  "tripNumber",
  "activeWeekdays",
  "boardingPlace",
  "alightingPlace"
)
CROSS JOIN "TripPoint" kyiv
CROSS JOIN "TripPoint" malyn
CROSS JOIN "TripRoute" tr
WHERE kyiv.code = 'Kyiv'
  AND malyn.code = 'Malyn'
  AND tr.slug = 'Kyiv-Malyn';
