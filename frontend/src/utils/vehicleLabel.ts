/** «Маршрутка» / «Електричка №6621» / «Потяг №859» — ніколи сирий slug чи голе число (правило D4). */
export function vehicleLabel(s: { vehicleType?: string | null; tripNumber?: string | null }): string {
  if (s.vehicleType !== 'elektrichka') return 'Маршрутка';
  const n = (s.tripNumber ?? '').trim();
  if (!n) return 'Електричка';
  return /^\d{4}$/.test(n) ? `Електричка №${n}` : `Потяг №${n}`;
}
