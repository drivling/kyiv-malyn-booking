/** Підписи для видачі поїздок з пересадками (укр.). Час — хвилини від півночі. */

/** `09:05` з хвилин від півночі (з округленням, доба замикається) */
export function formatClock(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/** «12 хв», «1 год 5 хв» */
export function formatWait(mins: number): string {
  if (mins < 60) return `${mins} хв`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} год ${m} хв` : `${h} год`;
}

/** «без пересадок», «1 пересадка», «2 пересадки», «5 пересадок» */
export function transfersLabel(n: number): string {
  if (n <= 0) return 'без пересадок';
  const lastTwo = n % 100;
  const last = n % 10;
  if (last === 1 && lastTwo !== 11) return `${n} пересадка`;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${n} пересадки`;
  return `${n} пересадок`;
}

/** «5 зупинок»: n — кількість перегонів між зупинками посадки й висадки */
export function stopsLabel(n: number): string {
  const lastTwo = n % 100;
  const last = n % 10;
  if (last === 1 && lastTwo !== 11) return `${n} зупинка`;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${n} зупинки`;
  return `${n} зупинок`;
}
