/**
 * Тести модуля telegram.ts для безпечного рефакторингу.
 * Покриття: чисті функції, робота з Person/Booking, сповіщення (з моками).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.clearAllMocks();
});

// Мок Prisma, щоб не підключатися до БД при імпорті telegram
const mockPrisma = vi.hoisted(() => ({
  person: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  booking: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  viberListing: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: function (this: unknown) {
    return mockPrisma;
  },
}));

// Імпорт після моків
import {
  normalizePhone,
  formatDate,
  getRouteName,
  normalizeTimeForMatch,
  isExactTimeMatch,
  toDateKey,
  isTelegramEnabled,
  getPersonByPhone,
  findOrCreatePersonByPhone,
  getPersonByTelegram,
  getNameByPhone,
  getPhoneByTelegramUser,
  getChatIdByPhone,
  sendBookingNotificationToAdmin,
  sendBookingConfirmationToCustomer,
  sendTripReminder,
  sendViberListingNotificationToAdmin,
  sendViberListingConfirmationToUser,
  notifyMatchingPassengersForNewDriver,
  notifyMatchingDriversForNewPassenger,
  getDriverFutureBookingsForMybookings,
} from './telegram';

// Мок бота для тестів send* — перехоплюємо створення бота
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
vi.mock('node-telegram-bot-api', () => ({
  default: vi.fn(() => ({
    sendMessage: mockSendMessage,
    editMessageText: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('telegram', () => {
  describe('normalizePhone', () => {
    it('залишає номер 380XXXXXXXXX без змін', () => {
      expect(normalizePhone('380501234567')).toBe('380501234567');
      expect(normalizePhone('380671112233')).toBe('380671112233');
    });

    it('додає 38 до номера з 0', () => {
      expect(normalizePhone('0501234567')).toBe('380501234567');
      expect(normalizePhone('0671112233')).toBe('380671112233');
    });

    it('видаляє всі нецифрові символи', () => {
      expect(normalizePhone('+38 (050) 123-45-67')).toBe('380501234567');
      expect(normalizePhone('38-050-123-45-67')).toBe('380501234567');
    });

    it('повертає порожній рядок для порожнього вводу', () => {
      expect(normalizePhone('')).toBe('');
    });
  });

  describe('formatDate', () => {
    it('форматує дату в українському форматі', () => {
      const d = new Date('2025-02-15T12:00:00.000Z');
      expect(formatDate(d)).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    });

    it('повертає коректний формат для фіксованої дати', () => {
      const d = new Date(2025, 0, 10); // 10 січня 2025
      expect(formatDate(d)).toBe('10.01.2025');
    });
  });

  describe('getRouteName', () => {
    it('повертає назву для Kyiv-Malyn', () => {
      expect(getRouteName('Kyiv-Malyn')).toBe('Київ → Малин');
      expect(getRouteName('Kyiv-Malyn-Irpin')).toBe('Київ → Малин (через Ірпінь)');
      expect(getRouteName('Kyiv-Malyn-Bucha')).toBe('Київ → Малин (через Бучу)');
    });

    it('повертає назву для Malyn-Kyiv', () => {
      expect(getRouteName('Malyn-Kyiv')).toBe('Малин → Київ');
      expect(getRouteName('Malyn-Kyiv-Irpin')).toBe('Малин → Київ (через Ірпінь)');
      expect(getRouteName('Malyn-Kyiv-Bucha')).toBe('Малин → Київ (через Бучу)');
    });

    it('повертає назву для Malyn-Zhytomyr та Zhytomyr-Malyn', () => {
      expect(getRouteName('Malyn-Zhytomyr')).toBe('Малин → Житомир');
      expect(getRouteName('Zhytomyr-Malyn')).toBe('Житомир → Малин');
    });

    it('повертає назву для Korosten-Malyn та Malyn-Korosten', () => {
      expect(getRouteName('Korosten-Malyn')).toBe('Коростень → Малин');
      expect(getRouteName('Malyn-Korosten')).toBe('Малин → Коростень');
    });

    it('повертає оригінальний route для невідомого маршруту', () => {
      expect(getRouteName('Unknown-Route')).toBe('Unknown-Route');
    });
  });

  describe('normalizeTimeForMatch', () => {
    it('повертає "HH:MM" для простого часу', () => {
      expect(normalizeTimeForMatch('18:00')).toBe('18:00');
      expect(normalizeTimeForMatch('9:30')).toBe('09:30');
    });
    it('бере першу частину для діапазону', () => {
      expect(normalizeTimeForMatch('18:00-18:30')).toBe('18:00');
      expect(normalizeTimeForMatch('09:00 - 10:00')).toBe('09:00');
    });
    it('повертає null для порожнього або невалідного', () => {
      expect(normalizeTimeForMatch('')).toBeNull();
      expect(normalizeTimeForMatch(null)).toBeNull();
      expect(normalizeTimeForMatch('нічого')).toBeNull();
    });
  });

  describe('isExactTimeMatch', () => {
    it('повертає true для однакового нормалізованого часу', () => {
      expect(isExactTimeMatch('18:00', '18:00')).toBe(true);
      expect(isExactTimeMatch('18:00-18:30', '18:00')).toBe(true);
    });
    it('повертає false для різного часу', () => {
      expect(isExactTimeMatch('18:00', '19:00')).toBe(false);
    });
    it('повертає false якщо один з аргументів порожній', () => {
      expect(isExactTimeMatch('18:00', null)).toBe(false);
      expect(isExactTimeMatch(null, '18:00')).toBe(false);
    });
  });

  describe('toDateKey', () => {
    it('повертає YYYY-MM-DD', () => {
      expect(toDateKey(new Date('2025-02-15T12:00:00.000Z'))).toBe('2025-02-15');
    });
  });

  describe('isTelegramEnabled', () => {
    it('повертає false коли токен не встановлено (середовище тестів)', () => {
      expect(isTelegramEnabled()).toBe(false);
    });
  });

  describe('getPersonByPhone', () => {
    it('нормалізує номер і викликає prisma.person.findUnique', async () => {
      mockPrisma.person.findUnique.mockResolvedValue(null);
      await getPersonByPhone('+38 050 123 45 67');
      expect(mockPrisma.person.findUnique).toHaveBeenCalledWith({
        where: { phoneNormalized: '380501234567' },
      });
    });

    it('повертає Person якщо знайдено', async () => {
      const person = { id: 1, phoneNormalized: '380501234567', fullName: 'Test', telegramChatId: '123', telegramUserId: '456' };
      mockPrisma.person.findUnique.mockResolvedValue(person);
      const result = await getPersonByPhone('0501234567');
      expect(result).toEqual(person);
    });

    it('повертає null якщо не знайдено', async () => {
      mockPrisma.person.findUnique.mockResolvedValue(null);
      const result = await getPersonByPhone('0500000000');
      expect(result).toBeNull();
    });
  });

  describe('findOrCreatePersonByPhone', () => {
    it('створює Person з нормалізованим номером та опціями', async () => {
      const created = { id: 1, phoneNormalized: '380501234567', fullName: 'Іван' };
      mockPrisma.person.upsert.mockResolvedValue(created);
      const result = await findOrCreatePersonByPhone('0501234567', { fullName: 'Іван' });
      expect(result).toEqual({ id: 1, phoneNormalized: '380501234567', fullName: 'Іван' });
      expect(mockPrisma.person.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { phoneNormalized: '380501234567' },
          create: expect.objectContaining({
            phoneNormalized: '380501234567',
            fullName: 'Іван',
          }),
        })
      );
    });

    it('приймає telegramChatId та telegramUserId', async () => {
      mockPrisma.person.upsert.mockResolvedValue({ id: 1, phoneNormalized: '380501234567', fullName: null });
      await findOrCreatePersonByPhone('0501234567', {
        telegramChatId: 'chat123',
        telegramUserId: 'user456',
      });
      expect(mockPrisma.person.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            telegramChatId: 'chat123',
            telegramUserId: 'user456',
          }),
        })
      );
    });
  });

  describe('getPersonByTelegram', () => {
    it('шукає Person за telegramUserId', async () => {
      mockPrisma.person.findFirst.mockResolvedValue(null);
      await getPersonByTelegram('123', '456');
      expect(mockPrisma.person.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { telegramUserId: '123' },
              { telegramChatId: '456' },
            ]),
          }),
        })
      );
    });
  });

  describe('getNameByPhone', () => {
    it('повертає fullName з Person якщо є', async () => {
      mockPrisma.person.findUnique.mockResolvedValue({ id: 1, fullName: 'Петро', phoneNormalized: '380501234567' });
      mockPrisma.booking.findMany.mockResolvedValue([]);
      const name = await getNameByPhone('0501234567');
      expect(name).toBe('Петро');
    });

    it('повертає null якщо Person без fullName і бронювань немає', async () => {
      mockPrisma.person.findUnique.mockResolvedValue({ id: 1, fullName: null, phoneNormalized: '380501234567' });
      mockPrisma.booking.findMany.mockResolvedValue([]);
      const name = await getNameByPhone('0501234567');
      expect(name).toBeNull();
    });
  });

  describe('getPhoneByTelegramUser', () => {
    it('повертає phoneNormalized з Person якщо знайдено', async () => {
      mockPrisma.person.findFirst.mockResolvedValue({ id: 1, phoneNormalized: '380501234567' });
      const phone = await getPhoneByTelegramUser('user123', 'chat456');
      expect(phone).toBe('380501234567');
    });

    it('повертає phone з Booking якщо Person не знайдено', async () => {
      mockPrisma.person.findFirst.mockResolvedValue(null);
      mockPrisma.booking.findFirst.mockResolvedValue({ phone: '0501234567' });
      const phone = await getPhoneByTelegramUser('user123', 'chat456');
      expect(phone).toBe('0501234567');
    });

    it('повертає null якщо ні Person, ні Booking не знайдено', async () => {
      mockPrisma.person.findFirst.mockResolvedValue(null);
      mockPrisma.booking.findFirst.mockResolvedValue(null);
      const phone = await getPhoneByTelegramUser('user123', 'chat456');
      expect(phone).toBeNull();
    });
  });

  describe('getDriverFutureBookingsForMybookings', () => {
    it('повертає порожній масив якщо Person не знайдено', async () => {
      mockPrisma.person.findFirst.mockResolvedValue(null);
      const since = new Date('2025-02-15');
      since.setHours(0, 0, 0, 0);
      const result = await getDriverFutureBookingsForMybookings('user123', 'chat456', since);
      expect(result).toEqual([]);
      expect(mockPrisma.viberListing.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.booking.findMany).not.toHaveBeenCalled();
    });

    it('повертає порожній масив якщо у користувача немає оголошень водія', async () => {
      mockPrisma.person.findFirst.mockResolvedValue({ id: 1, personId: 1 });
      mockPrisma.viberListing.findMany.mockResolvedValue([]);
      const since = new Date('2025-02-15');
      since.setHours(0, 0, 0, 0);
      const result = await getDriverFutureBookingsForMybookings('user123', 'chat456', since);
      expect(result).toEqual([]);
      expect(mockPrisma.booking.findMany).not.toHaveBeenCalled();
    });

    it('повертає майбутні бронювання по оголошеннях водія', async () => {
      mockPrisma.person.findFirst.mockResolvedValue({ id: 5 });
      mockPrisma.viberListing.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
      const booking = {
        id: 100,
        route: 'Kyiv-Malyn',
        date: new Date('2025-03-01'),
        departureTime: '10:00',
        seats: 2,
        name: 'Пасажир',
        phone: '380671112233',
      };
      mockPrisma.booking.findMany.mockResolvedValue([booking]);
      const since = new Date('2025-02-15');
      since.setHours(0, 0, 0, 0);
      const result = await getDriverFutureBookingsForMybookings('user123', 'chat456', since);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(100);
      expect(result[0].name).toBe('Пасажир');
      expect(result[0].route).toBe('Kyiv-Malyn');
      expect(mockPrisma.viberListing.findMany).toHaveBeenCalledWith({
        where: { personId: 5, listingType: 'driver' },
        select: { id: true },
      });
      expect(mockPrisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            viberListingId: { in: [10, 11] },
            date: { gte: since },
          },
          orderBy: { date: 'asc' },
          take: 10,
        })
      );
    });
  });

  describe('getChatIdByPhone', () => {
    it('повертає telegramChatId з Person якщо є', async () => {
      mockPrisma.person.findUnique.mockResolvedValue({
        id: 1,
        phoneNormalized: '380501234567',
        telegramChatId: '999',
        telegramUserId: '888',
      });
      mockPrisma.booking.findMany.mockResolvedValue([]);
      const chatId = await getChatIdByPhone('0501234567');
      expect(chatId).toBe('999');
    });

    it('повертає null якщо Person без telegramChatId', async () => {
      mockPrisma.person.findUnique.mockResolvedValue({
        id: 1,
        phoneNormalized: '380501234567',
        telegramChatId: null,
        telegramUserId: null,
      });
      mockPrisma.booking.findMany.mockResolvedValue([]);
      const chatId = await getChatIdByPhone('0501234567');
      expect(chatId).toBeNull();
    });
  });

  describe('sendBookingNotificationToAdmin', () => {
    it('не викликає sendMessage коли бот вимкнено', async () => {
      mockSendMessage.mockClear();
      await sendBookingNotificationToAdmin({
        id: 1,
        route: 'Kyiv-Malyn',
        date: new Date('2025-02-15'),
        departureTime: '10:00',
        seats: 2,
        name: 'Test',
        phone: '380501234567',
      });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendBookingConfirmationToCustomer', () => {
    it('не викликає sendMessage коли бот вимкнено', async () => {
      mockSendMessage.mockClear();
      await sendBookingConfirmationToCustomer('chat123', {
        id: 1,
        route: 'Kyiv-Malyn',
        date: new Date('2025-02-15'),
        departureTime: '10:00',
        seats: 2,
        name: 'Test',
      });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendTripReminder', () => {
    it('не викликає sendMessage коли бот вимкнено', async () => {
      mockSendMessage.mockClear();
      await sendTripReminder('chat123', {
        route: 'Kyiv-Malyn',
        date: new Date('2025-02-15'),
        departureTime: '10:00',
        name: 'Test',
      });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendViberListingNotificationToAdmin', () => {
    it('не викликає sendMessage коли бот вимкнено', async () => {
      mockSendMessage.mockClear();
      await sendViberListingNotificationToAdmin({
        id: 1,
        listingType: 'driver',
        route: 'Kyiv-Malyn',
        date: new Date('2025-02-15'),
        departureTime: '10:00',
        seats: 3,
        phone: '380501234567',
        senderName: 'Водій',
        notes: null,
      });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendViberListingConfirmationToUser', () => {
    it('не викликає sendMessage коли бот вимкнено', async () => {
      mockSendMessage.mockClear();
      mockPrisma.person.findUnique.mockResolvedValue(null);
      mockPrisma.booking.findMany.mockResolvedValue([]);
      await sendViberListingConfirmationToUser('380501234567', {
        id: 1,
        route: 'Kyiv-Malyn',
        date: new Date('2025-02-15'),
        departureTime: '10:00',
        seats: 3,
        listingType: 'driver',
      });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('notifyMatchingPassengersForNewDriver', () => {
    it('не викликає sendMessage коли збігів немає', async () => {
      mockPrisma.viberListing.findMany.mockResolvedValue([]);
      mockSendMessage.mockClear();
      await notifyMatchingPassengersForNewDriver({
        id: 1,
        route: 'Kyiv-Malyn',
        date: new Date('2025-02-15'),
        departureTime: '10:00',
        seats: 2,
        phone: '380501234567',
        senderName: 'Водій',
        notes: null,
      });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('не падає коли є збіги але бот вимкнено', async () => {
      mockPrisma.viberListing.findMany.mockResolvedValue([
        {
          id: 2,
          route: 'Kyiv-Malyn',
          date: new Date('2025-02-15'),
          departureTime: '10:00',
          phone: '380671112233',
          senderName: 'Пасажир',
          notes: null,
        },
      ]);
      mockPrisma.person.findUnique.mockResolvedValue(null);
      mockPrisma.booking.findMany.mockResolvedValue([]);
      await expect(
        notifyMatchingPassengersForNewDriver({
          id: 1,
          route: 'Kyiv-Malyn',
          date: new Date('2025-02-15'),
          departureTime: '10:00',
          seats: 2,
          phone: '380501234567',
          senderName: 'Водій',
          notes: null,
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('notifyMatchingDriversForNewPassenger', () => {
    it('не викликає sendMessage коли збігів немає', async () => {
      mockPrisma.viberListing.findMany.mockResolvedValue([]);
      mockSendMessage.mockClear();
      await notifyMatchingDriversForNewPassenger({
        id: 1,
        route: 'Kyiv-Malyn',
        date: new Date('2025-02-15'),
        departureTime: '10:00',
        phone: '380501234567',
        senderName: 'Пасажир',
        notes: null,
      });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });
});
