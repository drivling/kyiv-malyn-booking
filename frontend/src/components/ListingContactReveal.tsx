import React, { useState } from 'react';
import { apiClient } from '@/api/client';
import { formatListingContactDisplay, listingContactHref } from '@/utils/constants';
import './ListingContactReveal.css';

type Props = {
  listingId: number;
  /** Клас кнопки/посилання — щоб компонент вписувався у CTA конкретної картки. */
  className?: string;
  /** Підпис до розкриття. */
  label?: string;
};

/**
 * Контакт автора оголошення не потрапляє в розмітку: замість номера рендериться кнопка,
 * і лише коли людина її натисне, контакт приходить окремим запитом і стає посиланням.
 * Так номери не збирають ні пошуковики, ні скрейпери сторінки.
 */
export const ListingContactReveal: React.FC<Props> = ({
  listingId,
  className = '',
  label = 'Показати номер',
}) => {
  const [contact, setContact] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const reveal = async () => {
    if (loading || contact) return;
    setLoading(true);
    setFailed(false);
    try {
      const r = await apiClient.getViberListingContact(listingId);
      setContact(r.contact);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  if (contact) {
    const isTelegram = contact.trim().startsWith('@');
    return (
      <a
        href={listingContactHref(contact)}
        className={className}
        {...(isTelegram ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {isTelegram ? formatListingContactDisplay(contact) : `Зателефонувати: ${formatListingContactDisplay(contact)}`}
      </a>
    );
  }

  return (
    <button type="button" className={className} onClick={reveal} disabled={loading}>
      {loading ? 'Показуємо…' : failed ? 'Спробувати ще раз' : label}
    </button>
  );
};
