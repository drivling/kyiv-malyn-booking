/**
 * Анонімний id браузера (випадковий UUID у localStorage): щоб рахувати людей, а не відкриття, —
 * хто прийшов із QR-наклейки й повернувся (StickerScan / StickerReturn) і дублі у звітах «Факт
 * прибуття». Не повʼязаний з іменем, телефоном чи акаунтом. Без localStorage — null.
 * Ключ лишився від «Факту прибуття», щоб уже видані id не змінились.
 */
const VISITOR_ID_KEY = 'arrival-report-client';
const VISITOR_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function visitorId(): string | null {
  try {
    let id = localStorage.getItem(VISITOR_ID_KEY);
    if (!id || !VISITOR_ID_RE.test(id)) {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}
