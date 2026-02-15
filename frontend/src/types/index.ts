export type Route =
  | 'Kyiv-Malyn-Irpin'
  | 'Malyn-Kyiv-Irpin'
  | 'Kyiv-Malyn-Bucha'
  | 'Malyn-Kyiv-Bucha'
  | 'Malyn-Zhytomyr'
  | 'Zhytomyr-Malyn'
  | 'Korosten-Malyn'
  | 'Malyn-Korosten';

// Спрощений напрямок для UI бронювання
export type Direction = 'Kyiv-Malyn' | 'Malyn-Kyiv' | 'Malyn-Zhytomyr' | 'Zhytomyr-Malyn' | 'Korosten-Malyn' | 'Malyn-Korosten';
// Синонім для сумісності зі старим кодом
export type BaseDirection = Direction;

export interface Schedule {
  id: number;
  route: Route;
  departureTime: string;
  maxSeats: number;
  supportPhone: string | null;
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
  source?: 'schedule' | 'viber_match'; // schedule = маршрутка, viber_match = попутка (водій підтвердив)
  viberListingId?: number | null;
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
  telegramUserId?: string; // Опціонально - для прив'язки до Telegram
}

export interface ScheduleFormData {
  route: Route;
  departureTime: string;
  maxSeats: number;
  supportPhone?: string;
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

// Viber Listings
export type ViberListingType = 'driver' | 'passenger';

export interface ViberListing {
  id: number;
  rawMessage: string;
  senderName: string | null;
  listingType: ViberListingType;
  route: string;
  date: string;
  departureTime: string | null;
  seats: number | null;
  phone: string;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ViberListingFormData {
  rawMessage: string;
}
