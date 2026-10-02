/**
 * «Хто писав у групі обідів сьогодні» — з бази «Джури» (DzhuraMessage), без звернення до Telegram.
 *
 * Навіщо: слухач обідів тихо мовчить, якщо повідомлення не збіглось з меню, а список замовлень
 * показує лише тих, у кого замовлення вже є. Тут видно всіх, хто писав, і в першу чергу тих,
 * у кого замовлення немає — з кнопкою «Розібрати» (POST /admin/lunch/reparse-person).
 */
import type { PrismaClient } from '@prisma/client';
import { kyivDayRangeUtc } from './dzhura';
import { todayKyivDate } from './lunch';

/** Скільки повідомлень на людину віддаємо в адмінку (останні) і довжина тексту. */
export const LUNCH_PEOPLE_MESSAGES_PER_PERSON = 8;
export const LUNCH_PEOPLE_TEXT_MAX = 300;
const LUNCH_PEOPLE_SCAN_LIMIT = 3000;

const ECHO_PREFIXES = [
  'Меню на сьогодні:',
  'Прийом замовлень',
  'Картка для оплати',
  'Боргів немає',
  'Хто ще винен:',
  'Зведення обідів',
  'День закрито',
  'День відкрито',
  'Фото отримано',
  'Не вдалося',
  'Помилка OCR',
  'Нові замовлення не приймаються',
  'Зафіксовано людей:',
];

/**
 * Відповіді нашого слухача / адмінки — не повідомлення людей.
 * Дзеркало `is_system_echo` у telegram-user/lunch/reparse_day.py — міняти разом.
 */
export function isLunchSystemEcho(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return true;
  if (ECHO_PREFIXES.some((p) => t.startsWith(p))) return true;
  const low = t.toLowerCase();
  if (low.includes(', сьогодні немає:')) return true;
  if (low.includes(', заказ:') || low.slice(0, 80).includes('заказ:')) return true;
  if (low.includes(': зараховано ')) return true;
  if (t.startsWith('!') && t.length < 40) return true;
  return false;
}

export type LunchPersonMessageDto = {
  tgMessageId: string;
  sentAt: string;
  editedAt: string | null;
  text: string;
  mediaKind: string | null;
};

export type LunchPersonDto = {
  tgUserId: string;
  name: string;
  username: string | null;
  isMe: boolean;
  participantId: number | null;
  orderId: number | null;
  hasOrder: boolean;
  orderTotalUah: number | null;
  messageCount: number;
  messages: LunchPersonMessageDto[];
};

export type LunchDayPeople = {
  date: string;
  /** false — чат обідів ще не потрапив у Джуру (немає DzhuraChat з isLunchGroup) */
  available: boolean;
  people: LunchPersonDto[];
};

function personName(p: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  tgUserId: bigint;
}): string {
  const full = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (p.username) return `@${p.username}`;
  return String(p.tgUserId);
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > LUNCH_PEOPLE_TEXT_MAX ? `${t.slice(0, LUNCH_PEOPLE_TEXT_MAX - 1)}…` : t;
}

const MEDIA_LABEL: Record<string, string> = {
  photo: '[фото]',
  video: '[відео]',
  voice: '[голосове]',
  video_note: '[кружок]',
  sticker: '[стікер]',
  gif: '[gif]',
  document: '[файл]',
};

export async function listLunchDayPeople(prisma: PrismaClient, date: Date = todayKyivDate()): Promise<LunchDayPeople> {
  const iso = date.toISOString().slice(0, 10);
  const chat = await prisma.dzhuraChat.findFirst({
    where: { isLunchGroup: true },
    select: { id: true },
  });
  if (!chat) return { date: iso, available: false, people: [] };

  const { start, endExclusive } = kyivDayRangeUtc(iso, iso);
  const messages = await prisma.dzhuraMessage.findMany({
    where: {
      chatId: chat.id,
      sentAt: { gte: start, lt: endExclusive },
      deletedAt: null,
      senderPersonId: { not: null },
    },
    orderBy: [{ sentAt: 'asc' }, { tgMessageId: 'asc' }],
    take: LUNCH_PEOPLE_SCAN_LIMIT,
    include: { sender: true },
  });

  type Bucket = { person: NonNullable<(typeof messages)[number]['sender']>; msgs: LunchPersonMessageDto[] };
  const byPerson = new Map<string, Bucket>();
  for (const m of messages) {
    const sender = m.sender;
    if (!sender || sender.isBot) continue;
    const label = m.mediaKind ? MEDIA_LABEL[m.mediaKind] ?? '[медіа]' : '';
    const body = clip(m.text || '');
    if (m.isOutgoing && isLunchSystemEcho(m.text || '')) continue;
    if (!body && !label) continue;
    const key = String(sender.tgUserId);
    const bucket = byPerson.get(key) ?? { person: sender, msgs: [] };
    bucket.msgs.push({
      tgMessageId: String(m.tgMessageId),
      sentAt: m.sentAt.toISOString(),
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      text: [label, body].filter(Boolean).join(' '),
      mediaKind: m.mediaKind ?? null,
    });
    byPerson.set(key, bucket);
  }

  const tgIds = [...byPerson.keys()];
  const day = await prisma.lunchDay.findUnique({ where: { date }, select: { id: true } });
  const participants = tgIds.length
    ? await prisma.lunchParticipant.findMany({ where: { telegramUserId: { in: tgIds } } })
    : [];
  const participantByTg = new Map(participants.map((p) => [p.telegramUserId, p]));
  const orders =
    day && participants.length
      ? await prisma.lunchOrder.findMany({
          where: { dayId: day.id, status: 'active', participantId: { in: participants.map((p) => p.id) } },
          select: { id: true, participantId: true, totalUah: true },
        })
      : [];
  const orderByParticipant = new Map(orders.map((o) => [o.participantId, o]));

  const people: LunchPersonDto[] = [];
  for (const [tgUserId, bucket] of byPerson) {
    const participant = participantByTg.get(tgUserId);
    const order = participant ? orderByParticipant.get(participant.id) : undefined;
    people.push({
      tgUserId,
      name: personName(bucket.person),
      username: bucket.person.username ?? null,
      isMe: bucket.person.isMe,
      participantId: participant?.id ?? null,
      orderId: order?.id ?? null,
      hasOrder: Boolean(order),
      orderTotalUah: order ? order.totalUah : null,
      messageCount: bucket.msgs.length,
      messages: bucket.msgs.slice(-LUNCH_PEOPLE_MESSAGES_PER_PERSON),
    });
  }

  // Спершу ті, у кого замовлення немає (їх і шукаємо), далі за іменем
  people.sort((a, b) => Number(a.hasOrder) - Number(b.hasOrder) || a.name.localeCompare(b.name, 'uk'));
  return { date: iso, available: true, people };
}
