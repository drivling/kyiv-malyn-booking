import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { sendBookingNotificationToAdmin, sendBookingConfirmationToCustomer, getChatIdByPhone, isTelegramEnabled, sendTripReminder, sendTripReminderToday, sendInactivityReminder, buildInactivityReminderMessage, normalizePhone, sendViberListingNotificationToAdmin, sendViberListingConfirmationToUser, getNameByPhone, findOrCreatePersonByPhone, getPersonByPhone, notifyMatchingPassengersForNewDriver, notifyMatchingDriversForNewPassenger, getTelegramScenarioLinks, getPersonByTelegram, sendRideShareRequestToDriver, sendMessageViaUserAccount, resolveNameByPhoneFromTelegram, setAnnounceDraft } from './telegram';
import crypto from 'crypto';
import { parseViberMessage, parseViberMessages } from './viber-parser';

// Маркер версії коду — змінити при оновленні, щоб у логах Railway було видно новий деплой
const CODE_VERSION = 'viber-v2-2026';

// Лог при завантаженні модуля — якщо це є в Deploy Logs, деплой новий
console.log('[KYIV-MALYN-BACKEND] BOOT codeVersion=' + CODE_VERSION + ' build=' + (typeof __dirname !== 'undefined' ? 'node' : 'unknown'));

// Сесія для одноразового промо: якщо TELEGRAM_USER_SESSION_PATH не задано — шукаємо файл у репо (telegram-user/session_telegram_user.session)
if (!process.env.TELEGRAM_USER_SESSION_PATH?.trim() && process.env.TELEGRAM_API_ID?.trim() && process.env.TELEGRAM_API_HASH?.trim()) {
  const defaultSessionPath = path.join(process.cwd(), 'telegram-user', 'session_telegram_user');
  const defaultSessionFile = defaultSessionPath + '.session';
  if (fs.existsSync(defaultSessionFile)) {
    process.env.TELEGRAM_USER_SESSION_PATH = defaultSessionPath;
    console.log('[KYIV-MALYN-BACKEND] Telegram user session loaded from repo file telegram-user/session_telegram_user.session');
  }
}

const app = express();
const prisma = new PrismaClient();

// CORS: дозволяємо фронт (malin.kiev.ua + Railway preview)
const allowedOrigins = [
  'https://malin.kiev.ua',
  'https://www.malin.kiev.ua',
  'http://localhost:5173',
  'http://localhost:3000',
];
const corsOptions: cors.CorsOptions = {
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some((o) => origin === o || origin.endsWith('.railway.app'))) {
      cb(null, true);
    } else {
      cb(null, true); // для зручності залишаємо приймати всі; за потреби звужте
    }
  },
  credentials: true,
};
app.use(cors(corsOptions));
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

app.get('/health', (_req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
  });
  res.json({
    status: 'ok',
    version: 3,
    viber: true,
    codeVersion: CODE_VERSION,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    cwd: process.cwd(),
  });
});

app.get('/status', (_req, res) => {
  res.json({
    status: 'ok',
    version: 3,
    viber: true,
    codeVersion: CODE_VERSION,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    cwd: process.cwd(),
  });
});

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

