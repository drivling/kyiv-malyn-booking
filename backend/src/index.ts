import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { sendBookingNotificationToAdmin, sendBookingConfirmationToCustomer, getChatIdByPhone, isTelegramEnabled, sendTripReminder, normalizePhone } from './telegram';
import { parseViberMessage, parseViberMessages } from './viber-parser';

// Маркер версії коду — змінити при оновленні, щоб у логах Railway було видно новий деплой
const CODE_VERSION = 'viber-v2-2026';

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// Простий токен для авторизації (в продакшені використовуйте JWT)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN = 'admin-authenticated';

// Middleware для перевірки авторизації адміна
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = req.headers.authorization;
  if (token === ADMIN_TOKEN) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

app.get('/health', (_req, res) =>
  res.json({
    status: 'ok',
    version: 2,
    viber: true,
    codeVersion: CODE_VERSION,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    cwd: process.cwd(),
  })
);

// Endpoint для виправлення telegramUserId в існуючих бронюваннях
app.post('/admin/fix-telegram-ids', requireAdmin, async (_req, res) => {
  try {
    console.log('🔧 Початок виправлення telegramUserId...');
    
    // 1. Знаходимо всі бронювання де є chatId але немає валідного userId
    const problematicBookings = await prisma.booking.findMany({
      where: {
        telegramChatId: { not: null },
        OR: [
          { telegramUserId: null },
          { telegramUserId: '0' },
          { telegramUserId: '' }
        ]
      }
    });
    
    console.log(`📋 Знайдено ${problematicBookings.length} бронювань з невалідним telegramUserId`);
    
    if (problematicBookings.length === 0) {
      return res.json({ 
        success: true, 
        message: 'Всі записи вже правильні!',
        fixed: 0,
        skipped: 0,
        total: 0
      });
    }
    
    // 2. Виправляємо кожне бронювання
    let fixed = 0;
    let skipped = 0;
    const details: string[] = [];
    
    for (const booking of problematicBookings) {
      if (booking.telegramChatId && 
          booking.telegramChatId !== '0' && 
          booking.telegramChatId.trim() !== '') {
        
        // Для приватних чатів chat_id = user_id
        await prisma.booking.update({
          where: { id: booking.id },
          data: { 
            telegramUserId: booking.telegramChatId 
          }
        });
        
        const msg = `✅ #${booking.id}: telegramUserId оновлено з '${booking.telegramUserId}' на '${booking.telegramChatId}'`;
        console.log(msg);
        details.push(msg);
        fixed++;
      } else {
        const msg = `⚠️ #${booking.id}: пропущено (невалідний chatId: '${booking.telegramChatId}')`;
        console.log(msg);
        details.push(msg);
        skipped++;
      }
    }
    
    console.log(`📊 Виправлено: ${fixed}, Пропущено: ${skipped}, Всього: ${problematicBookings.length}`);
    
    res.json({
      success: true,
      message: 'Виправлення завершено!',
      fixed,
      skipped,
      total: problematicBookings.length,
      details
    });
    
  } catch (error) {
    console.error('❌ Помилка виправлення:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// Авторизація адміна
app.post('/admin/login', async (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ token: ADMIN_TOKEN, success: true });
  } else {
    res.status(401).json({ error: 'Невірний пароль' });
  }
});

// Перевірка авторизації
app.get('/admin/check', requireAdmin, (_req, res) => {
  res.json({ authenticated: true });
});

// Schedule CRUD endpoints
app.get('/schedules', async (req, res) => {
  const { route } = req.query;
  const where = route ? { route: route as string } : {};
  const schedules = await prisma.schedule.findMany({
    where,
    orderBy: [{ route: 'asc' }, { departureTime: 'asc' }]
  });
  res.json(schedules);
});

app.get('/schedules/:route', async (req, res) => {
  const { route } = req.params;
  const schedules = await prisma.schedule.findMany({
    where: { route },
    orderBy: { departureTime: 'asc' }
  });
  res.json(schedules);
});

// Перевірка доступності місць для конкретного рейсу та дати
app.get('/schedules/:route/:departureTime/availability', async (req, res) => {
  const { route, departureTime } = req.params;
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'Date parameter is required' });
  }

  try {
    // Знаходимо графік
    const schedule = await prisma.schedule.findUnique({
      where: {
        route_departureTime: {
          route,
          departureTime
        }
      }
    });

    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    // Підраховуємо зайняті місця для цієї дати та часу
    const bookingDate = new Date(date as string);
    const startOfDay = new Date(bookingDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(bookingDate);
    endOfDay.setHours(23, 59, 59, 999);

    const bookings = await prisma.booking.findMany({
      where: {
        route,
        departureTime,
        date: {
          gte: startOfDay,
          lte: endOfDay
        }
      }
    });

    const bookedSeats = bookings.reduce((sum, booking) => sum + booking.seats, 0);
    const availableSeats = schedule.maxSeats - bookedSeats;

    res.json({
      scheduleId: schedule.id,
      maxSeats: schedule.maxSeats,
      bookedSeats,
      availableSeats,
      isAvailable: availableSeats > 0
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

app.post('/schedules', requireAdmin, async (req, res) => {
  const { route, departureTime, maxSeats } = req.body;
  if (!route || !departureTime) {
    return res.status(400).json({ error: 'Missing fields: route and departureTime are required' });
  }

  // Валідація формату часу (HH:MM)
  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(departureTime)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM (e.g., 08:00)' });
  }

  try {
    const schedule = await prisma.schedule.create({
      data: { 
        route, 
        departureTime,
        maxSeats: maxSeats ? Number(maxSeats) : 20
      }
    });
    res.status(201).json(schedule);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Schedule with this route and time already exists' });
    }
    res.status(500).json({ error: 'Failed to create schedule' });
  }
});

app.put('/schedules/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { route, departureTime, maxSeats } = req.body;

  if (!route || !departureTime) {
    return res.status(400).json({ error: 'Missing fields: route and departureTime are required' });
  }

  // Валідація формату часу
  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(departureTime)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM (e.g., 08:00)' });
  }

  try {
    const schedule = await prisma.schedule.update({
      where: { id: Number(id) },
      data: { 
        route, 
        departureTime,
        maxSeats: maxSeats ? Number(maxSeats) : undefined
      }
    });
    res.json(schedule);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Schedule with this route and time already exists' });
    }
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

app.delete('/schedules/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.schedule.delete({
      where: { id: Number(id) }
    });
    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

// Booking endpoints
app.post('/bookings', async (req, res) => {
  const { route, date, departureTime, seats, name, phone, scheduleId, telegramUserId } = req.body;
  if (!route || !date || !departureTime || !seats || !name || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Валідація формату часу
  const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(departureTime)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM (e.g., 08:00)' });
  }

  // Перевірка доступності місць
  try {
    const schedule = await prisma.schedule.findUnique({
      where: {
        route_departureTime: {
          route,
          departureTime
        }
      }
    });

    if (schedule) {
      const bookingDate = new Date(date);
      const startOfDay = new Date(bookingDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(bookingDate);
      endOfDay.setHours(23, 59, 59, 999);

      const existingBookings = await prisma.booking.findMany({
        where: {
          route,
          departureTime,
          date: {
            gte: startOfDay,
            lte: endOfDay
          }
        }
      });

      const bookedSeats = existingBookings.reduce((sum, booking) => sum + booking.seats, 0);
      const requestedSeats = Number(seats);
      const availableSeats = schedule.maxSeats - bookedSeats;

      if (requestedSeats > availableSeats) {
        return res.status(400).json({ 
          error: `Недостатньо місць. Доступно: ${availableSeats}, запитується: ${requestedSeats}` 
        });
      }
    }
  } catch (error) {
    // Якщо графік не знайдено, все одно дозволяємо бронювання
  }

  // Шукаємо попередні бронювання з цим номером телефону
  // Якщо користувач вже підписувався - автоматично копіюємо його Telegram дані
  let telegramChatId: string | null = null;
  let bookingTelegramUserId: string | null = telegramUserId || null; // Використовуємо переданий з frontend
  
  try {
    const normalizedPhone = normalizePhone(phone);
    
    console.log(`🔍 Пошук попередніх бронювань для номера: ${phone} (нормалізований: ${normalizedPhone})`);
    
    // Отримуємо всі бронювання і шукаємо по нормалізованому номеру
    const allBookings = await prisma.booking.findMany({
      where: {
        telegramUserId: { 
          not: null,
          notIn: ['0', '', ' '] // Виключаємо невалідні значення
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    console.log(`📋 Знайдено ${allBookings.length} бронювань з валідним telegramUserId`);
    
    // Шукаємо бронювання з таким же нормалізованим номером
    const previousBooking = allBookings.find(b => 
      normalizePhone(b.phone) === normalizedPhone
    );
    
    if (previousBooking) {
      console.log(`✅ Знайдено попереднє бронювання #${previousBooking.id}:`, {
        chatId: previousBooking.telegramChatId,
        userId: previousBooking.telegramUserId
      });
    }
    
    if (previousBooking) {
      // Копіюємо chatId тільки якщо він валідний
      if (previousBooking.telegramChatId && 
          previousBooking.telegramChatId !== '0' && 
          previousBooking.telegramChatId.trim() !== '') {
        telegramChatId = previousBooking.telegramChatId;
      } else {
        console.log(`⚠️ Попереднє бронювання має невалідний chatId: ${previousBooking.telegramChatId}`);
      }
      
      // Якщо не було передано з frontend - беремо з попереднього бронювання
      if (!bookingTelegramUserId) {
        // Валідація: telegramUserId не може бути '0', 0, null, або порожнім
        if (previousBooking.telegramUserId && 
            previousBooking.telegramUserId !== '0' && 
            previousBooking.telegramUserId.trim() !== '') {
          bookingTelegramUserId = previousBooking.telegramUserId;
        } else if (previousBooking.telegramChatId && 
                   previousBooking.telegramChatId !== '0' && 
                   previousBooking.telegramChatId.trim() !== '') {
          // Для приватних чатів chat_id = user_id
          bookingTelegramUserId = previousBooking.telegramChatId;
          console.log(`⚠️ telegramUserId був невалідний (${previousBooking.telegramUserId}), використовуємо chatId як userId`);
        }
      }
      
      console.log(`✅ Знайдено попереднє бронювання для ${phone}, копіюємо Telegram дані (chatId: ${telegramChatId}, userId: ${bookingTelegramUserId})`);
    } else if (bookingTelegramUserId) {
      // Якщо це перше бронювання але є telegramUserId з frontend
      console.log(`✅ Перше бронювання для ${phone} з Telegram Login (userId: ${bookingTelegramUserId})`);
    } else {
      console.log(`📋 Попередніх бронювань для ${phone} не знайдено`);
    }
  } catch (error) {
    console.error('❌ Помилка пошуку попередніх бронювань:', error);
    // Продовжуємо з тим що є
  }
  
  // Фінальна валідація: для приватних чатів chat_id = user_id
  // Якщо є chatId але немає userId - використовуємо chatId як userId
  if (telegramChatId && 
      telegramChatId !== '0' && 
      telegramChatId.trim() !== '' && 
      !bookingTelegramUserId) {
    bookingTelegramUserId = telegramChatId;
    console.log(`⚠️ Використовуємо telegramChatId як telegramUserId для приватного чату: ${bookingTelegramUserId}`);
  }
  
  // Додаткова валідація перед записом
  if (telegramChatId === '0' || telegramChatId === '') {
    console.log(`⚠️ Невалідний telegramChatId (${telegramChatId}), встановлюємо null`);
    telegramChatId = null;
  }
  if (bookingTelegramUserId === '0' || bookingTelegramUserId === '') {
    console.log(`⚠️ Невалідний telegramUserId (${bookingTelegramUserId}), встановлюємо null`);
    bookingTelegramUserId = null;
  }
  
  console.log(`📝 Створюємо бронювання з Telegram даними:`, {
    chatId: telegramChatId,
    userId: bookingTelegramUserId,
    phone: phone
  });

  const booking = await prisma.booking.create({
    data: {
      route,
      date: new Date(date),
      departureTime,
      seats: Number(seats),
      name,
      phone,
      scheduleId: scheduleId ? Number(scheduleId) : null,
      telegramChatId,
      telegramUserId: bookingTelegramUserId
    }
  });

  // Відправка повідомлень в Telegram (якщо налаштовано)
  if (isTelegramEnabled()) {
    try {
      // Повідомлення адміну
      await sendBookingNotificationToAdmin({
        id: booking.id,
        route: booking.route,
        date: booking.date,
        departureTime: booking.departureTime,
        seats: booking.seats,
        name: booking.name,
        phone: booking.phone,
      });
      
      // Повідомлення клієнту (якщо він підписаний)
      const customerChatId = await getChatIdByPhone(booking.phone);
      if (customerChatId) {
        await sendBookingConfirmationToCustomer(customerChatId, {
          id: booking.id,
          route: booking.route,
          date: booking.date,
          departureTime: booking.departureTime,
          seats: booking.seats,
          name: booking.name,
        });
      }
    } catch (error) {
      console.error('Помилка відправки Telegram повідомлення:', error);
      // Не блокуємо бронювання якщо Telegram не працює
    }
  }

  res.status(201).json(booking);
});

app.get('/bookings', requireAdmin, async (_req, res) => {
  res.json(await prisma.booking.findMany({ orderBy: { createdAt: 'desc' }}));
});

// Пошук останнього бронювання по телефону
app.get('/bookings/by-phone/:phone', async (req, res) => {
  const { phone } = req.params;
  try {
    const lastBooking = await prisma.booking.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    res.json(lastBooking || null);
  } catch (error) {
    res.status(500).json({ error: 'Failed to find booking' });
  }
});

// Скасування бронювання користувачем (через Telegram)
app.delete('/bookings/:id/by-user', async (req, res) => {
  const { id } = req.params;
  const { telegramUserId } = req.body;
  
  if (!telegramUserId) {
    return res.status(400).json({ error: 'telegramUserId is required' });
  }
  
  try {
    // Перевірка що бронювання належить користувачу
    const booking = await prisma.booking.findUnique({
      where: { id: Number(id) }
    });
    
    if (!booking) {
      return res.status(404).json({ error: 'Бронювання не знайдено' });
    }
    
    if (booking.telegramUserId !== telegramUserId) {
      return res.status(403).json({ error: 'Це не ваше бронювання' });
    }
    
    // Видалити бронювання
    await prisma.booking.delete({
      where: { id: Number(id) }
    });
    
    console.log(`✅ Користувач ${telegramUserId} скасував бронювання #${id}`);
    
    res.json({ 
      success: true, 
      message: 'Бронювання скасовано',
      booking: {
        id: booking.id,
        route: booking.route,
        date: booking.date,
        departureTime: booking.departureTime
      }
    });
  } catch (error: any) {
    console.error('❌ Помилка скасування бронювання:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

app.delete('/bookings/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.booking.delete({
      where: { id: Number(id) }
    });
    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// Відправка нагадувань про поїздки на завтра (admin endpoint)
app.post('/telegram/send-reminders', requireAdmin, async (_req, res) => {
  if (!isTelegramEnabled()) {
    return res.status(400).json({ error: 'Telegram bot не налаштовано' });
  }

  try {
    // Знаходимо всі бронювання на завтра
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startOfDay = new Date(tomorrow);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(tomorrow);
    endOfDay.setHours(23, 59, 59, 999);

    const bookings = await prisma.booking.findMany({
      where: {
        date: {
          gte: startOfDay,
          lte: endOfDay
        },
        telegramChatId: { not: null }
      }
    });

    let sent = 0;
    let failed = 0;

    for (const booking of bookings) {
      if (booking.telegramChatId) {
        try {
          await sendTripReminder(booking.telegramChatId, {
            route: booking.route,
            date: booking.date,
            departureTime: booking.departureTime,
            name: booking.name
          });
          sent++;
        } catch (error) {
          console.error(`❌ Не вдалося надіслати нагадування для booking #${booking.id}:`, error);
          failed++;
        }
      }
    }

    res.json({
      success: true,
      message: `Нагадування відправлено: ${sent}, помилок: ${failed}`,
      total: bookings.length,
      sent,
      failed
    });
  } catch (error) {
    console.error('❌ Помилка відправки нагадувань:', error);
    res.status(500).json({ error: 'Failed to send reminders' });
  }
});

// Тестовий endpoint для перевірки Telegram підключення
app.get('/telegram/status', requireAdmin, (_req, res) => {
  res.json({
    enabled: isTelegramEnabled(),
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID ? 'configured' : 'not configured',
    botToken: process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured'
  });
});

// ============================================
// Viber Listings Endpoints
// ============================================

// Допоміжна функція: серіалізація Viber listing для JSON (дати в ISO рядок)
function serializeViberListing(row: { date: Date; createdAt: Date; updatedAt: Date; [key: string]: unknown }) {
  return {
    ...row,
    date: row.date instanceof Date ? row.date.toISOString() : row.date,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

// Отримати всі активні Viber оголошення
app.get('/viber-listings', async (req, res) => {
  try {
    const { active } = req.query;
    const where = active === 'true' ? { isActive: true } : {};
    const listings = await prisma.viberListing.findMany({
      where,
      orderBy: [
        { date: 'asc' },
        { createdAt: 'desc' }
      ]
    });
    res.json(listings.map(serializeViberListing));
  } catch (error) {
    console.error('❌ Помилка отримання Viber оголошень:', error);
    res.status(500).json({ error: 'Не вдалося завантажити Viber оголошення. Перевірте логи сервера.' });
  }
});

// Отримати Viber оголошення по маршруту та даті
app.get('/viber-listings/search', async (req, res) => {
  const { route, date } = req.query;
  
  if (!route || !date) {
    return res.status(400).json({ error: 'Route and date are required' });
  }
  
  try {
    const searchDate = new Date(date as string);
    const startOfDay = new Date(searchDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(searchDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const listings = await prisma.viberListing.findMany({
      where: {
        route: route as string,
        date: {
          gte: startOfDay,
          lte: endOfDay
        },
        isActive: true
      },
      orderBy: [{ date: 'asc' }, { departureTime: 'asc' }]
    });

    res.json(listings.map(serializeViberListing));
  } catch (error) {
    console.error('❌ Помилка пошуку Viber оголошень:', error);
    res.status(500).json({ error: 'Не вдалося пошукати Viber оголошення.' });
  }
});

// Створити Viber оголошення (Admin)
app.post('/viber-listings', requireAdmin, async (req, res) => {
  const { rawMessage } = req.body;
  
  if (!rawMessage) {
    return res.status(400).json({ error: 'rawMessage is required' });
  }
  
  try {
    // Спроба парсингу повідомлення
    const parsed = parseViberMessage(rawMessage);
    
    if (!parsed) {
      return res.status(400).json({ 
        error: 'Не вдалося розпарсити повідомлення. Перевірте формат.' 
      });
    }
    
    // Створюємо запис
    const listing = await prisma.viberListing.create({
      data: {
        rawMessage,
        senderName: parsed.senderName,
        listingType: parsed.listingType,
        route: parsed.route,
        date: parsed.date,
        departureTime: parsed.departureTime,
        seats: parsed.seats,
        phone: parsed.phone,
        notes: parsed.notes,
        isActive: true
      }
    });
    
    console.log(`✅ Створено Viber оголошення #${listing.id}:`, {
      type: listing.listingType,
      route: listing.route,
      date: listing.date,
      phone: listing.phone
    });
    
    res.status(201).json(listing);
  } catch (error: any) {
    console.error('❌ Помилка створення Viber оголошення:', error);
    res.status(500).json({ error: 'Failed to create Viber listing' });
  }
});

// Масове створення Viber оголошень з копіювання чату (Admin)
app.post('/viber-listings/bulk', requireAdmin, async (req, res) => {
  const { rawMessages } = req.body;
  
  if (!rawMessages) {
    return res.status(400).json({ error: 'rawMessages is required' });
  }
  
  try {
    const parsedMessages = parseViberMessages(rawMessages);
    
    if (parsedMessages.length === 0) {
      return res.status(400).json({ 
        error: 'Не вдалося розпарсити жодне повідомлення' 
      });
    }
    
    const created = [];
    const errors = [];
    
    for (let i = 0; i < parsedMessages.length; i++) {
      const parsed = parsedMessages[i];
      try {
        const listing = await prisma.viberListing.create({
          data: {
            rawMessage: `Parsed message ${i + 1}`,
            senderName: parsed.senderName,
            listingType: parsed.listingType,
            route: parsed.route,
            date: parsed.date,
            departureTime: parsed.departureTime,
            seats: parsed.seats,
            phone: parsed.phone,
            notes: parsed.notes,
            isActive: true
          }
        });
        created.push(listing);
      } catch (error) {
        errors.push({ index: i, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
    
    console.log(`✅ Створено ${created.length} Viber оголошень з ${parsedMessages.length}`);
    
    res.status(201).json({
      success: true,
      created: created.length,
      total: parsedMessages.length,
      errors: errors.length > 0 ? errors : undefined,
      listings: created
    });
  } catch (error: any) {
    console.error('❌ Помилка масового створення Viber оголошень:', error);
    res.status(500).json({ error: 'Failed to create Viber listings' });
  }
});

// Оновити Viber оголошення (Admin)
app.put('/viber-listings/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  try {
    const listing = await prisma.viberListing.update({
      where: { id: Number(id) },
      data: updates
    });
    res.json(listing);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Viber listing not found' });
    }
    console.error('❌ Помилка оновлення Viber оголошення:', error);
    res.status(500).json({ error: 'Failed to update Viber listing' });
  }
});

// Деактивувати Viber оголошення (Admin)
app.patch('/viber-listings/:id/deactivate', requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    const listing = await prisma.viberListing.update({
      where: { id: Number(id) },
      data: { isActive: false }
    });
    res.json(listing);
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Viber listing not found' });
    }
    console.error('❌ Помилка деактивації Viber оголошення:', error);
    res.status(500).json({ error: 'Failed to deactivate Viber listing' });
  }
});

// Видалити Viber оголошення (Admin)
app.delete('/viber-listings/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    await prisma.viberListing.delete({
      where: { id: Number(id) }
    });
    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Viber listing not found' });
    }
    console.error('❌ Помилка видалення Viber оголошення:', error);
    res.status(500).json({ error: 'Failed to delete Viber listing' });
  }
});

// Автоматичне деактивування старих оголошень (можна викликати з cron)
app.post('/viber-listings/cleanup-old', requireAdmin, async (_req, res) => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);
    
    const result = await prisma.viberListing.updateMany({
      where: {
        date: { lt: yesterday },
        isActive: true
      },
      data: { isActive: false }
    });
    
    console.log(`🧹 Деактивовано ${result.count} старих Viber оголошень`);
    
    res.json({
      success: true,
      deactivated: result.count,
      message: `Деактивовано ${result.count} оголошень`
    });
  } catch (error) {
    console.error('❌ Помилка очищення старих Viber оголошень:', error);
    res.status(500).json({ error: 'Failed to cleanup old listings' });
  }
});

// Глобальний обробник помилок — завжди повертаємо JSON
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ error: 'Помилка сервера' });
});

