import { API_URL } from '@/utils/constants';
import type { Schedule, Booking, Availability, BookingFormData, ScheduleFormData } from '@/types';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
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
}

export const apiClient = new ApiClient(API_URL);
