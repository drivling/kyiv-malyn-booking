/**
 * Предохранитель для писем від особистого акаунта за числовим Telegram-id (автори без username і номера).
 *
 * Сесія одна на все (Джура, обіди, юзербот): скарги на спам від незнайомих → ліміти/бан → падає все.
 * Тому такі DM: вимикаються в адмінці «Сповіщення» (`NotificationSettings.tgUserByIdEnabled`) або назавжди
 * `TELEGRAM_USER_DM_BY_ID=0` (тоді в адмінці не ввімкнути), ≤ `tgUserByIdDailyCap` за добу (Київ; не задано —
 * `TELEGRAM_USER_DM_BY_ID_DAILY_CAP`, інакше 20), а після `PEER_FLOOD` від Telegram припиняються до наступної доби.
 */
export const ID_DM_DAILY_CAP_DEFAULT = 20;

const KYIV_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });

export function idDmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TELEGRAM_USER_DM_BY_ID?.trim() !== '0';
}

export function idDmDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.TELEGRAM_USER_DM_BY_ID_DAILY_CAP);
  return Number.isFinite(n) && n >= 0 && env.TELEGRAM_USER_DM_BY_ID_DAILY_CAP?.trim() ? Math.floor(n) : ID_DM_DAILY_CAP_DEFAULT;
}

/** Що діє зараз: змінна середовища `=0` перемагає адмінку; ліміт з адмінки, інакше зі змінної / 20 */
export function idDmLimits(
  settings: { tgUserByIdEnabled?: boolean | null; tgUserByIdDailyCap?: number | null } | null,
  env: NodeJS.ProcessEnv = process.env,
): { enabled: boolean; cap: number; lockedBy: string | null; defaultCap: number } {
  const lockedBy = idDmEnabled(env) ? null : 'TELEGRAM_USER_DM_BY_ID=0';
  const defaultCap = idDmDailyCap(env);
  return {
    enabled: !lockedBy && settings?.tgUserByIdEnabled !== false,
    cap: settings?.tgUserByIdDailyCap ?? defaultCap,
    lockedBy,
    defaultCap,
  };
}

export interface IdDmGuard {
  /** true — можна писати (лічильник збільшено); false — вимкнено, ліміт або PEER_FLOOD сьогодні */
  tryAcquire(limits?: { enabled: boolean; cap: number }): boolean;
  /** Telegram сказав PEER_FLOOD — більше сьогодні не пишемо */
  trip(): void;
  used(): number;
  /** сьогодні був PEER_FLOOD */
  tripped(): boolean;
}

export function createIdDmGuard(opts: { cap?: () => number; enabled?: () => boolean; now?: () => Date } = {}): IdDmGuard {
  const cap = opts.cap ?? (() => idDmDailyCap());
  const enabled = opts.enabled ?? (() => idDmEnabled());
  const now = opts.now ?? (() => new Date());
  let day = '';
  let count = 0;
  let flooded = false;
  const roll = (): void => {
    const d = KYIV_DAY.format(now());
    if (d !== day) {
      day = d;
      count = 0;
      flooded = false;
    }
  };
  return {
    tryAcquire(limits?: { enabled: boolean; cap: number }): boolean {
      roll();
      const on = limits ? limits.enabled : enabled();
      const max = limits ? limits.cap : cap();
      if (!on || flooded || count >= max) return false;
      count++;
      return true;
    },
    trip(): void {
      roll();
      flooded = true;
    },
    used(): number {
      roll();
      return count;
    },
    tripped(): boolean {
      roll();
      return flooded;
    },
  };
}

export const idDmGuard: IdDmGuard = createIdDmGuard();
