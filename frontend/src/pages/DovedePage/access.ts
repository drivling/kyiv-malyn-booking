/**
 * Хто бачить «Доведе» (Docs/dovede-roadmap.md, «Доступ»). Вирішує сервер: GET /dovede/access.
 * Поки Railway-змінна DOVEDE_PUBLIC не ON, сторінка просить пароль запрошених (DOVEDE_PASSWORD, окремий від
 * адмінського) прямо в рядку питання; POST /dovede/login дає токен, він живе в localStorage цього браузера.
 * Токен адміна відкриває й так. Змінили пароль — старий токен сервер не приймає, і поле знову просить пароль.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/api/client';

export const DOVEDE_TOKEN_KEY = 'dovede-token:v1';

export type DovedeAccessState = 'checking' | 'locked' | 'open';

export function readDovedeToken(): string | null {
  try {
    return localStorage.getItem(DOVEDE_TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveDovedeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(DOVEDE_TOKEN_KEY, token);
    else localStorage.removeItem(DOVEDE_TOKEN_KEY);
  } catch {
    // сховище недоступне (приватний режим) — токен живе лише до закриття вкладки
  }
}

const NETWORK_ERROR = 'Сервер не відповідає. Спробуйте ще раз.';

function loginError(e: unknown): string {
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 401) return 'Невірний пароль';
  if (typeof status === 'number' && e instanceof Error && e.message) return e.message;
  return NETWORK_ERROR;
}

export function useDovedeAccess(): {
  state: DovedeAccessState;
  /** Щойно ввели пароль: фокус переходить у рядок питання (на телефоні клавіатура не ховається) */
  justLoggedIn: boolean;
  error: string | null;
  busy: boolean;
  login: (password: string) => Promise<void>;
} {
  const [state, setState] = useState<DovedeAccessState>('checking');
  const [justLoggedIn, setJustLoggedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const stored = readDovedeToken();
    apiClient.setDovedeToken(stored);
    apiClient
      .dovedeAccess()
      .then((r) => {
        if (!alive) return;
        if (!r.allowed && stored) {
          // пароль змінили — старий токен більше не відкриває
          saveDovedeToken(null);
          apiClient.setDovedeToken(null);
        }
        setState(r.allowed ? 'open' : 'locked');
      })
      .catch(() => {
        if (!alive) return;
        setError(NETWORK_ERROR);
        setState('locked');
      });
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (password: string) => {
    setBusy(true);
    setError(null);
    try {
      const { token } = await apiClient.dovedeLogin(password);
      saveDovedeToken(token);
      apiClient.setDovedeToken(token);
      setJustLoggedIn(true);
      setState('open');
    } catch (e) {
      setError(loginError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, justLoggedIn, error, busy, login };
}
