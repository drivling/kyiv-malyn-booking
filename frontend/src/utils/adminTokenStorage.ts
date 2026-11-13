/**
 * Де браузер тримає адмін-токен (заголовок `Authorization` для `/admin/*`).
 *
 * Токен — HMAC від ADMIN_PASSWORD (`backend/src/middleware/require-admin.ts`), однаковий для всіх
 * пристроїв, тож відкликати одну сесію на сервері нема чим. Щоб розлогінити всі браузери, не
 * змінюючи ні пароль, ні токен (`VIBER_ADMIN_TOKEN`, Viber-парсер і скрипти працюють далі),
 * міняємо назву ключа: токени під попередніми назвами стираються при першому ж завантаженні нового
 * бандла (`purgeStaleAdminTokens`, викликає `apiClient`). Наступного разу — нова назва тут, і все.
 *
 * Це «вийти на всіх пристроях», а не відкликання: скопійований токен лишається дійсним, а вкладка,
 * відкрита на старому бандлі, працює до перезавантаження. Справжнє відкликання — лише зміна пароля.
 */
export const ADMIN_TOKEN_STORAGE_KEY = 'adminToken:2026-11-14';

/** Стан входу (`utils/userState.ts`): для адміна теж несе копію токена */
const USER_STATE_KEY = 'user_state';

/** Старі назви: `adminToken` (до 2026-11-14), `adminToken:<будь-що>` (наступні заміни), `admin_token` (копія з userState) */
function isStaleAdminTokenKey(key: string): boolean {
  if (key === ADMIN_TOKEN_STORAGE_KEY) return false;
  return key === 'adminToken' || key.startsWith('adminToken:') || key === 'admin_token';
}

export function readAdminToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeAdminToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
    // сховище недоступне (приватний режим) — токен живе лише в пам'яті вкладки
  }
}

/**
 * Стерти токени під старими назвами ключа і стан входу адміна, що лишився від них
 * (`user_state` типу admin без токена під поточним ключем). Вхід через Telegram не чіпає.
 */
export function purgeStaleAdminTokens(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && isStaleAdminTokenKey(key)) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);

    const raw = localStorage.getItem(USER_STATE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw) as { type?: unknown; token?: unknown } | null;
    if (state?.type === 'admin' && state.token !== readAdminToken()) {
      localStorage.removeItem(USER_STATE_KEY);
    }
  } catch {
    // сховище недоступне або зіпсований user_state — нічого не стираємо
  }
}
