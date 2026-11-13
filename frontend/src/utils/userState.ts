import type { UserState, TelegramUser } from '@/types';

/** Також читає `utils/adminTokenStorage.ts`: стирає стан адміна, що лишився від старого ключа токена */
const USER_STATE_KEY = 'user_state';

export const userState = {
  // Отримати поточний стан користувача
  get(): UserState {
    try {
      const stored = localStorage.getItem(USER_STATE_KEY);
      return stored ? (JSON.parse(stored) as UserState) : null;
    } catch {
      return null;
    }
  },

  // Зберегти стан користувача (сам адмін-токен для запитів тримає apiClient)
  set(state: UserState): void {
    if (state === null) {
      localStorage.removeItem(USER_STATE_KEY);
    } else {
      localStorage.setItem(USER_STATE_KEY, JSON.stringify(state));
    }
  },

  // Логін як адмін
  loginAdmin(token: string): void {
    this.set({ type: 'admin', token });
  },

  // Логін через Telegram
  loginTelegram(user: TelegramUser, phone: string): void {
    this.set({ type: 'telegram', user, phone });
  },

  // Вийти з системи
  logout(): void {
    this.set(null);
  },

  // Перевірити чи користувач адмін
  isAdmin(): boolean {
    const state = this.get();
    return state?.type === 'admin';
  },

  // Перевірити чи користувач залогінений через Telegram
  isTelegramUser(): boolean {
    const state = this.get();
    return state?.type === 'telegram';
  },

  // Отримати токен адміна (для backward compatibility)
  getAdminToken(): string | null {
    const state = this.get();
    return state?.type === 'admin' ? state.token : null;
  },

  // Отримати номер телефону Telegram користувача
  getTelegramPhone(): string | null {
    const state = this.get();
    return state?.type === 'telegram' ? state.phone : null;
  },

  // Отримати повну інформацію про Telegram користувача
  getTelegramUser(): TelegramUser | null {
    const state = this.get();
    return state?.type === 'telegram' ? state.user : null;
  },
};
