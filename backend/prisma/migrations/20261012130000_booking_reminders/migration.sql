-- Журнал надісланих нагадувань про поїздку (дедуп для таймера в процесі).
CREATE TABLE "BookingReminder" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "delivered" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingReminder_bookingId_kind_key" ON "BookingReminder"("bookingId", "kind");

ALTER TABLE "BookingReminder" ADD CONSTRAINT "BookingReminder_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
