-- URL джерела розкладу для оновлення електричок через парсер SW Railway
ALTER TABLE "Schedule" ADD COLUMN "timetableSourceUrl" TEXT;

UPDATE "Schedule"
SET "timetableSourceUrl" = 'https://swrailway.gov.ua/timetable/eltrain/?gid=1&rid=68&reverse=2&half=1&count=4'
WHERE "vehicleType" = 'elektrichka' AND "route" = 'Malyn-Kyiv';
