-- Платний SMS-фолбек для рекламної розсилки каналу (/admin/promo) тим, до кого
-- не достукались у Telegram.
ALTER TABLE "NotificationSettings" ADD COLUMN "smsChannelPromoEnabled" BOOLEAN NOT NULL DEFAULT false;
