/**
 * Предохранитель для писем від особистого акаунта за числовим Telegram-id (автори без username і номера).
 *
 * Сесія одна на все (Джура, обіди, юзербот): скарги на спам від незнайомих → ліміти/бан → падає все.
 * Тому такі DM: вимикаються `TELEGRAM_USER_DM_BY_ID=0`, ≤ `TELEGRAM_USER_DM_BY_ID_DAILY_CAP` за добу (Київ,
 * за замовчуванням 20), а після `PEER_FLOOD` від Telegram припиняються до наступної доби.
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

export interface IdDmGuard {
  /** true — можна писати (лічильник збільшено); false — вимкнено, ліміт або PEER_FLOOD сьогодні */
  tryAcquire(): boolean;
  /** Telegram сказав PEER_FLOOD — більше сьогодні не пишемо */
  trip(): void;
  used(): number;
}

export function createIdDmGuard(opts: { cap?: () => number; enabled?: () => boolean; now?: () => Date } = {}): IdDmGuard {
  const cap = opts.cap ?? (() => idDmDailyCap());
  const enabled = opts.enabled ?? (() => idDmEnabled());
  const now = opts.now ?? (() => new Date());
  let day = '';
  let count = 0;
  let tripped = false;
  const roll = (): void => {
    const d = KYIV_DAY.format(now());
    if (d !== day) {
      day = d;
      count = 0;
      tripped = false;
    }
  };
  return {
    tryAcquire(): boolean {
      roll();
      if (!enabled() || tripped || count >= cap()) return false;
      count++;
      return true;
    },
    trip(): void {
      roll();
      tripped = true;
    },
    used(): number {
      roll();
      return count;
    },
  };
}

export const idDmGuard: IdDmGuard = createIdDmGuard();
