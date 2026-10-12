/**
 * Посилання на першоджерело оголошення в Telegram-групі (лише адмінці: у публічний DTO не потрапляє).
 * Публічна група: https://t.me/<username>/<id>, у форумі — https://t.me/<username>/<topicId>/<id>.
 */
export interface ListingOrigin {
  sourceChat?: string | null;
  sourceTopicId?: number | null;
  sourceMessageId?: number | null;
}

export function buildTelegramMessageLink(o: ListingOrigin): string | null {
  const chat = o.sourceChat?.trim().replace(/^@/, '');
  if (!chat || !o.sourceMessageId) return null;
  return o.sourceTopicId
    ? `https://t.me/${chat}/${o.sourceTopicId}/${o.sourceMessageId}`
    : `https://t.me/${chat}/${o.sourceMessageId}`;
}

/** "PoDoroguem/6" або "Korosten_Kyiv"; null — походження невідоме. */
export function describeListingOrigin(o: ListingOrigin): string | null {
  const chat = o.sourceChat?.trim().replace(/^@/, '');
  if (!chat) return null;
  return o.sourceTopicId ? `${chat}/${o.sourceTopicId}` : chat;
}
