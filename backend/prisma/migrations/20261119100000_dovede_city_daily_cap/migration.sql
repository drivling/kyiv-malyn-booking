-- «Доведе» · дорога містом: денний ліміт запитів до Google тепер теж редагується з адмінки.
-- NULL — як у змінній DOVEDE_CITY_DAILY_CAP на Railway (інакше 150 з коду).
ALTER TABLE "DovedeCitySettings" ADD COLUMN "dailyCap" INTEGER;
