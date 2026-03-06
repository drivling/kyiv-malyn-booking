/**
 * Маскує повне ім'я для публічного відображення (приховує частину персональних даних).
 * - "Сергій Меренков Іванович" → "Сергій М."
 * - "Вова Адамчук" → "Вова А."
 * - "Олексій" → "Олексій"
 */
export function maskSenderNameForDisplay(name: string | null | undefined): string {
  if (!name?.trim()) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const firstLetter = parts[1].charAt(0).toUpperCase();
  return `${parts[0]} ${firstLetter}.`;
}
