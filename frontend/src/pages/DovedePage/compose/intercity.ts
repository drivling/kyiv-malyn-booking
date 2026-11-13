/**
 * Міжміські рейси для складальника: час прибуття (точний з розкладу або «≈» з якоря) і найпізніший можливий —
 * від нього плануємо пересадку (Docs/dovede-roadmap.md, «Якорі v1»).
 */
import type { Schedule } from '@/types';
import { isScheduleActiveOnDate } from '@/pages/MizhgorodskiPage/mizhUtils';
import { isPhoneOnlySchedule } from '@/pages/MizhgorodskiPage/phoneOnlyBooking';
import { anchorFor, isPeak, type Corridor, type IntercityMode } from '../data/anchors';
import { kyivPointForPlace } from '../data/kyiv';

export interface IntercityTrip {
  schedule: Schedule;
  mode: IntercityMode;
  corridor: Corridor;
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
  /** «через Ірпінь» / «через Бучу» */
  via: string | null;
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

export function intercityTrips(schedules: Schedule[], corridor: Corridor, isoDate: string): IntercityTrip[] {
  const seen = new Set<string>();
  const out: IntercityTrip[] = [];
  for (const s of schedules) {
    const mode = modeOf(s);
    const dep = clockToMins(s.departureTime);
    if (!mode || dep == null || !isScheduleActiveOnDate(s.activeWeekdays, isoDate)) continue;
    const key = mode === 'elektrichka' && s.tripNumber ? `t${s.tripNumber}` : `s${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const anchor = anchorFor(corridor, mode);
    let arr = clockToMins(s.arrivalTime);
    if (arr != null && arr < dep) arr += 1440;
    let exact = arr != null;
    if (arr == null && s.durationMinutes) {
      arr = dep + s.durationMinutes;
      exact = mode === 'elektrichka';
    }
    if (arr == null) arr = dep + anchor.duration.typical;
    const worst = isPeak(corridor, isoDate, dep) ? (anchor.duration.peakMax ?? anchor.duration.max) : anchor.duration.max;
    const arrMax = exact ? arr : Math.max(arr, dep + worst);
    const kyivPlace = corridor === 'to_malyn' ? s.boardingPlace : s.alightingPlace;
    const via = /-Irpin$/.test(s.route) ? 'через Ірпінь' : /-Bucha$/.test(s.route) ? 'через Бучу' : null;
    out.push({
      schedule: s,
      mode,
      corridor,
      depMins: dep,
      arrMins: arr,
      arrMaxMins: arrMax,
      exact,
      kyivPoint: kyivPointForPlace(kyivPlace, s.route),
      via,
      phoneOnly: isPhoneOnlySchedule(s),
    });
  }
  return out.sort((a, b) => a.depMins - b.depMins);
}
