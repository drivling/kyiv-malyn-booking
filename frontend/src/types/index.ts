export type Route =
  | 'Kyiv-Malyn-Irpin'
  | 'Malyn-Kyiv-Irpin'
  | 'Kyiv-Malyn-Bucha'
  | 'Malyn-Kyiv-Bucha';

// Спрощений напрямок для UI бронювання
export type Direction = 'Kyiv-Malyn' | 'Malyn-Kyiv';
// Синонім для сумісності зі старим кодом
export type BaseDirection = Direction;

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

// Telegram User Data
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
  phone?: string;
}

// User State
export type UserType = 'admin' | 'telegram';

export interface AdminUser {
  type: 'admin';
  token: string;
}

export interface TelegramUserState {
  type: 'telegram';
  user: TelegramUser;
  phone: string;
}

export type UserState = AdminUser | TelegramUserState | null;
