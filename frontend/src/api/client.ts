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
} from '@/types';

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
  async getSchedules(route?: string): Promise<Schedule[]> {
    const endpoint = route ? `/schedules?route=${route}` : '/schedules';
    return this.request<Schedule[]>(endpoint);
  }

  async getSchedulesByRoute(route: string): Promise<Schedule[]> {
    return this.request<Schedule[]>(`/schedules/${route}`);
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

  /** Персони для реклами: база = без Telegram бота. filter: no_telegram = всі з бази, no_communication = до кого ще не комунікували. */
  async getChannelPromoPersons(filter: 'no_telegram' | 'no_communication' = 'no_telegram'): Promise<Array<{ id: number; phoneNormalized: string; fullName: string | null }>> {
    return this.request<Array<{ id: number; phoneNormalized: string; fullName: string | null }>>(`/admin/channel-promo-persons?filter=${encodeURIComponent(filter)}`);
  }

  /** Відправити рекламу каналу. Після успішної відправки проставляє дату комунікації (telegramPromoSentAt). */
  async sendChannelPromo(filter: 'no_telegram' | 'no_communication' = 'no_telegram'): Promise<{
    sent: Array<{ phone: string; fullName: string | null }>;
    notFound: Array<{ phone: string; fullName: string | null }>;
  }> {
    return this.request<{ sent: Array<{ phone: string; fullName: string | null }>; notFound: Array<{ phone: string; fullName: string | null }> }>(
      '/admin/send-channel-promo',
      { method: 'POST', body: JSON.stringify({ filter }) }
    );
  }

  // Viber Listings endpoints
  async getViberListings(active?: boolean): Promise<ViberListing[]> {
    const endpoint = active !== undefined ? `/viber-listings?active=${active}` : '/viber-listings';
    return this.request<ViberListing[]>(endpoint);
  }

  async searchViberListings(route: string, date: string): Promise<ViberListing[]> {
    return this.request<ViberListing[]>(`/viber-listings/search?route=${route}&date=${date}`);
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

  async getTelegramScenarios(): Promise<TelegramScenariosResponse> {
    return this.request<TelegramScenariosResponse>('/telegram/scenarios');
  }

  async createRideShareRequestFromSite(driverListingId: number, telegramUserId: string): Promise<RideShareRequestFromSiteResponse> {
    return this.request<RideShareRequestFromSiteResponse>('/rideshare/request', {
      method: 'POST',
      body: JSON.stringify({ driverListingId, telegramUserId }),
    });
  }
}

export const apiClient = new ApiClient(API_URL);
