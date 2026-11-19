/**
 * Телефони «Зубастика» (маршрутки Київ ↔ Малин) — одне джерело для всього сайту: сторінка /zubastyk (і її статична
 * версія для пошуковиків, яку збирає `prerender-spa` з API), модалка бронювання, «Доведе», бот і SMS
 * (`phone-booking.ts`). Типові — тут; власник міняє їх в адмінці без деплою (`SiteSetting`, ключ `zubastyk.phones`).
 *
 * Тексти бота читають номери синхронно з памʼяті (`zubastykPhones()`); памʼять оновлює `createZubastykPhonesStore`
 * при старті, раз на кілька хвилин і одразу після зміни в адмінці (інший контейнер — до наступного оновлення).
 */
import type { Prisma, PrismaClient } from '@prisma/client';

export interface ZubastykPhone {
  /** 380XXXXXXXXX */
  digits: string;
  /** «093 192 00 08» */
  label: string;
  /** «резервний» */
  note?: string;
}

/** Типові телефони; останній — резервний */
export const ZUBASTYK_PHONES_DEFAULT: readonly ZubastykPhone[] = [
  { digits: '380931920008', label: '093 192 00 08' },
  { digits: '380961420008', label: '096 142 00 08' },
  { digits: '380661620008', label: '066 162 00 08' },
  { digits: '380931701835', label: '093 170 18 35', note: 'резервний' },
];

export const ZUBASTYK_PHONES_KEY = 'zubastyk.phones';
export const ZUBASTYK_PHONES_MAX = 6;

let current: readonly ZubastykPhone[] = ZUBASTYK_PHONES_DEFAULT;

/** Телефони, що діють зараз (типові або з адмінки) */
export const zubastykPhones = (): readonly ZubastykPhone[] => current;

/** Номер як його пишуть люди: «093 192 00 08», «+380 93 192-00-08» → 380931920008; null — не номер України */
export function phoneDigits(raw: string): string | null {
  const d = String(raw).replace(/\D/g, '');
  if (/^0\d{9}$/.test(d)) return `38${d}`;
  if (/^380\d{9}$/.test(d)) return d;
  return null;
}

/** 380931920008 → «093 192 00 08» */
export const phoneLabel = (digits: string): string => {
  const l = `0${digits.slice(3)}`;
  return `${l.slice(0, 3)} ${l.slice(3, 6)} ${l.slice(6, 8)} ${l.slice(8, 10)}`;
};

/**
 * Список з адмінки → телефони (номер і примітка; підпис будуємо самі). Кидає RangeError з поясненням.
 * Приймає `[{ phone | digits, note? }]`.
 */
export function parseZubastykPhones(v: unknown): ZubastykPhone[] {
  if (!Array.isArray(v) || !v.length || v.length > ZUBASTYK_PHONES_MAX) throw new RangeError(`від 1 до ${ZUBASTYK_PHONES_MAX} номерів`);
  const out: ZubastykPhone[] = [];
  for (const [i, item] of v.entries()) {
    const o = (item ?? {}) as { phone?: unknown; digits?: unknown; note?: unknown };
    const raw = typeof o.phone === 'string' ? o.phone : typeof o.digits === 'string' ? o.digits : '';
    const digits = phoneDigits(raw);
    if (!digits) throw new RangeError(`номер ${i + 1}: потрібен номер України, як 093 192 00 08`);
    if (out.some((p) => p.digits === digits)) throw new RangeError(`номер ${phoneLabel(digits)} — двічі`);
    const note = typeof o.note === 'string' ? o.note.replace(/\s+/g, ' ').trim() : '';
    if (note.length > 30) throw new RangeError(`номер ${i + 1}: примітка до 30 знаків`);
    out.push({ digits, label: phoneLabel(digits), ...(note ? { note } : {}) });
  }
  return out;
}

const isPhoneList = (v: unknown): v is ZubastykPhone[] => {
  try {
    parseZubastykPhones(v);
    return true;
  } catch {
    return false;
  }
};

export interface ZubastykPhonesView {
  phones: readonly ZubastykPhone[];
  /** змінено в адмінці; інакше — типові з коду */
  changed: boolean;
  updatedAt: string | null;
  defaults: readonly ZubastykPhone[];
}

export function createZubastykPhonesStore(prisma: PrismaClient) {
  let updatedAt: Date | null = null;
  let changed = false;

  /** Прочитати з бази в памʼять; помилка — лишаються попередні */
  async function refresh(): Promise<void> {
    try {
      const row = await prisma.siteSetting.findUnique({ where: { key: ZUBASTYK_PHONES_KEY } });
      const stored = (row?.value as { phones?: unknown } | null)?.phones;
      if (row && isPhoneList(stored)) {
        current = parseZubastykPhones(stored);
        changed = true;
        updatedAt = row.updatedAt;
      } else {
        current = ZUBASTYK_PHONES_DEFAULT;
        changed = false;
        updatedAt = row?.updatedAt ?? null;
      }
    } catch (e) {
      console.error('❌ zubastyk-phones: не прочитано, лишаю попередні:', e instanceof Error ? e.message : e);
    }
  }

  function view(): ZubastykPhonesView {
    return { phones: current, changed, updatedAt: updatedAt?.toISOString() ?? null, defaults: ZUBASTYK_PHONES_DEFAULT };
  }

  /** Задати (null — повернути типові з коду); кидає RangeError */
  async function set(list: unknown | null): Promise<ZubastykPhonesView> {
    const phones = list === null ? null : parseZubastykPhones(list);
    const value = (phones ? { phones } : {}) as unknown as Prisma.InputJsonValue;
    await prisma.siteSetting.upsert({ where: { key: ZUBASTYK_PHONES_KEY }, create: { key: ZUBASTYK_PHONES_KEY, value }, update: { value } });
    await refresh();
    return view();
  }

  /** Оновлювати памʼять раз на `minutes` хвилин (0 — ні); повертає зупинку */
  function startSync(minutes = 5): () => void {
    void refresh();
    if (!(minutes > 0)) return () => undefined;
    const t = setInterval(() => void refresh(), minutes * 60_000);
    t.unref();
    return () => clearInterval(t);
  }

  return { refresh, view, set, startSync };
}

export type ZubastykPhonesStore = ReturnType<typeof createZubastykPhonesStore>;

/** Для тестів: повернути типові в памʼять */
export function resetZubastykPhonesForTests(): void {
  current = ZUBASTYK_PHONES_DEFAULT;
}
