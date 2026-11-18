/**
 * «Доведе» · налаштування, які власник міняє сам в адмінці (Docs/dovede-admin-roadmap.md, крок 3).
 *
 * Один перелік (`DOVEDE_SETTINGS`): ключ, група, підпис, межі, типове значення зі змінної середовища або з коду.
 * Значення, задані в адмінці, лежать у `DovedeSetting` (ключ → JSON); `null` / немає рядка — типове. Читання — з
 * памʼяті на хвилину (усі ключі разом), запис її скидає, тож нове значення діє за хвилину й без деплою.
 *
 * Вмикачі мають головний вимикач на сервері: якщо змінна середовища каже «вимкнено» (`DOVEDE_ENABLED=0` тощо),
 * адмінка увімкнути не може — рядок показує «вимкнено на сервері». Ключі й паролі тут не живуть ніколи.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

export type SettingGroup = 'ai' | 'google' | 'learning';
export type SettingKind = 'int' | 'bool';

export interface SettingDef {
  key: string;
  group: SettingGroup;
  kind: SettingKind;
  label: string;
  help: string;
  unit?: string;
  min?: number;
  max?: number;
  /** типове значення без адмінки: зі змінної середовища або з коду */
  defaultFrom: (env: NodeJS.ProcessEnv) => { value: number | boolean; source: 'env' | 'code' };
  /** вмикач: змінна середовища, яка вимикає назавжди (адмінка тоді не вмикає) */
  masterOff?: (env: NodeJS.ProcessEnv) => string | null;
}