const PORT = process.env.PORT || 3000;

// Збираємо список зареєстрованих роутів для логів (Express 4)
function getRegisteredRoutes(): string[] {
  const routes: string[] = [];
  try {
    const router = (app as any)._router;
    const stack = router?.stack ?? [];
    function walk(layer: any, prefix = '') {
      if (!layer) return;
      const path = (prefix + (layer.route?.path ?? layer.path ?? '')).replace(/\/\//g, '/') || '/';
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).filter((m: string) => layer.route.methods[m]);
        methods.forEach((m: string) => routes.push(`${m.toUpperCase()} ${path}`));
      }
      if (layer.name === 'router' && layer.handle?.stack) {
        layer.handle.stack.forEach((l: any) => walk(l, path));
      }
    }
    stack.forEach((layer: any) => walk(layer));
  } catch (e) {
    console.warn('[KYIV-MALYN-BACKEND] Could not list routes:', e);
  }
  return [...new Set(routes)].sort();
}

app.listen(PORT, () => {
  const routes = getRegisteredRoutes();
  const hasViber = routes.some((r) => r.includes('viber-listings'));
  console.log('========================================');
  console.log(`[KYIV-MALYN-BACKEND] CODE_VERSION=${CODE_VERSION}`);
  console.log(`[KYIV-MALYN-BACKEND] cwd=${process.cwd()}`);
  console.log(`[KYIV-MALYN-BACKEND] RAILWAY_DEPLOYMENT_ID=${process.env.RAILWAY_DEPLOYMENT_ID ?? 'not set'}`);
  console.log(`[KYIV-MALYN-BACKEND] /viber-listings registered: ${hasViber ? 'YES' : 'NO'}`);
  console.log('[KYIV-MALYN-BACKEND] Routes:', routes.filter((r) => r.startsWith('GET ') || r.startsWith('POST ')).slice(0, 25).join(', '));
  if (!hasViber) console.warn('[KYIV-MALYN-BACKEND] WARNING: Viber routes missing — likely old build/cache');
  console.log('========================================');
  console.log(`API on http://localhost:${PORT}`);
});
