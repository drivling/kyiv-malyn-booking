/**
 * Валідація тіла POST /poputky/announce-draft (чисті функції для тестів).
 */
export type PoputkyAnnounceDraftValidated = {
  role: 'driver' | 'passenger';
  route: string;
  dateStr: string;
  departureTime: string | null;
  notes: string | undefined;
  priceUah: number | undefined;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const POPUTKY_SINGLE_TIME = /^\d{1,2}:\d{2}$/;
const POPUTKY_TIME_RANGE = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/;

export function validatePoputkyAnnounceDraft(
  body: unknown,
  mapFromToToRoute: (from: string, to: string) => string | null
): { ok: true; value: PoputkyAnnounceDraftValidated } | { ok: false; error: string } {
  if (body == null || typeof body !== 'object') {
    return { ok: false, error: 'Invalid body' };
  }
  const b = body as Record<string, unknown>;

  let priceUah: number | undefined;
  if (b.priceUah !== undefined) {
    const num = Number(b.priceUah);
    if (!Number.isFinite(num) || num < 0) {
      return { ok: false, error: "Ціна має бути невід'ємним числом" };
    }
    priceUah = Math.round(num);
  }

  const role = b.role;
  if (role !== 'driver' && role !== 'passenger') {
    return { ok: false, error: 'role має бути driver або passenger' };
  }

  const from = (b.from ?? '').toString();
  const to = (b.to ?? '').toString();
  const route = mapFromToToRoute(from, to);
  if (!route) {
    return {
      ok: false,
      error:
        'Поїздки можуть бути лише з/до Малина. Оберіть звідки та куди (наприклад Малин ↔ Київ).',
    };
  }

  const dateStr = (b.date ?? '').toString().trim().slice(0, 10);
  if (!ISO_DATE.test(dateStr)) {
    return { ok: false, error: 'Вкажіть коректну дату поїздки' };
  }

  const timeRaw = (b.time ?? '').toString().trim();
  const departureTime = timeRaw || null;
  if (departureTime) {
    if (!POPUTKY_SINGLE_TIME.test(departureTime) && !POPUTKY_TIME_RANGE.test(departureTime)) {
      return { ok: false, error: 'Час: HH:MM або HH:MM-HH:MM (інтервал)' };
    }
  }

  const notesTrim = (b.notes ?? '').toString().trim();
  const notes = notesTrim || undefined;

  return {
    ok: true,
    value: {
      role,
      route,
      dateStr,
      departureTime,
      notes,
      priceUah,
    },
  };
}
