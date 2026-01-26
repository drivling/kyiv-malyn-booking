export type Route = 
  | 'Kyiv-Malyn-Irpin'
  | 'Malyn-Kyiv-Irpin'
  | 'Kyiv-Malyn-Bucha'
  | 'Malyn-Kyiv-Bucha';

export interface Schedule {
  id: number;
  route: Route;
  departureTime: string;
  maxSeats: number;
  createdAt: string;
  updatedAt: string;
}

export interface Booking {
  id: number;
  route: Route;
  date: string;
  departureTime: string;
  seats: number;
  name: string;
  phone: string;
  scheduleId: number | null;
  createdAt: string;
}

export interface Availability {
  scheduleId: number;
  maxSeats: number;
  bookedSeats: number;
  availableSeats: number;
  isAvailable: boolean;
}

export interface BookingFormData {
  route: Route;
  date: string;
  departureTime: string;
  seats: number;
  name: string;
  phone: string;
}

export interface ScheduleFormData {
  route: Route;
  departureTime: string;
  maxSeats: number;
}