// Телефон підтримки для уточнення бронювання (з графіка; для напрямків з Києвом)
app.get('/schedules-support-phone', async (_req, res) => {
  try {
    const schedule = await prisma.schedule.findFirst({
      where: { supportPhone: { not: null } },
      select: { supportPhone: true }
    });
    res.json({ supportPhone: schedule?.supportPhone ?? null });
  } catch (error) {
    res.status(500).json({ supportPhone: null });
  }
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

/** Телефон підтримки для маршруту з графіка (формат +380(93)1701835) */
export async function getSupportPhoneForRoute(route: string): Promise<string | null> {
  const schedule = await prisma.schedule.findFirst({
    where: { route, supportPhone: { not: null } },
    select: { supportPhone: true }
  });
  return schedule?.supportPhone ?? null;
}

app.post('/schedules', requireAdmin, async (req, res) => {
  const { route, departureTime, maxSeats, supportPhone } = req.body;
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
        maxSeats: maxSeats ? Number(maxSeats) : 20,
        supportPhone: supportPhone != null && String(supportPhone).trim() !== '' ? String(supportPhone).trim() : null
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
  const { route, departureTime, maxSeats, supportPhone } = req.body;

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
        maxSeats: maxSeats ? Number(maxSeats) : undefined,
        supportPhone: supportPhone !== undefined ? (supportPhone != null && String(supportPhone).trim() !== '' ? String(supportPhone).trim() : null) : undefined
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

  // Прив'язка до Person та пошук Telegram: спочатку Person, потім попередні бронювання
  let telegramChatId: string | null = null;
  let bookingTelegramUserId: string | null = telegramUserId || null;
  const fullNameForPerson = typeof name === 'string' && name.trim() ? name.trim() : name;
  const person = await findOrCreatePersonByPhone(phone, { fullName: fullNameForPerson });

  // Оновлюємо ім'я в усіх попередніх бронюваннях та в Viber оголошеннях цієї персони
  if (fullNameForPerson) {
    try {
      const [bookingsUpdated, viberUpdated] = await Promise.all([
        prisma.booking.updateMany({
          where: { personId: person.id },
          data: { name: fullNameForPerson },
        }),
        prisma.viberListing.updateMany({
          where: { personId: person.id },
          data: { senderName: fullNameForPerson },
        }),
      ]);
      if (bookingsUpdated.count > 0 || viberUpdated.count > 0) {
        console.log(`📝 Оновлено ім'я персони: booking.count=${bookingsUpdated.count}, viberListing.count=${viberUpdated.count}`);
      }
    } catch (err) {
      console.error('Помилка оновлення імені в бронюваннях/Viber:', err);
      // Не блокуємо створення бронювання
    }
  }

  try {
    const normalizedPhone = normalizePhone(phone);
    const personRecord = await getPersonByPhone(phone);

    if (personRecord?.telegramChatId && personRecord.telegramChatId !== '0' && personRecord.telegramChatId.trim() !== '') {
      telegramChatId = personRecord.telegramChatId;
    }
    if (personRecord?.telegramUserId && personRecord.telegramUserId !== '0' && personRecord.telegramUserId.trim() !== '') {
      bookingTelegramUserId = bookingTelegramUserId || personRecord.telegramUserId;
    }

    if (!telegramChatId || !bookingTelegramUserId) {
      const allBookings = await prisma.booking.findMany({
        where: {
          telegramUserId: { not: null, notIn: ['0', '', ' '] },
        },
        orderBy: { createdAt: 'desc' },
      });
      const previousBooking = allBookings.find((b) => normalizePhone(b.phone) === normalizedPhone);
      if (previousBooking) {
        if (previousBooking.telegramChatId && previousBooking.telegramChatId !== '0' && previousBooking.telegramChatId.trim() !== '') {
          telegramChatId = telegramChatId || previousBooking.telegramChatId;
        }
        if (!bookingTelegramUserId && previousBooking.telegramUserId && previousBooking.telegramUserId !== '0' && previousBooking.telegramUserId.trim() !== '') {
          bookingTelegramUserId = previousBooking.telegramUserId;
        } else if (!bookingTelegramUserId && previousBooking.telegramChatId) {
          bookingTelegramUserId = previousBooking.telegramChatId;
        }
      }
    }

    console.log(`🔍 Person id=${person.id}, Telegram: chatId=${telegramChatId}, userId=${bookingTelegramUserId}`);
  } catch (error) {
    console.error('❌ Помилка пошуку Person/попередніх бронювань:', error);
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
      telegramUserId: bookingTelegramUserId,
      personId: person.id,
    },
  });

  // Відправка повідомлень в Telegram (якщо налаштовано)
  if (isTelegramEnabled()) {
    try {
      // Повідомлення адміну (тільки для маршруток; source за замовч. "schedule")
      await sendBookingNotificationToAdmin({
        id: booking.id,
        route: booking.route,
        date: booking.date,
        departureTime: booking.departureTime,
        seats: booking.seats,
        name: booking.name,
        phone: booking.phone,
        source: booking.source,
      });
      
      // Повідомлення клієнту (якщо він підписаний; тільки для маршруток). Телефон підтримки — з графіка для цього маршруту.
      const customerChatId = await getChatIdByPhone(booking.phone);
      if (customerChatId) {
        const supportPhone = await getSupportPhoneForRoute(booking.route);
        await sendBookingConfirmationToCustomer(customerChatId, {
          id: booking.id,
          route: booking.route,
          date: booking.date,
          departureTime: booking.departureTime,
          seats: booking.seats,
          name: booking.name,
          source: booking.source,
          supportPhone: supportPhone ?? undefined,
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

// Пошук останнього бронювання або персони по телефону (для автозаповнення імені на сторінці бронювання)
app.get('/bookings/by-phone/:phone', async (req, res) => {
  const { phone } = req.params;
  try {
    const normalized = normalizePhone(phone);

    // 1) Шукаємо Person за телефоном
    const person = await getPersonByPhone(phone);
    if (person) {
      const byPerson = await prisma.booking.findFirst({
        where: { personId: person.id },
        orderBy: { createdAt: 'desc' },
      });
      if (byPerson) {
        return res.json(byPerson);
      }
      // Персона є, але бронювань немає — повертаємо ім'я з Person для автозаповнення
      if (person.fullName && person.fullName.trim()) {
        return res.json({ name: person.fullName.trim(), phone: person.phoneNormalized });
      }
    }

    // 2) Шукаємо в таблиці Booking по нормалізованому телефону
    const allRecent = await prisma.booking.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const lastBooking = allRecent.find((b) => normalizePhone(b.phone) === normalized) ?? null;
    res.json(lastBooking);
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
      },
      include: { viberListing: true }
    });

    let sent = 0;
    let failed = 0;

    for (const booking of bookings) {
      if (booking.telegramChatId) {
        try {
          const driver = booking.viberListing
            ? { senderName: booking.viberListing.senderName, phone: booking.viberListing.phone }
            : undefined;
          await sendTripReminder(booking.telegramChatId, {
            route: booking.route,
            date: booking.date,
            departureTime: booking.departureTime,
            name: booking.name,
            driver
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

// Нагадування в день поїздки (сьогодні) — для cron щодня вранці
app.post('/telegram/send-reminders-today', requireAdmin, async (_req, res) => {
  if (!isTelegramEnabled()) {
    return res.status(400).json({ error: 'Telegram bot не налаштовано' });
  }

  try {
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const bookings = await prisma.booking.findMany({
      where: {
        date: {
          gte: startOfDay,
          lte: endOfDay
        },
        telegramChatId: { not: null }
      },
      include: { viberListing: true }
    });

    let sent = 0;
    let failed = 0;

    for (const booking of bookings) {
      if (booking.telegramChatId) {
        try {
          const driver = booking.viberListing
            ? { senderName: booking.viberListing.senderName, phone: booking.viberListing.phone }
            : undefined;
          await sendTripReminderToday(booking.telegramChatId, {
            route: booking.route,
            date: booking.date,
            departureTime: booking.departureTime,
            name: booking.name,
            driver
          });
          sent++;
        } catch (error) {
          console.error(`❌ Не вдалося надіслати нагадування (сьогодні) для booking #${booking.id}:`, error);
          failed++;
        }
      }
    }

    res.json({
      success: true,
      message: `Нагадування (сьогодні) відправлено: ${sent}, помилок: ${failed}`,
      total: bookings.length,
      sent,
      failed
    });
  } catch (error) {
    console.error('❌ Помилка відправки нагадувань (сьогодні):', error);
    res.status(500).json({ error: 'Failed to send reminders (today)' });
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

// Публічний опис Telegram-сценаріїв для фронтенду/лендінгу
app.get('/telegram/scenarios', (_req, res) => {
  const links = getTelegramScenarioLinks();
  res.json({
    enabled: isTelegramEnabled(),
    scenarios: {
      driver: {
        title: 'Запит на поїздку як водій',
        command: '/adddriverride',
        deepLink: links.driver,
      },
      passenger: {
        title: 'Запит на поїздку як пасажир',
        command: '/addpassengerride',
        deepLink: links.passenger,
      },
      view: {
        title: 'Вільний перегляд поїздок',
        command: '/poputky',
        deepLink: links.view,
        webLink: links.poputkyWeb,
      },
    },
  });
});

/** Маппінг "звідки–куди" (сайт) → route (бот). Значення: malyn, kyiv, zhytomyr, korosten */
function mapFromToToRoute(from: string, to: string): string | null {
  const f = (from || '').toLowerCase().trim();
  const t = (to || '').toLowerCase().trim();
  if (f === 'kyiv' && t === 'malyn') return 'Kyiv-Malyn';
  if (f === 'malyn' && t === 'kyiv') return 'Malyn-Kyiv';
  if (f === 'zhytomyr' && t === 'malyn') return 'Zhytomyr-Malyn';
  if (f === 'malyn' && t === 'zhytomyr') return 'Malyn-Zhytomyr';
  if (f === 'korosten' && t === 'malyn') return 'Korosten-Malyn';
  if (f === 'malyn' && t === 'korosten') return 'Malyn-Korosten';
  return null;
}

// Чернетка оголошення з сайту poputky: зберігає маршрут/дату/час/примітки, повертає посилання на бота з токеном
app.post('/poputky/announce-draft', express.json(), (req, res) => {
  const { role, from, to, date, time, notes, priceUah } = req.body as { role?: string; from?: string; to?: string; date?: string; time?: string; notes?: string; priceUah?: unknown };
  let priceUahParsed: number | null | undefined;
  if (priceUah !== undefined) {
    const num = Number(priceUah);
    if (!Number.isFinite(num) || num < 0) {
      return res.status(400).json({ error: "Ціна має бути невід'ємним числом" });
    }
    priceUahParsed = Math.round(num);
  }
  if (!role || (role !== 'driver' && role !== 'passenger')) {
    return res.status(400).json({ error: 'role має бути driver або passenger' });
  }
  const route = mapFromToToRoute(from ?? '', to ?? '');
  if (!route) {
    return res.status(400).json({ error: 'Поїздки можуть бути лише з/до Малина. Оберіть звідки та куди (наприклад Малин ↔ Київ).' });
  }
  const dateStr = (date || '').toString().trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: 'Вкажіть коректну дату поїздки' });
  }
  const departureTime = (time || '').toString().trim() || null;
  if (departureTime) {
    const singleTime = /^\d{1,2}:\d{2}$/;
    const timeRange = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/;
    if (!singleTime.test(departureTime) && !timeRange.test(departureTime)) {
      return res.status(400).json({ error: 'Час: HH:MM або HH:MM-HH:MM (інтервал)' });
    }
  }
  const token = crypto.randomBytes(8).toString('hex');
  setAnnounceDraft(token, { role: role as 'driver' | 'passenger', route, date: dateStr, departureTime: departureTime || undefined, notes: (notes || '').trim() || undefined, priceUah: priceUahParsed ?? undefined });
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'malin_kiev_ua_bot';
  const deepLink = `https://t.me/${botUsername}?start=${role}_${token}`;
  return res.json({ token, deepLink });
});

// Створити запит на попутку з сайту (потрібен Telegram login у вебі)
app.post('/rideshare/request', async (req, res) => {
  const { driverListingId, telegramUserId } = req.body as { driverListingId?: number; telegramUserId?: string };

  if (!driverListingId || !telegramUserId) {
    return res.status(400).json({ error: 'driverListingId and telegramUserId are required' });
  }

  try {
    const driverListing = await prisma.viberListing.findUnique({ where: { id: Number(driverListingId) } });
    if (!driverListing || driverListing.listingType !== 'driver' || !driverListing.isActive) {
      return res.status(404).json({ error: 'Оголошення водія не знайдено або неактивне' });
    }

    const person = await getPersonByTelegram(String(telegramUserId), '');
    if (!person?.phoneNormalized) {
      return res.status(400).json({
        error: 'Щоб бронювати попутки, підключіть номер телефону в Telegram боті через /start',
      });
    }

    const driverDate = new Date(driverListing.date);
    const startOfDay = new Date(driverDate.getFullYear(), driverDate.getMonth(), driverDate.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const driverTime = driverListing.departureTime ?? null;

    const existingPassenger = await prisma.viberListing.findFirst({
      where: {
        listingType: 'passenger',
        isActive: true,
        phone: person.phoneNormalized,
        route: driverListing.route,
        date: { gte: startOfDay, lt: endOfDay },
        departureTime: driverTime,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingPassenger) {
      const existingRequest = await prisma.rideShareRequest.findFirst({
        where: {
          passengerListingId: existingPassenger.id,
          driverListingId: driverListing.id,
          status: { in: ['pending', 'confirmed'] },
        },
      });
      if (existingRequest) {
        return res.status(400).json({
          error: 'Ви вже надсилали запит цьому водію на цей маршрут і дату. Очікуйте підтвердження або перегляньте /mybookings.',
        });
      }
    }

    const passengerListing = existingPassenger ?? await prisma.viberListing.create({
      data: {
        rawMessage: `[Сайт /poputky] ${driverListing.route} ${driverListing.date.toISOString().slice(0, 10)} ${driverListing.departureTime ?? ''}`,
        senderName: person.fullName?.trim() || 'Пасажир',
        listingType: 'passenger',
        route: driverListing.route,
        date: driverListing.date,
        departureTime: driverListing.departureTime,
        seats: null,
        phone: person.phoneNormalized,
        notes: 'Запит створено з сайту /poputky',
        isActive: true,
        personId: person.id,
      },
    });

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const requestRecord = await prisma.rideShareRequest.create({
      data: {
        passengerListingId: passengerListing.id,
        driverListingId: driverListing.id,
        status: 'pending',
        expiresAt,
      },
    });

    const driverNotified = await sendRideShareRequestToDriver(
      requestRecord.id,
      {
        route: driverListing.route,
        date: driverListing.date,
        departureTime: driverListing.departureTime,
        phone: driverListing.phone,
        senderName: driverListing.senderName,
      },
      {
        phone: passengerListing.phone,
        senderName: passengerListing.senderName,
        notes: passengerListing.notes,
      }
    ).catch((err) => {
      console.error('Telegram ride-share notify driver error:', err);
      return false;
    });

    res.status(201).json({
      success: true,
      requestId: requestRecord.id,
      message: driverNotified
        ? 'Запит надіслано водію. Очікуйте підтвердження до 1 години.'
        : 'Запит створено, але водій ще не підключений до Telegram. Спробуйте зв’язатися телефоном.',
      driverNotified,
    });
  } catch (error) {
    console.error('❌ Помилка створення ride-share запиту з сайту:', error);
    res.status(500).json({ error: 'Не вдалося створити запит на попутку' });
  }
});

// ============================================
// Viber Listings Endpoints
// ============================================

type ViberListingMergeInput = {
  rawMessage: string;
  senderName?: string | null;
  listingType: 'driver' | 'passenger';
  route: string;
  date: Date;
  departureTime: string | null;
  seats: number | null;
  phone: string;
  notes: string | null;
  priceUah?: number | null;
  isActive: boolean;
  personId?: number | null;
};

function hasNonEmptyText(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

function mergeTextField(oldVal: string | null, newVal: string | null): string | null {
  if (!hasNonEmptyText(newVal)) return oldVal;
  if (!hasNonEmptyText(oldVal)) return newVal;
  const oldTrim = oldVal!.trim();
  const newTrim = newVal!.trim();
  if (oldTrim === newTrim) return oldVal;
  if (newTrim.length > oldTrim.length && !oldTrim.includes(newTrim)) {
    return `${oldTrim} | ${newTrim}`;
  }
  return oldVal;
}

function mergeSenderName(oldVal: string | null, newVal: string | null): string | null {
  if (!hasNonEmptyText(oldVal) && hasNonEmptyText(newVal)) return newVal;
  return oldVal;
}

function mergeRawMessage(oldRaw: string, newRaw: string): string {
  const oldTrim = (oldRaw || '').trim();
  const newTrim = (newRaw || '').trim();
  if (!newTrim) return oldRaw;
  if (!oldTrim) return newRaw;
  if (oldTrim.includes(newTrim)) return oldRaw;
  if (newTrim.includes(oldTrim)) return newRaw;
  return `${oldRaw}\n---\n${newRaw}`;
}

async function createOrMergeViberListing(
  data: ViberListingMergeInput
): Promise<{ listing: any; isNew: boolean }> {
  const personId = data.personId ?? null;

  // Якщо немає personId – немає надійного способу визначити клієнта, просто створюємо запис
  if (!personId) {
    const listing = await prisma.viberListing.create({ data });
    return { listing, isNew: true };
  }

  const date = data.date;
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const existing = await prisma.viberListing.findFirst({
    where: {
      listingType: data.listingType,
      personId,
      route: data.route,
      isActive: true,
      date: {
        gte: startOfDay,
        lt: endOfDay,
      },
      departureTime: data.departureTime ?? null,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!existing) {
    const listing = await prisma.viberListing.create({ data });
    return { listing, isNew: true };
  }

  const mergedNotes = mergeTextField(existing.notes, data.notes);
  const mergedSenderName = mergeSenderName(existing.senderName, data.senderName ?? null);

  const updated = await prisma.viberListing.update({
    where: { id: existing.id },
    data: {
      rawMessage: mergeRawMessage(existing.rawMessage, data.rawMessage),
      senderName: mergedSenderName ?? undefined,
      seats: data.seats != null ? data.seats : existing.seats,
      phone: existing.phone || data.phone,
      notes: mergedNotes,
      priceUah: data.priceUah != null ? data.priceUah : existing.priceUah,
      isActive: existing.isActive || data.isActive,
      personId: existing.personId ?? personId,
    },
  });

  console.log(
    `♻️ Viber listing merged with existing #${existing.id} (client+route+date+time match)`
  );

  return { listing: updated, isNew: false };
}

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
    
    const nameFromDb = parsed.phone ? await getNameByPhone(parsed.phone) : null;
    let senderName = nameFromDb ?? parsed.senderName ?? null;
    if ((!senderName || !String(senderName).trim()) && parsed.phone?.trim()) {
      const nameFromTg = await resolveNameByPhoneFromTelegram(parsed.phone);
      if (nameFromTg?.trim()) senderName = nameFromTg.trim();
    }
    const person = parsed.phone
      ? await findOrCreatePersonByPhone(parsed.phone, { fullName: senderName ?? undefined })
      : null;

    const { listing } = await createOrMergeViberListing({
      rawMessage,
      senderName: senderName ?? undefined,
      listingType: parsed.listingType,
      route: parsed.route,
      date: parsed.date,
      departureTime: parsed.departureTime,
      seats: parsed.seats,
      phone: parsed.phone,
      notes: parsed.notes,
      isActive: true,
      personId: person?.id ?? undefined,
    });
    
    console.log(`✅ Створено Viber оголошення #${listing.id}:`, {
      type: listing.listingType,
      route: listing.route,
      date: listing.date,
      phone: listing.phone
    });

    if (isTelegramEnabled()) {
      sendViberListingNotificationToAdmin({
        id: listing.id,
        listingType: listing.listingType,
        route: listing.route,
        date: listing.date,
        departureTime: listing.departureTime,
        seats: listing.seats,
        phone: listing.phone,
        senderName: listing.senderName,
        notes: listing.notes,
        priceUah: listing.priceUah ?? undefined,
      }).catch((err) => console.error('Telegram Viber notify:', err));
      // Якщо є телефон — спроба надіслати автору оголошення в Telegram (якщо він є в базі)
      if (listing.phone && listing.phone.trim()) {
        sendViberListingConfirmationToUser(listing.phone, {
          id: listing.id,
          route: listing.route,
          date: listing.date,
          departureTime: listing.departureTime,
          seats: listing.seats,
          listingType: listing.listingType,
          priceUah: listing.priceUah ?? undefined,
        }).catch((err) => console.error('Telegram Viber user notify:', err));
      }
      // Сповістити про збіги водій/пасажир — як при додаванні через бота
      const authorChatId = listing.phone?.trim() ? await getChatIdByPhone(listing.phone) : null;
      if (listing.listingType === 'driver') {
        notifyMatchingPassengersForNewDriver(listing, authorChatId).catch((err) => console.error('Telegram match notify (driver):', err));
      } else if (listing.listingType === 'passenger') {
        notifyMatchingDriversForNewPassenger(listing, authorChatId).catch((err) => console.error('Telegram match notify (passenger):', err));
      }
    }

    res.status(201).json(serializeViberListing(listing));
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
      const { parsed, rawMessage: rawText } = parsedMessages[i];
      try {
        const nameFromDb = parsed.phone ? await getNameByPhone(parsed.phone) : null;
        let senderName = nameFromDb ?? parsed.senderName ?? null;
        if ((!senderName || !String(senderName).trim()) && parsed.phone?.trim()) {
          const nameFromTg = await resolveNameByPhoneFromTelegram(parsed.phone);
          if (nameFromTg?.trim()) senderName = nameFromTg.trim();
        }
        const person = parsed.phone
          ? await findOrCreatePersonByPhone(parsed.phone, { fullName: senderName ?? undefined })
          : null;
        const { listing, isNew } = await createOrMergeViberListing({
          rawMessage: rawText,
          senderName: senderName ?? undefined,
          listingType: parsed.listingType,
          route: parsed.route,
          date: parsed.date,
          departureTime: parsed.departureTime,
          seats: parsed.seats,
          phone: parsed.phone,
          notes: parsed.notes,
          isActive: true,
          personId: person?.id ?? undefined,
        });
        if (isNew) {
          created.push(listing);
        }
        if (isTelegramEnabled()) {
          sendViberListingNotificationToAdmin({
            id: listing.id,
            listingType: listing.listingType,
            route: listing.route,
            date: listing.date,
            departureTime: listing.departureTime,
            seats: listing.seats,
            phone: listing.phone,
            senderName: listing.senderName,
            notes: listing.notes,
            priceUah: listing.priceUah ?? undefined,
          }).catch((err) => console.error('Telegram Viber notify:', err));
          if (listing.phone && listing.phone.trim()) {
            sendViberListingConfirmationToUser(listing.phone, {
              id: listing.id,
              route: listing.route,
              date: listing.date,
              departureTime: listing.departureTime,
              seats: listing.seats,
              listingType: listing.listingType,
              priceUah: listing.priceUah ?? undefined,
            }).catch((err) => console.error('Telegram Viber user notify:', err));
          }
          // Сповістити про збіги водій/пасажир (як при додаванні через бота)
          const authorChatId = listing.phone?.trim() ? await getChatIdByPhone(listing.phone) : null;
          if (listing.listingType === 'driver') {
            notifyMatchingPassengersForNewDriver(listing, authorChatId).catch((err) => console.error('Telegram match notify (driver):', err));
          } else if (listing.listingType === 'passenger') {
            notifyMatchingDriversForNewPassenger(listing, authorChatId).catch((err) => console.error('Telegram match notify (passenger):', err));
          }
        }
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

// Дозволені поля для оновлення Viber оголошення (без id, createdAt, updatedAt)
const VIBER_LISTING_UPDATE_FIELDS = [
  'rawMessage', 'senderName', 'listingType', 'route', 'date', 'departureTime', 'seats', 'phone', 'notes', 'priceUah', 'isActive'
] as const;

// Оновити Viber оголошення (Admin)
app.put('/viber-listings/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  for (const key of VIBER_LISTING_UPDATE_FIELDS) {
    if (body[key] !== undefined) {
      if (key === 'date' && typeof body[key] === 'string') {
        updates[key] = new Date(body[key] as string);
      } else if (key === 'priceUah') {
        const v = body[key];
        updates[key] = v === null || v === '' ? null : (typeof v === 'number' ? v : parseInt(String(v), 10));
      } else {
        updates[key] = body[key];
      }
    }
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No allowed fields to update' });
  }
  try {
    const listing = await prisma.viberListing.update({
      where: { id: Number(id) },
      data: updates
    });
    res.json(serializeViberListing(listing));
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

// ——— Одноразова реклама каналу (Person без Telegram). Без зміни telegramPromoSentAt. ———
function buildChannelPromoMessage(): string {
  const links = getTelegramScenarioLinks();
  const channelLink = process.env.TELEGRAM_CHANNEL_LINK?.trim() || links.poputkyWeb;
  return `
📢 <b>Поїздки Київ ↔ Малин ↔ Житомир ↔ Коростень</b>

Підпишіться на наш бот — бронювання маршруток та попуток у один клік:
• як водій: ${links.driver}
• як пасажир: ${links.passenger}

Сайт: <a href="https://malin.kiev.ua">malin.kiev.ua</a>
  `.trim();
}

/** Створити контакт (Person) за телефоном та іменем. Якщо номер вже є — оновлює fullName. */
app.post('/admin/person', requireAdmin, async (req, res) => {
  try {
    const { phone, fullName } = req.body as { phone?: string; fullName?: string };
    const rawPhone = typeof phone === 'string' ? phone.trim() : '';
    const rawName = typeof fullName === 'string' ? fullName.trim() : '';
    if (!rawPhone) {
      res.status(400).json({ error: 'Потрібен номер телефону' });
      return;
    }
    if (!rawName) {
      res.status(400).json({ error: 'Потрібне ім\'я' });
      return;
    }
    const person = await findOrCreatePersonByPhone(rawPhone, { fullName: rawName });
    res.json(person);
  } catch (e) {
    console.error('❌ POST /admin/person:', e);
    res.status(500).json({ error: 'Не вдалося створити контакт' });
  }
});

/** Список Person для управління даними. Query: ?search= — пошук по телефону або імені. */
app.get('/admin/persons', requireAdmin, async (req, res) => {
  try {
    const search = (req.query.search as string)?.trim() || '';
    const where = search
      ? {
          OR: [
            { phoneNormalized: { contains: search.replace(/\D/g, '') } },
            { fullName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const persons = await prisma.person.findMany({
      where,
      orderBy: { id: 'asc' },
      include: {
        _count: { select: { bookings: true, viberListings: true } },
      },
    });
    res.json(persons);
  } catch (e) {
    console.error('❌ GET /admin/persons:', e);
    res.status(500).json({ error: 'Не вдалося завантажити список персон' });
  }
});

/** Одна персона за id. */
app.get('/admin/persons/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Невірний id' });
      return;
    }
    const person = await prisma.person.findUnique({
      where: { id },
      include: {
        _count: { select: { bookings: true, viberListings: true } },
      },
    });
    if (!person) {
      res.status(404).json({ error: 'Персону не знайдено' });
      return;
    }
    res.json(person);
  } catch (e) {
    console.error('❌ GET /admin/persons/:id:', e);
    res.status(500).json({ error: 'Не вдалося завантажити персону' });
  }
});

/** Оновити персону. При зміні телефону або імені оновлюються пов’язані Booking (phone, name) та ViberListing (phone, senderName). */
app.put('/admin/persons/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Невірний id' });
      return;
    }
    const body = req.body as {
      phone?: string;
      phoneNormalized?: string;
      fullName?: string | null;
      telegramChatId?: string | null;
      telegramUserId?: string | null;
      telegramPromoSentAt?: string | null;
      telegramReminderSentAt?: string | null;
    };
    const person = await prisma.person.findUnique({ where: { id } });
    if (!person) {
      res.status(404).json({ error: 'Персону не знайдено' });
      return;
    }
    const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : (typeof body.phoneNormalized === 'string' ? body.phoneNormalized.trim() : '');
    const newPhoneNormalized = rawPhone ? normalizePhone(rawPhone) : person.phoneNormalized;
    const newFullName = body.fullName !== undefined ? (typeof body.fullName === 'string' ? body.fullName.trim() || null : null) : person.fullName;
    const newTelegramChatId = body.telegramChatId !== undefined ? (body.telegramChatId === '' ? null : body.telegramChatId) : person.telegramChatId;
    const newTelegramUserId = body.telegramUserId !== undefined ? (body.telegramUserId === '' ? null : body.telegramUserId) : person.telegramUserId;
    let newTelegramPromoSentAt: Date | null = person.telegramPromoSentAt;
    if (body.telegramPromoSentAt !== undefined) {
      if (body.telegramPromoSentAt === null || body.telegramPromoSentAt === '') {
        newTelegramPromoSentAt = null;
      } else {
        const parsed = new Date(body.telegramPromoSentAt as string);
        newTelegramPromoSentAt = Number.isNaN(parsed.getTime()) ? person.telegramPromoSentAt : parsed;
      }
    }
    let newTelegramReminderSentAt: Date | null = person.telegramReminderSentAt;
    if (body.telegramReminderSentAt !== undefined) {
      if (body.telegramReminderSentAt === null || body.telegramReminderSentAt === '') {
        newTelegramReminderSentAt = null;
      } else {
        const parsed = new Date(body.telegramReminderSentAt as string);
        newTelegramReminderSentAt = Number.isNaN(parsed.getTime()) ? person.telegramReminderSentAt : parsed;
      }
    }

    if (!newPhoneNormalized) {
      res.status(400).json({ error: 'Телефон не може бути порожнім' });
      return;
    }

    const phoneChanged = newPhoneNormalized !== person.phoneNormalized;
    const nameChanged = newFullName !== person.fullName;

    const updated = await prisma.person.update({
      where: { id },
      data: {
        phoneNormalized: newPhoneNormalized,
        fullName: newFullName,
        telegramChatId: newTelegramChatId,
        telegramUserId: newTelegramUserId,
        telegramPromoSentAt: newTelegramPromoSentAt,
        telegramReminderSentAt: newTelegramReminderSentAt,
      },
    });

    if (phoneChanged || nameChanged) {
      const bookingData: { phone?: string; name?: string } = {};
      if (phoneChanged) bookingData.phone = newPhoneNormalized;
      if (nameChanged) bookingData.name = newFullName ?? '';
      const viberData: { phone?: string; senderName?: string | null } = {};
      if (phoneChanged) viberData.phone = newPhoneNormalized;
      if (nameChanged) viberData.senderName = newFullName;

      const [bookingsUpdated, viberUpdated] = await Promise.all([
        Object.keys(bookingData).length > 0
          ? prisma.booking.updateMany({ where: { personId: id }, data: bookingData })
          : Promise.resolve({ count: 0 }),
        Object.keys(viberData).length > 0
          ? prisma.viberListing.updateMany({ where: { personId: id }, data: viberData })
          : Promise.resolve({ count: 0 }),
      ]);
      if (bookingsUpdated.count > 0 || viberUpdated.count > 0) {
        console.log(`📝 Оновлено персону #${id}: booking.count=${bookingsUpdated.count}, viberListing.count=${viberUpdated.count}`);
      }
    }

    res.json(updated);
  } catch (e) {
    console.error('❌ PUT /admin/persons/:id:', e);
    res.status(500).json({ error: 'Не вдалося оновити персону' });
  }
});

/** База нагадувань — тільки персони з Telegram ботом (мають telegramChatId). filter: all = всі, no_active_viber = без активних Viber оголошень. */
const hasTelegramReminderBaseCondition = {
  telegramChatId: {
    not: null,
  },
  NOT: [{ telegramChatId: '' }, { telegramChatId: '0' }],
};

const TELEGRAM_REMINDER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 днів

function getTelegramReminderWhere(filter: string): object {
  if (filter === 'no_active_viber') {
    return {
      ...hasTelegramReminderBaseCondition,
      viberListings: {
        none: {
          isActive: true,
        },
      },
    };
  }
  if (filter === 'no_reminder_7_days') {
    const sevenDaysAgo = new Date(Date.now() - TELEGRAM_REMINDER_COOLDOWN_MS);
    return {
      ...hasTelegramReminderBaseCondition,
      OR: [
        { telegramReminderSentAt: null },
        { telegramReminderSentAt: { lt: sevenDaysAgo } },
      ],
    };
  }
  return hasTelegramReminderBaseCondition;
}

/** Список Person для Telegram-нагадувань (база = з ботом). Query: ?filter=all|no_active_viber|no_reminder_7_days */
app.get('/admin/telegram-reminder-persons', requireAdmin, async (req, res) => {
  try {
    const filter = (req.query.filter as string)?.trim() || 'all';
    const where = getTelegramReminderWhere(filter);
    const persons = await prisma.person.findMany({
      where,
      select: {
        id: true,
        phoneNormalized: true,
        fullName: true,
        telegramChatId: true,
        telegramReminderSentAt: true,
      },
      orderBy: { id: 'asc' },
    });
    res.json(
      persons.map(
        (p: {
          id: number;
          phoneNormalized: string;
          fullName: string | null;
          telegramReminderSentAt: Date | null;
        }) => ({
          id: p.id,
          phoneNormalized: p.phoneNormalized,
          fullName: p.fullName,
          telegramReminderSentAt: p.telegramReminderSentAt ? p.telegramReminderSentAt.toISOString() : null,
        })
      )
    );
  } catch (e) {
    console.error('❌ telegram-reminder-persons:', e);
    res.status(500).json({ error: 'Failed to load telegram reminder persons' });
  }
});

/** Відправити Telegram-нагадування неактивним користувачам. Body: { filter?, limit?, delaysMs? } */
app.post('/admin/send-telegram-reminders', requireAdmin, async (req, res) => {
  if (!isTelegramEnabled()) {
    return res.status(400).json({ error: 'Telegram bot не налаштовано' });
  }
  try {
    const filter = (req.body?.filter as string)?.trim() || 'all';
    if (!['all', 'no_active_viber', 'no_reminder_7_days'].includes(filter)) {
      res.status(400).json({ error: 'Invalid filter' });
      return;
    }
    const limit = typeof req.body?.limit === 'number' && req.body.limit > 0 ? Math.floor(req.body.limit) : undefined;
    const delaysMs = Array.isArray(req.body?.delaysMs)
      ? (req.body.delaysMs as number[]).filter((d) => typeof d === 'number' && d >= 0).map((d) => Math.min(Math.floor(d), 120000))
      : undefined;
    const where = getTelegramReminderWhere(filter);
    let persons = await prisma.person.findMany({
      where,
      select: { id: true, phoneNormalized: true, fullName: true, telegramChatId: true },
      orderBy: { id: 'asc' },
    });
    if (limit !== undefined) {
      persons = persons.slice(0, limit);
    }
    let sent = 0;
    let failed = 0;
    const blocked: Array<{ id: number; phoneNormalized: string; fullName: string | null }> = [];
    for (let i = 0; i < persons.length; i++) {
      const p = persons[i];
      const chatId = p.telegramChatId;
      if (!chatId || chatId === '0' || !chatId.trim()) {
        failed++;
      } else {
        try {
          await sendInactivityReminder(chatId);
          sent++;
          await prisma.person.update({
            where: { id: p.id },
            data: { telegramReminderSentAt: new Date() },
          });
        } catch (err) {
          const errMsg = String((err as Error)?.message ?? err);
          const isBlocked = errMsg.includes('blocked by the user') || (errMsg.includes('403') && errMsg.toLowerCase().includes('forbidden'));
          if (isBlocked) {
            blocked.push({ id: p.id, phoneNormalized: p.phoneNormalized, fullName: p.fullName });
          }
          console.error(`❌ send-telegram-reminders person #${p.id}:`, err);
          failed++;
        }
      }
      if (delaysMs?.length && i < persons.length - 1) {
        const delayMs = delaysMs[Math.min(i, delaysMs.length - 1)] ?? 0;
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    const total = persons.length;
    const message = `Нагадування відправлено: ${sent}, помилок: ${failed}, всього в вибірці: ${total}${blocked.length > 0 ? `; заблокували бота: ${blocked.length}` : ''}`;
    console.log(`📢 Telegram reminders (filter=${filter}${limit ? `, limit=${limit}` : ''}): sent=${sent}, failed=${failed}, blocked=${blocked.length}, total=${total}`);
    res.json({ success: true, total, sent, failed, message, blocked });
  } catch (e) {
    console.error('❌ send-telegram-reminders:', e);
    res.status(500).json({ error: 'Failed to send telegram reminders' });
  }
});

/** Нагадати від особистого акаунта тим, хто заблокував бота. Body: { phones: string[], delaysSec?: number[] }. */
app.post('/admin/send-reminder-via-user-account', requireAdmin, async (req, res) => {
  try {
    const phones = Array.isArray(req.body?.phones) ? (req.body.phones as string[]).map((p) => String(p).trim()).filter(Boolean) : [];
    if (phones.length === 0) {
      return res.status(400).json({ error: 'Потрібен масив phones' });
    }
    const delaysSec = Array.isArray(req.body?.delaysSec)
      ? (req.body.delaysSec as number[]).filter((d) => typeof d === 'number' && d >= 0).map((d) => Math.min(Math.floor(d), 120))
      : [2, 15, 25, 30];
    const delaysMs = delaysSec.length > 0 ? delaysSec.map((s) => s * 1000) : [];
    const message = buildInactivityReminderMessage();
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < phones.length; i++) {
      const rawPhone = phones[i];
      const phone = normalizePhone(rawPhone);
      if (!phone) {
        failed++;
      } else {
        const ok = await sendMessageViaUserAccount(phone, message);
        if (ok) sent++;
        else failed++;
      }
      if (delaysMs.length > 0 && i < phones.length - 1) {
        const delayMs = delaysMs[i % delaysMs.length] ?? 30000;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    const resultMessage = `Відправлено від вашого імені: ${sent}, помилок: ${failed}`;
    console.log(`📢 Reminder via user account: ${sent} sent, ${failed} failed`);
    res.json({ success: true, sent, failed, message: resultMessage });
  } catch (e) {
    console.error('❌ send-reminder-via-user-account:', e);
    res.status(500).json({ error: 'Failed to send reminder via user account' });
  }
});

/** База реклами — завжди тільки персони без Telegram бота. filter: no_telegram = всі з бази, no_communication = з бази тільки ті, до кого ще не комунікували. */
const noTelegramCondition = {
  OR: [
    { telegramChatId: null },
    { telegramChatId: '' },
    { telegramChatId: '0' },
  ],
};

/** Мінімальна дата-маркер: пробували відправити промо, але номер не знайдено в Telegram. Для подальшої фільтрації. */
const PROMO_NOT_FOUND_SENTINEL = new Date(0);

function getChannelPromoWhere(filter: string): object {
  if (filter === 'no_communication') {
    return { ...noTelegramCondition, telegramPromoSentAt: null };
  }
  if (filter === 'promo_not_found') {
    return { ...noTelegramCondition, telegramPromoSentAt: PROMO_NOT_FOUND_SENTINEL };
  }
  return noTelegramCondition;
}

type ViberClientBehavior = {
  phoneNormalized: string;
  fullName: string | null;
  totalRides: number;
  firstRideDate: string | null;
  lastRideDate: string | null;
  routes: Array<{ route: string; count: number; share: number }>;
  weekdayStats: Array<{ weekday: number; count: number }>;
  timeOfDayStats: { morning: number; day: number; evening: number; night: number };
  behaviorSummary: string;
  recommendations: string[];
};

/** Список Person для реклами каналу (база = без бота). Query: ?filter=no_telegram|no_communication|promo_not_found */
app.get('/admin/channel-promo-persons', requireAdmin, async (req, res) => {
  try {
    const filter = (req.query.filter as string)?.trim() || 'no_telegram';
    const where = getChannelPromoWhere(filter);
    const persons = await prisma.person.findMany({
      where,
      select: { id: true, phoneNormalized: true, fullName: true },
      orderBy: { id: 'asc' },
    });
    res.json(persons);
  } catch (e) {
    console.error('❌ channel-promo-persons:', e);
    res.status(500).json({ error: 'Failed to load persons' });
  }
});

/** Відправити рекламу каналу. Body: { filter?, limit?, delaysMs? }. limit — лише перші N; delaysMs — паузи в мс між відправками [після 1-го, після 2-го, ...]. */
app.post('/admin/send-channel-promo', requireAdmin, async (req, res) => {
  try {
    const filter = (req.body?.filter as string)?.trim() || 'no_telegram';
    if (!['no_telegram', 'no_communication', 'promo_not_found'].includes(filter)) {
      res.status(400).json({ error: 'Invalid filter' });
      return;
    }
    const limit = typeof req.body?.limit === 'number' && req.body.limit > 0 ? Math.floor(req.body.limit) : undefined;
    const delaysMs = Array.isArray(req.body?.delaysMs)
      ? (req.body.delaysMs as number[]).filter((d) => typeof d === 'number' && d >= 0).map((d) => Math.min(Math.floor(d), 120000))
      : undefined;
    const where = getChannelPromoWhere(filter);
    let persons = await prisma.person.findMany({
      where,
      select: { id: true, phoneNormalized: true, fullName: true },
      orderBy: { id: 'asc' },
    });
    if (limit !== undefined) {
      persons = persons.slice(0, limit);
    }
    const message = buildChannelPromoMessage();
    const sent: Array<{ phone: string; fullName: string | null }> = [];
    const notFound: Array<{ phone: string; fullName: string | null }> = [];
    for (let i = 0; i < persons.length; i++) {
      const p = persons[i];
      const phone = normalizePhone(p.phoneNormalized);
      if (!phone) continue;
      const ok = await sendMessageViaUserAccount(phone, message);
      if (ok) {
        sent.push({ phone: p.phoneNormalized, fullName: p.fullName });
        await prisma.person.update({
          where: { id: p.id },
          data: { telegramPromoSentAt: new Date() },
        });
      } else {
        notFound.push({ phone: p.phoneNormalized, fullName: p.fullName });
        await prisma.person.update({
          where: { id: p.id },
          data: { telegramPromoSentAt: PROMO_NOT_FOUND_SENTINEL },
        });
      }
      if (delaysMs?.length && i < persons.length - 1) {
        const delayMs = delaysMs[Math.min(i, delaysMs.length - 1)] ?? 0;
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    console.log(`📢 Channel promo (filter=${filter}${limit ? `, limit=${limit}` : ''}): sent=${sent.length}, notFound=${notFound.length}`);
    res.json({ sent, notFound });
  } catch (e) {
    console.error('❌ send-channel-promo:', e);
    res.status(500).json({ error: 'Failed to send channel promo' });
  }
});

// Історичні дані з окремої таблиці "ViberRide" (сервіс парсингу Viber чату) → аналітична таблиця ViberRideEvent.
// Endpoint: тільки нові записи, щоб можна було викликати кілька разів.
app.post('/admin/viber-analytics/import', requireAdmin, async (_req, res) => {
  try {
    // Вихідні дані тепер беремо з таблиці ViberListing (історія оголошень з Viber-чату),
    // яка вже існує в основній БД backend.
    type SourceRow = {
      id: number;
      route: string;
      date: Date;
      departureTime: string | null;
      seats: number | null;
      phone: string;
      priceUah: number | null;
      isActive: boolean;
      createdAt: Date;
      personId: number | null;
    };

    // Які ViberListing вже імпортовані в ViberRideEvent (по viberRideId)
    const existing = await (prisma as any).viberRideEvent.findMany({
      select: { viberRideId: true },
    });
    const importedIds = new Set(
      (existing as Array<{ viberRideId: number }>).map((r) => r.viberRideId),
    );

    // Читаємо всі (або більшість) записів з ViberListing
    const rows = (await prisma.viberListing.findMany({
      orderBy: { id: 'asc' },
    })) as unknown as SourceRow[];

    const newRows: SourceRow[] = rows.filter((r: SourceRow) => !importedIds.has(r.id));

    if (newRows.length === 0) {
      return res.json({
        success: true,
        totalSource: rows.length,
        alreadyImported: rows.length,
        importedNow: 0,
        message: 'Нових записів ViberRide немає — все вже імпортовано раніше.',
      });
    }

    const toInsert: any[] = [];

    for (const r of newRows) {
      const rawPhone = (r.phone ?? '').trim();
      const normalized = rawPhone ? normalizePhone(rawPhone) : '';

      let weekday: number | null = null;
      let hour: number | null = null;

      if (r.date instanceof Date) {
        // JS: 0 = неділя ... 6 = субота
        weekday = r.date.getDay();
      }

      if (r.departureTime) {
        const timePart = r.departureTime.split('-')[0].trim();
        const [hStr] = timePart.split(':');
        const hNum = parseInt(hStr, 10);
        if (!Number.isNaN(hNum) && hNum >= 0 && hNum <= 23) {
          hour = hNum;
        }
      }

      const phoneNormalized = normalized || rawPhone || '';
      const personId = r.personId ?? null;

      toInsert.push({
        viberRideId: r.id,
        contactPhone: rawPhone || phoneNormalized,
        phoneNormalized,
        personId,
        route: r.route ?? null,
        departureDate: r.date ?? null,
        departureTime: r.departureTime ?? null,
        availableSeats: r.seats ?? null,
        priceUah: r.priceUah ?? null,
        isParsed: true,
        isActive: r.isActive ?? null,
        parsingErrors: null,
        weekday,
        hour,
        createdAt: r.createdAt ?? new Date(),
      });
    }

    let created = 0;
    const chunkSize = 500;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      if (!chunk.length) continue;
      const result = await (prisma as any).viberRideEvent.createMany({
        data: chunk,
        skipDuplicates: true,
      });
      created += result.count;
    }

    res.json({
      success: true,
      totalSource: rows.length,
      alreadyImported: rows.length - newRows.length,
      importedNow: created,
    });
  } catch (e) {
    console.error('❌ Помилка імпорту з ViberRide в ViberRideEvent:', e);
    res.status(500).json({
      error:
        'Не вдалося імпортувати історичні ViberRide дані. Переконайтеся, що таблиця "ViberRide" існує і має очікувані колонки.',
    });
  }
});

// Аналітика поведінки клієнтів на основі ViberRideEvent.
// Повертає до N клієнтів з найбільшою кількістю поїздок та коротким описом патернів.
app.get('/admin/viber-analytics/summary', requireAdmin, async (req, res) => {
  try {
    const limitParam = Number(req.query.limit);
    const minRidesParam = Number(req.query.minRides);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(50, Math.floor(limitParam)) : 20;
    const minRides = Number.isFinite(minRidesParam) && minRidesParam > 0 ? Math.floor(minRidesParam) : 3;

    const topPhones: any[] = await (prisma as any).viberRideEvent.groupBy({
      by: ['phoneNormalized'],
      _count: { _all: true },
      orderBy: { _count: { _all: 'desc' } },
      where: {
        phoneNormalized: { not: '' },
        isParsed: true,
      },
      take: limit * 3, // з запасом, потім відфільтруємо за minRides
    });

    const filteredTop = topPhones
      .filter((t: any) => t._count._all >= minRides)
      .slice(0, limit);
    if (filteredTop.length === 0) {
      return res.json({ clients: [] as ViberClientBehavior[] });
    }

    const phones = filteredTop.map((t: any) => t.phoneNormalized as string);

    const [events, persons] = await Promise.all([
      (prisma as any).viberRideEvent.findMany({
        where: { phoneNormalized: { in: phones } },
        orderBy: { departureDate: 'asc' },
      }),
      prisma.person.findMany({
        where: { phoneNormalized: { in: phones } },
        select: { id: true, phoneNormalized: true, fullName: true },
      }),
    ]);

    const personByPhone = new Map<string, { id: number; phoneNormalized: string; fullName: string | null }>();
    for (const p of persons) {
      personByPhone.set(p.phoneNormalized, p);
    }

    const eventsByPhone = new Map<string, typeof events>();
    for (const ev of events) {
      if (!ev.phoneNormalized) continue;
      if (!eventsByPhone.has(ev.phoneNormalized)) {
        eventsByPhone.set(ev.phoneNormalized, []);
      }
      eventsByPhone.get(ev.phoneNormalized)!.push(ev);
    }

    const clients: ViberClientBehavior[] = [];

    for (const phone of phones) {
      const evs = eventsByPhone.get(phone) ?? [];
      if (!evs.length) continue;

      const totalRides = evs.length;
      const firstRideDate = (evs[0].departureDate ?? evs[0].createdAt) as Date;
      const lastRideDate = (evs[evs.length - 1].departureDate ?? evs[evs.length - 1].createdAt) as Date;

      // Статистика по маршрутах
      const routeCounts = new Map<string, number>();
      for (const e of evs) {
        const r = e.route || 'Unknown';
        routeCounts.set(r, (routeCounts.get(r) ?? 0) + 1);
      }
      const routes = Array.from(routeCounts.entries())
        .map(([route, count]) => ({ route, count, share: count / totalRides }))
        .sort((a, b) => b.count - a.count);

      // Статистика по днях тижня
      const weekdayCounts = new Array<number>(7).fill(0);
      for (const e of evs) {
        const wd =
          typeof e.weekday === 'number'
            ? e.weekday
            : e.departureDate instanceof Date
            ? e.departureDate.getDay()
            : null;
        if (wd != null && wd >= 0 && wd <= 6) {
          weekdayCounts[wd]++;
        }
      }
      const weekdayStats = weekdayCounts.map((count, weekday) => ({ weekday, count }));

      // Статистика по часу доби
      let morning = 0;
      let day = 0;
      let evening = 0;
      let night = 0;
      for (const e of evs) {
        const h = typeof e.hour === 'number' ? e.hour : null;
        if (h == null) continue;
        if (h >= 5 && h < 11) morning++;
        else if (h >= 11 && h < 17) day++;
        else if (h >= 17 && h < 23) evening++;
        else night++;
      }
      const timeOfDayStats = { morning, day, evening, night };

      const mainRoute = routes[0];
      const person = personByPhone.get(phone) || null;
      const name = person?.fullName ?? null;

      const activeDays =
        (lastRideDate.getTime() - firstRideDate.getTime()) / (1000 * 60 * 60 * 24) || 1;
      const ridesPerWeek = (totalRides / (activeDays / 7)).toFixed(1);

      const weekdayWorkdays =
        weekdayCounts[1] + weekdayCounts[2] + weekdayCounts[3] + weekdayCounts[4] + weekdayCounts[5];
      const weekdayWeekend = weekdayCounts[0] + weekdayCounts[6];

      const tags: string[] = [];
      if (mainRoute && mainRoute.route !== 'Unknown') {
        tags.push(`часто їздить маршрутом ${mainRoute.route}`);
      }
      if (weekdayWorkdays > weekdayWeekend * 1.5) {
        tags.push('переважно їздить у будні дні');
      } else if (weekdayWeekend > weekdayWorkdays * 1.5) {
        tags.push('часті поїздки на вихідних');
      }
      if (evening > morning && evening > day && evening > night) {
        tags.push('частіше їздить ввечері');
      } else if (morning > evening && morning > day && morning > night) {
        tags.push('частіше їздить зранку');
      }

      const behaviorSummary =
        `${name ?? phone}: ${totalRides} поїздок за весь період (~${ridesPerWeek} на тиждень)` +
        (tags.length ? `. Основні патерни: ${tags.join(', ')}.` : '.');

      const recommendations: string[] = [
        'Технічна: можна запропонувати автоповідомлення про рейси на його основному маршруті.',
        'Технічна: можна показувати персональний блок з акціями для найчастіших напрямків.',
        'Технічна: у майбутньому можна запропонувати фіксоване місце у популярні для нього години.',
      ];

      clients.push({
        phoneNormalized: phone,
        fullName: name,
        totalRides,
        firstRideDate: firstRideDate.toISOString(),
        lastRideDate: lastRideDate.toISOString(),
        routes,
        weekdayStats,
        timeOfDayStats,
        behaviorSummary,
        recommendations,
      });
    }

    res.json({ clients });
  } catch (e) {
    console.error('❌ Помилка аналітики ViberRideEvent:', e);
    res.status(500).json({
      error: 'Не вдалося побудувати аналітику поведінки клієнтів за ViberRideEvent',
    });
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
  console.log(`API on http://localhost:${PORT} [${CODE_VERSION}]`);
});
