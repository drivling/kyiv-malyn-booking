import type { UserState, TelegramUser } from '@/types';

const USER_STATE_KEY = 'user_state';
const ADMIN_TOKEN_KEY = 'admin_token'; // Backward compatibility

export const userState = {
  // Отримати поточний стан користувача
  get(): UserState {
    try {
      const stored = localStorage.getItem(USER_STATE_KEY);
      if (stored) {
        return JSON.parse(stored) as UserState;
      }
      
      // Backward compatibility: перевірка старого токену адміна
      const oldToken = localStorage.getItem(ADMIN_TOKEN_KEY);
      if (oldToken) {
        return { type: 'admin', token: oldToken };
      }
      
      return null;
    } catch {
      return null;
    }
  },

  // Зберегти стан користувача
  set(state: UserState): void {
    if (state === null) {
      localStorage.removeItem(USER_STATE_KEY);
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    } else {
      localStorage.setItem(USER_STATE_KEY, JSON.stringify(state));
      
      // Backward compatibility: зберігаємо токен окремо для існуючого коду
      if (state.type === 'admin') {
        localStorage.setItem(ADMIN_TOKEN_KEY, state.token);
      } else {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
      }
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
