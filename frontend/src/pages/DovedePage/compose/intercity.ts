/**
 * Міжміські рейси для складальника: час прибуття (точний з розкладу або «≈» з якоря) і найпізніший можливий —
 * від нього плануємо пересадку (Docs/dovede-roadmap.md, «Якорі v1»).
 */
import type { Schedule } from '@/types';
import { isScheduleActiveOnDate } from '@/pages/MizhgorodskiPage/mizhUtils';
import { isPhoneOnlySchedule } from '@/pages/MizhgorodskiPage/phoneOnlyBooking';
import { findAnchor, isPeak, type Corridor, type FarCity, type IntercityMode } from '../data/anchors';
import { kyivPointForPlace } from '../data/kyiv';

export interface IntercityTrip {
  schedule: Schedule;
  mode: IntercityMode;
  corridor: Corridor;
  /** місто на іншому кінці */
  far: FarCity;
  /** відправлення з місця посадки в розкладі, хв */
  depMins: number;
  /** прибуття: у центр / на вокзал Малина (to_malyn) або в Київ (from_malyn), хв */
  arrMins: number;
  /** найпізніше прибуття (пробки) — від нього плануємо пересадку */
  arrMaxMins: number;
  /** прибуття відоме з розкладу (електрички) */
  exact: boolean;
  /** посадка (to_malyn) або висадка (from_malyn) у Києві */
  kyivPoint: string | null;
  /** «через Ірпінь» / «через Бучу» / «через Потіївку» */
  via: string | null;
  /** рейс їде далі за місто призначення чи здалеку: «транзит на Хмільник», «транзит з Вінниці» */
  transit: string | null;
  phoneOnly: boolean;
}

export function clockToMins(s: string | null | undefined): number | null {
  const m = s?.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function minsToClock(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function modeOf(s: Schedule): IntercityMode | null {
  if (s.vehicleType === 'elektrichka') return 'elektrichka';
  if (!s.vehicleType || s.vehicleType === 'marshrutka') return 'marshrutka';
  return null;
}

/** Як назвати шлях за кодом проміжного міста в маршруті (`Malyn-Zhytomyr-Potiivka`) */
const VIA_LABEL: Record<string, string> = { Irpin: 'через Ірпінь', Bucha: 'через Бучу', Potiivka: 'через Потіївку', Radomyshl: 'через Радомишль' };
const TRANSIT_TO: Record<string, string> = { Khmilnyk: 'Хмільник', Vinnytsia: 'Вінницю', Berdychiv: 'Бердичів', Stanyshivka: 'Станишівку', Bazar: 'Базар' };

/**
 * Скільки їде маршрутка Малин → Житомир, коли в розкладі немає часу прибуття: з розкиду зворотних рейсів
 * (80–100 хв навпростець через Потіївку, 130–170 через Радомишль). Транзитні — невідомо яким шляхом.
 */
function zhytomyrDuration(vias: string[]): { typical: number; max: number } {
  if (vias.includes('Radomyshl')) return { typical: 135, max: 170 };
  if (vias.includes('Potiivka')) return { typical: 90, max: 100 };
  return { typical: 100, max: 170 };
}

export function intercityTrips(schedules: Schedule[], corridor: Corridor, isoDate: string, far: FarCity = 'Kyiv'): IntercityTrip[] {
  const seen = new Set<string>();
  const out: IntercityTrip[] = [];
  for (const s of schedules) {
    const mode = modeOf(s);
    const dep = clockToMins(s.departureTime);
    if (!mode || dep == null || !isScheduleActiveOnDate(s.activeWeekdays, isoDate)) continue;
    const key = mode === 'elektrichka' && s.tripNumber ? `t${s.tripNumber}` : `s${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const anchor = findAnchor(corridor, mode, far);
    if (!anchor) continue;
    // маршрут: початок-кінець-проміжні; рейс «транзитний», коли наше місто чи Малин — не кінець
    const [, endCode, ...vias] = (s.route ?? '').split('-');
    const target = corridor === 'to_malyn' ? 'Malyn' : far;
    const through = far !== 'Kyiv' && endCode !== target;
    let arr = through ? null : clockToMins(s.arrivalTime);
    // транзитний рейс через Малин: час у Малині записано в тексті посадки («через Малин ≈ 15:00»)
    const passing = through && corridor === 'to_malyn' ? /через\s+Малин\s*≈?\s*(\d{1,2}:\d{2})/i.exec(s.boardingPlace ?? '') : null;
    const passingAt = passing ? clockToMins(passing[1]) : null;
    if (arr != null && arr < dep) arr += 1440;
    let exact = arr != null;
    if (arr == null && s.durationMinutes) {
      arr = dep + s.durationMinutes;
      exact = mode === 'elektrichka';
    }
    if (passingAt != null) {
      arr = passingAt;
      exact = false;
    }
    const span = far === 'Zhytomyr' ? zhytomyrDuration(vias) : anchor.duration;
    if (arr == null) arr = dep + span.typical;
    const worst = isPeak(corridor, isoDate, dep) ? (anchor.duration.peakMax ?? span.max) : span.max;
    // «≈ 15:00» з тексту — запас 10 хв; без часу в розкладі — найдовший відомий шлях
    const arrMax = exact ? arr : passingAt != null ? arr + 10 : Math.max(arr, dep + worst);
    const kyivPlace = corridor === 'to_malyn' ? s.boardingPlace : s.alightingPlace;
    const viaCode = vias.find((v) => VIA_LABEL[v]);
    const via = viaCode ? VIA_LABEL[viaCode] : null;
    const cameFrom = /транзит\s+(з[іi]?\s+[^;,)]+)/i.exec(s.boardingPlace ?? '');
    const transit = !through ? (cameFrom ? `транзит ${cameFrom[1].trim()}` : null) : corridor === 'from_malyn' ? `транзит на ${TRANSIT_TO[endCode] ?? endCode}` : `їде далі на ${TRANSIT_TO[endCode] ?? endCode}`;
    out.push({
      schedule: s,
      mode,
      corridor,
      far,
      depMins: dep,
      arrMins: arr,
      arrMaxMins: arrMax,
      exact,
      kyivPoint: far === 'Kyiv' ? kyivPointForPlace(kyivPlace, s.route) : null,
      via,
      transit,
      phoneOnly: isPhoneOnlySchedule(s),
    });
  }
  return out.sort((a, b) => a.depMins - b.depMins);
}
