/**
 * Чисті частини вкладки «Столова» (LunchTab): розділи з власними адресами, підписи, фільтри замовлень і страв,
 * лотки. Без React — щоб перевіряти тестами окремо.
 */
import type { LunchDaySummary, LunchOrderRow, LunchPaymentSource } from '@/types';
import type { StatusTone } from '../kit';

export const LUNCH_ADMIN_BASE = '/admin/lunch';

export type LunchSection = '' | 'menu' | 'dishes' | 'models';

const SECTION_SLUGS: readonly LunchSection[] = ['', 'menu', 'dishes', 'models'];

export const isLunchSection = (s: string): s is LunchSection => (SECTION_SLUGS as readonly string[]).includes(s);

/** «Меню 12» — позицій сьогодні; «Страви · конфліктів 2» — страв із синонімом, що лежить ще й на іншій страві */
export function lunchSections(counts: { menu: number; conflicts: number }) {
  return [
    { slug: '', label: 'Сьогодні' },
    { slug: 'menu', label: counts.menu > 0 ? `Меню ${counts.menu}` : 'Меню' },
    { slug: 'dishes', label: counts.conflicts > 0 ? `Страви · конфліктів ${counts.conflicts}` : 'Страви' },
    { slug: 'models', label: 'Моделі' },
  ];
}

/** Стан дня: `ordering` — приймаємо замовлення, `closed` — закрито, немає рядка — меню ще не було */
export function dayStatus(status: string | null | undefined): { label: string; tone: StatusTone } {
  if (status === 'ordering') return { label: 'приймаємо замовлення', tone: 'ok' };
  if (status === 'closed') return { label: 'день закрито', tone: 'off' };
  if (!status) return { label: 'дня ще немає', tone: 'warn' };
  return { label: status, tone: 'off' };
}

/** Звідки взялась оплата — щоб оператор бачив, що перевіряти (посилання на чек суму не підтверджує). */
export const PAYMENT_SOURCE_LABEL: Record<LunchPaymentSource, string> = {
  text: 'написав(ла) в чаті',
  admin: 'кнопка «Оплатив»',
  receipt: 'сума з чека (фото / PDF)',
  link: 'посилання на чек — суму не перевірено',
  claim: 'написав(ла), що оплатив(ла) — суму не перевірено',
};

/** Оплати, суму яких ніхто не бачив: посилання на чек і «скинула гроші» без суми */
export const isUncheckedPayment = (source?: LunchPaymentSource) => source === 'link' || source === 'claim';

export const TRAY_ROLE_LABEL: Record<string, string> = { soup: 'суп', second: 'друге', salad: 'салат' };

export const trayRoleLabel = (role?: string | null) => TRAY_ROLE_LABEL[role || 'second'] ?? role ?? '';

export function splitUnmatched(text: string | null | undefined): string[] {
  if (!text || !text.trim()) return [];
  return text
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Лотки: суп — окремий на кожну порцію, друге — один спільний, салат — без лотка (крім єдиної страви) */
export function computeTrayCount(roles: Array<{ trayRole?: string | null; qty?: number | null }>): number {
  if (!roles.length) return 0;
  let soupQty = 0;
  let hasSecond = false;
  for (const l of roles) {
    const role = l.trayRole || 'second';
    const qty = l.qty && l.qty > 0 ? l.qty : 1;
    if (role === 'soup') soupQty += qty;
    else if (role === 'second') hasSecond = true;
  }
  let trays = soupQty + (hasSecond ? 1 : 0);
  if (roles.length === 1) trays = Math.max(trays, 1);
  return trays;
}

export function formatOrderDishLabel(
  line: LunchOrderRow['lines'][number],
  dishById: Map<number, { id: number; name: string; priceUah: number }>
): string {
  const dish = line.dishId != null ? dishById.get(line.dishId) : undefined;
  const name = dish?.name || line.menuItemName || line.rawName || '?';
  const price = line.lineTotalUah ?? dish?.priceUah ?? line.unitPriceUah;
  const qty = line.qty > 1 ? `×${line.qty} ` : '';
  return `${qty}${name} — ${price} грн`;
}

/** Замовлення, яке треба перевірити руками: є нерозпізнаний текст або страва, якої сьогодні немає */
export const orderHasProblem = (o: LunchOrderRow) => Boolean(o.unmatchedText?.trim()) || o.lines.some((l) => l.unavailable);

export type OrderFilter = 'all' | 'problems' | 'debt';

export function orderFilterCounts(orders: readonly LunchOrderRow[]): Record<OrderFilter, number> {
  return {
    all: orders.length,
    problems: orders.filter(orderHasProblem).length,
    debt: orders.filter((o) => o.debtUah > 0).length,
  };
}

export const isOrderFilter = (s: string | null): s is OrderFilter => s === 'all' || s === 'problems' || s === 'debt';

export function filterOrders(orders: readonly LunchOrderRow[], only: OrderFilter): LunchOrderRow[] {
  if (only === 'problems') return orders.filter(orderHasProblem);
  if (only === 'debt') return orders.filter((o) => o.debtUah > 0);
  return [...orders];
}

/** Нормалізовані тексти синонімів, що лежать на кількох стравах (діє найновіший, решта — сміття) */
export function conflictNorms(dishes: LunchDaySummary['dishes']): Set<string> {
  const owners = new Map<string, Set<number>>();
  for (const d of dishes) {
    for (const syn of d.synonyms) {
      if (!syn.rawNorm) continue;
      const set = owners.get(syn.rawNorm) ?? new Set<number>();
      set.add(d.id);
      owners.set(syn.rawNorm, set);
    }
  }
  return new Set([...owners.entries()].filter(([, ids]) => ids.size > 1).map(([norm]) => norm));
}

export type DishFilter = 'all' | 'today' | 'conflicts';

/** Каталог страв за фільтром і пошуком (назва або синонім) */
export function filterDishes(
  dishes: LunchDaySummary['dishes'],
  { only, query, todayIds, conflicts }: { only: DishFilter; query: string; todayIds: ReadonlySet<number>; conflicts: ReadonlySet<string> }
): LunchDaySummary['dishes'] {
  const q = query.trim().toLowerCase();
  return dishes.filter((d) => {
    if (only === 'today' && !todayIds.has(d.id)) return false;
    if (only === 'conflicts' && !d.synonyms.some((s) => s.rawNorm && conflicts.has(s.rawNorm))) return false;
    if (!q) return true;
    return d.name.toLowerCase().includes(q) || d.synonyms.some((s) => s.rawText.toLowerCase().includes(q));
  });
}

/** Скільки людей пообіцяли віддати готівкою (серед тих, хто ще винен) */
export const cashCount = (orders: readonly LunchOrderRow[]) => orders.filter((o) => o.cashPromised && o.debtUah > 0).length;

export const kyivTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kyiv' });
};
