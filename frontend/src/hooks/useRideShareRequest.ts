import { useState } from 'react';
import { apiClient } from '@/api/client';
import type { ViberListing } from '@/types';
import { userState } from '@/utils/userState';

export type RideShareStatusData = {
  listing: ViberListing;
  driverNotified: boolean;
  message: string;
};

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
  const [requestError, setRequestError] = useState('');

  const telegramUser = userState.getTelegramUser();
  const isTelegramLoggedIn = userState.isTelegramUser() && !!telegramUser?.id;

  const closeStatusModals = () => {
    setShowRequestStatusModal(false);
    setRequestStatusData(null);
    setAlreadyRequestedListing(null);
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
      const result = await apiClient.createRideShareRequestFromSite(
        driverListingId,
        telegramUser.id.toString()
      );
      const selectedListing = listings.find((item) => item.id === driverListingId) || null;
      if (selectedListing) {
        setRequestStatusData({
          listing: selectedListing,
          driverNotified: result.driverNotified,
          message: result.message,
        });
        setShowRequestStatusModal(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не вдалося створити запит на попутку';
      if (message.includes('Ви вже надсилали запит')) {
        const listing = listings.find((item) => item.id === driverListingId) || null;
        if (listing) setAlreadyRequestedListing(listing);
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
    requestError,
    setRequestError,
    requestRide,
    closeStatusModals,
  };
}
