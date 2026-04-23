/**
 * Detect Telegram Bot API failures where the user blocked the bot (or equivalent: no DM possible).
 * Used after outbound bot.sendMessage to clear stale chat bindings.
 */
export function telegramOutboundErrorText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err ?? '');
}

export function isTelegramBotBlockedByUserError(err: unknown): boolean {
  const msg = telegramOutboundErrorText(err).toLowerCase();
  if (!msg) return false;
  if (msg.includes('blocked by the user')) return true;
  if (msg.includes('bot was blocked')) return true;
  if (msg.includes('user is deactivated')) return true;
  if (msg.includes('403') && msg.includes('forbidden') && (msg.includes('blocked') || msg.includes('deactivated'))) {
    return true;
  }
  return false;
}
