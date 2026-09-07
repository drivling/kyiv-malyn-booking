-- Прямий OD-маршрут Житомир ↔ Київ (група poputka_zhytomyr_kyiv).
-- Точки Kyiv/Zhytomyr уже існують (appearInPoputky=true). Додаємо два TripRoute-коридори,
-- щоб пара з'явилась у /od-pairs (дошка попуток) і resolveCorridorTripRouteId її знаходив.

WITH corridors(slug, start_code, end_code, label) AS (
  VALUES
    ('Kyiv-Zhytomyr', 'Kyiv', 'Zhytomyr', 'Київ → Житомир'),
    ('Zhytomyr-Kyiv', 'Zhytomyr', 'Kyiv', 'Житомир → Київ')
)
INSERT INTO "TripRoute" ("slug", "labelUk", "startPointId", "endPointId", "updatedAt")
SELECT c.slug, c.label, sp.id, ep.id, CURRENT_TIMESTAMP
FROM corridors c
JOIN "TripPoint" sp ON sp.code = c.start_code
JOIN "TripPoint" ep ON ep.code = c.end_code
ON CONFLICT ("slug") DO NOTHING;
