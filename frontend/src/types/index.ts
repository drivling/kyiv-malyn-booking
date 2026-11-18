export type Route = string;

// Спрощений напрямок для UI бронювання
export type Direction = 'Kyiv-Malyn' | 'Malyn-Kyiv' | 'Malyn-Zhytomyr' | 'Zhytomyr-Malyn' | 'Korosten-Malyn' | 'Malyn-Korosten';
// Синонім для сумісності зі старим кодом
export type BaseDirection = Direction;

export type VehicleType = 'marshrutka' | 'elektrichka';

export interface TripPoint {
  id: number;
  code: string;
  nameUk: string;
  requiredOnTrip: boolean;
  appearInFromTo: boolean;
  appearInPoputky: boolean;
  /** Чи є в місті локальний транспорт (розклад міських маршруток) */
  hasLocalTransport?: boolean;
  /** Curated ids for quick-pick chips «X ↔ this city» */
  quickDirectPointIds?: number[];
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TripRoute {
  id: number;
  slug: string;
  labelUk: string;
  startPointId: number;
  endPointId: number;
  corridorTripRouteId?: number | null;
  /** скільки легковик їде маршрутом, хв — для часу прибуття попуток у «Доведе» */
  carDurationMinutes?: number | null;
  startPoint?: TripPoint | null;
  endPoint?: TripPoint | null;
  stops?: Array<{
    id: number;
    pointId: number;
    position: number;
    role: string;
    departureOffsetMinutes?: number | null;
    point?: TripPoint;
  }>;
}

export interface Schedule {
  id: number;
  route: Route;
  departureTime: string;
  maxSeats: number;
  supportPhone: string | null;
  /** Ціна місця в грн; null якщо ще не задано */
  priceUah?: number | null;
  tripRouteId?: number;
  tripRoute?: TripRoute | null;
  startPointId?: number | null;
  endPointId?: number | null;
  startPoint?: TripPoint | null;
  endPoint?: TripPoint | null;
  viaPointIds?: number[];
  vehicleType?: VehicleType | string;
  boardingPlace?: string | null;
  alightingPlace?: string | null;
  tripNumber?: string | null;
  arrivalTime?: string | null;
  durationMinutes?: number | null;
  ticketPurchaseUrl?: string | null;
  /** URL сторінки розкладу (SW Railway) для парсера */
  timetableSourceUrl?: string | null;
  activeWeekdays?: number[];
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
  /** Лише у відповіді POST /bookings: «Зубастик» поки бронюється тільки за телефоном */
  phoneOnly?: boolean;
  notice?: string;
}

export interface Availability {
  scheduleId: number;
  maxSeats: number;
  bookedSeats: number;
  availableSeats: number;
  isAvailable: boolean;
}

export interface BookingFormData {
  /** Preferred identity for marshrutka bookings */
  scheduleId?: number;
  /** Denormalized slug snapshot / legacy clients */
  route?: Route;
  date: string;
  departureTime: string;
  seats: number;
  name: string;
  phone: string;
  telegramUserId?: string; // Опціонально - для прив'язки до Telegram
}

export interface ScheduleFormData {
  route?: Route;
  departureTime: string;
  maxSeats: number;
  supportPhone?: string;
  priceUah?: number | null;
  startPointId?: number;
  endPointId?: number;
  viaPointIds?: number[];
  /** Minutes after schedule departure for each stop point (shared on TripRouteStop). */
  stopOffsets?: Array<{ pointId: number; departureOffsetMinutes: number | null }>;
  vehicleType?: VehicleType | string;
  boardingPlace?: string | null;
  alightingPlace?: string | null;
  tripNumber?: string | null;
  arrivalTime?: string | null;
  durationMinutes?: number | null;
  ticketPurchaseUrl?: string | null;
  timetableSourceUrl?: string | null;
  activeWeekdays?: number[];
}

export type TimetableChangeStatus =
  | 'changed'
  | 'unchanged'
  | 'not_found'
  | 'ambiguous'
  | 'no_board_time';

export interface TimetablePatchFields {
  departureTime: string | null;
  arrivalTime: string | null;
  durationMinutes: number | null;
  activeWeekdays: number[];
  alightingPlace: string | null;
  daysNote: string | null;
}

export interface TimetableChangeRow {
  scheduleId: number;
  tripNumber: string;
  route: string;
  timetableSourceUrl: string;
  status: TimetableChangeStatus;
  before: TimetablePatchFields;
  after: TimetablePatchFields;
}

export interface TimetablePreviewResponse {
  previewToken: string;
  changes: TimetableChangeRow[];
  pageTrainsUnmatched: Array<{
    url: string;
    tripNumber: string;
    daysNote: string;
    destinationLabel: string;
  }>;
  errors: Array<{ url: string; error: string }>;
  summary: {
    changed: number;
    unchanged: number;
    notFound: number;
    ambiguous: number;
    errors: number;
  };
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

/**
 * Публічна форма оголошення (сайт, пошук): без телефону й сирого тексту — контакт
 * приходить окремим кліком через /viber-listings/:id/contact. Повний рядок — AdminViberListing.
 */
export interface ViberListing {
  id: number;
  /** Лише в адмінських відповідях */
  rawMessage?: string;
  source?: string; // "Viber1" | "telegram1"
  /** Лише в адмінських відповідях: першоджерело в Telegram-групі (імпорт) */
  sourceChat?: string | null;
  sourceTopicId?: number | null;
  sourceMessageId?: number | null;
  /** Лише в адмінських відповідях: посилання на повідомлення в групі */
  sourceUrl?: string | null;
  senderName: string | null;
  listingType: ViberListingType;
  route: string;
  tripRouteId?: number | null;
  fromPointId?: number | null;
  toPointId?: number | null;
  date: string;
  departureTime: string | null;
  seats: number | null;
  /** Лише в адмінських відповідях та у власних оголошеннях користувача */
  phone?: string;
  notes: string | null;
  priceUah?: number | null;
  isActive: boolean;
  /** Коли автору надіслано підтвердження про публікацію (бот / акаунт / SMS). null — ще ні. */
  authorNotifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Повний рядок ViberListing — GET /viber-listings з адмін-токеном, create/update/deactivate. */
export type AdminViberListing = ViberListing & { rawMessage: string; phone: string };

/** GET /poputky/search — попутки + розклад + вільні місця одним запитом. */
export interface PoputkySearchResponse {
  from: { id: number; code: string; nameUk: string } | null;
  to: { id: number; code: string; nameUk: string } | null;
  date: string;
  listings: ViberListing[];
  schedules: Schedule[];
  availability: Record<number, Availability>;
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
  telegramBotBlockedAt: string | null;
  smsOptOut: boolean;
  /** Адмін заборонив користуватися номером (скарга). null — дозволено. */
  phoneBlockedAt: string | null;
  phoneBlockReason: string | null;
  /** Остання спроба заблокованого номера зайти (рахуються вікна по 10 хв, не кожен клік). */
  blockedAttemptAt: string | null;
  blockedAttemptCount: number;
  /** Коли дані заархівовано й вичищено з робочих таблиць. */
  dataArchivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Скільки рядків прибрано з кожної таблиці під час архівації. */
export interface PersonArchiveCounts {
  bookings: number;
  viberListings: number;
  viberRideEvents: number;
  rideShareRequests: number;
  matchNotifications: number;
  rideCompletionProofs: number;
  referralInvites: number;
  referralRewardsDeleted: number;
  referralRewardsKeptPaid: number;
  referralRewardsFlagged: number;
  smsSendLogs: number;
  telegramUserSendErrors: number;
  pendingReferralCodes: number;
}

/** Рядок вкладки «Архів» (без payload — він великий). */
export interface PersonDataArchiveSummary {
  id: number;
  personId: number | null;
  phoneNormalized: string;
  fullName: string | null;
  reason: string;
  deletedCounts: PersonArchiveCounts;
  createdAt: string;
}

/** Архів разом із повним JSON-знімком. */
export interface PersonDataArchiveDetail extends PersonDataArchiveSummary {
  payload: unknown;
}

/** Відповідь POST /admin/persons/:id/archive */
export interface ArchivePersonResponse {
  archiveId: number;
  personId: number;
  phoneNormalized: string;
  archivedAt: string;
  counts: PersonArchiveCounts;
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

/** Детальний звіт «хто це» за телефоном (адмінка → Дані). */
export interface PhoneLookupReport {
  phone: string;
  person: {
    id: number;
    phoneNormalized: string;
    fullName: string | null;
    telegramChatId: string | null;
    telegramUserId: string | null;
    telegramUsername: string | null;
    bookings: number;
    viberListings: number;
  } | null;
  telegram: {
    name: string | null;
    username: string | null;
  };
  opendatabot: {
    url: string;
    foundCountDeclared: number | null;
    entries: Array<{ type: string; name: string }>;
    shortName: string | null;
    error?: string;
  };
  phonecheck: {
    url: string;
    hasData: boolean;
  } | null;
  suggestedName: string | null;
  reportText: string;
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

/** Відповідь DELETE /user (backend/src/person-erase.ts) */
export interface DeleteAccountResponse {
  success: boolean;
  erasedAt: string;
  counts: Record<string, number | boolean>;
  /** Підсумок людині українською («скасовано майбутніх бронювань: 2; …») */
  summary: string;
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
  dishId?: number;
  name: string;
  priceUah: number;
  trayRole?: string;
}

export interface LunchDishSynonymRow {
  id: number;
  rawText: string;
  /** Нормалізований текст (за ним матчер порівнює); однаковий у двох страв = конфлікт */
  rawNorm?: string;
}

export interface LunchDishRow {
  id: number;
  name: string;
  priceUah: number;
  trayRole: string;
  synonyms: LunchDishSynonymRow[];
}

export interface LunchOrderRow {
  id: number;
  participantId: number;
  displayName: string;
  username: string | null;
  /** Повний оригінал повідомлення (не змінюється при ручному редагуванні) */
  rawText: string;
  /** Фрагменти, які автомат не зіставив з меню */
  unmatchedText: string | null;
  totalUah: number;
  trayCount: number;
  trayTotalUah: number;
  trayCountManual?: boolean;
  hasReply?: boolean;
  /** Людина написала, що віддасть готівкою */
  cashPromised?: boolean;
  paidUah: number;
  debtUah: number;
  lines: Array<{
    menuItemId: number | null;
    dishId?: number | null;
    /** Канонічна назва з меню (як у формі редагування) */
    menuItemName?: string | null;
    trayRole?: string | null;
    rawName: string;
    qty: number;
    unitPriceUah: number;
    lineTotalUah: number;
    unavailable?: boolean;
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
  trayPriceUah: number;
  dishes: LunchDishRow[];
  menuItems: LunchMenuItemRow[];
  orders: LunchOrderRow[];
  payments: Array<{
    id: number;
    displayName: string;
    amountUah: number;
    rawText: string;
    /** text — «оплатив 150» у чаті | admin — кнопка «Оплатив» | receipt — сума з чека | link — посилання на чек |
     *  claim — «скинула гроші» без суми й чека */
    source?: LunchPaymentSource;
    createdAt: string;
  }>;
  debts: LunchOrderRow[];
  totals: {
    orderUah: number;
    paidUah: number;
    debtUah: number;
  };
}

export type LunchPaymentSource = 'text' | 'admin' | 'receipt' | 'link' | 'claim';

/** Одна модель на одному фото/PDF у порівнянні моделей розпізнавання. */
export interface LunchOcrCompareResult {
  model: string;
  seconds: number;
  error: string | null;
  /** menu | receipt | other (немає, якщо модель впала) */
  kind?: string;
  /** скільки страв у меню */
  items?: number;
  /** сума з чека, грн */
  amountUah?: number | null;
  costUsd?: number | null;
  /** чи збіглось з еталонною (першою) моделлю */
  agree?: boolean;
  /** лише меню: чим відрізняється від еталонного */
  menuDiff?: { missing: string[]; extra: string[]; prices: Array<{ name: string; base: number; other: number }> };
}

export interface LunchOcrCompareReport {
  date: string;
  models: string[];
  baseline: string;
  media: Array<{ messageId: number; source: string; time: string; results: LunchOcrCompareResult[] }>;
  summary: Array<{
    model: string;
    media: number;
    menu: number;
    receipt: number;
    other: number;
    errors: number;
    agree: number;
    costUsd: number;
    seconds: number;
  }>;
  /** фото понад ліміт або завеликі */
  skipped: number;
}

export interface LunchOcrCompareJob {
  id: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  params: { date?: string; models?: string[] } | null;
  result: LunchOcrCompareReport | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Що сталося з одним повідомленням під час розбору дня/людини. */
export interface LunchReparseDetail {
  messageId: number | null;
  name: string;
  text: string;
  /** order | payment | card | summary | skipped */
  outcome: string;
  reason: string;
}

export interface LunchReparseReport {
  scanned?: number;
  orders?: number;
  payments?: number;
  cards?: number;
  summaries?: number;
  skipped?: number;
  errors?: string[];
  details?: LunchReparseDetail[];
  /** лише розбір людини */
  person?: { tgUserId: string; name: string };
  source?: 'telegram' | 'dzhura' | 'none';
  messages?: number;
  warnings?: string[];
  replaced?: boolean;
  placeholder?: boolean;
  notified?: boolean;
  /** підтвердження — правка нашої попередньої відповіді в групі, а не нова */
  notifiedEdit?: boolean;
}

export interface LunchPersonMessage {
  tgMessageId: string;
  sentAt: string;
  editedAt: string | null;
  text: string;
  mediaKind: string | null;
}

/** Людина, що писала в групі обідів сьогодні (з бази «Джури»). */
export interface LunchPerson {
  tgUserId: string;
  name: string;
  username: string | null;
  isMe: boolean;
  participantId: number | null;
  orderId: number | null;
  hasOrder: boolean;
  orderTotalUah: number | null;
  messageCount: number;
  messages: LunchPersonMessage[];
}

export interface LunchDayPeople {
  date: string;
  /** false — чат обідів ще не потрапив у «Джуру» */
  available: boolean;
  people: LunchPerson[];
}

export interface LunchMenuImportResult {
  ok: boolean;
  day: { id: number; date: string; status: string };
  menuItems: Array<{ id: number; name: string; priceUah: number; nameNorm: string }>;
  notices?: Array<{ displayName: string; missingDishes: string[] }>;
  preview: string;
  posted: boolean;
  queued?: boolean;
  postError: string | null;
}

// --- «Джура» · фаза 0 (читання чатів Telegram у базу, /admin/dzhura) ---
export type DzhuraChatKind = 'group' | 'supergroup' | 'private' | 'channel';

/** Рядок чату з /admin/dzhura/chats. Telegram-id — рядки (BigInt на бекенді). */
export interface DzhuraChatRow {
  id: number;
  tgChatId: string;
  kind: DzhuraChatKind;
  title: string;
  username: string | null;
  membersCount: number | null;
  isLunchGroup: boolean;
  captureEnabled: boolean;
  relayToSaved: boolean;
  /** «Автовідповідь» (лише особисті чати): не відповіли за autoReplyDelaySec секунд — відповідає Claude */
  autoReplyEnabled: boolean;
  autoReplyDelaySec: number;
  autoReplyNote: string | null;
  lastMessageAt: string | null;
  lastCapturedAt: string | null;
  dialogSyncedAt: string | null;
  messagesCount: number;
}

/** PATCH /admin/dzhura/chats/:id */
export interface DzhuraChatPatch {
  captureEnabled?: boolean;
  relayToSaved?: boolean;
  autoReplyEnabled?: boolean;
  autoReplyDelaySec?: number;
  autoReplyNote?: string | null;
}

/** Черга дублів у «Обране» */
export interface DzhuraQueueStats {
  pending: number;
  retrying: number;
  failed24h: number;
}

export interface DzhuraStatus {
  listenerWanted: boolean;
  heartbeatAt: string | null;
  heartbeatFresh: boolean;
  dialogsSyncedAt: string | null;
  meTgUserId: string | null;
  queue: DzhuraQueueStats;
  /** чи є в бекенда ключ Claude (без нього автовідповідь не працює) */
  autoReplyAvailable: boolean;
}

/** Рядок збереженого повідомлення для перегляду в адмінці */
export interface DzhuraMessageRow {
  id: number;
  tgMessageId: string;
  sentAt: string;
  sender: { tgUserId: string; name: string; username: string | null } | null;
  isOutgoing: boolean;
  /** вихідне повідомлення написала автовідповідь, а не власник */
  isAutoReply: boolean;
  text: string;
  mediaKind: string | null;
  replyToTgMessageId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  source: string;
  reactions: Array<{ emoji: string; by: string | null; isMine: boolean }>;
  reactionsCounts: Record<string, number> | null;
}

export interface DzhuraMessagesPage {
  messages: DzhuraMessageRow[];
  nextBeforeId: number | null;
}

export type DzhuraJobType = 'sync_dialogs' | 'backfill' | 'autoreply_preview';
export type DzhuraJobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface DzhuraJob {
  id: number;
  type: DzhuraJobType;
  status: DzhuraJobStatus;
  params: Record<string, unknown> | null;
  progress: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  errorText: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type DzhuraJobRequest =
  | { type: 'sync_dialogs' }
  | { type: 'backfill'; chatId: number; from: string; to: string }
  | { type: 'autoreply_preview'; chatId: number };

export type SmsMatchTypeThreshold = 'exact' | 'exact_approximate' | 'all';

/** Налаштування логіки сповіщень + платного SMS-фолбеку (токен ніколи не повертається). */
export interface NotificationSettings {
  id: number;
  smsFallbackEnabled: boolean;
  smsMatchEnabled: boolean;
  smsAuthorConfirmationEnabled: boolean;
  smsBookingReminderEnabled: boolean;
  smsInactivityReminderEnabled: boolean;
  smsChannelPromoEnabled: boolean;
  smsMatchTypeThreshold: SmsMatchTypeThreshold;
  smsDailyCap: number;
  smsMonthlyCap: number;
  turboSmsSender: string | null;
  hasToken: boolean;
  tokenHint: string | null;
  updatedAt: string;
}

export type NotificationSettingsPatch = Partial<{
  smsFallbackEnabled: boolean;
  smsMatchEnabled: boolean;
  smsAuthorConfirmationEnabled: boolean;
  smsBookingReminderEnabled: boolean;
  smsInactivityReminderEnabled: boolean;
  smsChannelPromoEnabled: boolean;
  smsMatchTypeThreshold: SmsMatchTypeThreshold;
  smsDailyCap: number;
  smsMonthlyCap: number;
  turboSmsSender: string | null;
  /** Порожній рядок / маска → бекенд не чіпає наявний токен; null → очищення. */
  turboSmsToken: string | null;
}>;

export interface SmsSendLogEntry {
  id: number;
  phoneNormalized: string;
  useCase: string;
  channel: string;
  status: string;
  segments: number | null;
  errorText: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface NotificationSettingsUsage {
  sentToday: number;
  capToday: number;
  sentThisMonth: number;
  capThisMonth: number;
  recent: SmsSendLogEntry[];
}

/** Наклейка зупинки: a | b — бік дороги, s — одна наклейка з обома боками (backend/src/sticker-scans.ts) */
export type StickerSide = 'a' | 'b' | 's';

/** GET /admin/transport/sticker-scans — відкриття табло з QR-наклейок */
export interface StickerScanStat {
  stopId: string;
  side: StickerSide;
  total: number;
  /** За сьогоднішню київську добу (немає у відповіді старішого бекенда) */
  today?: number;
  last7d: number;
  last30d: number;
  lastAt: string | null;
}

/** GET /transport/sticker-wall?key= — віджет «Відкриття з QR» на стіну (сьогодні за Києвом) */
export interface StickerWallSnapshot {
  now: string;
  /** Київська доба знімка (YYYY-MM-DD) */
  day: string;
  total: number;
  /** Учора до тієї самої години й хвилини */
  yesterdaySameTime: number;
  /** Сьогодні по годинах доби (0–23) */
  hourly: number[];
  stops: {
    stopId: string;
    today: number;
    lastHour: number;
    last3h: number;
    lastAt: string | null;
    hourly: number[];
  }[];
  /** Нові скани з id > after */
  events: { id: number; stopId: string; side: string; createdAt: string }[];
  lastId: number;
  /** Найкраща доба за 90 днів до сьогодні */
  bestDay: { day: string; count: number } | null;
}

/** POST /ads/events — подія перегляду реклами «Доведе» (ads/adEvents.ts) */
export interface AdEventBody {
  placement: 'sticker' | 'dovede';
  /** page і punched — лише dovede: відкрив сторінку з доступом / прокомпостував талон після ролика */
  event: 'shown' | 'started' | 'completed' | 'page' | 'punched';
  viewId: string;
  clientId?: string;
  video?: string;
  stopId?: string;
  city?: string;
}

type AdCounts = { shown: number; started: number; completed: number };

/** GET /ads/wall?key= — вкладка «Реклама» на стіні наклейок */
export interface AdWallSnapshot {
  now: string;
  day: string;
  sticker: { today: AdCounts; total: AdCounts; people: number };
  dovede: {
    /** punched — прокомпостували талон після ролика (з 2026-11-17; старий бекенд — немає) */
    today: AdCounts & { pages: number; punched?: number };
    total: AdCounts & { pages: number; punched?: number };
    access: { admin: number; guest: number; public: number };
    /** Ті самі входи, лише сьогодні (з 2026-11-17; старий бекенд — немає) */
    todayAccess?: { admin: number; guest: number; public: number };
    people: number;
  };
  views: {
    viewId: string;
    placement: 'sticker' | 'dovede';
    kind: 'view' | 'page';
    stopId: string | null;
    device: string | null;
    who: string | null;
    /** Номер пасажира з наклейок у місті стіни, якщо цей браузер приходив із наклейки */
    number?: number | null;
    seenBefore: number;
    access: string | null;
    at: string;
    started: boolean;
    completed: boolean;
    /** Лише «Доведе»: прокомпостував талон після ролика */
    punched?: boolean;
  }[];
}

/** Номер пасажира й коротка історія браузера — відповідь скану наклейки (backend sticker-people.ts) */
export interface PassengerSummary {
  number: number;
  scans: number;
  stops: number;
  firstStopId: string;
  firstAt: string;
  isNew: boolean;
}

export interface StickerScanResult {
  ok: boolean;
  counted: boolean;
  /** Лише коли скан ніс id браузера */
  person?: PassengerSummary;
}

/** Вкладка «Люди» на стіні наклейок (GET /transport/sticker-wall/people) */
export interface PeopleWallSnapshot {
  now: string;
  day: string;
  /** Людей у місті — це й номер останнього пасажира */
  total: number;
  today: { new: number; returned: number };
  yesterday: { new: number };
  returned7d: number;
  d90: { new: number; returned: number; multiStop: number; teaser: number };
  people: {
    number: number;
    who: string;
    firstStopId: string;
    lastStopId: string;
    stops: number;
    scans: number;
    scanDays: number;
    returns: number;
    isNew: boolean;
    kind: 'scan' | 'return';
    at: string;
    teaser: boolean;
  }[];
}

/** Підвкладка «Люди» в адмінці наклейок (GET /admin/transport/sticker-people) */
export interface StickerPeopleStats {
  days: StickerStatsDays;
  total: number;
  newInPeriod: number;
  returning: number;
  multiStop: number;
  teaser: number;
  daily: { day: string; count: number }[];
  firstStops: { stopId: string; count: number }[];
  people: {
    number: number;
    who: string;
    firstStopId: string;
    firstAt: string;
    lastAt: string;
    scans: number;
    stopIds: string[];
    scanDays: number;
    returns: number;
    teaser: boolean;
  }[];
}

/** Вікно графіків статистики наклейок, днів; 1 — сьогодні (київська доба від півночі) */
export type StickerStatsDays = 1 | 7 | 30 | 90;

export interface StickerScanStats {
  rows: StickerScanStat[];
  total: number;
  today?: number;
  last7d: number;
  last30d: number;
  days: StickerStatsDays;
  /** Відкриття по київських добах (YYYY-MM-DD) за вікно days */
  daily: { day: string; stopId: string; side: StickerSide; count: number }[];
  /** Відкриття по годинах доби (0–23, Київ) за вікно days */
  hourly: { hour: number; stopId: string; side: StickerSide; count: number }[];
  /** Друк / завантаження SVG наклейок в адмінці */
  printed: { stopId: string; side: StickerSide; count: number; lastAt: string | null }[];
  /** Люди з наклейок за анонімним id браузера (немає у відповіді старішого бекенда) */
  audience?: StickerAudience;
}

/** Люди з наклейок: сканували (різні id) і хто з них потім знову відкривав сайт */
export interface StickerAudience {
  scanners: number;
  returning: number;
  /** Повернень за вікно days */
  returns: number;
  /** reload — відновлена вкладка табло з utm_source=reload; tab — повернулись до відкритої вкладки; direct — інакше */
  byVia: { reload: number; tab?: number; direct: number };
  rows: { stopId: string; side: StickerSide; scanners: number; returning: number; returns: number }[];
}

/** POST /transport/sticker-returns */
export interface StickerReturnBody {
  /** Наклейка, з якої людина прийшла вперше */
  stopId: string;
  side: StickerSide;
  clientId: string;
  via: 'reload' | 'tab' | 'direct';
  /** Перший сегмент шляху: transport | mizhgorodski | home | … */
  page: string;
}

/** Факт прибуття міського автобуса від пасажира (backend/src/arrival-reports.ts) */
export type ArrivalReportKind = 'arrived' | 'missed';

/** POST /transport/arrival-reports */
export interface ArrivalReportBody {
  kind: ArrivalReportKind;
  routeId: string;
  tripId: string;
  direction: 'there' | 'back';
  stopId: string;
  /** Час рейсу на зупинці за розкладом, HH:MM */
  scheduledTime: string;
  source: 'route' | 'board';
  /** arrived: скільки хвилин тому приїхав (0–30) */
  minutesAgo?: number;
  /** missed: скільки хвилин людина чекала */
  waitedMin?: number;
  clientId?: string;
  /** Момент натискання (ISO, годинник телефона) — звіт із outbox може прийти через години */
  occurredAt?: string;
  /** Id запису в outbox: повтор із тим самим id не створює другого рядка */
  clientEventId?: string;
}

export interface ArrivalReportResult {
  ok: boolean;
  counted: boolean;
  /** Фактичний київський час (від occurredAt або годинника сервера); для missed — null */
  actualTime: string | null;
  delayMin: number | null;
}

export type ArrivalReportDays = 1 | 7 | 30 | 90;

export interface ArrivalReportView {
  id: number;
  kind: ArrivalReportKind;
  routeId: string;
  tripId: string;
  direction: 'there' | 'back';
  stopId: string;
  serviceDate: string;
  scheduledTime: string;
  actualTime: string | null;
  delayMin: number | null;
  waitedMin: number | null;
  source: 'route' | 'board';
  clientId: string | null;
  /** Id запису в outbox браузера; null — надіслано одразу або старий клієнт */
  clientEventId?: string | null;
  createdAt: string;
}

/** Зовнішнє джерело розкладу, за яким стежить бекенд (GET /admin/transport/sources) */
export interface WatchedSource {
  key: string;
  kind: 'html-tables' | 'ckan';
  cityCode: string;
  label: string;
  url: string;
  /** Дата зміни за даними самого джерела */
  modified: string | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  acknowledgedAt: string | null;
  /** Є зміна, яку ще не позначено переглянутою */
  pending: boolean;
  /** Що змінилось востаннє: номери маршрутів або файли набору */
  changed: string[];
  /** Докладно, якщо джерело розбирається парсером: «№6: − 07:00–07:25 …», «№6: + 07:05–07:30 …» */
  changeLines?: string[];
  parts: number;
  failCount: number;
  lastError: string | null;
}

/** GET /admin/transport/arrival-reports — зведення по рейсах на зупинках і останні звіти */
export interface ArrivalReportStats {
  days: ArrivalReportDays;
  total: number;
  arrived: number;
  missed: number;
  summary: {
    routeId: string;
    direction: 'there' | 'back';
    stopId: string;
    scheduledTime: string;
    arrived: number;
    missed: number;
    avgDelay: number | null;
    minDelay: number | null;
    maxDelay: number | null;
    days: number;
    lastAt: string;
  }[];
  recent: ArrivalReportView[];
}

// --- «Доведе» · журнал питань (GET /admin/dovede/queries) ---
export type DovedeLogDays = 1 | 7 | 30 | 90;
/** fail — ШІ не відповів; disagree — браузер і Claude зрозуміли по-різному; unknown — невпізнані слова; no_place — немає «звідки» чи «куди»; other — не про дорогу */
export type DovedeLogFlag = 'fail' | 'disagree' | 'unknown' | 'no_place' | 'other';

export interface DovedeLogItem {
  id: number;
  createdAt: string;
  text: string;
  status: string;
  aiCalled: boolean;
  agree: boolean | null;
  latencyMs: number | null;
  model: string | null;
  promptVersion: string | null;
  error: string | null;
  local: import('@/pages/DovedePage/nlu/types').TripIntent | null;
  ai: import('@/pages/DovedePage/nlu/types').TripIntent | null;
  flags: DovedeLogFlag[];
}

export interface DovedeLog {
  days: DovedeLogDays;
  since: string;
  enabled: boolean;
  hasKey: boolean;
  dailyCap: number;
  callsToday: number;
  truncated: boolean;
  summary: {
    total: number;
    aiCalls: number;
    aiOk: number;
    aiFailed: number;
    agreed: number;
    disagreed: number;
    withUnknown: number;
    noPlace: number;
    medianLatencyMs: number | null;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
    byStatus: { status: string; count: number }[];
    topUnknown: { word: string; count: number; example: string }[];
  };
  /** скільки питань за період пройшло фільтр (у `items` — лише останні) */
  matched: number;
  items: DovedeLogItem[];
}

/** «Доведе» · час авто між містами (GET /dovede/drive-time): сталий з адмінки й за годинами виїзду */
export interface DovedeDriveTime {
  fixedMinutes: number;
  /** traffic — хоча б одну годину пораховано із заторами */
  source: 'traffic' | 'fixed';
  minutes: Record<string, number>;
}

/** «Доведе» · транспорт Києва й Житомира в нашій базі (GET /admin/dovede/city) */
export interface DovedeCityStats {
  enabled: boolean;
  /** знайдене пишеться в базу */
  store: boolean;
  hasKey: boolean;
  callsToday: number;
  dailyCap: number;
  /** скільки днів збережена відповідь вважається свіжою (власник міняє в адмінці) */
  freshDays: number;
  /** значення з коду, поки власник не задав свого */
  freshDaysDefault?: number;
  /** збережених відповідей з Google, старших за строк свіжості (людям не віддаються) */
  staleRoutes?: number;
  /** фонове навчання оновлює їх саме (DOVEDE_CITY_REFRESH) */
  refresh?: boolean;
  /** остання відмова Google від запуску сервера: статус (429 — квота, 403 — доступ) і його власний текст */
  googleError?: { at: string; status: number; message: string } | null;
  archivedRoutes: number;
  routes: Array<{ city: string; source: string; count: number }>;
  lines: Array<{ city: string; count: number }>;
  stops: Array<{ city: string; count: number }>;
  demand: Array<{ city: string; from: string; to: string; asked: number; answered: boolean; lastAskedAt: string }>;
}

/** «Доведе» · місце словами зі збереженими дорогами містом (GET /admin/dovede/city/places) */
export interface DovedeCityPlace {
  city: string;
  /** ключ у базі: слова людини малими літерами */
  key: string;
  label: string;
  /** збережені дороги з Google, які віддаємо */
  routes: number;
  archivedRoutes: number;
  /** найкоротша й найдовша збережена дорога, хв */
  minMinutes: number | null;
  maxMinutes: number | null;
  /** null — місце не в архіві */
  archivedAt: string | null;
}

/** «Доведе» · примітки оголошень водіїв за період (GET /admin/dovede/pickups) — без імен і телефонів */
export interface DovedePickups {
  days: number;
  total: number;
  routes: Array<{ route: string; total: number; withNote: number }>;
  notes: Array<{ route: string; note: string; count: number }>;
}

/** «Доведе» · синонім з адмінки: фраза, якою люди називають місце, → id місця */
export interface DovedeSynonymRow {
  id: number;
  phrase: string;
  placeId: string;
  createdAt: string;
}