const envInt = (name: string, code: number, min = 0) => (env: NodeJS.ProcessEnv) => {
  const raw = (env[name] ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= min ? { value: n, source: 'env' as const } : { value: code, source: 'code' as const };
};
const codeInt = (code: number) => () => ({ value: code, source: 'code' as const });
const onByDefault = () => ({ value: true, source: 'code' as const });
/** «вимкнено на сервері»: змінна має одне з вимикальних значень */
const offWhen = (name: string, offValues: string[]) => (env: NodeJS.ProcessEnv) => {
  const v = (env[name] ?? '').trim().toLowerCase();
  return offValues.includes(v) ? `${name}=${env[name]?.trim()}` : null;
};
const OFF = ['0', 'false', 'off', 'no'];

/** Квота проєкту в Google Cloud — 5000 запитів на день: більше в адмінці не дозволяємо */
export const GOOGLE_DAILY_MAX = 5000;

export const DOVEDE_SETTINGS: readonly SettingDef[] = [
  {
    key: 'ai.enabled',
    group: 'ai',
    kind: 'bool',
    label: 'Розбір питань через ШІ',
    help: 'Вимкнено — сторінка відповідає лише за своїм словником (як без мережі).',
    defaultFrom: onByDefault,
    masterOff: offWhen('DOVEDE_ENABLED', OFF),
  },
  {
    key: 'ai.dailyCap',
    group: 'ai',
    kind: 'int',
    label: 'Викликів ШІ на день',
    help: 'Скільки разів за київську добу можна спитати Claude. 0 — лише словник.',
    unit: 'на день',
    min: 0,
    max: 5000,
    defaultFrom: envInt('DOVEDE_DAILY_CAP', 300),
  },
  {
    key: 'city.enabled',
    group: 'google',
    kind: 'bool',
    label: 'Дорога містом (Київ, Житомир)',
    help: 'Вимкнено — до місця в місті лише кнопка Google Maps, база й Google не питаються.',
    defaultFrom: onByDefault,
    masterOff: offWhen('DOVEDE_CITY_ROUTES', ['off']),
  },
  {
    key: 'city.dailyCap',
    group: 'google',
    kind: 'int',
    label: 'Запитів до Google на день',
    help: 'Люди й навчання разом. 0 — Google не питати зовсім.',
    unit: 'на день',
    min: 0,
    max: GOOGLE_DAILY_MAX,
    defaultFrom: envInt('DOVEDE_CITY_DAILY_CAP', 150),
  },
  {
    key: 'city.freshDays',
    group: 'google',
    kind: 'int',
    label: 'Збережена відповідь свіжа, днів',
    help: 'Старішу відповідь сервер не віддає, а питає Google знову.',
    unit: 'днів',
    min: 1,
    max: 365,
    defaultFrom: codeInt(30),
  },
  {
    key: 'city.own',
    group: 'google',
    kind: 'bool',
    label: 'Власні дані Житомира',
    help: 'Пряма поїздка Житомиром — за розкладом із вашого сайту, без бази й Google.',
    defaultFrom: onByDefault,
    masterOff: offWhen('DOVEDE_CITY_OWN', ['0']),
  },
  {
    key: 'drive.dailyCap',
    group: 'google',
    kind: 'int',
    label: 'Час авто: запитів до Google на день',
    help: 'Для попуток — скільки авто в дорозі з заторами. Понад ліміт — сталий час маршруту.',
    unit: 'на день',
    min: 0,
    max: GOOGLE_DAILY_MAX,
    defaultFrom: envInt('DRIVE_TIME_DAILY_CAP', 200),
  },
  {
    key: 'google.backoffMin',
    group: 'google',
    kind: 'int',
    label: 'Пауза після відмови Google, хв',
    help: 'Google відповів «квота» (429) чи «немає доступу» (403) — стільки хвилин не питаємо зовсім.',
    unit: 'хв',
    min: 1,
    max: 120,
    defaultFrom: codeInt(10),
  },
  {
    key: 'learn.refresh',
    group: 'learning',
    kind: 'bool',
    label: 'Фонове оновлення застарілих відповідей',
    help: 'Сервер сам перепитує збережені відповіді, що ось-ось застаріють.',
    defaultFrom: onByDefault,
    masterOff: offWhen('DOVEDE_CITY_REFRESH', ['0']),
  },
  {
    key: 'learn.sharePct',
    group: 'learning',
    kind: 'int',
    label: 'Навчанню — частка денного ліміту Google, %',
    help: 'Фонове навчання зупиняється, коли за день витрачено стільки відсотків ліміту; решта — людям.',
    unit: '%',
    min: 0,
    max: 100,
    defaultFrom: codeInt(50),
  },
  {
    key: 'learn.batch',
    group: 'learning',
    kind: 'int',
    label: 'Пар за один крок навчання',
    help: 'Скільки запитів до Google робить фонове навчання за раз (раз на годину).',
    min: 1,
    max: 20,
    defaultFrom: codeInt(3),
  },
  {
    key: 'learn.retryDays',
    group: 'learning',
    kind: 'int',
    label: 'Не перепитувати пару без дороги, днів',
    help: 'Google не знайшов дороги — навчання не чіпає цю пару стільки днів (людина питає як завжди).',
    unit: 'днів',
    min: 1,
    max: 90,
    defaultFrom: codeInt(7),
  },
];

export const SETTING_GROUP_LABEL: Record<SettingGroup, string> = { ai: 'ШІ (Claude)', google: 'Google', learning: 'Фонове навчання' };

const BY_KEY = new Map(DOVEDE_SETTINGS.map((d) => [d.key, d]));
const TTL_MS = 60_000;

export type SettingKey = (typeof DOVEDE_SETTINGS)[number]['key'];

/** Значення, яке приймає адмінка для цього ключа (без перетворень); null — повернути типове */
export function validSettingValue(def: SettingDef, v: unknown): v is number | boolean {
  if (def.kind === 'bool') return typeof v === 'boolean';
  return typeof v === 'number' && Number.isInteger(v) && v >= (def.min ?? 0) && v <= (def.max ?? Number.MAX_SAFE_INTEGER);
}

export interface SettingView {
  key: string;
  group: SettingGroup;
  kind: SettingKind;
  label: string;
  help: string;
  unit?: string;
  min?: number;
  max?: number;
  /** що діє зараз */
  value: number | boolean;
  /** типове без адмінки і звідки воно */
  default: number | boolean;
  defaultSource: 'env' | 'code';
  /** задано в адмінці (null — ні) і коли */
  stored: number | boolean | null;
  updatedAt: string | null;
  /** вмикач вимкнено на сервері — адмінка його не ввімкне */
  lockedBy: string | null;
}

export interface DovedeSettingsDeps {
  prisma: PrismaClient;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

export function createDovedeSettings(deps: DovedeSettingsDeps) {
  const { prisma } = deps;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  let memo: { at: number; rows: Map<string, { value: unknown; updatedAt: Date }> } | null = null;

  async function rows(): Promise<Map<string, { value: unknown; updatedAt: Date }>> {
    const at = now().getTime();
    if (memo && at - memo.at >= 0 && at - memo.at < TTL_MS) return memo.rows;
    try {
      const list = await prisma.dovedeSetting.findMany();
      memo = { at, rows: new Map(list.map((r) => [r.key, { value: r.value as unknown, updatedAt: r.updatedAt }])) };
      return memo.rows;
    } catch (e) {
      console.error('❌ dovede settings: не прочитано, беру попередні:', e instanceof Error ? e.message : e);
      return memo?.rows ?? new Map();
    }
  }

  function viewOf(def: SettingDef, stored: { value: unknown; updatedAt: Date } | undefined): SettingView {
    const dflt = def.defaultFrom(env);
    const lockedBy = def.masterOff?.(env) ?? null;
    const own = stored && validSettingValue(def, stored.value) ? (stored.value as number | boolean) : null;
    const value = lockedBy ? false : own ?? dflt.value;
    return {
      key: def.key,
      group: def.group,
      kind: def.kind,
      label: def.label,
      help: def.help,
      ...(def.unit ? { unit: def.unit } : {}),
      ...(def.min != null ? { min: def.min } : {}),
      ...(def.max != null ? { max: def.max } : {}),
      value,
      default: dflt.value,
      defaultSource: dflt.source,
      stored: own,
      updatedAt: own != null && stored?.updatedAt instanceof Date ? stored.updatedAt.toISOString() : null,
      lockedBy,
    };
  }

  async function view(key: string): Promise<SettingView> {
    const def = BY_KEY.get(key);
    if (!def) throw new RangeError(`невідоме налаштування: ${key}`);
    return viewOf(def, (await rows()).get(key));
  }

  /** Число, що діє зараз (адмінка → змінна → код) */
  async function int(key: string): Promise<number> {
    return (await view(key)).value as number;
  }

  /** Вмикач, що діє зараз (вимкнено на сервері — завжди false) */
  async function bool(key: string): Promise<boolean> {
    return (await view(key)).value as boolean;
  }

  async function all(): Promise<SettingView[]> {
    const map = await rows();
    return DOVEDE_SETTINGS.map((d) => viewOf(d, map.get(d.key)));
  }

  /** Задати значення з адмінки; null — повернути типове (рядок лишається з null — історія коли міняли) */
  async function set(key: string, value: number | boolean | null): Promise<SettingView> {
    const def = BY_KEY.get(key);
    if (!def) throw new RangeError(`невідоме налаштування: ${key}`);
    if (value !== null && !validSettingValue(def, value)) {
      throw new RangeError(def.kind === 'bool' ? `${key}: true або false` : `${key}: ціле від ${def.min} до ${def.max}`);
    }
    const json = value === null ? Prisma.DbNull : value;
    await prisma.dovedeSetting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
    memo = null;
    return view(key);
  }

  return { int, bool, view, all, set };
}

export type DovedeSettings = ReturnType<typeof createDovedeSettings>;
