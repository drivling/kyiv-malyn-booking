/**
 * Чисті частини вкладки «Помилки user-sender» (UserSenderErrorsTab): вид помилки з тексту Python, групи, підсумки.
 * Без React — щоб перевіряти тестами окремо.
 */
import type { TelegramUserSendError } from '@/types';

/** Останній непорожній рядок — у traceback саме там назва помилки */
export const lastLine = (text: string | null | undefined): string =>
  (text ?? '').split('\n').map((s) => s.trim()).filter(Boolean).pop() ?? '';

/**
 * Короткий вид помилки для групування: код Telegram у ВЕЛИКИХ_ЛІТЕРАХ (PEER_FLOOD, PRIVACY_PREMIUM_REQUIRED), інакше назва
 * класу помилки (…Error), інакше початок останнього рядка, а без тексту — код виходу скрипта.
 */
export function errorKind(e: Pick<TelegramUserSendError, 'errorText' | 'errorCode'>): string {
  const line = lastLine(e.errorText);
  const code = line.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/);
  if (code) return code[0].replace(/_\d+$/, ''); // FLOOD_WAIT_120 → FLOOD_WAIT
  const cls = line.match(/\b([A-Z]\w*(?:Error|Exception))\b/);
  if (cls) return cls[1];
  if (line) return line.length > 60 ? `${line.slice(0, 57)}…` : line;
  return `код ${e.errorCode}`;
}

/** Що означає вид помилки людською мовою (лише ті, що трапляються) */
export const KIND_HINT: Record<string, string> = {
  PEER_FLOOD: 'Telegram тимчасово обмежив акаунт — листи за id на сьогодні зупиняються самі',
  PRIVACY_PREMIUM_REQUIRED: 'людина приймає повідомлення лише від Premium',
  USER_PRIVACY_RESTRICTED: 'людина заборонила писати їй незнайомим',
  USERNAME_NOT_OCCUPIED: 'такого @username немає',
  USERNAME_INVALID: '@username записано з помилкою',
  PHONE_NOT_OCCUPIED: 'номер не зареєстрований у Telegram',
  FLOOD_WAIT: 'забагато запитів — Telegram просить зачекати',
};

export const kindHint = (kind: string): string | undefined =>
  KIND_HINT[kind] ?? Object.entries(KIND_HINT).find(([k]) => kind.startsWith(k))?.[1];

export const CONTACT_TYPE_LABEL: Record<string, string> = { phone: 'телефон', username: '@username', user_id: 'за id' };

export function kindCounts(list: readonly TelegramUserSendError[]): Array<{ kind: string; count: number }> {
  const m = new Map<string, number>();
  for (const e of list) {
    const k = errorKind(e);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

export function errorTiles(list: readonly TelegramUserSendError[], now: Date = new Date()) {
  const t = now.getTime();
  const since = (h: number) => list.filter((e) => t - new Date(e.createdAt).getTime() <= h * 3600 * 1000).length;
  const kinds = kindCounts(list);
  return {
    total: list.length,
    day: since(24),
    week: since(24 * 7),
    contacts: new Set(list.map((e) => e.contact)).size,
    top: kinds[0] ?? null,
  };
}

export const kyivDateTime = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
