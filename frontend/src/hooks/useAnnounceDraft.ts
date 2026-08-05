import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import type { BookingCity } from '@/utils/constants';
import { getDirectionFromCities } from '@/utils/constants';

export type AnnounceRole = 'driver' | 'passenger';

export type AnnounceDraftFields = {
  role: AnnounceRole;
  from: BookingCity | '';
  to: BookingCity | '';
  date: string;
  timeFrom: string;
  timeTo: string;
  price: string;
  comment: string;
};

const emptyFields = (): AnnounceDraftFields => ({
  role: 'driver',
  from: '',
  to: '',
  date: '',
  timeFrom: '',
  timeTo: '',
  price: '',
  comment: '',
});

/** Спільна логіка форми «оголошення водій/пасажир» → Telegram draft */
export function useAnnounceDraft() {
  const [fields, setFields] = useState<AnnounceDraftFields>(emptyFields);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (fields.from && fields.to && !getDirectionFromCities(fields.from, fields.to)) {
      setFields((prev) => ({ ...prev, to: '' }));
    }
  }, [fields.from, fields.to]);

  const patch = (partial: Partial<AnnounceDraftFields>) => {
    setFields((prev) => ({ ...prev, ...partial }));
  };

  const reset = (defaults?: Partial<AnnounceDraftFields>) => {
    setFields({ ...emptyFields(), ...defaults });
    setError('');
    setSubmitting(false);
  };

  const publish = async (): Promise<boolean> => {
    if (!fields.from || !fields.to) {
      setError('Оберіть звідки та куди. Маршрути лише з/до Малина.');
      return false;
    }
    if (!fields.date) {
      setError('Вкажіть дату поїздки');
      return false;
    }
    const priceValue = fields.price.trim();
    const priceUah = priceValue ? Number.parseInt(priceValue, 10) : undefined;
    if (priceValue && (priceUah === undefined || Number.isNaN(priceUah) || priceUah < 0)) {
      setError('Ціна має бути невід’ємним числом');
      return false;
    }

    const timeFrom = fields.timeFrom.trim();
    const timeTo = fields.timeTo.trim();
    const timeValue = timeFrom && timeTo ? `${timeFrom}-${timeTo}` : timeFrom || timeTo || undefined;

    setError('');
    setSubmitting(true);
    try {
      const { deepLink } = await apiClient.createAnnounceDraft({
        role: fields.role,
        from: fields.from,
        to: fields.to,
        date: fields.date,
        time: timeValue,
        priceUah,
        notes: fields.comment.trim() || undefined,
      });
      window.open(deepLink, '_blank', 'noopener,noreferrer');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося створити оголошення. Спробуйте пізніше.');
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    fields,
    setFields,
    patch,
    reset,
    publish,
    submitting,
    error,
    setError,
  };
}
