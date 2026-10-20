import { useState } from 'react';
import { apiClient } from '@/api/client';
import type { ViberListing } from '@/types';
import { userState } from '@/utils/userState';
import { isTelegramLoginRejected } from '@/utils/telegramLogin';

export type RideShareStatusData = {
  listing: ViberListing;
  driverNotified: boolean;
  message: string;
  /** Контакт водія з /viber-listings/:id/contact (у публічному DTO телефону немає); null — не вдалося */
  contact: string | null;
};

/** 401 від POST /rideshare/request: підпис Telegram Login прострочений або його нема (як на /user) */
export const RIDESHARE_LOGIN_STALE_MESSAGE =
  'Сесія входу через Telegram застаріла або не підтверджена — увійдіть ще раз, щоб бронювати місце у водія.';

type Options = {
  listings: ViberListing[];
  onNeedLogin: () => void;
};

/** Спільна логіка бронювання попутки (rideshare request) з сайту */
export function useRideShareRequest({ listings, onNeedLogin }: Options) {
  const [requestingListingId, setRequestingListingId] = useState<number | null>(null);
  const [confirmRequestListing, setConfirmRequestListing] = useState<ViberListing | null>(null);
  const [showRequestStatusModal, setShowRequestStatusModal] = useState(false);
  const [requestStatusData, setRequestStatusData] = useState<RideShareStatusData | null>(null);
  const [alreadyRequestedListing, setAlreadyRequestedListing] = useState<ViberListing | null>(null);
  const [alreadyRequestedContact, setAlreadyRequestedContact] = useState<string | null>(null);
  const [requestError, setRequestError] = useState('');

  const fetchContact = async (listingId: number): Promise<string | null> => {
    try {
      return (await apiClient.getViberListingContact(listingId)).contact;
    } catch {
      return null;
    }
  };

  const telegramUser = userState.getTelegramUser();
  const isTelegramLoggedIn = userState.isTelegramUser() && !!telegramUser?.id;

  const closeStatusModals = () => {
    setShowRequestStatusModal(false);
    setRequestStatusData(null);
    setAlreadyRequestedListing(null);
    setAlreadyRequestedContact(null);
    setConfirmRequestListing(null);
  };

  const requestRide = async (driverListingId: number) => {
    if (!telegramUser?.id) {
      onNeedLogin();
      return;
    }
    setRequestError('');
    setRequestingListingId(driverListingId);
    try {
      // Хто пасажир — бекенд бере з підписаного заголовка X-Telegram-Login, id у тілі не шлемо
      const result = await apiClient.createRideShareRequestFromSite(driverListingId);
      const selectedListing = listings.find((item) => item.id === driverListingId) || null;
      if (selectedListing) {
        // Телефон потрібен лише коли водій не в Telegram — тоді показуємо «Зателефонувати»
        const contact = result.driverNotified ? null : await fetchContact(driverListingId);
        setRequestStatusData({
          listing: selectedListing,
          driverNotified: result.driverNotified,
          message: result.message,
          contact,
        });
        setShowRequestStatusModal(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не вдалося створити запит на попутку';
      if (isTelegramLoginRejected(err)) {
        setRequestError(RIDESHARE_LOGIN_STALE_MESSAGE);
      } else if (message.includes('Ви вже надсилали запит')) {
        const listing = listings.find((item) => item.id === driverListingId) || null;
        if (listing) {
          setAlreadyRequestedContact(await fetchContact(driverListingId));
          setAlreadyRequestedListing(listing);
        }
      } else {
        setRequestError(message);
      }
    } finally {
      setRequestingListingId(null);
    }
  };

  return {
    isTelegramLoggedIn,
    requestingListingId,
    confirmRequestListing,
    setConfirmRequestListing,
    showRequestStatusModal,
    setShowRequestStatusModal,
    requestStatusData,
    setRequestStatusData,
    alreadyRequestedListing,
    setAlreadyRequestedListing,
    alreadyRequestedContact,
    requestError,
    setRequestError,
    requestRide,
    closeStatusModals,
  };
}
