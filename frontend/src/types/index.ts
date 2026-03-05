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
  source?: string; // "Viber1" | "telegram1"
  senderName: string | null;
  listingType: ViberListingType;
  route: string;
  date: string;
  departureTime: string | null;
  seats: number | null;
  phone: string;
  notes: string | null;
  priceUah?: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ViberListingFormData {
  rawMessage: string;
}

export interface TelegramScenarioItem {
  title: string;
  command: string;
  deepLink: string;
  webLink?: string;
}

export interface TelegramScenariosResponse {
  enabled: boolean;
  scenarios: {
    driver: TelegramScenarioItem;
    passenger: TelegramScenarioItem;
    view: TelegramScenarioItem;
  };
}

export interface RideShareRequestFromSiteResponse {
  success: boolean;
  requestId: number;
  message: string;
  driverNotified: boolean;
}

/** Відповідь API створення чернетки оголошення з сайту (передача даних у Telegram) */
export interface AnnounceDraftResponse {
  token: string;
  deepLink: string;
}

/** Персона (єдина база людей). Управління даними в адмінці. */
export interface Person {
  id: number;
  phoneNormalized: string;
  fullName: string | null;
  telegramChatId: string | null;
  telegramUserId: string | null;
  telegramPromoSentAt: string | null;
  telegramReminderSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonWithCounts extends Person {
  _count: { bookings: number; viberListings: number };
}

/** Результат оновлення імен персон (пошук через Telegram бота або send_message.py). */
export interface RefreshPersonNamesChange {
  personId: number;
  phone: string;
  oldName: string | null;
  newName: string | null;
  source: 'bot' | 'user_account' | null;
}

export interface RefreshPersonNamesResponse {
  total: number;
  updated: number;
  skipped: number;
  errors?: string[];
  changes: RefreshPersonNamesChange[];
}

// Ключі сценаріїв реклами (поведінкові пропозиції з аналітики ViberRide)
export type BehaviorPromoScenarioKey =
  | 'driver_passengers'
  | 'driver_autocreate'
  | 'passenger_notify'
  | 'passenger_quick'
  | 'mixed_unified'
  | 'mixed_both';

// Аналітика поведінки клієнта на основі історичних ViberRide подій
export interface ViberClientBehavior {
  phoneNormalized: string;
  fullName: string | null;
  totalRides: number;
  firstRideDate: string | null;
  lastRideDate: string | null;
  routes: Array<{ route: string; count: number; share: number }>;
  weekdayStats: Array<{ weekday: number; count: number }>;
  timeOfDayStats: { morning: number; day: number; evening: number; night: number };
  behaviorSummary: string;
  recommendations: string[];
  hasTelegramBot: boolean;
  communicationFailed: boolean;
  profileRole: 'driver' | 'passenger' | 'mixed';
}

export interface ViberAnalyticsSummaryResponse {
  clients: ViberClientBehavior[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ViberAnalyticsPromoScenariosResponse {
  scenarios: Array<{ key: BehaviorPromoScenarioKey; label: string; profiles: ('driver' | 'passenger' | 'mixed')[] }>;
  scenarioKeysByProfile: {
    driver: BehaviorPromoScenarioKey[];
    passenger: BehaviorPromoScenarioKey[];
    mixed: BehaviorPromoScenarioKey[];
  };
}

export interface SendPersonPromoResponse {
  success: boolean;
  sentVia: 'bot' | 'user';
  error?: string;
}

export interface PhoneCheckResult {
  phone: string;
  url: string;
  hasData: boolean;
  html?: string | null;
}

export interface PhoneCheckAnalyzeResponse {
  total: number;
  withData: number;
  results: PhoneCheckResult[];
}

/** Профіль користувача (GET /user/profile): персона, бронювання маршруток, оголошення попуток */
export interface UserProfilePerson {
  id: number;
  fullName: string | null;
  phoneNormalized: string;
  telegramUserId: string | null;
}

export interface UserProfile {
  person: UserProfilePerson | null;
  bookings: Booking[];
  passengerListings: ViberListing[];
  driverListings: ViberListing[];
}
