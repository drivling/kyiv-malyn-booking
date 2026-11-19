import { Suspense, lazy, useState } from 'react';
import type { Schedule } from '@/types';
import type { BookingCity } from '@/utils/constants';

const DovedeBooking = lazy(() => import('./DovedeBooking'));

/** «Забронювати» на квитку маршрутки: відкриває модалку бронювання, як на головній */
export function BookingButton({ schedule, date, fromCity, toCity }: { schedule: Schedule; date: string; fromCity: BookingCity; toCity: BookingCity }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="dv-btn dv-btn--primary" onClick={() => setOpen(true)}>
        Забронювати
      </button>
      {open ? (
        <Suspense fallback={null}>
          <DovedeBooking schedule={schedule} date={date} fromCity={fromCity} toCity={toCity} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
