-- Malyn → Kyiv suburban trains (електрички) from SW Railway timetable
-- Source: https://swrailway.gov.ua/timetable/eltrain/?gid=1&rid=68&reverse=2&half=1&count=4
-- Only trains with a stop (or origin) at Малин toward Київ / Святошин / Борщагівка.
-- Days: table headers; 6606 marked «по нд.» but notice from 2026-08-02 → daily (7 days).
-- Price: 60 UAH (admin-set). Ticket link reused from existing elektrichka rows.

DELETE FROM "Schedule"
WHERE "vehicleType" = 'elektrichka'
  AND "route" = 'Malyn-Kyiv';

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
  20,
  malyn.id,
  kyiv.id,
  '[]'::jsonb,
  tr.id,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    -- 6606 Коростень→Київ-Пас: Малин 05:18 → Київ 07:42; щоденно (з 02.08.2026)
    ('Malyn-Kyiv', '05:18', '07:42', 144, '6606', '[1,2,3,4,5,6,7]', 'Малин', 'Київ-Пас. (Приміський)'),
    -- 856 Коростень→Київ-Пас: Малин 05:45 → Київ 07:42; крім нд.
    ('Malyn-Kyiv', '05:45', '07:42', 117, '856', '[1,2,3,4,5,6]', 'Малин', 'Київ-Пас. (Приміський)'),
    -- 6610 Коростень→Борщагівка: Малин 06:58 → Борщагівка 09:06; крім нд.
    ('Malyn-Kyiv', '06:58', '09:06', 128, '6610', '[1,2,3,4,5,6]', 'Малин', 'Борщагівка'),
    -- 6614 Коростень→Святошин: Малин 09:48 → Святошин 11:47; щоденно
    ('Malyn-Kyiv', '09:48', '11:47', 119, '6614', '[1,2,3,4,5,6,7]', 'Малин', 'Святошин'),
    -- 6616 Малин→Святошин: відпр. Малин 11:47 → Святошин 13:42; щоденно
    ('Malyn-Kyiv', '11:47', '13:42', 115, '6616', '[1,2,3,4,5,6,7]', 'Малин', 'Святошин'),
    -- 860 Коростень→Київ-Пас: Малин 14:20 → Київ 16:23; крім сб., нд.
    ('Malyn-Kyiv', '14:20', '16:23', 123, '860', '[1,2,3,4,5]', 'Малин', 'Київ-Пас. (Приміський)'),
    -- 6626 Коростень→Київ-Пас: Малин 19:32 → Київ 22:11; щоденно
    ('Malyn-Kyiv', '19:32', '22:11', 159, '6626', '[1,2,3,4,5,6,7]', 'Малин', 'Київ-Пас. (Приміський)')
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
CROSS JOIN "TripPoint" malyn
CROSS JOIN "TripPoint" kyiv
CROSS JOIN "TripRoute" tr
WHERE malyn.code = 'Malyn'
  AND kyiv.code = 'Kyiv'
  AND tr.slug = 'Malyn-Kyiv';
