/**
 * Скільки легковик їде між містами — для часу прибуття попуток у «Доведе» (Docs/dovede-roadmap.md).
 * Є ключ `GOOGLE_MAPS_API_KEY` — питаємо Google Routes API з урахуванням заторів на час виїзду
 * (`computeRoutes`, DRIVE, TRAFFIC_AWARE). Немає ключа, помилка, тайм-аут чи вичерпано денний ліміт
 * (`DRIVE_TIME_DAILY_CAP`) — сталий час маршруту з адмінки (`TripRoute.carDurationMinutes`), інакше 1 год 35 хв.
 * Відповідь Google живе лише в памʼяті 15 хв (за парою міст і годиною виїзду) — у базу її не пишемо.
 */
export const DEFAULT_CAR_MINUTES = 95;
export const DEFAULT_DRIVE_TIME_DAILY_CAP = 200;
const CACHE_MS = 15 * 60_000;
const TIMEOUT_MS = 3000;
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/**
 * Адреса міста для Google: самої назви «Малин» мало — такий є і на Рівненщині. Київ — західний край
 * (метро «Академмістечко»): туди приїжджають попутки й маршрутки з Житомирської траси; до центру Києва
 * вранці на пів години довше, і час попутки виглядав би гіршим, ніж є.
 */
const CITY_ADDRESS: Record<string, string> = {
  Kyiv: 'станція метро Академмістечко, Київ, Україна',
  Malyn: 'Малин, Житомирська область, Україна',
  Zhytomyr: 'Житомир, Україна',
  Korosten: 'Коростень, Житомирська область, Україна',
  Irpin: 'Ірпінь, Київська область, Україна',
  Bucha: 'Буча, Київська область, Україна',
};

export interface DriveTime {
  minutes: number;
  /** traffic — Google із заторами; fixed — сталий час маршруту */
  source: 'traffic' | 'fixed';
}

export type DriveTimeFn = (q: { fromCode: string; toCode: string; departAt: Date; fixedMinutes: number }) => Promise<DriveTime>;

export function driveTimeDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.DRIVE_TIME_DAILY_CAP ?? '').trim();
  if (!raw) return DEFAULT_DRIVE_TIME_DAILY_CAP;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DRIVE_TIME_DAILY_CAP;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export function createDriveTime(deps: {
  /** null — ключа немає: завжди сталий час */
  key: () => string | null;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** ліміт на день: число або з налаштувань адмінки (async) */
  dailyCap?: () => number | Promise<number>;
}): DriveTimeFn {
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const now = deps.now ?? Date.now;
  const dailyCap = deps.dailyCap ?? (() => driveTimeDailyCap());
  const cache = new Map<string, { at: number; minutes: number }>();
  let day = '';
  let calls = 0;

  return async ({ fromCode, toCode, departAt, fixedMinutes }) => {
    const fixed: DriveTime = { minutes: fixedMinutes > 0 ? fixedMinutes : DEFAULT_CAR_MINUTES, source: 'fixed' };
    const key = deps.key();
    const origin = CITY_ADDRESS[fromCode];
    const destination = CITY_ADDRESS[toCode];
    if (!key || !origin || !destination) return fixed;

    // затори залежать від години — на одну годину один запит
    const bucket = `${fromCode}>${toCode}@${departAt.toISOString().slice(0, 13)}`;
    const hit = cache.get(bucket);
    if (hit && now() - hit.at < CACHE_MS) return { minutes: hit.minutes, source: 'traffic' };

    const today = new Date(now()).toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      calls = 0;
    }
    if (calls >= (await dailyCap())) return fixed;
    calls++;

    try {
      // Google приймає лише майбутній час виїзду; для «вже зараз» — без нього (поточні затори)
      const future = departAt.getTime() > now() + 60_000;
      const res = await fetchImpl(ROUTES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.duration' },
        body: JSON.stringify({
          origin: { address: origin },
          destination: { address: destination },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
          ...(future ? { departureTime: departAt.toISOString() } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Routes API ${res.status}`);
      const body = (await res.json()) as { routes?: Array<{ duration?: string }> };
      const seconds = Number(String(body.routes?.[0]?.duration ?? '').replace(/s$/, ''));
      // межі здорового глузду: менше 10 хв чи понад 12 год між містами — це не відповідь
      if (!Number.isFinite(seconds) || seconds < 600 || seconds > 12 * 3600) throw new Error('Routes API: дивна тривалість');
      const minutes = Math.round(seconds / 60);
      cache.set(bucket, { at: now(), minutes });
      return { minutes, source: 'traffic' };
    } catch (e) {
      console.error('❌ drive-time: Google Routes не відповів, беру сталий час:', e instanceof Error ? e.message : e);
      return fixed;
    }
  };
}

export function driveTimeFromEnv(): DriveTimeFn {
  return createDriveTime({ key: () => (process.env.GOOGLE_MAPS_API_KEY ?? '').trim() || null });
}
