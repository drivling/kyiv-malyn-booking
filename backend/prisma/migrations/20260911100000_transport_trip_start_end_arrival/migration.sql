-- Скорочені рейси та фіксований час прибуття (TransportTrip).
-- startStopId / endStopId — перша/остання обслуговувана зупинка (NULL = перша/остання в напрямку).
-- arrivalTime — час на останній обслуговуваній зупинці (HH:MM:SS); коли сума сегментів довша,
-- тривалості перегонів цього рейсу стискаються пропорційно (обчислюється на льоту).

ALTER TABLE "TransportTrip" ADD COLUMN "startStopId" TEXT;
ALTER TABLE "TransportTrip" ADD COLUMN "endStopId" TEXT;
ALTER TABLE "TransportTrip" ADD COLUMN "arrivalTime" TEXT;
