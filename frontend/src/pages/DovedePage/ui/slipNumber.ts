import { formatListingContactDisplay } from '@/utils/constants';

/** «380501234567» → «+380 50 123 45 67»; Telegram і незвичні номери — як на дошці сайту */
export function slipNumber(contact: string): string {
  const digits = contact.replace(/\D/g, '');
  const m = /^380(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(digits);
  if (contact.trim().startsWith('@') || !m) return formatListingContactDisplay(contact);
  return `+380 ${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
}
