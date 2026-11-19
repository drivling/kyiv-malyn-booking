/**
 * Бронювання маршрутки зі сторінки «Доведе» — та сама модалка, що на головній (`BusBookingModal`, з її
 * попередженням «Зубастик» — лише за телефоном»). Окремий модуль: його й стилі головної сторінка вантажить лише
 * після натискання «Забронювати» (`BookingButton`). `mizh-page` дає модалці кольори головної. Портал у `body`:
 * картки історії анімуються з `transform`, і всередині них `position: fixed` рахувався б від картки, а не від вікна.
 */
import { createPortal } from 'react-dom';
import { BusBookingModal } from '@/pages/MizhgorodskiPage/BusBookingModal';
import '@/pages/MizhgorodskiPage/MizhgorodskiPage.css';
import type { Schedule } from '@/types';
import type { BookingCity } from '@/utils/constants';

export default function DovedeBooking(props: { schedule: Schedule; date: string; fromCity: BookingCity; toCity: BookingCity; onClose: () => void }) {
  return createPortal(
    <div className="mizh-page dv-booking">
      <BusBookingModal {...props} />
    </div>,
    document.body,
  );
}
