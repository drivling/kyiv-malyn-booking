-- Платний SMS-фолбек для кнопки «Нагадати їм» (неактивні / заблокували бота).
ALTER TABLE "NotificationSettings" ADD COLUMN "smsInactivityReminderEnabled" BOOLEAN NOT NULL DEFAULT false;
