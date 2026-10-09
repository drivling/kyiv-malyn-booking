/**
 * Факт прибуття автобуса від пасажира: довге натискання на час рейсу (стрічка відправлень на
 * сторінці маршруту, картка табло зупинки) → ArrivalReportSheet → POST /transport/arrival-reports.
 * Вікна прийому дзеркалять backend/src/arrival-reports.ts — сервер усе одно перевіряє сам.
 */

/** Рейс на зупинці, про який повідомляють */
export type ArrivalTarget = {
  routeId: string;
  tripId: string;
  direction: 'there' | 'back';
  stopId: string;
  /** Час рейсу на цій зупинці за розкладом, HH:MM */
  scheduledTime: string;
  /** Назва зупинки для показу */
  stopName: string;
  /** Кінцева / напрямок для показу */
  destination?: string;
  source: 'route' | 'board';
};

export const ARRIVED_WINDOW_MIN = 90;
export const MISSED_EARLY_MIN = 5;
export const MISSED_LATE_MIN = 180;

const STOP_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Ключ зупинки придатний для звіту (стабільний id з каталогу, а не назва) */
export function isReportableStopId(stopKey: string | null | undefined): stopKey is string {
  return Boolean(stopKey && STOP_ID_RE.test(stopKey));
}

export function hhmmToMins(s: string): number | null {
  if (!HHMM_RE.test(s)) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export function minsToHhmm(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** «Зараз − розклад» у хвилинах з переходом через північ, у [−720, 720) */
export function clockDiff(nowMins: number, scheduledMins: number): number {
  return ((((nowMins - scheduledMins + 720) % 1440) + 1440) % 1440) - 720;
}

export type ArrivalWindow = {
  /** Зараз − розклад, хв */
  delta: number;
  canArrive: boolean;
  canMiss: boolean;
};

/** Що можна повідомити про рейс зараз (київський час `nowMins`); `isToday` — обрана дата сьогодні */
export function arrivalReportWindow(scheduledTime: string, nowMins: number, isToday: boolean): ArrivalWindow {
  const sched = hhmmToMins(scheduledTime);
  if (sched === null || !isToday) return { delta: 0, canArrive: false, canMiss: false };
  const delta = clockDiff(nowMins, sched);
  return {
    delta,
    canArrive: Math.abs(delta) <= ARRIVED_WINDOW_MIN,
    canMiss: delta >= -MISSED_EARLY_MIN && delta <= MISSED_LATE_MIN,
  };
}

/** «вчасно» / «+6 хв» / «на 3 хв раніше» відносно розкладу */
export function delayLabel(delayMin: number): string {
  if (delayMin === 0) return 'вчасно';
  if (delayMin > 0) return `запізнення ${delayMin} хв`;
  return `на ${-delayMin} хв раніше`;
}

const CLIENT_ID_KEY = 'arrival-report-client';

/** Анонімний id браузера — щоб в аналізі відсіяти дублі одного пристрою; без localStorage — null */
export function arrivalClientId(): string | null {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}
