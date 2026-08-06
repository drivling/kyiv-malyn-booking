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
  telegramUsername: string | null;
  telegramPromoSentAt: string | null;
  telegramReminderSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Помилка відправки через персональний акаунт (send_message.py) */
export interface TelegramUserSendError {
  id: number;
  contact: string;
  contactType: string;
  errorCode: number;
  errorText: string | null;
  createdAt: string;
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

/** Адмін: реферальна програма */
/** hold — чекає схвалення фото; approved — у черзі виплат; pending — легасі до введення hold */
export type ReferralRewardStatus = 'hold' | 'pending' | 'approved' | 'paid' | 'flagged';
export type RideProofStatus = 'awaiting_photos' | 'pending_review' | 'approved' | 'rejected' | 'flagged';

export interface ReferralPersonBrief {
  id?: number;
  fullName: string | null;
  phoneNormalized: string;
  telegramUsername?: string | null;
  telegramChatId?: string | null;
}

export interface ReferralRewardRow {
  id: number;
  referrerId: number;
  referredPersonId: number;
  rewardType: string;
  amountUah: number;
  status: ReferralRewardStatus | string;
  flagReason: string | null;
  payoutNote?: string | null;
  paidAt: string | null;
  createdAt: string;
  referrer: ReferralPersonBrief & { id: number };
  referredPerson: ReferralPersonBrief & { id: number };
  viberListing?: { id: number; route: string; date: string; listingType: string } | null;
  rideProof?: { id: number; route: string; rideDate: string; photoStartFileId: string | null; photoEndFileId: string | null } | null;
}

export interface ReferralPayoutPersonRow {
  personId: number;
  fullName: string | null;
  phoneNormalized: string;
  telegramUsername: string | null;
  payableUah: number;
  payableCount: number;
  /** Нараховано, але фото ще не схвалено — платити не можна */
  holdUah: number;
  holdCount: number;
  paidUah: number;
  flaggedUah: number;
  rewardIds: number[];
}

export interface RideProofLinkedReward {
  id: number;
  rewardType: string;
  amountUah: number;
  status: string;
  flagReason: string | null;
  referrerId: number;
  referrer: { id: number; fullName: string | null; phoneNormalized: string };
}

export interface RideCompletionProofRow {
  id: number;
  personId: number;
  route: string;
  rideDate: string;
  departureTime: string | null;
  photoStartFileId: string | null;
  photoEndFileId: string | null;
  status: RideProofStatus | string;
  rejectionReason: string | null;
  flagReason: string | null;
  person: ReferralPersonBrief;
  referralRewards?: RideProofLinkedReward[];
}

export interface ReferralBudgetStatus {
  budgetUah: number;
  committedUah: number;
  remainingUah: number;
  budgetHeldUah: number;
  budgetHeldCount: number;
  exceeded: boolean;
}

export interface ReferralInviteRow {
  id: number;
  inviteContact: string;
  inviteType: string;
  status: string;
  registrationBonusEligible?: boolean;
  createdAt: string;
  referrer: { fullName: string | null; phoneNormalized: string };
  referredPerson: { fullName: string | null; phoneNormalized: string } | null;
}

export interface ReferralInvitesPage {
  items: ReferralInviteRow[];
  total: number;
  skip: number;
  take: number;
}

export interface SharedTelegramAccountGroup {
  key: string;
  persons: Array<{
    id: number;
    fullName: string | null;
    phoneNormalized: string;
    telegramUsername: string | null;
    referredByPersonId: number | null;
    unpaidUah: number;
  }>;
  selfReferralPairs: Array<{ referredPersonId: number; referrerPersonId: number }>;
  unpaidUah: number;
}

export interface PersonReferralDetails {
  person: {
    id: number;
    fullName: string | null;
    phoneNormalized: string;
    telegramUsername: string | null;
    telegramChatId: string | null;
    telegramUserId: string | null;
    referralCode: string | null;
    referredByPerson: {
      id: number;
      fullName: string | null;
      phoneNormalized: string;
      telegramUsername: string | null;
    } | null;
  };
  rewards: Array<{
    id: number;
    rewardType: string;
    amountUah: number;
    status: string;
    flagReason: string | null;
    payoutNote: string | null;
    paidAt: string | null;
    referredPerson: { id: number; fullName: string | null; phoneNormalized: string };
    rideProof: { id: number; route: string; rideDate: string; status: string } | null;
  }>;
  invitedPersons: Array<{
    id: number;
    fullName: string | null;
    phoneNormalized: string;
    telegramUsername: string | null;
  }>;
  sharedAccountPersons: Array<{
    id: number;
    fullName: string | null;
    phoneNormalized: string;
  }>;
}

export interface ReferralPersonSearchHit {
  id: number;
  fullName: string | null;
  phoneNormalized: string;
  telegramUsername: string | null;
  referredByPerson: { id: number; fullName: string | null; phoneNormalized: string } | null;
  _count: { referredPersons: number; referralRewards: number };
}

export interface AdminReferralReport {
  summary: {
    totalRewards: number;
    onHoldCount: number;
    onHoldUah: number;
    paidCount: number;
    paidUah: number;
    flaggedCount: number;
    flaggedUah: number;
    referredPersonsCount: number;
    payablePeopleCount: number;
    payableUah: number;
    personWarnLimitUah: number;
    sharedTelegramGroupCount: number;
  };
  budget: ReferralBudgetStatus;
  payoutBalances: ReferralPayoutPersonRow[];
  flagged: ReferralRewardRow[];
  invites: ReferralInvitesPage;
  sharedTelegramGroups: SharedTelegramAccountGroup[];
  promoPhotoProofs: RideCompletionProofRow[];
}

// --- Столова / обіди ---

export interface LunchMenuItemRow {
  id: number;
  name: string;
  priceUah: number;
}

export interface LunchOrderRow {
  id: number;
  participantId: number;
  displayName: string;
  username: string | null;
  rawText: string;
  totalUah: number;
  paidUah: number;
  debtUah: number;
  lines: Array<{
    rawName: string;
    qty: number;
    unitPriceUah: number;
    lineTotalUah: number;
  }>;
}

export interface LunchDaySummary {
  date: string;
  day: {
    id: number;
    status: string;
    payeeCard: string | null;
    menuMessageId: string | null;
    updatedAt: string;
  } | null;
  menuItems: LunchMenuItemRow[];
  orders: LunchOrderRow[];
  payments: Array<{
    id: number;
    displayName: string;
    amountUah: number;
    rawText: string;
    createdAt: string;
  }>;
  debts: LunchOrderRow[];
  totals: {
    orderUah: number;
    paidUah: number;
    debtUah: number;
  };
}

export interface LunchMenuImportResult {
  ok: boolean;
  day: { id: number; date: string; status: string };
  menuItems: Array<{ id: number; name: string; priceUah: number; nameNorm: string }>;
  preview: string;
  posted: boolean;
  queued?: boolean;
  postError: string | null;
}
