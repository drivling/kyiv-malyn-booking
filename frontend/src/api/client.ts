import { API_URL } from '@/utils/constants';
import type {
  Schedule,
  Booking,
  Availability,
  BookingFormData,
  ScheduleFormData,
  ViberListing,
  ViberListingFormData,
  TelegramScenariosResponse,
  RideShareRequestFromSiteResponse,
  AnnounceDraftResponse,
  Person,
  PersonWithCounts,
  TelegramUserSendError,
  RefreshPersonNamesResponse,
  UserProfile,
  ViberAnalyticsSummaryResponse,
  ViberAnalyticsPromoScenariosResponse,
  SendPersonPromoResponse,
  BehaviorPromoScenarioKey,
  PhoneCheckAnalyzeResponse,
  PhoneLookupReport,
  AdminReferralReport,
  PersonReferralDetails,
  ReferralBudgetStatus,
  ReferralInvitesPage,
  ReferralPersonSearchHit,
  ReferralRewardRow,
  RideCompletionProofRow,
  LunchDaySummary,
  LunchMenuImportResult,
  NotificationSettings,
  NotificationSettingsPatch,
  NotificationSettingsUsage,
} from '@/types';
import type { TransportDataset } from './transportDataset';

class ApiClient {
  private baseUrl: string;
  private authToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    // Завантажуємо токен з localStorage при ініціалізації
    if (typeof window !== 'undefined') {
      this.authToken = localStorage.getItem('adminToken');
    }
  }

  setAuthToken(token: string | null) {
    this.authToken = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('adminToken', token);
      } else {
        localStorage.removeItem('adminToken');
      }
    }
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options?.headers);
    // За замовчуванням працюємо з JSON, але не ламаємо вже заданий Content-Type
    if (!headers.has('Content-Type') && !(options?.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    // Додаємо токен авторизації для адмін endpoints
    if (this.authToken) {
      headers.set('Authorization', this.authToken);
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMessage = `Помилка ${response.status}`;
      try {
        const error = text ? JSON.parse(text) : {};
        errorMessage = error.error || error.message || errorMessage;
      } catch {
        if (text && text.length < 200) errorMessage = text;
      }
      throw new Error(errorMessage);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // Schedule endpoints
  async getSchedules(
    route?: string,
    opts?: { vehicleType?: string; date?: string; fromCode?: string; toCode?: string }
  ): Promise<Schedule[]> {
    const params = new URLSearchParams();
    if (route) params.set('route', route);
    if (opts?.vehicleType) params.set('vehicleType', opts.vehicleType);
    if (opts?.date) params.set('date', opts.date);
    if (opts?.fromCode) params.set('fromCode', opts.fromCode);
    if (opts?.toCode) params.set('toCode', opts.toCode);
    const qs = params.toString();
    return this.request<Schedule[]>(qs ? `/schedules?${qs}` : '/schedules');
  }

  async getSchedulesByRoute(route: string, opts?: { vehicleType?: string; date?: string }): Promise<Schedule[]> {
    const params = new URLSearchParams();
    if (opts?.vehicleType) params.set('vehicleType', opts.vehicleType);
    if (opts?.date) params.set('date', opts.date);
    const qs = params.toString();
    return this.request<Schedule[]>(qs ? `/schedules/${route}?${qs}` : `/schedules/${route}`);
  }

  async createSchedule(data: ScheduleFormData): Promise<Schedule> {
    return this.request<Schedule>('/schedules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSchedule(id: number, data: ScheduleFormData): Promise<Schedule> {
    return this.request<Schedule>(`/schedules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSchedule(id: number): Promise<void> {
    return this.request<void>(`/schedules/${id}`, {
      method: 'DELETE',
    });
  }

  async getTripPoints(opts?: { appearInFromTo?: boolean; appearInPoputky?: boolean }): Promise<import('@/types').TripPoint[]> {
    const params = new URLSearchParams();
    if (opts?.appearInFromTo) params.set('appearInFromTo', 'true');
    if (opts?.appearInPoputky) params.set('appearInPoputky', 'true');
    const qs = params.toString();
    return this.request(`/trip-points${qs ? `?${qs}` : ''}`);
  }

  async getTripRoutes(opts?: { corridors?: boolean; variants?: boolean }): Promise<import('@/types').TripRoute[]> {
    const params = new URLSearchParams();
    if (opts?.corridors) params.set('corridors', 'true');
    if (opts?.variants) params.set('variants', 'true');
    const qs = params.toString();
    return this.request(qs ? `/trip-routes?${qs}` : '/trip-routes');
  }

  /** Unique OD pairs from TripRoutes (corridor terminals + along-variant stops). */
  async getOdPairs(): Promise<
    Array<{
      fromCode: string;
      toCode: string;
      fromNameUk: string;
      toNameUk: string;
      labelUk: string;
      corridorTripRouteId: number | null;
      sourceTripRouteId: number;
    }>
  > {
    return this.request('/od-pairs');
  }

  async createTripRoute(data: {
    startPointId: number;
    endPointId: number;
    viaPointIds?: number[];
    labelUk?: string;
    stopOffsets?: Array<{ pointId: number; departureOffsetMinutes: number | null }>;
  }): Promise<import('@/types').TripRoute> {
    return this.request('/trip-routes', { method: 'POST', body: JSON.stringify(data) });
  }

  async updateTripRoute(
    id: number,
    data: Partial<{
      startPointId: number;
      endPointId: number;
      viaPointIds: number[];
      labelUk: string;
      stopOffsets: Array<{ pointId: number; departureOffsetMinutes: number | null }>;
    }>
  ): Promise<import('@/types').TripRoute> {
    return this.request(`/trip-routes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async deleteTripRoute(id: number): Promise<void> {
    return this.request(`/trip-routes/${id}`, { method: 'DELETE' });
  }

  async rebindScheduleTripRoutes(): Promise<{
    updated: number;
    unchanged: number;
    errors: Array<{ id: number; error: string }>;
  }> {
    return this.request('/schedules-rebind-trip-routes', { method: 'POST', body: '{}' });
  }

  async previewScheduleTimetable(data?: {
    pages?: Array<{ url: string; html: string }>;
  }): Promise<import('@/types').TimetablePreviewResponse> {
    return this.request('/schedules/timetable-preview', {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    });
  }

  async applyScheduleTimetable(data: {
    previewToken: string;
    scheduleIds: number[];
  }): Promise<{ updated: number; conflicts: Array<{ scheduleId: number; error: string }> }> {
    return this.request('/schedules/timetable-apply', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createTripPoint(data: {
    code: string;
    nameUk: string;
    requiredOnTrip?: boolean;
    appearInFromTo?: boolean;
    appearInPoputky?: boolean;
    sortOrder?: number;
    quickDirectPointIds?: number[];
  }): Promise<import('@/types').TripPoint> {
    return this.request('/trip-points', { method: 'POST', body: JSON.stringify(data) });
  }

  async updateTripPoint(
    id: number,
    data: Partial<{
      code: string;
      nameUk: string;
      requiredOnTrip: boolean;
      appearInFromTo: boolean;
      appearInPoputky: boolean;
      sortOrder: number;
      quickDirectPointIds: number[];
    }>
  ): Promise<import('@/types').TripPoint> {
    return this.request(`/trip-points/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async deleteTripPoint(id: number): Promise<void> {
    return this.request(`/trip-points/${id}`, { method: 'DELETE' });
  }

  /** Телефон підтримки для уточнення бронювання (з графіка; для напрямків з Києвом) */
  async getSchedulesSupportPhone(): Promise<{ supportPhone: string | null }> {
    return this.request<{ supportPhone: string | null }>('/schedules-support-phone');
  }

  async checkAvailability(
    route: string,
    departureTime: string,
    date: string
  ): Promise<Availability> {
    return this.request<Availability>(
      `/schedules/${route}/${departureTime}/availability?date=${date}`
    );
  }

  /** Preferred availability lookup by schedule id (route string deprecated as SoT). */
  async checkAvailabilityByScheduleId(scheduleId: number, date: string): Promise<Availability> {
    return this.request<Availability>(
      `/schedules/by-id/${scheduleId}/availability?date=${encodeURIComponent(date)}`
    );
  }

  // Booking endpoints
  async getBookings(): Promise<Booking[]> {
    return this.request<Booking[]>('/bookings');
  }

  async createBooking(data: BookingFormData): Promise<Booking> {
    return this.request<Booking>('/bookings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteBooking(id: number): Promise<void> {
    return this.request<void>(`/bookings/${id}`, {
      method: 'DELETE',
    });
  }

  /** Скасувати бронювання від імені користувача (Telegram). */
  async cancelBookingByUser(id: number, telegramUserId: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(`/bookings/${id}/by-user`, {
      method: 'DELETE',
      body: JSON.stringify({ telegramUserId }),
    });
  }

  async findLastBookingByPhone(phone: string): Promise<Booking | null> {
    return this.request<Booking | null>(`/bookings/by-phone/${encodeURIComponent(phone)}`);
  }

  // Admin auth
  async adminLogin(password: string): Promise<{ token: string; success: boolean }> {
    return this.request<{ token: string; success: boolean }>('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  /** Помилки відправки через персональний акаунт (PRIVACY_PREMIUM_REQUIRED тощо) */
  async getTelegramUserSendErrors(): Promise<TelegramUserSendError[]> {
    return this.request<TelegramUserSendError[]>('/admin/telegram-user-send-errors');
  }

  /** Обнулити таблицю помилок user-sender */
  async clearTelegramUserSendErrors(): Promise<{ deleted: number }> {
    return this.request<{ deleted: number }>('/admin/telegram-user-send-errors', { method: 'DELETE' });
  }

  async checkAdminAuth(): Promise<{ authenticated: boolean }> {
    return this.request<{ authenticated: boolean }>('/admin/check');
  }

  /** Створити контакт (Person): телефон + ім'я. Якщо номер вже є — оновлює ім'я. */
  async createPerson(phone: string, fullName: string): Promise<{ id: number; phoneNormalized: string; fullName: string | null }> {
    return this.request<{ id: number; phoneNormalized: string; fullName: string | null }>('/admin/person', {
      method: 'POST',
      body: JSON.stringify({ phone: phone.trim(), fullName: fullName.trim() }),
    });
  }

  /** Список персон для управління даними. search — пошук по телефону або імені. */
  async getPersons(search?: string): Promise<PersonWithCounts[]> {
    const q = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    return this.request<PersonWithCounts[]>(`/admin/persons${q}`);
  }

  /** Одна персона за id. */
  async getPerson(id: number): Promise<PersonWithCounts> {
    return this.request<PersonWithCounts>(`/admin/persons/${id}`);
  }

  /** Оновити персону. При зміні телефону/імені оновлюються пов’язані Booking та ViberListing. telegramPromoSentAt/telegramReminderSentAt: null або '' — обнулити. */
  async updatePerson(id: number, data: { phone?: string; fullName?: string | null; telegramChatId?: string | null; telegramUserId?: string | null; telegramUsername?: string | null; telegramPromoSentAt?: string | null; telegramReminderSentAt?: string | null }): Promise<Person> {
    return this.request<Person>(`/admin/persons/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /** Видалити персону разом із залежними записами (Booking, ViberListing, ViberRideEvent) за personId. */
  async deletePerson(id: number): Promise<{
    id: number;
    deleted: { bookings: number; viberListings: number; viberRideEvents: number };
  }> {
    return this.request<{
      id: number;
      deleted: { bookings: number; viberListings: number; viberRideEvents: number };
    }>(`/admin/persons/${id}`, {
      method: 'DELETE',
    });
  }

  /** Перевірити номера: персони без telegramChatId — спробувати знайти @username через ResolvePhone і оновити telegramUsername. */
  async checkPersonUsernames(): Promise<{ total: number; updated: number; errors?: string[] }> {
    return this.request<{ total: number; updated: number; errors?: string[] }>('/admin/persons/check-usernames', {
      method: 'POST',
    });
  }

  /** Оновити імена персон: пошук через Telegram-бота (якщо підключений), ваш акаунт (send_message.py) та Opendatabot. onlyEmpty: true — лише персони без імені в базі. onlyLatin: true — лише персони з іменем латиницею (без кирилиці). */
  async refreshPersonNames(options?: { personIds?: number[]; onlyEmpty?: boolean; onlyLatin?: boolean }): Promise<RefreshPersonNamesResponse> {
    const body =
      options?.personIds?.length
        ? { personIds: options.personIds, onlyEmpty: options.onlyEmpty, onlyLatin: options.onlyLatin }
        : options
          ? { onlyEmpty: options.onlyEmpty, onlyLatin: options.onlyLatin }
          : {};
    return this.request<RefreshPersonNamesResponse>('/admin/persons/refresh-names', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /** Персони для реклами: база = без Telegram бота. filter: no_telegram, no_communication, promo_not_found (не знайдено в Telegram). */
  async getChannelPromoPersons(filter: 'no_telegram' | 'no_communication' | 'promo_not_found' = 'no_telegram'): Promise<Array<{ id: number; phoneNormalized: string; fullName: string | null }>> {
    return this.request<Array<{ id: number; phoneNormalized: string; fullName: string | null }>>(`/admin/channel-promo-persons?filter=${encodeURIComponent(filter)}`);
  }

  /** Відправити рекламу каналу. limit — лише перші N; delaysMs — паузи в мс між відправками (напр. [5000,10000,15000,25000]). */
  async sendChannelPromo(options: {
    filter: 'no_telegram' | 'no_communication' | 'promo_not_found';
    limit?: number;
    delaysMs?: number[];
  }): Promise<{
    sent: Array<{ phone: string; fullName: string | null }>;
    notFound: Array<{ phone: string; fullName: string | null }>;
  }> {
    const { filter = 'no_telegram', limit, delaysMs } = options;
    return this.request<{ sent: Array<{ phone: string; fullName: string | null }>; notFound: Array<{ phone: string; fullName: string | null }> }>(
      '/admin/send-channel-promo',
      { method: 'POST', body: JSON.stringify({ filter, limit, delaysMs }) }
    );
  }

  /** Персони з Telegram ботом для нагадувань. filter: all, no_active_viber, no_reminder_7_days. */
  async getTelegramReminderPersons(
    filter: 'all' | 'no_active_viber' | 'no_reminder_7_days' = 'all'
  ): Promise<Array<{ id: number; phoneNormalized: string; fullName: string | null; telegramReminderSentAt: string | null }>> {
    return this.request<
      Array<{ id: number; phoneNormalized: string; fullName: string | null; telegramReminderSentAt: string | null }>
    >(`/admin/telegram-reminder-persons?filter=${encodeURIComponent(filter)}`);
  }

  /** Відправити Telegram-нагадування користувачам. Після відправки оновлюється telegramReminderSentAt. */
  async sendTelegramReminders(options: {
    filter: 'all' | 'no_active_viber' | 'no_reminder_7_days';
    limit?: number;
    delaysMs?: number[];
  }): Promise<{
    success: boolean;
    total: number;
    sent: number;
    failed: number;
    message: string;
    blocked: Array<{ id: number; phoneNormalized: string; fullName: string | null }>;
  }> {
    const { filter = 'all', limit, delaysMs } = options;
    return this.request<{
      success: boolean;
      total: number;
      sent: number;
      failed: number;
      message: string;
      blocked: Array<{ id: number; phoneNormalized: string; fullName: string | null }>;
    }>('/admin/send-telegram-reminders', {
      method: 'POST',
      body: JSON.stringify({ filter, limit, delaysMs }),
    });
  }

  /** Персональне промо «Приведи друга» (той самий фільтр, що й нагадування). */
  async sendReferralPromo(options: {
    filter: 'all' | 'no_active_viber' | 'no_reminder_7_days';
    limit?: number;
    delaysMs?: number[];
  }): Promise<{
    success: boolean;
    total: number;
    sent: number;
    failed: number;
    message: string;
    blocked: Array<{ id: number; phoneNormalized: string; fullName: string | null }>;
  }> {
    const { filter = 'all', limit, delaysMs } = options;
    return this.request<{
      success: boolean;
      total: number;
      sent: number;
      failed: number;
      message: string;
      blocked: Array<{ id: number; phoneNormalized: string; fullName: string | null }>;
    }>('/admin/send-referral-promo', {
      method: 'POST',
      body: JSON.stringify({ filter, limit, delaysMs }),
    });
  }

  /** Нагадати від особистого акаунта (тим, хто заблокував бота). Паузи між відправками: 2, 15, 25, 30 с (циклом). */
  async sendReminderViaUserAccount(phones: string[], delaysSec: number[] = [2, 15, 25, 30]): Promise<{
    success: boolean;
    sent: number;
    failed: number;
    message: string;
  }> {
    return this.request<{ success: boolean; sent: number; failed: number; message: string }>(
      '/admin/send-reminder-via-user-account',
      { method: 'POST', body: JSON.stringify({ phones, delaysSec }) }
    );
  }

  // Viber Listings endpoints
  async getViberListings(active?: boolean): Promise<ViberListing[]> {
    const endpoint = active !== undefined ? `/viber-listings?active=${active}` : '/viber-listings';
    return this.request<ViberListing[]>(endpoint);
  }

  async searchViberListings(
    routeOrOpts: string | { route?: string; fromCode?: string; toCode?: string; date: string },
    dateArg?: string
  ): Promise<ViberListing[]> {
    const params = new URLSearchParams();
    if (typeof routeOrOpts === 'string') {
      params.set('route', routeOrOpts);
      if (dateArg) params.set('date', dateArg);
    } else {
      if (routeOrOpts.route) params.set('route', routeOrOpts.route);
      if (routeOrOpts.fromCode) params.set('fromCode', routeOrOpts.fromCode);
      if (routeOrOpts.toCode) params.set('toCode', routeOrOpts.toCode);
      params.set('date', routeOrOpts.date);
    }
    return this.request<ViberListing[]>(`/viber-listings/search?${params.toString()}`);
  }

  async createViberListing(data: ViberListingFormData): Promise<ViberListing> {
    return this.request<ViberListing>('/viber-listings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createViberListingsBulk(rawMessages: string): Promise<{ 
    success: boolean; 
    created: number; 
    total: number; 
    listings: ViberListing[] 
  }> {
    return this.request('/viber-listings/bulk', {
      method: 'POST',
      body: JSON.stringify({ rawMessages }),
    });
  }

  async updateViberListing(id: number, data: Partial<ViberListing>): Promise<ViberListing> {
    return this.request<ViberListing>(`/viber-listings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deactivateViberListing(id: number): Promise<ViberListing> {
    return this.request<ViberListing>(`/viber-listings/${id}/deactivate`, {
      method: 'PATCH',
    });
  }

  async deleteViberListing(id: number): Promise<void> {
    return this.request<void>(`/viber-listings/${id}`, {
      method: 'DELETE',
    });
  }

  async cleanupOldViberListings(): Promise<{ success: boolean; deactivated: number; message: string }> {
    return this.request('/viber-listings/cleanup-old', {
      method: 'POST',
    });
  }

  /** Імпорт історичних записів з таблиці ViberRide у ViberRideEvent (аналітика). Тільки нові записи. */
  async importViberAnalytics(): Promise<{
    success: boolean;
    totalSource: number;
    alreadyImported: number;
    importedNow: number;
    message?: string;
    totalListings?: number;
    totalEvents?: number;
    deletedSourceOld?: number;
    sourceCleanupBefore?: string;
  }> {
    return this.request<{
      success: boolean;
      totalSource: number;
      alreadyImported: number;
      importedNow: number;
      message?: string;
      totalListings?: number;
      totalEvents?: number;
      deletedSourceOld?: number;
      sourceCleanupBefore?: string;
    }>('/admin/viber-analytics/import', {
      method: 'POST',
    });
  }

  /** Аналітика поведінки клієнтів за ViberRideEvent. Повертає список клієнтів з описом патернів. */
  async getViberAnalyticsSummary(options?: {
    page?: number;
    pageSize?: number;
    minRides?: number;
  }): Promise<ViberAnalyticsSummaryResponse> {
    const params: string[] = [];
    if (options?.page != null) params.push(`page=${encodeURIComponent(String(options.page))}`);
    if (options?.pageSize != null) params.push(`pageSize=${encodeURIComponent(String(options.pageSize))}`);
    if (options?.minRides != null) params.push(`minRides=${encodeURIComponent(String(options.minRides))}`);
    const query = params.length ? `?${params.join('&')}` : '';
    return this.request<ViberAnalyticsSummaryResponse>(`/admin/viber-analytics/summary${query}`);
  }

  /** Сценарії реклами для кнопок (ключі по профілю). */
  async getViberAnalyticsPromoScenarios(): Promise<ViberAnalyticsPromoScenariosResponse> {
    return this.request<ViberAnalyticsPromoScenariosResponse>('/admin/viber-analytics/promo-scenarios');
  }

  /** Відправити персональну рекламу клієнту з аналітики (через бота або особистий акаунт). */
  async sendViberAnalyticsPersonPromo(
    phoneNormalized: string,
    scenarioKey: BehaviorPromoScenarioKey,
    mainRoute?: string
  ): Promise<SendPersonPromoResponse> {
    return this.request<SendPersonPromoResponse>('/admin/viber-analytics/send-person-promo', {
      method: 'POST',
      body: JSON.stringify({ phoneNormalized, scenarioKey, mainRoute }),
    });
  }

  /** Аналіз телефонів через phonecheck.top (ігнорує "Данные не найдены", повертає результати для завантаження). */
  async analyzePhonesViaPhoneCheck(phones: string[]): Promise<PhoneCheckAnalyzeResponse> {
    return this.request<PhoneCheckAnalyzeResponse>('/admin/phonecheck/analyze', {
      method: 'POST',
      body: JSON.stringify({ phones }),
    });
  }

  /** Детальний пошук «хто це» за одним телефоном: база, Telegram, ФОП (Opendatabot), phonecheck. */
  async lookupPhone(phone: string): Promise<PhoneLookupReport> {
    return this.request<PhoneLookupReport>('/admin/phone-lookup', {
      method: 'POST',
      body: JSON.stringify({ phone: phone.trim() }),
    });
  }

  async getTelegramScenarios(): Promise<TelegramScenariosResponse> {
    return this.request<TelegramScenariosResponse>('/telegram/scenarios');
  }

  async createRideShareRequestFromSite(driverListingId: number, telegramUserId: string): Promise<RideShareRequestFromSiteResponse> {
    return this.request<RideShareRequestFromSiteResponse>('/rideshare/request', {
      method: 'POST',
      body: JSON.stringify({ driverListingId, telegramUserId }),
    });
  }

  async createAnnounceDraft(params: { role: 'driver' | 'passenger'; from: string; to: string; date: string; time?: string; priceUah?: number; notes?: string }): Promise<AnnounceDraftResponse> {
    return this.request<AnnounceDraftResponse>('/poputky/announce-draft', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  // Профіль користувача (Telegram)
  async getUserProfile(telegramUserId: string): Promise<UserProfile> {
    return this.request<UserProfile>(`/user/profile?telegramUserId=${encodeURIComponent(telegramUserId)}`);
  }

  async updateProfileName(telegramUserId: string, fullName: string | null): Promise<{ success: boolean; fullName: string | null }> {
    return this.request<{ success: boolean; fullName: string | null }>('/user/profile/name', {
      method: 'PUT',
      body: JSON.stringify({ telegramUserId, fullName }),
    });
  }

  /** Редагувати оголошення попутки (власником). */
  async updateViberListingByUser(
    id: number,
    telegramUserId: string,
    data: Partial<Pick<ViberListing, 'route' | 'date' | 'departureTime' | 'seats' | 'notes' | 'priceUah'>>
  ): Promise<ViberListing> {
    return this.request<ViberListing>(`/viber-listings/${id}/by-user`, {
      method: 'PATCH',
      body: JSON.stringify({ telegramUserId, ...data }),
    });
  }

  /** Скасувати оголошення попутки (isActive: false) власником. */
  async deactivateViberListingByUser(id: number, telegramUserId: string): Promise<ViberListing> {
    return this.request<ViberListing>(`/viber-listings/${id}/deactivate/by-user`, {
      method: 'PATCH',
      body: JSON.stringify({ telegramUserId }),
    });
  }

  // --- Реферальна програма (адмін) ---
  async getReferralReport(): Promise<AdminReferralReport> {
    return this.request<AdminReferralReport>('/admin/referrals/report');
  }

  async syncReferralApproved(): Promise<{ unlocked: number }> {
    return this.request('/admin/referrals/sync-approved', { method: 'POST' });
  }

  async setReferralBudget(
    budgetUah: number
  ): Promise<ReferralBudgetStatus & { releasedCount: number; releasedUah: number }> {
    return this.request('/admin/referrals/budget', {
      method: 'PATCH',
      body: JSON.stringify({ budgetUah }),
    });
  }

  async markReferralPayout(data: {
    personId: number;
    rewardIds?: number[];
    note?: string;
  }): Promise<{ updatedCount: number; amountUah: number; rewardIds: number[] }> {
    return this.request('/admin/referrals/payouts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async undoReferralPayout(rewardIds: number[]): Promise<{ updatedCount: number; amountUah: number }> {
    return this.request('/admin/referrals/payouts/undo', {
      method: 'POST',
      body: JSON.stringify({ rewardIds }),
    });
  }

  async getReferralInvites(opts?: {
    skip?: number;
    take?: number;
    status?: string;
  }): Promise<ReferralInvitesPage> {
    const params = new URLSearchParams();
    if (opts?.skip != null) params.set('skip', String(opts.skip));
    if (opts?.take != null) params.set('take', String(opts.take));
    if (opts?.status) params.set('status', opts.status);
    const q = params.toString();
    return this.request(`/admin/referrals/invites${q ? `?${q}` : ''}`);
  }

  async searchReferralPersons(q: string): Promise<{ items: ReferralPersonSearchHit[] }> {
    return this.request(`/admin/referrals/persons/search?q=${encodeURIComponent(q)}`);
  }

  async getPersonReferralDetails(id: number): Promise<PersonReferralDetails> {
    return this.request(`/admin/referrals/persons/${id}`);
  }

  async patchReferralReward(
    id: number,
    data: { status: string; flagReason?: string | null; payoutNote?: string | null }
  ): Promise<ReferralRewardRow> {
    return this.request<ReferralRewardRow>(`/admin/referrals/rewards/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async patchRideProof(
    id: number,
    data: { status: string; rejectionReason?: string | null }
  ): Promise<RideCompletionProofRow> {
    return this.request<RideCompletionProofRow>(`/admin/referrals/proofs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async getRideProof(id: number): Promise<RideCompletionProofRow> {
    return this.request<RideCompletionProofRow>(`/admin/referrals/proofs/${id}`);
  }

  /** CSV виплат (blob) — з авторизацією */
  async downloadReferralPayoutsCsv(): Promise<Blob> {
    const url = `${this.baseUrl}/admin/referrals/payouts.csv`;
    const headers = new Headers();
    if (this.authToken) headers.set('Authorization', this.authToken);
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text();
      let msg = `Помилка ${response.status}`;
      try {
        const err = text ? JSON.parse(text) : {};
        if (err?.error) msg = err.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return response.blob();
  }

  /** Завантажити фото підтвердження (blob URL для <img>). Не забудьте URL.revokeObjectURL. */
  async fetchRideProofPhotoObjectUrl(proofId: number, kind: 'start' | 'end'): Promise<string> {
    const url = `${this.baseUrl}/admin/referrals/proofs/${proofId}/photo/${kind}`;
    const headers = new Headers();
    if (this.authToken) headers.set('Authorization', this.authToken);
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text();
      let msg = `Помилка ${response.status}`;
      try {
        const err = text ? JSON.parse(text) : {};
        if (err?.error) msg = err.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  // --- Столова / обіди ---
  async getLunchToday(): Promise<LunchDaySummary> {
    return this.request<LunchDaySummary>('/admin/lunch/today');
  }

  async importLunchMenu(data: {
    rawJson?: string;
    items?: Array<{ name: string; price: number }>;
    postToGroup?: boolean;
  }): Promise<LunchMenuImportResult> {
    return this.request<LunchMenuImportResult>('/admin/lunch/menu', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async setLunchStatus(status: 'open' | 'ordering' | 'closed'): Promise<{
    ok: boolean;
    day: { id: number; date: string; status: string };
  }> {
    return this.request('/admin/lunch/status', {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  }

  async postLunchMenuToGroup(): Promise<{
    ok: boolean;
    queued?: boolean;
    preview: string;
    postError: string | null;
  }> {
    return this.request('/admin/lunch/post-menu', { method: 'POST' });
  }

  async reparseLunchToday(): Promise<{
    ok: boolean;
    reparse: {
      scanned?: number;
      orders?: number;
      payments?: number;
      cards?: number;
      summaries?: number;
      skipped?: number;
      errors?: string[];
    };
    summary: LunchDaySummary;
  }> {
    return this.request('/admin/lunch/reparse', { method: 'POST' });
  }

  async payLunchDebt(participantId: number, amountUah?: number): Promise<{
    ok: boolean;
    payment: { amountUah: number; ordered: number; paid: number; debt: number };
    summary: LunchDaySummary;
  }> {
    return this.request('/admin/lunch/pay', {
      method: 'POST',
      body: JSON.stringify(
        amountUah != null ? { participantId, amountUah } : { participantId }
      ),
    });
  }

  async postLunchTotals(): Promise<{
    ok: boolean;
    queued?: boolean;
    preview: string;
    postError: string | null;
  }> {
    return this.request('/admin/lunch/post-totals', { method: 'POST' });
  }

  async updateLunchOrder(
    orderId: number,
    data: {
      menuItemIds?: number[];
      lines?: Array<{ dishId?: number; menuItemId?: number; asWritten?: string; qty?: number }>;
      unmatchedText?: string | null;
      trayCount?: number | null;
    }
  ): Promise<{
    ok: boolean;
    summary: LunchDaySummary;
    telegramQueued?: boolean;
    telegramError?: string | null;
    hasReply?: boolean;
  }> {
    return this.request(`/admin/lunch/orders/${orderId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async updateLunchDish(
    dishId: number,
    data: { priceUah?: number; trayRole?: string }
  ): Promise<{ ok: boolean; summary: LunchDaySummary }> {
    return this.request(`/admin/lunch/dishes/${dishId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async addLunchDishSynonym(
    dishId: number,
    rawText: string
  ): Promise<{ ok: boolean; summary: LunchDaySummary }> {
    return this.request(`/admin/lunch/dishes/${dishId}/synonyms`, {
      method: 'POST',
      body: JSON.stringify({ rawText }),
    });
  }

  async deleteLunchDishSynonym(synonymId: number): Promise<{ ok: boolean; summary: LunchDaySummary }> {
    return this.request(`/admin/lunch/synonyms/${synonymId}`, { method: 'DELETE' });
  }

  async moveLunchDishSynonym(
    synonymId: number,
    dishId: number
  ): Promise<{ ok: boolean; summary: LunchDaySummary }> {
    return this.request(`/admin/lunch/synonyms/${synonymId}`, {
      method: 'PATCH',
      body: JSON.stringify({ dishId }),
    });
  }

  async updateLunchSettings(trayPriceUah: number): Promise<{ ok: boolean; summary: LunchDaySummary }> {
    return this.request('/admin/lunch/settings', {
      method: 'PATCH',
      body: JSON.stringify({ trayPriceUah }),
    });
  }

  async getNotificationSettings(): Promise<NotificationSettings> {
    return this.request('/admin/notification-settings');
  }

  async getNotificationSettingsUsage(): Promise<NotificationSettingsUsage> {
    return this.request('/admin/notification-settings/usage');
  }

  async updateNotificationSettings(patch: NotificationSettingsPatch): Promise<NotificationSettings> {
    return this.request('/admin/notification-settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async getTransportDataset(): Promise<TransportDataset> {
    return this.request('/transport/dataset');
  }

  async putTransportDataset(dataset: TransportDataset): Promise<{
    ok: boolean;
    counts: {
      stops: number;
      routes: number;
      routeStops: number;
      trips: number;
      segments: number;
    };
  }> {
    return this.request('/transport/dataset', {
      method: 'PUT',
      body: JSON.stringify(dataset),
    });
  }

  async recalculateTransportSegments(routeId?: string): Promise<{
    ok: boolean;
    routes: string[];
    segmentsWritten: number;
    segmentsKept: number;
    osrmRequested: number;
    osrmFailed: number;
    corrections: string[];
  }> {
    return this.request('/admin/transport/recalculate-segments', {
      method: 'POST',
      body: JSON.stringify(routeId ? { routeId } : {}),
    });
  }
}

export const apiClient = new ApiClient(API_URL);
